import re
import os
import pypdf
import requests
import json
from pathlib import Path
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from . import groq_client

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
    def extract_candidate_info(text, filename=""):
        info = {
            "name": "Unknown Candidate",
            "email": None
        }

        # 1. Regex Email
        email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        email_match = re.search(email_pattern, text)
        if email_match:
            info["email"] = email_match.group(0)

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
        if not info["email"] or info["name"] == "Unknown Candidate":
            try:
                header_text = text[:3000]
                ai_extracted = RAGService.extract_with_llm(header_text)
                if ai_extracted.get("name") and ai_extracted["name"] not in ["Unknown", "Null", None]:
                    info["name"] = ai_extracted["name"]
                if ai_extracted.get("email") and not info["email"]:
                    info["email"] = ai_extracted["email"]
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
        Uses Groq to parse structured contact info from raw text.
        """
        if not groq_client.has_groq_key():
            return {}

        try:
            return RAGService._inner_extract_with_llm(text_chunk)
        except Exception as e:
            print(f"Groq extraction failed after retries: {e}")
            return {}

    @staticmethod
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=2, max=10),
        retry=retry_if_exception_type(requests.exceptions.HTTPError)
    )
    def _inner_extract_with_llm(text_chunk):
        prompt = f"""
        Extract the **Candidate Name** and **Email Address** from the text below.
        If email is not found, return null.
        If name is not found, return null.
        
        TEXT:
        {text_chunk}
        
        OUTPUT JSON ONLY:
        {{
            "name": "Full Name",
            "email": "email"
        }}
        """
        
        url = "https://api.groq.com/openai/v1/chat/completions" 
        payload = {
            "messages": [
                {"role": "system", "content": "You are a data extraction assistant. Output valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            "model": "llama-3.1-8b-instant",
            "temperature": 0.1,
            "response_format": {"type": "json_object"}
        }
        
        # DEBUG
        response = groq_client.execute_groq_request(url, payload, timeout=15)
        response.raise_for_status()
        
        if response.status_code == 200:
            content = response.json()['choices'][0]['message']['content']
            return json.loads(content)
        
        return {}

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

        # 3. Call Groq API with context
        if not groq_client.has_groq_key():
            return {"score": 0, "reasoning": "Missing API Key", "key_skills_match": [], "missing_skills": []}
        return RAGService.call_groq_api(jd_text, resume_context)

    @staticmethod
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=2, max=10),
        retry=retry_if_exception_type(requests.exceptions.HTTPError)
    )
    def call_groq_api(jd, resume_context):
        # Fetch dynamic scoring weights from database
        try:
            from database import SessionLocal
            import models
            db = SessionLocal()
            # Get the most recent settings (works for single or multi-admin)
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
            url = "https://api.groq.com/openai/v1/chat/completions" 
            payload = {
                "messages": [
                    {"role": "system", "content": "You are a helpful and accurate recruitment assistant. You only output valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                "model": "llama-3.1-8b-instant",
                "temperature": 0.1,
                "response_format": {"type": "json_object"}
            }
            
            response = groq_client.execute_groq_request(url, payload)
            response.raise_for_status() 
            
            data = response.json()
            content = data['choices'][0]['message']['content']
            
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                content = content.replace("```json", "").replace("```", "").strip()
                return json.loads(content)
            
        except Exception as e:
            print(f"Groq API Error: {e}")
            # Re-raise so the caller can fall back to keyword matching
            raise
