// app/lib/api.ts
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import { assertNoPHI } from "./phiFirewall";

export type Config = { baseUrl: string; apiKey: string; facilityId: string };

/**
 * Matches server-side doc_role values.
 */
export type DocRole = "doc" | "policy" | "template";

export type ChatKeys = {
  payer_key?: string | null;
  service_key?: string | null;
  template_key?: string | null;
  policy_key?: string | null;
};

export type NonPhiIntent =
  | "medical_necessity_summary"
  | "generate_preauth_letter"
  | "letter_revise"
  | "criteria_checklist";

// ✅ NEW: letter types matching DB schema
export type LetterType = "initial_auth" | "peer_to_peer" | "appeal" | "urgent_auth";

export type NonPhiChatInput = {
  ctx: {
    tenant_id: number;
    facility_id: string;
    thread_id: string;
    case_id: string;
  };
  intent: NonPhiIntent;
  message: string;
  non_phi_packet: any;
  file_ids?: string[];
  keys?: ChatKeys;
};

// --------------------
// Utils
// --------------------
function normKey(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s.toLowerCase() : "";
}

function cleanBaseUrl(u: string) {
  return String(u || "").trim().replace(/\/$/, "");
}

function safeFilename(name: string) {
  return String(name || "preauth.pdf").replace(/[^\w.\- ]+/g, "_");
}

async function parseJsonOrText(text: string) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch { return t; }
}

async function saveBlobToLocalFile(blob: Blob, filename: string) {
  const localUri = (FileSystem.documentDirectory || "") + safeFilename(filename);
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = globalThis.btoa(binary);
  await FileSystem.writeAsStringAsync(localUri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return localUri;
}

// ===============================
// Debug logging (safe / non-PHI)
// ===============================
function clinicDebugEnabled() {
  return String(process.env.EXPO_PUBLIC_LOG_LEVEL || "").toLowerCase() === "debug";
}
function safeLog(label: string, data: any) {
  if (!clinicDebugEnabled()) return;
  try { console.log(label, data); } catch {}
}

// ===============================
// Webhook output normalization
// ===============================
function extractAssistantText(out: any): string {
  if (out == null) return "";
  if (typeof out === "string") return out;
  if (typeof out.assistant_text === "string") return out.assistant_text;
  if (typeof out.letter_text === "string") return out.letter_text;
  if (typeof out.output_text === "string") return out.output_text;
  if (typeof out.text === "string") return out.text;
  if (typeof out.answer === "string") return out.answer;
  if (typeof out.message?.content === "string") return out.message.content;
  if (typeof out.data?.message?.content === "string") return out.data.message.content;
  if (typeof out.data?.letter_text === "string") return out.data.letter_text;
  if (typeof out.data?.text === "string") return out.data.text;
  if (typeof out.data?.answer === "string") return out.data.answer;
  return "";
}

function normalizeWebhookOutput(out: any) {
  const assistant_text = extractAssistantText(out);
  const artifacts =
    Array.isArray(out?.artifacts) ? out.artifacts
    : Array.isArray(out?.data?.artifacts) ? out.data.artifacts
    : undefined;
  return {
    assistant_text: assistant_text || "(no answer)",
    ...(artifacts ? { artifacts } : {}),
    raw: out,
  };
}

// ===============================
// Clinic API helpers
// ===============================
function clinicApiBaseUrl() {
  return cleanBaseUrl(process.env.EXPO_PUBLIC_CLINIC_API_URL || "");
}
function clinicBridgeToken() {
  return String(process.env.EXPO_PUBLIC_BRIDGE_TOKEN || "").trim();
}
function assertClinicConfigured() {
  const base = clinicApiBaseUrl();
  const tok = clinicBridgeToken();
  if (!base) throw new Error("EXPO_PUBLIC_CLINIC_API_URL is not set");
  if (!tok) throw new Error("EXPO_PUBLIC_BRIDGE_TOKEN is not set");
  return { base, tok };
}

function clinicHeaders() {
  const { tok } = assertClinicConfigured();
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "X-Bridge-Token": tok,
  };
}

