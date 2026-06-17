"""
Async resume screening worker.
Run with: python -u worker.py
"""
import asyncio
import os
import re
import socket
import sys
import traceback
from pathlib import Path
from dotenv import load_dotenv

# Ensure backend/ is on the path when running as a script
sys.path.insert(0, str(Path(__file__).parent))
load_dotenv()


def log(msg: str) -> None:
    print(msg, flush=True)


import redis_queue
from services.rag_service import RAGService, RagIndexingService

CONSUMER_NAME = os.getenv("WORKER_ID", socket.gethostname())
CONCURRENCY = int(os.getenv("WORKER_CONCURRENCY", "3"))
MAX_RETRIES = 3
RECLAIM_INTERVAL = 30


# ── Sync DB operations (run via asyncio.to_thread) ──────────────────────────

def _do_screening(job_id: int) -> dict:
    """
    Full synchronous screening pipeline for one ScreeningJob.
    Returns {candidate_id, full_text, user_id} on success, raises on failure.
    """
    from database import SessionLocal
    import models
    from routers.resume import normalize_role, get_keyword_score

    db = SessionLocal()
    try:
        job = db.query(models.ScreeningJob).filter(models.ScreeningJob.id == job_id).first()
        if not job:
            raise ValueError(f"ScreeningJob {job_id} not found in DB")

        log(f"[Worker] Job {job_id} → processing: {job.filename}")
        job.status = "processing"
        db.commit()

        # 1. Extract text from the saved file
        filename = job.filename
        file_path = job.file_path
        suffix = os.path.splitext(filename)[1].lower()
        log(f"[Worker] Job {job_id} → extracting text from {suffix} file")
        if suffix in [".docx", ".doc"]:
            full_text = RAGService.extract_text_from_docx(file_path)
        else:
            full_text = RAGService.extract_text_from_pdf(file_path)

        log(f"[Worker] Job {job_id} → extracted {len(full_text)} chars")

        # 2. Keyword score (fast regex-based, no LLM)
        keyword_score, matched_skills, missing_skills = get_keyword_score(full_text, job.jd_text)
        log(f"[Worker] Job {job_id} → keyword score: {keyword_score} | matched: {matched_skills[:5]}")

        # 3. SINGLE Gemini call: extract contact info + deep screening in one prompt
        log(f"[Worker] Job {job_id} → calling Gemini (single merged call)...")
        weights = RAGService._get_scoring_weights()
        merged = RAGService.screen_and_extract(job.jd_text, full_text, weights)

        # Split merged result into contact info and analysis
        candidate_info = {
            "name": merged.get("name") or "Unknown Candidate",
            "email": merged.get("email"),
            "phone": RAGService._clean_phone(merged.get("phone")),
        }
        analysis = {
            "score":            merged.get("score", keyword_score),
            "component_scores": merged.get("component_scores", {}),
            "key_skills_match": merged.get("key_skills_match", []),
            "missing_skills":   merged.get("missing_skills", []),
            "reasoning":        merged.get("reasoning", ""),
            "extracted_role":   merged.get("extracted_role", ""),
        }

        # Filename fallback for name
        if candidate_info["name"] in ("Unknown Candidate", "Unknown", None, "Null"):
            base = os.path.splitext(filename)[0]
            clean_name = re.sub(r'\bresume\b|\bcv\b|\bprofile\b', '',
                                base.replace("_", " ").replace("-", " ").title(),
                                flags=re.IGNORECASE).strip()
            if clean_name:
                candidate_info["name"] = clean_name

        email = candidate_info.get("email")
        if not email:
            raise ValueError(f"Could not extract email from {filename}")
        log(f"[Worker] Job {job_id} → email: {email} | LLM score: {analysis['score']}")

        # 4. Normalize role from first line of JD
        jd_lines = [l.strip() for l in job.jd_text.split('\n') if l.strip()]
        raw_title = jd_lines[0][:100] if jd_lines else "General Candidate"
        role = normalize_role(raw_title)

        # 5. Upsert Candidate in DB
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
                score=analysis["score"],
                analysis_data=analysis,
                created_by=job.created_by
            )
            db.add(candidate)
        else:
            candidate.score = analysis["score"]
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

        log(f"[Worker] ✓ Job {job_id} → Candidate {candidate.id} ({candidate.name}) | Score: {analysis['score']} | user_id={job.created_by}")
        return {
            "candidate_id": candidate.id,
            "full_text": full_text,
            "user_id": job.created_by
        }

    except Exception:
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
            job.retry_count = (job.retry_count or 0) + 1
            job.error = error[:500]
            job.status = "dead" if dead else "failed"
            db.commit()
    finally:
        db.close()


