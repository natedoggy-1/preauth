// ============================================================================
// eval/seed-golden-cases.js
// ============================================================================
// Seeds 10 golden test cases into the eval_test_cases table.
// All patient data is SYNTHETIC — no real PHI.
//
// Usage:
//   node eval/seed-golden-cases.js
// ============================================================================

import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const S = process.env.CLINIC_SCHEMA || "demo";

const pool = new pg.Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "Newaza",
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

const CASES = [
  {
    test_case_id: "golden-001",
    case_name: "Simple lumbar fusion — BCBS initial auth",
    patient_profile: {
      name: "James Mitchell",
      dob: "1968-04-12",
      sex: "M",
      problems: [
        { icd10: "M51.16", description: "Lumbar disc degeneration L4-L5", onset: "2024-01-15" },
        { icd10: "M54.5", description: "Low back pain", onset: "2023-08-20" },
        { icd10: "G89.29", description: "Chronic pain syndrome", onset: "2024-02-01" },
      ],
      therapy: [
        { type: "Physical Therapy", duration_weeks: 8, outcome: "Minimal improvement" },
        { type: "Epidural steroid injection", count: 3, outcome: "Temporary relief only" },
      ],
      imaging: [
        { modality: "MRI Lumbar", date: "2024-06-10", findings: "L4-L5 disc herniation with moderate central canal stenosis and bilateral neural foraminal narrowing" },
      ],
      med_trials: [
        { drug: "Meloxicam 15mg", duration: "3 months", outcome: "Inadequate relief" },
        { drug: "Gabapentin 300mg TID", duration: "2 months", outcome: "Side effects, discontinued" },
      ],
      coverage: { payer: "BCBS", member_id: "XBB123456789", plan: "PPO Gold" },
      cpt_codes: ["22612", "22614"],
      icd10_codes: ["M51.16", "M54.5", "G89.29"],
    },
    service_category: "spine_surgery",
    payer_id: "BCBS",
    expected_output: `Dear Medical Director,

I am writing to request prior authorization for posterior lumbar interbody fusion (CPT 22612, 22614) for James Mitchell (DOB: 04/12/1968, Member ID: XBB123456789) under his BCBS PPO Gold plan.

CLINICAL HISTORY:
Mr. Mitchell presents with progressive lumbar disc degeneration at L4-L5 (M51.16) with chronic low back pain (M54.5) and chronic pain syndrome (G89.29). Symptoms have been present since January 2024 and have failed to respond to conservative management.

CONSERVATIVE TREATMENT HISTORY:
The patient has completed a comprehensive course of conservative care including:
- 8 weeks of physical therapy with minimal improvement
- 3 epidural steroid injections with temporary relief only
- Meloxicam 15mg for 3 months with inadequate relief
- Gabapentin 300mg TID for 2 months, discontinued due to side effects

DIAGNOSTIC IMAGING:
MRI of the lumbar spine (06/10/2024) demonstrates L4-L5 disc herniation with moderate central canal stenosis and bilateral neural foraminal narrowing, confirming the clinical diagnosis and surgical indication.

MEDICAL NECESSITY:
Surgical intervention is medically necessary as the patient has exhausted appropriate conservative measures over a period exceeding 6 weeks. The imaging findings correlate with the clinical presentation, and continued conservative management is unlikely to provide meaningful improvement.

Sincerely,`,
    expected_sections: ["CLINICAL HISTORY", "CONSERVATIVE TREATMENT", "DIAGNOSTIC IMAGING", "MEDICAL NECESSITY"],
    difficulty: "easy",
    tags: ["spine", "lumbar", "fusion", "initial_auth", "bcbs"],
  },
  {
    test_case_id: "golden-002",
    case_name: "Complex spine + comorbidities — BCBS",
    patient_profile: {
      name: "Patricia Gonzalez",
      dob: "1962-11-03",
      sex: "F",
      problems: [
        { icd10: "M51.16", description: "Lumbar disc degeneration L3-L4, L4-L5", onset: "2023-06-01" },
        { icd10: "E11.65", description: "Type 2 diabetes with hyperglycemia", onset: "2015-03-10" },
        { icd10: "E66.01", description: "Morbid obesity, BMI 38.2", onset: "2018-01-01" },
        { icd10: "G89.29", description: "Chronic pain syndrome", onset: "2023-09-15" },
        { icd10: "M47.816", description: "Lumbar spondylosis with radiculopathy", onset: "2023-06-01" },
      ],
      therapy: [
        { type: "Physical Therapy", duration_weeks: 12, outcome: "No significant improvement" },
        { type: "Epidural steroid injection", count: 3, outcome: "Brief relief 2-3 weeks" },
        { type: "Chiropractic", duration_weeks: 6, outcome: "No benefit" },
      ],
      imaging: [
        { modality: "MRI Lumbar", date: "2024-04-22", findings: "Multi-level disc degeneration L3-L5 with severe L4-L5 stenosis, grade 1 spondylolisthesis" },
        { modality: "X-ray Lumbar", date: "2024-05-01", findings: "Grade 1 anterolisthesis L4 on L5, disc space narrowing" },
      ],
      med_trials: [
        { drug: "Naproxen 500mg BID", duration: "4 months", outcome: "GI side effects" },
        { drug: "Duloxetine 60mg", duration: "3 months", outcome: "Partial relief" },
        { drug: "Tramadol 50mg PRN", duration: "2 months", outcome: "Tolerance developed" },
      ],
      coverage: { payer: "BCBS", member_id: "XBB987654321", plan: "HMO Select" },
      cpt_codes: ["22612", "22614", "22630"],
      icd10_codes: ["M51.16", "E11.65", "E66.01", "G89.29", "M47.816"],
    },
    service_category: "spine_surgery",
    payer_id: "BCBS",
    expected_output: "Complex multi-level fusion letter addressing BMI optimization, diabetes management, multi-level pathology, and extensive conservative care failure.",
    expected_sections: ["CLINICAL HISTORY", "COMORBIDITY MANAGEMENT", "CONSERVATIVE TREATMENT", "DIAGNOSTIC IMAGING", "MEDICAL NECESSITY"],
    difficulty: "hard",
    tags: ["spine", "lumbar", "complex", "comorbidity", "obesity", "diabetes"],
  },
  {
    test_case_id: "golden-003",
    case_name: "Cervical spine — anterior discectomy",
    patient_profile: {
      name: "Robert Chen",
      dob: "1975-07-22",
      sex: "M",
      problems: [
        { icd10: "M50.121", description: "Cervical disc disorder C5-C6 with radiculopathy", onset: "2024-02-10" },
        { icd10: "M54.12", description: "Cervical radiculopathy", onset: "2024-02-10" },
      ],
      therapy: [
        { type: "Physical Therapy", duration_weeks: 8, outcome: "Worsening symptoms" },
        { type: "Cervical epidural injection", count: 2, outcome: "No relief" },
      ],
      imaging: [
        { modality: "MRI Cervical", date: "2024-08-15", findings: "C5-C6 disc herniation with severe left neural foraminal stenosis compressing C6 nerve root" },
      ],
      med_trials: [
        { drug: "Prednisone taper", duration: "2 weeks", outcome: "Temporary improvement" },
        { drug: "Pregabalin 75mg BID", duration: "6 weeks", outcome: "Inadequate relief" },
      ],
      coverage: { payer: "BCBS", member_id: "XBB555666777", plan: "PPO" },
      cpt_codes: ["63020", "22551"],
      icd10_codes: ["M50.121", "M54.12"],
    },
    service_category: "spine_surgery",
    payer_id: "BCBS",
    expected_output: "Cervical discectomy and fusion letter for C5-C6 with clear nerve root compression correlation.",
    expected_sections: ["CLINICAL HISTORY", "CONSERVATIVE TREATMENT", "DIAGNOSTIC IMAGING", "MEDICAL NECESSITY"],
    difficulty: "medium",
    tags: ["spine", "cervical", "discectomy", "radiculopathy"],
  },
  {
    test_case_id: "golden-004",
    case_name: "Appeal after denial — insufficient documentation",
    patient_profile: {
      name: "Sandra Williams",
      dob: "1970-02-28",
      sex: "F",
      denial_reason: "Insufficient documentation of conservative treatment failure. Policy requires minimum 6 weeks of documented physical therapy.",
      original_auth_id: "PA-2024-88421",
      problems: [
        { icd10: "M51.17", description: "Lumbar disc degeneration L5-S1", onset: "2023-11-01" },
        { icd10: "M54.41", description: "Lumbosacral radiculopathy", onset: "2023-12-15" },
      ],
      therapy: [
        { type: "Physical Therapy", duration_weeks: 10, outcome: "Documented decline in function per standardized outcome measures" },
        { type: "Epidural steroid injection", count: 3, outcome: "Less than 50% relief lasting less than 2 weeks" },
        { type: "Home exercise program", duration_weeks: 16, outcome: "Compliant but no improvement" },
      ],
      imaging: [
        { modality: "MRI Lumbar", date: "2024-03-20", findings: "L5-S1 extruded disc fragment with S1 nerve root compression" },
        { modality: "CT Lumbar", date: "2024-05-10", findings: "Confirms extruded fragment, no bony abnormality" },
      ],
      med_trials: [
        { drug: "Meloxicam 15mg", duration: "4 months", outcome: "Minimal effect" },
        { drug: "Cyclobenzaprine 10mg", duration: "2 months", outcome: "Drowsiness, no pain benefit" },
      ],
      coverage: { payer: "BCBS", member_id: "XBB111222333", plan: "PPO Plus" },
      cpt_codes: ["63030"],
      icd10_codes: ["M51.17", "M54.41"],
    },
    service_category: "spine_surgery",
    payer_id: "BCBS",
    expected_output: "Appeal letter directly addressing the denial reason, emphasizing 10 weeks of PT (exceeds 6-week requirement), with additional documentation of conservative treatment failure.",
    expected_sections: ["APPEAL REFERENCE", "DENIAL RESPONSE", "CLINICAL HISTORY", "CONSERVATIVE TREATMENT", "DIAGNOSTIC IMAGING", "MEDICAL NECESSITY"],
    difficulty: "hard",
    tags: ["spine", "appeal", "denial", "documentation"],
  },
  {
    test_case_id: "golden-005",
    case_name: "Peer-to-peer letter",
    patient_profile: {
      name: "Michael Davis",
      dob: "1958-09-14",
      sex: "M",
      peer_reviewer: "Dr. Sarah Thompson, MD, Medical Director",
      problems: [
        { icd10: "M48.06", description: "Lumbar spinal stenosis", onset: "2023-05-01" },
        { icd10: "M43.16", description: "Lumbar spondylolisthesis", onset: "2023-05-01" },
      ],
      therapy: [
        { type: "Physical Therapy", duration_weeks: 12, outcome: "Failed" },
        { type: "Lumbar epidural steroid injection", count: 3, outcome: "No lasting benefit" },
      ],
      imaging: [
        { modality: "MRI Lumbar", date: "2024-07-01", findings: "Severe lumbar stenosis L3-L5 with grade 2 spondylolisthesis at L4-L5" },
      ],
      med_trials: [
        { drug: "Gabapentin 600mg TID", duration: "3 months", outcome: "Side effects" },
      ],
      coverage: { payer: "BCBS", member_id: "XBB444555666", plan: "EPO" },
      cpt_codes: ["22612", "63047"],
      icd10_codes: ["M48.06", "M43.16"],
    },
    service_category: "spine_surgery",
    payer_id: "BCBS",
    expected_output: "Peer-to-peer discussion summary with conversational but clinical tone, directly addressing the reviewing physician's concerns.",
    expected_sections: ["INTRODUCTION", "CLINICAL SUMMARY", "TREATMENT HISTORY", "SURGICAL RATIONALE", "REQUEST"],
    difficulty: "medium",
    tags: ["spine", "peer_to_peer", "stenosis", "spondylolisthesis"],
  },
  {
    test_case_id: "golden-006",
    case_name: "Edge case — missing imaging",
    patient_profile: {
      name: "Jennifer Taylor",
      dob: "1980-03-17",
      sex: "F",
      problems: [
        { icd10: "M54.5", description: "Low back pain", onset: "2024-01-01" },
        { icd10: "M51.16", description: "Lumbar disc degeneration", onset: "2024-01-01" },
      ],
      therapy: [
        { type: "Physical Therapy", duration_weeks: 8, outcome: "No improvement" },
      ],
      imaging: [],
      med_trials: [
        { drug: "Ibuprofen 800mg TID", duration: "2 months", outcome: "GI symptoms" },
      ],
      coverage: { payer: "BCBS", member_id: "XBB777888999", plan: "PPO" },
      cpt_codes: ["22612"],
      icd10_codes: ["M54.5", "M51.16"],
    },
    service_category: "spine_surgery",
    payer_id: "BCBS",
    expected_output: "Letter that correctly identifies [MISSING: imaging data] rather than fabricating MRI findings.",
    expected_sections: ["CLINICAL HISTORY", "CONSERVATIVE TREATMENT", "DIAGNOSTIC IMAGING", "MEDICAL NECESSITY"],
    difficulty: "edge",
    tags: ["spine", "edge_case", "missing_data", "imaging"],
  },
  {
    test_case_id: "golden-007",
    case_name: "Edge case — insufficient therapy (3 weeks, policy requires 6)",
    patient_profile: {
      name: "Thomas Anderson",
      dob: "1972-06-05",
      sex: "M",
      problems: [
        { icd10: "M51.16", description: "Lumbar disc degeneration L4-L5", onset: "2024-04-01" },
        { icd10: "M54.5", description: "Low back pain", onset: "2024-04-01" },
      ],
      therapy: [
        { type: "Physical Therapy", duration_weeks: 3, outcome: "Some improvement" },
      ],
      imaging: [
        { modality: "MRI Lumbar", date: "2024-09-01", findings: "L4-L5 disc protrusion with mild stenosis" },
      ],
      med_trials: [
        { drug: "Naproxen 500mg", duration: "1 month", outcome: "Partial relief" },
      ],
      coverage: { payer: "BCBS", member_id: "XBB000111222", plan: "PPO" },
      cpt_codes: ["22612"],
      icd10_codes: ["M51.16", "M54.5"],
    },
    service_category: "spine_surgery",
    payer_id: "BCBS",
    expected_output: "Letter that flags the 3-week PT duration as below the 6-week policy requirement. Should note this gap rather than misrepresenting the therapy duration.",
    expected_sections: ["CLINICAL HISTORY", "CONSERVATIVE TREATMENT", "DIAGNOSTIC IMAGING", "MEDICAL NECESSITY"],
    difficulty: "edge",
    tags: ["spine", "edge_case", "insufficient_therapy", "policy_gap"],
  },
  {
    test_case_id: "golden-008",
    case_name: "Extensive medication trials",
    patient_profile: {
      name: "Barbara Johnson",
      dob: "1965-12-20",
      sex: "F",
      problems: [
        { icd10: "M51.16", description: "Lumbar disc degeneration L3-L4, L4-L5", onset: "2022-08-01" },
        { icd10: "M54.5", description: "Chronic low back pain", onset: "2022-08-01" },
        { icd10: "G89.29", description: "Chronic pain syndrome", onset: "2023-01-01" },
      ],
      therapy: [
        { type: "Physical Therapy", duration_weeks: 16, outcome: "No lasting improvement" },
        { type: "Epidural steroid injection", count: 6, outcome: "Diminishing returns" },
        { type: "TENS unit", duration_weeks: 8, outcome: "Minimal benefit" },
        { type: "Acupuncture", duration_weeks: 8, outcome: "No benefit" },
      ],
      imaging: [
        { modality: "MRI Lumbar", date: "2024-01-15", findings: "Progressive multi-level disc degeneration with severe L4-L5 stenosis" },
        { modality: "MRI Lumbar", date: "2023-01-10", findings: "Moderate disc degeneration L3-L5" },
      ],
      med_trials: [
        { drug: "Ibuprofen 800mg TID", duration: "6 months", outcome: "GI bleeding" },
        { drug: "Naproxen 500mg BID", duration: "3 months", outcome: "Renal concerns" },
        { drug: "Gabapentin 600mg TID", duration: "4 months", outcome: "Cognitive side effects" },
        { drug: "Pregabalin 150mg BID", duration: "3 months", outcome: "Weight gain, dizziness" },
        { drug: "Duloxetine 60mg", duration: "4 months", outcome: "Nausea, fatigue" },
        { drug: "Tramadol 50mg QID", duration: "2 months", outcome: "Tolerance" },
        { drug: "Meloxicam 15mg", duration: "3 months", outcome: "Inadequate" },
        { drug: "Muscle relaxants (tizanidine)", duration: "2 months", outcome: "Drowsiness" },
      ],
      coverage: { payer: "BCBS", member_id: "XBB333444555", plan: "PPO Platinum" },
      cpt_codes: ["22612", "22614"],
      icd10_codes: ["M51.16", "M54.5", "G89.29"],
    },
    service_category: "spine_surgery",
    payer_id: "BCBS",
    expected_output: "Comprehensive letter documenting extensive medication failure history (8 drugs), progressive imaging findings, and exhaustive conservative care.",
    expected_sections: ["CLINICAL HISTORY", "MEDICATION HISTORY", "CONSERVATIVE TREATMENT", "DIAGNOSTIC IMAGING", "MEDICAL NECESSITY"],
    difficulty: "medium",
    tags: ["spine", "medications", "extensive_trials", "progressive"],
  },
  {
    test_case_id: "golden-009",
    case_name: "Urgent auth — acute neurological deficit",
    patient_profile: {
      name: "David Martinez",
      dob: "1955-01-30",
      sex: "M",
      urgency: "emergent",
      problems: [
        { icd10: "G83.4", description: "Cauda equina syndrome", onset: "2024-10-15" },
        { icd10: "M51.16", description: "Lumbar disc degeneration", onset: "2024-10-15" },
        { icd10: "N31.9", description: "Neurogenic bladder dysfunction", onset: "2024-10-15" },
      ],
      therapy: [],
      imaging: [
        { modality: "MRI Lumbar STAT", date: "2024-10-15", findings: "Large L4-L5 disc extrusion with cauda equina compression, near-complete canal occlusion" },
      ],
      med_trials: [],
      coverage: { payer: "BCBS", member_id: "XBB666777888", plan: "PPO" },
      cpt_codes: ["63047", "63048"],
      icd10_codes: ["G83.4", "M51.16", "N31.9"],
    },
    service_category: "spine_surgery",
    payer_id: "BCBS",
    expected_output: "Urgent authorization letter emphasizing time-critical nature of cauda equina syndrome, acute neurological deficits, and need for emergent surgical decompression within 48 hours.",
    expected_sections: ["URGENT NOTICE", "CLINICAL PRESENTATION", "DIAGNOSTIC IMAGING", "MEDICAL NECESSITY", "TIMELINE"],
    difficulty: "hard",
    tags: ["spine", "urgent", "cauda_equina", "emergent", "neurological"],
  },
  {
    test_case_id: "golden-010",
    case_name: "Aetna payer — different criteria emphasis",
    patient_profile: {
      name: "Karen Lee",
      dob: "1973-08-08",
      sex: "F",
      problems: [
        { icd10: "M51.16", description: "Lumbar disc degeneration L5-S1", onset: "2024-01-01" },
        { icd10: "M54.5", description: "Low back pain", onset: "2024-01-01" },
      ],
      therapy: [
        { type: "Physical Therapy", duration_weeks: 8, outcome: "No improvement" },
        { type: "Epidural steroid injection", count: 2, outcome: "Temporary" },
      ],
      imaging: [
        { modality: "MRI Lumbar", date: "2024-07-20", findings: "L5-S1 disc herniation with right S1 nerve root compression" },
      ],
      med_trials: [
        { drug: "Meloxicam 15mg", duration: "3 months", outcome: "Inadequate" },
        { drug: "Gabapentin 300mg TID", duration: "2 months", outcome: "Side effects" },
      ],
      coverage: { payer: "Aetna", member_id: "W123456789", plan: "Open Access" },
      cpt_codes: ["22612"],
      icd10_codes: ["M51.16", "M54.5"],
    },
    service_category: "spine_surgery",
    payer_id: "AETNA",
    expected_output: "Letter following Aetna-specific criteria format, emphasizing functional assessment scores and failed conservative benchmarks per Aetna Clinical Policy Bulletin.",
    expected_sections: ["CLINICAL HISTORY", "CONSERVATIVE TREATMENT", "DIAGNOSTIC IMAGING", "FUNCTIONAL ASSESSMENT", "MEDICAL NECESSITY"],
    difficulty: "medium",
    tags: ["spine", "aetna", "different_payer", "initial_auth"],
  },
];

async function seed() {
  console.log(`Seeding ${CASES.length} golden test cases into ${S}.eval_test_cases...`);

  for (const c of CASES) {
    try {
      await pool.query(
        `INSERT INTO ${S}.eval_test_cases
         (test_case_id, case_name, patient_profile, service_category, payer_id,
          expected_output, expected_sections, difficulty, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      console.log(`  [OK] ${c.test_case_id}: ${c.case_name}`);
    } catch (e) {
      console.error(`  [ERR] ${c.test_case_id}: ${e.message}`);
    }
  }

  console.log("Done.");
  await pool.end();
}

seed().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
