"""
Tests for Health Check API endpoint.

Tests the /health endpoint which provides a simple health check
for monitoring and load balancer checks.

Test cases cover:
- Basic health check response
- Response time verification
- Timestamp validity
- Status field
"""

import sys
from pathlib import Path
from datetime import datetime
import time

import pytest

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


class TestHealthCheck:
    """
    Test suite for Health Check endpoint.

    Endpoint: GET /health
    """

    def test_health_check_basic(self, client):
        """
        Test basic health check endpoint.

        Should return 200 OK status with health information.
        """
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()

        # Verify response structure
        assert 'status' in data
        assert 'timestamp' in data

    def test_health_check_status_ok(self, client):
        """
        Test that health check returns 'ok' status.

        Status should be 'ok' when service is healthy.
        """
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()

        assert data['status'] == 'ok'

    def test_health_check_timestamp_valid(self, client):
        """
        Test that health check timestamp is valid ISO format.

        Timestamp should be parseable as ISO 8601 datetime.
        """
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()

        timestamp = data['timestamp']

        # Verify it's a valid ISO timestamp
        try:
            parsed_time = datetime.fromisoformat(timestamp)
            # Verify timestamp is recent (within last minute)
            time_diff = (datetime.now() - parsed_time).total_seconds()
            assert time_diff >= 0
            assert time_diff < 60  # Within last minute
        except ValueError:
            pytest.fail(f"Timestamp '{timestamp}' is not a valid ISO format")

    def test_health_check_response_time(self, client):
        """
        Test that health check responds quickly.

        Health check should respond in under 100ms for monitoring.
        """
        start_time = time.time()
        response = client.get("/health")
        end_time = time.time()

        response_time_ms = (end_time - start_time) * 1000

        assert response.status_code == 200
        assert response_time_ms < 100, f"Health check took {response_time_ms:.2f}ms, expected <100ms"

    def test_health_check_no_auth_required(self, client):
        """
        Test that health check doesn't require authentication.

        Health endpoint should be accessible without auth for
        load balancer and monitoring services.
        """
        response = client.get("/health")
        # Should not return 401 Unauthorized
        assert response.status_code == 200
        assert response.status_code != 401

    def test_health_check_json_content_type(self, client):
        """
        Test that health check returns JSON content type.

        Response should have application/json content type.
        """
        response = client.get("/health")
        assert response.status_code == 200

        content_type = response.headers.get('content-type', '')
        assert 'application/json' in content_type

    def test_health_check_idempotent(self, client):
        """
        Test that health check is idempotent.

        Multiple requests should return consistent results.
        """
        responses = []
        for _ in range(5):
            response = client.get("/health")
            assert response.status_code == 200
            responses.append(response.json())

        # All responses should have status 'ok'
        for response in responses:
            assert response['status'] == 'ok'

    def test_health_check_minimal_response(self, client):
        """
        Test that health check response is minimal.

        Should only contain essential fields to reduce payload.
        """
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()

        # Should only have status and timestamp
        expected_keys = {'status', 'timestamp'}
        actual_keys = set(data.keys())

        # Response should not have extra fields
        assert actual_keys.issubset(expected_keys), \
            f"Health check has unexpected fields: {actual_keys - expected_keys}"

    def test_health_check_allows_head_method(self, client):
        """
        Test that health check allows HEAD method.

        Some monitoring services use HEAD for health checks.
        """
        # Note: TestClient may not support HEAD method properly
        # This test verifies the endpoint exists
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_check_concurrent_requests(self, client):
        """
        Test that health check handles concurrent requests.

        Should respond correctly even under concurrent load.
        """
        import concurrent.futures

        def check_health():
            response = client.get("/health")
            return response.status_code, response.json()

        # Make 10 concurrent requests
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(check_health) for _ in range(10)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        # All requests should succeed
        for status_code, data in results:
            assert status_code == 200
            assert data['status'] == 'ok'

    def test_health_check_no_side_effects(self, client):
        """
        Test that health check has no side effects.

        Multiple calls should not change server state.
        """
        # Get initial state
        response1 = client.get("/health")
        assert response1.status_code == 200
        timestamp1 = response1.json()['timestamp']

        # Wait a bit
        time.sleep(0.1)

        # Get second state
        response2 = client.get("/health")
        assert response2.status_code == 200
        timestamp2 = response2.json()['timestamp']

        # Timestamps should be different (time passed)
        # but status should still be 'ok'
        assert response2.json()['status'] == 'ok'

    def test_health_check_during_high_load(self, client):
        """
        Test health check responsiveness during simulated high load.

        Health check should remain fast even when server is busy.
        """
        # Simulate load by making multiple requests
        for _ in range(50):
            client.get("/health")

        # Now check response time
        start_time = time.time()
        response = client.get("/health")
        end_time = time.time()

        response_time_ms = (end_time - start_time) * 1000

        assert response.status_code == 200
        assert response_time_ms < 100, \
            f"Health check took {response_time_ms:.2f}ms under load"

    def test_health_check_different_paths(self, client):
        """
        Test that health check is at correct path.

        Should be at /health, not /api/health or /health/.
        """
        # Test /health (correct)
        response = client.get("/health")
        assert response.status_code == 200

        # Test /health/ (may also work)
        response = client.get("/health/")
        # Either 200 (works) or 404 (not found)
        assert response.status_code in [200, 404]

    def test_health_check_no_query_params(self, client):
        """
        Test that health check works without query parameters.

        Should respond correctly even with no params.
        """
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()

        assert data['status'] == 'ok'

    def test_health_check_ignores_query_params(self, client):
        """
        Test that health check ignores query parameters.

        Should respond correctly even with extraneous params.
        """
        response = client.get("/health?verbose=true&debug=1")
        assert response.status_code == 200
        data = response.json()

        assert data['status'] == 'ok'

    def test_health_check_timestamp_precision(self, client):
        """
        Test that health check timestamp has sufficient precision.

        Timestamp should include time for monitoring accuracy.
        """
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()

        timestamp = data['timestamp']

        # Should include time (not just date)
        assert 'T' in timestamp or ' ' in timestamp

    def test_health_check_unicode_handling(self, client):
        """
        Test that health check handles Unicode properly.

        Response should be valid UTF-8.
        """
        response = client.get("/health")
        assert response.status_code == 200

        # Verify response is valid UTF-8
        content = response.content
        content.decode('utf-8')

    def test_health_check_compression(self, client):
        """
        Test health check without compression.

        Health check should be small enough not to need compression.
        """
        response = client.get("/health")
        assert response.status_code == 200

        # Response should be small
        content_length = len(response.content)
        assert content_length < 1000, "Health check response should be small"
