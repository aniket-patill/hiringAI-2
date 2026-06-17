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
        Legacy shim — delegates to screen_and_extract using only the extraction fields.
        Only used when regex fails to find email/name/phone.
        """
        if not gemini_client.has_gemini_key():
            return {}
        try:
            # Call the merged function with no JD — only contact fields will be populated
            result = RAGService._inner_extract_with_llm(text_chunk)
            return {
                "name": result.get("name"),
                "email": result.get("email"),
                "phone": result.get("phone"),
            }
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
        """Contact-only extraction (fallback when no JD available)."""
        prompt = f"""
Extract the candidate's name, email, and phone from the resume text below.
Return null for any field not found.

RESUME:
{text_chunk[:3000]}

OUTPUT JSON ONLY:
{{
    "name": "Full Name or null",
    "email": "email@example.com or null",
    "phone": "phone number or null"
}}
"""
        return gemini_client.call_gemini(
            prompt=prompt,
            system_prompt="You are a data extraction assistant. Output valid JSON only.",
            temperature=0.1,
            json_mode=True
        )

    # ── MERGED SINGLE-CALL: extract contact info + score resume in one prompt ─────

    @staticmethod
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=2, max=10),
        retry=retry_if_exception_type(Exception)
    )
    def screen_and_extract(jd_text: str, full_text: str, weights: dict) -> dict:
        """
        Single Gemini call that simultaneously:
          • Extracts candidate contact info (name, email, phone)
          • Scores the resume against the JD using the weighted rubric
          • Returns extracted_role, skills, reasoning

        Returns a merged dict containing both info-extraction and screening fields.
        """
        sw = weights
        prompt = f"""
You are a Senior Technical Recruiter AI. Given the JOB DESCRIPTION and CANDIDATE RESUME below, do TWO things in a single response:

1. EXTRACT the candidate's contact details.
2. EVALUATE the candidate against the JD using the scoring rubric.

JOB DESCRIPTION:
{jd_text}

CANDIDATE RESUME:
{full_text[:25000]}

SCORING RUBRIC (Total 100 points):
- Skills Matching ({sw.get('skills', 40)} pts): matched / total required skills × {sw.get('skills', 40)}
- Experience Relevance ({sw.get('experience', 25)} pts): years + role relevance
- Project / Role Alignment ({sw.get('projects', 20)} pts): complexity and impact
- Education Match ({sw.get('education', 10)} pts): degree relevance
- Preferred / Bonus Skills ({sw.get('bonus', 5)} pts): nice-to-have skills

