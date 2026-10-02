-- Proof of consent: every acceptance or refusal is kept, with the version of the legal
-- document it referred to. Published documents and consents are append-only: changing a
-- choice adds a new consent, and a new text is a new document version.

CREATE TABLE privacy.legal_documents (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text        NOT NULL CHECK (kind IN ('terms', 'privacy', 'cookies')),
  version        text        NOT NULL CHECK (version ~ '^[0-9A-Za-z][0-9A-Za-z._-]*$' AND length(version) <= 32),
  -- SHA-256 of the published text, so the version a person accepted can be proven.
  content_sha256 bytea       NOT NULL CHECK (length(content_sha256) = 32),
  published_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version)
);

CREATE TABLE privacy.consents (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A user's id, or an anonymous identifier for buyers. Never contact data.
  subject_id       uuid        NOT NULL,
  purpose          text        NOT NULL
                   CHECK (purpose IN ('terms', 'privacy', 'analytics', 'ads', 'marketing', 'id_data')),
  granted          boolean     NOT NULL,
  document_version text        NOT NULL CHECK (btrim(document_version) <> ''),
  source           text        NOT NULL CHECK (source IN ('checkout', 'banner', 'wallet', 'onboarding')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_subject_idx ON privacy.consents (subject_id, purpose, created_at);

CREATE TRIGGER legal_documents_append_only BEFORE UPDATE OR DELETE ON privacy.legal_documents
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER legal_documents_no_truncate BEFORE TRUNCATE ON privacy.legal_documents
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER consents_append_only BEFORE UPDATE OR DELETE ON privacy.consents
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER consents_no_truncate BEFORE TRUNCATE ON privacy.consents
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

-- ── Row Level Security ───────────────────────────────────────────────────────
-- The API never writes these tables. Published documents are public; a person with an
-- account sees their own consents, and administrators see all of them.
ALTER TABLE privacy.legal_documents ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE privacy.consents        ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY legal_documents_read ON privacy.legal_documents FOR SELECT USING (true);
CREATE POLICY legal_documents_module_write ON privacy.legal_documents TO passripple_owner_privacy
  USING (true) WITH CHECK (true);
CREATE POLICY consents_module_read ON privacy.consents FOR SELECT USING (app.is_module_role());
CREATE POLICY consents_module_write ON privacy.consents TO passripple_owner_privacy
  USING (true) WITH CHECK (true);
CREATE POLICY consents_api_read ON privacy.consents FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin' OR subject_id = (SELECT app.actor_id()));

GRANT USAGE ON SCHEMA privacy TO passripple_api;
GRANT SELECT ON privacy.legal_documents, privacy.consents TO passripple_api;

-- ── Functions ────────────────────────────────────────────────────────────────
-- Records a consent. A person with an account records only their own; a buyer, who has
-- none, records it under an anonymous identifier.
CREATE FUNCTION privacy.record_consent(
  p_subject_id uuid, p_purpose text, p_granted boolean, p_document_version text, p_source text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_consent_id uuid;
BEGIN
  IF app.actor_role() IS NULL THEN
    RAISE EXCEPTION 'no actor is set' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app.actor_id() IS NOT NULL AND p_subject_id IS DISTINCT FROM app.actor_id() THEN
    RAISE EXCEPTION 'a person records only their own consent' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO privacy.consents (subject_id, purpose, granted, document_version, source)
  VALUES (p_subject_id, p_purpose, p_granted, p_document_version, p_source)
  RETURNING id INTO v_consent_id;
  RETURN v_consent_id;
END
$$;

-- Publishes a new version of a legal document. Only administrators.
CREATE FUNCTION privacy.publish_document(p_kind text, p_version text, p_content_sha256 bytea)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_document_id uuid;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only an administrator publishes legal documents' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO privacy.legal_documents (kind, version, content_sha256)
  VALUES (p_kind, p_version, p_content_sha256)
  RETURNING id INTO v_document_id;
  RETURN v_document_id;
END
$$;

GRANT EXECUTE ON FUNCTION privacy.record_consent(uuid, text, boolean, text, text) TO passripple_api;
GRANT EXECUTE ON FUNCTION privacy.publish_document(text, text, bytea) TO passripple_api;
