-- ============================================================================
-- Migration 004: Evaluation Framework
-- ============================================================================
-- Adds tables for systematic evaluation of the Prior Auth AI Platform:
--   - Golden test cases (ground-truth dataset)
--   - Evaluation runs and per-case results
--   - A/B testing configuration and tracking
--   - User/reviewer feedback collection
--   - Safety and compliance audit logging
--
-- Run AFTER 003_workflow_schema_alignment.sql.
--
-- Usage:
--   psql -f 004_evaluation_framework.sql
-- ============================================================================


-- ============================================================================
-- TABLE 1: eval_test_cases — Golden test dataset
-- ============================================================================
-- Stores synthetic patient scenarios with gold-standard expected outputs.
-- Each test case represents a complete prior-auth scenario that the system
-- should be able to handle correctly.
-- ============================================================================

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


-- ============================================================================
-- TABLE 2: eval_runs — Evaluation run records
-- ============================================================================
-- Each run represents a batch evaluation session: automated regression,
-- A/B test, or human review cycle.
-- ============================================================================

CREATE TABLE IF NOT EXISTS demo.eval_runs (
  run_id             VARCHAR(64)    PRIMARY KEY,
  run_name           VARCHAR(256),
  run_type           VARCHAR(32)    NOT NULL,
  model_id           VARCHAR(64),
  config             JSONB,
  started_at         TIMESTAMPTZ    DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  status             VARCHAR(32)    DEFAULT 'running',
  summary            JSONB
);

COMMENT ON COLUMN demo.eval_runs.run_type IS 'One of: automated, ab_test, human_review';
COMMENT ON COLUMN demo.eval_runs.status IS 'One of: running, completed, failed, cancelled';


-- ============================================================================
-- TABLE 3: eval_results — Per-case results within a run
-- ============================================================================
-- Stores the generated output for each test case in a run, along with
-- retrieval metrics, quality scores, LLM-as-judge scores, and optional
-- human review scores.
-- ============================================================================

CREATE TABLE IF NOT EXISTS demo.eval_results (
  result_id               VARCHAR(64)    PRIMARY KEY,
  run_id                  VARCHAR(64)    NOT NULL REFERENCES demo.eval_runs(run_id),
  test_case_id            VARCHAR(64)    NOT NULL REFERENCES demo.eval_test_cases(test_case_id),
  generated_output        TEXT           NOT NULL,
  generation_time_ms      INTEGER,

  -- Retrieval metrics (RAG evaluation)
  retrieval_precision     REAL,
  retrieval_recall        REAL,
  retrieval_f1            REAL,
  retrieved_chunks        JSONB,

  -- Quality scores (0.0 - 1.0)
  criteria_coverage_score REAL,
  clinical_accuracy_score REAL,
  format_compliance_score REAL,
  completeness_score      REAL,

  -- LLM-as-judge evaluation
  llm_judge_score         REAL,
  llm_judge_reasoning     TEXT,
  llm_judge_model         VARCHAR(64),

  -- Human review (filled in later)
  human_reviewer          VARCHAR(64),
  human_score             REAL,
  human_notes             TEXT,
  human_reviewed_at       TIMESTAMPTZ,

  created_at              TIMESTAMPTZ    DEFAULT now()
);


-- ============================================================================
-- TABLE 4: eval_ab_tests — A/B test configuration
-- ============================================================================
-- Tracks A/B experiments comparing two model/config variants.
-- ============================================================================

CREATE TABLE IF NOT EXISTS demo.eval_ab_tests (
  ab_test_id         VARCHAR(64)    PRIMARY KEY,
  test_name          VARCHAR(256),
  variant_a_config   JSONB          NOT NULL,
  variant_b_config   JSONB          NOT NULL,
  allocation_pct     REAL           DEFAULT 0.5,
  status             VARCHAR(32)    DEFAULT 'draft',
  started_at         TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  winner             VARCHAR(1),
  summary            JSONB
);

COMMENT ON COLUMN demo.eval_ab_tests.allocation_pct IS 'Fraction of traffic routed to variant B (0.0 - 1.0)';
COMMENT ON COLUMN demo.eval_ab_tests.winner IS 'A or B once the test concludes';
COMMENT ON COLUMN demo.eval_ab_tests.status IS 'One of: draft, running, completed, cancelled';


-- ============================================================================
-- TABLE 5: eval_feedback — User / reviewer feedback
-- ============================================================================
-- Captures structured feedback on generated letters: edits, ratings,
-- and tagged issues from clinical staff and reviewers.
-- ============================================================================

CREATE TABLE IF NOT EXISTS demo.eval_feedback (
  feedback_id        VARCHAR(64)    PRIMARY KEY,
  letter_id          VARCHAR(64),
  log_id             VARCHAR(64),
  feedback_type      VARCHAR(32)    NOT NULL,
  feedback_source    VARCHAR(32),
  original_text      TEXT,
  edited_text        TEXT,
  diff_summary       TEXT,
  tags               TEXT[],
  created_by         VARCHAR(64),
  created_at         TIMESTAMPTZ    DEFAULT now()
);

COMMENT ON COLUMN demo.eval_feedback.feedback_type IS 'e.g. edit, rating, flag, comment';
COMMENT ON COLUMN demo.eval_feedback.feedback_source IS 'e.g. clinician, reviewer, automated';


-- ============================================================================
-- TABLE 6: eval_safety_log — Safety / compliance audit
-- ============================================================================
-- Records safety and compliance checks on generated content: hallucination
-- detection, PHI leakage, off-label claims, etc.
-- ============================================================================

CREATE TABLE IF NOT EXISTS demo.eval_safety_log (
  safety_log_id      VARCHAR(64)    PRIMARY KEY,
  letter_id          VARCHAR(64),
  check_type         VARCHAR(64)    NOT NULL,
  severity           VARCHAR(32)    NOT NULL,
  details            TEXT,
  resolved           BOOLEAN        DEFAULT FALSE,
  resolved_by        VARCHAR(64),
  resolved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ    DEFAULT now()
);

COMMENT ON COLUMN demo.eval_safety_log.check_type IS 'e.g. hallucination, phi_leak, off_label, formatting';
COMMENT ON COLUMN demo.eval_safety_log.severity IS 'One of: critical, high, medium, low';


-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_eval_results_run_id
  ON demo.eval_results (run_id);

CREATE INDEX IF NOT EXISTS idx_eval_results_test_case_id
  ON demo.eval_results (test_case_id);

CREATE INDEX IF NOT EXISTS idx_eval_feedback_letter_id
  ON demo.eval_feedback (letter_id)
  WHERE letter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_eval_safety_log_letter_id
  ON demo.eval_safety_log (letter_id)
  WHERE letter_id IS NOT NULL;


-- ============================================================================
-- Done. Summary:
-- ============================================================================
-- Created tables:
--   eval_test_cases   — Golden test dataset with synthetic patient profiles
--   eval_runs         — Evaluation run records (automated / ab_test / human)
--   eval_results      — Per-case generation results with multi-dimensional scores
--   eval_ab_tests     — A/B test configuration and outcome tracking
--   eval_feedback     — User and reviewer feedback collection
--   eval_safety_log   — Safety and compliance audit log
--
-- Created indexes:
--   idx_eval_results_run_id        — Fast lookup of results by run
--   idx_eval_results_test_case_id  — Fast lookup of results by test case
--   idx_eval_feedback_letter_id    — Fast lookup of feedback by letter
--   idx_eval_safety_log_letter_id  — Fast lookup of safety issues by letter
-- ============================================================================