Return STRICT JSON only — no markdown, no extra text:
{{
    "name": "Candidate Full Name or null",
    "email": "email@example.com or null",
    "phone": "phone number or null",
    "score": <0-100 integer>,
    "component_scores": {{
        "skills": <0-{sw.get('skills', 40)}>,
        "experience": <0-{sw.get('experience', 25)}>,
        "projects": <0-{sw.get('projects', 20)}>,
        "education": <0-{sw.get('education', 10)}>,
        "bonus": <0-{sw.get('bonus', 5)}>
    }},
    "key_skills_match": ["Skill A", "Skill B"],
    "missing_skills": ["Skill X", "Skill Y"],
    "reasoning": "2-3 line explanation of the score.",
    "extracted_role": "Normalized job title e.g. Senior Frontend Engineer"
}}
"""
        return gemini_client.call_gemini(
            prompt=prompt,
            system_prompt="You are an expert recruitment assistant. Output valid JSON only.",
            temperature=0.1,
            json_mode=True
        )

    @staticmethod
    def screen_resume(jd_text, resume_id, resume_context=""):
        """
        Legacy shim kept for compatibility.
        In the main worker path, screen_and_extract() is used instead.
        """
        clean_jd = jd_text.strip()
        if len(clean_jd) < 15 or len(clean_jd.split()) < 3:
            return {
                "score": 0,
                "reasoning": "Job Description is too vague or invalid. Please provide a detailed description.",
                "key_skills_match": [],
                "missing_skills": []
            }
        if not gemini_client.has_gemini_key():
            return {"score": 0, "reasoning": "Missing API Key", "key_skills_match": [], "missing_skills": []}
        weights = RAGService._get_scoring_weights()
        return RAGService.screen_and_extract(jd_text, resume_context, weights)

    @staticmethod
    def _get_scoring_weights() -> dict:
        """Fetch scoring weights from DB with a 60-second module-level cache."""
        import time
        now = time.time()
        if RAGService._weights_cache and now - RAGService._weights_cache_ts < 60:
            return RAGService._weights_cache
        default = {"skills": 40, "experience": 25, "projects": 20, "education": 10, "bonus": 5}
        try:
            from database import SessionLocal
            import models
            db = SessionLocal()
            try:
                settings_obj = db.query(models.GlobalSettings).order_by(models.GlobalSettings.id.desc()).first()
                weights = settings_obj.config.get("scoring", default) if settings_obj else default
            finally:
                db.close()
        except Exception as e:
            print(f"[Worker] Could not fetch scoring weights: {e}", flush=True)
            weights = default
        RAGService._weights_cache = weights
        RAGService._weights_cache_ts = now
        return weights

    # Cache attributes (module-level via class)
    _weights_cache: dict | None = None
    _weights_cache_ts: float = 0.0


# ─────────────────────────────────────────────
# RAG: Vector indexing + querying for resumes
# ─────────────────────────────────────────────
import asyncio
import traceback
import uuid as _uuid
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

VECTOR_DIM = 3072  # gemini-embedding-001 (3072-dim, verified available on this key)
_qdrant_client: QdrantClient | None = None


def _get_qdrant() -> QdrantClient:
    global _qdrant_client
    if _qdrant_client is None:
        _qdrant_client = QdrantClient(url=os.getenv("QDRANT_URL", "http://localhost:6333"))
    return _qdrant_client



# ── Embedding via REST v1 (bypasses SDK's broken v1beta gRPC path) ────────────
# google-generativeai <=0.8.x always uses the v1beta gRPC endpoint which does
# NOT expose embedContent for text-embedding-004 or embedding-001.  Calling the
# v1 REST endpoint directly is the only reliable approach with this SDK version.

_EMBED_CANDIDATES = [
    "gemini-embedding-001",   # 3072-dim, latest GA Gemini embedding model
    "gemini-embedding-2",     # alternative if above unavailable
]
_EMBED_MODEL: str | None = None   # cached after first successful probe


def _resolve_embed_model() -> str:
    """
    Probe the Gemini v1 REST API once to find the first available embedding model.
    Result is cached in _EMBED_MODEL for the lifetime of the process.
    """
    global _EMBED_MODEL
    if _EMBED_MODEL:
        return _EMBED_MODEL

    import requests as _req
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set in environment")

    # Fetch the list of available models from v1
    try:
        list_url = f"https://generativelanguage.googleapis.com/v1/models?key={api_key}"
        resp = _req.get(list_url, timeout=10)
        resp.raise_for_status()
        available = {m["name"] for m in resp.json().get("models", [])}
        print(f"[RAG] Available Gemini models: {len(available)} total", flush=True)
    except Exception as e:
        print(f"[RAG] Could not list models: {e} — falling back to text-embedding-004", flush=True)
        available = set()

    for candidate in _EMBED_CANDIDATES:
        full_name = f"models/{candidate}"
        if not available or full_name in available:
            _EMBED_MODEL = candidate
            print(f"[RAG] Selected embedding model: {candidate}", flush=True)
            return _EMBED_MODEL

    # Last resort — try the preferred one anyway
    _EMBED_MODEL = _EMBED_CANDIDATES[0]
    print(f"[RAG] Fallback embedding model: {_EMBED_MODEL}", flush=True)
    return _EMBED_MODEL


def _embed_text_sync(text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> list:
    """
    Call Gemini embedContent via the v1 REST endpoint directly.
    The google-generativeai SDK <=0.8.x only uses v1beta gRPC which doesn't
    support embedContent, so we bypass it entirely with a plain HTTPS request.
    """
    import requests as _req
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set in environment")

    model = _resolve_embed_model()
    url = (
        f"https://generativelanguage.googleapis.com/v1/models/"
        f"{model}:embedContent?key={api_key}"
    )
    payload = {
        "model": f"models/{model}",
        "content": {"parts": [{"text": text}]},
        "taskType": task_type,
    }
    resp = _req.post(url, json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json()["embedding"]["values"]


async def _embed_text(text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> list:
    return await asyncio.to_thread(_embed_text_sync, text, task_type)



def _chunk_resume(full_text: str, candidate_id: int) -> list:
    """Split resume plain text into semantic section chunks for vector indexing."""
    chunks = []
    text = full_text.strip()
    if not text:
        return chunks

    # Full text anchor (capped at 3000 chars)
    chunks.append({"field": "full", "text": text[:3000]})

    # Header chunk (first 600 chars: name, contact, summary)
    if len(text) > 100:
        chunks.append({"field": "header", "text": text[:600]})

    # Section-based chunking via common headings
    section_patterns = {
        "skills": r"(?i)^(skills?|technical skills?|core competencies|technologies|tech stack|key skills)[\s:]*$",
        "experience": r"(?i)^(experience|work experience|employment|work history|professional experience|career history)[\s:]*$",
        "education": r"(?i)^(education|academic|qualification|degrees?)[\s:]*$",
        "projects": r"(?i)^(projects?|portfolio|personal projects|work samples|key projects)[\s:]*$",
    }

    lines = text.split('\n')
    current_section = None
    section_lines: list = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        matched_section = None
        for sec_name, pattern in section_patterns.items():
            if re.match(pattern, stripped):
                matched_section = sec_name
                break

        if matched_section:
            if current_section and len(section_lines) > 2:
                section_text = '\n'.join(section_lines[:60])
                if len(section_text) > 60:
                    chunks.append({"field": current_section, "text": section_text})
            current_section = matched_section
            section_lines = []
        elif current_section:
            section_lines.append(stripped)

    # Flush last section
    if current_section and len(section_lines) > 2:
        section_text = '\n'.join(section_lines[:60])
        if len(section_text) > 60:
            chunks.append({"field": current_section, "text": section_text})

    # Deduplicate by field (keep first occurrence)
    seen: set = set()
    unique: list = []
    for chunk in chunks:
        if chunk["field"] not in seen:
            seen.add(chunk["field"])
            unique.append(chunk)
    return unique


def _make_point_id(candidate_id: int, field: str) -> str:
    return str(_uuid.uuid5(_uuid.NAMESPACE_DNS, f"{candidate_id}:{field}"))


class RagIndexingService:

    @staticmethod
    def _collection_name(user_id: int) -> str:
        return f"resumes_{user_id}"

    @staticmethod
    def _ensure_collection(client: QdrantClient, collection_name: str) -> None:
        existing = [c.name for c in client.get_collections().collections]
        if collection_name not in existing:
            client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE)
            )

    @staticmethod
    def delete_collection(user_id: int) -> None:
        try:
            client = _get_qdrant()
            collection_name = RagIndexingService._collection_name(user_id)
            existing = [c.name for c in client.get_collections().collections]
            if collection_name in existing:
                client.delete_collection(collection_name=collection_name)
                print(f"[RAG] Collection {collection_name} deleted.", flush=True)
        except Exception as e:
            print(f"[RAG] Failed to delete collection for user {user_id}: {e}", flush=True)

    @staticmethod
    async def index_candidate(candidate_id: int, user_id: int, full_text: str) -> bool:
        """Chunk, embed, and upsert a candidate's resume into Qdrant."""
        try:
            print(f"[RAG] index_candidate: candidate={candidate_id} user={user_id} text_len={len(full_text)}", flush=True)
            chunks = _chunk_resume(full_text, candidate_id)
            if not chunks:
                print(f"[RAG] No chunks produced for candidate {candidate_id}", flush=True)
                return False

            print(f"[RAG] Embedding {len(chunks)} chunks for candidate {candidate_id}...", flush=True)
            embeddings = await asyncio.gather(
                *[_embed_text(c["text"], "RETRIEVAL_DOCUMENT") for c in chunks]
            )
            print(f"[RAG] Embeddings done for candidate {candidate_id}", flush=True)

            collection_name = RagIndexingService._collection_name(user_id)
            client = _get_qdrant()
            print(f"[RAG] Ensuring Qdrant collection: {collection_name}", flush=True)
            await asyncio.to_thread(
                RagIndexingService._ensure_collection, client, collection_name
            )

            points = [
                PointStruct(
                    id=_make_point_id(candidate_id, chunks[i]["field"]),
                    vector=embeddings[i],
                    payload={
                        "candidate_id": candidate_id,
                        "user_id": user_id,
                        "field": chunks[i]["field"],
                        "text": chunks[i]["text"],
                    }
                )
                for i in range(len(chunks))
            ]

            await asyncio.to_thread(
                client.upsert,
                collection_name=collection_name,
                points=points
            )
            print(f"[RAG] ✓ Indexed candidate {candidate_id} ({len(points)} chunks) into {collection_name}", flush=True)
            return True
        except Exception:
            print(f"[RAG] ✗ Indexing failed for candidate {candidate_id}:\n{traceback.format_exc()}", flush=True)
            return False


