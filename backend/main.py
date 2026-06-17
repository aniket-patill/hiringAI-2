from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from dotenv import load_dotenv

load_dotenv()

import models, database
from routers import auth, assessments, resume, dashboard, settings, interview, proctor, rag

app = FastAPI(title="HiringAI Enterprise API")

# Mount media directory for resume files
os.makedirs("media/resumes", exist_ok=True)
app.mount("/media", StaticFiles(directory="media"), name="media")

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    print(f"ERROR: 422 Validation Error at {request.url.path}")
    print(f"Detail: {exc.errors()}")
    print(f"Body: {await request.body()}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": str(await request.body())},
    )

# Database Init
models.Base.metadata.create_all(bind=database.engine)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router)
app.include_router(assessments.router)
app.include_router(resume.router)
app.include_router(dashboard.router)
app.include_router(settings.router)
app.include_router(interview.router)
app.include_router(proctor.router)
app.include_router(rag.router)

@app.get("/")
def read_root():
    return {"message": "HiringAI Backend is running on FastAPI!"}
