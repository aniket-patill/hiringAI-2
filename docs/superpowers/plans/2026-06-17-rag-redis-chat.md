# HiringAI — RAG + Redis Worker + Resume Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add async Redis-based resume screening pipeline, Qdrant vector search, and a chatbot UI for querying candidates by natural language.

**Architecture:** Resume uploads are enqueued to a Redis Stream; an async worker process extracts text, runs LLM scoring, saves candidates to MySQL, and indexes them into Qdrant. A new `/api/rag/query` endpoint lets the chatbot answer hiring questions by doing semantic search over the indexed resumes. The frontend gets a new `/resume-chat` page mirroring optira's chat UI.

**Tech Stack:** FastAPI, Redis Streams (`redis>=5.0.0`), Qdrant (`qdrant-client>=1.9.0`), `google-generativeai` (already installed for Gemini), React + Tailwind, Docker Compose

## Global Constraints

- Python packages added to `backend/requirements.txt` only — no new lock file tool
- All new backend files live in `backend/` (same level as `main.py`)
- All new frontend files are `.jsx` in `frontend/src/pages/` or `frontend/src/components/`
- Qdrant collection naming: `resumes_{user_id}` (one per HR user)
- Embedding model: `models/text-embedding-004`, 768 dims, via `google.generativeai`
- Redis stream name: `screening_jobs`, consumer group: `screening_workers`
- `ScreeningJob.status` values: `"pending"` | `"processing"` | `"completed"` | `"failed"` | `"dead"`
- Worker runs as a **separate process** (`python worker.py`), not as a FastAPI background task
- No breaking changes to existing synchronous `/api/resume/rescreen-unscored/` endpoint
- The existing `normalize_role` logic currently lives **inside** the `screen_resume` endpoint function — it must be **moved to module level** as `normalize_role(raw_title: str) -> str` so both the router and worker can import it

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `backend/requirements.txt` | Modify | Add redis, qdrant-client |
| `backend/.env` | Modify | Add QDRANT_URL |
| `backend/models.py` | Modify | Add ScreeningJob model |
| `backend/queue.py` | **Create** | Redis Streams helpers |
| `backend/services/rag_service.py` | Modify | Add resume chunker, RagIndexingService, RagQueryService |
| `backend/worker.py` | **Create** | Async dual-loop worker process |
| `backend/routers/rag.py` | **Create** | POST /api/rag/query endpoint |
| `backend/routers/resume.py` | Modify | Move normalize_role, make screen endpoint async (enqueue), add batch poll endpoint |
| `backend/main.py` | Modify | Register rag router |
| `frontend/src/pages/ResumeChat.jsx` | **Create** | Chatbot UI |
| `frontend/src/App.jsx` | Modify | Add /resume-chat route |
| `frontend/src/components/GlobalNavbar.jsx` | Modify | Add "AI Search" nav item |
| `docker-compose.yml` | **Create** | Backend + Frontend + MySQL + Redis + Qdrant + Worker |

---

### Task 1: Dependencies & Environment Config

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/.env`

**Interfaces:**
- Produces: `redis.asyncio` importable, `qdrant_client` importable, `QDRANT_URL` env var available

- [ ] **Step 1: Add packages to requirements.txt**

Add after `tenacity==9.0.0`:
```
redis==5.0.8
qdrant-client==1.9.1
```

`backend/requirements.txt` should now end with:
```
tenacity==9.0.0
redis==5.0.8
qdrant-client==1.9.1
ultralytics==8.3.163
opencv-python-headless==4.10.0.84
```

- [ ] **Step 2: Add QDRANT_URL to .env**

Append to `backend/.env`:
```
QDRANT_URL=http://localhost:6333
```

- [ ] **Step 3: Install and verify**

```bash
cd backend
pip install redis==5.0.8 qdrant-client==1.9.1
python -c "import redis.asyncio; from qdrant_client import QdrantClient; print('OK')"
```
Expected: `OK`

---

### Task 2: ScreeningJob Model

**Files:**
- Modify: `backend/models.py` (append after line 125, before the end of file)

**Interfaces:**
- Produces: `models.ScreeningJob` with fields: `id`, `batch_id`, `filename`, `file_path`, `jd_text`, `top_n`, `status`, `retry_count`, `candidate_id`, `result`, `error`, `created_by`, `created_at`, `updated_at`

- [ ] **Step 1: Append ScreeningJob to models.py**

Add after the `Notification` class (after line 125):
```python
class ScreeningJob(Base):
    __tablename__ = "screening_jobs"
    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(String(36), index=True, nullable=False)
    filename = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    jd_text = Column(Text, nullable=False)
    top_n = Column(Integer, default=10)
    status = Column(String(20), default="pending", index=True)
    retry_count = Column(Integer, default=0)
    candidate_id = Column(Integer, ForeignKey("candidates.id"), nullable=True)
    result = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
```

- [ ] **Step 2: Verify model loads and table creates**

```bash
cd backend
python -c "
from database import engine
import models
models.Base.metadata.create_all(bind=engine)
from sqlalchemy import inspect
inspector = inspect(engine)
print('screening_jobs' in inspector.get_table_names())
"
```
Expected: `True`

---

### Task 3: Redis Queue Module

**Files:**
- Create: `backend/queue.py`

**Interfaces:**
- Produces:
  - `async get_redis() -> redis.asyncio.Redis`
  - `async ensure_group(client) -> None`
  - `async enqueue_job(client, job_id: int) -> str`
  - `async read_jobs(client, consumer_name: str, count: int, block_ms: int) -> list`
  - `async ack_job(client, msg_id: str) -> None`
  - `async reclaim_stale_jobs(client, consumer_name: str, count: int) -> list`

- [ ] **Step 1: Create backend/queue.py**

```python
import os
import redis.asyncio as aioredis
from dotenv import load_dotenv

