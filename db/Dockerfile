# Local and CI database: PostgreSQL 18 with pgTAP for database tests.
# Production runs on Neon; keep the major version the same as the Neon project.
# This image is never deployed.
FROM postgres:18-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-18-pgtap \
  && rm -rf /var/lib/apt/lists/*
