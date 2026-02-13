-- ============================================================================
-- Migration 002: Missing Tables & Columns for Prior Auth Platform
-- ============================================================================
-- Bridges the gap between the existing Newaza/demo schema (patients, coverage,
-- encounters, imaging, med_trials, preauth_requests, problems, therapy) and
-- the full set of tables/columns that server.js v3 expects.
--
-- Run AFTER 001_template_sections_and_logs.sql.
--
-- Usage:
--   psql -f 002_missing_tables_and_columns.sql
-- ============================================================================

-- ============================================================================
-- PART A: Add missing columns to EXISTING tables
-- ============================================================================

-- A1. coverage — add payer_id to link to the new payers table
ALTER TABLE demo.coverage
  ADD COLUMN IF NOT EXISTS payer_id VARCHAR(64);

-- Backfill payer_id from existing payer_key where possible
-- (payer_key appears to be the short identifier like "BCBS", "AETNA")
UPDATE demo.coverage
  SET payer_id = payer_key
  WHERE payer_id IS NULL AND payer_key IS NOT NULL AND payer_key <> '';

-- A2. encounters — add provider_id to link to the new providers table
ALTER TABLE demo.encounters
  ADD COLUMN IF NOT EXISTS provider_id VARCHAR(64);

-- A3. preauth_requests — add payer_id, provider_id, status
ALTER TABLE demo.preauth_requests
  ADD COLUMN IF NOT EXISTS payer_id VARCHAR(64);

ALTER TABLE demo.preauth_requests
  ADD COLUMN IF NOT EXISTS provider_id VARCHAR(64);

ALTER TABLE demo.preauth_requests
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'pending';


-- ============================================================================
-- PART B: Create NEW tables
-- ============================================================================

-- --------------------------------------------------------------------------
-- B1. facilities
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
-- B2. providers
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
  email            VARCHAR(128),
  signature_name   VARCHAR(256),
  is_active        BOOLEAN       NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, provider_id)
);

