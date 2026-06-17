from pydantic import BaseModel, EmailStr
from typing import List, Optional, Any, Dict
from datetime import datetime

# Token
class Token(BaseModel):
    access: str # Match 'access' key expected by frontend
    refresh: Optional[str] = None # Optional for now
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

class BulkCandidateUpdate(BaseModel):
    candidate_ids: List[int]
    stage: Optional[str] = None
    status: Optional[str] = None

# User
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    is_active: bool
    role: str
    
    class Config:
        from_attributes = True

# Assessment
class AssessmentBase(BaseModel):
    type: str # 'aptitude', 'coding', 'interview'
    config: Dict[str, Any]

class AssessmentCreateRequest(AssessmentBase):
    candidates: List[Dict[str, str]] # [{'email': '...', 'name': '...'}]
    deadline: Optional[str] = None

class AssessmentResponse(AssessmentBase):
    id: int
    candidate_email: str
    status: str
    score: float
    analysis_data: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True

class ExecutionRequest(BaseModel):
    code: str
    language: str
    question: Dict[str, Any]
    testCases: List[Dict[str, Any]]
    questionId: Optional[int] = None

class SubmissionPayload(BaseModel):
    answers: Optional[Dict[str, int]] = None
    code: Optional[Any] = None 
    result: Optional[Dict[str, Any]] = None
    status: Optional[str] = None

class AssignResponse(BaseModel):
    message: str
    status: str
    email_errors: List[str]

# Candidate / Resume
class CandidateCreate(BaseModel):
    name: str
    email: EmailStr
    role: str
    stage: Optional[str] = "Resume Screening"
    status: Optional[str] = "Applied"

class CandidateUpdate(BaseModel):
    stage: Optional[str] = None
    status: Optional[str] = None
class CandidateResponse(BaseModel):
    id: int
    name: str
    email: str
    phone: Optional[str] = None
    role: str
    status: str
    stage: str
    score: float
    resume_file: Optional[str] = None
    analysis_data: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True

class StatsResponse(BaseModel):
    metrics: Dict[str, int]
    funnel: Dict[str, int]

class ActivityLogResponse(BaseModel):
    user_id: Optional[int]
    action: str
    target: str
    details: Optional[str]
    timestamp: datetime

    class Config:
        from_attributes = True
