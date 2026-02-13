#!/usr/bin/env node
// eval/seed-golden-cases.js
// ============================================================================
// Seeds 10 golden test cases into the eval_test_cases table.
// All patient data is SYNTHETIC — no real PHI.
//
// Usage:
//   node eval/seed-golden-cases.js
//
// Requires PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE env vars
// (or falls back to localhost defaults).
// ============================================================================

import pg from "pg";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Optionally load .env
try {
  const dotenv = await import("dotenv");
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
} catch {
  // dotenv not required; env vars may be set directly
}

const S = process.env.CLINIC_SCHEMA || "demo";

const pool = new pg.Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "postgres",
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

// ============================================================================
// 10 Golden Test Cases
// ============================================================================

const CASES = [
  // --------------------------------------------------------------------------
  // 1. Simple lumbar fusion — BCBS initial auth (straightforward)
  // --------------------------------------------------------------------------
  {
    test_case_id: "golden-001",
    case_name: "Simple Lumbar Fusion - BCBS Initial Auth",
    service_category: "spine_surgery",
    payer_id: "BCBS",
    difficulty: "easy",
    tags: ["spine", "lumbar", "fusion", "initial_auth", "bcbs", "straightforward"],
    patient_profile: {
      patient_id: "EVAL-P001",
      first_name: "Robert",
      last_name: "Whitfield",
      dob: "1968-03-14",
      age: 57,
      sex: "M",
      problems: [
        { icd10: "M51.16", description: "Intervertebral disc degeneration, lumbar region", onset: "2024-01-15" },
        { icd10: "M54.5", description: "Low back pain", onset: "2023-08-20" },
        { icd10: "M47.816", description: "Spondylosis without myelopathy, lumbar region", onset: "2024-03-01" },
      ],
      therapy: [
        { type: "Physical Therapy", start_date: "2025-01-06", end_date: "2025-04-14", total_visits: 24, response: "Failed - continued pain and functional limitation despite completion" },
        { type: "Epidural Steroid Injection", start_date: "2025-02-20", end_date: "2025-02-20", total_visits: 1, response: "Failed - temporary relief for 2 weeks then recurrence" },
        { type: "Epidural Steroid Injection", start_date: "2025-04-03", end_date: "2025-04-03", total_visits: 1, response: "Failed - no meaningful relief" },
      ],
      imaging: [
        { modality: "MRI", body_part: "Lumbar Spine", date: "2025-03-10", impression: "Grade II spondylolisthesis at L4-L5 with moderate bilateral foraminal stenosis and disc desiccation. Mild facet arthropathy at L3-L4." },
        { modality: "X-Ray", body_part: "Lumbar Spine", date: "2025-01-02", impression: "Flexion/extension views demonstrate 4mm dynamic instability at L4-L5." },
      ],
      med_trials: [
        { medication: "Naproxen 500mg BID", start_date: "2024-11-01", end_date: "2025-01-05", outcome: "Inadequate relief, GI side effects" },
        { medication: "Gabapentin 300mg TID", start_date: "2025-01-10", end_date: "2025-03-15", outcome: "Minimal improvement in radicular symptoms" },
        { medication: "Cyclobenzaprine 10mg TID", start_date: "2024-11-15", end_date: "2025-01-05", outcome: "No significant benefit, drowsiness" },
      ],
      coverage: { payer: "BCBS", payer_name: "Blue Cross Blue Shield", member_id: "XWB881234567", group_id: "GRP-44210", plan: "PPO Select" },
      cpt_codes: ["22612", "22614", "20930"],
      icd10_codes: ["M51.16", "M54.5", "M47.816"],
      requested_procedure: "Posterior lumbar interbody fusion L4-L5",
      provider: { name: "Dr. Angela Torres", credentials: "MD, FACS", specialty: "Orthopedic Spine Surgery", npi: "1234567890" },
    },
    expected_sections: ["CLINICAL HISTORY", "DIAGNOSTIC FINDINGS", "CONSERVATIVE TREATMENT", "MEDICAL NECESSITY", "PROPOSED PROCEDURE"],
    expected_output: `Dear Blue Cross Blue Shield Medical Director,

Re: Prior Authorization Request for Posterior Lumbar Interbody Fusion
Patient: Robert Whitfield | DOB: 03/14/1968 | Member ID: XWB881234567
CPT Codes: 22612, 22614, 20930 | ICD-10: M51.16, M54.5, M47.816

CLINICAL HISTORY
Robert Whitfield is a 57-year-old male presenting with progressive lumbar degenerative disc disease and spondylolisthesis causing chronic low back pain and bilateral lower extremity radiculopathy. His symptoms have persisted for over 12 months with progressive functional decline despite comprehensive conservative management.

DIAGNOSTIC FINDINGS
MRI of the lumbar spine (03/10/2025) demonstrates Grade II spondylolisthesis at L4-L5 with moderate bilateral foraminal stenosis and disc desiccation. Flexion/extension radiographs (01/02/2025) confirm 4mm dynamic instability at L4-L5, meeting the threshold for surgical intervention.

CONSERVATIVE TREATMENT
Mr. Whitfield has exhausted conservative treatment options over 14+ weeks:
- Physical therapy: 24 visits (01/06/2025 - 04/14/2025) with continued pain and functional limitation
- Two epidural steroid injections (02/20/2025 and 04/03/2025) providing only temporary to no relief
- Pharmacotherapy including NSAIDs (naproxen), neuropathic agents (gabapentin), and muscle relaxants (cyclobenzaprine) all with inadequate results

MEDICAL NECESSITY
Posterior lumbar interbody fusion at L4-L5 is medically necessary. The patient has Grade II spondylolisthesis with documented dynamic instability, has failed 14+ weeks of conservative treatment including physical therapy, epidural injections, and multi-modal pharmacotherapy, and demonstrates progressive functional deterioration consistent with established surgical indications.

PROPOSED PROCEDURE
CPT 22612: Posterior lumbar interbody fusion at L4-L5
CPT 22614: Additional interspace fusion segment
CPT 20930: Morselized allograft for spine surgery

Sincerely,
Dr. Angela Torres, MD, FACS
Orthopedic Spine Surgery
NPI: 1234567890`,
  },

  // --------------------------------------------------------------------------
  // 2. Complex spine with multiple comorbidities (diabetes, obesity BMI 38)
  // --------------------------------------------------------------------------
  {
    test_case_id: "golden-002",
    case_name: "Complex Lumbar Fusion with Comorbidities - BCBS",
    service_category: "spine_surgery",
    payer_id: "BCBS",
    difficulty: "hard",
    tags: ["spine", "lumbar", "fusion", "comorbidities", "diabetes", "obesity", "complex"],
    patient_profile: {
      patient_id: "EVAL-P002",
      first_name: "Patricia",
      last_name: "Moreno",
      dob: "1962-08-22",
      age: 63,
      sex: "F",
      problems: [
        { icd10: "M51.16", description: "Intervertebral disc degeneration, lumbar region", onset: "2023-06-01" },
        { icd10: "M48.06", description: "Spinal stenosis, lumbar region", onset: "2023-06-01" },
        { icd10: "G89.4", description: "Chronic pain syndrome", onset: "2023-09-15" },
        { icd10: "E11.65", description: "Type 2 diabetes mellitus with hyperglycemia", onset: "2015-03-10" },
        { icd10: "E66.01", description: "Morbid obesity due to excess calories, BMI 38", onset: "2018-01-01" },
        { icd10: "G47.33", description: "Obstructive sleep apnea", onset: "2019-05-01" },
        { icd10: "I10", description: "Essential hypertension", onset: "2016-02-01" },
      ],
      therapy: [
        { type: "Physical Therapy", start_date: "2024-09-01", end_date: "2025-01-15", total_visits: 36, response: "Failed - persistent symptoms, limited by pain tolerance" },
        { type: "Aquatic Therapy", start_date: "2025-01-20", end_date: "2025-03-10", total_visits: 14, response: "Minimal improvement in pain, no functional gains" },
        { type: "Epidural Steroid Injection", start_date: "2024-10-15", end_date: "2024-10-15", total_visits: 1, response: "Failed - relief lasted 10 days" },
        { type: "Epidural Steroid Injection", start_date: "2024-12-05", end_date: "2024-12-05", total_visits: 1, response: "Failed - no appreciable relief" },
        { type: "Facet Joint Injection", start_date: "2025-02-14", end_date: "2025-02-14", total_visits: 1, response: "Failed - transient benefit only" },
      ],
      imaging: [
        { modality: "MRI", body_part: "Lumbar Spine", date: "2024-11-20", impression: "Severe central and lateral recess stenosis at L3-L4 and L4-L5. Multilevel disc degeneration with Grade I spondylolisthesis at L4-L5. Ligamentum flavum hypertrophy." },
        { modality: "CT Myelogram", body_part: "Lumbar Spine", date: "2025-03-22", impression: "Confirms severe stenosis at L3-L4 and L4-L5 with impingement of traversing nerve roots. Dynamic instability at L4-L5 segment." },
      ],
      med_trials: [
        { medication: "Meloxicam 15mg daily", start_date: "2024-07-01", end_date: "2024-09-15", outcome: "Inadequate pain control" },
        { medication: "Duloxetine 60mg daily", start_date: "2024-08-01", end_date: "2025-01-15", outcome: "Mild improvement in neuropathic symptoms, insufficient overall" },
        { medication: "Gabapentin 600mg TID", start_date: "2024-09-01", end_date: "2025-02-28", outcome: "Moderate neuropathic relief but intolerable dizziness" },
        { medication: "Tramadol 50mg Q6H PRN", start_date: "2024-10-01", end_date: "2025-03-01", outcome: "Limited relief, patient desires non-opioid alternatives" },
      ],
      coverage: { payer: "BCBS", payer_name: "Blue Cross Blue Shield", member_id: "XMP992345678", group_id: "GRP-55321", plan: "HMO Plus" },
      cpt_codes: ["22630", "22632", "22614", "63047", "63048", "20930"],
      icd10_codes: ["M51.16", "M48.06", "G89.4", "E11.65", "E66.01", "G47.33", "I10"],
      requested_procedure: "Posterior lumbar interbody fusion L3-L5 with decompression",
      provider: { name: "Dr. James Kirkland", credentials: "MD, PhD", specialty: "Neurosurgery", npi: "2345678901" },
      comorbidity_notes: "HbA1c 7.1% (down from 9.2%), BMI 38 (stable), blood pressure controlled on lisinopril. Pulmonology clearance for OSA. Endocrinology managing diabetes perioperatively.",
    },
    expected_sections: ["CLINICAL HISTORY", "COMORBIDITY MANAGEMENT", "DIAGNOSTIC FINDINGS", "CONSERVATIVE TREATMENT", "MEDICAL NECESSITY", "PROPOSED PROCEDURE"],
    expected_output: `Dear Blue Cross Blue Shield Medical Director,

Re: Prior Authorization Request for Posterior Lumbar Interbody Fusion with Decompression L3-L5
Patient: Patricia Moreno | DOB: 08/22/1962 | Member ID: XMP992345678
CPT Codes: 22630, 22632, 22614, 63047, 63048, 20930 | ICD-10: M51.16, M48.06, G89.4, E11.65, E66.01

CLINICAL HISTORY
Patricia Moreno is a 63-year-old female with multilevel lumbar degenerative disease, severe spinal stenosis, and chronic pain syndrome. She presents with progressive neurogenic claudication, bilateral lower extremity radiculopathy, and significant functional decline over 18+ months. Comorbidities include type 2 diabetes, morbid obesity (BMI 38), obstructive sleep apnea, and hypertension.

COMORBIDITY MANAGEMENT
The patient has been medically optimized for surgical intervention. HbA1c improved from 9.2% to 7.1% under endocrinology management. Blood pressure is controlled on lisinopril. Pulmonology clearance obtained for obstructive sleep apnea. These comorbidities have been addressed to minimize perioperative risk.

DIAGNOSTIC FINDINGS
MRI (11/20/2024) demonstrates severe central and lateral recess stenosis at L3-L4 and L4-L5 with multilevel disc degeneration and Grade I spondylolisthesis. CT myelogram (03/22/2025) confirms severe stenosis with nerve root impingement and dynamic instability.

CONSERVATIVE TREATMENT
Over 18+ months, Ms. Moreno has failed comprehensive conservative management:
- Physical therapy: 36 visits over 4.5 months with persistent symptoms
- Aquatic therapy: 14 sessions with minimal improvement
- Three injection procedures (2 epidural steroid, 1 facet joint) all failing to provide sustained relief
- Four medication trials including NSAIDs, SNRIs, anticonvulsants, and analgesics with inadequate results

MEDICAL NECESSITY
Given documented severe multilevel stenosis with neurological compromise, failure of comprehensive conservative treatment over 18 months, and progressive functional deterioration, posterior lumbar interbody fusion with decompression at L3-L5 is medically necessary. The patient's comorbidities have been optimized and surgical clearance obtained.

PROPOSED PROCEDURE
CPT 22630/22632: Posterior lumbar interbody fusion
CPT 63047/63048: Laminectomy with decompression
CPT 22614: Additional arthrodesis segment
CPT 20930: Morselized allograft

Sincerely,
Dr. James Kirkland, MD, PhD
Neurosurgery
NPI: 2345678901`,
  },

  // --------------------------------------------------------------------------
  // 3. Cervical spine surgery (different CPT codes: 63020, 22551)
  // --------------------------------------------------------------------------
  {
    test_case_id: "golden-003",
    case_name: "Cervical Disc Herniation ACDF - BCBS",
    service_category: "spine_surgery",
    payer_id: "BCBS",
    difficulty: "medium",
    tags: ["spine", "cervical", "ACDF", "discectomy", "radiculopathy"],
    patient_profile: {
      patient_id: "EVAL-P003",
      first_name: "David",
      last_name: "Nakamura",
      dob: "1975-11-30",
      age: 50,
      sex: "M",
      problems: [
        { icd10: "M50.121", description: "Cervical disc disorder at C5-C6, with radiculopathy", onset: "2024-02-10" },
        { icd10: "M50.321", description: "Other cervical disc degeneration at C5-C6", onset: "2024-02-10" },
        { icd10: "M54.12", description: "Radiculopathy, cervical region", onset: "2024-02-10" },
        { icd10: "G54.2", description: "Cervical root disorders", onset: "2024-06-01" },
      ],
      therapy: [
        { type: "Physical Therapy", start_date: "2025-02-01", end_date: "2025-04-30", total_visits: 20, response: "Failed - no improvement in arm pain or weakness" },
        { type: "Cervical Epidural Steroid Injection", start_date: "2025-03-10", end_date: "2025-03-10", total_visits: 1, response: "Failed - 5 days of partial relief then full return" },
        { type: "Cervical Epidural Steroid Injection", start_date: "2025-04-15", end_date: "2025-04-15", total_visits: 1, response: "Failed - no relief" },
      ],
      imaging: [
        { modality: "MRI", body_part: "Cervical Spine", date: "2025-02-15", impression: "Large left paracentral disc herniation at C5-C6 with severe left neural foraminal stenosis and impingement of the left C6 nerve root. Mild disc bulge at C4-C5 without significant stenosis." },
      ],
      med_trials: [
        { medication: "Ibuprofen 800mg TID", start_date: "2024-12-01", end_date: "2025-02-15", outcome: "Inadequate relief" },
        { medication: "Methylprednisolone dose pack", start_date: "2025-01-15", end_date: "2025-01-21", outcome: "Temporary relief during taper, symptoms returned" },
        { medication: "Pregabalin 75mg BID", start_date: "2025-02-01", end_date: "2025-04-30", outcome: "Moderate improvement in shooting pain but persistent weakness" },
      ],
      coverage: { payer: "BCBS", payer_name: "Blue Cross Blue Shield", member_id: "DNK773456789", group_id: "GRP-88102", plan: "PPO Standard" },
      cpt_codes: ["22551", "63020"],
      icd10_codes: ["M50.121", "M50.321", "M54.12", "G54.2"],
      requested_procedure: "Anterior cervical discectomy and fusion (ACDF) at C5-C6",
      provider: { name: "Dr. Sarah Chen", credentials: "MD", specialty: "Orthopedic Spine Surgery", npi: "3456789012" },
    },
    expected_sections: ["CLINICAL HISTORY", "DIAGNOSTIC FINDINGS", "CONSERVATIVE TREATMENT", "MEDICAL NECESSITY", "PROPOSED PROCEDURE"],
    expected_output: `Dear Blue Cross Blue Shield Medical Director,

Re: Prior Authorization Request for Anterior Cervical Discectomy and Fusion at C5-C6
Patient: David Nakamura | DOB: 11/30/1975 | Member ID: DNK773456789
CPT Codes: 22551, 63020 | ICD-10: M50.121, M50.321, M54.12, G54.2

CLINICAL HISTORY
David Nakamura is a 50-year-old male presenting with progressive left cervical radiculopathy and upper extremity weakness secondary to a large disc herniation at C5-C6. He reports severe left arm pain, numbness in the C6 dermatome, and progressive grip weakness over 5 months.

DIAGNOSTIC FINDINGS
MRI of the cervical spine (02/15/2025) reveals a large left paracentral disc herniation at C5-C6 causing severe left neural foraminal stenosis with direct impingement of the left C6 nerve root. Physical examination confirms C6 dermatomal sensory changes and grip strength deficit.

CONSERVATIVE TREATMENT
Mr. Nakamura has completed a comprehensive conservative treatment course over 12+ weeks:
- Physical therapy: 20 visits over 3 months with no improvement in arm pain or weakness
- Two cervical epidural steroid injections (03/10/2025 and 04/15/2025) failing to provide sustained relief
- Medication trials including NSAIDs, oral steroids, and pregabalin with insufficient symptom control

MEDICAL NECESSITY
Anterior cervical discectomy and fusion at C5-C6 is medically necessary given the documented large disc herniation with nerve root compression, progressive neurological deficit, and failure of 12+ weeks of comprehensive conservative management. Continued delay risks permanent neurological damage.

PROPOSED PROCEDURE
CPT 22551: Anterior cervical discectomy and interbody fusion at C5-C6
CPT 63020: Cervical laminotomy/foraminotomy for decompression

Sincerely,
Dr. Sarah Chen, MD
Orthopedic Spine Surgery
NPI: 3456789012`,
  },

  // --------------------------------------------------------------------------
  // 4. Appeal after denial (includes denial_reason in profile)
  // --------------------------------------------------------------------------
  {
    test_case_id: "golden-004",
    case_name: "Appeal After Denial - Lumbar Fusion BCBS",
    service_category: "spine_surgery",
    payer_id: "BCBS",
    difficulty: "hard",
    tags: ["spine", "appeal", "denial", "lumbar", "fusion", "documentation"],
    patient_profile: {
      patient_id: "EVAL-P004",
      first_name: "Margaret",
      last_name: "Sullivan",
      dob: "1959-05-17",
      age: 66,
      sex: "F",
      denial_reason: "Insufficient documentation of conservative treatment duration. Policy requires minimum 6 weeks of supervised physical therapy. Submitted records do not clearly document therapy dates and outcomes.",
      denial_date: "2025-02-01",
      denial_code: "AUTH-DENY-2025-88431",
      original_auth_id: "PA-2025-44210",
      problems: [
        { icd10: "M43.16", description: "Spondylolisthesis, lumbar region", onset: "2024-01-01" },
        { icd10: "M48.06", description: "Spinal stenosis, lumbar region", onset: "2024-01-01" },
        { icd10: "M54.41", description: "Lumbago with sciatica, right side", onset: "2024-02-15" },
        { icd10: "M51.16", description: "Intervertebral disc degeneration, lumbar region", onset: "2024-01-01" },
      ],
      therapy: [
        { type: "Physical Therapy", start_date: "2024-06-01", end_date: "2024-09-15", total_visits: 30, response: "Failed - completed full program, no sustained improvement" },
        { type: "Chiropractic", start_date: "2024-07-01", end_date: "2024-08-30", total_visits: 12, response: "Failed - transient relief only" },
        { type: "Epidural Steroid Injection", start_date: "2024-08-20", end_date: "2024-08-20", total_visits: 1, response: "Failed - 1 week of partial relief" },
        { type: "Epidural Steroid Injection", start_date: "2024-10-05", end_date: "2024-10-05", total_visits: 1, response: "Failed - no meaningful relief" },
        { type: "Epidural Steroid Injection", start_date: "2024-12-10", end_date: "2024-12-10", total_visits: 1, response: "Failed - no relief" },
      ],
      imaging: [
        { modality: "MRI", body_part: "Lumbar Spine", date: "2024-07-15", impression: "Grade II spondylolisthesis at L4-L5 with severe bilateral foraminal stenosis. Central canal stenosis measuring 7mm AP diameter." },
        { modality: "X-Ray", body_part: "Lumbar Spine", date: "2024-11-20", impression: "Standing views confirm Grade II anterolisthesis at L4-L5 with 6mm translation. Dynamic instability on flexion/extension." },
        { modality: "EMG/NCV", body_part: "Bilateral Lower Extremities", date: "2025-01-08", impression: "Bilateral L5 radiculopathy, moderate severity, with active denervation." },
      ],
      med_trials: [
        { medication: "Naproxen 500mg BID", start_date: "2024-05-01", end_date: "2024-07-15", outcome: "Inadequate relief" },
        { medication: "Gabapentin 600mg TID", start_date: "2024-06-15", end_date: "2024-12-31", outcome: "Partial neuropathic relief, insufficient overall" },
        { medication: "Duloxetine 60mg daily", start_date: "2024-08-01", end_date: "2025-01-15", outcome: "No meaningful improvement" },
      ],
      coverage: { payer: "BCBS", payer_name: "Blue Cross Blue Shield", member_id: "MSL664567890", group_id: "GRP-33209", plan: "PPO Premium" },
      cpt_codes: ["22612", "22614", "63047", "20930"],
      icd10_codes: ["M43.16", "M48.06", "M54.41", "M51.16"],
      requested_procedure: "Posterior lumbar interbody fusion with decompression L4-L5",
      provider: { name: "Dr. Angela Torres", credentials: "MD, FACS", specialty: "Orthopedic Spine Surgery", npi: "1234567890" },
    },
    expected_sections: ["APPEAL REFERENCE", "RESPONSE TO DENIAL", "CLINICAL HISTORY", "CONSERVATIVE TREATMENT DOCUMENTATION", "DIAGNOSTIC FINDINGS", "MEDICAL NECESSITY"],
    expected_output: `Dear Blue Cross Blue Shield Appeals Department,

Re: APPEAL - Prior Authorization Denial for Posterior Lumbar Interbody Fusion with Decompression
Denial Reference: AUTH-DENY-2025-88431 | Denial Date: 02/01/2025
Patient: Margaret Sullivan | DOB: 05/17/1959 | Member ID: MSL664567890
CPT Codes: 22612, 22614, 63047, 20930 | ICD-10: M43.16, M48.06, M54.41, M51.16

APPEAL REFERENCE
This letter is a formal appeal of prior authorization denial AUTH-DENY-2025-88431, dated February 1, 2025, for posterior lumbar interbody fusion with decompression at L4-L5.

RESPONSE TO DENIAL
The denial states insufficient documentation of conservative treatment duration, requiring minimum 6 weeks of supervised physical therapy. We respectfully submit that this criterion has been met and exceeded. Enclosed are detailed physical therapy records documenting 30 supervised visits over 15 weeks (06/01/2024 through 09/15/2024), far exceeding the 6-week minimum. Additionally, 12 chiropractic visits, 3 epidural steroid injections, and multiple medication trials are documented.

CLINICAL HISTORY
Margaret Sullivan is a 66-year-old female with Grade II lumbar spondylolisthesis at L4-L5, severe spinal stenosis, and bilateral L5 radiculopathy with progressive neurogenic claudication.

CONSERVATIVE TREATMENT DOCUMENTATION
- Physical therapy: 30 visits, 06/01/2024 to 09/15/2024 (15 weeks) - failed
- Chiropractic care: 12 visits, 07/01/2024 to 08/30/2024 - failed
- Three epidural steroid injections (08/2024, 10/2024, 12/2024) - all failed
- Medications: naproxen, gabapentin, duloxetine - all inadequate

DIAGNOSTIC FINDINGS
MRI (07/15/2024): Grade II spondylolisthesis with severe bilateral foraminal stenosis. Standing radiographs (11/20/2024): 6mm translation with dynamic instability. EMG/NCV (01/08/2025): bilateral L5 radiculopathy with active denervation.

MEDICAL NECESSITY
We respectfully request reversal of the denial. Mrs. Sullivan has documented conservative treatment failure exceeding policy requirements, progressive neurological deficit confirmed by electrodiagnostic studies, and severe structural pathology on advanced imaging. Surgical intervention is medically necessary.

Respectfully submitted,
Dr. Angela Torres, MD, FACS
Orthopedic Spine Surgery
NPI: 1234567890`,
  },

  // --------------------------------------------------------------------------
  // 5. Peer-to-peer letter (conversational tone)
  // --------------------------------------------------------------------------
  {
    test_case_id: "golden-005",
    case_name: "Peer-to-Peer Review Preparation - Lumbar Decompression",
    service_category: "spine_surgery",
    payer_id: "BCBS",
    difficulty: "medium",
    tags: ["spine", "peer_to_peer", "conversational", "decompression", "lumbar"],
    patient_profile: {
      patient_id: "EVAL-P005",
      first_name: "Thomas",
      last_name: "Brennan",
      dob: "1970-07-09",
      age: 55,
      sex: "M",
      peer_reviewer: "Dr. Sarah Thompson, MD, Medical Director",
      problems: [
        { icd10: "M48.06", description: "Spinal stenosis, lumbar region", onset: "2024-05-01" },
        { icd10: "M54.41", description: "Lumbago with sciatica, right side", onset: "2024-06-15" },
        { icd10: "G83.4", description: "Cauda equina syndrome", onset: "2025-04-01" },
      ],
      therapy: [
        { type: "Physical Therapy", start_date: "2025-01-10", end_date: "2025-04-10", total_visits: 24, response: "Failed - symptoms worsened during program" },
        { type: "Epidural Steroid Injection", start_date: "2025-02-18", end_date: "2025-02-18", total_visits: 1, response: "Failed - brief partial relief" },
      ],
      imaging: [
        { modality: "MRI", body_part: "Lumbar Spine", date: "2025-03-05", impression: "Severe central canal stenosis at L4-L5 measuring 5mm AP diameter. Moderate stenosis at L3-L4. Disc bulge with ligamentum flavum hypertrophy." },
      ],
      med_trials: [
        { medication: "Naproxen 500mg BID", start_date: "2024-12-01", end_date: "2025-02-15", outcome: "Inadequate" },
        { medication: "Gabapentin 300mg TID", start_date: "2025-01-10", end_date: "2025-04-10", outcome: "Minimal improvement" },
      ],
      coverage: { payer: "BCBS", payer_name: "Blue Cross Blue Shield", member_id: "TBR555678901", group_id: "GRP-77430", plan: "PPO Select" },
      cpt_codes: ["63047", "63048"],
      icd10_codes: ["M48.06", "M54.41", "G83.4"],
      requested_procedure: "Lumbar laminectomy with decompression L3-L5",
      provider: { name: "Dr. James Kirkland", credentials: "MD, PhD", specialty: "Neurosurgery", npi: "2345678901" },
    },
    expected_sections: ["PEER-TO-PEER SUMMARY", "KEY CLINICAL POINTS", "CONSERVATIVE TREATMENT SUMMARY", "SURGICAL RATIONALE"],
    expected_output: `Dear Colleague,

Re: Peer-to-Peer Discussion - Lumbar Laminectomy with Decompression L3-L5
Patient: Thomas Brennan | DOB: 07/09/1970 | Member ID: TBR555678901

Thank you for taking the time to discuss this case. I would like to present the clinical rationale for lumbar laminectomy with decompression for Mr. Brennan.

PEER-TO-PEER SUMMARY
Thomas Brennan is a 55-year-old male with severe lumbar spinal stenosis who has developed progressive neurogenic claudication and early cauda equina involvement. I am requesting authorization for lumbar laminectomy at L3-L5 (CPT 63047, 63048).

KEY CLINICAL POINTS
The critical finding is severe central canal stenosis at L4-L5 measuring only 5mm on MRI, with moderate stenosis at L3-L4. The patient has developed bladder hesitancy and saddle area paresthesias, early indicators of cauda equina compromise warranting timely surgical intervention to prevent irreversible neurological damage.

CONSERVATIVE TREATMENT SUMMARY
Mr. Brennan completed 24 physical therapy visits over 3 months, one epidural steroid injection, and trials of NSAIDs and gabapentin. Symptoms worsened during conservative management, and he now reports inability to walk more than one block without severe leg pain.

SURGICAL RATIONALE
The combination of severe anatomic stenosis (5mm), progressive neurological symptoms including early cauda equina signs, and failure of conservative treatment makes this clinically urgent. Decompressive laminectomy is the established standard of care. Delaying intervention risks permanent bowel and bladder dysfunction.

I am happy to discuss any additional clinical details or provide further documentation.

Sincerely,
Dr. James Kirkland, MD, PhD
Neurosurgery
NPI: 2345678901`,
  },

  // --------------------------------------------------------------------------
  // 6. Missing imaging (edge case - no MRI in data)
  // --------------------------------------------------------------------------
  {
    test_case_id: "golden-006",
    case_name: "Edge Case - Missing Imaging Data",
    service_category: "spine_surgery",
    payer_id: "BCBS",
    difficulty: "edge",
    tags: ["spine", "edge_case", "missing_imaging", "lumbar", "incomplete_data"],
    patient_profile: {
      patient_id: "EVAL-P006",
      first_name: "Linda",
      last_name: "Kowalski",
      dob: "1971-02-28",
      age: 55,
      sex: "F",
      problems: [
        { icd10: "M51.16", description: "Intervertebral disc degeneration, lumbar region", onset: "2024-06-01" },
        { icd10: "M54.5", description: "Low back pain", onset: "2024-04-15" },
      ],
      therapy: [
        { type: "Physical Therapy", start_date: "2025-01-15", end_date: "2025-04-01", total_visits: 18, response: "Failed - no improvement" },
        { type: "Epidural Steroid Injection", start_date: "2025-03-01", end_date: "2025-03-01", total_visits: 1, response: "Failed - no relief" },
      ],
      imaging: [],
      med_trials: [
        { medication: "Ibuprofen 600mg TID", start_date: "2024-11-01", end_date: "2025-01-15", outcome: "Inadequate relief" },
        { medication: "Cyclobenzaprine 10mg TID", start_date: "2024-11-15", end_date: "2025-01-15", outcome: "No benefit" },
      ],
      coverage: { payer: "BCBS", payer_name: "Blue Cross Blue Shield", member_id: "LKW446789012", group_id: "GRP-22150", plan: "HMO Standard" },
      cpt_codes: ["22612"],
      icd10_codes: ["M51.16", "M54.5"],
      requested_procedure: "Posterior lumbar interbody fusion L4-L5",
      provider: { name: "Dr. Angela Torres", credentials: "MD, FACS", specialty: "Orthopedic Spine Surgery", npi: "1234567890" },
    },
    expected_sections: ["CLINICAL HISTORY", "DIAGNOSTIC FINDINGS", "CONSERVATIVE TREATMENT", "MEDICAL NECESSITY", "PROPOSED PROCEDURE"],
    expected_output: `Dear Blue Cross Blue Shield Medical Director,

Re: Prior Authorization Request for Posterior Lumbar Interbody Fusion L4-L5
Patient: Linda Kowalski | DOB: 02/28/1971 | Member ID: LKW446789012
CPT Code: 22612 | ICD-10: M51.16, M54.5

CLINICAL HISTORY
Linda Kowalski is a 55-year-old female presenting with chronic lumbar degenerative disc disease and persistent low back pain refractory to conservative management over 11+ weeks.

DIAGNOSTIC FINDINGS
[MISSING: Advanced imaging studies (MRI or CT) of the lumbar spine are not available in the current patient record. Imaging is required to confirm the structural pathology and support the surgical indication. We recommend obtaining lumbar MRI prior to final authorization determination.]

CONSERVATIVE TREATMENT
Ms. Kowalski has completed conservative treatment including:
- Physical therapy: 18 visits over 10 weeks with no improvement
- One epidural steroid injection with no relief
- Medication trials including NSAIDs (ibuprofen - inadequate) and muscle relaxants (cyclobenzaprine - no benefit)

MEDICAL NECESSITY
Based on the clinical presentation and failure of conservative treatment, surgical intervention may be medically necessary. However, advanced imaging documentation is needed to confirm the structural pathology. We are in the process of obtaining requisite imaging studies and will supplement this request upon completion.

PROPOSED PROCEDURE
CPT 22612: Posterior lumbar interbody fusion at L4-L5

Sincerely,
Dr. Angela Torres, MD, FACS
Orthopedic Spine Surgery
NPI: 1234567890`,
  },

  // --------------------------------------------------------------------------
  // 7. Insufficient therapy history (only 3 weeks PT, policy requires 6)
  // --------------------------------------------------------------------------
  {
    test_case_id: "golden-007",
    case_name: "Edge Case - Insufficient Therapy Duration",
    service_category: "spine_surgery",
    payer_id: "BCBS",
    difficulty: "edge",
    tags: ["spine", "edge_case", "insufficient_therapy", "lumbar", "policy_gap"],
    patient_profile: {
      patient_id: "EVAL-P007",
      first_name: "Gary",
      last_name: "Hutchinson",
      dob: "1965-09-12",
      age: 60,
      sex: "M",
      problems: [
        { icd10: "M51.16", description: "Intervertebral disc degeneration, lumbar region", onset: "2025-01-15" },
        { icd10: "M54.5", description: "Low back pain", onset: "2025-01-01" },
        { icd10: "M54.41", description: "Lumbago with sciatica, right side", onset: "2025-02-01" },
      ],
      therapy: [
        { type: "Physical Therapy", start_date: "2025-04-01", end_date: "2025-04-22", total_visits: 6, response: "Discontinued early - patient reported worsening pain with therapy exercises" },
      ],
      imaging: [
        { modality: "MRI", body_part: "Lumbar Spine", date: "2025-03-20", impression: "Broad-based disc herniation at L4-L5 with moderate right-sided foraminal stenosis. Mild disc bulge at L5-S1." },
      ],
      med_trials: [
        { medication: "Naproxen 500mg BID", start_date: "2025-02-01", end_date: "2025-04-01", outcome: "Insufficient relief" },
      ],
      coverage: { payer: "BCBS", payer_name: "Blue Cross Blue Shield", member_id: "GHT337890123", group_id: "GRP-66901", plan: "PPO Standard" },
      cpt_codes: ["22612"],
      icd10_codes: ["M51.16", "M54.5", "M54.41"],
      requested_procedure: "Posterior lumbar interbody fusion L4-L5",
      provider: { name: "Dr. Sarah Chen", credentials: "MD", specialty: "Orthopedic Spine Surgery", npi: "3456789012" },
      policy_requirement_note: "BCBS policy requires minimum 6 weeks of supervised physical therapy before surgical authorization.",
    },
    expected_sections: ["CLINICAL HISTORY", "DIAGNOSTIC FINDINGS", "CONSERVATIVE TREATMENT", "THERAPY DURATION JUSTIFICATION", "MEDICAL NECESSITY", "PROPOSED PROCEDURE"],
    expected_output: `Dear Blue Cross Blue Shield Medical Director,

Re: Prior Authorization Request for Posterior Lumbar Interbody Fusion L4-L5
Patient: Gary Hutchinson | DOB: 09/12/1965 | Member ID: GHT337890123
CPT Code: 22612 | ICD-10: M51.16, M54.5, M54.41

CLINICAL HISTORY
Gary Hutchinson is a 60-year-old male presenting with lumbar disc herniation at L4-L5 and right-sided sciatica with progressive low back pain and right lower extremity radiculopathy over the past 4 months.

DIAGNOSTIC FINDINGS
MRI of the lumbar spine (03/20/2025) demonstrates a broad-based disc herniation at L4-L5 with moderate right-sided foraminal stenosis. Mild disc bulge at L5-S1.

CONSERVATIVE TREATMENT
Mr. Hutchinson has undergone the following conservative measures:
- Physical therapy: 6 visits over 3 weeks (04/01/2025 to 04/22/2025) - discontinued early due to significant worsening of pain during therapy
- Naproxen 500mg BID for 2 months with insufficient relief

THERAPY DURATION JUSTIFICATION
We acknowledge that the physical therapy course of 3 weeks falls short of the standard 6-week policy requirement. However, therapy was discontinued because the patient experienced clinically significant worsening of radicular symptoms during supervised sessions. Continuing physical therapy in the presence of a disc herniation causing nerve compression and escalating symptoms is medically contraindicated and could result in further neurological compromise. We respectfully request consideration of this clinical exception.

MEDICAL NECESSITY
Given the documented disc herniation with foraminal stenosis, failure to tolerate physical therapy due to worsening symptoms, and progressive radiculopathy, surgical intervention is warranted. We request the medical director's consideration of the clinical circumstances surrounding the abbreviated therapy course.

PROPOSED PROCEDURE
CPT 22612: Posterior lumbar interbody fusion at L4-L5

Sincerely,
Dr. Sarah Chen, MD
Orthopedic Spine Surgery
NPI: 3456789012`,
  },

  // --------------------------------------------------------------------------
  // 8. Multiple medications tried (extensive med_trials)
  // --------------------------------------------------------------------------
  {
    test_case_id: "golden-008",
    case_name: "Extensive Medication History - Lumbar Fusion BCBS",
    service_category: "spine_surgery",
    payer_id: "BCBS",
    difficulty: "medium",
    tags: ["spine", "extensive_meds", "lumbar", "fusion", "pharmacotherapy"],
    patient_profile: {
      patient_id: "EVAL-P008",
      first_name: "Catherine",
      last_name: "Reeves",
      dob: "1960-12-05",
      age: 65,
      sex: "F",
      problems: [
        { icd10: "M51.16", description: "Intervertebral disc degeneration, lumbar region", onset: "2023-06-01" },
        { icd10: "M47.816", description: "Spondylosis without myelopathy, lumbar region", onset: "2023-08-01" },
        { icd10: "M54.5", description: "Low back pain", onset: "2023-06-01" },
        { icd10: "G89.29", description: "Other chronic pain", onset: "2024-01-01" },
      ],
      therapy: [
        { type: "Physical Therapy", start_date: "2024-06-01", end_date: "2024-09-30", total_visits: 32, response: "Failed - marginal short-term improvement, symptoms returned" },
        { type: "Epidural Steroid Injection", start_date: "2024-08-15", end_date: "2024-08-15", total_visits: 1, response: "Failed - 2 weeks relief then recurrence" },
        { type: "Epidural Steroid Injection", start_date: "2024-10-20", end_date: "2024-10-20", total_visits: 1, response: "Failed - minimal relief" },
        { type: "Radiofrequency Ablation", start_date: "2025-01-10", end_date: "2025-01-10", total_visits: 1, response: "Failed - 4 weeks moderate relief then full return" },
      ],
      imaging: [
        { modality: "MRI", body_part: "Lumbar Spine", date: "2024-07-10", impression: "Multilevel disc degeneration L3-L4, L4-L5, and L5-S1 with moderate central stenosis at L4-L5. Grade I spondylolisthesis at L4-L5. Bilateral facet arthropathy." },
      ],
      med_trials: [
        { medication: "Naproxen 500mg BID", start_date: "2024-03-01", end_date: "2024-05-15", outcome: "Inadequate pain control, GI irritation" },
        { medication: "Meloxicam 15mg daily", start_date: "2024-05-20", end_date: "2024-07-15", outcome: "Marginal improvement, renal concern" },
        { medication: "Celecoxib 200mg daily", start_date: "2024-07-20", end_date: "2024-09-30", outcome: "Better GI tolerance but insufficient pain relief" },
        { medication: "Gabapentin 600mg TID", start_date: "2024-06-01", end_date: "2024-10-15", outcome: "Partial neuropathic relief, dose-limiting dizziness" },
        { medication: "Pregabalin 150mg BID", start_date: "2024-10-20", end_date: "2025-01-15", outcome: "Slight improvement over gabapentin, still insufficient" },
        { medication: "Duloxetine 60mg daily", start_date: "2024-08-01", end_date: "2024-12-15", outcome: "Modest improvement in pain scores, nausea" },
        { medication: "Cyclobenzaprine 10mg TID", start_date: "2024-04-01", end_date: "2024-06-15", outcome: "Drowsiness, no significant benefit" },
        { medication: "Tizanidine 4mg TID", start_date: "2024-06-20", end_date: "2024-08-30", outcome: "Sedation, minimal muscle relaxation benefit" },
        { medication: "Tramadol 50mg Q6H PRN", start_date: "2024-09-01", end_date: "2025-01-31", outcome: "Moderate short-term relief, patient wants to avoid opioid dependence" },
        { medication: "Topical lidocaine patches", start_date: "2024-11-01", end_date: "2025-02-28", outcome: "Minimal additional benefit" },
      ],
      coverage: { payer: "BCBS", payer_name: "Blue Cross Blue Shield", member_id: "CRV228901234", group_id: "GRP-11587", plan: "PPO Premium" },
      cpt_codes: ["22612", "22614", "20930"],
      icd10_codes: ["M51.16", "M47.816", "M54.5", "G89.29"],
      requested_procedure: "Posterior lumbar interbody fusion L4-L5",
      provider: { name: "Dr. Angela Torres", credentials: "MD, FACS", specialty: "Orthopedic Spine Surgery", npi: "1234567890" },
    },
    expected_sections: ["CLINICAL HISTORY", "DIAGNOSTIC FINDINGS", "PHARMACOTHERAPY HISTORY", "CONSERVATIVE TREATMENT", "MEDICAL NECESSITY", "PROPOSED PROCEDURE"],
    expected_output: `Dear Blue Cross Blue Shield Medical Director,

Re: Prior Authorization Request for Posterior Lumbar Interbody Fusion L4-L5
Patient: Catherine Reeves | DOB: 12/05/1960 | Member ID: CRV228901234
CPT Codes: 22612, 22614, 20930 | ICD-10: M51.16, M47.816, M54.5, G89.29

CLINICAL HISTORY
Catherine Reeves is a 65-year-old female with chronic multilevel lumbar degenerative disease and chronic pain syndrome causing progressive low back pain with bilateral lower extremity symptoms for over 12 months.

DIAGNOSTIC FINDINGS
MRI of the lumbar spine (07/10/2024) reveals multilevel disc degeneration at L3-L4, L4-L5, and L5-S1 with moderate central stenosis at L4-L5, Grade I spondylolisthesis at L4-L5, and bilateral facet arthropathy.

PHARMACOTHERAPY HISTORY
Ms. Reeves has undergone an extensive pharmacotherapy course over 12+ months spanning multiple drug classes:
- NSAIDs: naproxen (GI side effects), meloxicam (renal concern), celecoxib (insufficient relief)
- Neuropathic agents: gabapentin 600mg TID (dose-limiting dizziness), pregabalin 150mg BID (still insufficient)
- SNRI: duloxetine 60mg daily (modest improvement, nausea)
- Muscle relaxants: cyclobenzaprine (no benefit), tizanidine (sedation)
- Analgesic: tramadol (moderate short-term relief, patient avoiding opioid dependence)
- Topical: lidocaine patches (minimal benefit)

All 10 medication trials have been exhausted without achieving adequate pain control.

CONSERVATIVE TREATMENT
Beyond pharmacotherapy:
- Physical therapy: 32 visits over 4 months with only marginal short-term improvement
- Two epidural steroid injections providing temporary to minimal relief
- Radiofrequency ablation with 4 weeks moderate relief followed by full recurrence

MEDICAL NECESSITY
After 12+ months of comprehensive multi-modal conservative management including 10 medication trials across 5 drug classes, extensive physical therapy, injection therapy, and radiofrequency ablation, posterior lumbar interbody fusion at L4-L5 is medically necessary. The patient has exhausted all reasonable non-surgical options.

PROPOSED PROCEDURE
CPT 22612: Posterior lumbar interbody fusion, first interspace
CPT 22614: Additional arthrodesis segment
CPT 20930: Morselized allograft

Sincerely,
Dr. Angela Torres, MD, FACS
Orthopedic Spine Surgery
NPI: 1234567890`,
  },

  // --------------------------------------------------------------------------
  // 9. Urgent auth (acute neurological deficit, cauda equina)
  // --------------------------------------------------------------------------
  {
    test_case_id: "golden-009",
    case_name: "Urgent Auth - Cauda Equina Syndrome",
    service_category: "spine_surgery",
    payer_id: "BCBS",
    difficulty: "hard",
    tags: ["spine", "urgent", "cauda_equina", "emergency", "lumbar", "decompression", "neurological"],
    patient_profile: {
      patient_id: "EVAL-P009",
      first_name: "William",
      last_name: "Okafor",
      dob: "1972-04-18",
      age: 53,
      sex: "M",
      urgency: "emergent",
      problems: [
        { icd10: "G83.4", description: "Cauda equina syndrome", onset: "2025-05-01" },
        { icd10: "M51.16", description: "Intervertebral disc degeneration, lumbar region", onset: "2025-04-28" },
        { icd10: "M51.17", description: "Intervertebral disc degeneration, lumbosacral region", onset: "2025-04-28" },
        { icd10: "N31.9", description: "Neuromuscular dysfunction of bladder, unspecified", onset: "2025-05-01" },
      ],
      therapy: [],
      imaging: [
        { modality: "MRI", body_part: "Lumbar Spine", date: "2025-05-01", impression: "URGENT: Large central disc extrusion at L4-L5 with severe cauda equina compression. Complete effacement of the thecal sac. Compression of multiple nerve roots including S1-S3 sacral roots." },
      ],
      med_trials: [],
      coverage: { payer: "BCBS", payer_name: "Blue Cross Blue Shield", member_id: "WOK119012345", group_id: "GRP-99875", plan: "PPO Select" },
      cpt_codes: ["63047", "63048"],
      icd10_codes: ["G83.4", "M51.16", "M51.17", "N31.9"],
      requested_procedure: "Emergent lumbar laminectomy with decompression L4-L5",
      provider: { name: "Dr. James Kirkland", credentials: "MD, PhD", specialty: "Neurosurgery", npi: "2345678901" },
      clinical_urgency: "Acute onset bilateral leg weakness, saddle anesthesia, urinary retention. Bilateral LE weakness 3/5, absent perianal sensation, post-void residual 400mL. Onset within 48 hours.",
    },
    expected_sections: ["URGENT AUTHORIZATION REQUEST", "CLINICAL PRESENTATION", "DIAGNOSTIC FINDINGS", "MEDICAL NECESSITY", "PROPOSED PROCEDURE"],
    expected_output: `URGENT PRIOR AUTHORIZATION REQUEST - EMERGENT SURGICAL INTERVENTION REQUIRED

Dear Blue Cross Blue Shield Urgent Authorization Department,

Re: URGENT Prior Authorization - Emergent Lumbar Decompression for Cauda Equina Syndrome
Patient: William Okafor | DOB: 04/18/1972 | Member ID: WOK119012345
CPT Codes: 63047, 63048 | ICD-10: G83.4, M51.16, M51.17, N31.9
PRIORITY: EMERGENT - Surgery required within 24-48 hours

URGENT AUTHORIZATION REQUEST
This is an emergent prior authorization request for immediate surgical decompression. The patient presents with acute cauda equina syndrome, a surgical emergency requiring intervention within 24-48 hours to prevent permanent neurological damage including irreversible paralysis and loss of bowel/bladder function.

CLINICAL PRESENTATION
William Okafor is a 53-year-old male presenting to the emergency department with acute onset bilateral lower extremity weakness, saddle anesthesia, and urinary retention within 48 hours. Examination reveals bilateral lower extremity weakness 3/5, absent perianal sensation, and post-void residual of 400mL.

DIAGNOSTIC FINDINGS
Emergent MRI (05/01/2025) demonstrates large central disc extrusion at L4-L5 causing severe cauda equina compression with complete effacement of the thecal sac and compression of S1-S3 sacral nerve roots.

MEDICAL NECESSITY
Emergent lumbar laminectomy with decompression is medically necessary and time-critical. Cauda equina syndrome is a recognized surgical emergency. Decompression within 48 hours is essential for maximizing neurological recovery. Delay significantly increases the risk of permanent paralysis, bowel incontinence, and bladder dysfunction. Standard conservative treatment prerequisites are not applicable and would be medically contraindicated.

PROPOSED PROCEDURE
CPT 63047: Laminectomy with decompression, single level (L4-L5)
CPT 63048: Laminectomy with decompression, additional level (as needed)

We request emergent authorization within the urgent turnaround timeframe.

Sincerely,
Dr. James Kirkland, MD, PhD
Neurosurgery
NPI: 2345678901`,
  },

  // --------------------------------------------------------------------------
  // 10. Different payer (Aetna instead of BCBS, different criteria emphasis)
  // --------------------------------------------------------------------------
  {
    test_case_id: "golden-010",
    case_name: "Aetna Payer - Lumbar Fusion Different Criteria",
    service_category: "spine_surgery",
    payer_id: "AETNA",
    difficulty: "medium",
    tags: ["spine", "aetna", "different_payer", "lumbar", "fusion", "initial_auth", "functional_assessment"],
    patient_profile: {
      patient_id: "EVAL-P010",
      first_name: "Jennifer",
      last_name: "Blackwell",
      dob: "1966-01-20",
      age: 60,
      sex: "F",
      problems: [
        { icd10: "M43.16", description: "Spondylolisthesis, lumbar region", onset: "2024-04-01" },
        { icd10: "M51.16", description: "Intervertebral disc degeneration, lumbar region", onset: "2024-04-01" },
        { icd10: "M54.5", description: "Low back pain", onset: "2024-03-01" },
        { icd10: "M54.41", description: "Lumbago with sciatica, right side", onset: "2024-05-15" },
      ],
      therapy: [
        { type: "Physical Therapy", start_date: "2024-10-01", end_date: "2025-01-31", total_visits: 28, response: "Failed - completed full program, VAS pain scores unchanged" },
        { type: "Epidural Steroid Injection", start_date: "2024-11-15", end_date: "2024-11-15", total_visits: 1, response: "Failed - 1 week relief" },
        { type: "Epidural Steroid Injection", start_date: "2025-01-10", end_date: "2025-01-10", total_visits: 1, response: "Failed - no meaningful relief" },
        { type: "Facet Joint Injection", start_date: "2025-02-20", end_date: "2025-02-20", total_visits: 1, response: "Failed - brief partial relief" },
      ],
      imaging: [
        { modality: "MRI", body_part: "Lumbar Spine", date: "2024-10-20", impression: "Grade I-II spondylolisthesis at L4-L5 with bilateral foraminal stenosis and moderate central stenosis. Disc degeneration at L3-L4 and L4-L5. Facet arthropathy at L4-L5." },
        { modality: "X-Ray", body_part: "Lumbar Spine", date: "2025-02-01", impression: "Flexion/extension views demonstrate 5mm dynamic translation at L4-L5, consistent with segmental instability." },
      ],
      med_trials: [
        { medication: "Ibuprofen 800mg TID", start_date: "2024-08-01", end_date: "2024-10-15", outcome: "Inadequate pain relief" },
        { medication: "Gabapentin 300mg TID", start_date: "2024-09-01", end_date: "2025-01-31", outcome: "Modest neuropathic improvement, overall pain unchanged" },
        { medication: "Diclofenac gel topical", start_date: "2024-10-01", end_date: "2025-01-15", outcome: "No significant additional benefit" },
        { medication: "Duloxetine 60mg daily", start_date: "2024-11-01", end_date: "2025-02-28", outcome: "Partial mood-related pain improvement, insufficient functional gains" },
      ],
      coverage: { payer: "Aetna", payer_name: "Aetna", member_id: "W12345678", group_id: "ATN-GRP-5521", plan: "Open Access Managed Choice" },
      cpt_codes: ["22612", "22614", "20930"],
      icd10_codes: ["M43.16", "M51.16", "M54.5", "M54.41"],
      requested_procedure: "Posterior lumbar interbody fusion L4-L5",
      provider: { name: "Dr. Angela Torres", credentials: "MD, FACS", specialty: "Orthopedic Spine Surgery", npi: "1234567890" },
      payer_specific_notes: "Aetna CPB #0743 requires: (1) documented instability on flexion/extension views, (2) failure of at least 3 months conservative treatment, (3) correlation between imaging and clinical symptoms, (4) documentation of functional impairment.",
    },
    expected_sections: ["CLINICAL HISTORY", "AETNA POLICY COMPLIANCE", "DIAGNOSTIC FINDINGS", "CONSERVATIVE TREATMENT", "FUNCTIONAL IMPAIRMENT", "MEDICAL NECESSITY", "PROPOSED PROCEDURE"],
    expected_output: `Dear Aetna Medical Director,

Re: Prior Authorization Request for Posterior Lumbar Interbody Fusion L4-L5
Patient: Jennifer Blackwell | DOB: 01/20/1966 | Member ID: W12345678
CPT Codes: 22612, 22614, 20930 | ICD-10: M43.16, M51.16, M54.5, M54.41
Reference: Aetna Clinical Policy Bulletin #0743

CLINICAL HISTORY
Jennifer Blackwell is a 60-year-old female presenting with progressive lumbar spondylolisthesis at L4-L5 with segmental instability, causing chronic low back pain and right-sided radiculopathy over 7+ months.

AETNA POLICY COMPLIANCE
Per Aetna Clinical Policy Bulletin #0743, the following criteria are met:
1. Documented instability: Flexion/extension radiographs (02/01/2025) demonstrate 5mm dynamic translation at L4-L5
2. Conservative treatment duration: 4+ months of comprehensive conservative management (10/2024 through 02/2025)
3. Imaging-symptom correlation: Bilateral foraminal stenosis at L4-L5 correlates with right-sided radiculopathy in L5 dermatomal distribution
4. Functional impairment: Documented below

DIAGNOSTIC FINDINGS
MRI (10/20/2024): Grade I-II spondylolisthesis at L4-L5 with bilateral foraminal stenosis and moderate central stenosis. Flexion/extension radiographs (02/01/2025): 5mm dynamic translation confirming segmental instability.

CONSERVATIVE TREATMENT
Over 4+ months of multi-modal conservative treatment:
- Physical therapy: 28 visits over 4 months, VAS pain scores unchanged
- Two epidural steroid injections with temporary to no relief
- Facet joint injection with brief partial relief
- Four medication trials including NSAIDs, neuropathic agents, topical analgesics, and SNRI with inadequate results

FUNCTIONAL IMPAIRMENT
The patient reports inability to sit more than 20 minutes, stand more than 10 minutes, or walk more than 2 blocks. She is unable to perform household duties and reports significant sleep disruption. Oswestry Disability Index score: 58% (severe disability).

MEDICAL NECESSITY
Posterior lumbar interbody fusion at L4-L5 is medically necessary. All four Aetna CPB #0743 criteria are satisfied: documented instability, failure of 4+ months conservative treatment, imaging-symptom correlation, and severe functional impairment.

PROPOSED PROCEDURE
CPT 22612: Posterior lumbar interbody fusion, first interspace
CPT 22614: Additional arthrodesis segment
CPT 20930: Morselized allograft

Sincerely,
Dr. Angela Torres, MD, FACS
Orthopedic Spine Surgery
NPI: 1234567890`,
  },
];