async function clinicGet(path: string, queryParams?: Record<string, string>) {
  const { base } = assertClinicConfigured();
  const qs = queryParams
    ? "?" + new URLSearchParams(queryParams).toString()
    : "";
  const res = await fetch(`${base}${path}${qs}`, {
    method: "GET",
    headers: clinicHeaders(),
  });
  const text = await res.text().catch(() => "");
  const out = await parseJsonOrText(text);
  if (!res.ok) throw new Error(`GET ${path} ${res.status}: ${typeof out === "string" ? out : JSON.stringify(out)}`);
  return out;
}

async function clinicPost(path: string, body: any) {
  const { base } = assertClinicConfigured();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: clinicHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  const out = await parseJsonOrText(text);
  if (!res.ok) throw new Error(`POST ${path} ${res.status}: ${typeof out === "string" ? out : JSON.stringify(out)}`);
  return out;
}

async function clinicPatch(path: string, body: any) {
  const { base } = assertClinicConfigured();
  const res = await fetch(`${base}${path}`, {
    method: "PATCH",
    headers: clinicHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  const out = await parseJsonOrText(text);
  if (!res.ok) throw new Error(`PATCH ${path} ${res.status}: ${typeof out === "string" ? out : JSON.stringify(out)}`);
  return out;
}

// ===============================
// Chat (existing — unchanged)
// ===============================
export async function chat(
  cfg: Config,
  thread_id: string,
  message: string,
  file_ids: string[] = [],
  keys: ChatKeys = {}
) {
  const baseUrl = cleanBaseUrl(cfg.baseUrl);
  const url = `${baseUrl}/webhook/chat`;

  const payer_key = keys.payer_key === null ? null : keys.payer_key ? normKey(keys.payer_key) : undefined;
  const service_key = keys.service_key === null ? null : keys.service_key ? normKey(keys.service_key) : undefined;
  const template_key = keys.template_key === null ? null : keys.template_key ? String(keys.template_key).trim() : undefined;
  const policy_key = keys.policy_key === null ? null : keys.policy_key ? String(keys.policy_key).trim() : undefined;

  const body: any = { facility_id: cfg.facilityId, thread_id, message, file_ids };
  if (payer_key !== undefined) body.payer_key = payer_key;
  if (service_key !== undefined) body.service_key = service_key;
  if (template_key !== undefined) body.template_key = template_key;
  if (policy_key !== undefined) body.policy_key = policy_key;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, application/pdf, */*",
      "X-API-Key": cfg.apiKey,
    },
    body: JSON.stringify(body),
  });

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const out = await parseJsonOrText(text);
    throw new Error(`chat ${res.status}: ${typeof out === "string" ? out : JSON.stringify(out)}`);
  }
  if (contentType.includes("application/pdf")) {
    const filename = safeFilename(`preauth_${Date.now()}.pdf`);
    const blob = await res.blob();
    if (Platform.OS === "web") {
      const blobUrl = URL.createObjectURL(blob);
      return { assistant_text: "Prior authorization letter ready.", artifacts: [{ type: "pdf", url: blobUrl, filename, mime_type: "application/pdf" }] };
    }
    const uri = await saveBlobToLocalFile(blob, filename);
    return { assistant_text: "Prior authorization letter ready.", artifacts: [{ type: "pdf", uri, filename, mime_type: "application/pdf" }] };
  }
  const text = await res.text();
  const out = await parseJsonOrText(text);
  return normalizeWebhookOutput(out);
}

// ===============================
// Ingest (existing — unchanged)
// ===============================
export async function ingest(
  cfg: Config,
  uri: string,
  file_name: string,
  file_id: string,
  opts: {
    mime_type?: string;
    doc_role?: DocRole;
    payer_key?: string;
    service_key?: string;
    template_key?: string;
    policy_key?: string;
  } = {}
) {
  const baseUrl = cleanBaseUrl(cfg.baseUrl);
  const url = `${baseUrl}/webhook/ingest`;

  const params: Record<string, string> = {
    facility_id: cfg.facilityId,
    file_id,
    doc_id: file_id,
    file_name,
    mime_type: opts.mime_type || "application/octet-stream",
    doc_role: (opts.doc_role as any) || "doc",
  };

  const addOpt = (k: string, v: unknown) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (!s) return;
    params[k] = s;
  };
  addOpt("template_key", opts.template_key);
  addOpt("payer_key", opts.payer_key ? normKey(opts.payer_key) : opts.payer_key);
  addOpt("service_key", opts.service_key ? normKey(opts.service_key) : opts.service_key);
  addOpt("policy_key", opts.policy_key);

  if (Platform.OS === "web") {
    const fileResp = await fetch(uri);
    const blob = await fileResp.blob();
    const formData = new FormData();
    Object.entries(params).forEach(([k, v]) => formData.append(k, v));
    formData.append("file", blob, file_name);

    const res = await fetch(url, {
      method: "POST",
      headers: { "X-API-Key": cfg.apiKey },
      body: formData,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`ingest ${res.status}: ${t}`);
    }
    return await res.json().catch(() => res.text());
  }

  const resp = await FileSystem.uploadAsync(url, uri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "file",
    parameters: params,
    headers: { "X-API-Key": cfg.apiKey },
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`ingest ${resp.status}: ${resp.body}`);
  }
  return await parseJsonOrText(resp.body);
}

// ===============================
// Patient-scoped NON-PHI Chat → n8n (existing — unchanged)
// ===============================
export async function chatNonPhiCase(cfg: Config, input: NonPhiChatInput) {
  assertNoPHI(input.non_phi_packet);

  const baseUrl = cleanBaseUrl(cfg.baseUrl);
  const url = `${baseUrl}/webhook/chat`;

  const keys = input.keys || {};
  const payer_key = keys.payer_key === null ? null : keys.payer_key ? normKey(keys.payer_key) : undefined;
  const service_key = keys.service_key === null ? null : keys.service_key ? normKey(keys.service_key) : undefined;
  const template_key = keys.template_key === null ? null : keys.template_key ? String(keys.template_key).trim() : undefined;
  const policy_key = keys.policy_key === null ? null : keys.policy_key ? String(keys.policy_key).trim() : undefined;

  const body: any = {
    ctx: input.ctx,
    intent: input.intent,
    message: input.message,
    non_phi_packet: input.non_phi_packet,
    file_ids: Array.isArray(input.file_ids) ? input.file_ids : [],
  };
  if (payer_key !== undefined) body.payer_key = payer_key;
  if (service_key !== undefined) body.service_key = service_key;
  if (template_key !== undefined) body.template_key = template_key;
  if (policy_key !== undefined) body.policy_key = policy_key;

  safeLog("[CLOUD] chatNonPhiCase", {
    intent: input.intent,
    facility_id: input.ctx?.facility_id,
    thread_id: input.ctx?.thread_id,
    case_id: input.ctx?.case_id,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, application/pdf, */*",
      "X-API-Key": cfg.apiKey,
    },
    body: JSON.stringify(body),
  });

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const out = await parseJsonOrText(text);
    throw new Error(`chatNonPhiCase ${res.status}: ${typeof out === "string" ? out : JSON.stringify(out)}`);
  }
  if (contentType.includes("application/pdf")) {
    const filename = safeFilename(`preauth_${Date.now()}.pdf`);
    const blob = await res.blob();
    if (Platform.OS === "web") {
      const blobUrl = URL.createObjectURL(blob);
      return { assistant_text: "Prior authorization letter ready.", artifacts: [{ type: "pdf", url: blobUrl, filename, mime_type: "application/pdf" }] };
    }
    const uri = await saveBlobToLocalFile(blob, filename);
    return { assistant_text: "Prior authorization letter ready.", artifacts: [{ type: "pdf", uri, filename, mime_type: "application/pdf" }] };
  }
  const text = await res.text();
  const out = await parseJsonOrText(text);
  return normalizeWebhookOutput(out);
}

