-- ============================================================================
-- 000_complete_schema.sql
-- ============================================================================
-- Complete database schema for the Prior Auth AI Platform.
-- Creates the demo schema and ALL tables from scratch.
-- Run this ONCE on a fresh database, then run seed-rag-training.sql.
--
-- Usage:
--   psql -h 127.0.0.1 -U postgres -d postgres -f 000_complete_schema.sql
--
-- Tables created (in order):
--   Base clinical tables:  patients, problems, encounters, imaging, therapy,
--                          med_trials, coverage, preauth_requests
--   Reference tables:      facilities, providers, payers, payer_contacts,
--                          payer_policies, letter_templates
--   Template sections:     template_sections
--   Letter management:     generated_letters, letter_status_history
--   Logging:               generation_logs, audit_log
--   Ingestion pipeline:    documents
--   Evaluation framework:  eval_test_cases, eval_runs, eval_results,
--                          eval_ab_tests, eval_feedback, eval_safety_log
-- ============================================================================

BEGIN;

-- Create the demo schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS demo;

-- ============================================================================
-- BASE CLINICAL TABLES
-- ============================================================================

-- --------------------------------------------------------------------------
-- patients
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.patients (
  tenant_id        INTEGER       NOT NULL DEFAULT 1,
  facility_id      VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  patient_id       VARCHAR(64)   NOT NULL,
  first_name       VARCHAR(128)  NOT NULL,
  last_name        VARCHAR(128)  NOT NULL,
  dob              DATE          NOT NULL,
  sex              VARCHAR(1),
  phone            VARCHAR(32),
  address_line1    VARCHAR(256),
  address_line2    VARCHAR(256),
  city             VARCHAR(128),
  state            VARCHAR(4),
  zip              VARCHAR(12),
  email            VARCHAR(128),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_patients_name
  ON demo.patients (tenant_id, facility_id, last_name, first_name);

-- --------------------------------------------------------------------------
-- problems  (ICD-10 diagnoses)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.problems (
  tenant_id        INTEGER       NOT NULL DEFAULT 1,
  facility_id      VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  problem_id       VARCHAR(64)   NOT NULL,
  patient_id       VARCHAR(64)   NOT NULL,
  icd10_code       VARCHAR(16)   NOT NULL,
  description      TEXT,
  onset_date       DATE,
  resolved_date    DATE,
  is_active        BOOLEAN       NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_problems_patient
  ON demo.problems (tenant_id, facility_id, patient_id);

-- --------------------------------------------------------------------------
-- encounters  (visit notes)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.encounters (
  tenant_id        INTEGER       NOT NULL DEFAULT 1,
  facility_id      VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  encounter_id     VARCHAR(64)   NOT NULL,
  patient_id       VARCHAR(64)   NOT NULL,
  encounter_date   DATE          NOT NULL,
  encounter_type   VARCHAR(64),
  provider_id      VARCHAR(64),
  provider_name    VARCHAR(256),
  summary          TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, encounter_id)
);

CREATE INDEX IF NOT EXISTS idx_encounters_patient
  ON demo.encounters (tenant_id, facility_id, patient_id, encounter_date DESC);

-- --------------------------------------------------------------------------
-- imaging  (radiology / diagnostic studies)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.imaging (
  tenant_id        INTEGER       NOT NULL DEFAULT 1,
  facility_id      VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  imaging_id       VARCHAR(64)   NOT NULL,
  patient_id       VARCHAR(64)   NOT NULL,
  modality         VARCHAR(64)   NOT NULL,
  body_part        VARCHAR(128),
  imaging_date     DATE,
  ordering_provider VARCHAR(256),
  impression       TEXT,
  item             TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, imaging_id)
);

CREATE INDEX IF NOT EXISTS idx_imaging_patient
  ON demo.imaging (tenant_id, facility_id, patient_id, imaging_date DESC NULLS LAST);

-- --------------------------------------------------------------------------
-- therapy  (PT, injections, rehab, etc.)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.therapy (
  tenant_id        INTEGER       NOT NULL DEFAULT 1,
  facility_id      VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  therapy_id       VARCHAR(64)   NOT NULL,
  patient_id       VARCHAR(64)   NOT NULL,
  therapy_type     VARCHAR(128)  NOT NULL,
  start_date       DATE,
  end_date         DATE,
  total_visits     INTEGER,
  frequency        VARCHAR(64),
  response         TEXT,
  therapy_item     TEXT,
  provider_name    VARCHAR(256),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, therapy_id)
);

