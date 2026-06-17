from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models
from routers.auth import get_current_user
from pydantic import BaseModel
from typing import Dict, Any

router = APIRouter(
    prefix="/api/settings",
    tags=["settings"]
)

class SettingsUpdate(BaseModel):
    config: Dict[str, Any]

DEFAULT_CONFIG = {
    "orgName": "My Organization",
    "timezone": "UTC",
    "pipeline": {
        "stages": ["Resume Screening", "Aptitude Round", "Coding Round", "Technical Interview", "Offer Sent"],
        "autoReject": False
    },
    "scoring": {
        "skills": 40,
        "experience": 25,
        "projects": 20,
        "education": 10,
        "bonus": 5
    },
    "assessments": {
        "aptitudeDuration": 30,
        "aptitudePassingScore": 60,
        "codingDuration": 45,
        "interviewDuration": 15,
        "allowedLanguages": ["Python", "JavaScript"]
    },
    "roles": [
        "Full Stack Software Engineer",
        "Frontend Developer",
        "Backend Developer",
        "Python Developer"
    ],
    "emails": {
        "invitationSubject": "Invitation to Assessment Round - HiringAI",
        "invitationBody": "Dear Candidate,\n\nYou have been promoted to the next stage of our recruitment process. Please log in to the portal to take your assessment.",
        "reminderSubject": "Reminder: Pending Assessment - HiringAI",
        "reminderBody": "Dear Candidate,\n\nThis is a friendly reminder to complete your pending assessment as soon as possible."
    },
    "security": {
        "faceProctoring": True,
        "fullscreenProctoring": True,
        "autoFlagSuspicious": True
    },
    "notifications": {
        "emailAlerts": True,
        "slackIntegration": False,
        "weeklyDigest": True,
        "recipientEmail": "gopalmuri1919@gmail.com"
    }
}

@router.get("/")
def get_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Resolve Candidate shadow user to their admin creator
    creator_id = current_user.id
    if current_user.email.endswith('.internal') or current_user.role == "CANDIDATE" or current_user.role == "candidate":
        try:
            if '_' in current_user.email and '@' in current_user.email:
                cand_id_str = current_user.email.split('_')[1].split('@')[0]
                candidate_id = int(cand_id_str)
                candidate = db.query(models.Candidate).filter(models.Candidate.id == candidate_id).first()
                if candidate and candidate.created_by:
                    creator_id = candidate.created_by
        except Exception as e:
            print(f"Failed to resolve settings creator for shadow user {current_user.email}: {e}")

    # Each user gets their own settings row keyed by their user id
    settings = db.query(models.GlobalSettings).filter(
        models.GlobalSettings.created_by == creator_id
    ).first()

    if not settings:
        settings = models.GlobalSettings(
            key=f"user_{creator_id}",
            config=DEFAULT_CONFIG,
            created_by=creator_id
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    else:
        config = dict(settings.config)
        modified = False
        # Merge any missing sections from defaults
        for key in ["scoring", "assessments", "roles", "emails", "security", "notifications"]:
            if key not in config:
                config[key] = DEFAULT_CONFIG[key]
                modified = True
        if modified:
            settings.config = config
            db.commit()

    return settings.config

@router.put("/")
def update_settings(
    settings_update: SettingsUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_settings = db.query(models.GlobalSettings).filter(
        models.GlobalSettings.created_by == current_user.id
    ).first()

    if not db_settings:
        db_settings = models.GlobalSettings(
            key=f"user_{current_user.id}",
            config=settings_update.config,
            created_by=current_user.id
        )
        db.add(db_settings)
    else:
        db_settings.config = settings_update.config

    db.commit()
    return {"message": "Settings updated", "config": db_settings.config}
