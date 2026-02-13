// app/components/PatientPickerModal.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  Platform,
  Alert,
} from "react-native";

import { LocalPHIDatabase, PatientPHI } from "../lib/localDB";
import { clinicPatientsSearch, Config as ApiConfig, RemotePatient } from "../lib/api";

export type PatientPickerResult = {
  patient_id: string;
  full_name: string; // local-only display label
};

const db = new LocalPHIDatabase();

const UI = {
  backdrop: "rgba(0,0,0,0.6)",
  panel: "#0b0f14",
  border: "#223043",
  headerText: "#e8eef7",
  subtleText: "#9fb0c3",
  inputBg: "#121a24",
  inputText: "#e8eef7",
  card: "#121a24",
  primary: "#1f6feb",
  button: "#1e293b",
};

function notify(title: string, message: string) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

export default function PatientPickerModal(props: {
  visible: boolean;
  onClose: () => void;
  cfg: ApiConfig;
  onSelect: (p: PatientPickerResult) => void;
}) {
  const { visible, onClose, cfg, onSelect } = props;

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<PatientPickerResult[]>([]);
  const [busy, setBusy] = useState(false);

  const canClinicSearch = useMemo(() => {
    // clinicPatientsSearch will throw if EXPO_PUBLIC_CLINIC_API_URL / BRIDGE token missing
    return true;
  }, []);

  useEffect(() => {
    if (!visible) return;
    setQ("");
    setStatus("");
    setRows([]);
    // load default list from local cache
    (async () => {
      try {
        const local = await db.searchPatients("");
        setRows(
          local.map((p) => ({
            patient_id: p.patient_id,
            full_name: p.full_name || p.patient_id,
          }))
        );
      } catch {}
    })();
  }, [visible]);

  async function runSearch() {
    try {
      const query = q.trim();
      setBusy(true);
      setStatus("Searching…");

      // 1) Local first
      const local: PatientPHI[] = await db.searchPatients(query);
      if (local.length > 0 || !query) {
        setRows(
          local.map((p) => ({
            patient_id: p.patient_id,
            full_name: p.full_name || p.patient_id,
          }))
        );
        setStatus(query ? `Found ${local.length} local` : "");
        return;
      }

      // 2) Clinic search (still local/LAN)
      setStatus("No local matches. Searching clinic DB…");
      const remote: RemotePatient[] = await clinicPatientsSearch({
        tenant_id: 1,
        facility_id: cfg.facilityId,
        query,
      });

      setRows(
        remote.map((p) => ({
          patient_id: p.patient_id,
          full_name:
            String(p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.patient_id)
              .trim(),
        }))
      );

      setStatus(remote.length ? `Found ${remote.length} clinic results` : "No matches");
    } catch (e: any) {
      setStatus("Search failed");
      notify("Patient search failed", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: UI.backdrop,
          padding: 18,
          justifyContent: "center",
        }}
      >
        <View
          style={{
            backgroundColor: UI.panel,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: UI.border,
            overflow: "hidden",
            maxHeight: "85%",
          }}
        >
          {/* Header */}
          <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: UI.border }}>
            <Text style={{ color: UI.headerText, fontSize: 16, fontWeight: "900" }}>
              Select Patient (Local Only)
            </Text>
            <Text style={{ color: UI.subtleText, fontSize: 12, marginTop: 4 }}>
              Search local cache first, then clinic DB (still on-prem).
            </Text>
            {!!status && (
              <Text style={{ color: UI.subtleText, fontSize: 12, marginTop: 8 }}>{status}</Text>
            )}
          </View>

          {/* Search */}
          <View style={{ padding: 14, gap: 10 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Search (name or id)…"
                placeholderTextColor={UI.subtleText}
                style={{
                  flex: 1,
                  backgroundColor: UI.inputBg,
                  color: UI.inputText,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: UI.border,
                }}
                editable={!busy}
                returnKeyType="search"
                onSubmitEditing={runSearch}
              />
              <Pressable
                onPress={runSearch}
                disabled={busy || (!canClinicSearch && !q.trim())}
                style={{
                  backgroundColor: UI.primary,
                  paddingHorizontal: 14,
                  justifyContent: "center",
                  borderRadius: 12,
                  opacity: busy ? 0.7 : 1,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>{busy ? "…" : "Search"}</Text>
              </Pressable>
            </View>

            <Pressable
              onPress={onClose}
              style={{
                backgroundColor: UI.button,
                paddingVertical: 10,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: UI.border,
                alignItems: "center",
              }}
            >
              <Text style={{ color: UI.headerText, fontWeight: "900" }}>Close</Text>
            </Pressable>
          </View>

          {/* List */}
          <FlatList
            data={rows}
            keyExtractor={(x) => x.patient_id}
            contentContainerStyle={{ padding: 14, paddingTop: 0, paddingBottom: 18 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onSelect(item)}
                style={{
                  backgroundColor: UI.card,
                  borderWidth: 1,
                  borderColor: UI.border,
                  borderRadius: 14,
                  padding: 12,
                  marginTop: 10,
                }}
              >
                <Text style={{ color: UI.headerText, fontSize: 15, fontWeight: "900" }}>
                  {item.full_name}
                </Text>
                <Text style={{ color: UI.subtleText, fontSize: 12, marginTop: 4 }}>
                  ID: {item.patient_id}
                </Text>
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}