class RagQueryService:

    @staticmethod
    async def query_candidates(
        query_text: str,
        user_id: int,
        conversation_history: list | None = None,
        candidate_names_map: dict | None = None,
    ) -> dict:
        """Semantic search over candidate resumes, synthesize answer with Gemini."""
        collection_name = f"resumes_{user_id}"
        client = _get_qdrant()

        # Check collection exists
        try:
            existing_names = [c.name for c in (await asyncio.to_thread(client.get_collections)).collections]
        except Exception:
            existing_names = []

        if collection_name not in existing_names:
            return {
                "answer": "No resumes have been indexed yet. Please screen some resumes first, then wait for the worker to index them.",
                "sources_count": 0,
                "source_candidate_ids": []
            }

        # Embed query
        query_vector = await _embed_text(query_text, "RETRIEVAL_QUERY")

        # Vector search
        search_results = await asyncio.to_thread(
            client.search,
            collection_name=collection_name,
            query_vector=query_vector,
            limit=8
        )

        if not search_results:
            return {
                "answer": "No matching candidates found for your query. Try different keywords.",
                "sources_count": 0,
                "source_candidate_ids": []
            }

        # Build context from retrieved chunks — use names if provided
        context_parts = []
        source_ids = []
        for hit in search_results:
            payload = hit.payload or {}
            cid = payload.get("candidate_id")
            if cid and cid not in source_ids:
                source_ids.append(cid)
            name = (candidate_names_map or {}).get(cid, f"Candidate {cid}")
            context_parts.append(
                f"[{name} — {payload.get('field', 'resume')}]\n{payload.get('text', '')}"
            )
        context = "\n\n---\n\n".join(context_parts)

        # Append last 6 conversation turns
        history_str = ""
        if conversation_history:
            for msg in conversation_history[-6:]:
                role = "HR" if msg.get("role") == "user" else "Assistant"
                history_str += f"{role}: {msg.get('content', '')}\n"

        prompt = f"""You are an AI hiring assistant. Answer the HR manager's question based ONLY on the resume context below.
Refer to candidates by their FULL NAME (never by ID number). Use markdown formatting in your response:
- Use **bold** for candidate names and key skills
- Use bullet points to list candidates or attributes
- Use headings (##) only for longer multi-section answers
- Be concise, specific, and actionable
If the context doesn't contain enough information, say so clearly.

RESUME CONTEXT:
{context}

CONVERSATION HISTORY:
{history_str}
HR QUESTION: {query_text}

ANSWER:"""

        try:
            from . import gemini_client
            answer = gemini_client.call_gemini_text(
                prompt=prompt,
                system_prompt="You are an expert AI hiring assistant. Reference specific candidates from the context. Be concise and factual.",
                temperature=0.3
            )
        except Exception as e:
            print(f"[RAG] ✗ Query synthesis failed: {e}\n{traceback.format_exc()}", flush=True)
            answer = f"Could not generate answer: {e}"

        source_names = [
            (candidate_names_map or {}).get(cid, f"Candidate {cid}")
            for cid in source_ids
        ]
        return {
            "answer": answer,
            "sources_count": len(search_results),
            "source_candidate_ids": source_ids,
            "source_candidate_names": source_names,
        }
