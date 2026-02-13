// clinic-db-api/server.js
// ============================================================================
// Local DB API — v2: Prior Authorization Letter System
// ============================================================================
// Your Expo app calls this API, and this API talks to Postgres.
// Keeps DB credentials off the app and keeps PHI inside the clinic environment.
//
// NEW in v2:
//   - GET  /api/facility            → facility info (letterhead, NPI, logo)
//   - GET  /api/providers           → provider directory
//   - GET  /api/providers/:id       → single provider
//   - GET  /api/payers              → payer directory
//   - GET  /api/payers/:id          → single payer with contacts
//   - POST /api/payer-policy/match  → find matching payer policy for a service
//   - GET  /api/letter-templates    → list templates (filterable by letter_type)
//   - GET  /api/letter-templates/:id → single template
//   - POST /api/letters/generate-context → assemble ALL data needed for LLM prompt
//   - POST /api/letters             → save a generated letter
//   - PATCH /api/letters/:id/status → update letter status (lifecycle tracking)
//   - GET  /api/letters             → list letters (filterable)
//   - GET  /api/letters/:id         → single letter detail
// ============================================================================

import dotenv from "dotenv";
dotenv.config({
  path:
    process.env.DOTENV_PATH ||
    "C:\\Users\\Natha\\hyve-chat\\clinic-db-api\\.env",
  override: true,
});

import express from "express";
import cors from "cors";
import pg from "pg";

const { Pool } = pg;

const PORT = Number(process.env.PORT || 7777);
const HOST = String(process.env.HOST || "127.0.0.1").trim();
const BRIDGE_TOKEN = String(process.env.BRIDGE_TOKEN || "dev-bridge-token").trim();
const CLINIC_SCHEMA = String(process.env.CLINIC_SCHEMA || "demo").trim();
const S = CLINIC_SCHEMA; // shorthand for SQL interpolation

console.log("BRIDGE_BOOT v2", {
  cwd: process.cwd(),
  HOST,
  PORT,
  CLINIC_SCHEMA,
  PGHOST: process.env.PGHOST,
  PGPORT: process.env.PGPORT,
  PGDATABASE: process.env.PGDATABASE,
  PGUSER: process.env.PGUSER,
  hasPassword: !!process.env.PGPASSWORD,
});

const pool = new Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "postgres",
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ============================================================================
// Auth middleware
// ============================================================================
function requireToken(req, res, next) {
  const token = req.header("X-Bridge-Token") || req.header("x-bridge-token") || "";
  if (!token || token !== BRIDGE_TOKEN) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  return next();
}

// Helper: default tenant/facility from query or body
function tf(req) {
  const tenant_id = Number(req.body?.tenant_id ?? req.query?.tenant_id ?? 1);
  const facility_id = String(
    req.body?.facility_id ?? req.query?.facility_id ?? "FAC-DEMO"
  ).trim();
  return { tenant_id, facility_id };
}

