"""
Authentication API Tests for Alphashri.

Tests all authentication endpoints including:
- POST /api/auth/register (7 test cases)
- POST /api/auth/login (8 test cases)
- POST /api/auth/refresh (7 test cases)
- POST /api/auth/logout (4 test cases)
- GET /api/auth/me (6 test cases)
- PUT /api/auth/me (4 test cases)

Total: 36 test cases
"""

import sys
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional
import jwt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from db.models import User, UserSession
from api.auth import (
    JWT_SECRET_KEY,
    JWT_ALGORITHM,
    ACCESS_TOKEN_EXPIRE_HOURS,
    REFRESH_TOKEN_EXPIRE_DAYS,
    hash_password,
)


# =============================================================================
# Test Constants
# =============================================================================
VALID_EMAIL = "test@example.com"
VALID_PASSWORD = "SecurePassword123!"
WEAK_PASSWORD = "123"
INVALID_EMAIL = "invalid-email-format"


# =============================================================================
# 1. Register User Tests (7 test cases)
# =============================================================================
class TestRegisterUser:
    """Tests for POST /api/auth/register endpoint."""

    def test_register_with_valid_email_and_password(
        self, client: TestClient, db: Session
    ):
        """Test: Register with valid email and password."""
        response = client.post("/api/auth/register", json={
            "email": VALID_EMAIL,
            "password": VALID_PASSWORD
        })

        assert response.status_code == 201
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
        assert data["expires_in"] == ACCESS_TOKEN_EXPIRE_HOURS * 3600

        # Verify user created in database
        user = db.query(User).filter(User.email == VALID_EMAIL).first()
        assert user is not None
        assert user.email == VALID_EMAIL
        assert user.display_name == VALID_EMAIL.split('@')[0]
        assert user.is_active is True

    def test_register_with_existing_email_returns_400(
        self, client: TestClient, test_user: User
    ):
        """Test: Register with existing email (400 Bad Request)."""
        response = client.post("/api/auth/register", json={
            "email": test_user.email,
            "password": VALID_PASSWORD
        })

        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "already registered" in data["detail"].lower()

    def test_register_with_invalid_email_format_returns_422(
        self, client: TestClient
    ):
        """Test: Register with invalid email format (422 Validation Error)."""
        response = client.post("/api/auth/register", json={
            "email": INVALID_EMAIL,
            "password": VALID_PASSWORD
        })

        assert response.status_code == 422
        data = response.json()
        assert "detail" in data

    def test_register_with_missing_fields_returns_422(
        self, client: TestClient
    ):
        """Test: Register with missing fields (422 Validation Error)."""
        # Missing password
        response = client.post("/api/auth/register", json={
            "email": VALID_EMAIL
        })

        assert response.status_code == 422

        # Missing email
        response = client.post("/api/auth/register", json={
            "password": VALID_PASSWORD
        })

        assert response.status_code == 422

    def test_register_with_display_name_provided(
        self, client: TestClient, db: Session
    ):
        """Test: Register with display_name provided."""
        display_name = "Custom Display Name"
        response = client.post("/api/auth/register", json={
            "email": VALID_EMAIL,
            "password": VALID_PASSWORD,
            "display_name": display_name
        })

        assert response.status_code == 201
        user = db.query(User).filter(User.email == VALID_EMAIL).first()
        assert user.display_name == display_name

    def test_register_without_display_name_auto_generates_from_email(
        self, client: TestClient, db: Session
    ):
        """Test: Register without display_name (auto-generate from email)."""
        email = "john.doe@example.com"
        response = client.post("/api/auth/register", json={
            "email": email,
            "password": VALID_PASSWORD
        })

        assert response.status_code == 201
        user = db.query(User).filter(User.email == email).first()
        assert user.display_name == "john.doe"

    def test_register_creates_session_in_database(
        self, client: TestClient, db: Session
    ):
        """Test: Verify session is created in database after registration."""
        response = client.post("/api/auth/register", json={
            "email": VALID_EMAIL,
            "password": VALID_PASSWORD
        })

        assert response.status_code == 201
        data = response.json()
        refresh_token = data["refresh_token"]

        # Decode refresh token to get jti
        payload = jwt.decode(
            refresh_token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM]
        )
        jti = payload["jti"]

        # Verify session exists in database
        session = db.query(UserSession).filter(UserSession.id == jti).first()
        assert session is not None
        assert session.revoked is False
        assert session.expires_at > datetime.utcnow()


