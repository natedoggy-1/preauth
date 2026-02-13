// app/lib/patientPHICache.ts
import { Storage, Keys } from "./storage";

export type PatientPHI = {
  patient_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  dob?: string;
  sex?: string | null;
  insurance_member_id?: string | null;
  insurance_group_number?: string | null;
  // contact info for letter reinsertion
  phone?: string | null;
  address?: string | null;
  // ✅ NEW: linked IDs for generate-context calls
  coverage_id?: string | null;
  payer_id?: string | null;
  provider_id?: string | null;
};

function phiKey(patient_id: string) {
  return `${Keys.patientPhiPrefix}${patient_id}`;
}

export async function savePatientPHI(phi: PatientPHI) {
  if (!phi?.patient_id) return;
  await Storage.setItem(phiKey(phi.patient_id), JSON.stringify(phi));
}

export async function loadPatientPHI(patient_id: string): Promise<PatientPHI | null> {
  if (!patient_id) return null;
  const raw = await Storage.getItem(phiKey(patient_id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PatientPHI;
  } catch {
    return null;
  }
}

export async function clearPatientPHI(patient_id: string) {
  if (!patient_id) return;
  await Storage.removeItem(phiKey(patient_id));
}