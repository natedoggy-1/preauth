// app/(tabs)/settings.tsx
import React, { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Storage, Keys } from "../lib/storage";

export default function SettingsScreen() {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [facilityId, setFacilityId] = useState("FAC-001");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [u, k, f] = await Promise.all([
        Storage.getItem(Keys.baseUrl),
        Storage.getItem(Keys.apiKey),
        Storage.getItem(Keys.facilityId),
      ]);
      if (u) setBaseUrl(u);
      if (k) setApiKey(k);
      if (f) setFacilityId(f);
    })();
  }, []);

  async function onSave() {
    const u = baseUrl.trim();
    const k = apiKey.trim();
    const f = facilityId.trim();

    if (!u.startsWith("https://")) {
      return Alert.alert("Invalid Base URL", "Must start with https://");
    }
    if (!k) return Alert.alert("Missing API Key", "Enter your X-API-Key value");
    if (!f) return Alert.alert("Missing Facility ID", "Enter a facility id like FAC-001");

    setBusy(true);
    try {
      await Promise.all([
        Storage.setItem(Keys.baseUrl, u),
        Storage.setItem(Keys.apiKey, k),
        Storage.setItem(Keys.facilityId, f),
      ]);
      Alert.alert("Saved", "Settings saved successfully.");
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    setBusy(true);
    try {
      await Promise.all([
        Storage.removeItem(Keys.baseUrl),
        Storage.removeItem(Keys.apiKey),
        Storage.removeItem(Keys.facilityId),
      ]);
      setBaseUrl("");
      setApiKey("");
      setFacilityId("FAC-001");
      Alert.alert("Cleared", "Settings cleared.");
    } catch (e: any) {
      Alert.alert("Clear failed", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.h1}>Settings</Text>

      <Text style={styles.label}>Base URL</Text>
      <TextInput
        value={baseUrl}
        onChangeText={setBaseUrl}
        placeholder="https://n8n.hyveappliedintelligence.com"
        placeholderTextColor="#7f93a7"
        autoCapitalize="none"
        style={styles.input}
      />

      <Text style={styles.label}>API Key (X-API-Key)</Text>
      <TextInput
        value={apiKey}
        onChangeText={setApiKey}
        placeholder="paste api key"
        placeholderTextColor="#7f93a7"
        autoCapitalize="none"
        style={styles.input}
      />

      <Text style={styles.label}>Facility ID</Text>
      <TextInput
        value={facilityId}
        onChangeText={setFacilityId}
        placeholder="FAC-001"
        placeholderTextColor="#7f93a7"
        autoCapitalize="none"
        style={styles.input}
      />

      <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
        <Pressable onPress={onSave} disabled={busy} style={[styles.btn, styles.btnPrimary]}>
          <Text style={styles.btnText}>{busy ? "…" : "Save"}</Text>
        </Pressable>

        <Pressable onPress={onClear} disabled={busy} style={[styles.btn, styles.btnGhost]}>
          <Text style={styles.btnText}>Clear</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: "#0b0f14" },
  h1: { color: "#e8eef7", fontSize: 20, fontWeight: "900", marginBottom: 18 },
  label: { color: "#9fb0c3", fontWeight: "800", marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#223043",
    backgroundColor: "#121a24",
    color: "#e8eef7",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  btn: {
    borderWidth: 1,
    borderColor: "#223043",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  btnPrimary: { backgroundColor: "#1f6feb" },
  btnGhost: { backgroundColor: "#121a24" },
  btnText: { color: "#fff", fontWeight: "900" },
});
