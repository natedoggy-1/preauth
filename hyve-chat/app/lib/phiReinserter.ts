// app/lib/phiReinserter.ts

/**
 * PHI Reinserter v2
 * -----------------
 * Reinserts PHI into de-identified letters/documents returned from the server.
 * This runs CLIENT-SIDE ONLY after receiving a template with placeholders.
 * Never sends PHI to the server.
 *
 * v2 additions:
 * - Provider info (name, credentials, NPI, specialty, signature)
 * - Payer address, fax line
 * - Appeal fields (denial reason, denial code, denial date, appeal deadline)
 * - Encounter summaries
 * - Med trial summaries
 * - Letter date, urgency fields
 */

import type { PatientPHI } from "./patientPHICache";

export type FacilityInfo = {
  facility_id?: string;
  facility_name?: string;
  facility_npi?: string;
  facility_phone?: string;
  facility_fax?: string;
  facility_address?: string;
  facility_city?: string;
  facility_state?: string;
  facility_zip?: string;
};

export type CoverageInfo = {
  coverage_id?: string | null;
  payer_name?: string | null;
  payer_key?: string | null;
  payer_phone?: string | null;
  payer_fax?: string | null;
  payer_address?: string | null;
  member_id?: string | null;
  group_id?: string | null;
  plan_name?: string | null;
  plan_type?: string | null;
};

// ✅ NEW
export type ProviderInfo = {
  provider_id?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  credentials?: string | null;
  specialty?: string | null;
  npi?: string | null;
  phone?: string | null;
  signature_name?: string | null;
};

export type RequestInfo = {
  request_id?: string | null;
  coverage_id?: string | null;
  service_key?: string | null;
  service_name?: string | null;
  cpt_codes?: string[];
  cpt_code?: string | null;
  cpt_description?: string | null;
  icd10_codes?: string[];
  icd10_code?: string | null;
  icd10_description?: string | null;
  clinical_question?: string | null;
  requested_units?: number | null;
  requested_dos?: string | null;
  priority?: string | null;
  medical_necessity_summary?: string | null;
};

export type ProblemInfo = {
  icd10_code?: string;
  description?: string | null;
  onset_date?: string | null;
};

export type TherapyInfo = {
  therapy_type?: string;
  weeks?: number | null;
  details?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  total_visits?: number | null;
  response?: string | null;
  therapy_item?: string | null;
};

export type ImagingInfo = {
  modality?: string;
  body_part?: string | null;
  findings?: string[] | string | null;
  impression?: string | null;
  study_date?: string | null;
  imaging_date?: string | null;
  item?: string | null;
};

// ✅ NEW
export type EncounterInfo = {
  encounter_date?: string | null;
  summary?: string | null;
  provider_name?: string | null;
};

// ✅ NEW
export type MedTrialInfo = {
  medication?: string | null;
  dose?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  outcome?: string | null;
};

// ✅ NEW
export type ParentLetterInfo = {
  denial_reason?: string | null;
  denial_code?: string | null;
  denial_date?: string | null;
  response_date?: string | null;
  appeal_deadline?: string | null;
  auth_number?: string | null;
  letter_type?: string | null;
};

export type PHIReinsertionContext = {
  patient: PatientPHI;
  facility?: FacilityInfo;
  coverage?: CoverageInfo;
  request?: RequestInfo;
  // ✅ NEW
  provider?: ProviderInfo;
  parent_letter?: ParentLetterInfo;
  // Clinical data
  problems?: ProblemInfo[];
  therapies?: TherapyInfo[];
  imaging?: ImagingInfo[];
  encounters?: EncounterInfo[];
  med_trials?: MedTrialInfo[];
  // Multiple support
  requests?: RequestInfo[];
  coverage_all?: CoverageInfo[];
};

export class PHIReinserter {
  private escapeRegExp(s: string): string {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private formatDate(dateString: string | undefined | null): string {
    if (!dateString) return "";
    const s = String(dateString).trim();
    if (!s) return "";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  private formatDateShort(dateString: string | undefined | null): string {
    if (!dateString) return "";
    const s = String(dateString).trim();
    if (!s) return "";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString("en-US");
  }

  private formatPhone(phone: string | undefined | null): string {
    if (!phone) return "";
    const digits = String(phone).replace(/\D/g, "");
    if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length === 11 && digits[0] === "1") return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    return phone;
  }

  private calcAge(dob: string | undefined | null): string {
    if (!dob) return "";
    const d = new Date(String(dob));
    if (Number.isNaN(d.getTime())) return "";
    const ageDiffMs = Date.now() - d.getTime();
    const ageDate = new Date(ageDiffMs);
    return String(Math.abs(ageDate.getUTCFullYear() - 1970));
  }

  hasPlaceholders(text: string): boolean {
    const t = String(text || "");
    return (
      /\[MISSING:\s*[^\]]+\]/i.test(t) ||
      /\{\s*[a-zA-Z0-9_]+\s*\}/.test(t) ||
      /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(t)
    );
  }