# =============================================================================
# 2. Login User Tests (8 test cases)
# =============================================================================
class TestLoginUser:
    """Tests for POST /api/auth/login endpoint."""

    def test_login_with_valid_credentials(
        self, client: TestClient, test_user: User, test_password: str
    ):
        """Test: Login with valid credentials."""
        response = client.post("/api/auth/login", json={
            "email": test_user.email,
            "password": test_password
        })

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
        assert data["expires_in"] == ACCESS_TOKEN_EXPIRE_HOURS * 3600

    def test_login_with_invalid_email_returns_401(
        self, client: TestClient, test_password: str
    ):
        """Test: Login with invalid email (401 Unauthorized)."""
        response = client.post("/api/auth/login", json={
            "email": "nonexistent@example.com",
            "password": test_password
        })

        assert response.status_code == 401
        data = response.json()
        assert "detail" in data
        assert "invalid" in data["detail"].lower()

    def test_login_with_invalid_password_returns_401(
        self, client: TestClient, test_user: User
    ):
        """Test: Login with invalid password (401 Unauthorized)."""
        response = client.post("/api/auth/login", json={
            "email": test_user.email,
            "password": "WrongPassword123!"
        })

        assert response.status_code == 401
        data = response.json()
        assert "detail" in data

    def test_login_with_non_existent_user_returns_401(
        self, client: TestClient
    ):
        """Test: Login with non-existent user (401 Unauthorized)."""
        response = client.post("/api/auth/login", json={
            "email": "nonexistent@example.com",
            "password": VALID_PASSWORD
        })

        assert response.status_code == 401

    def test_login_with_disabled_user_account_returns_401(
        self, client: TestClient, inactive_user: User, test_password: str
    ):
        """Test: Login with disabled user account (401 Unauthorized)."""
        response = client.post("/api/auth/login", json={
            "email": inactive_user.email,
            "password": test_password
        })

        assert response.status_code == 401
        data = response.json()
        assert "detail" in data
        assert "disabled" in data["detail"].lower()

    def _login_and_decode_token(self, client, email, password, token_field="access_token"):
        response = client.post("/api/auth/login", json={
            "email": email,
            "password": password
        })
        return response.json()[token_field]

    def test_login_verify_jwt_token_structure(
        self, client: TestClient, test_user: User, test_password: str
    ):
        """Test: Verify JWT token structure (has sub, jti, type, exp)."""
        payload = jwt.decode(
            self._login_and_decode_token(client, test_user.email, test_password),
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM]
        )

        assert "sub" in payload
        assert "jti" in payload
        assert "type" in payload
        assert payload["type"] == "access"
        assert "exp" in payload
        assert "iat" in payload

    @pytest.mark.parametrize("token_field,duration_units", [
        ("access_token", "hours"),
        ("refresh_token", "days"),
    ], ids=["access_token_24h", "refresh_token_7d"])
    def test_login_verify_token_expiration(
        self, client: TestClient, test_user: User, test_password: str,
        token_field, duration_units,
    ):
        payload = jwt.decode(
            self._login_and_decode_token(client, test_user.email, test_password, token_field),
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM]
        )

        exp = datetime.fromtimestamp(payload["exp"])
        iat = datetime.fromtimestamp(payload["iat"])
        delta = exp - iat

        if duration_units == "hours":
            expected = ACCESS_TOKEN_EXPIRE_HOURS
            assert timedelta(hours=expected - 1) < delta
            assert delta < timedelta(hours=expected + 1)
        else:
            expected = REFRESH_TOKEN_EXPIRE_DAYS
            assert timedelta(days=expected - 1) < delta
            assert delta < timedelta(days=expected + 1)