// ===============================
// Existing: Patient search + background (unchanged)
// ===============================

export type RemotePatient = {
  patient_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  dob?: string;
  sex?: string | null;
  phone?: string | null;
  address?: string | null;
  insurance_member_id?: string;
  insurance_group_number?: string;
};

export type PatientBackground = {
  ok?: boolean;
  patient?: {
    tenant_id?: number;
    facility_id?: string;
    patient_id?: string;
    first_name?: string;
    last_name?: string;
    full_name?: string;
    dob?: string;
    sex?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  coverage?: {
    payer_name?: string | null;
    payer_key?: string | null;
    plan_name?: string | null;
    member_id?: string | null;
    group_id?: string | null;
  } | null;
  coverage_primary?: {
    coverage_id?: string | null;
    payer_name?: string | null;
    payer_key?: string | null;
    payer_id?: string | null;
    plan_name?: string | null;
    member_id?: string | null;
    group_id?: string | null;
  } | null;
  coverage_all?: Array<{
    coverage_id?: string | null;
    payer_name?: string | null;
    payer_key?: string | null;
    payer_id?: string | null;
    plan_name?: string | null;
    member_id?: string | null;
    group_id?: string | null;
  }> | null;
  request?: {
    request_id?: string | null;
    coverage_id?: string | null;
    requested_dos?: string | null;
    cpt_code?: string | null;
    cpt_description?: string | null;
    icd10_code?: string | null;
    icd10_description?: string | null;
    clinical_question?: string | null;
    requested_units?: number | null;
  } | null;
  requests?: Array<{
    request_id?: string | null;
    coverage_id?: string | null;
    requested_dos?: string | null;
    cpt_code?: string | null;
    cpt_description?: string | null;
    icd10_code?: string | null;
    icd10_description?: string | null;
    clinical_question?: string | null;
    requested_units?: number | null;
    service_name?: string | null;
    service_key?: string | null;
    priority?: string | null;
    payer_id?: string | null;
    provider_id?: string | null;
    status?: string | null;
  }> | null;
  problems?: { problem_id?: string; icd10_code: string; description?: string | null; onset_date?: string | null }[];
  therapies?: {
    therapy_id?: string;
    therapy_type: string;
    start_date?: string | null;
    end_date?: string | null;
    total_visits?: number | null;
    response?: string | null;
    therapy_item?: string | null;
    weeks?: number | null;
    details?: string | null;
  }[];
  imaging?: {
    imaging_id?: string;
    imaging_date?: string | null;
    modality: string;
    body_part?: string | null;
    impression?: string | null;
    item?: string | null;
    findings?: any;
    study_date?: string | null;
  }[];
  // ✅ NEW: encounters + med_trials now returned by server v2
  encounters?: {
    encounter_id?: string;
    encounter_date?: string | null;
    summary?: string | null;
    provider_name?: string | null;
    provider_id?: string | null;
  }[];
  med_trials?: {
    trial_id?: string;
    medication?: string | null;
    dose?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    outcome?: string | null;
  }[];
};

export async function clinicPatientsSearch(input: {
  tenant_id?: number;
  facility_id: string;
  query: string;
}): Promise<RemotePatient[]> {
  const out = await clinicPost("/api/patients/search", {
    tenant_id: input.tenant_id ?? 1,
    facility_id: input.facility_id,
    query: input.query,
  });
  const patients = Array.isArray((out as any)?.patients)
    ? (out as any).patients
    : Array.isArray(out) ? out : [];
  return patients as RemotePatient[];
}

export async function clinicPatientBackground(input: {
  tenant_id?: number;
  facility_id: string;
  patient_id: string;
}): Promise<PatientBackground> {
  return (await clinicPost("/api/patients/background", {
    tenant_id: input.tenant_id ?? 1,
    facility_id: input.facility_id,
    patient_id: input.patient_id,
  })) as PatientBackground;
}

// ===============================
// ✅ NEW: Facility
// ===============================
export type FacilityData = {
  facility_id: string;
  facility_name: string;
  npi?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  fax?: string;
  email?: string;
  logo_url?: string;
  letterhead_footer?: string;
};

export async function clinicFetchFacility(input: {
  tenant_id?: number;
  facility_id: string;
}): Promise<FacilityData> {
  const out = await clinicGet("/api/facility", {
    tenant_id: String(input.tenant_id ?? 1),
    facility_id: input.facility_id,
  });
  return (out as any)?.facility as FacilityData;
}

// ===============================
// ✅ NEW: Providers
// ===============================
export type ProviderData = {
  provider_id: string;
  first_name: string;
  last_name: string;
  credentials?: string;
  specialty?: string;
  npi?: string;
  phone?: string;
  email?: string;
  signature_name?: string;
};

export async function clinicFetchProviders(input: {
  tenant_id?: number;
  facility_id: string;
}): Promise<ProviderData[]> {
  const out = await clinicGet("/api/providers", {
    tenant_id: String(input.tenant_id ?? 1),
    facility_id: input.facility_id,
  });
  return ((out as any)?.providers || []) as ProviderData[];
}

export async function clinicFetchProvider(input: {
  tenant_id?: number;
  facility_id: string;
  provider_id: string;
}): Promise<ProviderData> {
  const out = await clinicGet(`/api/providers/${input.provider_id}`, {
    tenant_id: String(input.tenant_id ?? 1),
    facility_id: input.facility_id,
  });
  return (out as any)?.provider as ProviderData;
}

// ===============================
// ✅ NEW: Payers
// ===============================
export type PayerData = {
  payer_id: string;
  payer_name: string;
  payer_type?: string;
  phone_general?: string;
  phone_pa?: string;
  fax_pa?: string;
  portal_url?: string;
  pa_turnaround_standard_days?: number;
  pa_turnaround_urgent_days?: number;
};

export async function clinicFetchPayers(input: {
  tenant_id?: number;
  facility_id: string;
}): Promise<PayerData[]> {
  const out = await clinicGet("/api/payers", {
    tenant_id: String(input.tenant_id ?? 1),
    facility_id: input.facility_id,
  });
  return ((out as any)?.payers || []) as PayerData[];
}

// ===============================
// ✅ NEW: Letter templates
// ===============================
export type LetterTemplateListItem = {
  template_id: string;
  template_name: string;
  letter_type: LetterType;
  service_category?: string;
  instructions?: string;
};

export async function clinicFetchLetterTemplates(input: {
  tenant_id?: number;
  facility_id: string;
  letter_type?: LetterType;
}): Promise<LetterTemplateListItem[]> {
  const params: Record<string, string> = {
    tenant_id: String(input.tenant_id ?? 1),
    facility_id: input.facility_id,
  };
  if (input.letter_type) params.letter_type = input.letter_type;
  const out = await clinicGet("/api/letter-templates", params);
  return ((out as any)?.templates || []) as LetterTemplateListItem[];
}

// ===============================
// ✅ NEW: Generate letter context (THE KEY FUNCTION)
// ===============================
// Calls POST /api/letters/generate-context
// Returns everything the LLM needs to write the letter.
// ===============================
export type LetterContext = {
  letter_type: LetterType;
  context: {
    patient: any;
    coverage: any;
    request: any;
    provider: any;
    facility: any;
    payer_policy: any;
    payer_contacts: any[];
    template: {
      template_id: string;
      template_name: string;
      template_body: string;
      instructions?: string;
      placeholders?: string[];
    } | null;
    clinical: {
      problems: any[];
      encounters: any[];
      imaging: any[];
      therapies: any[];
      med_trials: any[];
    };
    parent_letter: any;
  };
};

export async function clinicGenerateLetterContext(input: {
  tenant_id?: number;
  facility_id: string;
  patient_id: string;
  letter_type?: LetterType;
  request_id?: string;
  provider_id?: string;
  coverage_id?: string;
  parent_letter_id?: string;
}): Promise<LetterContext> {
  const out = await clinicPost("/api/letters/generate-context", {
    tenant_id: input.tenant_id ?? 1,
    facility_id: input.facility_id,
    patient_id: input.patient_id,
    letter_type: input.letter_type || "initial_auth",
    request_id: input.request_id || undefined,
    provider_id: input.provider_id || undefined,
    coverage_id: input.coverage_id || undefined,
    parent_letter_id: input.parent_letter_id || undefined,
  });
  return out as LetterContext;
}

// ===============================
// ✅ NEW: Save generated letter
// ===============================
export async function clinicSaveLetter(input: {
  tenant_id?: number;
  facility_id: string;
  patient_id: string;
  letter_type: LetterType;
  letter_body: string;
  request_id?: string;
  template_id?: string;
  coverage_id?: string;
  payer_id?: string;
  provider_id?: string;
  subject_line?: string;
  pdf_storage_path?: string;
  status?: string;
  created_by?: string;
}): Promise<{ letter_id: string }> {
  const out = await clinicPost("/api/letters", {
    tenant_id: input.tenant_id ?? 1,
    facility_id: input.facility_id,
    ...input,
  });
  return out as { letter_id: string };
}

// ===============================
// ✅ NEW: Update letter status
// ===============================
export async function clinicUpdateLetterStatus(input: {
  tenant_id?: number;
  facility_id: string;
  letter_id: string;
  status: string;
  changed_by?: string;
  change_reason?: string;
  sent_method?: string;
  sent_to?: string;
  auth_number?: string;
  denial_reason?: string;
  denial_code?: string;
}): Promise<{ letter_id: string; old_status: string; new_status: string }> {
  const out = await clinicPatch(`/api/letters/${input.letter_id}/status`, {
    tenant_id: input.tenant_id ?? 1,
    facility_id: input.facility_id,
    ...input,
  });
  return out as { letter_id: string; old_status: string; new_status: string };
}

// ===============================
// ✅ NEW: List letters for patient
// ===============================
export type LetterListItem = {
  letter_id: string;
  patient_id: string;
  letter_type: LetterType;
  letter_date: string;
  status: string;
  subject_line?: string;
  payer_id?: string;
  provider_id?: string;
  request_id?: string;
  created_at: string;
};

export async function clinicFetchLetters(input: {
  tenant_id?: number;
  facility_id: string;
  patient_id?: string;
  status?: string;
}): Promise<LetterListItem[]> {
  const params: Record<string, string> = {
    tenant_id: String(input.tenant_id ?? 1),
    facility_id: input.facility_id,
  };
  if (input.patient_id) params.patient_id = input.patient_id;
  if (input.status) params.status = input.status;
  const out = await clinicGet("/api/letters", params);
  return ((out as any)?.letters || []) as LetterListItem[];
}

// ===============================
// v3: Fetch letter detail
// ===============================
export type LetterDetail = {
  letter_id: string;
  patient_id: string;
  letter_type: LetterType;
  letter_date: string;
  letter_body: string;
  status: string;
  subject_line?: string;
  payer_id?: string;
  provider_id?: string;
  request_id?: string;
  template_id?: string;
  coverage_id?: string;
  created_at: string;
  updated_at?: string;
  sent_date?: string;
  response_date?: string;
  auth_number?: string;
  denial_reason?: string;
  denial_code?: string;
};

export type LetterStatusHistoryItem = {
  history_id: string;
  letter_id: string;
  old_status: string | null;
  new_status: string;
  changed_by?: string;
  change_reason?: string;
  changed_at: string;
};

export async function clinicFetchLetter(input: {
  tenant_id?: number;
  facility_id: string;
  letter_id: string;
}): Promise<{ letter: LetterDetail; status_history: LetterStatusHistoryItem[] }> {
  const out = await clinicGet(`/api/letters/${input.letter_id}`, {
    tenant_id: String(input.tenant_id ?? 1),
    facility_id: input.facility_id,
  });
  return out as { letter: LetterDetail; status_history: LetterStatusHistoryItem[] };
}

// ===============================
// v3: Template Sections (Blueprint §4.1)
// ===============================
export type TemplateSection = {
  section_id: string;
  section_name: string;
  section_order: number;
  instruction_prompt: string;
  scaffold_text: string;
  requires_policy: boolean;
  requires_clinical: boolean;
  is_active: boolean;
};

export async function clinicFetchTemplateSections(input: {
  tenant_id?: number;
  facility_id: string;
  template_id: string;
}): Promise<TemplateSection[]> {
  const out = await clinicGet(`/api/letter-templates/${input.template_id}/sections`, {
    tenant_id: String(input.tenant_id ?? 1),
    facility_id: input.facility_id,
  });
  return ((out as any)?.sections || []) as TemplateSection[];
}

// ===============================
// v3: Patient Normalization (Blueprint §5 Step 1)
// ===============================
export type NormalizedPatient = {
  patient_id: string;
  age: number;
  sex: string | null;
  diagnosis: { icd10: string; description: string; onset: string | null }[];
  primary_diagnosis: { icd10: string; description: string } | null;
  symptoms: string[];
  symptom_duration: string | null;
  failed_treatments: {
    type: string;
    visits: number | null;
    response: string;
    item: string | null;
  }[];
  medications: {
    name: string;
    dose: string;
    outcome: string;
    start_date: string | null;
    end_date: string | null;
  }[];
  functional_limits: string[];
  imaging_findings: {
    modality: string;
    body_part: string | null;
    impression: string | null;
    date: string | null;
  }[];
  therapy_history: {
    type: string;
    start_date: string | null;
    end_date: string | null;
    visits: number | null;
    response: string | null;
    item: string | null;
  }[];
};

export async function clinicNormalizePatient(input: {
  tenant_id?: number;
  facility_id: string;
  patient_id: string;
}): Promise<NormalizedPatient> {
  const out = await clinicPost("/api/patients/normalize", {
    tenant_id: input.tenant_id ?? 1,
    facility_id: input.facility_id,
    patient_id: input.patient_id,
  });
  return (out as any)?.normalized as NormalizedPatient;
}

// ===============================
// v3: Policy Criteria Extraction (Blueprint §5 Step 2)
// ===============================
export type PolicyCriteria = {
  policy_id: string;
  policy_name: string;
  payer_id: string;
  clinical_criteria: string | null;
  required_documents: string | null;
  required_failed_therapies: number;
  min_therapy_weeks: number;
  guideline_source: string | null;
  appeal_deadline_days: number | null;
  checklist: {
    criterion_id: string;
    text: string;
    category: string;
  }[];
};

export async function clinicExtractPolicyCriteria(input: {
  tenant_id?: number;
  facility_id: string;
  policy_id?: string;
  payer_id?: string;
  cpt_code?: string;
}): Promise<PolicyCriteria> {
  const out = await clinicPost("/api/policy/extract-criteria", {
    tenant_id: input.tenant_id ?? 1,
    facility_id: input.facility_id,
    policy_id: input.policy_id,
    payer_id: input.payer_id,
    cpt_code: input.cpt_code,
  });
  return (out as any)?.criteria as PolicyCriteria;
}

// ===============================
// v3: Section Generation Pipeline (Blueprint §5 Steps 3-4)
// ===============================
export type SectionPayload = {
  section_id: string;
  section_name: string;
  section_order: number;
  instruction_prompt: string;
  scaffold_text: string;
  patient_facts: any;
  policy_criteria: any;
};

export type GenerateSectionsResponse = {
  letter_type: string;
  template: { template_id: string; template_name: string; instructions?: string } | null;
  patient: any;
  coverage: any;
  request: any;
  provider: any;
  facility: any;
  policy_criteria: any;
  clinical: any;
  sections: SectionPayload[];
  section_count: number;
};

export async function clinicGenerateSections(input: {
  tenant_id?: number;
  facility_id: string;
  patient_id: string;
  letter_type?: LetterType;
  template_id?: string;
  request_id?: string;
  provider_id?: string;
  coverage_id?: string;
}): Promise<GenerateSectionsResponse> {
  const out = await clinicPost("/api/letters/generate-sections", {
    tenant_id: input.tenant_id ?? 1,
    facility_id: input.facility_id,
    patient_id: input.patient_id,
    letter_type: input.letter_type || "initial_auth",
    template_id: input.template_id,
    request_id: input.request_id,
    provider_id: input.provider_id,
    coverage_id: input.coverage_id,
  });
  return out as GenerateSectionsResponse;
}

// ===============================
// v3: Validation Pass (Blueprint §6)
// ===============================
export type ValidationIssue = {
  type: "missing_evidence" | "criteria_gap" | "weak_reasoning" | "missing_document";
  severity: "high" | "medium" | "low";
  section?: string;
  criterion_index?: number;
  criterion_text?: string;
  message: string;
};

export type ValidationResult = {
  passed: boolean;
  score: number | null;
  criteria_met: number;
  criteria_total: number;
  issue_count: number;
  high_severity_count: number;
  medium_severity_count: number;
  low_severity_count: number;
  issues: ValidationIssue[];
};

export async function clinicValidateLetter(input: {
  tenant_id?: number;
  facility_id: string;
  letter_body?: string;
  sections?: { content: string }[];
  policy_id?: string;
  payer_id?: string;
  cpt_code?: string;
}): Promise<ValidationResult> {
  const out = await clinicPost("/api/letters/validate", {
    tenant_id: input.tenant_id ?? 1,
    facility_id: input.facility_id,
    letter_body: input.letter_body,
    sections: input.sections,
    policy_id: input.policy_id,
    payer_id: input.payer_id,
    cpt_code: input.cpt_code,
  });
  return (out as any)?.validation as ValidationResult;
}

// ===============================
// v3: Generation Logging (Blueprint §8)
// ===============================
export async function clinicLogGeneration(input: {
  tenant_id?: number;
  facility_id: string;
  letter_id?: string;
  request_id?: string;
  patient_id?: string;
  payer_id?: string;
  provider_id?: string;
  template_id?: string;
  letter_type?: string;
  cpt_codes?: string[];
  icd10_codes?: string[];
  policy_refs?: string[];
  generation_time_ms?: number;
  section_count?: number;
  validation_passed?: boolean;
  validation_issues?: any;
  model_id?: string;
}): Promise<{ log_id: string }> {
  const out = await clinicPost("/api/generation-logs", {
    tenant_id: input.tenant_id ?? 1,
    facility_id: input.facility_id,
    ...input,
  });
  return out as { log_id: string };
}

export async function clinicUpdateGenerationOutcome(input: {
  tenant_id?: number;
  facility_id: string;
  log_id: string;
  outcome: string;
  user_edits?: any;
}): Promise<{ log_id: string; outcome: string }> {
  const out = await clinicPatch(`/api/generation-logs/${input.log_id}/outcome`, {
    tenant_id: input.tenant_id ?? 1,
    facility_id: input.facility_id,
    outcome: input.outcome,
    user_edits: input.user_edits,
  });
  return out as { log_id: string; outcome: string };
}