CREATE INDEX IF NOT EXISTS idx_therapy_patient
  ON demo.therapy (tenant_id, facility_id, patient_id, start_date DESC NULLS LAST);

-- --------------------------------------------------------------------------
-- med_trials  (medication trials)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.med_trials (
  tenant_id        INTEGER       NOT NULL DEFAULT 1,
  facility_id      VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  med_trial_id     VARCHAR(64)   NOT NULL,
  patient_id       VARCHAR(64)   NOT NULL,
  medication       VARCHAR(128)  NOT NULL,
  dose             VARCHAR(128),
  start_date       DATE,
  end_date         DATE,
  outcome          VARCHAR(64),
  notes            TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, med_trial_id)
);

CREATE INDEX IF NOT EXISTS idx_med_trials_patient
  ON demo.med_trials (tenant_id, facility_id, patient_id, start_date DESC NULLS LAST);

-- --------------------------------------------------------------------------
-- coverage  (insurance plans)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.coverage (
  tenant_id              INTEGER       NOT NULL DEFAULT 1,
  facility_id            VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  coverage_id            VARCHAR(64)   NOT NULL,
  patient_id             VARCHAR(64)   NOT NULL,
  payer_id               VARCHAR(64),
  payer_key              VARCHAR(64),
  member_id              VARCHAR(64),
  group_id               VARCHAR(64),
  plan_name              VARCHAR(256),
  subscriber_name        VARCHAR(256),
  subscriber_relationship VARCHAR(32),
  effective_date         DATE,
  termination_date       DATE,
  is_active              BOOLEAN       NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, coverage_id)
);

CREATE INDEX IF NOT EXISTS idx_coverage_patient
  ON demo.coverage (tenant_id, facility_id, patient_id);

-- --------------------------------------------------------------------------
-- preauth_requests
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.preauth_requests (
  tenant_id                INTEGER       NOT NULL DEFAULT 1,
  facility_id              VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  request_id               VARCHAR(64)   NOT NULL,
  patient_id               VARCHAR(64)   NOT NULL,
  payer_id                 VARCHAR(64),
  provider_id              VARCHAR(64),
  coverage_id              VARCHAR(64),
  cpt_code                 VARCHAR(16),
  cpt_description          VARCHAR(256),
  icd10_code               VARCHAR(16),
  icd10_codes              TEXT[],
  service_name             VARCHAR(256),
  service_key              VARCHAR(128),
  requested_dos            DATE,
  requested_units          INTEGER       DEFAULT 1,
  priority                 VARCHAR(32)   DEFAULT 'standard',
  status                   VARCHAR(32)   DEFAULT 'pending',
  medical_necessity_summary TEXT,
  clinical_question        TEXT,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_preauth_requests_patient
  ON demo.preauth_requests (tenant_id, facility_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_preauth_requests_status
  ON demo.preauth_requests (tenant_id, facility_id, status);


-- ============================================================================
-- REFERENCE TABLES
-- ============================================================================

-- --------------------------------------------------------------------------
-- facilities
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.facilities (
  tenant_id        INTEGER       NOT NULL DEFAULT 1,
  facility_id      VARCHAR(64)   NOT NULL,
  facility_name    VARCHAR(256)  NOT NULL,
  npi              VARCHAR(20),
  tax_id           VARCHAR(20),
  address_line1    VARCHAR(256),
  address_line2    VARCHAR(256),
  city             VARCHAR(128),
  state            VARCHAR(4),
  zip              VARCHAR(12),
  phone            VARCHAR(32),
  fax              VARCHAR(32),
  email            VARCHAR(128),
  logo_url         TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id)
);

-- --------------------------------------------------------------------------
-- providers
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.providers (
  tenant_id        INTEGER       NOT NULL DEFAULT 1,
  facility_id      VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  provider_id      VARCHAR(64)   NOT NULL,
  first_name       VARCHAR(128)  NOT NULL,
  last_name        VARCHAR(128)  NOT NULL,
  credentials      VARCHAR(32),
  specialty        VARCHAR(128),
  npi              VARCHAR(20),
  phone            VARCHAR(32),
  fax              VARCHAR(32),
  email            VARCHAR(128),
  signature_name   VARCHAR(256),
  is_active        BOOLEAN       NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, provider_id)
);

