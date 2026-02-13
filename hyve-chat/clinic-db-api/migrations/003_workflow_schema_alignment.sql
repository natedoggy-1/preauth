-- ============================================================================
-- Migration 003: Workflow Schema Alignment + Documents Table
-- ============================================================================
-- The n8n chat-v3-sections workflow queries columns that don't exist in the
-- tables created by migration 002. This migration adds those columns and
-- backfills them from existing data. Also creates the documents table for
-- the ingestion pipeline.
--
-- Run AFTER 002_missing_tables_and_columns.sql.
--
-- Usage:
--   psql -f 003_workflow_schema_alignment.sql
-- ============================================================================

-- ============================================================================
-- PART A: Add columns to letter_templates that the n8n workflow expects
-- ============================================================================

-- n8n "Load Template" node selects: template_key, template_text, file_id
ALTER TABLE demo.letter_templates
  ADD COLUMN IF NOT EXISTS template_key VARCHAR(64);

ALTER TABLE demo.letter_templates
  ADD COLUMN IF NOT EXISTS template_text TEXT;

ALTER TABLE demo.letter_templates
  ADD COLUMN IF NOT EXISTS file_id VARCHAR(64);

-- Backfill template_key from template_id
UPDATE demo.letter_templates
  SET template_key = template_id
  WHERE template_key IS NULL;

-- Backfill template_text from template_body (workflow reads template_text, migration 002 uses template_body)
UPDATE demo.letter_templates
  SET template_text = template_body
  WHERE template_text IS NULL AND template_body IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_letter_templates_key
  ON demo.letter_templates (template_key);


-- ============================================================================
-- PART B: Add columns to payer_policies that the n8n workflow expects
-- ============================================================================

-- n8n "DB: Load Policy" node selects: policy_key, policy_text, file_id
ALTER TABLE demo.payer_policies
  ADD COLUMN IF NOT EXISTS policy_key VARCHAR(64);

ALTER TABLE demo.payer_policies
  ADD COLUMN IF NOT EXISTS policy_text TEXT;

ALTER TABLE demo.payer_policies
  ADD COLUMN IF NOT EXISTS file_id VARCHAR(64);

-- Backfill policy_key from policy_id
UPDATE demo.payer_policies
  SET policy_key = policy_id
  WHERE policy_key IS NULL;

-- Backfill policy_text from clinical_criteria
UPDATE demo.payer_policies
  SET policy_text = clinical_criteria
  WHERE policy_text IS NULL AND clinical_criteria IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payer_policies_key
  ON demo.payer_policies (policy_key);


-- ============================================================================
-- PART C: Add payer_key to payers table (n8n workflow joins on payer_key)
-- ============================================================================

ALTER TABLE demo.payers
  ADD COLUMN IF NOT EXISTS payer_key VARCHAR(64);

-- Backfill payer_key from payer_id (lowercase)
UPDATE demo.payers
  SET payer_key = LOWER(payer_id)
  WHERE payer_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_payers_key
  ON demo.payers (payer_key);


-- ============================================================================
-- PART D: Documents table (for ingestion pipeline)
-- ============================================================================

CREATE TABLE IF NOT EXISTS demo.documents (
  tenant_id         INTEGER       NOT NULL DEFAULT 1,
  facility_id       VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  doc_id            VARCHAR(64)   NOT NULL,
  file_id           VARCHAR(64),
  file_name         VARCHAR(256),
  doc_role          VARCHAR(32)   NOT NULL DEFAULT 'doc',
  mime_type         VARCHAR(128),
  content_text      TEXT,
  payer_key         VARCHAR(64),
  service_key       VARCHAR(64),
  template_key      VARCHAR(64),
  policy_key        VARCHAR(64),
  embedding_status  VARCHAR(32)   DEFAULT 'pending',
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_documents_role
  ON demo.documents (tenant_id, facility_id, doc_role);

CREATE INDEX IF NOT EXISTS idx_documents_file
  ON demo.documents (file_id);


-- ============================================================================
-- PART E: Audit log table (HIPAA requirement)
-- ============================================================================

CREATE TABLE IF NOT EXISTS demo.audit_log (
  log_id            BIGSERIAL     PRIMARY KEY,
  tenant_id         INTEGER       NOT NULL DEFAULT 1,
  facility_id       VARCHAR(64),
  endpoint          VARCHAR(256)  NOT NULL,
  method            VARCHAR(10)   NOT NULL,
  patient_id        VARCHAR(64),
  user_id           VARCHAR(64),
  ip_address        VARCHAR(45),
  status_code       INTEGER,
  response_time_ms  INTEGER,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON demo.audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_patient
  ON demo.audit_log (patient_id)
  WHERE patient_id IS NOT NULL;


-- ============================================================================
-- Done. Summary:
-- ============================================================================
-- Added columns:
--   letter_templates: template_key, template_text, file_id
--   payer_policies: policy_key, policy_text, file_id
--   payers: payer_key
--
-- Created tables:
--   documents (ingestion pipeline)
--   audit_log (HIPAA compliance)
--
-- Backfills:
--   template_key ← template_id
--   template_text ← template_body
--   policy_key ← policy_id
--   policy_text ← clinical_criteria
--   payer_key ← LOWER(payer_id)
-- ============================================================================
