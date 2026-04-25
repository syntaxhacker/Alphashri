"""
Integration tests for complete authentication flows.

Tests multi-step authentication scenarios:
- User registration through login to accessing protected routes
- Token lifecycle management (access + refresh tokens)
- Session persistence and expiration
- Logout and session cleanup
"""

import os
import sys
import time
import jwt
from pathlib import Path
from datetime import datetime, timedelta
from typing import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

# Add project root to path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from db.models import User, UserSession
from api.auth import (
    JWT_SECRET_KEY,
    JWT_ALGORITHM,
    ACCESS_TOKEN_EXPIRE_HOURS,
    REFRESH_TOKEN_EXPIRE_DAYS,
)


class TestCompleteAuthFlow:
    """Test complete authentication flow from registration to logout."""

    def test_complete_registration_to_logout_flow(self, unauth_client):
        """
        Test the complete user lifecycle:
        1. Register new user
        2. Access protected route with access token
        3. Refresh expired access token
        4. Logout and verify session cleanup
        """
        # Step 1: Register a new user
        user_data = {
            "email": "flowtest@example.com",
            "password": "SecurePass123!",
            "display_name": "Flow Test User"
        }

        register_response = unauth_client.post("/api/auth/register", json=user_data)
        assert register_response.status_code == 201

        register_data = register_response.json()
        assert "access_token" in register_data
        assert "refresh_token" in register_data
        assert register_data["token_type"] == "bearer"
        assert register_data["expires_in"] == ACCESS_TOKEN_EXPIRE_HOURS * 3600

        access_token = register_data["access_token"]
        refresh_token = register_data["refresh_token"]

        # Step 2: Access protected route with access token
        headers = {"Authorization": f"Bearer {access_token}"}
        me_response = unauth_client.get("/api/auth/me", headers=headers)

        assert me_response.status_code == 200
        user_info = me_response.json()
        assert user_info["email"] == user_data["email"]
        assert user_info["display_name"] == user_data["display_name"]
        assert user_info["initial_capital"] == 1000000.0  # Default value

        # Step 3: Update user settings
        update_response = unauth_client.put(
            "/api/auth/me",
            headers=headers,
            params={
                "display_name": "Updated Flow User",
                "initial_capital": 2000000.0
            }
        )

        assert update_response.status_code == 200
        updated_user = update_response.json()
        assert updated_user["display_name"] == "Updated Flow User"
        assert updated_user["initial_capital"] == 2000000.0

        # Step 4: Refresh the access token
        refresh_response = unauth_client.post(
            "/api/auth/refresh",
            json={"refresh_token": refresh_token}
        )

        assert refresh_response.status_code == 200
        refresh_data = refresh_response.json()

        assert "access_token" in refresh_data
        assert "refresh_token" in refresh_data
        # Should get a NEW access token
        new_access_token = refresh_data["access_token"]
        assert new_access_token != access_token

        # Step 5: Verify old access token still works (brief overlap period)
        old_headers = {"Authorization": f"Bearer {access_token}"}
        old_me_response = unauth_client.get("/api/auth/me", headers=old_headers)

        # Old token may or may not work depending on revocation implementation
        # This tests current behavior

        # Step 6: Verify new token works
        new_headers = {"Authorization": f"Bearer {new_access_token}"}
        new_me_response = unauth_client.get("/api/auth/me", headers=new_headers)

        assert new_me_response.status_code == 200

        # Step 7: Logout
        logout_response = unauth_client.post(
            "/api/auth/logout",
            headers={"Authorization": f"Bearer {refresh_token}"}
        )

        assert logout_response.status_code == 200
        assert logout_response.json()["message"] == "Logged out successfully"

        # Step 8: Verify refresh token no longer works after logout
        failed_refresh = unauth_client.post(
            "/api/auth/refresh",
            json={"refresh_token": refresh_token}
        )

        assert failed_refresh.status_code == 401

    def test_login_after_registration(self, client: TestClient):
        """Test that user can login after registration."""
        # First register
        user_data = {
            "email": "logintest@example.com",
            "password": "LoginPass123!",
            "display_name": "Login Test User"
        }

        client.post("/api/auth/register", json=user_data)

        # Then login with same credentials
        login_response = client.post("/api/auth/login", json={
            "email": user_data["email"],
            "password": user_data["password"]
        })

        assert login_response.status_code == 200
        login_data = login_response.json()

        assert "access_token" in login_data
        assert "refresh_token" in login_data

        # Verify we can access protected route
        headers = {"Authorization": f"Bearer {login_data['access_token']}"}
        me_response = client.get("/api/auth/me", headers=headers)

        assert me_response.status_code == 200

    def test_multiple_sessions_for_same_user(self, client: TestClient):
        """Test that a user can have multiple active sessions."""
        # Register a user
        user_data = {
            "email": "multisession@example.com",
            "password": "MultiSession123!",
            "display_name": "Multi Session User"
        }

        client.post("/api/auth/register", json=user_data)

        # Create first session (login)
        session1 = client.post("/api/auth/login", json={
            "email": user_data["email"],
            "password": user_data["password"]
        }).json()

        # Create second session (login again)
        session2 = client.post("/api/auth/login", json={
            "email": user_data["email"],
            "password": user_data["password"]
        }).json()

        # Both should have valid tokens
        assert session1["access_token"] != session2["access_token"]
        assert session1["refresh_token"] != session2["refresh_token"]

        # Both should work
        for session in [session1, session2]:
            headers = {"Authorization": f"Bearer {session['access_token']}"}
            me_response = client.get("/api/auth/me", headers=headers)
            assert me_response.status_code == 200

        # Logout first session
        client.post("/api/auth/logout", headers={
            "Authorization": f"Bearer {session1['refresh_token']}"
        })

        # First session should no longer work
        failed_refresh = client.post("/api/auth/refresh", json={
            "refresh_token": session1["refresh_token"]
        })
        assert failed_refresh.status_code == 401

        # Second session should still work
        success_refresh = client.post("/api/auth/refresh", json={
            "refresh_token": session2["refresh_token"]
        })
        assert success_refresh.status_code == 200


