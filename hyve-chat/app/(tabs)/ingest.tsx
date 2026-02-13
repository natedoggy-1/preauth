// app/(tabs)/ingest.tsx
import React, { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect } from "@react-navigation/native";

import { Storage, Keys } from "../lib/storage";
import { ingest as ingestApi, DocRole } from "../lib/api";

const UI = {
  bg: "#0b0f14",
  text: "#e8eef7",
  subtle: "#9fb0c3",
  border: "#223043",
  btn: "#1f6feb",
  btnText: "#ffffff",
  btnAlt: "#121a24",
  danger: "#ff6b6b",
};

type Picked = {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
};

function guessMime(name: string): string {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".txt")) return "text/plain";
  if (n.endsWith(".md")) return "text/markdown";
  if (n.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

export default function IngestScreen() {
  const insets = useSafeAreaInsets();

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [facilityId, setFacilityId] = useState("FAC-001");

  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);

  // doc role toggle
  const [docRole, setDocRole] = useState<DocRole>("doc");

  // Optional classification keys
  const [templateKey, setTemplateKey] = useState<string>("");
  const [policyKey, setPolicyKey] = useState<string>("");
  const [payerKey, setPayerKey] = useState<string>("");
  const [serviceKey, setServiceKey] = useState<string>("");

  // On-screen debug/status so nothing is “silent”
  const [status, setStatus] = useState<string>("Idle.");

  const fileLabel = useMemo(() => {
    if (!picked) return "(none)";
    return `${picked.name}${picked.size ? ` • ${Math.round(picked.size / 1024)} KB` : ""}`;
  }, [picked]);

  const disableReason = useMemo(() => {
    const u = (baseUrl || "").trim();
    const k = (apiKey || "").trim();
    const f = (facilityId || "").trim();
    if (busy) return "Busy (uploading).";
    if (!u) return "Missing Base URL (Settings).";
    if (!k) return "Missing API Key (Settings).";
    if (!f) return "Missing Facility ID (Settings).";
    if (!picked) return "No file selected.";
    if (docRole === "template") {
      // payer_key/service_key are OPTIONAL now.
      // Provide them when you want deterministic template selection.
    }
    if (docRole === "policy") {
      // policy_key is optional because server can fall back to file_id, but it's nice to set.
      // Leaving this non-blocking keeps uploads simple.
    }
    return "";
  }, [busy, baseUrl, apiKey, facilityId, picked, docRole, payerKey, serviceKey]);

  useFocusEffect(
    React.useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const [u, k, f] = await Promise.all([
            Storage.getItem(Keys.baseUrl),
            Storage.getItem(Keys.apiKey),
            Storage.getItem(Keys.facilityId),
          ]);
          if (!alive) return;
          if (u) setBaseUrl(u);
          if (k) setApiKey(k);
          if (f) setFacilityId(f);
          setStatus("Loaded settings.");
        } catch (e: any) {
          setStatus(`Failed to load settings: ${e?.message ?? String(e)}`);
        }
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  async function pickFile() {
    try {
      setStatus("Opening picker…");
      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (res.canceled) {
        setStatus("Picker canceled.");
        return;
      }

      const a = res.assets?.[0];
      if (!a?.uri) {
        setStatus("Picker returned no uri.");
        Alert.alert("Pick failed", "No file uri returned.");
        return;
      }

      const name = a.name || "upload.bin";
      const mime = a.mimeType || guessMime(name);

      setPicked({
        uri: a.uri,
        name,
        mimeType: mime,
        size: a.size,
      });

      setStatus(`Selected: ${name}`);
    } catch (e: any) {
      setStatus(`Pick error: ${e?.message ?? String(e)}`);
      Alert.alert("Pick failed", e?.message ?? String(e));
    }
  }

  async function upload() {
    setStatus("Upload button pressed.");

    const u = (baseUrl || "").trim().replace(/\/$/, "");
    const k = (apiKey || "").trim();
    const f = (facilityId || "").trim();

    if (!u) return Alert.alert("Missing setting", "Go to Settings and set Base URL.");
    if (!k) return Alert.alert("Missing setting", "Go to Settings and set API Key.");
    if (!f) return Alert.alert("Missing setting", "Go to Settings and set Facility ID.");
    if (!picked) return Alert.alert("Pick a file", "Tap “Choose File” first.");
    if (busy) return;

    const fileId = `mobile_${Date.now()}_${picked.name}`.slice(0, 180);

    // Normalize keys for templates
    const payer_key_norm = payerKey.trim().toLowerCase();
    const service_key_norm = serviceKey.trim().toLowerCase();
    const template_key_norm =
      templateKey.trim() ||
      (payer_key_norm && service_key_norm ? `${payer_key_norm}_${service_key_norm}` : "");

    setBusy(true);
    setStatus(`Uploading (${docRole}) to ${u}/webhook/ingest …`);

    try {
      const timeoutMs = 60_000;

      const out = await Promise.race([
        ingestApi(
          { baseUrl: u, apiKey: k, facilityId: f },
          {
            facility_id: f,
            file_id: fileId,
            file_name: picked.name,
            mime_type: picked.mimeType || guessMime(picked.name),
            uri: picked.uri,

            // doc role sent to webhook body
            doc_role: docRole,

            // Optional classification keys
            template_key: docRole === "template" ? (template_key_norm || undefined) : undefined,
            payer_key: docRole === "template" ? (payer_key_norm || undefined) : undefined,
            service_key: docRole === "template" ? (service_key_norm || undefined) : undefined,
            policy_key: docRole === "policy" ? (policyKey.trim() || undefined) : undefined,

            size_bytes: typeof picked.size === "number" ? picked.size : null,
          }
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timed out after ${timeoutMs / 1000}s`)), timeoutMs)
        ),
      ]);

      setStatus(`Upload complete ✅ (${docRole}) file_id: ${fileId}`);
      Alert.alert(
        "Uploaded ✅",
        `doc_role: ${docRole}\nfile_id: ${fileId}\n\nResponse:\n${
          typeof out === "string" ? out : JSON.stringify(out, null, 2)
        }`
      );

      setPicked(null);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setStatus(`Upload failed: ${msg}`);
      Alert.alert(
        "Upload failed",
        `${msg}\n\nURL: ${u}/webhook/ingest\nFacility: ${f}\nDoc role: ${docRole}\nFile: ${picked?.name}`
      );
    } finally {
      setBusy(false);
    }
  }

  const roles: { key: DocRole; label: string }[] = [
    { key: "doc", label: "DOC" },
    { key: "policy", label: "POLICY" },
    { key: "template", label: "TEMPLATE" },
  ];

  const InputRow = ({
    label,
    value,
    onChangeText,
    placeholder,
  }: {
    label: string;
    value: string;
    onChangeText: (v: string) => void;
    placeholder?: string;
  }) => (
    <View style={{ marginTop: 10 }}>
      <Text style={{ color: UI.subtle, fontSize: 12 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={UI.subtle}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          marginTop: 6,
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: UI.border,
          color: UI.text,
          backgroundColor: UI.btnAlt,
        }}
      />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: UI.bg, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: UI.text, fontSize: 22, fontWeight: "900" }}>Upload</Text>
        <Text style={{ color: UI.subtle, marginTop: 6 }}>
          Upload a document to n8n: <Text style={{ color: UI.text }}>/webhook/ingest</Text>
        </Text>

        <View style={{ marginTop: 18, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: UI.border }}>
          <Text style={{ color: UI.subtle, fontSize: 12 }}>Facility</Text>
          <Text style={{ color: UI.text, fontWeight: "900", marginTop: 4 }}>{facilityId || "(unset)"}</Text>

          <Text style={{ color: UI.subtle, fontSize: 12, marginTop: 12 }}>Document type</Text>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            {roles.map((r) => {
              const active = docRole === r.key;
              return (
                <Pressable
                  key={r.key}
                  onPress={() => setDocRole(r.key)}
                  disabled={busy}
                  style={{
                    flex: 1,
                    backgroundColor: active ? UI.btn : UI.btnAlt,
                    borderWidth: 1,
                    borderColor: active ? UI.btn : UI.border,
                    paddingVertical: 10,
                    borderRadius: 12,
                    alignItems: "center",
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: active ? UI.btnText : UI.text, fontWeight: "900" }}>
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={{ color: UI.subtle, fontSize: 12, marginTop: 12 }}>Selected file</Text>
          <Text style={{ color: UI.text, fontWeight: "700", marginTop: 4 }}>{fileLabel}</Text>

          {/* Classification keys (optional; improves deterministic selection) */}
          {docRole === "template" ? (
            <>
              <InputRow
                label="payer_key (optional)"
                value={payerKey}
                onChangeText={setPayerKey}
                placeholder="e.g., aetna"
              />
              <InputRow
                label="service_key (optional)"
                value={serviceKey}
                onChangeText={setServiceKey}
                placeholder="e.g., mri_lumbar"
              />
              <InputRow
                label="template_key (optional, recommended)"
                value={templateKey}
                onChangeText={setTemplateKey}
                placeholder="Defaults to payer_service"
              />
            </>
          ) : null}

          {docRole === "policy" ? (
            <>
              <InputRow
                label="policy_key (optional)"
                value={policyKey}
                onChangeText={setPolicyKey}
                placeholder="If blank, server may fall back to file_id"
              />
            </>
          ) : null}

          <Text style={{ color: UI.subtle, fontSize: 12, marginTop: 12 }}>Status</Text>
          <Text style={{ color: UI.text, marginTop: 4 }}>{status}</Text>

          {disableReason ? (
            <Text style={{ color: UI.danger, marginTop: 8, fontSize: 12 }}>
              Upload disabled: {disableReason}
            </Text>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <Pressable
            onPress={pickFile}
            disabled={busy}
            style={{
              flex: 1,
              backgroundColor: UI.btnAlt,
              borderWidth: 1,
              borderColor: UI.border,
              paddingVertical: 12,
              borderRadius: 12,
              alignItems: "center",
              opacity: busy ? 0.6 : 1,
            }}
          >
            <Text style={{ color: UI.text, fontWeight: "900" }}>Choose File</Text>
          </Pressable>

          <Pressable
            onPress={upload}
            disabled={!!disableReason}
            style={{
              flex: 1,
              backgroundColor: UI.btn,
              paddingVertical: 12,
              borderRadius: 12,
              alignItems: "center",
              opacity: disableReason ? 0.6 : 1,
            }}
          >
            <Text style={{ color: UI.btnText, fontWeight: "900" }}>
              {busy ? "Uploading…" : "Upload"}
            </Text>
          </Pressable>
        </View>

        <Text style={{ color: UI.subtle, fontSize: 12, paddingBottom: Math.max(12, insets.bottom + 8), marginTop: 16 }}>
          Sends X-API-Key + multipart fields + binary field named “file”. Also sends doc_role:{" "}
          <Text style={{ color: UI.text, fontWeight: "900" }}>{docRole}</Text>.
        </Text>
      </ScrollView>
    </View>
  );
}
