FROM python:3.12-slim as builder

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/install/bin:${PATH}" \
    GUNICORN_WORKERS=4 \
    GUNICORN_THREADS=2

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /install
COPY . .

RUN mkdir -p /app/staticfiles /app/media /app/logs

RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health/ || exit 1

CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:8000 --workers ${GUNICORN_WORKERS} --threads ${GUNICORN_THREADS} --worker-class sync --max-requests 1000 --max-requests-jitter 50 config.wsgi:application"]
