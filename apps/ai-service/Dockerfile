FROM python:3.11-slim

WORKDIR /app

# System deps kept minimal; lxml/bs4 ship manylinux wheels so no build toolchain needed.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY --chmod=755 start.sh ./start.sh

# Non-root.
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000

# Host runs llama.cpp; this service reaches it via LLM_BASE_URL (never hardcoded).
# LiveKit Cloud agent hosting runs this image as the voice worker (it needs a fixed start command, no wrapper script).
# Render overrides it with dockerCommand ./start.sh, which runs the HTTP API on $PORT (and, with INTERVIEWER_IN_CONTAINER=true, the worker too).
CMD ["python", "-m", "app.interviewer.worker", "start"]