  looksLikeDocument(text: string): boolean {
    const t = String(text || "");
    return (
      t.includes("To: Utilization Management") ||
      t.includes("PRIOR AUTHORIZATION") ||
      t.includes("Re: Patient") ||
      t.includes("Dear") ||
      t.includes("[MISSING:") ||
      t.includes("Sincerely") ||
      this.hasPlaceholders(t)
    );
  }

  private buildReplacementMap(context: PHIReinsertionContext): Record<string, string> {
    const { patient, facility, coverage, request, provider, parent_letter,
            problems, therapies, imaging, encounters, med_trials, requests } = context;

    const today = new Date();
    const currentDate = today.toLocaleDateString("en-US");
    const dateLong = today.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    const primaryRequest = request || (Array.isArray(requests) && requests.length ? requests[0] : null);

    const replacements: Record<string, string> = {
      // ──────────── Dates ────────────
      date: currentDate,
      current_date: currentDate,
      date_long: dateLong,
      today: dateLong,
      letter_date: dateLong,

      // ──────────── Patient ────────────
      patient_id: patient.patient_id || "",
      patient_full_name: patient.full_name || "",
      patient_first_name: patient.first_name || "",
      patient_last_name: patient.last_name || "",
      patient_name: patient.full_name || "",
      patient_dob: this.formatDate(patient.dob),
      patient_dob_short: this.formatDateShort(patient.dob),
      patient_date_of_birth: this.formatDate(patient.dob),
      dob: this.formatDate(patient.dob),
      date_of_birth: this.formatDate(patient.dob),
      patient_sex: (patient.sex || "").toString().trim(),
      patient_gender: (patient.sex || "").toString().trim(),
      sex: (patient.sex || "").toString().trim(),
      gender: (patient.sex || "").toString().trim(),
      patient_age: this.calcAge(patient.dob),

      // Patient contact
      patient_phone: this.formatPhone((patient as any).phone),
      patient_address: String((patient as any).address || "").trim(),
      phone: this.formatPhone((patient as any).phone),
      address: String((patient as any).address || "").trim(),

      // ──────────── Coverage / Insurance ────────────
      member_id: patient.insurance_member_id || coverage?.member_id || "",
      insurance_member_id: patient.insurance_member_id || coverage?.member_id || "",
      group_id: patient.insurance_group_number || coverage?.group_id || "",
      insurance_group_number: patient.insurance_group_number || coverage?.group_id || "",
      group_number: patient.insurance_group_number || coverage?.group_id || "",
      coverage_id: coverage?.coverage_id || "",

      // ──────────── Payer ────────────
      payer_name: coverage?.payer_name || "",
      payer_key: coverage?.payer_key || "",
      payer_phone: this.formatPhone(coverage?.payer_phone),
      payer_fax: this.formatPhone(coverage?.payer_fax),
      payer_fax_line: coverage?.payer_fax ? `Fax: ${this.formatPhone(coverage.payer_fax)}` : "",
      payer_address: coverage?.payer_address || "",
      plan_name: coverage?.plan_name || "",
      plan_type: coverage?.plan_type || "",

      // ──────────── Facility ────────────
      facility_id: facility?.facility_id || "",
      facility_name: facility?.facility_name || "",
      facility_npi: facility?.facility_npi || "",
      facility_phone: this.formatPhone(facility?.facility_phone),
      facility_fax: this.formatPhone(facility?.facility_fax),
      facility_address: facility?.facility_address || "",
      facility_city: facility?.facility_city || "",
      facility_state: facility?.facility_state || "",
      facility_zip: facility?.facility_zip || "",
      facility_full_address: [
        facility?.facility_address,
        facility?.facility_city,
        facility?.facility_state
          ? `${facility.facility_state} ${facility?.facility_zip || ""}`.trim()
          : facility?.facility_zip,
      ].filter(Boolean).join(", "),

      // ──────────── ✅ NEW: Provider ────────────
      provider_name: provider?.name || provider?.signature_name || "",
      provider_first_name: provider?.first_name || "",
      provider_last_name: provider?.last_name || "",
      provider_credentials: provider?.credentials || "",
      provider_specialty: provider?.specialty || "",
      provider_npi: provider?.npi || "",
      provider_phone: this.formatPhone(provider?.phone),
      signature_name: provider?.signature_name || provider?.name || "",
      signature_line: provider?.signature_name || provider?.name || "",

      // ──────────── Request / Service ────────────
      service_name: primaryRequest?.service_name || "",
      service_key: primaryRequest?.service_key || "",
      request_id: primaryRequest?.request_id || "",
      priority: primaryRequest?.priority || "standard",

      cpt_codes: (primaryRequest?.cpt_codes || (primaryRequest?.cpt_code ? [primaryRequest.cpt_code] : [])).join(", "),
      cpt_code: primaryRequest?.cpt_code || (primaryRequest?.cpt_codes || [])[0] || "",
      cpt_description: primaryRequest?.cpt_description || "",

      icd10_codes: (primaryRequest?.icd10_codes || (primaryRequest?.icd10_code ? [primaryRequest.icd10_code] : [])).join(", "),
      icd10_code: primaryRequest?.icd10_code || (primaryRequest?.icd10_codes || [])[0] || "",
      diagnosis_codes: (primaryRequest?.icd10_codes || (primaryRequest?.icd10_code ? [primaryRequest.icd10_code] : [])).join(", "),
      icd10_description: primaryRequest?.icd10_description || "",
      diagnosis_description: primaryRequest?.icd10_description || "",

      clinical_question: primaryRequest?.clinical_question || "",
      medical_necessity_summary: primaryRequest?.medical_necessity_summary || "",

      requested_units: String(primaryRequest?.requested_units || ""),
      requested_dos: this.formatDate(primaryRequest?.requested_dos),
      requested_dos_short: this.formatDateShort(primaryRequest?.requested_dos),
      date_of_service: this.formatDate(primaryRequest?.requested_dos),
      dos: this.formatDateShort(primaryRequest?.requested_dos),

      // ──────────── Problems / Diagnoses ────────────
      diagnoses_list: (problems || [])
        .map((p) => `${p.icd10_code || ""} — ${p.description || ""}`.trim().replace(/^— /, ""))
        .filter(Boolean)
        .map((line, i) => `${i + 1}. ${line}`)
        .join("\n"),
      all_diagnoses: (problems || [])
        .map((p) => [p.icd10_code, p.description].filter(Boolean).join(" — "))
        .filter(Boolean)
        .join("; "),
      diagnosis_list: (problems || [])
        .map((p) => [p.icd10_code, p.description].filter(Boolean).join(" — "))
        .filter(Boolean)
        .join("\n"),
      primary_diagnosis: (() => {
        const first = (problems || [])[0];
        if (!first) return "";
        return [first.icd10_code, first.description].filter(Boolean).join(" — ");
      })(),

      // ──────────── Therapies / Conservative Treatment ────────────
      failed_therapies: (therapies || [])
        .map((t, i) => {
          const parts = [t.therapy_type];
          if (t.start_date && t.end_date) parts.push(`(${this.formatDateShort(t.start_date)} – ${this.formatDateShort(t.end_date)})`);
          if (t.total_visits) parts.push(`${t.total_visits} visits`);
          if (t.response) parts.push(`— ${t.response}`);
          return `${i + 1}. ${parts.filter(Boolean).join(" ")}`;
        })
        .filter(Boolean)
        .join("\n"),
      therapy_summary: (therapies || [])
        .map((t) => {
          const parts = [t.therapy_type];
          if (t.total_visits) parts.push(`${t.total_visits} visits`);
          if (t.response) parts.push(t.response);
          return parts.filter(Boolean).join(": ");
        })
        .filter(Boolean)
        .join("; "),
      therapy_list: (therapies || [])
        .map((t) => {
          const parts = [t.therapy_type];
          if (t.total_visits) parts.push(`${t.total_visits} visits`);
          if (t.response) parts.push(t.response);
          return parts.filter(Boolean).join(": ");
        })
        .filter(Boolean)
        .join("\n"),

      // ──────────── ✅ NEW: Medication trials ────────────
      medication_trials: (med_trials || [])
        .map((m, i) => {
          const parts = [`${m.medication || "Unknown"}`];
          if (m.dose) parts.push(m.dose);
          if (m.start_date && m.end_date) parts.push(`(${this.formatDateShort(m.start_date)} – ${this.formatDateShort(m.end_date)})`);
          else if (m.start_date) parts.push(`(started ${this.formatDateShort(m.start_date)})`);
          if (m.outcome) parts.push(`— ${m.outcome}`);
          return `${i + 1}. ${parts.filter(Boolean).join(" ")}`;
        })
        .filter(Boolean)
        .join("\n"),

      // ──────────── Imaging ────────────
      imaging_findings: (imaging || [])
        .map((im, i) => {
          const parts = [`${im.modality || ""} ${im.body_part || ""}`.trim()];
          if (im.imaging_date || im.study_date) parts.push(`(${this.formatDateShort(im.imaging_date || im.study_date)})`);
          const findings = Array.isArray(im.findings)
            ? im.findings.join("; ")
            : typeof im.findings === "string" ? im.findings : "";
          if (findings) parts.push(`— ${findings}`);
          if (im.impression && im.impression !== findings) parts.push(`— ${im.impression}`);
          return `${i + 1}. ${parts.filter(Boolean).join(" ")}`;
        })
        .filter(Boolean)
        .join("\n"),
      imaging_summary: (imaging || [])
        .map((im) => {
          const parts = [im.modality];
          if (im.body_part) parts.push(im.body_part);
          if (im.impression) parts.push(im.impression);
          return parts.filter(Boolean).join(" — ");
        })
        .filter(Boolean)
        .join("; "),
      imaging_date: this.formatDate((imaging || [])[0]?.study_date || (imaging || [])[0]?.imaging_date),

      // ──────────── ✅ NEW: Encounter summaries ────────────
      encounter_summary: (encounters || [])
        .map((e, i) => {
          const parts = [];
          if (e.encounter_date) parts.push(`[${this.formatDateShort(e.encounter_date)}]`);
          if (e.provider_name) parts.push(`(${e.provider_name})`);
          if (e.summary) parts.push(e.summary);
          return parts.filter(Boolean).join(" ");
        })
        .filter(Boolean)
        .join("\n\n"),

      // ──────────── ✅ NEW: Appeal / denial fields ────────────
      denial_reason: parent_letter?.denial_reason || "",
      denial_code: parent_letter?.denial_code || "",
      denial_date: this.formatDate(parent_letter?.denial_date || parent_letter?.response_date),
      denial_reference: parent_letter?.denial_code || "",
      appeal_deadline: this.formatDate(parent_letter?.appeal_deadline),
      auth_number: parent_letter?.auth_number || "",

      // Placeholders the LLM fills (these are hints, not auto-filled):
      // denial_rebuttal, criteria_alignment_detail, patient_impact, enclosed_documents,
      // urgency_justification, urgency_statement, clinical_criteria_reference, urgent_turnaround
    };

    return replacements;
  }

