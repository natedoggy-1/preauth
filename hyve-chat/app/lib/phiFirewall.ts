// app/lib/phiFirewall.ts

/**
 * PHI Firewall
 * ------------
 * Hard-stop guardrail to prevent PHI from being sent off-prem.
 *
 * Conservative, but designed to avoid false positives like "payer_name".
 * If blocked, throws: ERROR: PHI detected. Non-PHI packet required. (...)
 */

const FORBIDDEN_KEYS = new Set([
  // direct identifiers
  "first_name",
  "last_name",
  "full_name",
  "name",
  "dob",
  "date_of_birth",
  "address",
  "phone",
  "email",

  // member/account identifiers
  "member_id",
  "group_id",
  "subscriber_id",
  "account_id",

  // medical record identifiers
  "mrn",
  "medical_record_number",
  "medicalrecordnumber",
  "patient_id",

  // date fields that often show up in clinical background
  "study_date",
  "onset_date",
  "requested_dos",
  "date_of_service",
  "dos",
]);

function isPlainObject(x: any) {
  return x && typeof x === "object" && !Array.isArray(x);
}

const RX_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const RX_PHONE = /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const RX_DATE_YMD = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/; // 2026-02-11
const RX_DATE_MDY = /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/; // 2/11/2026
const RX_SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const RX_ZIP5 = /\b\d{5}(?:-\d{4})?\b/;
// long numeric identifiers (member IDs, account numbers)
const RX_LONG_ID = /\b\d{6,}\b/;

function looksLikePHIText(s: string) {
  const t = s.toLowerCase();

  // explicit label leaks
  if (
    t.includes("dob:") ||
    t.includes("date of birth") ||
    t.includes("mrn:") ||
    t.includes("member id") ||
    t.includes("member_id") ||
    t.includes("ssn:") ||
    t.includes("address:") ||
    t.includes("phone:")
  ) {
    return true;
  }

  // pattern-based detection
  if (RX_EMAIL.test(s)) return true;
  if (RX_PHONE.test(s)) return true;
  if (RX_SSN.test(s)) return true;
  if (RX_DATE_YMD.test(s)) return true;
  if (RX_DATE_MDY.test(s)) return true;
  if (RX_ZIP5.test(s)) return true;
  if (RX_LONG_ID.test(s)) return true;

  return false;
}

export function assertNoPHI(payload: any, opts?: { skipKeys?: Set<string> }) {
  const path: string[] = [];
  const skipKeys = opts?.skipKeys;

  const fail = (reason: string) => {
    throw new Error(`ERROR: PHI detected. Non-PHI packet required. (${reason})`);
  };

  const walk = (node: any) => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        path.push(`[${i}]`);
        walk(node[i]);
        path.pop();
      }
      return;
    }

    if (!isPlainObject(node)) return;

    for (const [k, v] of Object.entries(node)) {
      // skip top-level keys that contain admin-authored metadata, not PHI
      if (skipKeys && path.length === 0 && skipKeys.has(k)) continue;

      const keyLower = String(k).toLowerCase();

      if (FORBIDDEN_KEYS.has(keyLower)) {
        fail(`blocked key: ${[...path, k].join(".")}`);
      }

      // special: block any patient_ref that looks stable/linkable
      if (keyLower === "patient_ref" && typeof v === "string") {
        const vv = v.toUpperCase();
        if (vv.startsWith("LOCAL-") || vv.includes("PAT-") || vv.includes("MRN")) {
          fail(`blocked patient_ref: ${[...path, k].join(".")}`);
        }
      }

      if (typeof v === "string" && looksLikePHIText(v)) {
        fail(`blocked text at: ${[...path, k].join(".")}`);
      }

      path.push(k);
      walk(v);
      path.pop();
    }
  };

  walk(payload);
  return true;
}
