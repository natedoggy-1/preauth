-- ============================================================================
-- Migration 001: Template Sections + Generation Logs
-- ============================================================================
-- Adds per-section template storage (blueprint 4.1) and generation logging
-- (blueprint 8) to support the section-based generation pipeline.
--
-- Usage: Replace ${SCHEMA} with your CLINIC_SCHEMA value (e.g., "demo").
--        psql -v schema=demo -f 001_template_sections_and_logs.sql
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. template_sections
-- --------------------------------------------------------------------------
-- Each letter template is broken into ordered sections. The LLM generates
-- each section independently using the section-specific instruction_prompt
-- and scaffold_text, then they are assembled in section_order.
-- --------------------------------------------------------------------------
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

-- --------------------------------------------------------------------------
-- 2. generation_logs
-- --------------------------------------------------------------------------
-- Stores per-request generation metrics for optimization (blueprint 8).
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
-- 3. Seed default template sections for initial_auth
-- --------------------------------------------------------------------------
-- These match a standard prior authorization letter structure.
-- Each section has an instruction_prompt that tells the LLM what to write
-- and a scaffold_text providing the expected format/structure.
-- --------------------------------------------------------------------------
INSERT INTO demo.template_sections
  (tenant_id, facility_id, section_id, template_id, section_name, section_order,
   instruction_prompt, scaffold_text, requires_policy, requires_clinical)
VALUES
  (1, 'FAC-DEMO', 'SEC-IA-001', 'TMPL-IA-SPINE-001', 'header', 1,
   'Generate the letter header with date, facility letterhead, payer address, and RE: line with patient reference and service requested.',
   'Date: {{DATE}}\n\n{{FACILITY_NAME}}\n{{FACILITY_ADDRESS}}\n\nTo:\n{{PAYER_NAME}}\n{{PAYER_ADDRESS}}\n\nRE: Prior Authorization Request\nPatient: {{PATIENT_NAME}}\nDOB: {{DOB}}\nMember ID: {{MEMBER_ID}}\nService: {{SERVICE_NAME}} (CPT {{CPT_CODE}})',
   false, false),

  (1, 'FAC-DEMO', 'SEC-IA-002', 'TMPL-IA-SPINE-001', 'introduction', 2,
   'Write a concise introduction paragraph stating the requesting provider, their specialty, the patient reference, and the specific service being requested with medical necessity.',
   'Dear Medical Director,\n\nI am writing on behalf of {{PATIENT_NAME}} to request prior authorization for {{SERVICE_NAME}}. As the treating {{PROVIDER_SPECIALTY}}, I have determined this procedure to be medically necessary based on the clinical evidence presented below.',
   false, false),

  (1, 'FAC-DEMO', 'SEC-IA-003', 'TMPL-IA-SPINE-001', 'clinical_history', 3,
   'Summarize the patient clinical history including primary diagnosis with ICD-10 codes, symptom duration, functional limitations, and relevant comorbidities. Reference specific clinical findings from encounters and imaging.',
   'CLINICAL HISTORY:\n\n{{PATIENT_NAME}} presents with {{PRIMARY_DIAGNOSIS}} ({{ICD10_CODE}}). [Describe symptom onset, duration, severity, and functional impact. Reference specific exam findings and imaging results.]',
   false, true),

  (1, 'FAC-DEMO', 'SEC-IA-004', 'TMPL-IA-SPINE-001', 'conservative_treatment', 4,
   'Detail all conservative treatments attempted, including physical therapy (dates, visits, response), medications (names, doses, outcomes), injections, and other interventions. Emphasize failure or inadequate response to justify escalation.',
   'CONSERVATIVE TREATMENT HISTORY:\n\nThe following conservative measures have been attempted:\n\n1. Physical Therapy: [type, duration, visits, response]\n2. Medications: [list with doses and outcomes]\n3. Injections: [type, dates, response]\n4. Other: [activity modification, bracing, etc.]',
   false, true),

  (1, 'FAC-DEMO', 'SEC-IA-005', 'TMPL-IA-SPINE-001', 'medical_necessity', 5,
   'Present the medical necessity argument. Align each payer policy criterion with specific patient evidence. State explicitly how each requirement is met. If the policy requires failed conservative treatment, reference the specific treatments and outcomes. Use clinical reasoning to justify why the requested service is the appropriate next step.',
   'MEDICAL NECESSITY:\n\nBased on the clinical evidence above and the applicable coverage criteria, {{SERVICE_NAME}} is medically necessary for the following reasons:\n\n1. [Policy criterion] — [Patient evidence meeting it]\n2. [Policy criterion] — [Patient evidence meeting it]\n3. [Policy criterion] — [Patient evidence meeting it]',
   true, true),

  (1, 'FAC-DEMO', 'SEC-IA-006', 'TMPL-IA-SPINE-001', 'supporting_evidence', 6,
   'Cite specific diagnostic findings that support the request: imaging results with dates and key findings, relevant lab values, functional assessment scores, and any peer-reviewed literature or clinical guidelines that support the treatment plan.',
   'SUPPORTING EVIDENCE:\n\nDiagnostic Imaging:\n- [Modality, findings, date]\n\nClinical Guidelines:\n- [Guideline source and relevant recommendation]',
   true, true),

  (1, 'FAC-DEMO', 'SEC-IA-007', 'TMPL-IA-SPINE-001', 'conclusion', 7,
   'Write a professional closing that summarizes the request, reiterates medical necessity, offers to provide additional documentation, and includes provider signature block.',
   'CONCLUSION:\n\nBased on the comprehensive clinical evidence presented, I respectfully request authorization for {{SERVICE_NAME}} for {{PATIENT_NAME}}. This treatment is medically necessary and consistent with accepted standards of care.\n\nPlease do not hesitate to contact our office if additional information is needed.\n\nSincerely,\n\n{{PROVIDER_NAME}}, {{PROVIDER_CREDENTIALS}}\n{{PROVIDER_SPECIALTY}}\nNPI: {{PROVIDER_NPI}}\n{{FACILITY_NAME}}\n{{FACILITY_PHONE}}',
   false, false)
ON CONFLICT DO NOTHING;
