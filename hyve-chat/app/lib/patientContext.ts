// app/lib/patientContext.ts
import { Storage } from "./storage";

export type ActivePatient = {
  tenant_id: number;
  facility_id: string;
  patient_id: string;       // local-only clinic identifier
  display_label: string;    // UI label (may be PHI; stays local)
  updated_at: string;
};

const KEY = "activePatient.v1";

export async function setActivePatient(input: {
  tenant_id: number;
  facility_id: string;
  patient_id: string;
  display_label: string;
}) {
  const payload: ActivePatient = {
    tenant_id: Number(input.tenant_id || 0),
    facility_id: String(input.facility_id || "").trim(),
    patient_id: String(input.patient_id || "").trim(),
    display_label: String(input.display_label || "").trim(),
    updated_at: new Date().toISOString(),
  };

  if (!payload.tenant_id) throw new Error("setActivePatient: tenant_id required");
  if (!payload.facility_id) throw new Error("setActivePatient: facility_id required");
  if (!payload.patient_id) throw new Error("setActivePatient: patient_id required");

  await Storage.setItem(KEY, JSON.stringify(payload));
  return payload;
}

export async function getActivePatient(): Promise<ActivePatient | null> {
  const raw = await Storage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ActivePatient;
    if (!parsed?.patient_id || !parsed?.facility_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearActivePatient() {
  await Storage.removeItem(KEY);
}