# =============================================================================
# 3. Refresh Token Tests (7 test cases)
# =============================================================================
class TestRefreshToken:
    """Tests for POST /api/auth/refresh endpoint."""

    def test_refresh_with_valid_refresh_token(
        self, client: TestClient, valid_refresh_token: str
    ):
        """Test: Refresh with valid refresh token."""
        response = client.post("/api/auth/refresh", json={
            "refresh_token": valid_refresh_token
        })

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
        # New tokens should be different
        assert data["refresh_token"] != valid_refresh_token

    def test_refresh_with_invalid_token_returns_401(
        self, client: TestClient
    ):
        """Test: Refresh with invalid token (401)."""
        response = client.post("/api/auth/refresh", json={
            "refresh_token": "invalid.token.string"
        })

        assert response.status_code == 401
        data = response.json()
        assert "detail" in data

    def test_refresh_with_expired_token_returns_401(
        self, client: TestClient, expired_refresh_token: str
    ):
        """Test: Refresh with expired token (401)."""
        response = client.post("/api/auth/refresh", json={
            "refresh_token": expired_refresh_token
        })

        assert response.status_code == 401
        data = response.json()
        assert "detail" in data

    def test_refresh_with_access_token_returns_401(
        self, client: TestClient, valid_access_token: str
    ):
        """Test: Refresh with access token (401 - wrong type)."""
        response = client.post("/api/auth/refresh", json={
            "refresh_token": valid_access_token
        })

        assert response.status_code == 401
        data = response.json()
        assert "detail" in data

    def test_refresh_with_revoked_session_returns_401(
        self, client: TestClient, revoked_refresh_token: str
    ):
        """Test: Refresh with revoked session (401)."""
        response = client.post("/api/auth/refresh", json={
            "refresh_token": revoked_refresh_token
        })

        assert response.status_code == 401
        data = response.json()
        assert "detail" in data

    def test_refresh_verify_old_session_is_revoked_after_refresh(
        self,
        client: TestClient,
        valid_refresh_token: str,
        db: Session,
        test_user: User
    ):
        """Test: Verify old session is revoked after refresh."""
        # Get original token's jti
        old_payload = jwt.decode(
            valid_refresh_token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM]
        )
        old_jti = old_payload["jti"]

        # Perform refresh
        response = client.post("/api/auth/refresh", json={
            "refresh_token": valid_refresh_token
        })

        assert response.status_code == 200

        # Verify old session is revoked
        old_session = db.query(UserSession).filter(
            UserSession.id == old_jti
        ).first()
        assert old_session is not None
        assert old_session.revoked is True

    def test_refresh_verify_new_tokens_are_returned(
        self, client: TestClient, valid_refresh_token: str
    ):
        """Test: Verify new tokens are returned after refresh."""
        response = client.post("/api/auth/refresh", json={
            "refresh_token": valid_refresh_token
        })

        assert response.status_code == 200
        data = response.json()

        # Verify both tokens exist
        assert "access_token" in data
        assert "refresh_token" in data

        # Verify they are valid JWTs
        access_payload = jwt.decode(
            data["access_token"],
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM]
        )
        assert access_payload["type"] == "access"

        refresh_payload = jwt.decode(
            data["refresh_token"],
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM]
        )
        assert refresh_payload["type"] == "refresh"


# =============================================================================
# 4. Logout Tests (4 test cases)
# =============================================================================
class TestLogout:
    """Tests for POST /api/auth/logout endpoint."""

    def test_logout_with_valid_refresh_token(
        self, client: TestClient, valid_refresh_token: str, db: Session
    ):
        """Test: Logout with valid refresh token."""
        # Get jti before logout
        payload = jwt.decode(
            valid_refresh_token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM]
        )
        jti = payload["jti"]

        response = client.post(
            "/api/auth/logout",
            headers={"Authorization": f"Bearer {valid_refresh_token}"}
        )

        assert response.status_code == 200
        data = response.json()
        assert "message" in data

        # Verify session is revoked
        session = db.query(UserSession).filter(UserSession.id == jti).first()
        assert session.revoked is True

    def test_logout_without_token_returns_success(
        self, client: TestClient
    ):
        """Test: Logout without token (returns success)."""
        response = client.post("/api/auth/logout")

        assert response.status_code == 200
        data = response.json()
        assert "message" in data

    def test_logout_verify_session_is_revoked_in_database(
        self,
        client: TestClient,
        test_user: User,
        test_password: str,
        db: Session
    ):
        """Test: Verify session is revoked in database after logout."""
        # First login to get tokens
        login_response = client.post("/api/auth/login", json={
            "email": test_user.email,
            "password": test_password
        })
        data = login_response.json()
        refresh_token = data["refresh_token"]

        # Get jti
        payload = jwt.decode(
            refresh_token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM]
        )
        jti = payload["jti"]

        # Logout
        client.post(
            "/api/auth/logout",
            headers={"Authorization": f"Bearer {refresh_token}"}
        )

        # Verify session revoked
        session = db.query(UserSession).filter(UserSession.id == jti).first()
        assert session.revoked is True

    def test_logout_already_logged_out_user_succeeds(
        self,
        client: TestClient,
        revoked_refresh_token: str
    ):
        """Test: Logout already logged out user (success)."""
        response = client.post(
            "/api/auth/logout",
            headers={"Authorization": f"Bearer {revoked_refresh_token}"}
        )

        assert response.status_code == 200
        data = response.json()
        assert "message" in data


