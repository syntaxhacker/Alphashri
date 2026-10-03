"""Chart-pattern reference-image API.

Router prefix ``/api/chart-patterns`` (shared with ``api.chart_patterns``).

Read endpoints (``GET /images``, ``GET /image/{pattern_id}``) are public, like
the other read-only chart-pattern endpoints. Mutations are admin-only.

Storage: ``experiments/data/pattern_images/<pattern_id>.<ext>`` — the file is
always named from the *validated* pattern id and a whitelisted extension, never
from the client-supplied filename.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from api.auth import get_current_user
from chart_patterns.detectors.common import PATTERN_CATALOG
from db.database import get_db
from db.models.chart_patterns import PatternImage
from db.models.user import User

router = APIRouter(prefix="/api/chart-patterns", tags=["chart-patterns"])


# Public serve URL for a pattern image (mirrors PatternImage.to_dict()).
IMAGE_URL = "/api/chart-patterns/image/{pattern_id}"

STORAGE_DIR = Path(__file__).resolve().parent.parent / "experiments" / "data" / "pattern_images"

# Accepted upload content-types -> canonical file extension. The extension is
# derived from the declared content-type, not the client filename.
CONTENT_TYPE_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg",
}

MAX_IMAGE_BYTES = 2 * 1024 * 1024  # 2 MB


def _require_admin(user: User = Depends(get_current_user)) -> User:
    """Allow only admin users through; 403 for everyone else."""
    if not getattr(user, "is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _storage_path(filename: str) -> Path:
    return STORAGE_DIR / filename


def _get_row(db: Session, pattern_id: str) -> PatternImage | None:
    return db.query(PatternImage).filter(PatternImage.pattern_id == pattern_id).first()


@router.get("/images")
async def list_images(db: Session = Depends(get_db)):
    """Map of pattern_id -> public image URL for every uploaded image."""
    rows = db.query(PatternImage).all()
    return {"images": {row.pattern_id: IMAGE_URL.format(pattern_id=row.pattern_id) for row in rows}}


@router.get("/image/{pattern_id}")
async def get_image(pattern_id: str, db: Session = Depends(get_db)):
    """Serve the stored image bytes, or 404 when none is uploaded."""
    row = _get_row(db, pattern_id)
    if row is None:
        raise HTTPException(status_code=404, detail="image not found")
    path = _storage_path(row.filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="image file missing")
    return FileResponse(str(path), media_type=row.content_type)


@router.put("/image/{pattern_id}")
async def upload_image(
    pattern_id: str,
    file: UploadFile = File(...),
    user: User = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    """Create or replace the reference image for a known chart pattern."""
    if pattern_id not in PATTERN_CATALOG:
        raise HTTPException(status_code=404, detail="unknown chart pattern")

    content_type = (file.content_type or "").lower()
    if content_type not in CONTENT_TYPE_EXT:
        raise HTTPException(status_code=415, detail="unsupported image type")

    content = await file.read()
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image exceeds 2 MB limit")

    ext = CONTENT_TYPE_EXT[content_type]
    filename = f"{pattern_id}.{ext}"
    try:
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as exc:  # pragma: no cover - disk failure
        raise HTTPException(status_code=500, detail=f"could not create storage dir: {exc}")

    row = _get_row(db, pattern_id)
    if row is not None and row.filename != filename:
        # Replacing with a different extension: drop the stale file.
        try:
            _storage_path(row.filename).unlink()
        except FileNotFoundError:
            pass

    _storage_path(filename).write_bytes(content)

    if row is None:
        row = PatternImage(pattern_id=pattern_id)
        db.add(row)
    row.filename = filename
    row.content_type = content_type
    row.size = len(content)
    row.updated_by = getattr(user, "id", None)
    db.commit()
    db.refresh(row)
    return row.to_dict()


@router.delete("/image/{pattern_id}")
async def delete_image(
    pattern_id: str,
    user: User = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    """Delete the stored image + row; 404 when nothing is stored."""
    row = _get_row(db, pattern_id)
    if row is None:
        raise HTTPException(status_code=404, detail="image not found")

    try:
        _storage_path(row.filename).unlink()
    except FileNotFoundError:
        pass

    db.delete(row)
    db.commit()
    return {"status": "ok", "pattern_id": pattern_id}