def _get_retry_count(job_id: int) -> int:
    from database import SessionLocal
    import models
    db = SessionLocal()
    try:
        job = db.query(models.ScreeningJob).filter(models.ScreeningJob.id == job_id).first()
        return job.retry_count if job else 0
    finally:
        db.close()


# ── Async core ───────────────────────────────────────────────────────────────

async def _index_for_rag(candidate_id: int, user_id: int, full_text: str) -> None:
    log(f"[RAG] Starting indexing for candidate {candidate_id} (user_id={user_id}) ...")
    try:
        success = await RagIndexingService.index_candidate(candidate_id, user_id, full_text)
        if success:
            log(f"[RAG] ✓ Candidate {candidate_id} indexed into collection resumes_{user_id}")
        else:
            log(f"[RAG] ✗ Candidate {candidate_id} indexing returned False (empty chunks?)")
    except Exception:
        log(f"[RAG] ✗ Indexing failed for candidate {candidate_id}:\n{traceback.format_exc()}")


async def process_one(
    msg_id: str,
    job_id: int,
    sem: asyncio.Semaphore,
    client
) -> None:
    async with sem:
        try:
            result = await asyncio.to_thread(_do_screening, job_id)
            await redis_queue.ack_job(client, msg_id)
            # Fire-and-forget RAG indexing (non-blocking)
            asyncio.create_task(
                _index_for_rag(result["candidate_id"], result["user_id"], result["full_text"])
            )
        except Exception:
            err = traceback.format_exc()
            log(f"[Worker] ✗ Job {job_id} failed:\n{err}")
            retries = await asyncio.to_thread(_get_retry_count, job_id)
            is_dead = retries >= MAX_RETRIES
            await asyncio.to_thread(_mark_failed, job_id, str(err)[:500], is_dead)
            if is_dead:
                await redis_queue.ack_job(client, msg_id)
                log(f"[Worker] Job {job_id} marked DEAD after {MAX_RETRIES} retries")


async def fetch_loop(sem: asyncio.Semaphore, client) -> None:
    log(f"[Worker] fetch_loop started (consumer: {CONSUMER_NAME})")
    while True:
        try:
            messages = await redis_queue.read_jobs(
                client, CONSUMER_NAME, count=CONCURRENCY, block_ms=5000
            )
            for msg_id, fields in messages:
                job_id = int(fields.get("job_id", 0))
                if job_id:
                    log(f"[Worker] Dispatching job {job_id} (msg: {msg_id})")
                    asyncio.create_task(process_one(msg_id, job_id, sem, client))
        except asyncio.CancelledError:
            break
        except Exception:
            log(f"[Worker] fetch_loop error:\n{traceback.format_exc()}")
            await asyncio.sleep(2)


async def reclaim_loop(sem: asyncio.Semaphore, client) -> None:
    log(f"[Worker] reclaim_loop started (interval: {RECLAIM_INTERVAL}s)")
    while True:
        try:
            await asyncio.sleep(RECLAIM_INTERVAL)
            messages = await redis_queue.reclaim_stale_jobs(
                client, CONSUMER_NAME, count=CONCURRENCY
            )
            for msg_id, fields in messages:
                job_id = int(fields.get("job_id", 0))
                if job_id:
                    log(f"[Worker] Reclaiming stale job {job_id}")
                    asyncio.create_task(process_one(msg_id, job_id, sem, client))
        except asyncio.CancelledError:
            break
        except Exception:
            log(f"[Worker] reclaim_loop error:\n{traceback.format_exc()}")


async def main() -> None:
    log(f"[Worker] Starting up ... QDRANT_URL={os.getenv('QDRANT_URL')} REDIS_URL={os.getenv('REDIS_URL')}")
    client = await redis_queue.get_redis()
    await redis_queue.ensure_group(client)
    log(f"[Worker] Connected | Stream: {redis_queue.STREAM_KEY} | Group: {redis_queue.GROUP_NAME}")
    log(f"[Worker] Concurrency: {CONCURRENCY} | Max retries: {MAX_RETRIES}")
    sem = asyncio.Semaphore(CONCURRENCY)
    await asyncio.gather(
        fetch_loop(sem, client),
        reclaim_loop(sem, client),
    )


if __name__ == "__main__":
    asyncio.run(main())