-- --------------------------------------------------------------------------
-- payers
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.payers (
  tenant_id                    INTEGER       NOT NULL DEFAULT 1,
  facility_id                  VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  payer_id                     VARCHAR(64)   NOT NULL,
  payer_key                    VARCHAR(64),
  payer_name                   VARCHAR(256)  NOT NULL,
  payer_type                   VARCHAR(32),
  phone_general                VARCHAR(32),
  phone_pa                     VARCHAR(32),
  fax_pa                       VARCHAR(32),
  portal_url                   TEXT,
  address_line1                VARCHAR(256),
  city                         VARCHAR(128),
  state                        VARCHAR(4),
  zip                          VARCHAR(12),
  pa_turnaround_standard_days  INTEGER,
  pa_turnaround_urgent_days    INTEGER,
  created_at                   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, payer_id)
);

CREATE INDEX IF NOT EXISTS idx_payers_key
  ON demo.payers (payer_key);

-- --------------------------------------------------------------------------
-- payer_contacts
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.payer_contacts (
  tenant_id        INTEGER       NOT NULL DEFAULT 1,
  facility_id      VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  contact_id       VARCHAR(64)   NOT NULL,
  payer_id         VARCHAR(64)   NOT NULL,
  contact_name     VARCHAR(128),
  title            VARCHAR(128),
  phone            VARCHAR(32),
  fax              VARCHAR(32),
  email            VARCHAR(128),
  department       VARCHAR(128),
  notes            TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_payer_contacts_payer
  ON demo.payer_contacts (tenant_id, facility_id, payer_id);

-- --------------------------------------------------------------------------
-- payer_policies
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.payer_policies (
  tenant_id                 INTEGER       NOT NULL DEFAULT 1,
  facility_id               VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  policy_id                 VARCHAR(64)   NOT NULL,
  policy_key                VARCHAR(64),
  payer_id                  VARCHAR(64)   NOT NULL,
  policy_name               VARCHAR(256)  NOT NULL,
  service_category          VARCHAR(128),
  cpt_codes                 TEXT[],
  clinical_criteria         TEXT,
  policy_text               TEXT,
  required_documents        TEXT,
  required_failed_therapies INTEGER       DEFAULT 0,
  min_therapy_weeks         INTEGER       DEFAULT 0,
  guideline_source          TEXT,
  appeal_deadline_days      INTEGER,
  notes                     TEXT,
  file_id                   VARCHAR(64),
  effective_date            DATE,
  expiration_date           DATE,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, policy_id)
);

CREATE INDEX IF NOT EXISTS idx_payer_policies_payer
  ON demo.payer_policies (tenant_id, facility_id, payer_id);

CREATE INDEX IF NOT EXISTS idx_payer_policies_cpt
  ON demo.payer_policies USING GIN (cpt_codes);

CREATE INDEX IF NOT EXISTS idx_payer_policies_key
  ON demo.payer_policies (policy_key);

-- --------------------------------------------------------------------------
-- letter_templates
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.letter_templates (
  tenant_id          INTEGER       NOT NULL DEFAULT 1,
  facility_id        VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  template_id        VARCHAR(64)   NOT NULL,
  template_key       VARCHAR(64),
  template_name      VARCHAR(256)  NOT NULL,
  letter_type        VARCHAR(64)   NOT NULL DEFAULT 'initial_auth',
  service_category   VARCHAR(128),
  template_body      TEXT,
  template_text      TEXT,
  instructions       TEXT,
  placeholders       JSONB,
  file_id            VARCHAR(64),
  version            INTEGER       NOT NULL DEFAULT 1,
  is_active          BOOLEAN       NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_letter_templates_type
  ON demo.letter_templates (tenant_id, facility_id, letter_type, is_active);

CREATE INDEX IF NOT EXISTS idx_letter_templates_key
  ON demo.letter_templates (template_key);


-- ============================================================================
-- TEMPLATE SECTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS demo.template_sections (
  tenant_id       INTEGER       NOT NULL DEFAULT 1,
  facility_id     VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  section_id      VARCHAR(64)   NOT NULL,
  template_id     VARCHAR(64)   NOT NULL,
  section_name    VARCHAR(128)  NOT NULL,
  section_order   INTEGER       NOT NULL DEFAULT 0,
  instruction_prompt TEXT       NOT NULL DEFAULT '',
  scaffold_text   TEXT          NOT NULL DEFAULT '',
  requires_policy BOOLEAN       NOT NULL DEFAULT false,
  requires_clinical BOOLEAN     NOT NULL DEFAULT true,
  is_active       BOOLEAN       NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, section_id)
);

