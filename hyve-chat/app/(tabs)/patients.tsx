// app/(tabs)/patients.tsx
import React, { useEffect, useMemo, useState } from "react";
import { setActivePatient } from "../lib/patientContext";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { LocalPHIDatabase, PatientPHI } from "../lib/localDB";
import {
  Config as ApiConfig,
  clinicPatientsSearch,
  clinicPatientBackground,
  sendNonPHICase,
} from "../lib/api";

import { toNonPHICasePacket } from "../lib/phiScrubber";
import { assertNoPHI } from "../lib/phiFirewall";

const db = new LocalPHIDatabase();

function notify(title: string, message: string) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

function isDobValid(dob: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dob.trim());
}

// ⚠️ HIPAA guardrail: Do NOT persist clinic DB PHI into local storage unless clinic policy allows.
const ALLOW_REMOTE_PHI_CACHE = false;

export default function PatientsScreen() {
  const [patients, setPatients] = useState<PatientPHI[]>([]);
  const [search, setSearch] = useState("");

  const [editMode, setEditMode] = useState(false);
  const [editPatient, setEditPatient] = useState<Partial<PatientPHI>>({});

  const [status, setStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Background (PHI may be present) — keep local only
  const [backgroundPreview, setBackgroundPreview] = useState<string>("");

  const cfg: ApiConfig = useMemo(
    () => ({
      baseUrl: process.env.EXPO_PUBLIC_BASE_URL || "https://n8n.hyveappliedintelligence.com",
      apiKey: process.env.EXPO_PUBLIC_API_KEY || "",
      facilityId: process.env.EXPO_PUBLIC_FACILITY_ID || "FAC-DEMO",
    }),
    []
  );

  useEffect(() => {
    loadPatients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPatients() {
    try {
      setStatus("");
      const results = await db.searchPatients("");
      setPatients(results);
    } catch (e: any) {
      console.log("LOAD PATIENTS ERROR:", e);
      setStatus(`Load failed: ${e?.message ?? String(e)}`);
      notify("Error", e?.message ?? String(e));
    }
  }

  async function clearSearch() {
    setSearch("");
    setStatus("");
    setBackgroundPreview("");
    try {
      const results = await db.searchPatients("");
      setPatients(results);
    } catch {}
  }

  async function searchPatientsLocalThenClinic() {
    try {
      const q = search.trim();
      setBackgroundPreview("");
      setStatus("Searching…");

      const local = await db.searchPatients(q);
      setPatients(local);

      if (!q) {
        setStatus("");
        return;
      }

      if (local.length > 0) {
        setStatus(`Found ${local.length} local`);
        return;
      }

      setStatus("No local matches. Searching clinic DB…");

      const remote = await clinicPatientsSearch({
        tenant_id: 1,
        facility_id: cfg.facilityId,
        query: q,
      });

      if (!ALLOW_REMOTE_PHI_CACHE) {
        const remoteAsLocalShape: PatientPHI[] = remote.map((p) => {
          const first = (p.first_name || "").trim();
          const last = (p.last_name || "").trim();
          const full = (p.full_name || `${first} ${last}`.trim() || p.patient_id).trim();

          return {
            patient_id: p.patient_id,
            full_name: full,
            first_name: first,
            last_name: last,
            dob: (p.dob || "").trim(),
            insurance_member_id: p.insurance_member_id ?? undefined,
            insurance_group_number: p.insurance_group_number ?? undefined,
          };
        });

        setPatients(remoteAsLocalShape);
        setStatus(remote.length ? `Found ${remote.length} clinic results` : "No matches");
        return;
      }

      for (const p of remote) {
        const first = (p.first_name || "").trim();
        const last = (p.last_name || "").trim();
        const full = (p.full_name || `${first} ${last}`.trim() || p.patient_id).trim();

        await db.storePatientPHI({
          patient_id: p.patient_id,
          full_name: full,
          first_name: first,
          last_name: last,
          dob: (p.dob || "").trim(),
          insurance_member_id: p.insurance_member_id ?? undefined,
          insurance_group_number: p.insurance_group_number ?? undefined,
        });
      }

      const merged = await db.searchPatients(q);
      setPatients(merged);

      setStatus(remote.length ? `Found ${remote.length} clinic results (cached)` : "No matches");
    } catch (e: any) {
      console.log("SEARCH ERROR:", e);
      setStatus(`Search failed: ${e?.message ?? String(e)}`);
      notify("Search failed", e?.message ?? String(e));
    }
  }

  async function testClinicApi() {
    try {
      setStatus("Testing clinic API…");

      const out = await clinicPatientsSearch({
        tenant_id: 1,
        facility_id: cfg.facilityId,
        query: "smith",
      });

      setStatus(`Clinic API OK ✅ (${out.length} result(s))`);
      notify("Clinic API OK ✅", `Returned ${out.length} result(s).`);
    } catch (e: any) {
      setStatus(`Clinic API FAILED: ${e?.message ?? String(e)}`);
      notify("Clinic API FAILED", e?.message ?? String(e));
    }
  }

  async function savePatient() {
    const patient_id = (editPatient.patient_id ?? "").trim();
    const full_name = (editPatient.full_name ?? "").trim();
    const first_name = (editPatient.first_name ?? "").trim();
    const last_name = (editPatient.last_name ?? "").trim();
    const dob = (editPatient.dob ?? "").trim();

    if (!patient_id) return notify("Error", "patient_id required");
    if (!full_name) return notify("Error", "full_name required");
    if (!first_name) return notify("Error", "first_name required");
    if (!last_name) return notify("Error", "last_name required");
    if (!dob) return notify("Error", "dob required (YYYY-MM-DD)");
    if (!isDobValid(dob)) return notify("Error", "dob must be YYYY-MM-DD");

    try {
      setSaving(true);
      setStatus("Saving…");

      await db.storePatientPHI({
        patient_id,
        full_name,
        first_name,
        last_name,
        dob,
        insurance_member_id: (editPatient.insurance_member_id ?? "").trim() || undefined,
        insurance_group_number: (editPatient.insurance_group_number ?? "").trim() || undefined,
      });

      setStatus("Saved ✅");

      setSearch("");
      setEditMode(false);
      setEditPatient({});
      setBackgroundPreview("");

      const refreshed = await db.searchPatients("");
      setPatients(refreshed);

      notify("Saved", "Patient PHI saved locally");
    } catch (e: any) {
      console.log("SAVE FAILED:", e);
      setStatus(`Save failed: ${e?.message ?? String(e)}`);
      notify("Save failed", e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

async function openPatientAndLoadBackground(p: PatientPHI) {
  // ✅ Local-only: make this patient the active selection for Chat tab
  await setActivePatient({
    patient_id: p.patient_id,
    display_label: p.full_name || p.patient_id,
  });

  try {
    setStatus("Loading background…");
    setBackgroundPreview("");

    setEditPatient(p);
    setEditMode(true);

    const bg = await clinicPatientBackground({
      tenant_id: 1,
      facility_id: cfg.facilityId,
      patient_id: p.patient_id,
    });

    const problems = (bg.problems || []).map((x) => x.icd10_code).slice(0, 6);
    const therapies = (bg.therapies || []).map((x) => x.therapy_type).slice(0, 6);
    const imaging = (bg.imaging || []).map((x) => x.modality).slice(0, 6);

    setBackgroundPreview(
      `Problems: ${problems.length ? problems.join(", ") : "none"}\n` +
        `Therapies: ${therapies.length ? therapies.join(", ") : "none"}\n` +
        `Imaging: ${imaging.length ? imaging.join(", ") : "none"}`
    );

    setStatus("Background loaded ✅ (Active for Chat)");
  } catch (e: any) {
    console.log("BACKGROUND LOAD ERROR:", e);
    setStatus(`Background load failed: ${e?.message ?? String(e)}`);
    notify("Background load failed", e?.message ?? String(e));
  }
}

  async function sendSelectedPatientNonPHI() {
    try {
      if (!editPatient?.patient_id) {
        notify("No patient selected", "Open a patient and try again.");
        return;
      }
      if (!cfg.apiKey) {
        notify("Missing API key", "Set EXPO_PUBLIC_API_KEY to send non-PHI packets to n8n.");
        return;
      }

      const bg = await clinicPatientBackground({
        tenant_id: 1,
        facility_id: cfg.facilityId,
        patient_id: editPatient.patient_id,
      });

      const packet = toNonPHICasePacket({
        facility_id: cfg.facilityId,
        background: bg,
        correlation_mode: "per_case",
      });

      assertNoPHI(packet);
      await sendNonPHICase(cfg, packet);

      notify("Sent ✅", "Non-PHI packet sent to n8n (PHI stayed local).");
    } catch (e: any) {
      console.log("SEND NONPHI FAILED:", e);
      notify("Send failed", e?.message ?? String(e));
    }
  }

  const Header = (
    <View>
      <Text style={styles.header}>Patient PHI (Local Only)</Text>
      <Text style={styles.subheader}>❌ PHI stays local — only de-identified packets can be sent</Text>

      {!!status && <Text style={styles.status}>{status}</Text>}

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search patients..."
          placeholderTextColor="#999"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          onSubmitEditing={searchPatientsLocalThenClinic}
        />

        <Pressable style={styles.clearBtn} onPress={testClinicApi}>
          <Text style={styles.btnText}>Test API</Text>
        </Pressable>

        <Pressable style={styles.searchBtn} onPress={searchPatientsLocalThenClinic}>
          <Text style={styles.btnText}>Search</Text>
        </Pressable>

        <Pressable style={styles.clearBtn} onPress={clearSearch}>
          <Text style={styles.btnText}>Clear</Text>
        </Pressable>
      </View>

      {!editMode && (
        <Pressable
          style={styles.addBtn}
          onPress={() => {
            setStatus("");
            setBackgroundPreview("");
            setEditPatient({
              patient_id: `P-${Date.now()}`,
              full_name: "",
              first_name: "",
              last_name: "",
              dob: "",
              insurance_member_id: "",
              insurance_group_number: "",
            });
            setEditMode(true);
          }}
        >
          <Text style={styles.btnText}>+ Add Patient</Text>
        </Pressable>
      )}

      {editMode && (
        <View style={styles.editForm}>
          <Text style={styles.editHeader}>
            {editPatient.patient_id?.startsWith("P-") ? "New Patient" : "Edit Patient"}
          </Text>

          <Text style={styles.label}>Patient ID</Text>
          <TextInput
            style={styles.input}
            value={editPatient.patient_id ?? ""}
            onChangeText={(v) => setEditPatient({ ...editPatient, patient_id: v })}
            placeholder="PAT-001"
            editable={!!editPatient.patient_id?.startsWith("P-")}
          />

          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input}
            value={editPatient.full_name ?? ""}
            onChangeText={(v) => setEditPatient({ ...editPatient, full_name: v })}
            placeholder="John Smith"
          />

          <Text style={styles.label}>First Name</Text>
          <TextInput
            style={styles.input}
            value={editPatient.first_name ?? ""}
            onChangeText={(v) => setEditPatient({ ...editPatient, first_name: v })}
            placeholder="John"
          />

          <Text style={styles.label}>Last Name</Text>
          <TextInput
            style={styles.input}
            value={editPatient.last_name ?? ""}
            onChangeText={(v) => setEditPatient({ ...editPatient, last_name: v })}
            placeholder="Smith"
          />

          <Text style={styles.label}>Date of Birth (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={editPatient.dob ?? ""}
            onChangeText={(v) => setEditPatient({ ...editPatient, dob: v })}
            placeholder="1980-05-15"
            autoCapitalize="none"
          />

          <Text style={styles.label}>Member ID</Text>
          <TextInput
            style={styles.input}
            value={editPatient.insurance_member_id ?? ""}
            onChangeText={(v) => setEditPatient({ ...editPatient, insurance_member_id: v })}
            placeholder="UHC123456"
          />

          <Text style={styles.label}>Group Number</Text>
          <TextInput
            style={styles.input}
            value={editPatient.insurance_group_number ?? ""}
            onChangeText={(v) => setEditPatient({ ...editPatient, insurance_group_number: v })}
            placeholder="GRP789"
          />

          {!!backgroundPreview && (
            <View style={styles.bgBox}>
              <Text style={styles.bgTitle}>Local Background Preview</Text>
              <Text style={styles.bgText}>{backgroundPreview}</Text>
            </View>
          )}

          <View style={styles.btnRow}>
            <Pressable
              style={[styles.saveBtn, saving && styles.btnDisabled]}
              onPress={savePatient}
              disabled={saving}
            >
              <Text style={styles.btnText}>{saving ? "Saving…" : "Save"}</Text>
            </Pressable>

            <Pressable
              style={[styles.cancelBtn, saving && styles.btnDisabled]}
              onPress={() => {
                setEditMode(false);
                setEditPatient({});
                setStatus("");
                setBackgroundPreview("");
              }}
              disabled={saving}
            >
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
          </View>

          <Pressable style={styles.nonPhiBtn} onPress={sendSelectedPatientNonPHI}>
            <Text style={styles.btnText}>Send NON-PHI Packet</Text>
          </Pressable>

          {!cfg.apiKey && (
            <Text style={styles.hint}>
              Sending disabled: set EXPO_PUBLIC_API_KEY in your .env to send non-PHI packets to n8n.
            </Text>
          )}
        </View>
      )}

      <Text style={styles.hint}>
        Clinic API: EXPO_PUBLIC_CLINIC_API_URL + EXPO_PUBLIC_BRIDGE_TOKEN must be set to search clinic DB.
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <FlatList
        data={patients}
        keyExtractor={(item) => item.patient_id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={Header}
        ListEmptyComponent={
          <Text style={styles.emptyText}>{search.trim() ? "No matches." : "No patients saved yet."}</Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.patientCard} onPress={() => openPatientAndLoadBackground(item)}>
            <Text style={styles.patientName}>{item.full_name}</Text>
            <Text style={styles.patientDetail}>ID: {item.patient_id}</Text>
            <Text style={styles.patientDetail}>DOB: {item.dob}</Text>
            {item.insurance_member_id ? (
              <Text style={styles.patientDetail}>Member: {item.insurance_member_id}</Text>
            ) : null}
          </Pressable>
        )}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  listContent: { padding: 16, paddingBottom: 48 },

  header: { color: "#fff", fontSize: 20, fontWeight: "700" },
  subheader: { color: "#94a3b8", fontSize: 12, marginTop: 4 },

  status: { color: "#e2e8f0", marginTop: 8, marginBottom: 4 },
  hint: { color: "#94a3b8", fontSize: 12, marginTop: 10 },

  searchRow: { flexDirection: "row", marginTop: 12, gap: 8 },
  searchInput: {
    flex: 1,
    backgroundColor: "#020617",
    color: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  searchBtn: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    justifyContent: "center",
  },
  clearBtn: {
    backgroundColor: "#334155",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    justifyContent: "center",
  },

  addBtn: {
    backgroundColor: "#16a34a",
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 12,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "600" },
  btnDisabled: { opacity: 0.6 },

  editForm: {
    backgroundColor: "#1e293b",
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  editHeader: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 8 },
  label: { color: "#94a3b8", fontSize: 12, marginTop: 8 },
  input: {
    backgroundColor: "#020617",
    color: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  saveBtn: {
    flex: 1,
    backgroundColor: "#16a34a",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: "#64748b",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },

  bgBox: {
    backgroundColor: "#0b1220",
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#22304a",
  },
  bgTitle: { color: "#e2e8f0", fontWeight: "700", marginBottom: 6 },
  bgText: { color: "#94a3b8", fontSize: 12, lineHeight: 16 },

  nonPhiBtn: {
    backgroundColor: "#0ea5e9",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },

  patientCard: {
    backgroundColor: "#1e293b",
    padding: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  patientName: { color: "#fff", fontSize: 16, fontWeight: "700" },
  patientDetail: { color: "#94a3b8", fontSize: 12, marginTop: 4 },

  emptyText: { color: "#94a3b8", marginTop: 16, textAlign: "center" },
});
