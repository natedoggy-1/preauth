// app/lib/phiReinserter.ts

/**
 * PHI Reinserter
 * --------------
 * Reinserts PHI into de-identified letters/documents returned from the server.
 * 
 * This runs CLIENT-SIDE ONLY after receiving a template with placeholders.
 * Never sends PHI to the server.
 * 
 * Integrates with existing:
 * - PatientPHI from patientPHICache.ts
 * - LocalPHIDatabase from localDB.ts
 * - Storage facility config
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
  payer_name?: string | null;
  payer_key?: string | null;
  payer_phone?: string | null;
  payer_fax?: string | null;
  member_id?: string | null;
  group_id?: string | null;
  plan_name?: string | null;
  plan_type?: string | null;
};

export type RequestInfo = {
  service_key?: string | null;
  service_name?: string | null;
  cpt_codes?: string[];
  icd10_codes?: string[];
  requested_units?: number | null;
  requested_dos?: string | null;
};

export type PHIReinsertionContext = {
  patient: PatientPHI;
  facility?: FacilityInfo;
  coverage?: CoverageInfo;
  request?: RequestInfo;
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
    return d.toLocaleDateString("en-US", { 
      year: "numeric", 
      month: "long", 
      day: "numeric" 
    });
  }

  private formatPhone(phone: string | undefined | null): string {
    if (!phone) return "";
    const digits = String(phone).replace(/\D/g, "");
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11 && digits[0] === "1") {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return phone;
  }

  /**
   * Check if text contains placeholders that need filling
   */
  hasPlaceholders(text: string): boolean {
    const t = String(text || "");
    return (
      /\[MISSING:\s*[^\]]+\]/i.test(t) ||
      /\{\s*[a-zA-Z0-9_]+\s*\}/.test(t) ||
      /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(t)
    );
  }

  /**
   * Check if text looks like a letter/document that might need PHI
   */
  looksLikeDocument(text: string): boolean {
    const t = String(text || "");
    return (
      t.includes("To: Utilization Management") ||
      t.includes("PRIOR AUTHORIZATION") ||
      t.includes("Re: Patient") ||
      t.includes("Dear") ||
      t.includes("[MISSING:") ||
      this.hasPlaceholders(t)
    );
  }

  /**
   * Build the replacement map from PHI context
   */
  private buildReplacementMap(context: PHIReinsertionContext): Record<string, string> {
    const { patient, facility, coverage, request } = context;

    const today = new Date();
    const currentDate = today.toLocaleDateString("en-US");
    const dateLong = today.toLocaleDateString("en-US", { 
      year: "numeric", 
      month: "long", 
      day: "numeric" 
    });

    const replacements: Record<string, string> = {
      // Current date
      date: currentDate,
      current_date: currentDate,
      date_long: dateLong,
      today: dateLong,

      // Patient info
      patient_id: patient.patient_id || "",
      patient_full_name: patient.full_name || "",
      patient_first_name: patient.first_name || "",
      patient_last_name: patient.last_name || "",
      patient_name: patient.full_name || "",
      patient_dob: this.formatDate(patient.dob),
      patient_date_of_birth: this.formatDate(patient.dob),
      patient_sex: (patient.sex || "").toString().trim().toUpperCase(),
      patient_gender: (patient.sex || "").toString().trim().toUpperCase(),

      // Insurance/Coverage
      member_id: patient.insurance_member_id || coverage?.member_id || "",
      insurance_member_id: patient.insurance_member_id || coverage?.member_id || "",
      group_id: patient.insurance_group_number || coverage?.group_id || "",
      insurance_group_number: patient.insurance_group_number || coverage?.group_id || "",
      group_number: patient.insurance_group_number || coverage?.group_id || "",

      // Payer info
      payer_name: coverage?.payer_name || "",
      payer_phone: this.formatPhone(coverage?.payer_phone),
      payer_fax: this.formatPhone(coverage?.payer_fax),
      plan_name: coverage?.plan_name || "",
      plan_type: coverage?.plan_type || "",

      // Facility info
      facility_name: facility?.facility_name || "",
      facility_npi: facility?.facility_npi || "",
      facility_phone: this.formatPhone(facility?.facility_phone),
      facility_fax: this.formatPhone(facility?.facility_fax),
      facility_address: facility?.facility_address || "",
      facility_city: facility?.facility_city || "",
      facility_state: facility?.facility_state || "",
      facility_zip: facility?.facility_zip || "",

      // Request/Service info
      service_name: request?.service_name || "",
      service_key: request?.service_key || "",
      cpt_codes: (request?.cpt_codes || []).join(", "),
      icd10_codes: (request?.icd10_codes || []).join(", "),
      diagnosis_codes: (request?.icd10_codes || []).join(", "),
      requested_units: String(request?.requested_units || ""),
      requested_dos: this.formatDate(request?.requested_dos),
      date_of_service: this.formatDate(request?.requested_dos),
    };

    return replacements;
  }

  /**
   * Main method: Reinsert PHI into a template
   */
  reinsertPHI(templateText: string, context: PHIReinsertionContext): string {
    if (!this.hasPlaceholders(templateText)) {
      return templateText;
    }

    let result = String(templateText || "");
    const replacements = this.buildReplacementMap(context);

    // Replace all placeholder formats for each key
    for (const [key, rawVal] of Object.entries(replacements)) {
      const value = String(rawVal ?? "");

      // Format 1: {{key}}
      result = result.replace(
        new RegExp(`\\{\\{\\s*${this.escapeRegExp(key)}\\s*\\}\\}`, "gi"),
        value
      );

      // Format 2: {key}
      result = result.replace(
        new RegExp(`\\{\\s*${this.escapeRegExp(key)}\\s*\\}`, "gi"),
        value
      );

      // Format 3: [MISSING: key]
      result = result.replace(
        new RegExp(`\\[\\s*MISSING\\s*:\\s*${this.escapeRegExp(key)}\\s*\\]`, "gi"),
        value
      );
    }

    return result;
  }

  /**
   * Convenience method: Reinsert PHI into artifacts
   */
  reinsertIntoArtifacts(
    artifacts: Array<{ type?: string; content?: string; text?: string; [key: string]: any }>,
    context: PHIReinsertionContext
  ): Array<{ type?: string; content?: string; text?: string; [key: string]: any }> {
    return artifacts.map((artifact) => {
      const textField = artifact.content || artifact.text;
      if (!textField || !this.hasPlaceholders(textField)) {
        return artifact;
      }

      const reinserted = this.reinsertPHI(textField, context);

      return {
        ...artifact,
        content: artifact.content ? reinserted : artifact.content,
        text: artifact.text ? reinserted : artifact.text,
      };
    });
  }

  /**
   * Extract unfilled placeholders (for debugging/validation)
   */
  extractUnfilledPlaceholders(text: string): string[] {
    const placeholders = new Set<string>();

    // Match {key}
    const singleBraceMatches = text.matchAll(/\{([a-zA-Z0-9_]+)\}/g);
    for (const match of singleBraceMatches) {
      placeholders.add(match[1]);
    }

    // Match {{key}}
    const doubleBraceMatches = text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g);
    for (const match of doubleBraceMatches) {
      placeholders.add(match[1]);
    }

    // Match [MISSING: key]
    const missingMatches = text.matchAll(/\[MISSING:\s*([^\]]+)\]/gi);
    for (const match of missingMatches) {
      placeholders.add(match[1].trim());
    }

    return Array.from(placeholders);
  }

  /**
   * Validate that all required PHI fields are present
   */
  validateContext(context: PHIReinsertionContext): { valid: boolean; missing: string[] } {
    const missing: string[] = [];

    if (!context.patient?.patient_id) {
      missing.push("patient.patient_id");
    }
    if (!context.patient?.full_name && !context.patient?.first_name) {
      missing.push("patient.full_name or patient.first_name");
    }

    return {
      valid: missing.length === 0,
      missing,
    };
  }
}

// Singleton instance for convenience
export const phiReinserter = new PHIReinserter();