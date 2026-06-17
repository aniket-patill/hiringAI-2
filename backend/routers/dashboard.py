from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
import schemas, models, database
from routers.auth import get_current_user

router = APIRouter(
    prefix="/api/dashboard",
    tags=["dashboard"]
)

@router.get("/activity/", response_model=List[schemas.ActivityLogResponse])
def get_activity_log(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Return only activity logs created by this user
    return db.query(models.ActivityLog).filter(
        models.ActivityLog.user_id == current_user.id
    ).order_by(models.ActivityLog.timestamp.desc()).limit(20).all()

@router.get("/insights/")
def get_insights(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Only compute insights from this HR user's candidates
    candidates = db.query(models.Candidate).filter(
        models.Candidate.created_by == current_user.id
    ).all()

    high_score_count = sum(1 for c in candidates if c.score > 80)

    alerts = []
    if high_score_count > 0:
        alerts.append({
            "id": 1,
            "type": "success",
            "message": f"{high_score_count} Top Candidates identified with score > 80."
        })

    return alerts

@router.get("/notifications/")
def get_notifications(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Return only unread activity logs belonging to this user
    notes = db.query(models.ActivityLog).filter(
        models.ActivityLog.user_id == current_user.id,
        models.ActivityLog.is_read == False
    ).order_by(models.ActivityLog.timestamp.desc()).all()
    return notes

@router.put("/notifications/{id}/read")
def mark_notification_read(
    id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    note = db.query(models.ActivityLog).filter(
        models.ActivityLog.id == id,
        models.ActivityLog.user_id == current_user.id
    ).first()
    if note:
        note.is_read = True
        db.commit()
    return {"status": "success"}
