from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from typing import List, Optional
import string
import random
import os
import copy
from datetime import datetime
import schemas, models, utils, database
from .auth import get_current_user
from services import ai_generator, email_templates, piston_service

router = APIRouter(
    prefix="/api/assessments",
    tags=["assessments"]
)

@router.post("/assign/", response_model=schemas.AssignResponse)
def assign_assessment(
    request: schemas.AssessmentCreateRequest,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Admin sends list of candidates
    candidate_list = request.candidates
    round_type = request.type
    config = request.config
    deadline = request.deadline
    
    # --- PRE-GENERATE QUESTIONS (Optimization) ---
    # Generate ONCE per batch assignment to save time and ensure consistency
    try:
        # Skip generation for Interview type (VAPI handles it dynamically)
        if round_type != "interview" and not config.get("generated_questions"):
            generated_qs = ai_generator.generate_questions(round_type, config)
            if generated_qs:
                config["generated_questions"] = generated_qs
            else:
                raise HTTPException(status_code=500, detail="AI failed to generate questions. Please try again.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Generation Error: {str(e)}")
    # ---------------------------------------------
    
    email_errors = []
    assigned_count = 0

    for candidate_entry in candidate_list:
        email = candidate_entry.get('email')
        if not email:
            continue
        
        
        # 1. Get or Create Candidate Record
        candidate = db.query(models.Candidate).filter(models.Candidate.email == email).first()
        if not candidate:
            candidate = models.Candidate(
                name=candidate_entry.get('name', 'Candidate'),
                email=email,
                section="Imports", # Placeholder
                stage=round_type,
                status=models.CandidateStatus.Applied,
                created_by=current_user.id
            )
            db.add(candidate)
            db.flush() # Get ID
            db.refresh(candidate)

        # 2. Update Candidate Creds (Separate from Admin User)
        plain_password = ''.join(random.choices(string.ascii_letters + string.digits, k=10))
        hashed = utils.get_password_hash(plain_password)
        candidate.hashed_password = hashed
        candidate.is_active = True
        
        password_display = plain_password

        # 3. Create Shadow User for Auth Session
        # This ensures get_current_user works without conflicting with Admin's real User account
        shadow_email = f"candidate_{candidate.id}@hiringai.internal"
        shadow_user = db.query(models.User).filter(models.User.email == shadow_email).first()
        
        if not shadow_user:
            shadow_user = models.User(
                email=shadow_email,
                hashed_password=hashed,
                role=models.UserRole.CANDIDATE.value, # Fix: Use .value
                is_active=True
            )
            db.add(shadow_user)
        else:
            shadow_user.hashed_password = hashed
        
        db.flush() 
        db.refresh(shadow_user)
        
        # User for assessment is SHADOW user
        user = shadow_user 


        # 1.5 Update Candidate Stage if they exist in Candidate table
        # This unifies "Promote" and "Assign Assessment"
        STAGE_MAPPING = {
            "aptitude": models.CandidateStage.Aptitude_Round,
            "coding": models.CandidateStage.Coding_Round,
            "interview": models.CandidateStage.Technical_Interview
        }
        
        target_stage = STAGE_MAPPING.get(round_type, models.CandidateStage.Resume_Screening)

        candidate_record = db.query(models.Candidate).filter(models.Candidate.email == email).first()
        if candidate_record:
            candidate_record.stage = target_stage
            candidate_record.created_by = current_user.id
            
            # Reset results for a fresh start in this stage
            candidate_record.status = models.CandidateStatus.In_Progress
            candidate_record.score = 0.0
            if candidate_record.analysis_data:
                # Keep screening reasoning but clear previous round data
                candidate_record.analysis_data = {k: v for k, v in candidate_record.analysis_data.items() if k in ['reasoning', 'extracted_role', 'sentiment']}
            
            # Log Promotion
            friendly_round = round_type.replace('_', ' ').title()
            log = models.ActivityLog(
                user_id=current_user.id, 
                action="invited",
                target=candidate_record.name,
                details=f"Invited to {friendly_round} Assessment"
            )
            db.add(log)

        # 2. Create Assessment (Use deepcopy to ensure isolation)
        assessment = models.Assessment(
            candidate_email=email,
            type=round_type,
            config=copy.deepcopy(config),
            status=models.AssessmentStatus.pending,
            user_id=user.id
        )
        db.add(assessment)
        
        # CRITICAL: Commit DB changes BEFORE sending email so login works immediately
        db.commit()
        
        # 3. Send Email with Magic Link (Secure)
        frontend_url = os.getenv("FRONTEND_URL", "http://127.0.0.1:5173")
        
        # FIX: Use Candidate's specific role if available, fallback to Config role, then 'Candidate'
        target_role = candidate_record.role if candidate_record and candidate_record.role else config.get('role', 'Candidate')
        
        subject = f"Action Required: {target_role} - {round_type.title()} Invitation"
        
        deadline_text = f"Deadline: {deadline}" if deadline else "Deadline: ASAP"
        
        # Generate Login Link (Manual Only)
        login_link = f"{frontend_url}/portal/login"
        


        html_body = email_templates.get_invitation_email_template(
            candidate_name=candidate_entry.get('name', 'Candidate'),
            role_title=target_role,
            round_type=round_type,
            login_url=login_link, # MANUAL LOGIN LINK
            deadline_text=deadline_text,
            instructions=config.get('description', None),
            password=password_display,
            email=email
        )
        sent = utils.send_email(email, subject, html_body)
        if not sent:
            email_errors.append(f"{email}: Failed to send email")
        
        assigned_count += 1
    
    # db.commit() - Moved inside loop


    msg = f"Successfully assigned {round_type} to {assigned_count} candidates."
    if email_errors:
        msg += f" WARNING: Email failed for {len(email_errors)} candidates."

    return schemas.AssignResponse(
        message=msg,
        status="success" if not email_errors else "warning",
        email_errors=email_errors
    )

@router.get("/my-pending/", response_model=List[schemas.AssessmentResponse])
def get_my_pending_assessments(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    assessments = db.query(models.Assessment).filter(
        models.Assessment.user_id == current_user.id,
        models.Assessment.status == models.AssessmentStatus.pending
    ).order_by(models.Assessment.created_at.desc()).all()
    
    return assessments

@router.get("/my-status/", response_model=Optional[schemas.AssessmentResponse])
def get_my_latest_assessment(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    try:
        # Fetch the most recent assessment for the user
        assessment = db.query(models.Assessment).filter(
            models.Assessment.user_id == current_user.id
        ).order_by(models.Assessment.created_at.desc()).first()
        
        if assessment:
            # Check if questions need to be generated (Lazy Generation)
            # Optimization: Skip for 'interview' as it uses VAPI dynamic generation
            if not assessment.config.get("generated_questions") and assessment.type != "interview":
                questions = ai_generator.generate_questions(assessment.type, assessment.config)
                
                if questions:
                    new_config = dict(assessment.config)
                    new_config["generated_questions"] = questions
                    assessment.config = new_config
                    
                    db.commit()
                    db.refresh(assessment)

        return assessment
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/start/{assessment_id}")
def start_assessment(
    assessment_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    assessment = db.query(models.Assessment).filter(
        models.Assessment.id == assessment_id,
        models.Assessment.user_id == current_user.id
    ).first()
    
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
        
    if assessment.status == models.AssessmentStatus.completed:
        raise HTTPException(status_code=400, detail="Assessment already completed")
        
    if not assessment.started_at:
        assessment.started_at = func.now()
        db.commit()
        db.refresh(assessment)
        
    return {"message": "Assessment started", "started_at": assessment.started_at}

@router.post("/execute/")
def execute_code(
    request: schemas.ExecutionRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    # 0. Load the Safe Configuration from DB (Security)
    assessment = db.query(models.Assessment).filter(
        models.Assessment.user_id == current_user.id
    ).order_by(models.Assessment.created_at.desc()).first()
    
    question_config = {}
    if assessment and assessment.config:
        generated_qs = assessment.config.get("generated_questions", [])
        # Find the question by ID if provided, or matching title
        target_q = None
        if request.questionId:
            target_q = next((q for q in generated_qs if q.get('id') == request.questionId), None)
        else:
            target_q = next((q for q in generated_qs if q.get('title') == request.question.get('title')), None)
            
        if target_q:
            question_config = target_q

    # 1. Generate Runner Code using Trusted Templates
    runner_code = ai_generator.generate_runner_code(
        request.code, 
        request.language, 
        request.testCases,
        question_config=question_config
    )
    

    
    if not runner_code:
        # Fallback to pure AI if wrapper fails (Safety Net)
        return ai_generator.evaluate_code(
            request.code, request.language, request.question, request.testCases
        )
        
    # 2. Execute on Piston
    piston_res = piston_service.execute_code(request.language, runner_code)

    
    # 3. Process Results (Strict Stream Parsing)
    if piston_res.get("status") == "success":
        raw_output = piston_res.get("output", "").strip()

        results = []
        
        # New Robust Parsing Strategy: Extract lines between Markers
        marker_start = "---EXECUTION_RESULT_START---"
        marker_end = "---EXECUTION_RESULT_END---"
        
        lines = raw_output.split('\n')
        parsing_started = False
        parsed_any = False
        
        import json
        for line in lines:
            line = line.strip()
            if not line: continue
            
            if marker_start in line:
                parsing_started = True
                continue
            if marker_end in line:
                parsing_started = False
                break
                
            if parsing_started:
                try:
                    # Line should be: {"id":..., "status":..., "output":..., "expected":...}
                    res_obj = json.loads(line)
                    
                    # Backend evaluation: Compare output vs expected
                    actual = res_obj.get('output')
                    expected = res_obj.get('expected')
                    
                    # Normalize comparison (Handle string vs original types)
                    # We try to parse expected as JSON if it's a string representation
                    exp_obj = expected
                    try:
                        if isinstance(expected, str):
                            # Try to parse if it looks like JSON structure
                            if expected.strip().startswith(('[', '{')):
                                exp_obj = json.loads(expected)
                    except:
                        pass
                        
                    # Compare actual value with expected object
                    # Also handle simple string comparisons for primitive types
                    is_pass = (actual == exp_obj) or (str(actual).strip() == str(expected).strip())
                    
                    # Find original input for display
                    tc_orig = next((t for t in request.testCases if t.get('id') == res_obj.get('id')), {})
                    
                    results.append({
                        "id": res_obj.get('id'),
                        "status": "passed" if is_pass else "failed",
                        "input": tc_orig.get('input', {}),
                        "output": str(actual),
                        "expected": str(expected)
                    })
                    parsed_any = True
                except Exception as e_line:
                    print(f"Failed to parse result line: {line} - {e_line}")

        if parsed_any:
            return {
                "syntax_valid": True,
                "results": results,
                "feedback": "Executed and verified successfully."
            }
        
        # Fallback Strategy: If no markers found, try to find any valid JSON array
        try:
             import re
             match = re.search(r'\[.*\]', raw_output, re.DOTALL)
             if match:
                 results = json.loads(match.group(0))
                 return {"syntax_valid": True, "results": results, "feedback": "Executed via fallback parsing"}
        except:
             pass
            
    # If we are here, Piston failed or Parsing failed
    analysis = ai_generator.analyze_error(request.code, piston_res.get("output", ""))

    error_type = "compilation_error"
    if piston_res.get("status") == "service_error":
        error_type = "service_error"
    elif piston_res.get("status") == "failed":
        error_type = "runtime_error"
    
    return {
        "syntax_valid": False,
        "error_message": piston_res.get("output", "Execution Failed"),
        "error_type": error_type,
        "results": [],
        "feedback": analysis
    }

def send_completion_emails(candidate_email: str, candidate_name: str, target_role: str, assessment_type: str, friendly_type: str, score_detail: str, created_by_id: Optional[int]):
    from database import SessionLocal
    db = SessionLocal()
    try:
        completion_subject = "Assessment Completed - Thank You for Your Time"
        completion_body = email_templates.get_completion_email_template(
            candidate_name=candidate_name,
            role_title=target_role,
            round_type=assessment_type
        )
        utils.send_email(candidate_email, completion_subject, completion_body)
        print(f"Completion email sent to {candidate_email}")
        
        # Send HR Notification if alerts enabled
        settings_record = None
        if created_by_id:
            settings_record = db.query(models.GlobalSettings).filter(
                models.GlobalSettings.created_by == created_by_id
            ).first()
        if not settings_record:
            settings_record = db.query(models.GlobalSettings).filter(
                models.GlobalSettings.key == "default"
            ).first()
            
        if settings_record and settings_record.config:
            notifications_conf = settings_record.config.get("notifications", {})
            if notifications_conf.get("emailAlerts", True):
                creator_user = None
                if created_by_id:
                    creator_user = db.query(models.User).filter(models.User.id == created_by_id).first()
                
                # Check if the creator email is a dummy/generic one, otherwise use it
                hr_email = creator_user.email if (creator_user and not creator_user.email.endswith('.internal')) else notifications_conf.get("recipientEmail")
                
                # If recipient email is a dummy (e.g. hr@company.com), fallback to the synced admin email (gopalmuri1919@gmail.com)
                if hr_email == "hr@company.com" or not hr_email:
                    hr_email = "gopalmuri1919@gmail.com"

                if hr_email:
                    hr_subject = f"Candidate Assessment Submitted: {candidate_name}"
                    hr_body = f"""
                    <h3>Candidate Assessment Submission Alert</h3>
                    <p><strong>Candidate Name:</strong> {candidate_name}</p>
                    <p><strong>Email:</strong> {candidate_email}</p>
                    <p><strong>Role:</strong> {target_role}</p>
                    <p><strong>Assessment Type:</strong> {friendly_type}</p>
                    <p><strong>Status/Score:</strong> {score_detail}</p>
                    <br/>
                    <p>You can view the full evaluation details in the Admin Dashboard.</p>
                    """
                    utils.send_email(hr_email, hr_subject, hr_body)
                    print(f"HR notification email sent to {hr_email}")
    except Exception as e:
        print(f"Failed to send email notifications in background: {e}")
    finally:
        db.close()

@router.post("/submit/", response_model=schemas.AssessmentResponse)
def submit_assessment(
    payload: schemas.SubmissionPayload,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db)
):
    assessment = db.query(models.Assessment).filter(
        models.Assessment.user_id == current_user.id
    ).order_by(models.Assessment.created_at.desc()).first()

    if not assessment:
        raise HTTPException(status_code=404, detail="No active assessment found")

    if assessment.status == models.AssessmentStatus.completed:
        raise HTTPException(status_code=400, detail="Assessment already submitted")
    
    # --- SCORING LOGIC ---
    calculated_score = 0.0
    # Initialize defaults to prevent UnboundLocalError
    correct_count = 0
    total_questions = 0
    passed = 0
    total = 0
    
    if assessment.type == "aptitude" and payload.answers:
        # Dynamic Answer Key from Generated Questions
        generated_questions = assessment.config.get("generated_questions", [])
        
        if generated_questions:
            # Map Question ID -> Correct Option Index
            # Questions from AI have 'id' (int) and 'correct' (int index)
            answer_key = {str(q['id']): q['correct'] for q in generated_questions}
            total_questions = len(generated_questions)
        else:
            # Fallback (Should not happen if generated correctly)
            answer_key = {}
            total_questions = 0

        correct_count = 0
        
        for q_idx, ans_idx in payload.answers.items():
            key_exists = str(q_idx) in answer_key
            if key_exists:
                expected = answer_key[str(q_idx)]
                try:
                    expected_int = int(expected) if not isinstance(expected, int) else expected
                    ans_int = int(ans_idx) if not isinstance(ans_idx, int) else ans_idx
                    is_correct = expected_int == ans_int
                except (ValueError, TypeError):
                    is_correct = expected == ans_idx
                
                if is_correct:
                    correct_count += 1
        
        # Scale to 10
        if total_questions > 0:
            calculated_score = (correct_count / total_questions) * 10.0
            
    elif assessment.type == "coding":
        # Dynamic Scoring based on Test Cases Passed
        # Payload comes from frontend: { result: { passed: N, total: M } }
        if payload.result:
            passed = payload.result.get("passed", 0)
            
            # Robust Total Calculation: Use actual count from DB config
            generated_qs = assessment.config.get("generated_questions", [])
            actual_total = sum(len(q.get('testCases', [])) for q in generated_qs)
            
            # Fallback to payload total if DB config is empty
            total = actual_total if actual_total > 0 else payload.result.get("total", 5)
            
            if total > 0:
                calculated_score = (passed / total) * 10.0
        else:
            # Fallback if no result passed (e.g. didn't run code)
            calculated_score = 0.0
    
    assessment.status = models.AssessmentStatus.completed
    assessment.score = calculated_score
    
    # Calculate time taken (from start to now)
    from datetime import datetime, timezone
    time_taken_seconds = 0
    
    # Use started_at if available, otherwise fallback to created_at
    base_time = assessment.started_at or assessment.created_at
    
    if base_time:
        # DB timezone-aware datetime comparison
        now = datetime.now(timezone.utc)
        # Ensure base_time is comparison-friendly (if it came from DB with TZ)
        if base_time.tzinfo is None:
            # Fallback for naive timestamps
            time_diff = datetime.now() - base_time
        else:
            time_diff = now - base_time
        
        time_taken_seconds = int(time_diff.total_seconds())
        # Ensure no negative timing (sanity check)
        if time_taken_seconds < 0:
            time_taken_seconds = 0
    
    # Store detailed analysis
    if assessment.type == "aptitude":
        assessment.analysis_data = {
            "correct": correct_count,
            "total": total_questions,
            "incorrect": total_questions - correct_count, # Assuming all others are incorrect/unanswered
            "score_percentage": (calculated_score / 10) * 100 if total_questions > 0 else 0,
            "time_taken_seconds": time_taken_seconds
        }
    elif assessment.type == "coding":
        assessment.analysis_data = {
            "passed": passed,
            "total": total,
            "failed": total - passed,
             "score_percentage": (calculated_score / 10) * 100 if total > 0 else 0,
            "time_taken_seconds": time_taken_seconds
        }
    
    # 2. SYNC: Update Candidate record and Log Activity
    candidate = db.query(models.Candidate).filter(models.Candidate.email == assessment.candidate_email).first()
    if candidate:
        # Update Candidate Score and Status
        candidate.score = calculated_score * 10.0 # Convert 0-10 back to 0-100 for percentage
        
        # CRITICAL FIX: Copy analysis_data to candidate record for frontend access
        candidate.analysis_data = assessment.analysis_data
        
        # Store detailed score in status string for frontend display "5/10"
        # Format: "Submitted: Correct/Total"
        if payload.status:
            candidate.status = payload.status
        elif assessment.type == "aptitude":
            candidate.status = f"Submitted: {correct_count}/{total_questions}"
        elif assessment.type == "coding":
            candidate.status = f"Submitted: {passed}/{total}"
        else:
            candidate.status = "Review Pending"
        
        # Log Submission for Admin Panel
        friendly_type = assessment.type.replace('_', ' ').title()
        score_detail = candidate.status.split(': ')[1] if ':' in candidate.status else 'Completed'
        log = models.ActivityLog(
            user_id=candidate.created_by,
            action="completed",
            target=candidate.name,
            details=f"Completed {friendly_type} | Result: {score_detail}"
        )
        db.add(log)
        
        # --- SEND COMPLETION EMAIL (New) ---
        target_role = candidate.role if candidate.role else "Candidate"
        background_tasks.add_task(
            send_completion_emails,
            candidate.email,
            candidate.name,
            target_role,
            assessment.type,
            friendly_type,
            score_detail,
            candidate.created_by
        )
        # -----------------------------------

    db.commit()
    db.refresh(assessment)
    
    return assessment

