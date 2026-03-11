"""
Real PostgreSQL tests for authentication functionality.

Tests differences between SQLite and PostgreSQL:
- Case sensitivity in email addresses
- Unique constraint enforcement
- Cascade delete behavior
- Transaction isolation
- Concurrent user creation
"""

import sys
from pathlib import Path
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from db.models import User, UserSession
from api.auth import hash_password, create_refresh_token, JWT_SECRET_KEY, JWT_ALGORITHM

pytestmark = pytest.mark.testcontainers


class TestUserRegistrationPostgreSQL:
    """Test user registration with real PostgreSQL database."""
    
    def test_create_user_basic(self, clean_postgres_session: Session):
        """Test basic user creation in PostgreSQL."""
        user = User(
            email="basic@example.com",
            hashed_password=hash_password("password123"),
            display_name="Basic User",
            is_active=True,
        )
        clean_postgres_session.add(user)
        clean_postgres_session.commit()
        
        assert user.id is not None
        assert user.email == "basic@example.com"
        assert user.created_at is not None
        assert user.initial_capital == 1000000.0
    
    def test_user_email_unique_constraint(self, clean_postgres_session: Session):
        """
        Test unique email constraint enforcement.
        
        PostgreSQL enforces this strictly - same as SQLite, but we verify.
        """
        user1 = User(
            email="unique@example.com",
            hashed_password=hash_password("password1"),
            display_name="User 1",
        )
        clean_postgres_session.add(user1)
        clean_postgres_session.commit()
        
        user2 = User(
            email="unique@example.com",
            hashed_password=hash_password("password2"),
            display_name="User 2",
        )
        clean_postgres_session.add(user2)
        
        with pytest.raises(IntegrityError) as exc_info:
            clean_postgres_session.commit()
        
        assert "unique" in str(exc_info.value).lower() or "duplicate" in str(exc_info.value).lower()
    
    def test_case_sensitivity_email(self, clean_postgres_session: Session):
        """
        Test case sensitivity in email addresses.
        
        PostgreSQL is case-sensitive for string comparisons by default.
        SQLite is also case-sensitive but may behave differently with LIKE.
        """
        user1 = User(
            email="CaseTest@example.com",
            hashed_password=hash_password("password"),
            display_name="Case Test",
        )
        clean_postgres_session.add(user1)
        clean_postgres_session.commit()
        
        user2 = User(
            email="casetest@example.com",
            hashed_password=hash_password("password"),
            display_name="Case Test Lower",
        )
        clean_postgres_session.add(user2)
        clean_postgres_session.commit()
        
        users = clean_postgres_session.query(User).filter(
            User.email.like("%casetest%")
        ).all()
        
        if len(users) == 1:
            assert users[0].email == "casetest@example.com"
        else:
            assert len(users) == 2
    
    def test_null_email_constraint(self, clean_postgres_session: Session):
        """Test that email cannot be null."""
        user = User(
            email=None,
            hashed_password=hash_password("password"),
            display_name="No Email",
        )
        clean_postgres_session.add(user)
        
        with pytest.raises(IntegrityError):
            clean_postgres_session.commit()
    
    def test_null_password_constraint(self, clean_postgres_session: Session):
        """Test that password cannot be null."""
        user = User(
            email="nopass@example.com",
            hashed_password=None,
            display_name="No Password",
        )
        clean_postgres_session.add(user)
        
        with pytest.raises(IntegrityError):
            clean_postgres_session.commit()


class TestCascadeDeletesPostgreSQL:
    """Test cascade delete behavior with PostgreSQL."""
    
    def test_user_delete_cascades_to_sessions(self, clean_postgres_session: Session):
        """
        Test that deleting a user cascades to their sessions.
        
        PostgreSQL cascade behavior should match model definition.
        """
        user = User(
            email="cascade@example.com",
            hashed_password=hash_password("password"),
            display_name="Cascade User",
        )
        clean_postgres_session.add(user)
        clean_postgres_session.flush()
        
        session1 = UserSession(
            id="session-1",
            user_id=user.id,
            expires_at=datetime.utcnow() + timedelta(days=1),
        )
        session2 = UserSession(
            id="session-2",
            user_id=user.id,
            expires_at=datetime.utcnow() + timedelta(days=1),
        )
        clean_postgres_session.add_all([session1, session2])
        clean_postgres_session.commit()
        
        sessions_count = clean_postgres_session.query(UserSession).filter(
            UserSession.user_id == user.id
        ).count()
        assert sessions_count == 2
        
        clean_postgres_session.delete(user)
        clean_postgres_session.commit()
        
        remaining_sessions = clean_postgres_session.query(UserSession).filter(
            UserSession.user_id == user.id
        ).count()
        assert remaining_sessions == 0
    
    def test_multiple_users_independent_deletion(self, clean_postgres_session: Session):
        """Test that deleting one user doesn't affect other users' sessions."""
        users = []
        for i in range(3):
            user = User(
                email=f"independent{i}@example.com",
                hashed_password=hash_password("password"),
                display_name=f"User {i}",
            )
            clean_postgres_session.add(user)
            clean_postgres_session.flush()
            
            session = UserSession(
                id=f"session-ind-{i}",
                user_id=user.id,
                expires_at=datetime.utcnow() + timedelta(days=1),
            )
            clean_postgres_session.add(session)
            users.append(user)
        
        clean_postgres_session.commit()
        
        clean_postgres_session.delete(users[0])
        clean_postgres_session.commit()
        
        for i in [1, 2]:
            user_exists = clean_postgres_session.query(User).filter(
                User.email == f"independent{i}@example.com"
            ).first()
            assert user_exists is not None
            
            session_exists = clean_postgres_session.query(UserSession).filter(
                UserSession.id == f"session-ind-{i}"
            ).first()
            assert session_exists is not None