  reinsertPHI(templateText: string, context: PHIReinsertionContext): string {
    if (!this.hasPlaceholders(templateText)) return templateText;

    let result = String(templateText || "");
    const replacements = this.buildReplacementMap(context);

    for (const [key, rawVal] of Object.entries(replacements)) {
      const value = String(rawVal ?? "");

      // {{key}}
      result = result.replace(
        new RegExp(`\\{\\{\\s*${this.escapeRegExp(key)}\\s*\\}\\}`, "gi"),
        value
      );
      // {key}
      result = result.replace(
        new RegExp(`\\{\\s*${this.escapeRegExp(key)}\\s*\\}`, "gi"),
        value
      );
      // [MISSING: key]
      result = result.replace(
        new RegExp(`\\[\\s*MISSING\\s*:\\s*${this.escapeRegExp(key)}\\s*\\]`, "gi"),
        value
      );
    }

    return result;
  }

  reinsertIntoArtifacts(
    artifacts: Array<{ type?: string; content?: string; text?: string; [key: string]: any }>,
    context: PHIReinsertionContext
  ): Array<{ type?: string; content?: string; text?: string; [key: string]: any }> {
    return artifacts.map((artifact) => {
      const textField = artifact.content || artifact.text;
      if (!textField || !this.hasPlaceholders(textField)) return artifact;
      const reinserted = this.reinsertPHI(textField, context);
      return {
        ...artifact,
        content: artifact.content ? reinserted : artifact.content,
        text: artifact.text ? reinserted : artifact.text,
      };
    });
  }

  extractUnfilledPlaceholders(text: string): string[] {
    const placeholders = new Set<string>();
    for (const match of text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) placeholders.add(match[1]);
    for (const match of text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)) placeholders.add(match[1]);
    for (const match of text.matchAll(/\[MISSING:\s*([^\]]+)\]/gi)) placeholders.add(match[1].trim());
    return Array.from(placeholders);
  }

  validateContext(context: PHIReinsertionContext): { valid: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!context.patient?.patient_id) missing.push("patient.patient_id");
    if (!context.patient?.full_name && !context.patient?.first_name) missing.push("patient.full_name or patient.first_name");
    return { valid: missing.length === 0, missing };
  }
}

export const phiReinserter = new PHIReinserter();