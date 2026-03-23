FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install dependencies
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Ensure the database directory exists (for local SQLite fallback)
RUN mkdir -p /app/db

EXPOSE 8765

# Run the FastAPI server
CMD ["uvicorn", "api_server_fastapi:app", "--host", "0.0.0.0", "--port", "8765"]
