"""
Authentication module for Alphashri

Provides:
- Password hashing with bcrypt
- JWT token generation and validation
- Login/register/logout endpoints
- User dependency injection for protected routes
"""

from datetime import datetime, timedelta, timezone
from typing import Optional
import secrets
import threading
import time
import weakref

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
import bcrypt
import jwt
import config

from db.database import get_db
from db.models import User, UserSession

# Configuration
# Use centralized config for security settings
JWT_SECRET_KEY = config.JWT_SECRET_KEY
JWT_ALGORITHM = config.JWT_ALGORITHM
ACCESS_TOKEN_EXPIRE_HOURS = config.ACCESS_TOKEN_EXPIRE_MINUTES // 60
REFRESH_TOKEN_EXPIRE_DAYS = config.REFRESH_TOKEN_EXPIRE_DAYS


# Router
router = APIRouter(prefix="/api/auth", tags=["auth"])

# Security scheme
security = HTTPBearer(
    auto_error=False,
    scheme_name="bearerAuth",
    description="JWT access token from POST /api/auth/login (sent as 'Authorization: Bearer <token>').",
)


# --- Current-user cache -------------------------------------------------------
# Every protected request re-read the same `users` row, which queued a worker
# task (and a SQLite read) behind whatever the TV scans were doing. The row
# changes only through PUT /api/auth/me, so a short TTL plus invalidation on
# that endpoint (and on logout) removes one executor task per request.
#
# Entries are keyed by (user_id, token jti), not user_id alone: the token is what
# proved the identity, so a cached row can never be served to a different
# session, and a refreshed token is revalidated against the DB. A user can be
# deactivated only by an ops write, which the TTL bounds.
USER_CACHE_TTL_SECONDS = 45.0
USER_CACHE_MAX_ENTRIES = 512

_user_cache_lock = threading.Lock()
# Partitioned by bind: one process can serve more than one database (the test
# suite builds a fresh in-memory one per test), and a cached user row must never
# leak across them. Keys are held weakly so a discarded engine drops its bucket.
_user_cache: "weakref.WeakKeyDictionary" = weakref.WeakKeyDictionary()


def _cache_bucket(db: Session):
    try:
        bind = db.get_bind()
    except Exception:
        return None
    if bind is None:
        return None
    try:
        with _user_cache_lock:
            bucket = _user_cache.get(bind)
            if bucket is None:
                bucket = {}
                _user_cache[bind] = bucket
            return bucket
    except TypeError:
        # Bind is not weak-referenceable; caching is optional, so skip it.
        return None


def _cached_user(db: Session, user_id: int, token_id: Optional[str]) -> Optional[User]:
    bucket = _cache_bucket(db)
    if bucket is None:
        return None
    key = (user_id, token_id)
    with _user_cache_lock:
        entry = bucket.get(key)
        if entry is None:
            return None
        expires_at, user = entry
        if expires_at <= time.monotonic():
            bucket.pop(key, None)
            return None
        return user


def _store_user(db: Session, user: User, token_id: Optional[str]) -> None:
    bucket = _cache_bucket(db)
    if bucket is None:
        return
    with _user_cache_lock:
        if len(bucket) >= USER_CACHE_MAX_ENTRIES:
            bucket.clear()
        bucket[(user.id, token_id)] = (time.monotonic() + USER_CACHE_TTL_SECONDS, user)


def _user_snapshot(row: User) -> User:
    """Detached copy of a user row.

    Detached on purpose: the cached instance must not be mutated or flushed by
    whichever request happens to hold it.
    """
    return User(
        id=row.id,
        uuid=row.uuid,
        email=row.email,
        hashed_password=row.hashed_password,
        display_name=row.display_name,
        created_at=row.created_at,
        updated_at=row.updated_at,
        is_active=row.is_active,
        is_admin=row.is_admin,
        initial_capital=row.initial_capital,
    )


def invalidate_user_cache(user_id: Optional[int] = None, db: Optional[Session] = None) -> None:
    """Drop one user (or every user when ``user_id`` is None) from the cache."""
    with _user_cache_lock:
        if db is not None:
            buckets = []
            try:
                bucket = _user_cache.get(db.get_bind())
                if bucket is not None:
                    buckets.append(bucket)
            except Exception:
                pass
        else:
            buckets = list(_user_cache.values())
        for bucket in buckets:
            if user_id is None:
                bucket.clear()
            else:
                for key in [k for k in bucket if k[0] == user_id]:
                    bucket.pop(key, None)


# Pydantic models
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    display_name: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class UserResponse(BaseModel):
    id: int
    email: str
    display_name: Optional[str]
    initial_capital: float
    created_at: datetime
    is_admin: bool = False

    class Config:
        from_attributes = True


class RefreshRequest(BaseModel):
    refresh_token: str


# Password utilities
def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
    except Exception:
        return False


