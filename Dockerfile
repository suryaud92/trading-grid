# Runs the whole app (API + frontend) in one container.
# Works on Hugging Face Spaces, Render, Fly.io, Koyeb, Cloud Run.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# HF Spaces runs containers as UID 1000. Match it, or the app can't write
# instance/settings.json when you save your Kite credentials. Harmless elsewhere.
RUN useradd -m -u 1000 appuser

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
RUN mkdir -p /app/instance && chown -R appuser:appuser /app
USER appuser

# ONE worker on purpose: the Kite tick websocket and its in-memory tick cache
# are per-process. Multiple workers would open multiple sockets and serve
# whichever cache a request happened to land on. Concurrency comes from threads.
ENV PORT=7860
EXPOSE 7860
CMD exec gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 8 --timeout 120 app:app
