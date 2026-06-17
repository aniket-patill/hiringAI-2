from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
import shutil
import os
from datetime import datetime, timedelta
import schemas, models, database
from services.rag_service import RAGService
from routers.auth import get_current_user

router = APIRouter(
    prefix="/api/resume",
    tags=["resume"]
)

import re

COMMON_SKILLS = [
    "python", "javascript", "typescript", "java", "c++", "c#", "ruby", "php", "go", "golang", "rust", "swift", "kotlin",
    "react", "angular", "vue", "nextjs", "node", "nodejs", "express", "django", "fastapi", "flask", "spring", "laravel",
    "sql", "mysql", "postgresql", "mongodb", "redis", "cassandra", "elasticsearch", "oracle",
    "aws", "azure", "gcp", "docker", "kubernetes", "jenkins", "git", "github", "gitlab", "terraform", "ansible",
    "machine learning", "deep learning", "nlp", "ai", "artificial intelligence", "data science", "pandas", "numpy", "tensorflow", "pytorch",
    "html", "css", "tailwind", "bootstrap", "graphql", "rest api", "microservices", "agile", "scrum", "devops"
]

def get_keyword_score(resume_text: str, jd_text: str):
    resume_text_lower = resume_text.lower()
    jd_text_lower = jd_text.lower()
    
    # Extract matching skills from JD
    required_skills = [skill for skill in COMMON_SKILLS if skill in jd_text_lower]
    if not required_skills:
        # Fallback: extract clean words from JD
        words = re.findall(r'\b\w{3,15}\b', jd_text_lower)
        stopwords = {'and', 'the', 'for', 'with', 'you', 'are', 'our', 'will', 'that', 'this', 'work', 'join', 'team', 'role', 'about', 'from', 'have', 'need', 'must'}
        required_skills = list(set(words) - stopwords)[:15]
        
    if not required_skills:
        return 0.0, [], []
        
    matched_skills = [skill for skill in required_skills if skill in resume_text_lower]
    missing_skills = [skill for skill in required_skills if skill not in resume_text_lower]
    
    score = (len(matched_skills) / len(required_skills)) * 100.0
    return round(score, 1), matched_skills, missing_skills

def normalize_role(raw_title: str) -> str:
    """Normalize a raw job title string to a canonical role name."""
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


def extract_single_resume(file_path: str, filename: str):
    try:
        suffix = os.path.splitext(filename)[1].lower()
        if suffix in [".docx", ".doc"]:
            full_text = RAGService.extract_text_from_docx(file_path)
        else:
            full_text = RAGService.extract_text_from_pdf(file_path)
        candidate_info = RAGService.extract_candidate_info(full_text, filename)
        return {
            "file": filename,
            "file_path": file_path,
            "status": "success",
            "candidate_info": candidate_info,
            "full_text": full_text
        }
    except Exception as e:
        print(f"Error extracting {filename}: {e}")
        return {
            "file": filename,
            "file_path": file_path,
            "status": "failed",
            "error": str(e),
            "candidate_info": {},
            "full_text": ""
        }

def _build_professional_summary(candidate_name: str, score: float, matched_skills: list, missing_skills: list, jd_title: str) -> str:
    """Generate a clean, professional candidate summary from keyword match data."""
    matched_count = len(matched_skills)
    missing_count = len(missing_skills)
    total_skills = matched_count + missing_count
    
    # Build strength description
    if matched_count > 0:
        top_skills = ", ".join(matched_skills[:5])
        strength_text = f"demonstrates proficiency in {top_skills}"
    else:
        strength_text = "shows limited alignment with the required technical stack"
    
    # Build overall assessment
    if score >= 70:
        verdict = f"{candidate_name} is a strong match for the {jd_title} role, with {matched_count} out of {total_skills} key skills aligned. The candidate {strength_text}, indicating solid technical readiness for this position."
    elif score >= 40:
        verdict = f"{candidate_name} shows moderate alignment for the {jd_title} role, matching {matched_count} of {total_skills} required skills. The candidate {strength_text}, but has gaps in {missing_count} areas that may require evaluation."
    else:
        verdict = f"{candidate_name} has limited alignment for the {jd_title} role, matching only {matched_count} of {total_skills} required skills. The candidate {strength_text}. Further review is recommended to assess transferable experience."
    
    # Add gap note if applicable
    if missing_count > 0 and missing_count <= 5:
        gap_text = ", ".join(missing_skills[:3])
        verdict += f" Key gaps include {gap_text}."
    
    return verdict