# JWT utilities
def create_access_token(user_id: int, expires_delta: Optional[timedelta] = None) -> tuple[str, str]:
    """Create access token and return (token, jti)."""
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)

    jti = secrets.token_hex(16)

    payload = {
        "sub": str(user_id),
        "jti": jti,
        "type": "access",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }

    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return token, jti


def create_refresh_token(user_id: int, db: Session) -> str:
    """Create refresh token and store session in database."""
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    jti = secrets.token_hex(16)

    payload = {
        "sub": str(user_id),
        "jti": jti,
        "type": "refresh",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }

    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)

    # Store session in database
    session = UserSession(
        id=jti,
        user_id=user_id,
        expires_at=expire,
    )
    db.add(session)
    db.commit()

    return token


def decode_token(token: str) -> Optional[dict]:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


# Dependency for protected routes.
# Sync on purpose: FastAPI runs it on the anyio worker pool, so the user lookup
# never touches the event loop. On a cache hit it performs no I/O at all.
def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """Get current user from JWT token."""
    if credentials is None:
        raise _unauthorized("Not authenticated")

    token = credentials.credentials
    payload = decode_token(token)

    if payload is None:
        raise _unauthorized("Invalid or expired token")

    if payload.get("type") != "access":
        raise _unauthorized("Invalid token type")

    user_id = payload.get("sub")
    if user_id is None:
        raise _unauthorized("Invalid token: missing subject")
    try:
        user_id = int(user_id)
    except (ValueError, TypeError):
        raise _unauthorized("Invalid token: malformed subject")

    token_id = payload.get("jti")
    user = _cached_user(db, user_id, token_id)
    if user is None:
        row = db.query(User).filter(User.id == user_id, User.is_active == True).first()
        if row is None:
            raise _unauthorized("User not found or inactive")
        user = _user_snapshot(row)
        _store_user(db, user, token_id)

    return user


# API Endpoints
@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(
    user_data: UserRegister,
    db: Session = Depends(get_db)
):
    """Register a new user."""
    hashed_password = hash_password(user_data.password)

    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    user = User(
        email=user_data.email,
        hashed_password=hashed_password,
        display_name=user_data.display_name or user_data.email.split('@')[0],
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Create tokens
    access_token, _ = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id, db)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=ACCESS_TOKEN_EXPIRE_HOURS * 3600,
    )


@router.post("/login", response_model=TokenResponse)
def login(
    credentials: UserLogin,
    db: Session = Depends(get_db)
):
    """Login and get tokens."""
    user = db.query(User).filter(User.email == credentials.email).first()

    if user is None or not verify_password(credentials.password, user.hashed_password):
        raise _unauthorized("Invalid email or password")

    if not user.is_active:
        raise _unauthorized("User account is disabled")

    # Create tokens
    access_token, _ = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id, db)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=ACCESS_TOKEN_EXPIRE_HOURS * 3600,
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    refresh_data: RefreshRequest,
    db: Session = Depends(get_db)
):
    """Refresh access token using refresh token."""
    payload = decode_token(refresh_data.refresh_token)

    if payload is None or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    jti = payload.get("jti")
    user_id = int(payload.get("sub"))

    session = db.query(UserSession).filter(
        UserSession.id == jti,
        UserSession.user_id == user_id,
        UserSession.revoked == False,
    ).first()
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session not found or revoked",
        )
    session.revoked = True
    db.commit()

    # Create new tokens
    access_token, _ = create_access_token(user_id)
    new_refresh_token = create_refresh_token(user_id, db)

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        expires_in=ACCESS_TOKEN_EXPIRE_HOURS * 3600,
    )


@router.post("/logout")
def logout(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    """Logout and revoke current session."""
    if credentials is None:
        return {"message": "Logged out"}

    payload = decode_token(credentials.credentials)

    if payload and payload.get("type") == "refresh":
        jti = payload.get("jti")
        session = db.query(UserSession).filter(UserSession.id == jti).first()
        if session:
            session.revoked = True
            db.commit()

    subject = payload.get("sub") if payload else None
    if subject is not None:
        try:
            invalidate_user_cache(int(subject))
        except (ValueError, TypeError):
            pass

    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserResponse)
def get_me(
    user: User = Depends(get_current_user)
):
    """Get current user info."""
    return UserResponse.model_validate(user)


@router.put("/me", response_model=UserResponse)
def update_me(
    display_name: Optional[str] = None,
    initial_capital: Optional[float] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update current user settings."""
    # Re-read the live row: `user` may be the cached snapshot, which must not be
    # written back through this request's session.
    row = db.query(User).filter(User.id == user.id).first()
    if row is None:
        raise _unauthorized("User not found or inactive")

    if display_name is not None:
        row.display_name = display_name
    if initial_capital is not None:
        row.initial_capital = initial_capital

    db.commit()
    db.refresh(row)
    invalidate_user_cache(row.id)

    return UserResponse.model_validate(row)
