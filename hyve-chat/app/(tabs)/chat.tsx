// app/(tabs)/chat.tsx
// ============================================================================
// v2 — Prior Auth Letter Generation System
// ============================================================================
// ✅ Patient select + cached clinical context -> NON-PHI packet -> optional attach to chat.
// ✅ Remote-only patient search/background via clinicPatientsSearch + clinicPatientBackground.
// ✅ Local-only PHI reinsertion AFTER response comes back (never sent to server).
// ✅ Uses phiReinserter (app/lib/phiReinserter.ts)
//
// v2 additions:
// ✅ Letter type selector (initial_auth, peer_to_peer, appeal, urgent_auth)
// ✅ Provider selector (loaded from DB)
// ✅ Request selector (pick which PA request to generate for)
// ✅ New onGenerateLetter uses /api/letters/generate-context → LLM → save to DB
// ✅ Updated PHI reinsertion with provider, encounters, med trials, parent letter
// ============================================================================

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  Text,
  TextInput,
  View,
  Dimensions,
  ScrollView,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";

import { Storage, Keys } from "../lib/storage";
import {
  ingest,
  chat,
  chatNonPhiCase,
  clinicPatientBackground,
  clinicPatientsSearch,
  clinicFetchProviders,
  clinicGenerateLetterContext,
  clinicSaveLetter,
  clinicGenerateSections,
  clinicValidateLetter,
  clinicLogGeneration,
  type Config as ApiConfig,
  type NonPhiIntent,
  type PatientBackground,
  type ProviderData,
  type LetterType,
  type LetterContext,
} from "../lib/api";

import { toNonPHICasePacket } from "../lib/phiScrubber";
import { assertNoPHI } from "../lib/phiFirewall";
import { setActivePatient, getActivePatient, clearActivePatient } from "../lib/patientContext";
import { savePatientPHI, loadPatientPHI, type PatientPHI } from "../lib/patientPHICache";
import { phiReinserter } from "../lib/phiReinserter";

type Artifact = {
  type: string;
  url?: string;
  uri?: string;
  filename?: string;
  mime_type?: string;
  data_base64?: string;
  storage_key?: string;
  file_id?: string;
};

type Msg = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  artifacts?: Artifact[];
};

type Picked = { file_id: string; name: string; mimeType?: string };
type ActivePatient = { patient_id: string; display_label: string };

type PatientRowPHI = {
  patient_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  dob?: string;
  sex?: string | null;
  insurance_member_id?: string;
  insurance_group_number?: string;
};

// ✅ NEW: Request row from background
type RequestRow = {
  request_id: string;
  cpt_code?: string | null;
  cpt_description?: string | null;
  service_name?: string | null;
  status?: string | null;
  priority?: string | null;
  requested_dos?: string | null;
  payer_id?: string | null;
};

// ✅ NEW: Coverage row for payer selector
type CoverageRow = {
  coverage_id: string;
  payer_name?: string | null;
  payer_id?: string | null;
  plan_name?: string | null;
  member_id?: string | null;
  group_id?: string | null;
};

const UI = {
  bg: "#0b0f14",
  panelBg: "#0f172a",
  card: "#111a25",
  card2: "#0f172a",
  border: "#223043",
  text: "#e8eef7",
  subtext: "#9fb0c3",
  danger: "#ef4444",
  primary: "#1f6feb",
  primaryText: "#ffffff",
  btn: "#1b2636",
  btnText: "#e8eef7",
  success: "#16a34a",
  info: "#0ea5e9",
  warn: "#f59e0b",
  overlay: "rgba(0,0,0,0.55)",
};

// ✅ NEW: letter type config
const LETTER_TYPES: { key: LetterType; label: string; color: string }[] = [
  { key: "initial_auth", label: "Initial Auth", color: UI.primary },
  { key: "peer_to_peer", label: "Peer-to-Peer", color: UI.info },
  { key: "appeal", label: "Appeal", color: UI.warn },
  { key: "urgent_auth", label: "Urgent", color: UI.danger },
];

function safeFilename(name: string) {
  return String(name || "report.pdf").replace(/[^\w.\- ]+/g, "_");
}
function makeFileId(prefix = "mobile") {
  const rand = Math.random().toString(16).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}
function makeCaseId() {
  const rand = Math.random().toString(16).slice(2, 10);
  return `case_${Date.now()}_${rand}`;
}

async function openPdfArtifact(a: Artifact) {
  const filename = safeFilename(a.filename || "report.pdf");
  const localUri = String(a?.uri || "").trim();

  if (localUri.startsWith("file://")) {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(localUri, { mimeType: "application/pdf", dialogTitle: "Save PDF", UTI: "com.adobe.pdf" });
      return;
    }
    await Share.share({ url: localUri, message: "PDF ready to save." });
    return;
  }

  const base64 = String(a?.data_base64 || "").trim();
  if (base64) {
    const outUri = (FileSystem.documentDirectory || "") + filename;
    await FileSystem.writeAsStringAsync(outUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(outUri, { mimeType: "application/pdf", dialogTitle: "Save PDF", UTI: "com.adobe.pdf" });
      return;
    }
    await Share.share({ url: outUri, message: "PDF ready to save." });
    return;
  }

  const url = String(a?.url || "").trim();
  if (!url) throw new Error("PDF artifact is missing url/uri/base64.");
  const localPath = (FileSystem.documentDirectory || "") + filename;
  const dl = await FileSystem.downloadAsync(url, localPath);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(dl.uri, { mimeType: "application/pdf", dialogTitle: "Save PDF", UTI: "com.adobe.pdf" });
    return;
  }
  await Share.share({ message: url, url });
}

async function copyPdfLink(a: Artifact) {
  const url = String(a?.url || "").trim();
  if (!url) throw new Error("PDF artifact is missing url.");
  await Clipboard.setStringAsync(url);
  return url;
}
async function sharePdfLink(a: Artifact) {
  const url = String(a?.url || "").trim();
  if (!url) throw new Error("PDF artifact is missing url.");
  await Share.share({ message: url, url });
}

function normalizeChatResponse(resp: any): { text: string; artifacts?: Artifact[] } {
  if (!resp) return { text: "(no response)" };
  if (typeof resp === "string") return { text: resp || "(no answer)" };
  if (typeof resp?.assistant_text === "string") {
    const arts = Array.isArray(resp?.artifacts) ? (resp.artifacts as Artifact[]) : undefined;
    return { text: resp.assistant_text || "(no answer)", artifacts: arts };
  }
  const text = resp?.answer ?? resp?.assistant ?? resp?.message ?? "(no answer)";
  const arts: Artifact[] = [];
  if (resp?.pdf_url) arts.push({ type: "pdf", url: resp.pdf_url, filename: resp.pdf_filename });
  if (Array.isArray(resp?.artifacts)) arts.push(...resp.artifacts);
  return { text, artifacts: arts.length ? arts : undefined };
}