# =============================================================================
# 5. Get Current User Tests (6 test cases)
# =============================================================================
class TestGetCurrentUser:
    """Tests for GET /api/auth/me endpoint."""

    def test_get_user_with_valid_token(
        self, client: TestClient, auth_headers: dict
    ):
        """Test: Get user with valid token."""
        response = client.get("/api/auth/me", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "email" in data
        assert "display_name" in data
        assert "initial_capital" in data
        assert "created_at" in data
        # Verify email contains the expected pattern from auth_headers
        assert "authtest" in data["email"]

    def test_get_user_without_token_returns_401(
        self, client: TestClient
    ):
        """Test: Get user without token (401)."""
        response = client.get("/api/auth/me")

        assert response.status_code == 401
        data = response.json()
        assert "detail" in data
        assert "not authenticated" in data["detail"].lower()

    def test_get_user_with_expired_token_returns_401(
        self, client: TestClient, expired_access_token: str
    ):
        """Test: Get user with expired token (401)."""
        response = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {expired_access_token}"}
        )

        assert response.status_code == 401

    def test_get_user_with_invalid_token_returns_401(
        self, client: TestClient
    ):
        """Test: Get user with invalid token (401)."""
        response = client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer invalid.token"}
        )

        assert response.status_code == 401

    def test_get_user_with_wrong_token_type_returns_401(
        self, client: TestClient, access_token_type_refresh: str
    ):
        """Test: Get user with wrong token type (401)."""
        response = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {access_token_type_refresh}"}
        )

        assert response.status_code == 401

    def test_get_user_with_non_existent_user_id_returns_401(
        self, client: TestClient, access_token_for_nonexistent_user: str
    ):
        """Test: Get user with non-existent user_id (401)."""
        response = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {access_token_for_nonexistent_user}"}
        )

        assert response.status_code == 401
        data = response.json()
        assert "detail" in data


