# Python and Debian runtime; the web app has no pip dependencies.
FROM python:3.13-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOST=0.0.0.0 \
    PORT=8000 \
    RAZMETKA_DATA_DIR=/data/main \
    TASK_CHATS_DATA_DIR=/data/task-chats \
    RAZMETKA_AUTH_DB=/data/auth/users.sqlite3

WORKDIR /app

# A fixed UID/GID makes persistent-volume permissions predictable.
RUN groupadd --gid 10001 razmetka \
    && useradd --uid 10001 --gid razmetka --no-create-home \
        --shell /usr/sbin/nologin razmetka \
    && mkdir -p /data/main /data/task-chats /data/auth \
    && chown -R razmetka:razmetka /data

# Copy only the runtime. JSON, media and credentials are mounted separately.
COPY server.py space.py auth.py ./
COPY app/ ./app/

USER 10001:10001

# Metadata only: publishing a host port is a separate docker run / Compose setting.
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; r = urllib.request.urlopen('http://127.0.0.1:' + os.environ['PORT'] + '/api/auth', timeout=3); assert r.status == 200"]

ENTRYPOINT ["python", "server.py"]
CMD ["project"]