def run_llm_screening(candidate_data: dict, job_description: str, jd_title: str):
    candidate_name = candidate_data['candidate_info'].get('name', candidate_data['file'])
    print(f"   [LLM Start] Running Groq screening for {candidate_name}...")
    try:
        analysis = RAGService.screen_resume(job_description, f"temp_{candidate_data['file']}", candidate_data["full_text"])
        candidate_data["analysis"] = analysis
        candidate_data["score"] = analysis.get("score", 0)
        candidate_data["reasoning"] = analysis.get("reasoning", "N/A")
        candidate_data["status"] = "success"
        print(f"   [LLM Success] Completed Groq screening for {candidate_name} | AI Score: {candidate_data['score']}%")
    except Exception as e:
        print(f"   [LLM Error] Groq screening failed for {candidate_name} due to: {e}. Falling back to Stage 1 keyword score.")
        score = candidate_data["keyword_score"]
        matched = candidate_data["matched_skills"]
        missing = candidate_data["missing_skills"]
        reasoning = _build_professional_summary(candidate_name, score, matched, missing, jd_title)
        
        candidate_data["score"] = score
        candidate_data["reasoning"] = reasoning
        candidate_data["analysis"] = {
            "score": score,
            "extracted_role": jd_title,
            "reasoning": reasoning,
            "key_skills_match": matched,
            "missing_skills": missing
        }
        candidate_data["status"] = "success"
    return candidate_data