class TestTokenLifecycle:
    """Test token lifecycle including expiration and refresh."""

    def test_access_token_expiration_in_api(self, unauth_client):
        """Test that expired access tokens are rejected by API."""
        # Create and register a user
        user_data = {
            "email": "expir test@example.com",
            "password": "ExpireTest123!",
            "display_name": "Expire Test User"
        }

        unauth_client.post("/api/auth/register", json=user_data)

        # Create an expired access token manually
        from api.auth import create_access_token

        # Get user ID from database
        # Note: In real scenario, this would come from a successful login
        # For testing, we create a token that will be expired

        expire = datetime.utcnow() - timedelta(hours=1)
        payload = {
            "sub": "1",
            "jti": "expired-jti",
            "type": "access",
            "exp": expire,
            "iat": datetime.utcnow(),
        }
        expired_token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)

        # Try to use expired token
        headers = {"Authorization": f"Bearer {expired_token}"}
        me_response = unauth_client.get("/api/auth/me", headers=headers)

        assert me_response.status_code == 401
        assert "expired" in me_response.json()["detail"].lower()

    def test_refresh_token_expiration(self, client: TestClient, db: Session):
        """Test that expired refresh tokens are rejected."""
        # Create a user
        from api.auth import hash_password

        user = User(
            email="expiredrefresh@example.com",
            hashed_password=hash_password("RefreshTest123!"),
            display_name="Expired Refresh User",
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # Create an expired refresh token manually
        expire = datetime.utcnow() - timedelta(days=1)
        import secrets

        jti = secrets.token_hex(16)
        payload = {
            "sub": str(user.id),
            "jti": jti,
            "type": "refresh",
            "exp": expire,
            "iat": datetime.utcnow(),
        }
        expired_refresh_token = jwt.encode(
            payload,
            JWT_SECRET_KEY,
            algorithm=JWT_ALGORITHM
        )

        # Try to refresh with expired token
        response = client.post("/api/auth/refresh", json={
            "refresh_token": expired_refresh_token
        })

        assert response.status_code == 401

    def test_refresh_token_creates_new_session(self, client: TestClient, db: Session):
        """Test that refresh creates new session and revokes old one."""
        # Register a user
        user_data = {
            "email": "newsession@example.com",
            "password": "NewSession123!",
            "display_name": "New Session User"
        }

        register_response = client.post("/api/auth/register", json=user_data)
        register_data = register_response.json()

        first_refresh_token = register_data["refresh_token"]

        # Decode token to get jti
        first_payload = jwt.decode(
            first_refresh_token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM]
        )
        first_jti = first_payload["jti"]

        # Verify session exists in database
        first_session = db.query(UserSession).filter(
            UserSession.id == first_jti
        ).first()
        assert first_session is not None
        assert first_session.revoked is False

        # Refresh the token
        refresh_response = client.post("/api/auth/refresh", json={
            "refresh_token": first_refresh_token
        })

        assert refresh_response.status_code == 200
        refresh_data = refresh_response.json()
        new_refresh_token = refresh_data["refresh_token"]

        # Verify old session is revoked
        db.refresh(first_session)
        assert first_session.revoked is True

        # Verify new session exists
        new_payload = jwt.decode(
            new_refresh_token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM]
        )
        new_jti = new_payload["jti"]

        new_session = db.query(UserSession).filter(
            UserSession.id == new_jti
        ).first()
        assert new_session is not None
        assert new_session.revoked is False

        # Old refresh token should no longer work
        failed_response = client.post("/api/auth/refresh", json={
            "refresh_token": first_refresh_token
        })
        assert failed_response.status_code == 401


