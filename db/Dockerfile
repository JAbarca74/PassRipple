# Local and CI database: PostgreSQL 18 with pgTAP for database tests.
# Production runs on Neon; keep the major version the same as the Neon project.
# This image is never deployed.
# Pinned by digest so a re-pushed tag cannot change what we build; Dependabot bumps it weekly.
FROM postgres:18-bookworm@sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-18-pgtap \
  && rm -rf /var/lib/apt/lists/*