// ============================================================================
// Health check
// ============================================================================
app.get("/health", async (req, res) => {
  try {
    const token = req.header("X-Bridge-Token") || req.header("x-bridge-token") || "";
    const token_ok = token ? token === BRIDGE_TOKEN : true;
    await pool.query("SELECT 1");
    await pool.query(`SELECT 1 FROM ${S}.patients LIMIT 1`);
    res.json({
      ok: true,
      version: "2.0.0",
      schema: CLINIC_SCHEMA,
      token_ok,
      db: {
        host: pool.options.host,
        port: pool.options.port,
        database: pool.options.database,
        user: pool.options.user,
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ============================================================================
// EXISTING: Patient search (unchanged)
// ============================================================================
app.post("/api/patients/search", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const queryRaw = String(req.body?.query ?? "").trim();
  if (!facility_id) return res.status(400).json({ ok: false, error: "facility_id required" });
  if (!queryRaw) return res.status(400).json({ ok: false, error: "query required" });

  const q = queryRaw.replace(/\s+/g, " ").trim();
  const like = `%${q}%`;

  const sql = `
    SELECT
      p.patient_id,
      (p.first_name || ' ' || p.last_name) AS full_name,
      p.first_name, p.last_name,
      to_char(p.dob,'YYYY-MM-DD') AS dob,
      p.sex, p.phone, p.address,
      c.member_id AS insurance_member_id,
      c.group_id  AS insurance_group_number
    FROM ${S}.patients p
    LEFT JOIN LATERAL (
      SELECT c.member_id, c.group_id
      FROM ${S}.coverage c
      WHERE c.tenant_id = p.tenant_id AND c.facility_id = p.facility_id AND c.patient_id = p.patient_id
      ORDER BY c.coverage_id ASC NULLS LAST LIMIT 1
    ) c ON TRUE
    WHERE p.tenant_id = $1 AND p.facility_id = $2
      AND (p.patient_id = $4 OR p.patient_id ILIKE $3
           OR p.first_name ILIKE $3 OR p.last_name ILIKE $3
           OR (p.first_name || ' ' || p.last_name) ILIKE $3
           OR (p.last_name || ', ' || p.first_name) ILIKE $3)
    ORDER BY p.last_name ASC, p.first_name ASC LIMIT 50;
  `;

  try {
    const r = await pool.query(sql, [tenant_id, facility_id, like, q]);
    if (!r.rows.length) {
      const diag = await pool.query(
        `SELECT tenant_id, facility_id, COUNT(*)::int AS n FROM ${S}.patients GROUP BY tenant_id, facility_id ORDER BY n DESC LIMIT 20;`
      ).catch(() => ({ rows: [] }));
      return res.json({ ok: true, patients: [], debug: { received: { tenant_id, facility_id, query: q }, knownTenantFacilityPairs: diag.rows } });
    }
    res.json({ ok: true, patients: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ============================================================================
// EXISTING: Patient background (unchanged)
// ============================================================================
app.post("/api/patients/background", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const patient_id = String(req.body?.patient_id ?? "").trim();
  if (!facility_id) return res.status(400).json({ ok: false, error: "facility_id required" });
  if (!patient_id) return res.status(400).json({ ok: false, error: "patient_id required" });

  try {
    const pRes = await pool.query(
      `SELECT tenant_id, facility_id, patient_id, first_name, last_name,
              (first_name || ' ' || last_name) AS full_name,
              to_char(dob,'YYYY-MM-DD') AS dob, sex, phone, address
       FROM ${S}.patients WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 LIMIT 1;`,
      [tenant_id, facility_id, patient_id]
    );
    const p = pRes.rows?.[0];
    if (!p) return res.status(404).json({ ok: false, error: "Not found" });

    const cAllRes = await pool.query(
      `SELECT coverage_id, payer_name, payer_key, plan_name, member_id, group_id, payer_id
       FROM ${S}.coverage WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY coverage_id ASC;`,
      [tenant_id, facility_id, patient_id]
    );
    const coverage_all = cAllRes.rows || [];
    const coverage_primary = coverage_all[0] || null;

    const rRes = await pool.query(
      `SELECT request_id, coverage_id, to_char(requested_dos,'YYYY-MM-DD') AS requested_dos,
              cpt_code, cpt_description, icd10_code, icd10_description, clinical_question,
              requested_units, service_name, service_key, priority, payer_id, provider_id, status
       FROM ${S}.preauth_requests WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3
       ORDER BY requested_dos DESC NULLS LAST, request_id DESC LIMIT 25;`,
      [tenant_id, facility_id, patient_id]
    );

    const prRes = await pool.query(
      `SELECT problem_id, icd10_code, description, to_char(onset_date,'YYYY-MM-DD') AS onset_date
       FROM ${S}.problems WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY problem_id DESC;`,
      [tenant_id, facility_id, patient_id]
    );

    const tRes = await pool.query(
      `SELECT therapy_id, therapy_type, to_char(start_date,'YYYY-MM-DD') AS start_date,
              to_char(end_date,'YYYY-MM-DD') AS end_date, total_visits, response, therapy_item
       FROM ${S}.therapy WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY therapy_id DESC;`,
      [tenant_id, facility_id, patient_id]
    );

    const iRes = await pool.query(
      `SELECT imaging_id, modality, body_part, impression,
              to_char(imaging_date,'YYYY-MM-DD') AS imaging_date, item
       FROM ${S}.imaging WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY imaging_id DESC;`,
      [tenant_id, facility_id, patient_id]
    );

    const eRes = await pool.query(
      `SELECT encounter_id, to_char(encounter_date,'YYYY-MM-DD') AS encounter_date,
              summary, provider_name, provider_id
       FROM ${S}.encounters WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3
       ORDER BY encounter_date DESC NULLS LAST, encounter_id DESC LIMIT 25;`,
      [tenant_id, facility_id, patient_id]
    );

    const mRes = await pool.query(
      `SELECT trial_id, medication, dose, to_char(start_date,'YYYY-MM-DD') AS start_date,
              to_char(end_date,'YYYY-MM-DD') AS end_date, outcome
       FROM ${S}.med_trials WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY trial_id DESC;`,
      [tenant_id, facility_id, patient_id]
    );

    res.json({
      ok: true,
      patient: { ...p, phone: p.phone ?? null, address: p.address ?? null },
      coverage_primary,
      coverage_all,
      requests: rRes.rows || [],
      problems: prRes.rows || [],
      therapies: tRes.rows || [],
      imaging: iRes.rows || [],
      encounters: eRes.rows || [],
      med_trials: mRes.rows || [],
    });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ============================================================================
// NEW: Facility info
// ============================================================================
app.get("/api/facility", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  try {
    const r = await pool.query(
      `SELECT * FROM ${S}.facilities WHERE tenant_id=$1 AND facility_id=$2 LIMIT 1;`,
      [tenant_id, facility_id]
    );
    if (!r.rows[0]) return res.status(404).json({ ok: false, error: "Facility not found" });
    res.json({ ok: true, facility: r.rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ============================================================================
// NEW: Providers
// ============================================================================
app.get("/api/providers", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  try {
    const r = await pool.query(
      `SELECT provider_id, first_name, last_name, credentials, specialty, npi,
              phone, email, signature_name
       FROM ${S}.providers WHERE tenant_id=$1 AND facility_id=$2
       ORDER BY last_name, first_name;`,
      [tenant_id, facility_id]
    );
    res.json({ ok: true, providers: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get("/api/providers/:id", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const provider_id = req.params.id;
  try {
    const r = await pool.query(
      `SELECT * FROM ${S}.providers WHERE tenant_id=$1 AND facility_id=$2 AND provider_id=$3 LIMIT 1;`,
      [tenant_id, facility_id, provider_id]
    );
    if (!r.rows[0]) return res.status(404).json({ ok: false, error: "Provider not found" });
    res.json({ ok: true, provider: r.rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ============================================================================
// NEW: Payers
// ============================================================================
app.get("/api/payers", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  try {
    const r = await pool.query(
      `SELECT payer_id, payer_name, payer_type, phone_general, phone_pa, fax_pa,
              portal_url, pa_turnaround_standard_days, pa_turnaround_urgent_days
       FROM ${S}.payers WHERE tenant_id=$1 AND facility_id=$2
       ORDER BY payer_name;`,
      [tenant_id, facility_id]
    );
    res.json({ ok: true, payers: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get("/api/payers/:id", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const payer_id = req.params.id;
  try {
    const r = await pool.query(
      `SELECT * FROM ${S}.payers WHERE tenant_id=$1 AND facility_id=$2 AND payer_id=$3 LIMIT 1;`,
      [tenant_id, facility_id, payer_id]
    );
    if (!r.rows[0]) return res.status(404).json({ ok: false, error: "Payer not found" });

    const contacts = await pool.query(
      `SELECT * FROM ${S}.payer_contacts WHERE tenant_id=$1 AND facility_id=$2 AND payer_id=$3 ORDER BY contact_name;`,
      [tenant_id, facility_id, payer_id]
    );

    res.json({ ok: true, payer: r.rows[0], contacts: contacts.rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ============================================================================
// NEW: Payer policy match
// Given a payer_id + service info (CPT codes, service_category), find the
// best matching policy with clinical criteria.
// ============================================================================
app.post("/api/payer-policy/match", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const payer_id = String(req.body?.payer_id ?? "").trim();
  const cpt_code = String(req.body?.cpt_code ?? "").trim();
  const service_category = String(req.body?.service_category ?? "").trim();

  if (!payer_id) return res.status(400).json({ ok: false, error: "payer_id required" });

  try {
    // Strategy: try CPT array overlap first, then service_category, then all for payer
    let policies = [];

    if (cpt_code) {
      const r = await pool.query(
        `SELECT * FROM ${S}.payer_policies
         WHERE tenant_id=$1 AND facility_id=$2 AND payer_id=$3
           AND $4 = ANY(cpt_codes)
           AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
         ORDER BY effective_date DESC NULLS LAST LIMIT 5;`,
        [tenant_id, facility_id, payer_id, cpt_code]
      );
      policies = r.rows;
    }

    if (!policies.length && service_category) {
      const r = await pool.query(
        `SELECT * FROM ${S}.payer_policies
         WHERE tenant_id=$1 AND facility_id=$2 AND payer_id=$3
           AND service_category ILIKE $4
           AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
         ORDER BY effective_date DESC NULLS LAST LIMIT 5;`,
        [tenant_id, facility_id, payer_id, service_category]
      );
      policies = r.rows;
    }

    if (!policies.length) {
      const r = await pool.query(
        `SELECT * FROM ${S}.payer_policies
         WHERE tenant_id=$1 AND facility_id=$2 AND payer_id=$3
           AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
         ORDER BY policy_name LIMIT 20;`,
        [tenant_id, facility_id, payer_id]
      );
      policies = r.rows;
    }

    res.json({ ok: true, policies, matched_by: cpt_code ? "cpt" : service_category ? "category" : "all" });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ============================================================================
// NEW: Letter templates
// ============================================================================
app.get("/api/letter-templates", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const letter_type = String(req.query?.letter_type ?? "").trim();

  try {
    let sql = `SELECT template_id, template_name, letter_type, service_category, version, is_active, instructions
               FROM ${S}.letter_templates WHERE tenant_id=$1 AND facility_id=$2 AND is_active=true`;
    const params = [tenant_id, facility_id];

    if (letter_type) {
      sql += ` AND letter_type=$3`;
      params.push(letter_type);
    }
    sql += ` ORDER BY letter_type, template_name;`;

    const r = await pool.query(sql, params);
    res.json({ ok: true, templates: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get("/api/letter-templates/:id", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  try {
    const r = await pool.query(
      `SELECT * FROM ${S}.letter_templates WHERE tenant_id=$1 AND facility_id=$2 AND template_id=$3 LIMIT 1;`,
      [tenant_id, facility_id, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ ok: false, error: "Template not found" });
    res.json({ ok: true, template: r.rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ============================================================================
// NEW: Generate letter context
// ============================================================================
// This is the KEY endpoint. It assembles ALL the data your LLM needs:
//   - patient demographics
//   - coverage + payer info + payer contacts
//   - payer policy (clinical criteria) for the requested service
//   - letter template
//   - clinical evidence (problems, encounters, imaging, therapy, med trials)
//   - facility + provider info
//   - preauth request details
//
// The app sends this to n8n/Ollama, which generates the letter text.
// ============================================================================
app.post("/api/letters/generate-context", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const patient_id = String(req.body?.patient_id ?? "").trim();
  const request_id = String(req.body?.request_id ?? "").trim();
  const letter_type = String(req.body?.letter_type ?? "initial_auth").trim();
  const provider_id = String(req.body?.provider_id ?? "").trim();
  const coverage_id = String(req.body?.coverage_id ?? "").trim(); // ✅ NEW: user-selected coverage
  const parent_letter_id = String(req.body?.parent_letter_id ?? "").trim(); // for appeals

  if (!patient_id) return res.status(400).json({ ok: false, error: "patient_id required" });

  try {
    // 1. Patient
    const patientRes = await pool.query(
      `SELECT *, (first_name || ' ' || last_name) AS full_name,
              to_char(dob,'YYYY-MM-DD') AS dob_str,
              EXTRACT(YEAR FROM AGE(dob))::int AS age
       FROM ${S}.patients WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 LIMIT 1;`,
      [tenant_id, facility_id, patient_id]
    );
    if (!patientRes.rows[0]) return res.status(404).json({ ok: false, error: "Patient not found" });
    const patient = patientRes.rows[0];

    // 2. Coverage — prefer user-selected coverage_id, else first coverage
    let covSql = `SELECT c.*, py.payer_name AS payer_full_name, py.phone_pa, py.fax_pa,
            py.portal_url, py.address_line1 AS payer_address_line1, py.city AS payer_city,
            py.state AS payer_state, py.zip AS payer_zip,
            py.pa_turnaround_standard_days, py.pa_turnaround_urgent_days
     FROM ${S}.coverage c
     LEFT JOIN ${S}.payers py ON py.tenant_id=c.tenant_id AND py.facility_id=c.facility_id AND py.payer_id=c.payer_id
     WHERE c.tenant_id=$1 AND c.facility_id=$2 AND c.patient_id=$3`;
    const covParams = [tenant_id, facility_id, patient_id];

    if (coverage_id) {
      covSql += ` AND c.coverage_id=$4`;
      covParams.push(coverage_id);
    }
    covSql += ` ORDER BY c.coverage_id ASC LIMIT 1;`;

    const covRes = await pool.query(covSql, covParams);
    const coverage = covRes.rows[0] || null;

    // 3. Preauth request
    let request = null;
    if (request_id) {
      const reqRes = await pool.query(
        `SELECT * FROM ${S}.preauth_requests WHERE tenant_id=$1 AND facility_id=$2 AND request_id=$3 LIMIT 1;`,
        [tenant_id, facility_id, request_id]
      );
      request = reqRes.rows[0] || null;
    } else {
      // pick the latest pending request for this patient
      const reqRes = await pool.query(
        `SELECT * FROM ${S}.preauth_requests
         WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3
         ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, requested_dos DESC NULLS LAST
         LIMIT 1;`,
        [tenant_id, facility_id, patient_id]
      );
      request = reqRes.rows[0] || null;
    }

    // 4. Provider
    let provider = null;
    const prov_id = provider_id || request?.provider_id;
    if (prov_id) {
      const provRes = await pool.query(
        `SELECT * FROM ${S}.providers WHERE tenant_id=$1 AND facility_id=$2 AND provider_id=$3 LIMIT 1;`,
        [tenant_id, facility_id, prov_id]
      );
      provider = provRes.rows[0] || null;
    }

    // 5. Facility
    const facRes = await pool.query(
      `SELECT * FROM ${S}.facilities WHERE tenant_id=$1 AND facility_id=$2 LIMIT 1;`,
      [tenant_id, facility_id]
    );
    const facility = facRes.rows[0] || null;

    // 6. Payer policy (match by CPT code from request)
    let payer_policy = null;
    const payer_id = coverage?.payer_id || request?.payer_id;
    if (payer_id && request?.cpt_code) {
      const polRes = await pool.query(
        `SELECT * FROM ${S}.payer_policies
         WHERE tenant_id=$1 AND facility_id=$2 AND payer_id=$3
           AND $4 = ANY(cpt_codes)
           AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
         ORDER BY effective_date DESC NULLS LAST LIMIT 1;`,
        [tenant_id, facility_id, payer_id, request.cpt_code]
      );
      payer_policy = polRes.rows[0] || null;
    }
    // fallback: try by service_key
    if (!payer_policy && payer_id && request?.service_key) {
      const polRes = await pool.query(
        `SELECT * FROM ${S}.payer_policies
         WHERE tenant_id=$1 AND facility_id=$2 AND payer_id=$3
           AND service_category ILIKE $4
           AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
         ORDER BY effective_date DESC NULLS LAST LIMIT 1;`,
        [tenant_id, facility_id, payer_id, `%${request.service_key}%`]
      );
      payer_policy = polRes.rows[0] || null;
    }

    // 7. Letter template
    const tmplRes = await pool.query(
      `SELECT * FROM ${S}.letter_templates
       WHERE tenant_id=$1 AND facility_id=$2 AND letter_type=$3 AND is_active=true
       ORDER BY version DESC LIMIT 1;`,
      [tenant_id, facility_id, letter_type]
    );
    const template = tmplRes.rows[0] || null;

    // 8. Clinical evidence
    const [problemsRes, encountersRes, imagingRes, therapyRes, medTrialsRes] = await Promise.all([
      pool.query(
        `SELECT icd10_code, description, to_char(onset_date,'YYYY-MM-DD') AS onset_date
         FROM ${S}.problems WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY problem_id;`,
        [tenant_id, facility_id, patient_id]
      ),
      pool.query(
        `SELECT encounter_id, to_char(encounter_date,'YYYY-MM-DD') AS encounter_date,
                summary, provider_name
         FROM ${S}.encounters WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3
         ORDER BY encounter_date DESC LIMIT 10;`,
        [tenant_id, facility_id, patient_id]
      ),
      pool.query(
        `SELECT modality, body_part, impression, item,
                to_char(imaging_date,'YYYY-MM-DD') AS imaging_date
         FROM ${S}.imaging WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3
         ORDER BY imaging_date DESC NULLS LAST;`,
        [tenant_id, facility_id, patient_id]
      ),
      pool.query(
        `SELECT therapy_type, to_char(start_date,'YYYY-MM-DD') AS start_date,
                to_char(end_date,'YYYY-MM-DD') AS end_date, total_visits, response, therapy_item
         FROM ${S}.therapy WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3
         ORDER BY start_date DESC NULLS LAST;`,
        [tenant_id, facility_id, patient_id]
      ),
      pool.query(
        `SELECT medication, dose, to_char(start_date,'YYYY-MM-DD') AS start_date,
                to_char(end_date,'YYYY-MM-DD') AS end_date, outcome
         FROM ${S}.med_trials WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3
         ORDER BY start_date DESC NULLS LAST;`,
        [tenant_id, facility_id, patient_id]
      ),
    ]);

    // 9. Parent letter (for appeals)
    let parent_letter = null;
    if (parent_letter_id) {
      const plRes = await pool.query(
        `SELECT letter_id, letter_type, letter_date, status, denial_reason, denial_code,
                auth_number, response_status, response_date, appeal_deadline
         FROM ${S}.generated_letters WHERE tenant_id=$1 AND facility_id=$2 AND letter_id=$3 LIMIT 1;`,
        [tenant_id, facility_id, parent_letter_id]
      );
      parent_letter = plRes.rows[0] || null;
    }

    // 10. Payer contacts
    let payer_contacts = [];
    if (payer_id) {
      const pcRes = await pool.query(
        `SELECT contact_name, title, phone, fax, email, department, notes
         FROM ${S}.payer_contacts WHERE tenant_id=$1 AND facility_id=$2 AND payer_id=$3;`,
        [tenant_id, facility_id, payer_id]
      );
      payer_contacts = pcRes.rows;
    }

    res.json({
      ok: true,
      letter_type,
      context: {
        patient: {
          patient_id: patient.patient_id,
          full_name: patient.full_name,
          first_name: patient.first_name,
          last_name: patient.last_name,
          dob: patient.dob_str,
          age: patient.age,
          sex: patient.sex,
          phone: patient.phone,
          address: patient.address,
        },
        coverage: coverage
          ? {
              coverage_id: coverage.coverage_id,
              payer_name: coverage.payer_full_name || coverage.payer_name,
              payer_id: coverage.payer_id,
              member_id: coverage.member_id,
              group_id: coverage.group_id,
              plan_name: coverage.plan_name,
              payer_phone: coverage.phone_pa,
              payer_fax: coverage.fax_pa,
              payer_portal: coverage.portal_url,
              payer_address: [coverage.payer_address_line1, coverage.payer_city, coverage.payer_state, coverage.payer_zip]
                .filter(Boolean).join(", "),
              turnaround_standard: coverage.pa_turnaround_standard_days,
              turnaround_urgent: coverage.pa_turnaround_urgent_days,
            }
          : null,
        request: request
          ? {
              request_id: request.request_id,
              cpt_code: request.cpt_code,
              cpt_description: request.cpt_description,
              icd10_code: request.icd10_code,
              icd10_description: request.icd10_description,
              icd10_codes: request.icd10_codes,
              service_name: request.service_name,
              service_key: request.service_key,
              requested_dos: request.requested_dos,
              requested_units: request.requested_units,
              priority: request.priority,
              medical_necessity_summary: request.medical_necessity_summary,
              clinical_question: request.clinical_question,
            }
          : null,
        provider: provider
          ? {
              provider_id: provider.provider_id,
              name: `${provider.first_name} ${provider.last_name}`,
              credentials: provider.credentials,
              specialty: provider.specialty,
              npi: provider.npi,
              phone: provider.phone,
              signature_name: provider.signature_name,
            }
          : null,
        facility: facility
          ? {
              facility_id: facility.facility_id,
              name: facility.facility_name,
              npi: facility.npi,
              address: [facility.address_line1, facility.city, facility.state, facility.zip].filter(Boolean).join(", "),
              phone: facility.phone,
              fax: facility.fax,
              email: facility.email,
            }
          : null,
        payer_policy: payer_policy
          ? {
              policy_id: payer_policy.policy_id,
              policy_name: payer_policy.policy_name,
              clinical_criteria: payer_policy.clinical_criteria,
              required_documents: payer_policy.required_documents,
              required_failed_therapies: payer_policy.required_failed_therapies,
              min_therapy_weeks: payer_policy.min_therapy_weeks,
              guideline_source: payer_policy.guideline_source,
              appeal_deadline_days: payer_policy.appeal_deadline_days,
              notes: payer_policy.notes,
            }
          : null,
        payer_contacts,
        template: template
          ? {
              template_id: template.template_id,
              template_name: template.template_name,
              template_body: template.template_body,
              instructions: template.instructions,
              placeholders: template.placeholders,
            }
          : null,
        clinical: {
          problems: problemsRes.rows,
          encounters: encountersRes.rows,
          imaging: imagingRes.rows,
          therapies: therapyRes.rows,
          med_trials: medTrialsRes.rows,
        },
        parent_letter,
      },
    });
  } catch (e) {
    console.error("generate-context error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ============================================================================
// NEW: Save generated letter
// ============================================================================
app.post("/api/letters", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const b = req.body;

  const letter_id = b.letter_id || `LTR-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  try {
    await pool.query(
      `INSERT INTO ${S}.generated_letters
       (tenant_id, facility_id, letter_id, request_id, template_id, patient_id,
        coverage_id, payer_id, provider_id, letter_type, letter_date, subject_line,
        letter_body, pdf_storage_path, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_DATE,$11,$12,$13,$14,$15);`,
      [
        tenant_id, facility_id, letter_id,
        b.request_id || null, b.template_id || null, b.patient_id,
        b.coverage_id || null, b.payer_id || null, b.provider_id || null,
        b.letter_type || "initial_auth", b.subject_line || null,
        b.letter_body, b.pdf_storage_path || null,
        b.status || "draft", b.created_by || null,
      ]
    );

    // Log initial status
    await pool.query(
      `INSERT INTO ${S}.letter_status_history
       (tenant_id, facility_id, history_id, letter_id, old_status, new_status, changed_by)
       VALUES ($1,$2,$3,$4,NULL,$5,$6);`,
      [tenant_id, facility_id, `HST-${Date.now()}`, letter_id, b.status || "draft", b.created_by || null]
    );

    res.json({ ok: true, letter_id });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ============================================================================
// NEW: Update letter status
// ============================================================================
app.patch("/api/letters/:id/status", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const letter_id = req.params.id;
  const new_status = String(req.body?.status ?? "").trim();
  const changed_by = req.body?.changed_by || null;
  const change_reason = req.body?.change_reason || null;

  if (!new_status) return res.status(400).json({ ok: false, error: "status required" });

  try {
    // Get current status
    const cur = await pool.query(
      `SELECT status FROM ${S}.generated_letters WHERE tenant_id=$1 AND facility_id=$2 AND letter_id=$3 LIMIT 1;`,
      [tenant_id, facility_id, letter_id]
    );
    if (!cur.rows[0]) return res.status(404).json({ ok: false, error: "Letter not found" });
    const old_status = cur.rows[0].status;

    // Build dynamic SET clause based on new_status
    let extraSets = "";
    const extraParams = [];
    let paramIdx = 5;

    if (new_status === "sent") {
      extraSets += `, sent_date=CURRENT_DATE`;
      if (req.body.sent_method) { extraSets += `, sent_method=$${paramIdx++}`; extraParams.push(req.body.sent_method); }
      if (req.body.sent_to) { extraSets += `, sent_to=$${paramIdx++}`; extraParams.push(req.body.sent_to); }
    }
    if (new_status === "approved" || new_status === "denied") {
      extraSets += `, response_date=CURRENT_DATE, response_status=$${paramIdx++}`;
      extraParams.push(new_status);
      if (req.body.auth_number) { extraSets += `, auth_number=$${paramIdx++}`; extraParams.push(req.body.auth_number); }
      if (req.body.denial_reason) { extraSets += `, denial_reason=$${paramIdx++}`; extraParams.push(req.body.denial_reason); }
      if (req.body.denial_code) { extraSets += `, denial_code=$${paramIdx++}`; extraParams.push(req.body.denial_code); }
    }

    await pool.query(
      `UPDATE ${S}.generated_letters SET status=$4, updated_at=now() ${extraSets}
       WHERE tenant_id=$1 AND facility_id=$2 AND letter_id=$3;`,
      [tenant_id, facility_id, letter_id, new_status, ...extraParams]
    );

    await pool.query(
      `INSERT INTO ${S}.letter_status_history
       (tenant_id, facility_id, history_id, letter_id, old_status, new_status, changed_by, change_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8);`,
      [tenant_id, facility_id, `HST-${Date.now()}`, letter_id, old_status, new_status, changed_by, change_reason]
    );

    res.json({ ok: true, letter_id, old_status, new_status });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ============================================================================
// NEW: List letters
// ============================================================================
app.get("/api/letters", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const patient_id = String(req.query?.patient_id ?? "").trim();
  const status = String(req.query?.status ?? "").trim();

  try {
    let sql = `SELECT letter_id, patient_id, letter_type, letter_date, status,
                      subject_line, payer_id, provider_id, request_id, created_at
               FROM ${S}.generated_letters WHERE tenant_id=$1 AND facility_id=$2`;
    const params = [tenant_id, facility_id];
    let idx = 3;

    if (patient_id) { sql += ` AND patient_id=$${idx++}`; params.push(patient_id); }
    if (status) { sql += ` AND status=$${idx++}`; params.push(status); }

    sql += ` ORDER BY created_at DESC LIMIT 100;`;

    const r = await pool.query(sql, params);
    res.json({ ok: true, letters: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get("/api/letters/:id", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  try {
    const r = await pool.query(
      `SELECT * FROM ${S}.generated_letters WHERE tenant_id=$1 AND facility_id=$2 AND letter_id=$3 LIMIT 1;`,
      [tenant_id, facility_id, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ ok: false, error: "Letter not found" });

    const history = await pool.query(
      `SELECT * FROM ${S}.letter_status_history WHERE tenant_id=$1 AND facility_id=$2 AND letter_id=$3 ORDER BY changed_at;`,
      [tenant_id, facility_id, req.params.id]
    );

    res.json({ ok: true, letter: r.rows[0], status_history: history.rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ============================================================================
// Start server
// ============================================================================
app.listen(PORT, HOST, () => {
  console.log(`Clinic DB API v2 running at http://${HOST}:${PORT}`);
  console.log(`Schema: ${CLINIC_SCHEMA}`);
  console.log(`Endpoints:`);
  console.log(`  GET  /health`);
  console.log(`  POST /api/patients/search`);
  console.log(`  POST /api/patients/background`);
  console.log(`  GET  /api/facility`);
  console.log(`  GET  /api/providers`);
  console.log(`  GET  /api/providers/:id`);
  console.log(`  GET  /api/payers`);
  console.log(`  GET  /api/payers/:id`);
  console.log(`  POST /api/payer-policy/match`);
  console.log(`  GET  /api/letter-templates`);
  console.log(`  GET  /api/letter-templates/:id`);
  console.log(`  POST /api/letters/generate-context  ← THE KEY ENDPOINT`);
  console.log(`  POST /api/letters`);
  console.log(`  PATCH /api/letters/:id/status`);
  console.log(`  GET  /api/letters`);
  console.log(`  GET  /api/letters/:id`);
});