load_dotenv()

STREAM_KEY = "screening_jobs"
GROUP_NAME = "screening_workers"
STREAM_MAXLEN = 1000
RECLAIM_IDLE_MS = 60_000


async def get_redis() -> aioredis.Redis:
    return await aioredis.from_url(
        os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        decode_responses=True
    )


async def ensure_group(client: aioredis.Redis) -> None:
    try:
        await client.xgroup_create(STREAM_KEY, GROUP_NAME, id="0", mkstream=True)
    except Exception:
        pass  # Group already exists


async def enqueue_job(client: aioredis.Redis, job_id: int) -> str:
    return await client.xadd(
        STREAM_KEY,
        {"job_id": str(job_id)},
        maxlen=STREAM_MAXLEN,
        approximate=True
    )


async def read_jobs(
    client: aioredis.Redis,
    consumer_name: str,
    count: int = 10,
    block_ms: int = 5000
) -> list:
    result = await client.xreadgroup(
        GROUP_NAME, consumer_name,
        {STREAM_KEY: ">"},
        count=count,
        block=block_ms
    )
    if not result:
        return []
    # result is [(stream_key, [(msg_id, {field: val}), ...])]
    return result[0][1]


async def ack_job(client: aioredis.Redis, msg_id: str) -> None:
    await client.xack(STREAM_KEY, GROUP_NAME, msg_id)


async def reclaim_stale_jobs(
    client: aioredis.Redis,
    consumer_name: str,
    count: int = 10
) -> list:
    result = await client.xautoclaim(
        STREAM_KEY, GROUP_NAME, consumer_name,
        min_idle_time=RECLAIM_IDLE_MS,
        start_id="0-0",
        count=count
    )
    # result is (next_start_id, [(msg_id, {field: val}), ...], [deleted_ids])
    return result[1] if result else []


async def queue_depth(client: aioredis.Redis) -> dict:
    length = await client.xlen(STREAM_KEY)
    pending_info = await client.xpending(STREAM_KEY, GROUP_NAME)
    pending = pending_info.get("pending", 0) if isinstance(pending_info, dict) else 0
    return {"stream_length": length, "pending": pending}
```

- [ ] **Step 2: Smoke-test queue module**

Start Redis first (`docker run -p 6379:6379 redis:7-alpine`), then:
```bash
cd backend
python -c "
import asyncio
import queue as q

async def test():
    client = await q.get_redis()
    await q.ensure_group(client)
    msg_id = await q.enqueue_job(client, 999)
    print('Enqueued:', msg_id)
    jobs = await q.read_jobs(client, 'test-consumer', count=1, block_ms=1000)
    print('Read:', jobs)
    if jobs:
        await q.ack_job(client, jobs[0][0])
    print('Acked OK')
    await client.aclose()

asyncio.run(test())
"
```
Expected output like:
```
Enqueued: 1718634000000-0
Read: [('1718634000000-0', {'job_id': '999'})]
Acked OK
```

---

### Task 4: RAG Service Extensions

**Files:**
- Modify: `backend/services/rag_service.py` (append after line 295)

**Interfaces:**
- Consumes: `os.getenv("GEMINI_API_KEY")`, `os.getenv("QDRANT_URL")`
- Produces:
  - `_chunk_resume(full_text: str, candidate_id: int) -> list[dict]` — returns `[{"field": str, "text": str}]`
  - `class RagIndexingService` with `async index_candidate(candidate_id: int, user_id: int, full_text: str) -> bool`
  - `class RagQueryService` with `async query_candidates(query: str, user_id: int, conversation_history: list) -> dict`

- [ ] **Step 1: Append to backend/services/rag_service.py**

Append this block after the last line (295) of `rag_service.py`:

```python

# ─────────────────────────────────────────────
# RAG: Vector indexing + querying for resumes
# ─────────────────────────────────────────────
import asyncio
import hashlib
import uuid as _uuid
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue

VECTOR_DIM = 768  # text-embedding-004
_qdrant: QdrantClient | None = None


def _get_qdrant() -> QdrantClient:
    global _qdrant
    if _qdrant is None:
        _qdrant = QdrantClient(url=os.getenv("QDRANT_URL", "http://localhost:6333"))
    return _qdrant


