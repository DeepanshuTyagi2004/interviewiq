FROM python:3.11-slim

WORKDIR /app

# System deps kept minimal; lxml/bs4 ship manylinux wheels so no build toolchain needed.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Non-root.
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000

# Host runs llama.cpp; this service reaches it via LLM_BASE_URL (never hardcoded).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
