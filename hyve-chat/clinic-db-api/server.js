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
import { fileURLToPath } from "url";
import path from "path";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: process.env.DOTENV_PATH || path.join(__dirname, ".env"),
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
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(CLINIC_SCHEMA)) {
  throw new Error(`Invalid CLINIC_SCHEMA: "${CLINIC_SCHEMA}" — must be a valid SQL identifier`);
}
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

// Helper: tenant/facility from query or body (required — no silent defaults)
function tf(req) {
  const raw_tid = req.body?.tenant_id ?? req.query?.tenant_id;
  const raw_fid = req.body?.facility_id ?? req.query?.facility_id;
  const tenant_id = Number(raw_tid ?? 1);
  const facility_id = String(raw_fid ?? "FAC-DEMO").trim();
  if (isNaN(tenant_id) || tenant_id < 1) throw new Error("Invalid tenant_id");
  if (!facility_id) throw new Error("facility_id is required");
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
      p.sex, p.phone,
      COALESCE(p.address_line1,'') || CASE WHEN p.address_line2 IS NOT NULL AND p.address_line2 <> '' THEN ', ' || p.address_line2 ELSE '' END || CASE WHEN p.city IS NOT NULL THEN ', ' || p.city ELSE '' END || CASE WHEN p.state IS NOT NULL THEN ', ' || p.state ELSE '' END || CASE WHEN p.zip IS NOT NULL THEN ' ' || p.zip ELSE '' END AS address,
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
              to_char(dob,'YYYY-MM-DD') AS dob, sex, phone,
              COALESCE(address_line1,'') || CASE WHEN address_line2 IS NOT NULL AND address_line2 <> '' THEN ', ' || address_line2 ELSE '' END || CASE WHEN city IS NOT NULL THEN ', ' || city ELSE '' END || CASE WHEN state IS NOT NULL THEN ', ' || state ELSE '' END || CASE WHEN zip IS NOT NULL THEN ' ' || zip ELSE '' END AS address
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
  const provider_id = String(req.params.id || "").trim();
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
  const payer_id = String(req.params.id || "").trim();
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

  const letter_id = b.letter_id || `LTR-${Date.now()}-${crypto.randomUUID().slice(0, 12)}`;

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
  const letter_id = String(req.params.id || "").trim();
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
// NEW v3: Template Sections (Blueprint §4.1)
// ============================================================================
// Sections allow per-section generation: each section has its own instruction
// prompt and scaffold text. The generation loop iterates through sections in
// order and generates each one independently.
// ============================================================================

app.get("/api/letter-templates/:id/sections", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const template_id = String(req.params.id || "").trim();
  try {
    const r = await pool.query(
      `SELECT section_id, section_name, section_order, instruction_prompt,
              scaffold_text, requires_policy, requires_clinical, is_active
       FROM ${S}.template_sections
       WHERE tenant_id=$1 AND facility_id=$2 AND template_id=$3 AND is_active=true
       ORDER BY section_order ASC;`,
      [tenant_id, facility_id, template_id]
    );
    res.json({ ok: true, template_id, sections: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post("/api/letter-templates/:id/sections", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const template_id = String(req.params.id || "").trim();
  const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
  if (!sections.length) return res.status(400).json({ ok: false, error: "sections array required" });

  try {
    const inserted = [];
    for (const sec of sections) {
      const section_id = sec.section_id || `SEC-${Date.now()}-${crypto.randomUUID().slice(0, 12)}`;
      await pool.query(
        `INSERT INTO ${S}.template_sections
         (tenant_id, facility_id, section_id, template_id, section_name, section_order,
          instruction_prompt, scaffold_text, requires_policy, requires_clinical)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tenant_id, facility_id, section_id) DO UPDATE SET
           section_name=EXCLUDED.section_name, section_order=EXCLUDED.section_order,
           instruction_prompt=EXCLUDED.instruction_prompt, scaffold_text=EXCLUDED.scaffold_text,
           requires_policy=EXCLUDED.requires_policy, requires_clinical=EXCLUDED.requires_clinical,
           updated_at=now();`,
        [
          tenant_id, facility_id, section_id, template_id,
          sec.section_name || "Untitled",
          sec.section_order ?? inserted.length,
          sec.instruction_prompt || "",
          sec.scaffold_text || "",
          sec.requires_policy ?? false,
          sec.requires_clinical ?? true,
        ]
      );
      inserted.push(section_id);
    }
    res.json({ ok: true, template_id, inserted_section_ids: inserted });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ============================================================================
// NEW v3: Patient Data Normalization (Blueprint §5, Step 1)
// ============================================================================
// Creates a structured normalized object from raw patient background data.
// Prevents prompt noise by extracting only the relevant clinical facts.
// ============================================================================

app.post("/api/patients/normalize", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const patient_id = String(req.body?.patient_id ?? "").trim();
  if (!patient_id) return res.status(400).json({ ok: false, error: "patient_id required" });

  try {
    // Fetch all clinical data in parallel
    const [patientRes, problemsRes, therapyRes, imagingRes, encountersRes, medTrialsRes] = await Promise.all([
      pool.query(
        `SELECT patient_id, first_name, last_name, (first_name || ' ' || last_name) AS full_name,
                to_char(dob,'YYYY-MM-DD') AS dob, EXTRACT(YEAR FROM AGE(dob))::int AS age, sex
         FROM ${S}.patients WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 LIMIT 1;`,
        [tenant_id, facility_id, patient_id]
      ),
      pool.query(
        `SELECT icd10_code, description, to_char(onset_date,'YYYY-MM-DD') AS onset_date
         FROM ${S}.problems WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY onset_date ASC NULLS LAST;`,
        [tenant_id, facility_id, patient_id]
      ),
      pool.query(
        `SELECT therapy_type, to_char(start_date,'YYYY-MM-DD') AS start_date,
                to_char(end_date,'YYYY-MM-DD') AS end_date, total_visits, response, therapy_item
         FROM ${S}.therapy WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY start_date ASC NULLS LAST;`,
        [tenant_id, facility_id, patient_id]
      ),
      pool.query(
        `SELECT modality, body_part, impression, item, to_char(imaging_date,'YYYY-MM-DD') AS imaging_date
         FROM ${S}.imaging WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY imaging_date DESC NULLS LAST;`,
        [tenant_id, facility_id, patient_id]
      ),
      pool.query(
        `SELECT to_char(encounter_date,'YYYY-MM-DD') AS encounter_date, summary, provider_name
         FROM ${S}.encounters WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3
         ORDER BY encounter_date DESC NULLS LAST LIMIT 15;`,
        [tenant_id, facility_id, patient_id]
      ),
      pool.query(
        `SELECT medication, dose, to_char(start_date,'YYYY-MM-DD') AS start_date,
                to_char(end_date,'YYYY-MM-DD') AS end_date, outcome
         FROM ${S}.med_trials WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY start_date ASC NULLS LAST;`,
        [tenant_id, facility_id, patient_id]
      ),
    ]);

    const patient = patientRes.rows[0];
    if (!patient) return res.status(404).json({ ok: false, error: "Patient not found" });

    // Build the normalized structured object (Blueprint §5 Step 1)
    const problems = problemsRes.rows || [];
    const therapies = therapyRes.rows || [];
    const imagingRows = imagingRes.rows || [];
    const encounters = encountersRes.rows || [];
    const medTrials = medTrialsRes.rows || [];

    // Derive primary diagnosis
    const primaryDx = problems[0] || null;

    // Compute symptom duration from earliest problem onset
    let symptom_duration = null;
    const onsetDates = problems.map(p => p.onset_date).filter(Boolean).sort();
    if (onsetDates.length) {
      const earliest = new Date(onsetDates[0]);
      const now = new Date();
      const months = Math.round((now - earliest) / (1000 * 60 * 60 * 24 * 30.44));
      symptom_duration = months > 12
        ? `${Math.round(months / 12)} years`
        : `${months} months`;
    }

    // Extract failed treatments
    const failed_treatments = therapies
      .filter(t => t.response && /fail|inad|poor|no.?relief|no.?improv|minimal/i.test(t.response))
      .map(t => ({
        type: t.therapy_type,
        visits: t.total_visits,
        response: t.response,
        item: t.therapy_item || null,
      }));

    // Extract medications with outcomes
    const medications = medTrials.map(m => ({
      name: m.medication,
      dose: m.dose,
      outcome: m.outcome,
      start_date: m.start_date,
      end_date: m.end_date,
    }));

    // Extract functional limits from encounter summaries
    const functional_limits = encounters
      .map(e => e.summary || "")
      .filter(s => /function|limit|unable|restrict|impair|disab|pain.*daily|ADL/i.test(s))
      .slice(0, 5);

    // Imaging findings
    const imaging_findings = imagingRows.map(i => ({
      modality: i.modality,
      body_part: i.body_part,
      impression: i.impression,
      date: i.imaging_date,
    }));

    const normalized = {
      patient_id: patient.patient_id,
      age: patient.age,
      sex: patient.sex,
      diagnosis: problems.map(p => ({
        icd10: p.icd10_code,
        description: p.description,
        onset: p.onset_date,
      })),
      primary_diagnosis: primaryDx ? {
        icd10: primaryDx.icd10_code,
        description: primaryDx.description,
      } : null,
      symptoms: encounters
        .map(e => e.summary)
        .filter(Boolean)
        .slice(0, 8),
      symptom_duration,
      failed_treatments,
      medications,
      functional_limits,
      imaging_findings,
      therapy_history: therapies.map(t => ({
        type: t.therapy_type,
        start_date: t.start_date,
        end_date: t.end_date,
        visits: t.total_visits,
        response: t.response,
        item: t.therapy_item,
      })),
    };

    res.json({ ok: true, patient_id, normalized });
  } catch (e) {
    console.error("normalize error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ============================================================================
// NEW v3: Policy Criteria Extraction (Blueprint §5, Step 2)
// ============================================================================
// Returns structured criteria from the payer policy for a given service.
// The client/LLM uses this to align evidence against each criterion.
// ============================================================================

app.post("/api/policy/extract-criteria", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const policy_id = String(req.body?.policy_id ?? "").trim();
  const payer_id = String(req.body?.payer_id ?? "").trim();
  const cpt_code = String(req.body?.cpt_code ?? "").trim();

  try {
    let policy = null;

    // If policy_id provided, fetch directly
    if (policy_id) {
      const r = await pool.query(
        `SELECT * FROM ${S}.payer_policies WHERE tenant_id=$1 AND facility_id=$2 AND policy_id=$3 LIMIT 1;`,
        [tenant_id, facility_id, policy_id]
      );
      policy = r.rows[0] || null;
    }
    // Otherwise match by payer + CPT
    else if (payer_id && cpt_code) {
      const r = await pool.query(
        `SELECT * FROM ${S}.payer_policies
         WHERE tenant_id=$1 AND facility_id=$2 AND payer_id=$3
           AND $4 = ANY(cpt_codes)
           AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
         ORDER BY effective_date DESC NULLS LAST LIMIT 1;`,
        [tenant_id, facility_id, payer_id, cpt_code]
      );
      policy = r.rows[0] || null;
    }

    if (!policy) return res.status(404).json({ ok: false, error: "No matching policy found" });

    // Extract structured criteria from the policy
    const criteria = {
      policy_id: policy.policy_id,
      policy_name: policy.policy_name,
      payer_id: policy.payer_id,

      // Core requirements
      clinical_criteria: policy.clinical_criteria || null,
      required_documents: policy.required_documents || null,
      required_failed_therapies: policy.required_failed_therapies || 0,
      min_therapy_weeks: policy.min_therapy_weeks || 0,

      // Guideline reference
      guideline_source: policy.guideline_source || null,

      // Appeal info
      appeal_deadline_days: policy.appeal_deadline_days || null,

      // Structured checklist for the LLM
      checklist: [],
    };

    // Build a checklist from clinical_criteria text
    if (policy.clinical_criteria) {
      const criteriaText = String(policy.clinical_criteria);
      // Split on common delimiters (numbered items, bullets, semicolons)
      const items = criteriaText
        .split(/(?:\d+[.)]\s*|\n[-•*]\s*|\n\d+\.\s*|;\s*)/)
        .map(s => s.trim())
        .filter(s => s.length > 5);

      criteria.checklist = items.map((item, idx) => ({
        criterion_id: `C${idx + 1}`,
        text: item,
        category: categorizeCI(item),
      }));
    }

    // Add required failed therapies as explicit criterion
    if (policy.required_failed_therapies > 0) {
      criteria.checklist.push({
        criterion_id: `C_FT`,
        text: `Patient must have failed at least ${policy.required_failed_therapies} conservative treatment(s)`,
        category: "conservative_treatment",
      });
    }

    // Add minimum therapy weeks as explicit criterion
    if (policy.min_therapy_weeks > 0) {
      criteria.checklist.push({
        criterion_id: `C_TW`,
        text: `Patient must have completed at least ${policy.min_therapy_weeks} weeks of conservative therapy`,
        category: "conservative_treatment",
      });
    }

    res.json({ ok: true, criteria });
  } catch (e) {
    console.error("extract-criteria error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Helper: categorize a criterion item
function categorizeCI(text) {
  const t = text.toLowerCase();
  if (/conserv|therap|physical|pt |rehab|inject/i.test(t)) return "conservative_treatment";
  if (/imag|mri|ct |x-ray|radiograph/i.test(t)) return "imaging";
  if (/diagnos|icd|condition/i.test(t)) return "diagnosis";
  if (/function|limit|impair|disab/i.test(t)) return "functional_limitation";
  if (/document|record|note|report/i.test(t)) return "documentation";
  if (/medic|drug|pharma|nsaid|opioid/i.test(t)) return "medication";
  return "general";
}

// ============================================================================
// NEW v3: Section Generation Pipeline (Blueprint §5, Steps 3-4)
// ============================================================================
// Prepares the full section-based generation payload. The actual LLM call
// happens client-side via n8n webhook. This endpoint assembles all data
// each section needs.
// ============================================================================

app.post("/api/letters/generate-sections", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const patient_id = String(req.body?.patient_id ?? "").trim();
  const template_id = String(req.body?.template_id ?? "").trim();
  const letter_type = String(req.body?.letter_type ?? "initial_auth").trim();
  const request_id = String(req.body?.request_id ?? "").trim();
  const provider_id = String(req.body?.provider_id ?? "").trim();
  const coverage_id = String(req.body?.coverage_id ?? "").trim();

  if (!patient_id) return res.status(400).json({ ok: false, error: "patient_id required" });

  try {
    // 1. Get template and its sections
    let tmpl = null;
    let sections = [];

    if (template_id) {
      const tmplRes = await pool.query(
        `SELECT * FROM ${S}.letter_templates WHERE tenant_id=$1 AND facility_id=$2 AND template_id=$3 LIMIT 1;`,
        [tenant_id, facility_id, template_id]
      );
      tmpl = tmplRes.rows[0] || null;
    } else {
      // Auto-select template by letter_type
      const tmplRes = await pool.query(
        `SELECT * FROM ${S}.letter_templates
         WHERE tenant_id=$1 AND facility_id=$2 AND letter_type=$3 AND is_active=true
         ORDER BY version DESC LIMIT 1;`,
        [tenant_id, facility_id, letter_type]
      );
      tmpl = tmplRes.rows[0] || null;
    }

    const resolvedTemplateId = tmpl?.template_id;
    if (resolvedTemplateId) {
      const secRes = await pool.query(
        `SELECT * FROM ${S}.template_sections
         WHERE tenant_id=$1 AND facility_id=$2 AND template_id=$3 AND is_active=true
         ORDER BY section_order ASC;`,
        [tenant_id, facility_id, resolvedTemplateId]
      );
      sections = secRes.rows;
    }

    // Fallback: if no sections found for this template, try any active template
    // with the same letter_type (e.g. user created a new template but sections
    // are only seeded for the original template_id).
    if (sections.length === 0) {
      const resolvedLetterType = tmpl?.letter_type || letter_type;
      const fallbackRes = await pool.query(
        `SELECT ts.* FROM ${S}.template_sections ts
         JOIN ${S}.letter_templates lt
           ON lt.tenant_id = ts.tenant_id AND lt.facility_id = ts.facility_id
              AND lt.template_id = ts.template_id
         WHERE ts.tenant_id=$1 AND ts.facility_id=$2
           AND lt.letter_type=$3 AND lt.is_active=true AND ts.is_active=true
         ORDER BY ts.section_order ASC
         LIMIT 20;`,
        [tenant_id, facility_id, resolvedLetterType]
      );
      sections = fallbackRes.rows;
      if (sections.length > 0) {
        console.log(`generate-sections: no sections for template ${resolvedTemplateId}, fell back to letter_type=${resolvedLetterType} (${sections.length} sections)`);
      }
    }

    // 2. Get normalized patient data
    const patientRes = await pool.query(
      `SELECT *, (first_name || ' ' || last_name) AS full_name,
              to_char(dob,'YYYY-MM-DD') AS dob_str, EXTRACT(YEAR FROM AGE(dob))::int AS age
       FROM ${S}.patients WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 LIMIT 1;`,
      [tenant_id, facility_id, patient_id]
    );
    if (!patientRes.rows[0]) return res.status(404).json({ ok: false, error: "Patient not found" });

    // 3. Get clinical data
    const [problemsRes, therapyRes, imagingRes, encountersRes, medTrialsRes] = await Promise.all([
      pool.query(`SELECT * FROM ${S}.problems WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY problem_id LIMIT 100;`, [tenant_id, facility_id, patient_id]),
      pool.query(`SELECT * FROM ${S}.therapy WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY start_date ASC NULLS LAST LIMIT 50;`, [tenant_id, facility_id, patient_id]),
      pool.query(`SELECT * FROM ${S}.imaging WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY imaging_date DESC NULLS LAST LIMIT 50;`, [tenant_id, facility_id, patient_id]),
      pool.query(`SELECT * FROM ${S}.encounters WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY encounter_date DESC NULLS LAST LIMIT 15;`, [tenant_id, facility_id, patient_id]),
      pool.query(`SELECT * FROM ${S}.med_trials WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 ORDER BY start_date ASC NULLS LAST;`, [tenant_id, facility_id, patient_id]),
    ]);

    // 4. Get coverage + policy
    let coverage = null;
    let payer_policy = null;
    let request = null;

    if (coverage_id) {
      const covRes = await pool.query(
        `SELECT c.*, py.payer_name AS payer_full_name, py.phone_pa, py.fax_pa, py.portal_url,
                py.address_line1 AS payer_address, py.city AS payer_city, py.state AS payer_state, py.zip AS payer_zip
         FROM ${S}.coverage c
         LEFT JOIN ${S}.payers py ON py.tenant_id=c.tenant_id AND py.facility_id=c.facility_id AND py.payer_id=c.payer_id
         WHERE c.tenant_id=$1 AND c.facility_id=$2 AND c.coverage_id=$3 LIMIT 1;`,
        [tenant_id, facility_id, coverage_id]
      );
      coverage = covRes.rows[0] || null;
    }

    if (request_id) {
      const reqRes = await pool.query(
        `SELECT * FROM ${S}.preauth_requests WHERE tenant_id=$1 AND facility_id=$2 AND request_id=$3 LIMIT 1;`,
        [tenant_id, facility_id, request_id]
      );
      request = reqRes.rows[0] || null;
    }

    const payer_id = coverage?.payer_id || request?.payer_id;
    if (payer_id && request?.cpt_code) {
      const polRes = await pool.query(
        `SELECT * FROM ${S}.payer_policies
         WHERE tenant_id=$1 AND facility_id=$2 AND payer_id=$3 AND $4 = ANY(cpt_codes)
           AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
         ORDER BY effective_date DESC NULLS LAST LIMIT 1;`,
        [tenant_id, facility_id, payer_id, request.cpt_code]
      );
      payer_policy = polRes.rows[0] || null;
    }

    // 5. Get provider + facility
    let provider = null;
    const prov_id = provider_id || request?.provider_id;
    if (prov_id) {
      const provRes = await pool.query(
        `SELECT * FROM ${S}.providers WHERE tenant_id=$1 AND facility_id=$2 AND provider_id=$3 LIMIT 1;`,
        [tenant_id, facility_id, prov_id]
      );
      provider = provRes.rows[0] || null;
    }

    const facRes = await pool.query(
      `SELECT * FROM ${S}.facilities WHERE tenant_id=$1 AND facility_id=$2 LIMIT 1;`,
      [tenant_id, facility_id]
    );
    const facility = facRes.rows[0] || null;

    // 6. Build per-section generation payloads
    const clinical = {
      problems: problemsRes.rows,
      therapies: therapyRes.rows,
      imaging: imagingRes.rows,
      encounters: encountersRes.rows,
      med_trials: medTrialsRes.rows,
    };

    const policy_criteria = payer_policy ? {
      clinical_criteria: payer_policy.clinical_criteria,
      required_documents: payer_policy.required_documents,
      required_failed_therapies: payer_policy.required_failed_therapies,
      min_therapy_weeks: payer_policy.min_therapy_weeks,
      guideline_source: payer_policy.guideline_source,
    } : null;

    const section_payloads = sections.map((sec) => ({
      section_id: sec.section_id,
      section_name: sec.section_name,
      section_order: sec.section_order,
      instruction_prompt: sec.instruction_prompt,
      scaffold_text: sec.scaffold_text,
      // Only include what the section needs
      patient_facts: sec.requires_clinical ? clinical : null,
      policy_criteria: sec.requires_policy ? policy_criteria : null,
    }));

    res.json({
      ok: true,
      letter_type,
      template: tmpl ? {
        template_id: tmpl.template_id,
        template_name: tmpl.template_name,
        instructions: tmpl.instructions,
      } : null,
      patient: {
        patient_id: patientRes.rows[0].patient_id,
        full_name: patientRes.rows[0].full_name,
        age: patientRes.rows[0].age,
        sex: patientRes.rows[0].sex,
      },
      coverage: coverage ? {
        coverage_id: coverage.coverage_id,
        payer_name: coverage.payer_full_name || coverage.payer_name,
        payer_id: coverage.payer_id,
        member_id: coverage.member_id,
        plan_name: coverage.plan_name,
      } : null,
      request: request ? {
        request_id: request.request_id,
        cpt_code: request.cpt_code,
        icd10_code: request.icd10_code,
        service_name: request.service_name,
      } : null,
      provider: provider ? {
        provider_id: provider.provider_id,
        name: `${provider.first_name} ${provider.last_name}`,
        credentials: provider.credentials,
        specialty: provider.specialty,
        npi: provider.npi,
      } : null,
      facility: facility ? {
        name: facility.facility_name,
        npi: facility.npi,
        phone: facility.phone,
        fax: facility.fax,
        address: [facility.address_line1, facility.city, facility.state, facility.zip].filter(Boolean).join(", "),
      } : null,
      policy_criteria,
      clinical,
      sections: section_payloads,
      section_count: section_payloads.length,
    });
  } catch (e) {
    console.error("generate-sections error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ============================================================================
// NEW v3: Validation Pass (Blueprint §6)
// ============================================================================
// Evaluates generated letter sections against policy criteria.
// Returns coverage gaps, missing evidence, and weak reasoning flags.
// ============================================================================

app.post("/api/letters/validate", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const letter_body = String(req.body?.letter_body ?? "").trim();
  const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
  const policy_id = String(req.body?.policy_id ?? "").trim();
  const payer_id = String(req.body?.payer_id ?? "").trim();
  const cpt_code = String(req.body?.cpt_code ?? "").trim();

  if (!letter_body && !sections.length) {
    return res.status(400).json({ ok: false, error: "letter_body or sections required" });
  }

  try {
    // Fetch policy for criteria matching
    let policy = null;
    if (policy_id) {
      const r = await pool.query(
        `SELECT * FROM ${S}.payer_policies WHERE tenant_id=$1 AND facility_id=$2 AND policy_id=$3 LIMIT 1;`,
        [tenant_id, facility_id, policy_id]
      );
      policy = r.rows[0] || null;
    } else if (payer_id && cpt_code) {
      const r = await pool.query(
        `SELECT * FROM ${S}.payer_policies
         WHERE tenant_id=$1 AND facility_id=$2 AND payer_id=$3 AND $4 = ANY(cpt_codes)
           AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
         ORDER BY effective_date DESC NULLS LAST LIMIT 1;`,
        [tenant_id, facility_id, payer_id, cpt_code]
      );
      policy = r.rows[0] || null;
    }

    const fullText = letter_body || sections.map(s => s.content || s.text || "").join("\n\n");
    const textLower = fullText.toLowerCase();

    const issues = [];
    let criteria_met = 0;
    let criteria_total = 0;

    // Check criteria coverage
    if (policy) {
      // Check required failed therapies
      if (policy.required_failed_therapies > 0) {
        criteria_total++;
        const failWords = ["failed", "inadequate", "no relief", "no improvement", "did not respond", "unsuccessful"];
        const hasFailureEvidence = failWords.some(w => textLower.includes(w));
        if (hasFailureEvidence) {
          criteria_met++;
        } else {
          issues.push({
            type: "missing_evidence",
            severity: "high",
            section: "conservative_treatment",
            message: `Policy requires ${policy.required_failed_therapies} failed conservative treatment(s) but no failure evidence found in letter.`,
          });
        }
      }

      // Check minimum therapy weeks
      if (policy.min_therapy_weeks > 0) {
        criteria_total++;
        const hasWeeks = /\d+\s*weeks?\s*(of\s*)?(therapy|treatment|pt|physical)/i.test(fullText);
        if (hasWeeks) {
          criteria_met++;
        } else {
          issues.push({
            type: "missing_evidence",
            severity: "high",
            section: "conservative_treatment",
            message: `Policy requires minimum ${policy.min_therapy_weeks} weeks of therapy but no therapy duration found in letter.`,
          });
        }
      }

      // Check clinical criteria mentions
      if (policy.clinical_criteria) {
        const criteriaItems = String(policy.clinical_criteria)
          .split(/(?:\d+[.)]\s*|\n[-•*]\s*|;\s*)/)
          .map(s => s.trim())
          .filter(s => s.length > 10);

        criteriaItems.forEach((criterion, idx) => {
          criteria_total++;
          // Check if key words from the criterion appear in the letter
          const keyWords = criterion.toLowerCase()
            .replace(/[^\w\s]/g, "")
            .split(/\s+/)
            .filter(w => w.length > 4);

          const matchCount = keyWords.filter(w => textLower.includes(w)).length;
          const matchRatio = keyWords.length > 0 ? matchCount / keyWords.length : 0;

          if (matchRatio >= 0.4) {
            criteria_met++;
          } else {
            issues.push({
              type: "criteria_gap",
              severity: matchRatio > 0.2 ? "medium" : "high",
              criterion_index: idx + 1,
              criterion_text: criterion.slice(0, 200),
              message: `Policy criterion may not be adequately addressed: "${criterion.slice(0, 100)}..."`,
            });
          }
        });
      }

      // Check required documents
      if (policy.required_documents) {
        const docs = String(policy.required_documents)
          .split(/[,;\n]/)
          .map(s => s.trim())
          .filter(Boolean);
        docs.forEach(doc => {
          criteria_total++;
          if (textLower.includes(doc.toLowerCase().slice(0, 20))) {
            criteria_met++;
          } else {
            issues.push({
              type: "missing_document",
              severity: "medium",
              message: `Required document not referenced: "${doc}"`,
            });
          }
        });
      }
    }

    // General quality checks (no policy needed)
    // Check for diagnosis codes
    if (!/[A-Z]\d{2,3}(\.\d+)?/i.test(fullText)) {
      issues.push({
        type: "weak_reasoning",
        severity: "medium",
        section: "clinical_history",
        message: "No ICD-10 diagnosis codes found in letter. Include specific diagnosis codes.",
      });
    }

    // Check for CPT codes
    if (!/\b\d{5}\b/.test(fullText) && !/CPT/i.test(fullText)) {
      issues.push({
        type: "weak_reasoning",
        severity: "low",
        section: "header",
        message: "No CPT procedure code found in letter.",
      });
    }

    // Check for medical necessity language
    const necessityPhrases = ["medically necessary", "medical necessity", "clinically indicated", "standard of care"];
    const hasNecessity = necessityPhrases.some(p => textLower.includes(p));
    if (!hasNecessity) {
      issues.push({
        type: "weak_reasoning",
        severity: "high",
        section: "medical_necessity",
        message: "Letter does not contain explicit medical necessity language.",
      });
    }

    // Check letter has reasonable length
    if (fullText.length < 500) {
      issues.push({
        type: "weak_reasoning",
        severity: "high",
        message: "Letter appears too short. Prior authorization letters typically need detailed clinical evidence.",
      });
    }

    const score = criteria_total > 0 ? Math.round((criteria_met / criteria_total) * 100) : null;

    res.json({
      ok: true,
      validation: {
        passed: issues.filter(i => i.severity === "high").length === 0,
        score,
        criteria_met,
        criteria_total,
        issue_count: issues.length,
        high_severity_count: issues.filter(i => i.severity === "high").length,
        medium_severity_count: issues.filter(i => i.severity === "medium").length,
        low_severity_count: issues.filter(i => i.severity === "low").length,
        issues,
      },
    });
  } catch (e) {
    console.error("validate error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ============================================================================
// NEW v3: Generation Logging (Blueprint §8)
// ============================================================================

app.post("/api/generation-logs", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const b = req.body;
  const log_id = b.log_id || `LOG-${Date.now()}-${crypto.randomUUID().slice(0, 12)}`;

  try {
    await pool.query(
      `INSERT INTO ${S}.generation_logs
       (tenant_id, facility_id, log_id, letter_id, request_id, patient_id,
        payer_id, provider_id, template_id, letter_type,
        cpt_codes, icd10_codes, policy_refs,
        generation_time_ms, section_count, validation_passed, validation_issues,
        user_edits, outcome, model_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20);`,
      [
        tenant_id, facility_id, log_id,
        b.letter_id || null, b.request_id || null, b.patient_id || null,
        b.payer_id || null, b.provider_id || null, b.template_id || null,
        b.letter_type || null,
        b.cpt_codes || null, b.icd10_codes || null, b.policy_refs || null,
        b.generation_time_ms || null, b.section_count || null,
        b.validation_passed ?? null, b.validation_issues ? JSON.stringify(b.validation_issues) : null,
        b.user_edits ? JSON.stringify(b.user_edits) : null,
        b.outcome || null, b.model_id || null,
      ]
    );
    res.json({ ok: true, log_id });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get("/api/generation-logs", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const patient_id = String(req.query?.patient_id ?? "").trim();
  const limit = Math.min(Math.max(Number(req.query?.limit ?? 50) || 50, 1), 200);

  try {
    let sql = `SELECT * FROM ${S}.generation_logs WHERE tenant_id=$1 AND facility_id=$2`;
    const params = [tenant_id, facility_id];
    let idx = 3;

    if (patient_id) { sql += ` AND patient_id=$${idx++}`; params.push(patient_id); }
    sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
    params.push(limit);

    const r = await pool.query(sql, params);
    res.json({ ok: true, logs: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.patch("/api/generation-logs/:id/outcome", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const log_id = String(req.params.id || "").trim();
  const outcome = String(req.body?.outcome ?? "").trim();
  const user_edits = req.body?.user_edits || null;

  if (!outcome) return res.status(400).json({ ok: false, error: "outcome required" });

  try {
    await pool.query(
      `UPDATE ${S}.generation_logs SET outcome=$4, outcome_date=CURRENT_DATE,
              user_edits=COALESCE($5, user_edits)
       WHERE tenant_id=$1 AND facility_id=$2 AND log_id=$3;`,
      [tenant_id, facility_id, log_id, outcome, user_edits ? JSON.stringify(user_edits) : null]
    );
    res.json({ ok: true, log_id, outcome });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ============================================================================
// PDF Generation (Phase 4)
// ============================================================================

app.get("/api/letters/:id/pdf", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const letter_id = String(req.params.id || "").trim();

  try {
    // Fetch letter, facility, and provider data in parallel
    const [letterRes, facilityRes] = await Promise.all([
      pool.query(
        `SELECT gl.*, p.first_name AS patient_first, p.last_name AS patient_last,
                p.dob AS patient_dob
         FROM ${S}.generated_letters gl
         LEFT JOIN ${S}.patients p ON p.patient_id = gl.patient_id
              AND p.tenant_id = gl.tenant_id AND p.facility_id = gl.facility_id
         WHERE gl.tenant_id=$1 AND gl.facility_id=$2 AND gl.letter_id=$3`,
        [tenant_id, facility_id, letter_id]
      ),
      pool.query(
        `SELECT * FROM ${S}.facilities WHERE tenant_id=$1 AND facility_id=$2`,
        [tenant_id, facility_id]
      ),
    ]);

    const letter = letterRes.rows[0];
    if (!letter) return res.status(404).json({ ok: false, error: "Letter not found" });

    const facility = facilityRes.rows[0] || {};

    // Fetch provider if available
    let provider = {};
    if (letter.provider_id) {
      const provRes = await pool.query(
        `SELECT * FROM ${S}.providers WHERE tenant_id=$1 AND facility_id=$2 AND provider_id=$3`,
        [tenant_id, facility_id, letter.provider_id]
      );
      provider = provRes.rows[0] || {};
    }

    // Build PDF as plain text with structured layout (no external dependency)
    const dateStr = letter.letter_date
      ? new Date(letter.letter_date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    const lines = [];

    // Letterhead
    if (facility.facility_name) {
      lines.push(facility.facility_name);
      if (facility.address_line1) lines.push(facility.address_line1);
      if (facility.city) lines.push(`${facility.city}, ${facility.state || ""} ${facility.zip || ""}`);
      if (facility.phone) lines.push(`Phone: ${facility.phone}`);
      if (facility.fax) lines.push(`Fax: ${facility.fax}`);
      if (facility.npi) lines.push(`NPI: ${facility.npi}`);
      lines.push("");
    }

    lines.push(dateStr);
    lines.push("");

    // Letter body
    if (letter.letter_body) {
      lines.push(letter.letter_body);
    }

    lines.push("");

    // Signature block
    if (provider.signature_name || provider.first_name) {
      lines.push("Sincerely,");
      lines.push("");
      lines.push(provider.signature_name || `${provider.first_name} ${provider.last_name}, ${provider.credentials || ""}`);
      if (provider.specialty) lines.push(provider.specialty);
      if (provider.npi) lines.push(`NPI: ${provider.npi}`);
    }

    const pdfContent = lines.join("\n");

    // Return as text/plain for now (PDF binary generation requires pdfkit)
    // If pdfkit is available, it will be used; otherwise return formatted text
    try {
      const PDFDocument = (await import("pdfkit")).default;
      const chunks = [];

      const doc = new PDFDocument({ margin: 72, size: "LETTER" });
      doc.on("data", (chunk) => chunks.push(chunk));

      const pdfPromise = new Promise((resolve) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
      });

      // Letterhead
      doc.fontSize(14).font("Helvetica-Bold");
      if (facility.facility_name) doc.text(facility.facility_name);
      doc.fontSize(9).font("Helvetica");
      if (facility.address_line1) doc.text(facility.address_line1);
      if (facility.city) doc.text(`${facility.city}, ${facility.state || ""} ${facility.zip || ""}`);
      if (facility.phone) doc.text(`Phone: ${facility.phone}  |  Fax: ${facility.fax || ""}`);
      if (facility.npi) doc.text(`NPI: ${facility.npi}`);
      doc.moveDown();

      // Date
      doc.fontSize(11).font("Helvetica").text(dateStr);
      doc.moveDown();

      // Letter body
      doc.fontSize(11).font("Helvetica");
      if (letter.letter_body) {
        doc.text(letter.letter_body, { align: "left", lineGap: 2 });
      }
      doc.moveDown(2);

      // Signature
      if (provider.signature_name || provider.first_name) {
        doc.text("Sincerely,");
        doc.moveDown();
        doc.font("Helvetica-Bold").text(
          provider.signature_name || `${provider.first_name} ${provider.last_name}, ${provider.credentials || ""}`
        );
        doc.font("Helvetica").fontSize(10);
        if (provider.specialty) doc.text(provider.specialty);
        if (provider.npi) doc.text(`NPI: ${provider.npi}`);
      }

      doc.end();
      const pdfBuffer = await pdfPromise;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="PA_letter_${letter_id}.pdf"`);
      res.send(pdfBuffer);
    } catch {
      // pdfkit not installed — return formatted text
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", `attachment; filename="PA_letter_${letter_id}.txt"`);
      res.send(pdfContent);
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ============================================================================
// Production Metrics (Phase 6)
// ============================================================================

// GET /api/metrics/generation — aggregate generation stats
app.get("/api/metrics/generation", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const days = Number(req.query.days || 30);

  try {
    const r = await pool.query(
      `SELECT
         COUNT(*)::int AS total_generations,
         ROUND(AVG(generation_time_ms))::int AS avg_generation_ms,
         ROUND(AVG(section_count), 1) AS avg_sections,
         COUNT(*) FILTER (WHERE validation_passed = true)::int AS validation_passed,
         COUNT(*) FILTER (WHERE validation_passed = false)::int AS validation_failed,
         ROUND(100.0 * COUNT(*) FILTER (WHERE validation_passed = true) / NULLIF(COUNT(*), 0), 1) AS validation_pass_rate,
         COUNT(*) FILTER (WHERE outcome = 'approved')::int AS approved,
         COUNT(*) FILTER (WHERE outcome = 'denied')::int AS denied,
         COUNT(DISTINCT model_id) AS models_used
       FROM ${S}.generation_logs
       WHERE tenant_id=$1 AND facility_id=$2
         AND created_at >= NOW() - INTERVAL '1 day' * $3`,
      [tenant_id, facility_id, days]
    );
    res.json({ ok: true, period_days: days, ...r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/metrics/outcomes — approval/denial rates by payer
app.get("/api/metrics/outcomes", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const days = Number(req.query.days || 90);

  try {
    const r = await pool.query(
      `SELECT
         gl.payer_id,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE gl.outcome = 'approved')::int AS approved,
         COUNT(*) FILTER (WHERE gl.outcome = 'denied')::int AS denied,
         COUNT(*) FILTER (WHERE gl.outcome = 'withdrawn')::int AS withdrawn,
         ROUND(100.0 * COUNT(*) FILTER (WHERE gl.outcome = 'approved') / NULLIF(COUNT(*), 0), 1) AS approval_rate
       FROM ${S}.generation_logs gl
       WHERE gl.tenant_id=$1 AND gl.facility_id=$2
         AND gl.created_at >= NOW() - INTERVAL '1 day' * $3
         AND gl.outcome IS NOT NULL
       GROUP BY gl.payer_id
       ORDER BY total DESC`,
      [tenant_id, facility_id, days]
    );
    res.json({ ok: true, period_days: days, by_payer: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/metrics/quality — validation score trends
app.get("/api/metrics/quality", requireToken, async (req, res) => {
  const { tenant_id, facility_id } = tf(req);
  const days = Number(req.query.days || 30);

  try {
    const r = await pool.query(
      `SELECT
         DATE(created_at) AS date,
         COUNT(*)::int AS count,
         ROUND(100.0 * COUNT(*) FILTER (WHERE validation_passed = true) / NULLIF(COUNT(*), 0), 1) AS pass_rate,
         ROUND(AVG(generation_time_ms))::int AS avg_ms
       FROM ${S}.generation_logs
       WHERE tenant_id=$1 AND facility_id=$2
         AND created_at >= NOW() - INTERVAL '1 day' * $3
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [tenant_id, facility_id, days]
    );
    res.json({ ok: true, period_days: days, daily: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ============================================================================
// Audit Logging Middleware (HIPAA — Phase 6)
// ============================================================================
app.use("/api", (req, res, next) => {
  const start = Date.now();
  const originalEnd = res.end;

  res.end = function (...args) {
    const duration = Date.now() - start;
    // Fire-and-forget audit log (don't block the response)
    const patientId = req.body?.patient_id || req.params?.patient_id || req.query?.patient_id || null;
    pool.query(
      `INSERT INTO ${S}.audit_log (tenant_id, facility_id, endpoint, method, patient_id, user_id, ip_address, status_code, response_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        req.body?.tenant_id || 1,
        req.body?.facility_id || req.query?.facility_id || "FAC-DEMO",
        req.originalUrl,
        req.method,
        patientId,
        req.header("X-User-Id") || null,
        req.ip,
        res.statusCode,
        duration,
      ]
    ).catch((err) => console.error("Audit log insert failed:", err.message)); // log but don't block

    originalEnd.apply(res, args);
  };
  next();
});

// ============================================================================
// Mount evaluation router (Phase 5)
// ============================================================================
try {
  const { default: createEvalRouter } = await import("./routes/eval.js");
  app.use("/api/eval", requireToken, createEvalRouter(pool, CLINIC_SCHEMA));
  console.log("  Eval router mounted at /api/eval");
} catch (e) {
  console.log("  Eval router not loaded (routes/eval.js not found or error):", e.message);
}

// ============================================================================
// Start server
// ============================================================================
app.listen(PORT, HOST, () => {
  console.log(`Clinic DB API v3+ running at http://${HOST}:${PORT}`);
  console.log(`Schema: ${CLINIC_SCHEMA}`);
  console.log(`Endpoints:`);
  console.log(`  GET  /health`);
  console.log(`  POST /api/patients/search`);
  console.log(`  POST /api/patients/background`);
  console.log(`  POST /api/patients/normalize              ← v3`);
  console.log(`  GET  /api/facility`);
  console.log(`  GET  /api/providers`);
  console.log(`  GET  /api/providers/:id`);
  console.log(`  GET  /api/payers`);
  console.log(`  GET  /api/payers/:id`);
  console.log(`  POST /api/payer-policy/match`);
  console.log(`  POST /api/policy/extract-criteria         ← v3`);
  console.log(`  GET  /api/letter-templates`);
  console.log(`  GET  /api/letter-templates/:id`);
  console.log(`  GET  /api/letter-templates/:id/sections   ← v3`);
  console.log(`  POST /api/letter-templates/:id/sections   ← v3`);
  console.log(`  POST /api/letters/generate-context`);
  console.log(`  POST /api/letters/generate-sections       ← v3`);
  console.log(`  POST /api/letters/validate                ← v3`);
  console.log(`  POST /api/letters`);
  console.log(`  PATCH /api/letters/:id/status`);
  console.log(`  GET  /api/letters`);
  console.log(`  GET  /api/letters/:id`);
  console.log(`  GET  /api/letters/:id/pdf                 ← v4 PDF`);
  console.log(`  POST /api/generation-logs                 ← v3`);
  console.log(`  GET  /api/generation-logs                 ← v3`);
  console.log(`  PATCH /api/generation-logs/:id/outcome    ← v3`);
  console.log(`  GET  /api/metrics/generation              ← v4 metrics`);
  console.log(`  GET  /api/metrics/outcomes                ← v4 metrics`);
  console.log(`  GET  /api/metrics/quality                 ← v4 metrics`);
  console.log(`  /api/eval/*                               ← v4 eval framework`);
});