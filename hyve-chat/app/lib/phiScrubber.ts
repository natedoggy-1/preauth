// app/lib/phiScrubber.ts

/**
 * IMPORTANT:
 * - PHI stays local.
 * - This file produces a DE-IDENTIFIED clinical packet safe to send to your server.
 *
 * Allowed:
 * - age band (NOT DOB)
 * - ICD10/CPT codes
 * - therapy types + durations (no dates)
 * - imaging modality + de-identified short findings/summary (no dates)
 * - condition/symptom descriptions ONLY if sanitized + short
 *
 * Never include:
 * - name, DOB, address, phone, member_id, MRN, email, patient_id
 * - exact dates (study_date, onset_date, DOS, etc.)
 * - raw EMR notes
 */

export type LocalPHIBackground = {
  patient?: {
    patient_id?: string;
    first_name?: string;
    last_name?: string;
    full_name?: string;
    dob?: string;
    sex?: string;
    phone?: string;
    address?: string;
  };

  // legacy
  coverage?: {
    payer_name?: string;
    payer_key?: string;
    member_id?: string;
    group_id?: string;
    plan_name?: string;
  };

  // ✅ new
  coverage_primary?: {
    payer_name?: string;
    payer_key?: string;
    member_id?: string;
    group_id?: string;
    plan_name?: string;
  };

  coverage_all?: Array<{
    payer_name?: string;
    payer_key?: string;
    member_id?: string;
    group_id?: string;
    plan_name?: string;
  }>;

  // legacy
  request?: {
    cpt_code?: string | null;
    icd10_code?: string | null;
    clinical_question?: string | null;
    requested_units?: number | null;
    requested_dos?: string | null; // PHI - never send
  };

  // ✅ new
  requests?: Array<{
    cpt_code?: string | null;
    icd10_code?: string | null;
    clinical_question?: string | null;
    requested_units?: number | null;
    requested_dos?: string | null; // PHI - never send
  }>;

  problems?: Array<{ icd10_code?: string; description?: string }>;
  therapies?: Array<{ therapy_type?: string; weeks?: number; details?: string }>;
  imaging?: Array<{
    modality?: string;
    findings?: string[] | string | null | undefined;
    study_date?: string; // DO NOT SEND
  }>;

  // ✅ NEW: encounters (summaries only, dates stripped)
  encounters?: Array<{
    summary?: string;
    encounter_date?: string; // DO NOT SEND
    provider_name?: string; // DO NOT SEND (PHI-adjacent)
  }>;

  // ✅ NEW: med_trials
  med_trials?: Array<{
    medication?: string;
    dose?: string;
    outcome?: string;
    start_date?: string; // DO NOT SEND
    end_date?: string;   // DO NOT SEND
  }>;
};

export type DeidentifiedClinicalPacket = {
  facility_id: string;
  case_id: string;

  patient: {
    patient_ref: string;
    age_band: string | null;
    sex: string | null;
  };

  coverage: {
    payer_key: string | null;
    plan_type: string | null;
  };

  request: {
    service_key: string | null;
    cpt: string[];
    diagnoses: string[];
    requested_units: number | null;
  };

  clinical: {
    summaries: string[];

    conservative_tx: {
      pt_weeks: number | null;
      nsaids_weeks: number | null;
      injections: string[];
      activity_modification: boolean | null;
      other: Array<{ type: string; weeks: number | null }>;
    };

    imaging: {
      has_imaging: boolean;
      modalities: string[];
      findings: string[];
    };

    // ✅ NEW: encounter summaries (de-identified)
    encounter_summaries: string[];

    // ✅ NEW: medication trial summaries (de-identified)
    med_trial_summaries: string[];
  };

  audit: {
    phi_removed: true;
    generated_at: string;
    generator_version: string;
  };
};

function normKey(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s.toLowerCase() : "";
}

function ageBandFromDob(dob?: string): string | null {
  if (!dob) return null;
  const year = parseInt(String(dob).split("-")[0], 10);
  if (!Number.isFinite(year)) return null;

  const age = new Date().getFullYear() - year;
  if (!Number.isFinite(age) || age < 0) return null;

  if (age <= 17) return "0-17";
  if (age <= 24) return "18-24";
  if (age <= 34) return "25-34";
  if (age <= 44) return "35-44";
  if (age <= 54) return "45-54";
  if (age <= 64) return "55-64";
  if (age <= 74) return "65-74";
  return "75+";
}