-- --------------------------------------------------------------------------
-- B3. payers
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.payers (
  tenant_id                    INTEGER       NOT NULL DEFAULT 1,
  facility_id                  VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  payer_id                     VARCHAR(64)   NOT NULL,
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

-- --------------------------------------------------------------------------
-- B4. payer_contacts
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
-- B5. payer_policies
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.payer_policies (
  tenant_id                 INTEGER       NOT NULL DEFAULT 1,
  facility_id               VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  policy_id                 VARCHAR(64)   NOT NULL,
  payer_id                  VARCHAR(64)   NOT NULL,
  policy_name               VARCHAR(256)  NOT NULL,
  service_category          VARCHAR(128),
  cpt_codes                 TEXT[],
  clinical_criteria         TEXT,
  required_documents        TEXT,
  required_failed_therapies INTEGER       DEFAULT 0,
  min_therapy_weeks         INTEGER       DEFAULT 0,
  guideline_source          TEXT,
  appeal_deadline_days      INTEGER,
  notes                     TEXT,
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

-- --------------------------------------------------------------------------
-- B6. letter_templates
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.letter_templates (
  tenant_id          INTEGER       NOT NULL DEFAULT 1,
  facility_id        VARCHAR(64)   NOT NULL DEFAULT 'FAC-DEMO',
  template_id        VARCHAR(64)   NOT NULL,
  template_name      VARCHAR(256)  NOT NULL,
  letter_type        VARCHAR(64)   NOT NULL DEFAULT 'initial_auth',
  service_category   VARCHAR(128),
  template_body      TEXT,
  instructions       TEXT,
  placeholders       JSONB,
  version            INTEGER       NOT NULL DEFAULT 1,
  is_active          BOOLEAN       NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, facility_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_letter_templates_type
  ON demo.letter_templates (tenant_id, facility_id, letter_type, is_active);

-- --------------------------------------------------------------------------
-- B7. generated_letters
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
-- B8. letter_status_history
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
-- PART C: Seed data for new reference tables
-- ============================================================================
-- These are starter rows so the system has something to work with.
-- Replace/supplement with your actual facility, provider, and payer data.
-- ============================================================================

-- C1. Seed facility
INSERT INTO demo.facilities
  (tenant_id, facility_id, facility_name, npi, address_line1, city, state, zip, phone, fax, email)
VALUES
  (1, 'FAC-DEMO', 'Newaza Spine & Pain Center', '1234567890',
   '123 Main Street', 'Dallas', 'TX', '75201',
   '(214) 555-0100', '(214) 555-0101', 'info@newazaspine.com')
ON CONFLICT DO NOTHING;

-- C2. Seed provider (update with your actual provider info)
INSERT INTO demo.providers
  (tenant_id, facility_id, provider_id, first_name, last_name, credentials, specialty, npi, phone, signature_name)
VALUES
  (1, 'FAC-DEMO', 'PROV-001', 'Nathan', 'Senior', 'MD',
   'Pain Management / Interventional Spine', '9876543210',
   '(214) 555-0100', 'Nathan Senior, MD')
ON CONFLICT DO NOTHING;

-- C3. Seed payers (common Texas payers — add/edit as needed)
INSERT INTO demo.payers
  (tenant_id, facility_id, payer_id, payer_name, payer_type, phone_pa, fax_pa,
   pa_turnaround_standard_days, pa_turnaround_urgent_days)
VALUES
  (1, 'FAC-DEMO', 'BCBS',   'Blue Cross Blue Shield of Texas', 'commercial',
   '(800) 441-9188', '(800) 555-0001', 15, 2),
  (1, 'FAC-DEMO', 'AETNA',  'Aetna',                          'commercial',
   '(800) 624-0756', '(800) 555-0002', 15, 2),
  (1, 'FAC-DEMO', 'CIGNA',  'Cigna Healthcare',               'commercial',
   '(800) 244-6224', '(800) 555-0003', 15, 2),
  (1, 'FAC-DEMO', 'UHC',    'UnitedHealthcare',               'commercial',
   '(800) 842-3844', '(800) 555-0004', 15, 2),
  (1, 'FAC-DEMO', 'HUMANA', 'Humana',                         'commercial',
   '(800) 457-4708', '(800) 555-0005', 14, 2)
ON CONFLICT DO NOTHING;

-- C4. Seed a sample payer policy (spine surgery — BCBS)
INSERT INTO demo.payer_policies
  (tenant_id, facility_id, policy_id, payer_id, policy_name, service_category,
   cpt_codes, clinical_criteria, required_documents,
   required_failed_therapies, min_therapy_weeks, guideline_source,
   appeal_deadline_days, effective_date)
VALUES
  (1, 'FAC-DEMO', 'POL-BCBS-SPINE-001', 'BCBS',
   'Lumbar Spine Surgery — BCBS TX',
   'spine_surgery',
   ARRAY['22612','22630','22633','22853','63047','63048','27447'],
   '1. Documented failure of conservative treatment for >= 6 weeks including physical therapy and medication management;
2. Diagnostic imaging (MRI or CT) confirming structural pathology correlating with clinical presentation;
3. Documented functional limitations in activities of daily living;
4. Neurological deficits consistent with imaging findings;
5. BMI < 40 or documented weight management plan if BMI >= 40',
   'MRI report, Physical therapy records, Medication history, Provider notes documenting functional limitations',
   2, 6,
   'BCBS TX Medical Policy: Surgery of the Spine (2024)',
   60,
   '2024-01-01')
ON CONFLICT DO NOTHING;

-- C4b. Seed epidural steroid injection policy (BCBS) — covers CPT 62323
INSERT INTO demo.payer_policies
  (tenant_id, facility_id, policy_id, payer_id, policy_name, service_category,
   cpt_codes, clinical_criteria, required_documents,
   required_failed_therapies, min_therapy_weeks, guideline_source,
   appeal_deadline_days, effective_date)
VALUES
  (1, 'FAC-DEMO', 'POL-BCBS-ESI-001', 'BCBS',
   'Epidural Steroid Injection — BCBS TX',
   'pain_management',
   ARRAY['62321','62322','62323','62324','62325','62326','62327'],
   'Epidural steroid injection is considered medically necessary when: (1) Diagnosis of radiculopathy or spinal stenosis confirmed by clinical exam and imaging; (2) Patient has failed at least 4-6 weeks of conservative treatment (PT, oral medications); (3) Maximum of 3 injections per region per 12-month period; (4) Subsequent injections require documented positive response (>50% pain relief for >2 weeks) from prior injection; (5) Fluoroscopic guidance required.',
   'MRI or CT showing correlating pathology, Physical therapy records, Medication trial documentation, Prior injection records if applicable, Pain scale documentation',
   2, 4,
   'MCG',
   60,
   '2024-01-01')
ON CONFLICT DO NOTHING;

-- C5. Seed letter template
INSERT INTO demo.letter_templates
  (tenant_id, facility_id, template_id, template_name, letter_type, service_category,
   instructions, version, is_active)
VALUES
  (1, 'FAC-DEMO', 'TMPL-IA-SPINE-001',
   'Initial Auth — Spine Surgery',
   'initial_auth',
   'spine_surgery',
   'Generate a comprehensive prior authorization letter for spine surgery. Address each payer policy criterion with specific patient evidence. Use formal medical tone. Include ICD-10 and CPT codes.',
   1, true),
  (1, 'FAC-DEMO', 'TMPL-APPEAL-001',
   'Appeal — General',
   'appeal',
   NULL,
   'Generate a peer-to-peer appeal letter referencing the original denial reason and providing additional clinical justification.',
   1, true)
ON CONFLICT DO NOTHING;

-- C5b. Backfill template_body for seed templates (INSERT above omits it)
UPDATE demo.letter_templates
  SET template_body = E'{{letter_date}}\n\n{{payer_name}}\nAttn: Prior Authorization Department\n{{payer_address}}\n\n{{payer_fax_line}}\n\nRe: Prior Authorization Request \u2014 Medical Necessity\nPatient: {{patient_name}}\nDate of Birth: {{patient_dob}}\nMember ID: {{member_id}}\nGroup ID: {{group_id}}\nPlan: {{plan_name}}\nRequesting Provider: {{provider_name}}, {{provider_credentials}}\nNPI: {{provider_npi}}\nFacility: {{facility_name}} | NPI: {{facility_npi}}\n\nDear Prior Authorization Review Team,\n\nI am writing to request prior authorization for {{service_name}} (CPT: {{cpt_code}} \u2014 {{cpt_description}}) for the above-referenced patient. The requested date of service is {{requested_dos}}.\n\nCLINICAL SUMMARY:\n\n{{patient_name}} is a {{patient_age}}-year-old {{patient_sex}} who presents with the following diagnoses:\n\n{{diagnoses_list}}\n\nHISTORY OF PRESENT ILLNESS:\n\n{{encounter_summary}}\n\nCONSERVATIVE TREATMENTS ATTEMPTED:\n\nThe patient has undergone the following conservative treatments prior to this request:\n\n{{failed_therapies}}\n\nMEDICATIONS TRIALED:\n\n{{medication_trials}}\n\nDIAGNOSTIC IMAGING:\n\n{{imaging_findings}}\n\nMEDICAL NECESSITY JUSTIFICATION:\n\n{{medical_necessity_summary}}\n\nBased on the clinical evidence above, {{service_name}} is medically necessary for this patient. The patient has failed appropriate conservative management, and the requested procedure/service is the next clinically appropriate step in their care. Delaying or denying this service would likely result in worsening of the patient\u2019s condition, increased pain, and functional decline.\n\n{{clinical_criteria_reference}}\n\nI respectfully request approval of this authorization. Please do not hesitate to contact our office at {{facility_phone}} if additional information is needed. I am available for a peer-to-peer review at your convenience.\n\nSincerely,\n\n{{signature_line}}\n{{provider_name}}, {{provider_credentials}}\n{{provider_specialty}}\nNPI: {{provider_npi}}\n{{facility_name}}\n{{facility_phone}} | Fax: {{facility_fax}}'
  WHERE template_id = 'TMPL-IA-SPINE-001' AND template_body IS NULL;


-- ============================================================================
-- Done. Summary:
-- ============================================================================
-- Added columns:
--   coverage.payer_id
--   encounters.provider_id
--   preauth_requests.payer_id, provider_id, status
--
-- Created tables:
--   facilities, providers, payers, payer_contacts, payer_policies,
--   letter_templates, generated_letters, letter_status_history
--
-- Seed data:
--   1 facility, 1 provider, 5 payers, 1 policy, 2 letter templates
--   (template_body backfilled for TMPL-IA-SPINE-001)
-- ============================================================================
