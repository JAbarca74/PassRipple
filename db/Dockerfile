# Local and CI database: PostgreSQL 17 with pgTAP for database tests.
# Production runs on Neon; this image is never deployed.
FROM postgres:17-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17-pgtap \
  && rm -rf /var/lib/apt/lists/*
