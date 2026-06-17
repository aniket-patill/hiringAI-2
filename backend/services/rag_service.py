import re
import os
import pypdf
import requests
import json
from pathlib import Path
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from . import gemini_client

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

class RAGService:

    @staticmethod
    def extract_text_from_pdf(file_path):
        text = ""
        with open(file_path, 'rb') as f:
            reader = pypdf.PdfReader(f)
            for page in reader.pages:
                text += page.extract_text() + "\n"
        return text

    @staticmethod
    def extract_text_from_docx(file_path):
        import zipfile
        import xml.etree.ElementTree as ET
        try:
            with zipfile.ZipFile(file_path) as z:
                xml_content = z.read('word/document.xml')
                root = ET.fromstring(xml_content)
                texts = []
                for paragraph in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
                    p_text = []
                    for text in paragraph.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'):
                        if text.text:
                            p_text.append(text.text)
                    if p_text:
                        texts.append("".join(p_text))
                return "\n".join(texts)
        except Exception as e:
            print(f"Error reading docx {file_path}: {e}")
            return ""

    @staticmethod
    def _clean_phone(raw_phone):
        """Clean and validate phone number to exactly 10 digits (Indian mobile)."""
        if not raw_phone:
            return None
        digits = re.sub(r'\D', '', raw_phone)
        # Remove common country codes: +91, 91, 0, 1
        if len(digits) == 12 and digits.startswith('91'):
            digits = digits[2:]
        elif len(digits) == 11 and digits.startswith('0'):
            digits = digits[1:]
        elif len(digits) == 11 and digits.startswith('1'):
            digits = digits[1:]
        elif len(digits) > 10:
            digits = digits[-10:]  # Take last 10 digits
        # Validate: must be exactly 10 digits and start with 6-9 (Indian mobile)
        if len(digits) == 10 and digits[0] in '6789':
            return digits
        # Fallback: if 10 digits but doesn't start with 6-9, still return
        if len(digits) == 10:
            return digits
        return None

    @staticmethod
    def extract_candidate_info(text, filename=""):
        info = {
            "name": "Unknown Candidate",
            "email": None,
            "phone": None
        }

        # 1. Regex Email
        email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        email_match = re.search(email_pattern, text)
        if email_match:
            info["email"] = email_match.group(0)

        # 1b. Regex Phone (Indian mobile + international formats)
        phone_patterns = [
            r'(?:\+91[\s.-]?)?[6-9]\d{4}[\s.-]?\d{5}',           # +91 9876543210
            r'(?:0|91)?[\s.-]?[6-9]\d{4}[\s.-]?\d{5}',           # 091 98765 43210
            r'(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}', # US format fallback
            r'(?:\+?\d[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4,7}',  # General
        ]
        for pattern in phone_patterns:
            phone_matches = re.findall(pattern, text[:3000])
            for pm in phone_matches:
                cleaned = RAGService._clean_phone(pm)
                if cleaned:
                    info["phone"] = cleaned
                    break
            if info["phone"]:
                break

        # 2. Heuristic Name
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        for i in range(min(5, len(lines))):
            potential_name = lines[i]
            if (1 <= len(potential_name.split()) <= 4 and
                    len(potential_name) < 50 and
                    "@" not in potential_name and
                    not any(char.isdigit() for char in potential_name)):
                info["name"] = potential_name.title()
                break

        # 3. AI Fallback
        if not info["email"] or info["name"] == "Unknown Candidate" or not info["phone"]:
            try:
                header_text = text[:3000]
                ai_extracted = RAGService.extract_with_llm(header_text)
                if ai_extracted.get("name") and ai_extracted["name"] not in ["Unknown", "Null", None]:
                    info["name"] = ai_extracted["name"]
                if ai_extracted.get("email") and not info["email"]:
                    info["email"] = ai_extracted["email"]
                if ai_extracted.get("phone") and not info["phone"]:
                    # Clean AI-extracted phone too
                    cleaned_ai_phone = RAGService._clean_phone(ai_extracted["phone"])
                    if cleaned_ai_phone:
                        info["phone"] = cleaned_ai_phone
            except Exception as e:
                print(f"Candidate info extraction failed: {e}")

        # 4. Filename Fallback
        if info["name"] in ["Unknown Candidate", "Resume", "Cv", "Curriculum Vitae"] and filename:
            base = os.path.splitext(filename)[0]
            clean_name = base.replace("_", " ").replace("-", " ").title()
            clean_name = re.sub(r'\bresume\b|\bcv\b|\bprofile\b', '', clean_name, flags=re.IGNORECASE).strip()
            if clean_name:
                info["name"] = clean_name

        return info

    @staticmethod
    def extract_with_llm(text_chunk):
        """
        Uses Gemini 2.5 Flash to parse structured contact info from raw text.
        """
        if not gemini_client.has_gemini_key():
            return {}

        try:
            return RAGService._inner_extract_with_llm(text_chunk)
        except Exception as e:
            print(f"Gemini extraction failed after retries: {e}")
            return {}

    @staticmethod
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=2, max=10),
        retry=retry_if_exception_type(Exception)
    )
    def _inner_extract_with_llm(text_chunk):
        prompt = f"""
        Extract the **Candidate Name**, **Email Address**, and **Phone Number** from the text below.
        Return null for any field not found.
        
        TEXT:
        {text_chunk}
        
        OUTPUT JSON ONLY:
        {{
            "name": "Full Name or null",
            "email": "email or null",
            "phone": "phone number or null"
        }}
        """
        
        result = gemini_client.call_gemini(
            prompt=prompt,
            system_prompt="You are a data extraction assistant. Output valid JSON only.",
            temperature=0.1,
            json_mode=True
        )
        return result

    @staticmethod
    def screen_resume(jd_text, resume_id, resume_context=""):
        """
        Ingests strict context and scores.
        """
        # 0. Validate JD
        clean_jd = jd_text.strip()
        if len(clean_jd) < 15 or len(clean_jd.split()) < 3:
             return {
                "score": 0, 
                "reasoning": "Job Description is too vague or invalid (Text too short). Please provide a detailed description.", 
                "key_skills_match": [],
                "missing_skills": []
            }

        # 3. Call Gemini API with context
        if not gemini_client.has_gemini_key():
            return {"score": 0, "reasoning": "Missing API Key", "key_skills_match": [], "missing_skills": []}
        return RAGService.call_gemini_api(jd_text, resume_context)

    @staticmethod
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=2, max=10),
        retry=retry_if_exception_type(requests.exceptions.HTTPError)
    )
    def call_gemini_api(jd, resume_context):
        # Fetch dynamic scoring weights from database
        try:
            from database import SessionLocal
            import models
            db = SessionLocal()
            settings_obj = db.query(models.GlobalSettings).order_by(models.GlobalSettings.id.desc()).first()
            weights = settings_obj.config.get("scoring", {
                "skills": 40,
                "experience": 25,
                "projects": 20,
                "education": 10,
                "bonus": 5
            }) if settings_obj else {
                "skills": 40,
                "experience": 25,
                "projects": 20,
                "education": 10,
                "bonus": 5
            }
            db.close()
        except Exception as e:
            print(f"Error fetching scoring weights: {e}")
            weights = {
                "skills": 40,
                "experience": 25,
                "projects": 20,
                "education": 10,
                "bonus": 5
            }

        prompt = f"""
        Act as a Senior Technical Recruiter evaluation engine.
        
        JOB DESCRIPTION:
        {jd}
        
        CANDIDATE RESUME:
        {resume_context[:25000]} 
        
        TASK:
        Evaluate the candidate against the Job Description using the EXACT scoring rubric below.
        
        SCORING LOGIC (Total 100%):
        1. Skills Matching ({weights.get('skills', 40)}%): Extract required skills from JD and compare with resume (semantic + keyword). Score = (matched/total) * {weights.get('skills', 40)}.
        2. Experience Relevance ({weights.get('experience', 25)}%): Compare years of experience and role relevance. Full match = {weights.get('experience', 25)}. Partial = proportional. No match = 0.
        3. Project / Role Alignment ({weights.get('projects', 20)}%): Analyze project complexity and impact vs JD responsibilities. Max score = {weights.get('projects', 20)}.
        4. Education Match ({weights.get('education', 10)}%): Full match (meets req) = {weights.get('education', 10)}. Related degree = proportional. Unrelated/Missing = lower score.
        5. Preferred / Bonus Skills ({weights.get('bonus', 5)}%): Award bonus for nice-to-have skills. Max score = {weights.get('bonus', 5)}.
        
        OUTPUT REQUIREMENTS:
        - Return a precise integer Total Score (0-100).
        - Provide component scores.
        - List matched and missing skills.
        - Generate a normalized "extracted_role" (e.g. "Senior Frontend Engineer").
        - Provide a short 2-3 line explanation.
        
        Return STRICT JSON only:
        {{
            "score": (0-100 integer),
            "component_scores": {{
                "skills": (0-{weights.get('skills', 40)}),
                "experience": (0-{weights.get('experience', 25)}),
                "projects": (0-{weights.get('projects', 20)}),
                "education": (0-{weights.get('education', 10)}),
                "bonus": (0-{weights.get('bonus', 5)})
            }},
            "key_skills_match": ["Skill A", "Skill B"],
            "missing_skills": ["Skill X", "Skill Y"],
            "reasoning": "Reasoning...",
            "extracted_role": "Job Title"
        }}
        """
        
        try:
            result = gemini_client.call_gemini(
                prompt=prompt,
                system_prompt="You are a helpful and accurate recruitment assistant. You only output valid JSON.",
                temperature=0.1,
                json_mode=True
            )
            return result
            
        except Exception as e:
            print(f"Gemini API Error: {e}")
            raise
