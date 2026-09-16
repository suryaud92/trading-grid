# Runs the whole app (API + static frontend) in one container.
# Works on Hugging Face Spaces, Render, Fly.io, Koyeb, Cloud Run.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# ONE worker on purpose: the Kite tick websocket and its in-memory tick cache
# are per-process. Multiple workers would open multiple sockets and serve
# whichever cache the request happened to land on. Concurrency comes from
# threads instead.
ENV PORT=7860
CMD exec gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 8 --timeout 120 app:app