function uniqStrings(xs: string[]) {
  return Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string") return [v].filter(Boolean);
  return [];
}

/** --------- Sanitization helpers (de-identification) --------- **/

const RX_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const RX_PHONE = /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const RX_DATE_YMD = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g;
const RX_DATE_MDY = /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g;
const RX_TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const RX_SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const RX_ZIP5 = /\b\d{5}(?:-\d{4})?\b/g;
const RX_LONG_ID = /\b\d{6,}\b/g;

function sanitizeFreeText(input: unknown, opts?: { maxLen?: number }): string {
  const maxLen = opts?.maxLen ?? 160;
  let s = String(input ?? "").trim();
  if (!s) return "";

  s = s.replace(RX_EMAIL, "[redacted]");
  s = s.replace(RX_PHONE, "[redacted]");
  s = s.replace(RX_SSN, "[redacted]");
  s = s.replace(RX_DATE_YMD, "[redacted-date]");
  s = s.replace(RX_DATE_MDY, "[redacted-date]");
  s = s.replace(RX_TIME, "[redacted-time]");
  s = s.replace(RX_ZIP5, "[redacted]");
  s = s.replace(RX_LONG_ID, "[redacted]");

  const lower = s.toLowerCase();
  if (
    lower.includes("dob") ||
    lower.includes("date of birth") ||
    lower.includes("mrn") ||
    lower.includes("member id") ||
    lower.includes("member_id") ||
    lower.includes("address") ||
    lower.includes("phone") ||
    lower.includes("ssn")
  ) {
    return "";
  }

  s = s.replace(/\s+/g, " ").trim();
  if (s.length > maxLen) s = s.slice(0, maxLen - 1).trimEnd() + "…";
  return s;
}

function normalizeTherapyType(t: unknown): string {
  const s = String(t ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "pt" || s.includes("physical")) return "pt";
  if (s.includes("nsaid")) return "nsaids";
  if (s.includes("inject")) return "injection";
  if (s.includes("activity")) return "activity_mod";
  return s.replace(/[^\w\-]+/g, "_");
}

function pickCoverage(background: LocalPHIBackground) {
  return background.coverage_primary ?? background.coverage ?? null;
}

function pickRequest(background: LocalPHIBackground) {
  const first = Array.isArray(background.requests) && background.requests.length ? background.requests[0] : null;
  return first ?? background.request ?? null;
}

/**
 * Convert local PHI background -> de-identified clinical packet.
 */