function Chip({ label, tone, compact }: { label: string; tone: "neutral" | "success" | "danger" | "info" | "warn"; compact?: boolean }) {
  const bg =
    tone === "success" ? "rgba(22,163,74,0.18)"
    : tone === "danger" ? "rgba(239,68,68,0.18)"
    : tone === "info" ? "rgba(14,165,233,0.18)"
    : tone === "warn" ? "rgba(245,158,11,0.18)"
    : "rgba(148,163,184,0.12)";
  const border =
    tone === "success" ? "rgba(22,163,74,0.35)"
    : tone === "danger" ? "rgba(239,68,68,0.35)"
    : tone === "info" ? "rgba(14,165,233,0.35)"
    : tone === "warn" ? "rgba(245,158,11,0.35)"
    : "rgba(148,163,184,0.2)";
  const textColor =
    tone === "success" ? "#86efac"
    : tone === "danger" ? "#fca5a5"
    : tone === "info" ? "#7dd3fc"
    : tone === "warn" ? "#fde68a"
    : UI.subtext;

  return (
    <View style={{ paddingHorizontal: compact ? 8 : 10, paddingVertical: compact ? 4 : 6, borderRadius: 999, borderWidth: 1, borderColor: border, backgroundColor: bg }}>
      <Text style={{ color: textColor, fontSize: compact ? 11 : 12, fontWeight: "800" }}>{label}</Text>
    </View>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const listRef = useRef<FlatList<Msg>>(null);

  // Config
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [facilityId, setFacilityId] = useState("FAC-DEMO");

  // Thread
  const [threadId] = useState(() => String(params.thread_id || `t_${Date.now()}`));

  // Chat
  const [messages, setMessages] = useState<Msg[]>([
    { id: `s_${Date.now()}`, role: "system", content: "Ready. Search/select a patient, choose letter type & provider, then generate." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickedFiles, setPickedFiles] = useState<Picked[]>([]);
  const [intent, setIntent] = useState<NonPhiIntent>("generate_preauth_letter");

  // Patient UI
  const [patientPanelOpen, setPatientPanelOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PatientRowPHI[]>([]);
  const [searchStatus, setSearchStatus] = useState("");

  // Active patient state
  const [activePatient, setActivePatientState] = useState<ActivePatient | null>(null);
  const [patientBackgroundRaw, setPatientBackgroundRaw] = useState<PatientBackground | null>(null);
  const [backgroundPreview, setBackgroundPreview] = useState("");

  // Packet + case (NON-PHI)
  const [nonPhiPacket, setNonPhiPacket] = useState<any | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [attachPacket, setAttachPacket] = useState<boolean>(false);

  // Collapsible
  const [patientBarCollapsed, setPatientBarCollapsed] = useState<boolean>(true);

  // ✅ NEW: Letter type
  const [letterType, setLetterType] = useState<LetterType>("initial_auth");

  // ✅ NEW: Provider selector
  const [providers, setProviders] = useState<ProviderData[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  // ✅ NEW: Request selector (from patient background)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [patientRequests, setPatientRequests] = useState<RequestRow[]>([]);

  // ✅ NEW: Payer/Coverage selector
  const [patientCoverages, setPatientCoverages] = useState<CoverageRow[]>([]);
  const [selectedCoverageId, setSelectedCoverageId] = useState<string | null>(null);

  // ✅ NEW: Last generated letter context (for reinsertion)
  const [lastLetterContext, setLastLetterContext] = useState<LetterContext | null>(null);

  // Errors
  const [lastError, setLastError] = useState("");

  const cfg: ApiConfig = useMemo(
    () => ({ baseUrl: (baseUrl || "").trim(), apiKey: (apiKey || "").trim(), facilityId: (facilityId || "").trim() }),
    [baseUrl, apiKey, facilityId]
  );

  function push(role: Msg["role"], content: string, artifacts?: Artifact[]) {
    setMessages((m) => [{ id: `${role}_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`, role, content, artifacts }, ...m]);
    setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 30);
  }

  // ──────────── Init ────────────
  useEffect(() => {
    (async () => {
      try {
        const [u, k, f, provId, lt] = await Promise.all([
          Storage.getItem(Keys.baseUrl),
          Storage.getItem(Keys.apiKey),
          Storage.getItem(Keys.facilityId),
          Storage.getItem(Keys.activeProviderId),
          Storage.getItem(Keys.lastLetterType),
        ]);
        if (u) setBaseUrl(String(u));
        if (k) setApiKey(String(k));
        if (f) setFacilityId(String(f));
        if (provId) setSelectedProviderId(provId);
        if (lt && ["initial_auth", "peer_to_peer", "appeal", "urgent_auth"].includes(lt)) {
          setLetterType(lt as LetterType);
        }

        await hydrateActivePatient();
        await loadProviders(f || "FAC-DEMO");
      } catch {}
    })();
  }, []);

  // ✅ NEW: Load providers from DB
  async function loadProviders(fid?: string) {
    try {
      const provs = await clinicFetchProviders({
        tenant_id: 1,
        facility_id: fid || cfg.facilityId || "FAC-DEMO",
      });
      setProviders(provs);
      // Auto-select first if none selected
      if (!selectedProviderId && provs.length) {
        setSelectedProviderId(provs[0].provider_id);
        await Storage.setItem(Keys.activeProviderId, provs[0].provider_id);
      }
    } catch (e: any) {
      // Non-blocking — providers are optional
      console.log("loadProviders:", e?.message);
    }
  }

  async function hydrateActivePatient() {
    try {
      const ap = (await getActivePatient?.()) as ActivePatient | null;
      setActivePatientState(ap || null);
      if (!ap?.patient_id) return;
      await fetchAndCacheClinicalContext(ap.patient_id);
    } catch {}
  }

  // ──────────── PHI Reinsertion (v2 — uses full context) ────────────
  async function reinsertPHILocally(serverText: string) {
    const text = String(serverText || "");
    if (!activePatient?.patient_id) return text;
    if (!phiReinserter.looksLikeDocument(text)) return text;
    if (!phiReinserter.hasPlaceholders(text)) return text;

    const patient = (await loadPatientPHI(activePatient.patient_id)) as PatientPHI | null;
    if (!patient) return text;

    const bg = patientBackgroundRaw as any;
    const ctx = lastLetterContext?.context;

    // Coverage
    const coverageSrc = ctx?.coverage ?? bg?.coverage_primary ?? bg?.coverage ?? {};

    // Request
    const requestSrc = ctx?.request ?? (Array.isArray(bg?.requests) && bg.requests.length ? bg.requests[0] : bg?.request ?? null);

    // Provider (from generate-context or bg)
    const providerSrc = ctx?.provider ?? null;

    // Facility from context or Storage
    const facilitySrc = ctx?.facility ?? null;
    const [facilityName, facilityNpi, facilityPhone, facilityFax, facilityAddress, facilityCity, facilityState, facilityZip] = await Promise.all([
      Storage.getItem(Keys.facilityName),
      Storage.getItem(Keys.facilityNpi),
      Storage.getItem(Keys.facilityPhone),
      Storage.getItem(Keys.facilityFax),
      Storage.getItem(Keys.facilityAddress),
      Storage.getItem(Keys.facilityCity),
      Storage.getItem(Keys.facilityState),
      Storage.getItem(Keys.facilityZip),
    ]);

    try {
      return phiReinserter.reinsertPHI(text, {
        patient,
        facility: facilitySrc
          ? {
              facility_id: facilitySrc.facility_id || cfg.facilityId,
              facility_name: facilitySrc.name || facilityName || cfg.facilityId,
              facility_npi: facilitySrc.npi || facilityNpi || undefined,
              facility_phone: facilitySrc.phone || facilityPhone || undefined,
              facility_fax: facilitySrc.fax || facilityFax || undefined,
              facility_address: facilitySrc.address || facilityAddress || undefined,
            }
          : {
              facility_id: cfg.facilityId,
              facility_name: (facilityName || cfg.facilityId || "").trim(),
              facility_npi: (facilityNpi || "").trim() || undefined,
              facility_phone: (facilityPhone || "").trim() || undefined,
              facility_fax: (facilityFax || "").trim() || undefined,
              facility_address: (facilityAddress || "").trim() || undefined,
              facility_city: (facilityCity || "").trim() || undefined,
              facility_state: (facilityState || "").trim() || undefined,
              facility_zip: (facilityZip || "").trim() || undefined,
            },
        coverage: {
          coverage_id: coverageSrc?.coverage_id || null,
          payer_name: coverageSrc?.payer_name || null,
          payer_key: coverageSrc?.payer_key || null,
          payer_phone: coverageSrc?.payer_phone || null,
          payer_fax: coverageSrc?.payer_fax || null,
          payer_address: coverageSrc?.payer_address || null,
          member_id: patient.insurance_member_id ?? coverageSrc?.member_id ?? null,
          group_id: patient.insurance_group_number ?? coverageSrc?.group_id ?? null,
          plan_name: coverageSrc?.plan_name || null,
          plan_type: coverageSrc?.plan_type || null,
        },
        // ✅ NEW: provider info for reinsertion
        provider: providerSrc
          ? {
              provider_id: providerSrc.provider_id,
              name: providerSrc.name || providerSrc.signature_name,
              credentials: providerSrc.credentials,
              specialty: providerSrc.specialty,
              npi: providerSrc.npi,
              phone: providerSrc.phone,
              signature_name: providerSrc.signature_name || providerSrc.name,
            }
          : undefined,
        request: requestSrc
          ? {
              request_id: requestSrc.request_id || null,
              cpt_code: requestSrc.cpt_code || null,
              cpt_description: requestSrc.cpt_description || null,
              icd10_code: requestSrc.icd10_code || null,
              icd10_description: requestSrc.icd10_description || null,
              clinical_question: requestSrc.clinical_question || null,
              requested_units: requestSrc.requested_units ?? null,
              requested_dos: requestSrc.requested_dos || null,
              service_name: requestSrc.service_name || null,
              medical_necessity_summary: requestSrc.medical_necessity_summary || null,
              cpt_codes: requestSrc.cpt_code ? [requestSrc.cpt_code] : [],
              icd10_codes: requestSrc.icd10_codes
                ? (typeof requestSrc.icd10_codes === "string"
                    ? requestSrc.icd10_codes.split(",").map((s: string) => s.trim())
                    : requestSrc.icd10_codes)
                : requestSrc.icd10_code ? [requestSrc.icd10_code] : [],
            }
          : undefined,
        // ✅ NEW: clinical data for reinsertion
        problems: ctx?.clinical?.problems ?? bg?.problems ?? undefined,
        therapies: ctx?.clinical?.therapies ?? bg?.therapies ?? undefined,
        imaging: ctx?.clinical?.imaging ?? bg?.imaging ?? undefined,
        encounters: ctx?.clinical?.encounters ?? bg?.encounters ?? undefined,
        med_trials: ctx?.clinical?.med_trials ?? bg?.med_trials ?? undefined,
        // ✅ NEW: parent letter for appeals
        parent_letter: ctx?.parent_letter ?? undefined,
      });
    } catch {
      return text;
    }
  }

  // ──────────── Patient Search ────────────
  async function clearPatientSearch() {
    setSearchQuery("");
    setSearchStatus("");
    setSearchResults([]);
  }

  async function searchPatientsClinicOnly() {
    try {
      const q = searchQuery.trim();
      setSearchStatus(q ? "Searching clinic DB…" : "");
      setLastError("");
      setSearchResults([]);
      if (!q) return;

      const remote = await clinicPatientsSearch({ tenant_id: 1, facility_id: cfg.facilityId, query: q });
      const remoteAsShape: PatientRowPHI[] = (remote || []).map((p: any) => ({
        patient_id: p.patient_id,
        full_name: (p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.patient_id).trim(),
        first_name: (p.first_name || "").trim(),
        last_name: (p.last_name || "").trim(),
        dob: (p.dob || "").trim(),
        sex: p.sex ?? null,
        insurance_member_id: p.insurance_member_id ?? undefined,
        insurance_group_number: p.insurance_group_number ?? undefined,
      }));

      setSearchResults(remoteAsShape);
      setSearchStatus(remoteAsShape.length ? `Found ${remoteAsShape.length} clinic results` : "No matches");
    } catch (e: any) {
      setSearchStatus("");
      setLastError(`Search: ${e?.message ?? String(e)}`);
      Alert.alert("Search failed", e?.message ?? String(e));
    }
  }

  async function testClinicApi() {
    try {
      setSearchStatus("Testing clinic API…");
      const out = await clinicPatientsSearch({ tenant_id: 1, facility_id: cfg.facilityId, query: "smith" });
      setSearchStatus(`Clinic API OK ✅ (${(out || []).length} result(s))`);
      Alert.alert("Clinic API OK ✅", `Returned ${(out || []).length} result(s).`);
    } catch (e: any) {
      setSearchStatus("");
      setLastError(`Clinic API FAILED: ${e?.message ?? String(e)}`);
      Alert.alert("Clinic API FAILED", e?.message ?? String(e));
    }
  }

  async function fetchAndCacheClinicalContext(patient_id: string) {
    try {
      setSearchStatus("Loading clinical context…");
      setBackgroundPreview("");
      setPatientBackgroundRaw(null);

      const bg = await clinicPatientBackground({ tenant_id: 1, facility_id: cfg.facilityId, patient_id });
      setPatientBackgroundRaw(bg);

      // Extract requests for the picker
      const reqs = Array.isArray((bg as any)?.requests) ? (bg as any).requests : [];
      setPatientRequests(reqs);
      if (reqs.length && !selectedRequestId) {
        setSelectedRequestId(reqs[0]?.request_id || null);
      }

      // ✅ NEW: Extract coverages for payer picker
      const covs = Array.isArray((bg as any)?.coverage_all) ? (bg as any).coverage_all : [];
      setPatientCoverages(covs);
      if (covs.length && !selectedCoverageId) {
        setSelectedCoverageId(covs[0]?.coverage_id || null);
      }

      const problems = Array.isArray((bg as any)?.problems) ? (bg as any).problems : [];
      const therapies = Array.isArray((bg as any)?.therapies) ? (bg as any).therapies : [];
      const imaging = Array.isArray((bg as any)?.imaging) ? (bg as any).imaging : [];
      const encounters = Array.isArray((bg as any)?.encounters) ? (bg as any).encounters : [];

      setBackgroundPreview(
        `Dx: ${problems.map((x: any) => x?.icd10_code).filter(Boolean).slice(0, 6).join(", ") || "none"}\n` +
        `Tx: ${therapies.map((x: any) => x?.therapy_type).filter(Boolean).slice(0, 6).join(", ") || "none"}\n` +
        `Imaging: ${imaging.map((x: any) => x?.modality).filter(Boolean).slice(0, 6).join(", ") || "none"}\n` +
        `Encounters: ${encounters.length}\n` +
        `PA Requests: ${reqs.length}`
      );

      setSearchStatus("");
      return bg;
    } catch (e: any) {
      setSearchStatus("");
      setBackgroundPreview("");
      setPatientBackgroundRaw(null);
      throw e;
    }
  }

  async function selectPatient(p: PatientRowPHI) {
    try {
      const label = p.full_name || p.patient_id;

      await savePatientPHI({
        patient_id: p.patient_id,
        full_name: p.full_name ?? null,
        first_name: p.first_name ?? null,
        last_name: p.last_name ?? null,
        dob: p.dob ?? null,
        insurance_member_id: p.insurance_member_id ?? null,
        insurance_group_number: p.insurance_group_number ?? null,
        sex: p.sex ?? null,
      } as any);

      await setActivePatient({ patient_id: p.patient_id, display_label: label });
      setActivePatientState({ patient_id: p.patient_id, display_label: label });

      setCaseId(null);
      setNonPhiPacket(null);
      setAttachPacket(false);
      setSelectedRequestId(null);
      setSelectedCoverageId(null);
      setLastLetterContext(null);
      setLastError("");

      push("assistant", `Active patient set: ${label}`);
      await fetchAndCacheClinicalContext(p.patient_id);

      setPatientPanelOpen(false);
      setPatientBarCollapsed(false); // ✅ Auto-expand so user sees options
    } catch (e: any) {
      Alert.alert("Select patient failed", e?.message ?? String(e));
    }
  }

  async function clearActivePatientEverywhere() {
    try { await clearActivePatient?.(); } catch {}
    setActivePatientState(null);
    setPatientBackgroundRaw(null);
    setBackgroundPreview("");
    setCaseId(null);
    setNonPhiPacket(null);
    setAttachPacket(false);
    setSelectedRequestId(null);
    setPatientRequests([]);
    setPatientCoverages([]);
    setSelectedCoverageId(null);
    setLastLetterContext(null);
    setLastError("");
    push("assistant", "Active patient cleared.");
  }

  // ──────────── NON-PHI Packet (existing, unchanged) ────────────
  async function buildNonPhiPacketForActivePatient(opts?: { skipBusy?: boolean }) {
    if (!activePatient?.patient_id) {
      Alert.alert("No patient", "Select an active patient first.");
      return null;
    }
    if (!opts?.skipBusy) setBusy(true);
    try {
      push("user", "Generate NON-PHI packet");
      const bg = patientBackgroundRaw || (await fetchAndCacheClinicalContext(activePatient.patient_id));
      const packet = toNonPHICasePacket({ facility_id: cfg.facilityId, background: bg } as any);
      assertNoPHI(packet);
      const newCaseId = packet.case_id || makeCaseId();
      setCaseId(newCaseId);
      setNonPhiPacket(packet);
      setAttachPacket(true);
      setLastError("");
      push("assistant", `✅ Packet ready (de-identified). Attach is ON.\nCase: ${newCaseId}`);
      setPatientBarCollapsed(true);
      return { packet, caseId: newCaseId };
    } catch (e: any) {
      setLastError(`Packet: ${e?.message ?? String(e)}`);
      push("assistant", `❌ ${e?.message ?? String(e)}`);
      Alert.alert("Packet Error", e?.message ?? String(e));
      return null;
    } finally {
      if (!opts?.skipBusy) setBusy(false);
    }
  }

  // ──────────── File Upload ────────────
  async function onPickFile() {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (res.canceled) return;
      const picked = res.assets?.[0];
      if (!picked) return;
      if (!cfg.baseUrl) { Alert.alert("Configuration Error", "Base URL is not configured."); return; }

      const file_id = makeFileId();
      const name = picked.name || "file";
      setBusy(true);
      push("user", `📎 Uploading: ${name}`);
      await ingest(cfg, picked.uri, name, file_id, { mime_type: picked.mimeType || undefined });
      setPickedFiles((prev) => [...prev, { file_id, name, mimeType: picked.mimeType || undefined }]);
      push("assistant", `✅ Uploaded: ${name}`);
    } catch (e: any) {
      push("assistant", `❌ Upload failed: ${e?.message ?? String(e)}`);
      setLastError(`Upload: ${e?.message ?? String(e)}`);
      Alert.alert("Upload Error", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // ============================================================================
  // ✅ NEW: Generate Letter (v2 — uses /api/letters/generate-context)
  // ============================================================================
  async function onGenerateLetter() {
    if (busy) return;
    if (!cfg.baseUrl) { Alert.alert("Configuration Error", "Base URL is not configured."); return; }
    if (!activePatient?.patient_id) { Alert.alert("No patient", "Select an active patient first."); return; }

    setBusy(true);
    const genStartTime = Date.now();
    try {
      const typeLabel = LETTER_TYPES.find((t) => t.key === letterType)?.label || letterType;
      const provLabel = providers.find((p) => p.provider_id === selectedProviderId);
      const provDisplay = provLabel ? `${provLabel.first_name} ${provLabel.last_name}, ${provLabel.credentials}` : "auto";
      const selCov = patientCoverages.find((c) => c.coverage_id === selectedCoverageId);
      const payerDisplay = selCov?.payer_name || "auto";

      push("user", `🧾 Generate ${typeLabel} Letter\nProvider: ${provDisplay}\nPayer: ${payerDisplay}\n${selectedRequestId ? `Request: ${selectedRequestId}` : "(latest request)"}`);

      // Step 1: Get full context from clinic DB API
      // The server auto-matches the payer policy using the payer from the selected coverage.
      // User picks the insurance -> system grabs the policy -> feeds into LLM. No manual policy selection.
      const letterCtx = await clinicGenerateLetterContext({
        tenant_id: 1,
        facility_id: cfg.facilityId,
        patient_id: activePatient.patient_id,
        letter_type: letterType,
        request_id: selectedRequestId || undefined,
        provider_id: selectedProviderId || undefined,
        coverage_id: selectedCoverageId || undefined,
      });

      setLastLetterContext(letterCtx);
      const ctx = letterCtx.context;

      // Step 1b: Generate section payloads for section-based pipeline
      let sectionsData: Awaited<ReturnType<typeof clinicGenerateSections>> | null = null;
      try {
        sectionsData = await clinicGenerateSections({
          tenant_id: 1,
          facility_id: cfg.facilityId,
          patient_id: activePatient.patient_id,
          letter_type: letterType,
          template_id: ctx.template?.template_id || undefined,
          request_id: selectedRequestId || ctx.request?.request_id || undefined,
          provider_id: selectedProviderId || ctx.provider?.provider_id || undefined,
          coverage_id: selectedCoverageId || ctx.coverage?.coverage_id || undefined,
        });
      } catch (secErr: any) {
        console.log("Section generation warning (falling back to flat generation):", secErr?.message);
      }

      // Step 2: Build non-PHI packet for the LLM
      let packet = nonPhiPacket;
      let resolvedCaseId = caseId;

      if (!packet) {
        const built = await buildNonPhiPacketForActivePatient({ skipBusy: true });
        if (!built) return;
        packet = built.packet;
        resolvedCaseId = built.caseId;
      }

      assertNoPHI(packet);
      const finalCaseId = resolvedCaseId || packet?.case_id || makeCaseId();
      if (!caseId) setCaseId(finalCaseId);

      // Step 3: Augment the packet with template + policy + sections (non-PHI parts only)
      const augmentedPacket = {
        ...packet,
        letter_type: letterType,
        template: ctx.template
          ? { template_body: ctx.template.template_body, instructions: ctx.template.instructions }
          : null,
        payer_policy: ctx.payer_policy
          ? {
              clinical_criteria: ctx.payer_policy.clinical_criteria,
              required_documents: ctx.payer_policy.required_documents,
              required_failed_therapies: ctx.payer_policy.required_failed_therapies,
              min_therapy_weeks: ctx.payer_policy.min_therapy_weeks,
              guideline_source: ctx.payer_policy.guideline_source,
            }
          : null,
        parent_letter: ctx.parent_letter
          ? {
              denial_reason: ctx.parent_letter.denial_reason,
              denial_code: ctx.parent_letter.denial_code,
              appeal_deadline: ctx.parent_letter.appeal_deadline,
            }
          : null,
        sections: sectionsData?.sections ?? null,
        section_count: sectionsData?.section_count ?? 0,
      };

      // Step 4: Send to n8n/Ollama via existing chatNonPhiCase
      const msg = input.trim() || `generate ${typeLabel.toLowerCase()} letter`;
      if (input.trim()) setInput("");

      const inputForApi: any = {
        ctx: { tenant_id: 1, facility_id: cfg.facilityId, thread_id: threadId, case_id: finalCaseId },
        intent: "generate_preauth_letter",
        message: msg,
        non_phi_packet: augmentedPacket,
        file_ids: pickedFiles.map((f) => f.file_id),
      };

      const resp = await chatNonPhiCase(cfg, inputForApi);
      const out = normalizeChatResponse(resp);

      // Step 5: Reinsert PHI locally
      const filled = await reinsertPHILocally(out.text);

      const generationTimeMs = Date.now() - genStartTime;

      // Step 6: Validate the generated letter
      let validationResult: Awaited<ReturnType<typeof clinicValidateLetter>> | null = null;
      try {
        validationResult = await clinicValidateLetter({
          tenant_id: 1,
          facility_id: cfg.facilityId,
          letter_body: filled,
          sections: sectionsData?.sections?.map((s) => ({ content: s.scaffold_text })),
          policy_id: ctx.payer_policy?.policy_id,
          payer_id: ctx.coverage?.payer_id,
        });
      } catch (valErr: any) {
        console.log("Validation warning:", valErr?.message);
      }

      // Step 7: Save letter to DB
      let savedLetterId: string | undefined;
      try {
        const saveResult = await clinicSaveLetter({
          tenant_id: 1,
          facility_id: cfg.facilityId,
          patient_id: activePatient.patient_id,
          letter_type: letterType,
          letter_body: filled,
          request_id: selectedRequestId || ctx.request?.request_id || undefined,
          template_id: ctx.template?.template_id || undefined,
          coverage_id: ctx.coverage?.coverage_id || undefined,
          payer_id: ctx.coverage?.payer_id || undefined,
          provider_id: selectedProviderId || ctx.provider?.provider_id || undefined,
          subject_line: `${typeLabel} — ${activePatient.display_label}`,
          status: "draft",
        });
        savedLetterId = (saveResult as any)?.letter_id;
      } catch (saveErr: any) {
        console.log("Save letter warning:", saveErr?.message);
        // Non-blocking — letter is still shown to user
      }

      // Step 8: Log the generation with timing + validation data
      try {
        await clinicLogGeneration({
          tenant_id: 1,
          facility_id: cfg.facilityId,
          letter_id: savedLetterId,
          request_id: selectedRequestId || ctx.request?.request_id || undefined,
          patient_id: activePatient.patient_id,
          payer_id: ctx.coverage?.payer_id || undefined,
          provider_id: selectedProviderId || ctx.provider?.provider_id || undefined,
          template_id: ctx.template?.template_id || undefined,
          letter_type: letterType,
          generation_time_ms: generationTimeMs,
          section_count: sectionsData?.section_count ?? 0,
          validation_passed: validationResult?.passed ?? undefined,
          validation_issues: validationResult?.issues ?? undefined,
        });
      } catch (logErr: any) {
        console.log("Generation log warning:", logErr?.message);
        // Non-blocking — letter is still shown to user
      }

      // Show letter to user
      push("assistant", filled, out.artifacts);

      // Step 9: Show validation summary in chat
      if (validationResult) {
        const statusIcon = validationResult.passed ? "✅" : "⚠️";
        const scoreDisplay = validationResult.score != null ? ` (${validationResult.score}%)` : "";
        const criteriaDisplay = `${validationResult.criteria_met}/${validationResult.criteria_total} criteria met`;
        let validationMsg = `${statusIcon} Validation${scoreDisplay}: ${criteriaDisplay}`;
        if (validationResult.issue_count > 0) {
          validationMsg += `\n${validationResult.issue_count} issue(s):`;
          if (validationResult.high_severity_count > 0) validationMsg += ` ${validationResult.high_severity_count} high`;
          if (validationResult.medium_severity_count > 0) validationMsg += ` ${validationResult.medium_severity_count} medium`;
          if (validationResult.low_severity_count > 0) validationMsg += ` ${validationResult.low_severity_count} low`;
          // Show up to 3 high-severity issues inline
          const highIssues = validationResult.issues.filter((i) => i.severity === "high").slice(0, 3);
          for (const issue of highIssues) {
            validationMsg += `\n  • ${issue.message}`;
          }
        }
        push("assistant", validationMsg);
      }

      setLastError("");
      setAttachPacket(true);
      setPatientBarCollapsed(true);

      // Persist letter type preference
      await Storage.setItem(Keys.lastLetterType, letterType).catch(() => {});
    } catch (e: any) {
      push("assistant", `❌ ${e?.message ?? String(e)}`);
      setLastError(`Generate: ${e?.message ?? String(e)}`);
      Alert.alert("Generate Letter Error", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // ──────────── Chat Send (existing, minor updates) ────────────
  async function onSend() {
    const text = input.trim();
    if (!text || busy) return;
    if (!cfg.baseUrl) { Alert.alert("Configuration Error", "Base URL is not configured."); return; }

    setInput("");
    setBusy(true);
    try {
      push("user", text);
      const file_ids = pickedFiles.map((f) => f.file_id);

      if (attachPacket) {
        if (!activePatient?.patient_id) throw new Error("Attach is ON, but no patient selected.");
        let pkt = nonPhiPacket;
        let resolvedCaseId = caseId;
        if (!pkt) {
          const built = await buildNonPhiPacketForActivePatient({ skipBusy: true });
          if (!built) throw new Error("Could not build NON-PHI packet.");
          pkt = built.packet;
          resolvedCaseId = built.caseId;
        }
        assertNoPHI(pkt);
        const finalCaseId = resolvedCaseId || pkt?.case_id || makeCaseId();
        if (!caseId) setCaseId(finalCaseId);

        const inputForApi: any = {
          ctx: { tenant_id: 1, facility_id: cfg.facilityId, thread_id: threadId, case_id: finalCaseId },
          intent,
          message: text,
          non_phi_packet: pkt,
          file_ids,
        };
        const resp = await chatNonPhiCase(cfg, inputForApi);
        const out = normalizeChatResponse(resp);
        const filled = await reinsertPHILocally(out.text);
        push("assistant", filled, out.artifacts);
      } else {
        const resp = await chat(cfg, threadId, text, file_ids, {});
        const out = normalizeChatResponse(resp);
        push("assistant", out.text, out.artifacts);
      }

      setLastError("");
      setPatientBarCollapsed(true);
    } catch (e: any) {
      push("assistant", `❌ ${e?.message ?? String(e)}`);
      setLastError(`Chat: ${e?.message ?? String(e)}`);
      Alert.alert("Chat Error", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // ──────────── UI Components ────────────
  function intentPill(i: NonPhiIntent, label: string) {
    const active = intent === i;
    return (
      <Pressable
        onPress={() => setIntent(i)}
        disabled={busy}
        style={{
          paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
          borderColor: active ? "rgba(31,111,235,0.7)" : UI.border,
          backgroundColor: active ? "rgba(31,111,235,0.25)" : "rgba(148,163,184,0.08)",
          opacity: busy ? 0.75 : 1,
        }}
      >
        <Text style={{ color: active ? UI.text : UI.subtext, fontWeight: "900", fontSize: 12 }}>{label}</Text>
      </Pressable>
    );
  }

  // ✅ NEW: Letter type pill
  function letterTypePill(lt: typeof LETTER_TYPES[number]) {
    const active = letterType === lt.key;
    return (
      <Pressable
        key={lt.key}
        onPress={() => setLetterType(lt.key)}
        disabled={busy}
        style={{
          paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
          borderColor: active ? lt.color : UI.border,
          backgroundColor: active ? `${lt.color}33` : "rgba(148,163,184,0.08)",
          opacity: busy ? 0.75 : 1,
        }}
      >
        <Text style={{ color: active ? UI.text : UI.subtext, fontWeight: "900", fontSize: 12 }}>{lt.label}</Text>
      </Pressable>
    );
  }

  function Bubble({ item }: { item: Msg }) {
    if (item.role === "system") {
      return (
        <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={{ color: UI.subtext, fontSize: 13, textAlign: "center", lineHeight: 18 }}>{item.content}</Text>
        </View>
      );
    }
    const isUser = item.role === "user";
    return (
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, alignItems: isUser ? "flex-end" : "flex-start" }}>
        <View style={{ maxWidth: "86%", backgroundColor: isUser ? UI.primary : UI.card, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderWidth: isUser ? 0 : 1, borderColor: UI.border }}>
          <Text style={{ color: isUser ? UI.primaryText : UI.text, fontSize: 15, lineHeight: 20 }}>{item.content}</Text>
          {item.artifacts?.map((a, i) =>
            a.type === "pdf" ? (
              <View key={i} style={{ marginTop: 10 }}>
                <Text style={{ color: isUser ? "#eaf2ff" : UI.text, fontWeight: "900", marginBottom: 8 }}>PDF</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <Pressable onPress={() => openPdfArtifact(a).catch((e) => Alert.alert("Open PDF", e?.message ?? String(e)))} disabled={busy}
                    style={{ backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", opacity: busy ? 0.7 : 1 }}>
                    <Text style={{ color: isUser ? "#fff" : UI.text, fontWeight: "900" }}>Open</Text>
                  </Pressable>
                  <Pressable onPress={() => copyPdfLink(a).then((url) => Alert.alert("Copied", url)).catch((e) => Alert.alert("Copy Link", e?.message ?? String(e)))} disabled={busy}
                    style={{ backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", opacity: busy ? 0.7 : 1 }}>
                    <Text style={{ color: isUser ? "#fff" : UI.text, fontWeight: "900" }}>Copy</Text>
                  </Pressable>
                  <Pressable onPress={() => sharePdfLink(a).catch((e) => Alert.alert("Share Link", e?.message ?? String(e)))} disabled={busy}
                    style={{ backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", opacity: busy ? 0.7 : 1 }}>
                    <Text style={{ color: isUser ? "#fff" : UI.text, fontWeight: "900" }}>Share</Text>
                  </Pressable>
                </View>
              </View>
            ) : null
          )}
        </View>
      </View>
    );
  }

  function PatientRow({ item }: { item: PatientRowPHI }) {
    const isActive = activePatient?.patient_id === item.patient_id;
    return (
      <Pressable onPress={() => selectPatient(item)} disabled={busy}
        style={{ backgroundColor: isActive ? "rgba(22,163,74,0.18)" : UI.card, borderWidth: 1, borderColor: isActive ? "rgba(22,163,74,0.35)" : UI.border, padding: 12, marginHorizontal: 12, marginTop: 10, borderRadius: 14, opacity: busy ? 0.7 : 1 }}>
        <Text style={{ color: UI.text, fontSize: 14, fontWeight: "900" }} numberOfLines={1}>{item.full_name || item.patient_id}</Text>
        <Text style={{ color: UI.subtext, fontSize: 12, marginTop: 4 }}>ID: {item.patient_id}{item.dob ? `  •  DOB: ${item.dob}` : ""}</Text>
      </Pressable>
    );
  }

  function PatientPanel() {
    return (
      <View style={{ flex: 1, backgroundColor: UI.panelBg }}>
        <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: UI.border }}>
          <Text style={{ color: UI.subtext, fontSize: 12, fontWeight: "800" }}>Active</Text>
          <Text style={{ color: UI.text, fontWeight: "900", marginTop: 6, fontSize: 14 }} numberOfLines={1}>{activePatient ? activePatient.display_label : "None"}</Text>
          {!!backgroundPreview && (
            <View style={{ marginTop: 10, backgroundColor: UI.card, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: UI.border }}>
              <Text style={{ color: UI.subtext, fontSize: 12, lineHeight: 18 }}>{backgroundPreview}</Text>
            </View>
          )}
        </View>
        <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: UI.border }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <TextInput value={searchQuery} onChangeText={setSearchQuery} placeholder="Search name, ID, DOB…" placeholderTextColor={UI.subtext}
              style={{ flex: 1, color: UI.text, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: UI.border, backgroundColor: UI.bg }}
              editable={!busy} autoFocus autoCorrect={false} autoCapitalize="none" returnKeyType="search" clearButtonMode="while-editing" onSubmitEditing={searchPatientsClinicOnly} />
            <Pressable onPress={searchPatientsClinicOnly} disabled={busy}
              style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: UI.primary, opacity: busy ? 0.7 : 1 }}>
              <Text style={{ color: "#fff", fontWeight: "900" }}>Search</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <Pressable onPress={testClinicApi} disabled={busy} style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: UI.btn, borderWidth: 1, borderColor: UI.border, opacity: busy ? 0.7 : 1 }}>
              <Text style={{ color: UI.btnText, fontWeight: "900" }}>Test API</Text>
            </Pressable>
            <Pressable onPress={clearPatientSearch} disabled={busy} style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: UI.btn, borderWidth: 1, borderColor: UI.border, opacity: busy ? 0.7 : 1 }}>
              <Text style={{ color: UI.btnText, fontWeight: "900" }}>Clear</Text>
            </Pressable>
            <Pressable onPress={() => setPatientPanelOpen(false)} disabled={busy} style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: UI.btn, borderWidth: 1, borderColor: UI.border, opacity: busy ? 0.7 : 1 }}>
              <Text style={{ color: UI.btnText, fontWeight: "900" }}>Close</Text>
            </Pressable>
          </View>
          {!!searchStatus && <Text style={{ color: UI.subtext, marginTop: 10, fontSize: 12 }}>{searchStatus}</Text>}
          {!!lastError && <Text style={{ color: UI.danger, marginTop: 10, fontSize: 12 }} numberOfLines={3}>{lastError}</Text>}
        </View>
        <FlatList data={searchResults} keyExtractor={(p) => String(p.patient_id)} renderItem={({ item }) => <PatientRow item={item} />}
          keyboardShouldPersistTaps="always" keyboardDismissMode="on-drag"
          ListEmptyComponent={<Text style={{ color: UI.subtext, textAlign: "center", padding: 20 }}>{searchQuery.trim() ? "No matches found." : "Search the clinic DB to begin."}</Text>}
          contentContainerStyle={{ paddingBottom: 24 }} />
      </View>
    );
  }

  const drawerWidth = Math.min(420, Math.floor(Dimensions.get("window").width * 0.88));

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <View style={{ flex: 1, backgroundColor: UI.bg, paddingTop: insets.top }}>
      {/* Patient Search Drawer */}
      {patientPanelOpen ? (
        <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: UI.overlay, zIndex: 999, elevation: 999, flexDirection: "row" }}>
          <Pressable onPress={() => setPatientPanelOpen(false)} style={{ flex: 1 }} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: drawerWidth, height: "100%", backgroundColor: UI.panelBg, borderLeftWidth: 1, borderLeftColor: UI.border }}>
            <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: UI.border, backgroundColor: "rgba(15,23,42,0.85)" }}>
              <Text style={{ color: UI.text, fontWeight: "900", fontSize: 14 }}>Patient Search</Text>
            </View>
            <PatientPanel />
          </KeyboardAvoidingView>
        </View>
      ) : null}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}>
        {/* Message list */}
        <FlatList ref={listRef} style={{ flex: 1 }} data={messages} inverted keyExtractor={(m) => m.id}
          renderItem={({ item }) => <Bubble item={item} />} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          removeClippedSubviews={false} contentContainerStyle={{ paddingTop: 12, paddingBottom: 12 }} />

        {/* Bottom control panel */}
        <View style={{ padding: 12, paddingBottom: Math.max(12, insets.bottom + 12), borderTopWidth: 1, borderTopColor: UI.border, backgroundColor: UI.bg }}>

          {/* Active Patient Bar */}
          <View style={{ backgroundColor: UI.card, borderWidth: 1, borderColor: UI.border, borderRadius: 16, padding: 12, gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: UI.subtext, fontSize: 12, fontWeight: "800" }}>Active Patient</Text>
                <Text style={{ color: activePatient ? UI.text : UI.danger, fontSize: 14, fontWeight: "900", marginTop: 4 }} numberOfLines={1}>
                  {activePatient ? activePatient.display_label : "None selected"}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Chip label={patientBackgroundRaw ? "Context" : "No ctx"} tone={patientBackgroundRaw ? "success" : "neutral"} compact />
                <Pressable onPress={() => setPatientBarCollapsed((v) => !v)} disabled={busy}
                  style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: UI.btn, borderWidth: 1, borderColor: UI.border, opacity: busy ? 0.7 : 1 }}>
                  <Text style={{ color: UI.btnText, fontWeight: "900", fontSize: 12 }}>{patientBarCollapsed ? "Show" : "Hide"}</Text>
                </Pressable>
              </View>
            </View>

            {!patientBarCollapsed ? (
              <>
                {lastError ? <Text style={{ color: UI.danger, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{lastError}</Text> : null}

                {/* ✅ Letter Type Selector */}
                <View>
                  <Text style={{ color: UI.subtext, fontSize: 11, fontWeight: "800", marginBottom: 6 }}>LETTER TYPE</Text>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    {LETTER_TYPES.map((lt) => letterTypePill(lt))}
                  </View>
                </View>

                {/* ✅ Provider Selector */}
                {providers.length > 0 ? (
                  <View>
                    <Text style={{ color: UI.subtext, fontSize: 11, fontWeight: "800", marginBottom: 6 }}>PROVIDER</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: "row" }}>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        {providers.map((prov) => {
                          const active = selectedProviderId === prov.provider_id;
                          return (
                            <Pressable
                              key={prov.provider_id}
                              onPress={async () => {
                                setSelectedProviderId(prov.provider_id);
                                await Storage.setItem(Keys.activeProviderId, prov.provider_id).catch(() => {});
                              }}
                              disabled={busy}
                              style={{
                                paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
                                borderColor: active ? UI.success : UI.border,
                                backgroundColor: active ? "rgba(22,163,74,0.25)" : "rgba(148,163,184,0.08)",
                                opacity: busy ? 0.75 : 1,
                              }}
                            >
                              <Text style={{ color: active ? UI.text : UI.subtext, fontWeight: "900", fontSize: 12 }}>
                                {prov.last_name}, {prov.credentials}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </ScrollView>
                  </View>
                ) : null}

                {/* ✅ NEW: Payer/Insurance Selector */}
                {patientCoverages.length > 0 ? (
                  <View>
                    <Text style={{ color: UI.subtext, fontSize: 11, fontWeight: "800", marginBottom: 6 }}>INSURANCE / PAYER</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        {patientCoverages.map((cov) => {
                          const active = selectedCoverageId === cov.coverage_id;
                          const label = cov.payer_name
                            ? `${cov.payer_name}${cov.plan_name ? ` (${cov.plan_name})` : ""}`
                            : cov.coverage_id;
                          return (
                            <Pressable
                              key={cov.coverage_id}
                              onPress={() => setSelectedCoverageId(cov.coverage_id)}
                              disabled={busy}
                              style={{
                                paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
                                borderColor: active ? UI.warn : UI.border,
                                backgroundColor: active ? "rgba(245,158,11,0.25)" : "rgba(148,163,184,0.08)",
                                opacity: busy ? 0.75 : 1,
                              }}
                            >
                              <Text style={{ color: active ? UI.text : UI.subtext, fontWeight: "900", fontSize: 11 }} numberOfLines={1}>
                                {label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </ScrollView>
                  </View>
                ) : null}

                {/* ✅ Request Selector (if patient has multiple) */}
                {patientRequests.length > 0 ? (
                  <View>
                    <Text style={{ color: UI.subtext, fontSize: 11, fontWeight: "800", marginBottom: 6 }}>PA REQUEST</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        {patientRequests.map((req) => {
                          const active = selectedRequestId === req.request_id;
                          return (
                            <Pressable
                              key={req.request_id}
                              onPress={() => setSelectedRequestId(req.request_id)}
                              disabled={busy}
                              style={{
                                paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
                                borderColor: active ? UI.info : UI.border,
                                backgroundColor: active ? "rgba(14,165,233,0.25)" : "rgba(148,163,184,0.08)",
                                opacity: busy ? 0.75 : 1,
                              }}
                            >
                              <Text style={{ color: active ? UI.text : UI.subtext, fontWeight: "900", fontSize: 11 }} numberOfLines={1}>
                                {req.cpt_code || "?"} — {(req.service_name || req.cpt_description || req.request_id).slice(0, 30)}
                                {req.status ? ` (${req.status})` : ""}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </ScrollView>
                  </View>
                ) : null}

                {/* Action Buttons */}
                <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                  <Pressable onPress={() => setPatientPanelOpen(true)} disabled={busy}
                    style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: UI.primary, opacity: busy ? 0.7 : 1, alignItems: "center", minWidth: 90 }}>
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Search</Text>
                  </Pressable>

                  <Pressable onPress={onGenerateLetter} disabled={busy || !activePatient}
                    style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: UI.success, opacity: busy || !activePatient ? 0.55 : 1, alignItems: "center", minWidth: 130 }}>
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Generate Letter</Text>
                  </Pressable>

                  <Pressable
                    onPress={async () => {
                      if (!attachPacket) {
                        if (!activePatient?.patient_id) { Alert.alert("Select a patient first"); return; }
                        if (!nonPhiPacket) { await buildNonPhiPacketForActivePatient(); return; }
                        setAttachPacket(true);
                        return;
                      }
                      setAttachPacket(false);
                    }}
                    disabled={busy}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
                      backgroundColor: attachPacket ? UI.success : UI.btn,
                      borderWidth: attachPacket ? 0 : 1, borderColor: attachPacket ? "transparent" : UI.border,
                      opacity: busy ? 0.7 : 1, alignItems: "center", minWidth: 90,
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{attachPacket ? "Attach ✓" : "Attach"}</Text>
                  </Pressable>
                </View>

                {/* Intent pills for free chat */}
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {intentPill("generate_preauth_letter", "Letter")}
                  {intentPill("medical_necessity_summary", "Necessity")}
                  {intentPill("criteria_checklist", "Checklist")}
                  {intentPill("letter_revise", "Revise")}
                </View>
              </>
            ) : null}
          </View>

          {/* Composer row */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Pressable onPress={onPickFile} disabled={busy}
              style={{ paddingHorizontal: 14, justifyContent: "center", borderRadius: 14, backgroundColor: UI.btn, borderWidth: 1, borderColor: UI.border, opacity: busy ? 0.7 : 1 }}>
              <Text style={{ color: UI.btnText, fontWeight: "900" }}>Upload</Text>
            </Pressable>

            <TextInput value={input} onChangeText={setInput} placeholder="Message…" placeholderTextColor={UI.subtext}
              style={{ flex: 1, color: UI.text, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: UI.border, backgroundColor: UI.card2 }}
              editable={!busy} onSubmitEditing={onSend} returnKeyType="send" />

            <Pressable onPress={onSend} disabled={busy}
              style={{ paddingHorizontal: 18, justifyContent: "center", borderRadius: 14, backgroundColor: busy ? "rgba(31,111,235,0.45)" : UI.primary, opacity: busy ? 0.8 : 1 }}>
              <Text style={{ color: UI.primaryText, fontWeight: "900" }}>{busy ? "…" : "Send"}</Text>
            </Pressable>
          </View>

          {/* Footer */}
          <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between" }}>
            <Pressable onPress={clearActivePatientEverywhere} disabled={busy}
              style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: UI.btn, borderWidth: 1, borderColor: UI.border, opacity: busy ? 0.7 : 1 }}>
              <Text style={{ color: UI.btnText, fontWeight: "900", fontSize: 12 }}>Clear Patient</Text>
            </Pressable>
            <Text style={{ color: UI.subtext, fontSize: 12, marginTop: 10 }}>Attachments: {pickedFiles.length}</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}