// ============================================================================
// Seed function
// ============================================================================

async function seed() {
  console.log(`Seeding ${CASES.length} golden test cases into ${S}.eval_test_cases ...`);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const c of CASES) {
      await client.query(
        `INSERT INTO ${S}.eval_test_cases
         (test_case_id, case_name, patient_profile, service_category, payer_id,
          expected_output, expected_sections, difficulty, tags, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
         ON CONFLICT (test_case_id) DO UPDATE SET
           case_name = EXCLUDED.case_name,
           patient_profile = EXCLUDED.patient_profile,
           service_category = EXCLUDED.service_category,
           payer_id = EXCLUDED.payer_id,
           expected_output = EXCLUDED.expected_output,
           expected_sections = EXCLUDED.expected_sections,
           difficulty = EXCLUDED.difficulty,
           tags = EXCLUDED.tags,
           updated_at = now();`,
        [
          c.test_case_id,
          c.case_name,
          JSON.stringify(c.patient_profile),
          c.service_category || null,
          c.payer_id || null,
          c.expected_output,
          c.expected_sections ? JSON.stringify(c.expected_sections) : null,
          c.difficulty || "medium",
          c.tags || null,
        ]
      );

      console.log(`  [OK] ${c.test_case_id}: ${c.case_name} (${c.difficulty})`);
    }

    await client.query("COMMIT");
    console.log(`\nDone. ${CASES.length} golden test cases seeded successfully.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed, rolled back:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