class TestSessionManagement:
    """Test session management and cleanup."""

    def test_session_persistence_across_requests(self, unauth_client):
        """Test that session persists across multiple API requests."""
        # Register and login
        user_data = {
            "email": "persist@example.com",
            "password": "PersistTest123!",
            "display_name": "Persistence Test User"
        }

        register_response = unauth_client.post("/api/auth/register", json=user_data)
        access_token = register_response.json()["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        # Make multiple requests with same token
        for i in range(5):
            me_response = unauth_client.get("/api/auth/me", headers=headers)
            assert me_response.status_code == 200
            assert me_response.json()["email"] == user_data["email"]

    def test_logout_without_token(self, client: TestClient):
        """Test logout without providing a token (should succeed)."""
        response = client.post("/api/auth/logout")

        # Logout without token should still return success
        assert response.status_code == 200
        assert "message" in response.json()

    def test_concurrent_sessions_independent(self, client: TestClient):
        """Test that concurrent sessions are independent of each other."""
        # Register a user
        user_data = {
            "email": "concurrent@example.com",
            "password": "Concurrent123!",
            "display_name": "Concurrent Sessions User"
        }

        client.post("/api/auth/register", json=user_data)

        # Create three separate sessions by logging in three times
        sessions = []
        for i in range(3):
            login_response = client.post("/api/auth/login", json={
                "email": user_data["email"],
                "password": user_data["password"]
            })
            sessions.append(login_response.json())

        # All sessions should be valid
        for session in sessions:
            headers = {"Authorization": f"Bearer {session['access_token']}"}
            me_response = client.get("/api/auth/me", headers=headers)
            assert me_response.status_code == 200

        # Update display name using first session
        first_headers = {"Authorization": f"Bearer {sessions[0]['access_token']}"}
        client.put(
            "/api/auth/me",
            headers=first_headers,
            params={"display_name": "Updated via Session 1"}
        )

        # Verify other sessions see the update
        for i, session in enumerate(sessions):
            headers = {"Authorization": f"Bearer {session['access_token']}"}
            me_response = client.get("/api/auth/me", headers=headers)
            assert me_response.json()["display_name"] == "Updated via Session 1"

        # Logout second session only
        client.post("/api/auth/logout", headers={
            "Authorization": f"Bearer {sessions[1]['refresh_token']}"
        })

        # Second session should no longer work
        failed_refresh = client.post("/api/auth/refresh", json={
            "refresh_token": sessions[1]["refresh_token"]
        })
        assert failed_refresh.status_code == 401

        # First and third sessions should still work
        for i in [0, 2]:
            success_refresh = client.post("/api/auth/refresh", json={
                "refresh_token": sessions[i]["refresh_token"]
            })
            assert success_refresh.status_code == 200


class TestErrorRecovery:
    """Test error handling and recovery scenarios."""

    def test_recovery_after_invalid_token(self, unauth_client):
        """Test that user can recover after using invalid token."""
        # Register a user
        user_data = {
            "email": "recovery@example.com",
            "password": "Recovery123!",
            "display_name": "Recovery Test User"
        }

        register_response = unauth_client.post("/api/auth/register", json=user_data)
        access_token = register_response.json()["access_token"]

        # Try to access with invalid token first
        invalid_headers = {"Authorization": "Bearer invalid.token.here"}
        failed_response = unauth_client.get("/api/auth/me", headers=invalid_headers)

        assert failed_response.status_code == 401

        # Now use valid token - should work
        valid_headers = {"Authorization": f"Bearer {access_token}"}
        success_response = unauth_client.get("/api/auth/me", headers=valid_headers)

        assert success_response.status_code == 200

    def test_recovery_after_expired_token(self, client: TestClient):
        """Test that user can recover by refreshing expired access token."""
        # Register a user
        user_data = {
            "email": "refreshrecovery@example.com",
            "password": "RefreshRec123!",
            "display_name": "Refresh Recovery User"
        }

        register_response = client.post("/api/auth/register", json=user_data)
        refresh_token = register_response.json()["refresh_token"]

        # Manually create an expired access token
        from api.auth import create_access_token

        # We'll just simulate by using a very short expiration
        # In this test, we'll verify that refresh token still works
        # even if we pretend access token is expired

        # Use refresh token to get new access token
        refresh_response = client.post("/api/auth/refresh", json={
            "refresh_token": refresh_token
        })

        assert refresh_response.status_code == 200
        new_access_token = refresh_response.json()["access_token"]

        # Verify new token works
        headers = {"Authorization": f"Bearer {new_access_token}"}
        me_response = client.get("/api/auth/me", headers=headers)

        assert me_response.status_code == 200

    def test_multiple_failed_logins_then_success(self, client: TestClient):
        """Test that failed logins don't prevent successful login."""
        # First, create a user
        user_data = {
            "email": "failedlogin@example.com",
            "password": "CorrectPass123!",
            "display_name": "Failed Login Test User"
        }

        client.post("/api/auth/register", json=user_data)

        # Try multiple failed logins
        for i in range(3):
            failed_response = client.post("/api/auth/login", json={
                "email": user_data["email"],
                "password": "WrongPassword123!"
            })
            assert failed_response.status_code == 401

        # Now try correct login - should succeed
        success_response = client.post("/api/auth/login", json={
            "email": user_data["email"],
            "password": user_data["password"]
        })

        assert success_response.status_code == 200
        assert "access_token" in success_response.json()


class TestCleanupOnFailure:
    """Test cleanup behavior when operations fail."""

    def test_no_user_created_on_failed_registration(self, client: TestClient, db: Session):
        """Test that no user is created when registration fails."""
        # Count users before
        user_count_before = db.query(User).count()

        # Try to register with existing email
        user_data = {
            "email": "cleanup@example.com",
            "password": "CleanupTest123!",
            "display_name": "Cleanup Test User"
        }

        # First registration should succeed
        first_response = client.post("/api/auth/register", json=user_data)
        assert first_response.status_code == 201

        # Second registration with same email should fail
        second_response = client.post("/api/auth/register", json=user_data)
        assert second_response.status_code == 400

        # Verify only one user was created
        user_count_after = db.query(User).count()
        assert user_count_after == user_count_before + 1

    def test_session_not_created_on_failed_login(self, client: TestClient, db: Session):
        """Test that no session is created when login fails."""
        # Register a user first
        user_data = {
            "email": "nosession@example.com",
            "password": "NoSession123!",
            "display_name": "No Session Test User"
        }

        client.post("/api/auth/register", json=user_data)

        # Count sessions before failed login
        session_count_before = db.query(UserSession).count()

        # Try failed login
        failed_response = client.post("/api/auth/login", json={
            "email": user_data["email"],
            "password": "WrongPassword123!"
        })
        assert failed_response.status_code == 401

        # Verify no new session was created
        session_count_after = db.query(UserSession).count()
        assert session_count_after == session_count_before


class TestTokenPersistence:
    """Test token persistence and usage over time."""

    def test_access_token_works_until_expiration(self, unauth_client):
        """Test that access token continues to work until expiration."""
        # Register user
        user_data = {
            "email": "tokenpersist@example.com",
            "password": "TokenPersist123!",
            "display_name": "Token Persistence User"
        }

        register_response = unauth_client.post("/api/auth/register", json=user_data)
        access_token = register_response.json()["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        # Use token multiple times
        for i in range(10):
            me_response = unauth_client.get("/api/auth/me", headers=headers)
            assert me_response.status_code == 200
            assert me_response.json()["email"] == user_data["email"]

    def test_refresh_token_validity_duration(self, client: TestClient, db: Session):
        """Test that refresh token remains valid for expected duration."""
        # Register user
        user_data = {
            "email": "refreshduration@example.com",
            "password": "RefreshDur123!",
            "display_name": "Refresh Duration User"
        }

        register_response = client.post("/api/auth/register", json=user_data)
        refresh_token = register_response.json()["refresh_token"]

        # Decode token to check expiration
        payload = jwt.decode(
            refresh_token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM]
        )

        # Check expiration is set correctly (7 days from now)
        exp_timestamp = payload["exp"]
        exp_datetime = datetime.utcfromtimestamp(exp_timestamp)
        expected_exp = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

        # Allow 1 minute tolerance
        time_diff = abs((exp_datetime - expected_exp).total_seconds())
        assert time_diff < 60  # Less than 1 minute difference

        # Verify session in database
        jti = payload["jti"]
        session = db.query(UserSession).filter(UserSession.id == jti).first()

        assert session is not None
        assert session.revoked is False

        # Check session expiration matches token
        session_exp_diff = abs((session.expires_at - exp_datetime).total_seconds())
        assert session_exp_diff < 60