@router.post("/screen/")
async def screen_resume(
    files: List[UploadFile] = File(...),
    job_description: Optional[str] = Form(None),
    top_n: Optional[int] = Form(10),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    import uuid as _uuid
    import redis_queue

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
    created_job_ids = []
    skipped = []

    for file in files:
        safe_filename = os.path.basename(file.filename)
        if not safe_filename.lower().endswith(('.pdf', '.docx', '.doc')):
            skipped.append({"file": safe_filename, "error": "Unsupported format."})
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
        created_job_ids.append(job.id)

    if not created_job_ids:
        raise HTTPException(status_code=400, detail="No valid resume files uploaded.")

    # Enqueue all jobs to Redis
    client = await redis_queue.get_redis()
    await redis_queue.ensure_group(client)
    for job_id in created_job_ids:
        await redis_queue.enqueue_job(client, job_id)
    await client.aclose()

    print(f"[Screen] Batch {batch_id}: {len(created_job_ids)} jobs queued")
    return {
        "batch_id": batch_id,
        "job_count": len(created_job_ids),
        "skipped": skipped,
        "status": "queued",
        "message": f"{len(created_job_ids)} resume(s) queued for processing."
    }


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
    elif completed > 0 or failed > 0:
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

@router.post("/candidates/", response_model=schemas.CandidateResponse)
def create_candidate_manual(
    candidate_in: schemas.CandidateCreate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Check if candidate already exists
    existing = db.query(models.Candidate).filter(models.Candidate.email == candidate_in.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Candidate with this email already exists.")
    
    new_candidate = models.Candidate(
        name=candidate_in.name,
        email=candidate_in.email,
        role=candidate_in.role,
        stage=candidate_in.stage,
        status=candidate_in.status,
        score=0.0,
        analysis_data={"reasoning": "Manually added candidate."},
        created_by=current_user.id
    )
    
    db.add(new_candidate)
    db.commit()
    db.refresh(new_candidate)
    
    # Log activity
    log = models.ActivityLog(
        user_id=current_user.id,
        action="manually added",
        target=new_candidate.name,
        details=f"Role: {new_candidate.role}"
    )
    db.add(log)
    db.commit()
    
    return new_candidate

@router.get("/candidates/", response_model=List[schemas.CandidateResponse])
def get_candidates(
    stage: Optional[str] = None,
    status: Optional[str] = None,
    role: Optional[str] = None,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    query = db.query(models.Candidate).filter(models.Candidate.created_by == current_user.id)
    if stage:
        query = query.filter(models.Candidate.stage == stage)
    if status:
        query = query.filter(models.Candidate.status == status)
    if role:
        query = query.filter(models.Candidate.role == role)
        
    return query.order_by(models.Candidate.created_at.desc()).all()

@router.get("/active-roles/", response_model=List[str])
def get_active_roles(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Fetch distinct, non-null job roles from candidates belonging to the current user.
    """
    roles = db.query(models.Candidate.role).distinct().filter(
        models.Candidate.created_by == current_user.id,
        models.Candidate.role != None,
        models.Candidate.role != ""
    ).all()
    return sorted([r[0] for r in roles if r[0]])
def update_candidate(
    candidate_id: int,
    update_data: schemas.CandidateUpdate,
    db: Session = Depends(database.get_db)
):
    candidate = db.query(models.Candidate).filter(models.Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    if update_data.stage:
        candidate.stage = update_data.stage
    if update_data.status:
        candidate.status = update_data.status
        
    db.commit()
    db.refresh(candidate)
    
    # Log the action
    log = models.ActivityLog(
        user_id=1,
        action="promoted",
        target=candidate.name,
        details=f"Moved to {candidate.stage}"
    )
    db.add(log)
    db.commit()
    
    return candidate

@router.delete("/candidates/{candidate_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_candidate(
    candidate_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    candidate = db.query(models.Candidate).filter(
        models.Candidate.id == candidate_id,
        models.Candidate.created_by == current_user.id
    ).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
        
    db.delete(candidate)
    db.commit()
    
    return None

@router.post("/candidates/bulk-update/", response_model=Dict[str, Any])
def bulk_update_candidates(
    payload: schemas.BulkCandidateUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    candidates = db.query(models.Candidate).filter(
        models.Candidate.id.in_(payload.candidate_ids),
        models.Candidate.created_by == current_user.id
    ).all()
    
    if not candidates:
        raise HTTPException(status_code=404, detail="No candidates found with provided IDs")
    
    updated_count = 0
    email_sent_count = 0
    
    # STAGE MAPPING
    STAGE_MAPPING = {
        "Resume Screening": models.CandidateStage.Resume_Screening.value,
        "Aptitude Round": models.CandidateStage.Aptitude_Round.value,
        "Coding Round": models.CandidateStage.Coding_Round.value,
        "Technical Interview": models.CandidateStage.Technical_Interview.value,
        "HR Round": models.CandidateStage.HR_Round.value,
        "Offer Sent": models.CandidateStage.Offer_Sent.value
    }
    
    # NEXT STAGE ENFORCEMENT
    VALID_NEXT = {
        models.CandidateStage.Resume_Screening.value: [models.CandidateStage.Aptitude_Round.value],
        models.CandidateStage.Aptitude_Round.value: [models.CandidateStage.Coding_Round.value],
        models.CandidateStage.Coding_Round.value: [models.CandidateStage.Technical_Interview.value],
        models.CandidateStage.Technical_Interview.value: [models.CandidateStage.Offer_Sent.value, models.CandidateStage.HR_Round.value],
        models.CandidateStage.HR_Round.value: [models.CandidateStage.Offer_Sent.value]
    }
    
    target_stage_fixed = STAGE_MAPPING.get(payload.stage, payload.stage) if payload.stage and payload.stage != 'NEXT' else None

    for candidate in candidates:
        has_changed = False
        
        # Determine target stage for this candidate
        current_target = None
        if payload.stage == 'NEXT':
            allowed_next = VALID_NEXT.get(candidate.stage, [])
            if allowed_next:
                current_target = allowed_next[0] # Pick the primary next stage
        else:
            current_target = target_stage_fixed

        # 1. Stage Update (STRICT)
        if current_target and candidate.stage != current_target: 
            # Check if valid next step (if not 'NEXT' mode, validate manually provided stage)
            if payload.stage != 'NEXT':
                # ALLOW ADMIN OVERRIDE: If admin explicitly selects a stage, allow it.
                # We only enforce strict sequence for 'NEXT' (auto-promote).
                pass
            else:
                # For 'NEXT' auto-promote, ensure we have a valid path
                allowed_next = VALID_NEXT.get(candidate.stage, [])
                if not allowed_next:
                     # If no defined next stage, do nothing or error? 
                     # For bulk 'NEXT', we just skip if no path.
                     continue 
                current_target = allowed_next[0]

            old_stage = candidate.stage
            candidate.stage = current_target
            
            # Reset results for any NEW assessment round
            assessment_stages = [
                models.CandidateStage.Aptitude_Round.value, 
                models.CandidateStage.Coding_Round.value,
                models.CandidateStage.Technical_Interview.value
            ]
            if current_target in assessment_stages:
                candidate.score = 0.0
                candidate.status = models.CandidateStatus.Applied
                # Clear round-specific analysis but keep reasoning if possible
                if candidate.analysis_data:
                    new_data = {k: v for k, v in candidate.analysis_data.items() if k in ['reasoning', 'extracted_role', 'sentiment']}
                    candidate.analysis_data = new_data
            
            has_changed = True
            log = models.ActivityLog(user_id=1, action="promoted (bulk)", target=candidate.name, details=f"Moved from {old_stage} to {candidate.stage}")
            db.add(log)

        # 2. Status Update
        if payload.status and candidate.status != payload.status:
            candidate.status = payload.status
            has_changed = True
            
        # Trigger Offer Email if the status is "Offer Released" or stage becomes "Offer Sent"
        if payload.status == "Offer Released" or current_target == models.CandidateStage.Offer_Sent.value:
            candidate.stage = models.CandidateStage.Offer_Sent.value # Update stage so they leave the interview round
            candidate.status = "Offer Released"
            has_changed = True
            try:
                import utils
                from services import email_templates
                subject = "Congratulations! Your Offer is Ready"
                html = email_templates.get_offer_email_template(candidate.name, candidate.role or "Software Engineer")
                print(f"Attempting to send offer to: {candidate.email}")
                if utils.send_email(candidate.email, subject, html):
                    email_sent_count += 1
            except Exception as e:
                print(f"Failed to send offer email to {candidate.email}: {e}")

        if has_changed:
            updated_count += 1
        
    db.commit()
    
    msg = f"Successfully updated {updated_count} candidate(s)."
    if email_sent_count > 0:
        msg += f" {email_sent_count} offer email(s) sent."
    
    return {
        "message": msg,
        "count": updated_count
    }

@router.get("/stats/", response_model=schemas.StatsResponse)
def get_stats(
    days: Optional[str] = None,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    query = db.query(models.Candidate).filter(models.Candidate.created_by == current_user.id)
    
    if days and days != 'all':
        try:
            d = int(days)
            start_date = datetime.utcnow() - timedelta(days=d)
            query = query.filter(models.Candidate.created_at >= start_date)
        except ValueError:
            pass

    candidates = query.all()
    
    total = len(candidates)
    active = sum(1 for c in candidates if c.status != "Rejected")
    screened = total
    # Count as assessments only if they are not in Applied status (meaning they are assigned/in-progress/completed)
    assessments = sum(1 for c in candidates if c.stage in ["Aptitude Round", "Coding Round", "Technical Interview"] and c.status != "Applied")
    # Count as offers if status is Hired/Offer Released or stage is Offer Sent
    offers = sum(1 for c in candidates if c.status in ["Hired", "Offer Released"] or c.stage == "Offer Sent")
    
    qualified = sum(1 for c in candidates if c.status != "Rejected" and c.stage != "Resume Screening")
    coding_passed = sum(1 for c in candidates if c.stage in ["Technical Interview", "Offer Sent", "HR Round"])
    interview_cleared = offers # Approx logic
    
    return {
        "metrics": {
            "active": active,
            "screened": screened,
            "assessments": assessments,
            "offers": offers
        },
        "funnel": {
            "applications": total,
            "qualified": qualified,
            "coding_passed": coding_passed,
            "interview_cleared": interview_cleared
        }
    }

@router.post("/rescreen-unscored/")
def rescreen_unscored_candidates(
    payload: dict,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Re-run AI screening for candidates whose score is 0 and analysis_data is empty.
    Uses the saved resume file on disk + the provided job_description.
    """
    job_description = payload.get("job_description", "")
    if not job_description or not job_description.strip():
        raise HTTPException(status_code=400, detail="Job description is required.")

    # Find candidates owned by this user with no score and no analysis
    unscored = db.query(models.Candidate).filter(
        models.Candidate.created_by == current_user.id,
        models.Candidate.score == 0.0,
        models.Candidate.analysis_data == None
    ).all()

    if not unscored:
        return {"message": "All candidates already have scores.", "rescreened": 0}

    # Extract JD title
    jd_lines = [l.strip() for l in job_description.split('\n') if l.strip()]
    raw_title = jd_lines[0][:100] if jd_lines else "General Candidate"
    # Simple normalize
    cleaned = raw_title.lower()
    if any(k in cleaned for k in ["full stack", "fullstack", "mern", "mean"]):
        jd_title = "Full Stack Software Engineer"
    elif any(k in cleaned for k in ["frontend", "front end", "react"]):
        jd_title = "Frontend Developer"
    elif any(k in cleaned for k in ["backend", "back end", "node", "django"]):
        jd_title = "Backend Developer"
    elif any(k in cleaned for k in ["python", "machine learning", "ai"]):
        jd_title = "Python Developer"
    else:
        jd_title = raw_title.title()

    rescreened_count = 0
    results = []

    for candidate in unscored:
        resume_path = candidate.resume_file
        full_text = candidate.full_text or ""

        # Compute keyword score from stored full_text
        keyword_score, matched_skills, missing_skills = get_keyword_score(full_text, job_description)

        # Try LLM screening
        try:
            analysis = RAGService.screen_resume(job_description, f"rescreen_{candidate.id}", full_text)
            score = analysis.get("score", keyword_score)
            reasoning = analysis.get("reasoning", "Re-screened via AI.")
            analysis_data = {
                "score": score,
                "extracted_role": jd_title,
                "reasoning": reasoning,
                "key_skills_match": analysis.get("key_skills_match", matched_skills),
                "missing_skills": analysis.get("missing_skills", missing_skills)
            }
        except Exception as e:
            # Fallback to keyword score
            score = keyword_score
            reasoning = f"AI unavailable. Score based on keyword matching: {keyword_score}%"
            analysis_data = {
                "score": keyword_score,
                "extracted_role": jd_title,
                "reasoning": reasoning,
                "key_skills_match": matched_skills,
                "missing_skills": missing_skills
            }

        # Update candidate record
        candidate.score = score
        candidate.analysis_data = analysis_data
        db.commit()
        rescreened_count += 1
        results.append({
            "name": candidate.name,
            "email": candidate.email,
            "score": score,
            "reasoning": reasoning
        })
        print(f"[Re-Screen] {candidate.name} | Score: {score}%")

    db.commit()
    return {
        "message": f"Re-screened {rescreened_count} candidate(s) successfully.",
        "rescreened": rescreened_count,
        "results": results
    }



# Extract Text from JD File
@router.post("/extract-text/")
async def extract_text_from_file(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user)
):
    import tempfile
    suffix = os.path.splitext(file.filename)[1].lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name
    try:
        if suffix == ".txt":
            with open(tmp_path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
        elif suffix == ".pdf":
            text = RAGService.extract_text_from_pdf(tmp_path)
        elif suffix in [".doc", ".docx"]:
            text = RAGService.extract_text_from_docx(tmp_path)
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type.")
        return {"text": text.strip(), "filename": file.filename}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")
    finally:
        os.unlink(tmp_path)


@router.delete("/reset-screened/", status_code=status.HTTP_200_OK)
def reset_screened_candidates(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Reset (delete) all candidates in the 'Resume Screening' stage for the current user.
    Also clears associated screening jobs and deletes their Qdrant search collection.
    """
    try:
        # 1. Clear candidate_id from screening jobs first to avoid foreign key constraints
        db.query(models.ScreeningJob).filter(
            models.ScreeningJob.created_by == current_user.id
        ).update({models.ScreeningJob.candidate_id: None})
        db.commit()

        # 2. Delete all screening jobs created by this user
        db.query(models.ScreeningJob).filter(
            models.ScreeningJob.created_by == current_user.id
        ).delete(synchronize_session=False)

        # 3. Delete candidates in the "Resume Screening" stage
        deleted_count = db.query(models.Candidate).filter(
            models.Candidate.stage == models.CandidateStage.Resume_Screening.value,
            models.Candidate.created_by == current_user.id
        ).delete(synchronize_session=False)
        
        db.commit()

        # 4. Delete the Qdrant vector index collection for this user
        from services.rag_service import RagIndexingService
        RagIndexingService.delete_collection(current_user.id)

        # 5. Log the reset activity
        log = models.ActivityLog(
            user_id=current_user.id,
            action="reset screened candidates",
            target="all",
            details=f"Deleted {deleted_count} candidate(s)"
        )
        db.add(log)
        db.commit()

        return {"message": f"Successfully reset {deleted_count} screened candidates and cleared all history.", "deleted_count": deleted_count}
    except Exception as e:
        db.rollback()
        import traceback
        print(f"Error resetting screened candidates: {e}\n{traceback.format_exc()}", flush=True)
        raise HTTPException(status_code=500, detail=f"Failed to reset candidates: {str(e)}")