class TestSessionManagementPostgreSQL:
    """Test session management with real PostgreSQL."""
    
    def test_create_session(self, clean_postgres_session: Session, pg_test_user: User):
        """Test creating a user session in PostgreSQL."""
        session = UserSession(
            id="test-session-jti",
            user_id=pg_test_user.id,
            expires_at=datetime.utcnow() + timedelta(days=7),
        )
        clean_postgres_session.add(session)
        clean_postgres_session.commit()
        
        assert session.id == "test-session-jti"
        assert session.user_id == pg_test_user.id
        assert session.revoked is False
        assert session.created_at is not None
    
    def test_session_revocation(self, clean_postgres_session: Session, pg_test_user: User):
        """Test session revocation."""
        session = UserSession(
            id="revokable-session",
            user_id=pg_test_user.id,
            expires_at=datetime.utcnow() + timedelta(days=7),
        )
        clean_postgres_session.add(session)
        clean_postgres_session.commit()
        
        session.revoked = True
        clean_postgres_session.commit()
        
        clean_postgres_session.refresh(session)
        assert session.revoked is True
    
    def test_session_unique_id_constraint(self, clean_postgres_session: Session, pg_test_user: User):
        """Test that session IDs must be unique."""
        session1 = UserSession(
            id="duplicate-session-id",
            user_id=pg_test_user.id,
            expires_at=datetime.utcnow() + timedelta(days=1),
        )
        clean_postgres_session.add(session1)
        clean_postgres_session.commit()
        
        session2 = UserSession(
            id="duplicate-session-id",
            user_id=pg_test_user.id,
            expires_at=datetime.utcnow() + timedelta(days=2),
        )
        clean_postgres_session.add(session2)
        
        with pytest.raises(IntegrityError):
            clean_postgres_session.commit()


class TestConcurrentUserCreationPostgreSQL:
    """Test concurrent user creation scenarios."""
    
    def test_concurrent_user_creation_different_emails(self, postgres_engine):
        """
        Test creating users concurrently with different emails.
        
        PostgreSQL handles concurrent inserts differently than SQLite.
        """
        from concurrent.futures import ThreadPoolExecutor
        
        def create_user(index):
            from sqlalchemy.orm import Session
            SessionLocal = sessionmaker(bind=postgres_engine)
            session = SessionLocal()
            
            try:
                user = User(
                    email=f"concurrent{index}@example.com",
                    hashed_password=hash_password("password"),
                    display_name=f"Concurrent User {index}",
                )
                session.add(user)
                session.commit()
                return True
            except Exception:
                session.rollback()
                return False
            finally:
                session.close()
        
        from sqlalchemy.orm import sessionmaker
        
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(create_user, i) for i in range(10)]
            results = [f.result() for f in as_completed(futures)]
        
        assert all(results), "All concurrent user creations should succeed"
    
    def test_concurrent_duplicate_email_detection(self, postgres_engine):
        """
        Test that concurrent attempts with same email properly fail.
        
        PostgreSQL's constraint checking happens at commit time.
        """
        from sqlalchemy.orm import sessionmaker
        
        def create_user_with_email(email):
            from sqlalchemy.orm import Session
            SessionLocal = sessionmaker(bind=postgres_engine)
            session = SessionLocal()
            
            try:
                user = User(
                    email=email,
                    hashed_password=hash_password("password"),
                    display_name="Duplicate Attempt",
                )
                session.add(user)
                session.commit()
                return True
            except IntegrityError:
                session.rollback()
                return False
            except Exception:
                session.rollback()
                return False
            finally:
                session.close()
        
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = [
                executor.submit(create_user_with_email, "same@example.com")
                for _ in range(3)
            ]
            results = [f.result() for f in as_completed(futures)]
        
        successful = sum(1 for r in results if r)
        assert successful == 1, "Only one concurrent creation should succeed"


class TestTransactionBehaviorPostgreSQL:
    """Test PostgreSQL transaction behavior differences from SQLite."""
    
    def test_transaction_isolation(self, clean_postgres_session: Session):
        """
        Test transaction isolation levels.
        
        PostgreSQL has more sophisticated isolation than SQLite.
        """
        user = User(
            email="isolation@example.com",
            hashed_password=hash_password("password"),
            display_name="Isolation Test",
        )
        clean_postgres_session.add(user)
        clean_postgres_session.flush()
        
        user_id = user.id
        assert user_id is not None
        
        clean_postgres_session.rollback()
        
        found = clean_postgres_session.query(User).filter(
            User.email == "isolation@example.com"
        ).first()
        assert found is None
    
    def test_nested_transaction_savepoint(self, clean_postgres_session: Session):
        """Test savepoints within transactions."""
        user1 = User(
            email="savepoint1@example.com",
            hashed_password=hash_password("password"),
            display_name="Savepoint 1",
        )
        clean_postgres_session.add(user1)
        clean_postgres_session.flush()
        
        savepoint = clean_postgres_session.begin_nested()
        
        user2 = User(
            email="savepoint2@example.com",
            hashed_password=hash_password("password"),
            display_name="Savepoint 2",
        )
        clean_postgres_session.add(user2)
        savepoint.rollback()
        
        clean_postgres_session.commit()
        
        found1 = clean_postgres_session.query(User).filter(
            User.email == "savepoint1@example.com"
        ).first()
        found2 = clean_postgres_session.query(User).filter(
            User.email == "savepoint2@example.com"
        ).first()
        
        assert found1 is not None
        assert found2 is None