CREATE INDEX IF NOT EXISTS idx_template_sections_template
  ON demo.template_sections (tenant_id, facility_id, template_id, section_order);


-- ============================================================================
-- LETTER MANAGEMENT
-- ============================================================================

-- --------------------------------------------------------------------------
-- generated_letters
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.generated_letters (
  tenant_id          INTEGER       NOT NULL DEFAULT 1,
  facility_id        VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  letter_id          VARCHAR(64)   NOT NULL,
  request_id         VARCHAR(64),
  template_id        VARCHAR(64),
  patient_id         VARCHAR(64)   NOT NULL,
  coverage_id        VARCHAR(64),
  payer_id           VARCHAR(64),
  provider_id        VARCHAR(64),
  letter_type        VARCHAR(64)   NOT NULL DEFAULT 'initial_auth',
  letter_date        DATE          NOT NULL DEFAULT CURRENT_DATE,
  subject_line       VARCHAR(512),
  letter_body        TEXT,
  pdf_storage_path   TEXT,
  status             VARCHAR(32)   NOT NULL DEFAULT 'draft',
  sent_date          DATE,
  sent_method        VARCHAR(32),
  sent_to            VARCHAR(256),
  response_date      DATE,
  response_status    VARCHAR(32),
  auth_number        VARCHAR(64),
  denial_reason      TEXT,
  denial_code        VARCHAR(32),
  appeal_deadline    DATE,
  created_by         VARCHAR(64),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, letter_id)
);

CREATE INDEX IF NOT EXISTS idx_generated_letters_patient
  ON demo.generated_letters (tenant_id, facility_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_generated_letters_status
  ON demo.generated_letters (tenant_id, facility_id, status);

CREATE INDEX IF NOT EXISTS idx_generated_letters_created
  ON demo.generated_letters (tenant_id, facility_id, created_at DESC);

-- --------------------------------------------------------------------------
-- letter_status_history  (audit trail)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.letter_status_history (
  tenant_id        INTEGER       NOT NULL DEFAULT 1,
  facility_id      VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  history_id       VARCHAR(64)   NOT NULL,
  letter_id        VARCHAR(64)   NOT NULL,
  old_status       VARCHAR(32),
  new_status       VARCHAR(32)   NOT NULL,
  changed_by       VARCHAR(64),
  change_reason    TEXT,
  changed_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, history_id)
);

CREATE INDEX IF NOT EXISTS idx_letter_status_history_letter
  ON demo.letter_status_history (tenant_id, facility_id, letter_id);


-- ============================================================================
-- LOGGING
-- ============================================================================

-- --------------------------------------------------------------------------
-- generation_logs  (per-request generation metrics)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.generation_logs (
  tenant_id        INTEGER       NOT NULL DEFAULT 1,
  facility_id      VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  log_id           VARCHAR(64)   NOT NULL,
  letter_id        VARCHAR(64),
  request_id       VARCHAR(64),
  patient_id       VARCHAR(64),
  payer_id         VARCHAR(64),
  provider_id      VARCHAR(64),
  template_id      VARCHAR(64),
  letter_type      VARCHAR(32),
  cpt_codes        TEXT[],
  icd10_codes      TEXT[],
  policy_refs      TEXT[],
  generation_time_ms INTEGER,
  section_count    INTEGER,
  validation_passed BOOLEAN,
  validation_issues JSONB,
  user_edits       JSONB,
  outcome          VARCHAR(32),
  outcome_date     DATE,
  model_id         VARCHAR(64),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, log_id)
);

