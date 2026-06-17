from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
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
    source_candidate_names: list[str] = []


@router.post("/query", response_model=QueryResponse)
async def query_candidates(
    payload: QueryRequest,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    if not payload.query or not payload.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    # Build a name map for all candidates belonging to this user
    candidates = db.query(models.Candidate).filter(
        models.Candidate.created_by == current_user.id
    ).all()
    names_map = {c.id: c.name for c in candidates if c.name}

    history = [
        {"role": m.role, "content": m.content}
        for m in (payload.conversation_history or [])
    ]

    result = await RagQueryService.query_candidates(
        query_text=payload.query.strip(),
        user_id=current_user.id,
        conversation_history=history,
        candidate_names_map=names_map,
    )
    return result


@router.get("/status")
async def rag_status(
    current_user: models.User = Depends(get_current_user)
):
    """Check if Qdrant is reachable and whether the user has an indexed collection."""
    try:
        from qdrant_client import QdrantClient
        import os
        client = QdrantClient(url=os.getenv("QDRANT_URL", "http://localhost:6333"))
        collections = client.get_collections().collections
        user_collection = f"resumes_{current_user.id}"
        has_index = any(c.name == user_collection for c in collections)

        # Count indexed vectors if collection exists
        indexed_count = 0
        if has_index:
            try:
                info = client.get_collection(user_collection)
                indexed_count = info.points_count or 0
            except Exception:
                pass

        return {
            "qdrant_connected": True,
            "has_resume_index": has_index,
            "collection_name": user_collection,
            "indexed_vectors": indexed_count,
        }
    except Exception as e:
        return {
            "qdrant_connected": False,
            "has_resume_index": False,
            "error": str(e)
        }


@router.get("/indexed-candidates")
async def indexed_candidates(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Return the list of candidates belonging to this user who have been indexed in Qdrant.
    Identifies indexed candidates by checking which candidate_ids appear in the vector store.
    """
    try:
        from qdrant_client import QdrantClient
        import os
        client = QdrantClient(url=os.getenv("QDRANT_URL", "http://localhost:6333"))
        collection_name = f"resumes_{current_user.id}"
        collections = [c.name for c in client.get_collections().collections]

        if collection_name not in collections:
            return {"candidates": [], "total": 0}

        # Scroll all points to get unique candidate_ids
        all_ids: set[int] = set()
        offset = None
        while True:
            scroll_result = client.scroll(
                collection_name=collection_name,
                limit=100,
                offset=offset,
                with_payload=True,
                with_vectors=False,
            )
            # scroll() returns (list[Record], Optional[offset])
            if isinstance(scroll_result, tuple):
                records, next_offset = scroll_result
            else:
                records = scroll_result
                next_offset = None

            for point in records:
                payload = point.payload if hasattr(point, 'payload') else {}
                cid = (payload or {}).get("candidate_id")
                if cid is not None:
                    all_ids.add(int(cid))

            if not next_offset:
                break
            offset = next_offset

        # Fetch candidate info from DB
        if not all_ids:
            return {"candidates": [], "total": 0}

        candidates = db.query(models.Candidate).filter(
            models.Candidate.id.in_(all_ids),
            models.Candidate.created_by == current_user.id,
        ).all()

        return {
            "candidates": [
                {
                    "id": c.id,
                    "name": c.name or "Unknown",
                    "score": c.score,
                    "job_role": c.role or "",
                    "email": c.email or "",
                }
                for c in candidates
            ],
            "total": len(candidates),
        }
    except Exception as e:
        return {"candidates": [], "total": 0, "error": str(e)}