def _embed_text_sync(text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> list:
    import google.generativeai as genai
    genai.configure(api_key=os.getenv("GEMINI_API_KEY", ""))
    result = genai.embed_content(
        model="models/text-embedding-004",
        content=text,
        task_type=task_type
    )
    return result["embedding"]


async def _embed_text(text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> list:
    return await asyncio.to_thread(_embed_text_sync, text, task_type)


def _chunk_resume(full_text: str, candidate_id: int) -> list:
    """Split resume plain text into semantic section chunks."""
    chunks = []
    text = full_text.strip()
    if not text:
        return chunks

    # Full text anchor (capped at 3000 chars)
    chunks.append({"field": "full", "text": text[:3000]})

    # Header chunk (first 600 chars: name, contact, summary)
    if len(text) > 100:
        chunks.append({"field": "header", "text": text[:600]})

    # Section-based chunking
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
    COLLECTION_PREFIX = "resumes"

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
    async def index_candidate(candidate_id: int, user_id: int, full_text: str) -> bool:
        """Chunk, embed, and upsert a candidate's resume into Qdrant."""
        try:
            chunks = _chunk_resume(full_text, candidate_id)
            if not chunks:
                return False

            # Embed all chunks concurrently
            texts = [c["text"] for c in chunks]
            embeddings = await asyncio.gather(
                *[_embed_text(t, "RETRIEVAL_DOCUMENT") for t in texts]
            )

            collection_name = RagIndexingService._collection_name(user_id)
            client = _get_qdrant()
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
            print(f"[RAG] Indexed candidate {candidate_id} ({len(points)} chunks) into {collection_name}")
            return True
        except Exception as e:
            print(f"[RAG] Indexing failed for candidate {candidate_id}: {e}")
            return False


class RagQueryService:

    @staticmethod
    async def query_candidates(
        query_text: str,
        user_id: int,
        conversation_history: list | None = None
    ) -> dict:
        """Semantic search over candidate resumes, synthesize answer with Gemini."""
        collection_name = f"resumes_{user_id}"
        client = _get_qdrant()

        # Check collection exists
        existing = [c.name for c in (await asyncio.to_thread(client.get_collections)).collections]
        if collection_name not in existing:
            return {
                "answer": "No resumes have been indexed yet. Please screen some resumes first.",
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
                "answer": "No matching candidates found. Try a different query.",
                "sources_count": 0,
                "source_candidate_ids": []
            }

        # Build context
        context_parts = []
        source_ids = []
        for hit in search_results:
            payload = hit.payload or {}
            cid = payload.get("candidate_id")
            if cid and cid not in source_ids:
                source_ids.append(cid)
            context_parts.append(f"[Candidate {cid} — {payload.get('field', 'resume')}]\n{payload.get('text', '')}")
        context = "\n\n---\n\n".join(context_parts)

        # Build conversation history string (last 6 turns)
        history_str = ""
        if conversation_history:
            recent = conversation_history[-6:]
            for msg in recent:
                role = "HR" if msg.get("role") == "user" else "Assistant"
                history_str += f"{role}: {msg.get('content', '')}\n"

        prompt = f"""You are an AI hiring assistant. Answer the HR manager's question based ONLY on the resume context below.
Be specific — name candidates by their ID, highlight relevant skills and experience.
If the context doesn't contain enough information, say so clearly.

RESUME CONTEXT:
{context}

CONVERSATION HISTORY:
{history_str}

HR QUESTION: {query_text}

ANSWER:"""

        try:
            from . import gemini_client
            result = gemini_client.call_gemini_text(
                prompt=prompt,
                system_prompt="You are an expert AI hiring assistant with deep knowledge of technical skills. Answer concisely and reference specific candidates from the context.",
                temperature=0.3
            )
            answer = result
        except Exception as e:
            answer = f"Could not generate answer: {e}"

        return {
            "answer": answer,
            "sources_count": len(search_results),
            "source_candidate_ids": source_ids
        }
```

- [ ] **Step 2: Verify imports don't break**

```bash
cd backend
python -c "from services.rag_service import RagIndexingService, RagQueryService, _chunk_resume; print('RAG imports OK')"
```
Expected: `RAG imports OK`

- [ ] **Step 3: Test _chunk_resume with sample text**

```bash
cd backend
python -c "
from services.rag_service import _chunk_resume

sample = '''John Doe
john@example.com | +91 9876543210

SKILLS
Python, React, FastAPI, PostgreSQL, Docker

EXPERIENCE
Senior Developer at TechCorp (2021-2024)
Built REST APIs serving 1M+ requests/day

EDUCATION
B.Tech Computer Science, IIT Delhi 2020
'''

chunks = _chunk_resume(sample, candidate_id=1)
for c in chunks:
    print(f'  [{c[\"field\"]}] {len(c[\"text\"])} chars')
"
```
Expected output (order may vary):
```
  [full] 220 chars
  [header] 220 chars
  [skills] 44 chars
  [experience] 77 chars
  [education] 47 chars
```

---

### Task 5: Async Worker Process

**Files:**
- Create: `backend/worker.py`

**Interfaces:**
- Consumes: `queue.py` (all functions), `services.rag_service.{RAGService, RagIndexingService}`, `models.ScreeningJob`, `models.Candidate`, `database.SessionLocal`
- Consumes: `routers.resume.{normalize_role, get_keyword_score}` — **these must be module-level functions** (see Task 7 Step 1 first)

> **Important:** Complete Task 7 Step 1 (move `normalize_role` to module level) before running this worker.

- [ ] **Step 1: Create backend/worker.py**

```python
"""
Async resume screening worker.
Run with: python worker.py
"""
import asyncio
import os
import socket
import sys
from pathlib import Path
from dotenv import load_dotenv

# Ensure backend/ is on the path when running as a script
sys.path.insert(0, str(Path(__file__).parent))
load_dotenv()

import queue as q
from services.rag_service import RAGService, RagIndexingService

CONSUMER_NAME = os.getenv("WORKER_ID", socket.gethostname())
CONCURRENCY = int(os.getenv("WORKER_CONCURRENCY", "3"))
MAX_RETRIES = 3
RECLAIM_INTERVAL = 30


# ── DB helper (sync, runs in thread) ────────────────────────────────────────

def _get_job(job_id: int):
    from database import SessionLocal
    import models
    db = SessionLocal()
    try:
        return db.query(models.ScreeningJob).filter(models.ScreeningJob.id == job_id).first(), db
    except Exception:
        db.close()
        raise


def _do_screening(job_id: int) -> dict:
    """
    Full synchronous screening pipeline for one job.
    Returns result dict on success, raises on failure.
    """
    from database import SessionLocal
    import models
    from routers.resume import normalize_role, get_keyword_score

    db = SessionLocal()
    try:
        job = db.query(models.ScreeningJob).filter(models.ScreeningJob.id == job_id).first()
        if not job:
            raise ValueError(f"ScreeningJob {job_id} not found")

        job.status = "processing"
        db.commit()

        # 1. Extract text
        filename = job.filename
        file_path = job.file_path
        suffix = os.path.splitext(filename)[1].lower()
        if suffix in [".docx", ".doc"]:
            full_text = RAGService.extract_text_from_docx(file_path)
        else:
            full_text = RAGService.extract_text_from_pdf(file_path)

        candidate_info = RAGService.extract_candidate_info(full_text, filename)
        email = candidate_info.get("email")
        if not email:
            raise ValueError(f"No email found in {filename}")

        # 2. Keyword score
        keyword_score, matched_skills, missing_skills = get_keyword_score(full_text, job.jd_text)

        # 3. LLM screening
        analysis = RAGService.screen_resume(job.jd_text, f"job_{job_id}", full_text)
        score = analysis.get("score", keyword_score)

        # 4. Normalize role from JD first line
        jd_lines = [l.strip() for l in job.jd_text.split('\n') if l.strip()]
        raw_title = jd_lines[0][:100] if jd_lines else "General Candidate"
        role = normalize_role(raw_title)

        # 5. Upsert Candidate
        candidate = db.query(models.Candidate).filter(models.Candidate.email == email).first()
        if not candidate:
            candidate = models.Candidate(
                name=candidate_info.get("name", "Unknown"),
                email=email,
                phone=candidate_info.get("phone"),
                role=role,
                status=models.CandidateStatus.Applied,
                stage=models.CandidateStage.Resume_Screening,
                resume_file=filename,
                full_text=full_text,
                score=score,
                analysis_data=analysis,
                created_by=job.created_by
            )
            db.add(candidate)
        else:
            candidate.score = score
            candidate.analysis_data = analysis
            candidate.full_text = full_text
            candidate.role = role

        db.commit()
        db.refresh(candidate)

        # 6. Mark job completed
        job.status = "completed"
        job.candidate_id = candidate.id
        job.result = analysis
        db.commit()

        print(f"[Worker] ✓ Job {job_id} → Candidate {candidate.id} | Score: {score}")
        return {"candidate_id": candidate.id, "full_text": full_text, "user_id": job.created_by}

    except Exception as e:
        db.rollback()
        raise
    finally:
        db.close()


def _mark_failed(job_id: int, error: str, dead: bool = False) -> None:
    from database import SessionLocal
    import models
    db = SessionLocal()
    try:
        job = db.query(models.ScreeningJob).filter(models.ScreeningJob.id == job_id).first()
        if job:
            job.retry_count += 1
            job.error = error
            job.status = "dead" if dead else "failed"
            db.commit()
    finally:
        db.close()


# ── Async core ───────────────────────────────────────────────────────────────

async def _index_for_rag(candidate_id: int, user_id: int, full_text: str) -> None:
    try:
        await RagIndexingService.index_candidate(candidate_id, user_id, full_text)
    except Exception as e:
        print(f"[Worker] RAG indexing failed for candidate {candidate_id}: {e}")


async def process_one(msg_id: str, job_id: int, sem: asyncio.Semaphore, client) -> None:
    async with sem:
        try:
            result = await asyncio.to_thread(_do_screening, job_id)
            await q.ack_job(client, msg_id)
            # Fire-and-forget RAG indexing
            asyncio.create_task(
                _index_for_rag(result["candidate_id"], result["user_id"], result["full_text"])
            )
        except Exception as e:
            print(f"[Worker] ✗ Job {job_id} error: {e}")
            # Check retry count
            from database import SessionLocal
            import models as m
            db = SessionLocal()
            try:
                job = db.query(m.ScreeningJob).filter(m.ScreeningJob.id == job_id).first()
                retries = job.retry_count if job else 0
            finally:
                db.close()

            is_dead = retries >= MAX_RETRIES
            await asyncio.to_thread(_mark_failed, job_id, str(e), dead=is_dead)
            if is_dead:
                await q.ack_job(client, msg_id)  # Remove dead jobs from stream
                print(f"[Worker] Job {job_id} marked DEAD after {MAX_RETRIES} retries")


async def fetch_loop(sem: asyncio.Semaphore, client) -> None:
    print(f"[Worker] fetch_loop started (consumer: {CONSUMER_NAME})")
    while True:
        try:
            messages = await q.read_jobs(client, CONSUMER_NAME, count=CONCURRENCY, block_ms=5000)
            for msg_id, fields in messages:
                job_id = int(fields.get("job_id", 0))
                if job_id:
                    asyncio.create_task(process_one(msg_id, job_id, sem, client))
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[Worker] fetch_loop error: {e}")
            await asyncio.sleep(2)


async def reclaim_loop(sem: asyncio.Semaphore, client) -> None:
    print(f"[Worker] reclaim_loop started")
    while True:
        try:
            await asyncio.sleep(RECLAIM_INTERVAL)
            messages = await q.reclaim_stale_jobs(client, CONSUMER_NAME, count=CONCURRENCY)
            for msg_id, fields in messages:
                job_id = int(fields.get("job_id", 0))
                if job_id:
                    print(f"[Worker] Reclaiming stale job {job_id}")
                    asyncio.create_task(process_one(msg_id, job_id, sem, client))
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[Worker] reclaim_loop error: {e}")


async def main() -> None:
    client = await q.get_redis()
    await q.ensure_group(client)
    print(f"[Worker] Connected to Redis. Stream: {q.STREAM_KEY}, Group: {q.GROUP_NAME}")
    sem = asyncio.Semaphore(CONCURRENCY)
    await asyncio.gather(
        fetch_loop(sem, client),
        reclaim_loop(sem, client),
    )


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Verify worker starts without import errors**

```bash
cd backend
python -c "
import worker
print('worker.py imports OK')
"
```
Expected: `worker.py imports OK`

---

### Task 6: RAG Router + Register in main.py

**Files:**
- Create: `backend/routers/rag.py`
- Modify: `backend/main.py`

**Interfaces:**
- Produces: `POST /api/rag/query` accepting `{query, conversation_history?}`
- Produces: `GET /api/rag/status` health check

- [ ] **Step 1: Create backend/routers/rag.py**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import models, database
from routers.auth import get_current_user
from services.rag_service import RagQueryService

router = APIRouter(prefix="/api/rag", tags=["rag"])


class Message(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class QueryRequest(BaseModel):
    query: str
    conversation_history: Optional[list[Message]] = []


class QueryResponse(BaseModel):
    answer: str
    sources_count: int
    source_candidate_ids: list[int]


@router.post("/query", response_model=QueryResponse)
async def query_candidates(
    payload: QueryRequest,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    if not payload.query or not payload.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    history = [{"role": m.role, "content": m.content} for m in (payload.conversation_history or [])]

    result = await RagQueryService.query_candidates(
        query_text=payload.query.strip(),
        user_id=current_user.id,
        conversation_history=history
    )
    return result


@router.get("/status")
async def rag_status(current_user: models.User = Depends(get_current_user)):
    """Check if Qdrant is reachable and if the user has an index."""
    try:
        from qdrant_client import QdrantClient
        import os
        client = QdrantClient(url=os.getenv("QDRANT_URL", "http://localhost:6333"))
        collections = client.get_collections().collections
        user_collection = f"resumes_{current_user.id}"
        has_index = any(c.name == user_collection for c in collections)
        return {
            "qdrant_connected": True,
            "has_resume_index": has_index,
            "collection_name": user_collection
        }
    except Exception as e:
        return {"qdrant_connected": False, "error": str(e)}
```

- [ ] **Step 2: Register rag router in main.py**

In `backend/main.py`, add the import:
```python
from routers import auth, assessments, resume, dashboard, settings, interview, proctor, rag
```

And add after `app.include_router(proctor.router)`:
```python
app.include_router(rag.router)
```

- [ ] **Step 3: Verify API starts with rag router**

```bash
cd backend
uvicorn main:app --reload --port 8000 &
sleep 3
curl -s http://localhost:8000/openapi.json | python -c "
import json, sys
spec = json.load(sys.stdin)
paths = list(spec['paths'].keys())
rag_paths = [p for p in paths if '/rag' in p]
print('RAG endpoints:', rag_paths)
"
```
Expected: `RAG endpoints: ['/api/rag/query', '/api/rag/status']`

---

### Task 7: Async Screen Endpoint + Batch Poll

**Files:**
- Modify: `backend/routers/resume.py`

**Changes:**
1. Move `normalize_role` nested function to **module level** (line ~146 currently lives inside `screen_resume`)
2. Replace synchronous screening pipeline in `POST /screen/` with enqueue logic
3. Add `GET /screen/batch/{batch_id}` polling endpoint

**Interfaces:**
- `POST /api/resume/screen/` now returns `{batch_id: str, job_count: int, status: "queued"}`
- `GET /api/resume/screen/batch/{batch_id}` returns `{batch_id, total, completed, failed, pending, status, results: [...]}`
- `normalize_role(raw_title: str) -> str` is now importable at module level

- [ ] **Step 1: Move normalize_role to module level**

In `backend/routers/resume.py`, add this function at **module level** (after the `get_keyword_score` function, around line 50):

```python
def normalize_role(raw_title: str) -> str:
    """Normalize extracted job title to a canonical role name."""
    prefixes = [
        "we are looking for a", "we are looking for an", "we are looking for",
        "hiring for a", "hiring for an", "hiring for",
        "seeking candidates for a", "seeking candidates for", "seeking",
        "looking for a", "looking for"
    ]
    cleaned = raw_title.lower().strip()

    if any(k in cleaned for k in ["full stack", "fullstack", "mern", "mean"]):
        return "Full Stack Software Engineer"
    if any(k in cleaned for k in ["frontend", "front end", "react", "angular", "vue"]):
        return "Frontend Developer"
    if any(k in cleaned for k in ["backend", "back end", "node", "django", "fastapi", "java", "spring"]):
        return "Backend Developer"
    if any(k in cleaned for k in ["python", "machine learning", "ai", "data scientist"]):
        return "Python Developer"
    if any(k in cleaned for k in ["software engineer", "developer", "sde"]):
        return "Software Engineer"

    for prefix in prefixes:
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip()
            break

    noise_phrases = ["to join our development team", "and work on building", "remote", "(remote)", "urgent hiring"]
    for noise in noise_phrases:
        cleaned = cleaned.replace(noise, "")

    return cleaned.title().strip()
```

- [ ] **Step 2: Remove the nested normalize_role inside screen_resume**

In the `screen_resume` function (around line 146), delete the nested `def normalize_role(raw_title: str) -> str:` function block (lines ~146-180). The module-level one takes over.

- [ ] **Step 3: Replace the screen_resume endpoint body**

Replace the entire `@router.post("/screen/")` endpoint (lines 134-398) with:

```python
@router.post("/screen/")
async def screen_resume(
    files: List[UploadFile] = File(...),
    job_description: Optional[str] = Form(None),
    top_n: Optional[int] = Form(10),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    import uuid as _uuid
    import queue as redis_queue
    import asyncio

    if not job_description or not job_description.strip():
        raise HTTPException(status_code=400, detail="Job Description is required.")

    candidate_count = db.query(models.Candidate).count()
    MAX_CANDIDATES = 50
    if candidate_count >= MAX_CANDIDATES:
        return {"message": f"Candidate limit ({MAX_CANDIDATES}) reached.", "status": "limit_exceeded"}
    if candidate_count + len(files) > MAX_CANDIDATES:
        allowed = MAX_CANDIDATES - candidate_count
        return {"message": f"Upload exceeds limit. Allow {allowed} more.", "status": "limit_exceeded"}

    UPLOAD_DIR = "media/resumes"
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    batch_id = str(_uuid.uuid4())
    created_jobs = []

    for file in files:
        safe_filename = os.path.basename(file.filename)
        if not safe_filename.lower().endswith(('.pdf', '.docx', '.doc')):
            continue

        file_location = f"{UPLOAD_DIR}/{safe_filename}"
        with open(file_location, "wb+") as f:
            shutil.copyfileobj(file.file, f)

        job = models.ScreeningJob(
            batch_id=batch_id,
            filename=safe_filename,
            file_path=file_location,
            jd_text=job_description,
            top_n=top_n,
            status="pending",
            created_by=current_user.id
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        created_jobs.append(job.id)

    # Enqueue all jobs to Redis
    client = await redis_queue.get_redis()
    await redis_queue.ensure_group(client)
    for job_id in created_jobs:
        await redis_queue.enqueue_job(client, job_id)
    await client.aclose()

    return {
        "batch_id": batch_id,
        "job_count": len(created_jobs),
        "status": "queued",
        "message": f"{len(created_jobs)} resume(s) queued for processing."
    }
```

- [ ] **Step 4: Add batch polling endpoint**

Add this new endpoint after the `screen_resume` function:

```python
@router.get("/screen/batch/{batch_id}")
def get_batch_status(
    batch_id: str,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    jobs = db.query(models.ScreeningJob).filter(
        models.ScreeningJob.batch_id == batch_id,
        models.ScreeningJob.created_by == current_user.id
    ).all()

    if not jobs:
        raise HTTPException(status_code=404, detail="Batch not found.")

    total = len(jobs)
    completed = sum(1 for j in jobs if j.status == "completed")
    failed = sum(1 for j in jobs if j.status in ("failed", "dead"))
    pending = sum(1 for j in jobs if j.status in ("pending", "processing"))

    if completed + failed == total:
        batch_status = "completed"
    elif completed > 0:
        batch_status = "processing"
    else:
        batch_status = "queued"

    results = []
    for job in jobs:
        entry = {
            "job_id": job.id,
            "filename": job.filename,
            "status": job.status,
            "error": job.error,
            "analysis": job.result,
        }
        if job.candidate_id:
            candidate = db.query(models.Candidate).filter(
                models.Candidate.id == job.candidate_id
            ).first()
            if candidate:
                entry["candidate"] = {
                    "id": candidate.id,
                    "name": candidate.name,
                    "email": candidate.email,
                    "role": candidate.role,
                    "score": candidate.score,
                }
        results.append(entry)

    return {
        "batch_id": batch_id,
        "total": total,
        "completed": completed,
        "failed": failed,
        "pending": pending,
        "status": batch_status,
        "results": results
    }
```

- [ ] **Step 5: Verify backend starts and new routes exist**

```bash
cd backend
uvicorn main:app --reload --port 8000 &
sleep 3
curl -s http://localhost:8000/openapi.json | python -c "
import json, sys
spec = json.load(sys.stdin)
paths = [p for p in spec['paths'] if '/resume' in p]
print('Resume paths:', paths)
"
```
Expected to include: `/api/resume/screen/` and `/api/resume/screen/batch/{batch_id}`

---

### Task 8: Frontend — ResumeChat Page + Routing

**Files:**
- Create: `frontend/src/pages/ResumeChat.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/GlobalNavbar.jsx`

**Interfaces:**
- Consumes: `POST /api/rag/query` — `{query, conversation_history}` → `{answer, sources_count, source_candidate_ids}`
- Consumes: `GET /api/rag/status` — returns `{qdrant_connected, has_resume_index}`
- Produces: `/resume-chat` route, visible in navbar as "AI Search"

- [ ] **Step 1: Create frontend/src/pages/ResumeChat.jsx**

```jsx
import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Sparkles, AlertCircle, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import API_URL from '../apiConfig';

const SUGGESTION_PILLS = [
    "Find candidates with React and TypeScript skills",
    "Who has 5+ years of backend experience?",
    "Top scored candidates this batch",
    "Candidates missing Python skills",
    "Show me full stack engineers",
    "Any candidates with AWS experience?",
];

const TypingIndicator = () => (
    <div className="flex items-center gap-1 p-3">
        {[0, 1, 2].map(i => (
            <motion.div
                key={i}
                className="w-2 h-2 bg-gray-400 rounded-full"
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
            />
        ))}
    </div>
);

const ChatMessage = ({ message }) => {
    const isUser = message.role === 'user';
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} mb-4`}
        >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                isUser ? 'bg-[#5d8c2c] text-white' : 'bg-gray-100 text-gray-600'
            }`}>
                {isUser ? <User size={16} /> : <Bot size={16} />}
            </div>
            <div className={`max-w-[75%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    isUser
                        ? 'bg-[#5d8c2c] text-white rounded-tr-sm'
                        : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'
                }`}>
                    {message.content}
                </div>
                {message.sources_count > 0 && (
                    <span className="text-xs text-gray-400 px-1">
                        {message.sources_count} resume{message.sources_count !== 1 ? 's' : ''} referenced
                    </span>
                )}
                <span className="text-xs text-gray-400 px-1">
                    {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>
        </motion.div>
    );
};

export default function ResumeChat() {
    const [messages, setMessages] = useState([
        {
            id: 'welcome',
            role: 'assistant',
            content: "Hi! I'm your AI hiring assistant. Ask me anything about the screened candidates — their skills, experience, scores, or how they compare against your job requirements.",
            timestamp: Date.now(),
            sources_count: 0,
        }
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [indexStatus, setIndexStatus] = useState(null);
    const bottomRef = useRef(null);
    const inputRef = useRef(null);
    const token = localStorage.getItem('token');

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    useEffect(() => {
        fetch(`${API_URL}/api/rag/status`, {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(r => r.json())
            .then(setIndexStatus)
            .catch(() => {});
    }, []);

    const sendMessage = async (text) => {
        const query = text || input.trim();
        if (!query || isTyping) return;
        setInput('');

        const userMsg = {
            id: Date.now().toString(),
            role: 'user',
            content: query,
            timestamp: Date.now(),
        };
        setMessages(prev => [...prev, userMsg]);
        setIsTyping(true);

        try {
            const history = messages
                .filter(m => m.id !== 'welcome')
                .slice(-6)
                .map(m => ({ role: m.role, content: m.content }));

            const res = await fetch(`${API_URL}/api/rag/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ query, conversation_history: history }),
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            setMessages(prev => [...prev, {
                id: Date.now().toString() + '_bot',
                role: 'assistant',
                content: data.answer,
                timestamp: Date.now(),
                sources_count: data.sources_count || 0,
                source_candidate_ids: data.source_candidate_ids || [],
            }]);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now().toString() + '_err',
                role: 'assistant',
                content: "Sorry, I couldn't process your query. Please check that Qdrant is running and resumes have been indexed.",
                timestamp: Date.now(),
                sources_count: 0,
            }]);
        } finally {
            setIsTyping(false);
            inputRef.current?.focus();
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-5rem)] max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-3 pb-4 border-b border-gray-200 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#5d8c2c] to-[#4a7a1f] flex items-center justify-center shadow-md">
                    <Sparkles className="text-white" size={20} />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-gray-900">AI Resume Search</h1>
                    <p className="text-sm text-gray-500">Query your screened candidate pool with natural language</p>
                </div>

                {indexStatus && (
                    <div className={`ml-auto flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full ${
                        indexStatus.has_resume_index
                            ? 'bg-green-50 text-green-700 border border-green-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${indexStatus.has_resume_index ? 'bg-green-500' : 'bg-amber-500'}`} />
                        {indexStatus.has_resume_index ? 'Index ready' : 'No index yet'}
                    </div>
                )}
            </div>

            {/* No index warning */}
            {indexStatus && !indexStatus.has_resume_index && (
                <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl mb-4 text-sm text-amber-800">
                    <AlertCircle size={16} className="flex-shrink-0" />
                    Screen some resumes first so I have candidates to search through.
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto pb-4">
                {messages.map(msg => (
                    <ChatMessage key={msg.id} message={msg} />
                ))}
                {isTyping && (
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                            <Bot size={16} className="text-gray-600" />
                        </div>
                        <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm shadow-sm">
                            <TypingIndicator />
                        </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Suggestion Pills */}
            {messages.length <= 1 && (
                <div className="flex flex-wrap gap-2 mb-4">
                    {SUGGESTION_PILLS.map(pill => (
                        <button
                            key={pill}
                            onClick={() => sendMessage(pill)}
                            className="text-xs font-medium px-3 py-1.5 bg-white border border-gray-200 rounded-full text-gray-600 hover:border-[#5d8c2c] hover:text-[#5d8c2c] transition-colors"
                        >
                            {pill}
                        </button>
                    ))}
                </div>
            )}

            {/* Input */}
            <div className="flex gap-3 items-end border-t border-gray-200 pt-4">
                <div className="flex-1 relative">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask about candidates, skills, experience..."
                        rows={1}
                        className="w-full px-4 py-3 pr-12 bg-white border border-gray-200 rounded-2xl text-sm text-gray-900 resize-none focus:outline-none focus:border-[#5d8c2c] focus:ring-2 focus:ring-[#5d8c2c]/10 transition-all"
                        style={{ maxHeight: '120px', overflowY: 'auto' }}
                    />
                </div>
                <button
                    onClick={() => sendMessage()}
                    disabled={!input.trim() || isTyping}
                    className="w-10 h-10 flex items-center justify-center bg-[#5d8c2c] text-white rounded-xl shadow-md hover:bg-[#4a7a1f] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                    {isTyping ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Add /resume-chat route to App.jsx**

In `frontend/src/App.jsx`, add the import at the top:
```jsx
import ResumeChat from './pages/ResumeChat';
```

Inside the `<Route element={<ClerkAdminGuard><DashboardLayout /></ClerkAdminGuard>}>` block, add:
```jsx
<Route path="/resume-chat" element={<ResumeChat />} />
```

- [ ] **Step 3: Add "AI Search" nav item to GlobalNavbar.jsx**

In `frontend/src/components/GlobalNavbar.jsx`, update the `navItems` array (line 123):

```jsx
import { Layout, Users, Shield, LogOut, Bell, UserCircle, FileSearch, UserCheck, SlidersHorizontal, Sparkles } from 'lucide-react';
```

Replace the `navItems` array:
```jsx
const navItems = [
    { path: '/resume-screening', label: 'Resume Screening', icon: FileSearch },
    { path: '/screened-candidates', label: 'Screened Candidates', icon: UserCheck },
    { path: '/resume-chat', label: 'AI Search', icon: Sparkles },
    { path: '/settings', label: 'Settings', icon: SlidersHorizontal },
];
```

- [ ] **Step 4: Verify frontend builds**

```bash
cd frontend
npm run build 2>&1 | tail -5
```
Expected: no TypeScript/import errors, ends with `built in X.XXs`

---

### Task 9: Docker Compose

**Files:**
- Create: `docker-compose.yml` at `hiringAI-2/`

**Services:** `db` (MySQL 8), `redis` (Redis 7), `qdrant`, `backend` (FastAPI), `worker` (python worker.py), `frontend` (Vite dev server)

**Interfaces:**
- Backend reachable at `http://localhost:8000`
- Frontend reachable at `http://localhost:5173`
- Redis at `localhost:6379`
- Qdrant UI at `http://localhost:6333/dashboard`

- [ ] **Step 1: Create hiringAI-2/docker-compose.yml**

```yaml
version: "3.9"

services:
  db:
    image: mysql:8.0
    container_name: hiringai-db
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: hiringai
      MYSQL_ROOT_HOST: "%"
    ports:
      - "3306:3306"
    volumes:
      - db_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-proot"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: hiringai-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  qdrant:
    image: qdrant/qdrant:latest
    container_name: hiringai-qdrant
    restart: unless-stopped
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile.backend
    container_name: hiringai-backend
    restart: unless-stopped
    ports:
      - "8000:8000"
    env_file:
      - ./backend/.env
    environment:
      DB_HOST: db
      REDIS_URL: redis://redis:6379/0
      QDRANT_URL: http://qdrant:6333
    volumes:
      - ./backend:/app
      - resume_media:/app/media
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
      qdrant:
        condition: service_started
    command: uvicorn main:app --host 0.0.0.0 --port 8000 --reload

  worker:
    build:
      context: ./backend
      dockerfile: Dockerfile.backend
    container_name: hiringai-worker
    restart: unless-stopped
    env_file:
      - ./backend/.env
    environment:
      DB_HOST: db
      REDIS_URL: redis://redis:6379/0
      QDRANT_URL: http://qdrant:6333
      WORKER_ID: worker-1
      WORKER_CONCURRENCY: "3"
    volumes:
      - ./backend:/app
      - resume_media:/app/media
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
      qdrant:
        condition: service_started
    command: python worker.py

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.frontend
    container_name: hiringai-frontend
    restart: unless-stopped
    ports:
      - "5173:5173"
    environment:
      VITE_API_URL: http://localhost:8000
    volumes:
      - ./frontend:/app
      - /app/node_modules
    command: npm run dev -- --host 0.0.0.0

volumes:
  db_data:
  qdrant_data:
  resume_media:
```

- [ ] **Step 2: Create backend/Dockerfile.backend**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    gcc \
    default-libmysqlclient-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
```

- [ ] **Step 3: Create frontend/Dockerfile.frontend**

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173
```

- [ ] **Step 4: Ensure frontend apiConfig resolves correctly in Docker**

Check `frontend/src/apiConfig.js` (or wherever `API_URL` is defined). If it uses a hardcoded localhost, add a Docker-aware fallback. The file should read:

```js
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
export default API_URL;
```

- [ ] **Step 5: Update backend .env for Docker DB connection**

The `.env` has `DB_HOST=127.0.0.1`. When running in Docker the backend uses `DB_HOST=db` (set via `environment` in compose). Verify `backend/database.py` reads from env:

```bash
grep -n "DB_HOST\|DB_USER\|DB_PASSWORD\|DB_NAME" backend/database.py
```

If it hardcodes values, update it to read from environment:
```python
import os
from dotenv import load_dotenv
load_dotenv()

DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "root")
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME", "hiringai")

DATABASE_URL = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
```

- [ ] **Step 6: Launch and verify full stack**

```bash
cd hiringAI-2
docker compose up --build -d
```

Wait ~30 seconds for all services to start, then:

```bash
# Backend health
curl -s http://localhost:8000/ | python -m json.tool

# Qdrant health
curl -s http://localhost:6333/healthz

# Redis health
docker exec hiringai-redis redis-cli ping

# Frontend
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

Expected:
```
{"message": "HiringAI Backend is running on FastAPI!"}
{"title":"qdrant - ok"}
PONG
200
```

- [ ] **Step 7: End-to-end smoke test**

1. Open `http://localhost:5173` → login → navigate to Resume Screening
2. Upload 2 PDFs + paste a job description → click screen
3. Observe: response returns `{batch_id, job_count: 2, status: "queued"}` (check browser network tab)
4. Check worker logs: `docker logs hiringai-worker -f` — should show processing logs
5. Navigate to `http://localhost:5173/resume-chat`
6. Type: "Show me all candidates" → verify answer returns (may say "no index" if Qdrant indexing is still in progress, wait a few seconds)
7. Navigate to Qdrant dashboard `http://localhost:6333/dashboard` → confirm `resumes_{user_id}` collection exists with points

---

## Self-Review

**Spec coverage check:**
- ✅ RAG service with Qdrant vector indexing
- ✅ Resume chatbot UI (`/resume-chat` page)
- ✅ Redis consumer/worker architecture (dual-loop: fetch + reclaim)
- ✅ Docker Compose with all 6 services
- ✅ Async screen endpoint returning batch_id
- ✅ Batch status polling endpoint
- ✅ Resume chunking strategy (_chunk_resume)
- ✅ Embeddings via google.generativeai (text-embedding-004, 768 dims)
- ✅ Worker handles retries (MAX_RETRIES=3, dead-letter)
- ✅ Stale job reclaim every 30s
- ✅ normalize_role moved to module level for worker import
- ✅ Nav item added for AI Search
- ✅ Conversation history support in chatbot (last 6 turns)

**Potential issues to watch:**
- `database.py` may hardcode connection string — Task 9 Step 5 checks this
- `google.generativeai.embed_content` is sync; wrapped in `asyncio.to_thread` throughout
- `xautoclaim` requires Redis >= 6.2; the compose uses `redis:7-alpine` which satisfies this
- Worker imports `from routers.resume import normalize_role` — Task 7 Step 1 must run BEFORE Task 5 is tested