# =============================================================================
# 6. Update User Settings Tests (4 test cases)
# =============================================================================
class TestUpdateUserSettings:
    """Tests for PUT /api/auth/me endpoint."""

    def test_update_display_name_only(
        self, client: TestClient, auth_headers: dict
    ):
        """Test: Update display_name only."""
        new_name = "Updated Display Name"
        response = client.put(
            "/api/auth/me",
            params={"display_name": new_name},
            headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert data["display_name"] == new_name

    def test_update_initial_capital_only(
        self, client: TestClient, auth_headers: dict
    ):
        """Test: Update initial_capital only."""
        new_capital = 5000000.0
        response = client.put(
            "/api/auth/me",
            params={"initial_capital": new_capital},
            headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert data["initial_capital"] == new_capital

    def test_update_both_display_name_and_initial_capital(
        self, client: TestClient, auth_headers: dict
    ):
        """Test: Update both display_name and initial_capital."""
        new_name = "New Name"
        new_capital = 2000000.0

        response = client.put(
            "/api/auth/me",
            params={
                "display_name": new_name,
                "initial_capital": new_capital
            },
            headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert data["display_name"] == new_name
        assert data["initial_capital"] == new_capital

    def test_update_without_authentication_returns_401(
        self, client: TestClient
    ):
        """Test: Update without authentication (401)."""
        response = client.put(
            "/api/auth/me",
            params={"display_name": "New Name"}
        )

        assert response.status_code == 401


# =============================================================================
# Database Constraint Tests
# =============================================================================
class TestDatabaseConstraints:
    """Tests for database-level constraints."""

    def test_unique_email_constraint(
        self, client: TestClient, db: Session, test_user_data: dict
    ):
        """Test: Verify email uniqueness constraint at database level."""
        # Create first user
        response1 = client.post("/api/auth/register", json=test_user_data)
        assert response1.status_code == 201

        # Try to create duplicate user directly in DB
        user2 = User(
            email=test_user_data["email"],
            hashed_password=hash_password(test_user_data["password"]),
        )

        with pytest.raises(Exception):  # SQLAlchemy will raise IntegrityError
            db.add(user2)
            db.commit()

    def test_default_initial_capital_value(
        self, client: TestClient, db: Session
    ):
        """Test: Verify default initial_capital is set correctly."""
        response = client.post("/api/auth/register", json={
            "email": VALID_EMAIL,
            "password": VALID_PASSWORD
        })

        assert response.status_code == 201

        user = db.query(User).filter(User.email == VALID_EMAIL).first()
        assert user.initial_capital == 1000000.0  # 10 Lakhs default


# =============================================================================
# Additional Edge Case Tests
# =============================================================================
class TestEdgeCases:
    """Additional edge case and security tests."""

    def test_passwords_are_hashed_not_stored_plaintext(
        self, client: TestClient, db: Session, test_password: str
    ):
        """Test: Verify passwords are hashed, not stored as plaintext."""
        response = client.post("/api/auth/register", json={
            "email": VALID_EMAIL,
            "password": test_password
        })

        assert response.status_code == 201

        user = db.query(User).filter(User.email == VALID_EMAIL).first()
        assert user.hashed_password != test_password
        assert user.hashed_password.startswith("$2b$")  # bcrypt prefix

    def test_bcrypt_hash_is_verifiable(
        self, test_user: User, test_password: str
    ):
        """Test: Verify bcrypt hash can be verified."""
        from api.auth import verify_password

        assert verify_password(test_password, test_user.hashed_password) is True
        assert verify_password("wrongpassword", test_user.hashed_password) is False

    def test_jwt_tokens_have_correct_algorithm(
        self, client: TestClient, test_user: User, test_password: str
    ):
        """Test: Verify JWT tokens use HS256 algorithm."""
        response = client.post("/api/auth/login", json={
            "email": test_user.email,
            "password": test_password
        })

        data = response.json()

        # Decode without verification to check headers
        access_header = jwt.get_unverified_header(data["access_token"])
        refresh_header = jwt.get_unverified_header(data["refresh_token"])

        assert access_header["alg"] == JWT_ALGORITHM
        assert refresh_header["alg"] == JWT_ALGORITHM

    def test_multiple_sessions_can_exist_for_same_user(
        self,
        client: TestClient,
        test_user: User,
        test_password: str,
        db: Session
    ):
        """Test: Verify user can have multiple active sessions."""
        # Login first time
        response1 = client.post("/api/auth/login", json={
            "email": test_user.email,
            "password": test_password
        })
        data1 = response1.json()

        # Login second time
        response2 = client.post("/api/auth/login", json={
            "email": test_user.email,
            "password": test_password
        })
        data2 = response2.json()

        # Tokens should be different
        assert data1["refresh_token"] != data2["refresh_token"]

        # Both sessions should exist
        sessions = db.query(UserSession).filter(
            UserSession.user_id == test_user.id,
            UserSession.revoked == False
        ).all()

        assert len(sessions) >= 2

    def test_user_cannot_access_other_users_sessions(
        self,
        client: TestClient,
        multiple_users: list[User],
        test_password: str
    ):
        """Test: Verify users can only access their own sessions."""
        # Login as first user
        user1 = multiple_users[0]
        response = client.post("/api/auth/login", json={
            "email": user1.email,
            "password": test_password
        })

        assert response.status_code == 200
        data = response.json()

        # Verify the token belongs to user1
        payload = jwt.decode(
            data["access_token"],
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM]
        )
        assert int(payload["sub"]) == user1.id