export function toNonPHICasePacket(args: {
  facility_id: string;
  background: LocalPHIBackground;
  service_key?: string | null;
  payer_key?: string | null;
  requested_units?: number | null;
}): DeidentifiedClinicalPacket {
  const { facility_id, background, service_key, payer_key, requested_units } = args;

  const case_id = `case_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const patient_ref = `CASEONLY-${case_id}`;

  const coverage = pickCoverage(background);
  const req = pickRequest(background);

  // Diagnoses: from problems + request.icd10_code (if present)
  const dxFromProblems = (background.problems ?? [])
    .map((p) => String(p.icd10_code ?? "").trim())
    .filter(Boolean);

  const dxFromRequest = req?.icd10_code ? [String(req.icd10_code).trim()] : [];

  const diagnoses = uniqStrings([...dxFromProblems, ...dxFromRequest]);

  // CPT: from request.cpt_code (if present)
  const cpt = uniqStrings(req?.cpt_code ? [String(req.cpt_code).trim()] : []).filter(Boolean);

  // Requested units: prefer explicit args, else from request
  const reqUnits =
    typeof requested_units === "number"
      ? requested_units
      : typeof (req as any)?.requested_units === "number"
      ? (req as any).requested_units
      : null;

  // Controlled summaries from problems + therapies + imaging + (optional) clinical_question sanitized
  const problemSummaries = uniqStrings(
    (background.problems ?? [])
      .map((p) => sanitizeFreeText((p as any).description, { maxLen: 120 }))
      .filter(Boolean)
  ).slice(0, 8);

  const clinicalQuestion = sanitizeFreeText(req?.clinical_question, { maxLen: 140 });
  const questionSummary = clinicalQuestion ? [`Clinical question: ${clinicalQuestion}`] : [];

  const therapies = Array.isArray(background.therapies) ? background.therapies : [];
  const normalizedTherapies = therapies
    .map((t) => ({
      type: normalizeTherapyType((t as any).therapy_type),
      weeks: typeof (t as any).weeks === "number" ? (t as any).weeks : null,
      details: sanitizeFreeText((t as any).details, { maxLen: 120 }),
    }))
    .filter((t) => t.type);

  const pt_weeks = normalizedTherapies.find((t) => t.type === "pt")?.weeks ?? null;
  const nsaids_weeks = normalizedTherapies.find((t) => t.type === "nsaids")?.weeks ?? null;

  const injections = normalizedTherapies.filter((t) => t.type === "injection").map(() => "injection");

  const activity_modification = normalizedTherapies.some((t) => t.type === "activity_mod") ? true : null;

  const other = normalizedTherapies
    .filter((t) => !["pt", "nsaids", "injection", "activity_mod"].includes(t.type))
    .slice(0, 10)
    .map((t) => ({ type: t.type, weeks: t.weeks }));

  const imaging = Array.isArray(background.imaging) ? background.imaging : [];
  const modalities = uniqStrings(imaging.map((i) => String((i as any).modality ?? "").trim()).filter(Boolean));

  const rawFindings = imaging.flatMap((i) => asStringArray((i as any)?.findings));
  const findings = uniqStrings(rawFindings.map((f) => sanitizeFreeText(f, { maxLen: 140 })).filter(Boolean)).slice(0, 12);

  const therapySummaries = uniqStrings(normalizedTherapies.map((t) => t.details).filter(Boolean)).slice(0, 8);

  const summaries = uniqStrings([...problemSummaries, ...therapySummaries, ...findings, ...questionSummary]).slice(0, 12);

  // ✅ NEW: De-identify encounter summaries
  const encounters = Array.isArray(background.encounters) ? background.encounters : [];
  const encounterSummaries = encounters
    .map((e) => sanitizeFreeText((e as any)?.summary, { maxLen: 200 }))
    .filter(Boolean)
    .slice(0, 10);

  // ✅ NEW: De-identify med trial summaries
  const medTrials = Array.isArray(background.med_trials) ? background.med_trials : [];
  const medTrialSummaries = medTrials
    .map((m) => {
      const med = String((m as any)?.medication ?? "").trim();
      const dose = String((m as any)?.dose ?? "").trim();
      const outcome = sanitizeFreeText((m as any)?.outcome, { maxLen: 120 });
      if (!med) return "";
      const parts = [med];
      if (dose) parts.push(dose);
      if (outcome) parts.push(`→ ${outcome}`);
      return parts.join(" ");
    })
    .filter(Boolean)
    .slice(0, 10);

  return {
    facility_id,
    case_id,
    patient: {
      patient_ref,
      age_band: ageBandFromDob(background.patient?.dob),
      sex: background.patient?.sex ? String(background.patient.sex).trim() : null,
    },
    coverage: {
      payer_key: payer_key
        ? normKey(payer_key)
        : coverage?.payer_key
        ? normKey(coverage.payer_key)
        : null,
      plan_type: null,
    },
    request: {
      service_key: service_key ? normKey(service_key) : null,
      cpt,
      diagnoses,
      requested_units: reqUnits,
    },
    clinical: {
      summaries,
      conservative_tx: {
        pt_weeks,
        nsaids_weeks,
        injections,
        activity_modification,
        other,
      },
      imaging: {
        has_imaging: imaging.length > 0,
        modalities,
        findings,
      },
      encounter_summaries: encounterSummaries,
      med_trial_summaries: medTrialSummaries,
    },
    audit: {
      phi_removed: true,
      generated_at: new Date().toISOString(),
      generator_version: "phi-scrubber-2.1",
    },
  };
}