CREATE INDEX IF NOT EXISTS idx_generation_logs_patient
  ON demo.generation_logs (tenant_id, facility_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_generation_logs_created
  ON demo.generation_logs (tenant_id, facility_id, created_at DESC);

-- --------------------------------------------------------------------------
-- audit_log  (HIPAA compliance)
-- --------------------------------------------------------------------------
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
-- INGESTION PIPELINE
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
-- EVALUATION FRAMEWORK
-- ============================================================================

-- --------------------------------------------------------------------------
-- eval_test_cases  (golden test dataset)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.eval_test_cases (
  test_case_id       VARCHAR(64)    PRIMARY KEY,
  case_name          VARCHAR(256)   NOT NULL,
  patient_profile    JSONB          NOT NULL,
  service_category   VARCHAR(128),
  payer_id           VARCHAR(64),
  expected_output    TEXT           NOT NULL,
  expected_sections  JSONB,
  difficulty         VARCHAR(32)    DEFAULT 'medium',
  tags               TEXT[],
  is_active          BOOLEAN        DEFAULT TRUE,
  created_at         TIMESTAMPTZ    DEFAULT now(),
  updated_at         TIMESTAMPTZ    DEFAULT now()
);

-- --------------------------------------------------------------------------
-- eval_runs  (evaluation run records)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.eval_runs (
  run_id             VARCHAR(64)    PRIMARY KEY,
  run_name           VARCHAR(256),
  run_type           VARCHAR(32)    NOT NULL,  -- automated, ab_test, human_review
  model_id           VARCHAR(64),
  config             JSONB,
  started_at         TIMESTAMPTZ    DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  status             VARCHAR(32)    DEFAULT 'running',  -- running, completed, failed, cancelled
  summary            JSONB
);

-- --------------------------------------------------------------------------
-- eval_results  (per-case results within a run)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.eval_results (
  result_id               VARCHAR(64)    PRIMARY KEY,
  run_id                  VARCHAR(64)    NOT NULL REFERENCES demo.eval_runs(run_id) ON DELETE CASCADE,
  test_case_id            VARCHAR(64)    NOT NULL REFERENCES demo.eval_test_cases(test_case_id) ON DELETE CASCADE,
  generated_output        TEXT           NOT NULL,
  generation_time_ms      INTEGER,
  retrieval_precision     REAL,
  retrieval_recall        REAL,
  retrieval_f1            REAL,
  retrieved_chunks        JSONB,
  criteria_coverage_score REAL CHECK (criteria_coverage_score >= 0.0 AND criteria_coverage_score <= 1.0),
  clinical_accuracy_score REAL CHECK (clinical_accuracy_score >= 0.0 AND clinical_accuracy_score <= 1.0),
  format_compliance_score REAL CHECK (format_compliance_score >= 0.0 AND format_compliance_score <= 1.0),
  completeness_score      REAL CHECK (completeness_score >= 0.0 AND completeness_score <= 1.0),
  llm_judge_score         REAL CHECK (llm_judge_score >= 0.0 AND llm_judge_score <= 1.0),
  llm_judge_reasoning     TEXT,
  llm_judge_model         VARCHAR(64),
  human_reviewer          VARCHAR(64),
  human_score             REAL,
  human_notes             TEXT,
  human_reviewed_at       TIMESTAMPTZ,
  created_at              TIMESTAMPTZ    DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_results_run_id
  ON demo.eval_results (run_id);

CREATE INDEX IF NOT EXISTS idx_eval_results_test_case_id
  ON demo.eval_results (test_case_id);

CREATE INDEX IF NOT EXISTS idx_eval_results_run_created
  ON demo.eval_results (run_id, created_at DESC);

-- --------------------------------------------------------------------------
-- eval_ab_tests  (A/B test configuration)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.eval_ab_tests (
  ab_test_id         VARCHAR(64)    PRIMARY KEY,
  test_name          VARCHAR(256),
  variant_a_config   JSONB          NOT NULL,
  variant_b_config   JSONB          NOT NULL,
  allocation_pct     REAL           DEFAULT 0.5,
  status             VARCHAR(32)    DEFAULT 'draft',  -- draft, running, completed, cancelled
  started_at         TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  winner             VARCHAR(1),     -- A or B
  summary            JSONB
);

-- --------------------------------------------------------------------------
-- eval_feedback  (user / reviewer feedback)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.eval_feedback (
  feedback_id        VARCHAR(64)    PRIMARY KEY,
  letter_id          VARCHAR(64),
  log_id             VARCHAR(64),
  feedback_type      VARCHAR(32)    NOT NULL,  -- edit, rating, flag, comment
  feedback_source    VARCHAR(32),              -- clinician, reviewer, automated
  original_text      TEXT,
  edited_text        TEXT,
  diff_summary       TEXT,
  tags               TEXT[],
  created_by         VARCHAR(64),
  created_at         TIMESTAMPTZ    DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_feedback_letter_id
  ON demo.eval_feedback (letter_id)
  WHERE letter_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- eval_safety_log  (safety / compliance audit)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.eval_safety_log (
  safety_log_id      VARCHAR(64)    PRIMARY KEY,
  letter_id          VARCHAR(64),
  check_type         VARCHAR(64)    NOT NULL,  -- hallucination, phi_leak, off_label, formatting
  severity           VARCHAR(32)    NOT NULL,  -- critical, high, medium, low
  details            TEXT,
  resolved           BOOLEAN        DEFAULT FALSE,
  resolved_by        VARCHAR(64),
  resolved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ    DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_safety_log_letter_id
  ON demo.eval_safety_log (letter_id)
  WHERE letter_id IS NOT NULL;


-- ============================================================================
-- SEED REFERENCE DATA
-- ============================================================================

-- Facility
INSERT INTO demo.facilities
  (tenant_id, facility_id, facility_name, npi, address_line1, city, state, zip, phone, fax, email)
VALUES
  (1, 'FAC-DEMO', 'Newaza Spine & Pain Center', '1234567890',
   '123 Main Street', 'Dallas', 'TX', '75201',
   '(214) 555-0100', '(214) 555-0101', 'info@newazaspine.com')
ON CONFLICT DO NOTHING;

-- Provider
INSERT INTO demo.providers
  (tenant_id, facility_id, provider_id, first_name, last_name, credentials, specialty, npi, phone, signature_name)
VALUES
  (1, 'FAC-DEMO', 'PROV-001', 'Nathan', 'Senior', 'MD',
   'Pain Management / Interventional Spine', '9876543210',
   '(214) 555-0100', 'Nathan Senior, MD')
ON CONFLICT DO NOTHING;

-- Payers
INSERT INTO demo.payers
  (tenant_id, facility_id, payer_id, payer_key, payer_name, payer_type, phone_pa, fax_pa,
   pa_turnaround_standard_days, pa_turnaround_urgent_days)
VALUES
  (1, 'FAC-DEMO', 'BCBS',   'BCBS',   'Blue Cross Blue Shield of Texas', 'commercial', '(800) 441-9188', '(800) 555-0001', 15, 2),
  (1, 'FAC-DEMO', 'AETNA',  'AETNA',  'Aetna',                          'commercial', '(800) 624-0756', '(800) 555-0002', 15, 2),
  (1, 'FAC-DEMO', 'CIGNA',  'CIGNA',  'Cigna Healthcare',               'commercial', '(800) 244-6224', '(800) 555-0003', 15, 2),
  (1, 'FAC-DEMO', 'UHC',    'UHC',    'UnitedHealthcare',               'commercial', '(800) 842-3844', '(800) 555-0004', 15, 2),
  (1, 'FAC-DEMO', 'HUMANA', 'HUMANA', 'Humana',                         'commercial', '(800) 457-4708', '(800) 555-0005', 14, 2)
ON CONFLICT DO NOTHING;

-- BCBS Policies (from original migrations)
INSERT INTO demo.payer_policies
  (tenant_id, facility_id, policy_id, policy_key, payer_id, policy_name, service_category,
   cpt_codes, clinical_criteria, policy_text, required_documents,
   required_failed_therapies, min_therapy_weeks, guideline_source,
   appeal_deadline_days, effective_date)
VALUES
  (1, 'FAC-DEMO', 'POL-BCBS-SPINE-001', 'POL-BCBS-SPINE-001', 'BCBS',
   'Lumbar Spine Surgery — BCBS TX', 'spine_surgery',
   ARRAY['22612','22630','22633','22853','63047','63048','27447'],
   E'1. Documented failure of conservative treatment for >= 6 weeks including physical therapy and medication management;\n'
   '2. Diagnostic imaging (MRI or CT) confirming structural pathology correlating with clinical presentation;\n'
   '3. Documented functional limitations in activities of daily living;\n'
   '4. Neurological deficits consistent with imaging findings;\n'
   '5. BMI < 40 or documented weight management plan if BMI >= 40',
   E'1. Documented failure of conservative treatment for >= 6 weeks including physical therapy and medication management;\n'
   '2. Diagnostic imaging (MRI or CT) confirming structural pathology correlating with clinical presentation;\n'
   '3. Documented functional limitations in activities of daily living;\n'
   '4. Neurological deficits consistent with imaging findings;\n'
   '5. BMI < 40 or documented weight management plan if BMI >= 40',
   'MRI report, Physical therapy records, Medication history, Provider notes documenting functional limitations',
   2, 6, 'BCBS TX Medical Policy: Surgery of the Spine (2024)', 60, '2024-01-01'),

  (1, 'FAC-DEMO', 'POL-BCBS-ESI-001', 'POL-BCBS-ESI-001', 'BCBS',
   'Epidural Steroid Injection — BCBS TX', 'pain_management',
   ARRAY['62321','62322','62323','62324','62325','62326','62327'],
   E'Epidural steroid injection is considered medically necessary when:\n'
   '(1) Diagnosis of radiculopathy or spinal stenosis confirmed by clinical exam and imaging;\n'
   '(2) Patient has failed at least 4-6 weeks of conservative treatment (PT, oral medications);\n'
   '(3) Maximum of 3 injections per region per 12-month period;\n'
   '(4) Subsequent injections require documented positive response (>50% pain relief for >2 weeks) from prior injection;\n'
   '(5) Fluoroscopic guidance required.',
   E'Epidural steroid injection is considered medically necessary when:\n'
   '(1) Diagnosis of radiculopathy or spinal stenosis confirmed by clinical exam and imaging;\n'
   '(2) Patient has failed at least 4-6 weeks of conservative treatment (PT, oral medications);\n'
   '(3) Maximum of 3 injections per region per 12-month period;\n'
   '(4) Subsequent injections require documented positive response (>50% pain relief for >2 weeks) from prior injection;\n'
   '(5) Fluoroscopic guidance required.',
   'MRI or CT showing correlating pathology, Physical therapy records, Medication trial documentation',
   2, 4, 'MCG', 60, '2024-01-01')
ON CONFLICT DO NOTHING;

-- Spine Surgery Template
INSERT INTO demo.letter_templates
  (tenant_id, facility_id, template_id, template_key, template_name, letter_type, service_category,
   instructions, version, is_active)
VALUES
  (1, 'FAC-DEMO', 'TMPL-IA-SPINE-001', 'TMPL-IA-SPINE-001',
   'Initial Auth — Spine Surgery', 'initial_auth', 'spine_surgery',
   'Generate a comprehensive prior authorization letter for spine surgery. Address each payer policy criterion with specific patient evidence. Use formal medical tone. Include ICD-10 and CPT codes.',
   1, true),
  (1, 'FAC-DEMO', 'TMPL-APPEAL-001', 'TMPL-APPEAL-001',
   'Appeal — General', 'appeal', NULL,
   'Generate a peer-to-peer appeal letter referencing the original denial reason and providing additional clinical justification.',
   1, true)
ON CONFLICT DO NOTHING;

-- Spine Template Sections
INSERT INTO demo.template_sections
  (tenant_id, facility_id, section_id, template_id, section_name, section_order,
   instruction_prompt, scaffold_text, requires_policy, requires_clinical)
VALUES
  (1, 'FAC-DEMO', 'SEC-IA-001', 'TMPL-IA-SPINE-001', 'header', 1,
   'Generate the letter header with date, facility letterhead, payer address, and RE: line.', '', false, false),
  (1, 'FAC-DEMO', 'SEC-IA-002', 'TMPL-IA-SPINE-001', 'introduction', 2,
   'Write introduction stating the requesting provider, specialty, patient, and service requested.', '', false, false),
  (1, 'FAC-DEMO', 'SEC-IA-003', 'TMPL-IA-SPINE-001', 'clinical_history', 3,
   'Summarize the patient clinical history including primary diagnosis with ICD-10 codes, symptom duration, functional limitations.', '', false, true),
  (1, 'FAC-DEMO', 'SEC-IA-004', 'TMPL-IA-SPINE-001', 'conservative_treatment', 4,
   'Detail all conservative treatments attempted: PT, medications, injections. Emphasize failure to justify escalation.', '', false, true),
  (1, 'FAC-DEMO', 'SEC-IA-005', 'TMPL-IA-SPINE-001', 'medical_necessity', 5,
   'Align each payer policy criterion with specific patient evidence. State how each requirement is met.', '', true, true),
  (1, 'FAC-DEMO', 'SEC-IA-006', 'TMPL-IA-SPINE-001', 'supporting_evidence', 6,
   'Cite diagnostic findings, imaging results, functional scores, and clinical guidelines supporting the request.', '', true, true),
  (1, 'FAC-DEMO', 'SEC-IA-007', 'TMPL-IA-SPINE-001', 'conclusion', 7,
   'Professional closing summarizing request, reiterating medical necessity, and including provider signature block.', '', false, false)
ON CONFLICT DO NOTHING;

COMMIT;
