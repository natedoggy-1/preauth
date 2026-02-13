// app/(tabs)/tracking.tsx
// ============================================================================
// v3 — Submission Tracking Screen (Blueprint §3.1 + §8)
// ============================================================================
// Tracks prior authorization letters through the lifecycle:
//   draft -> sent -> approved / denied
// Displays generation logs for optimization insights.
// ============================================================================

import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Storage, Keys } from "../lib/storage";
import {
  clinicFetchLetters,
  clinicUpdateLetterStatus,
  type Config as ApiConfig,
  type LetterListItem,
} from "../lib/api";

const UI = {
  bg: "#0b0f14",
  card: "#111a25",
  border: "#223043",
  text: "#e8eef7",
  subtext: "#9fb0c3",
  danger: "#ef4444",
  primary: "#1f6feb",
  btn: "#1b2636",
  btnText: "#e8eef7",
  success: "#16a34a",
  info: "#0ea5e9",
  warn: "#f59e0b",
};

type LetterGroup = {
  label: string;
  status: string;
  color: string;
  letters: LetterListItem[];
};

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    draft: { bg: "rgba(148,163,184,0.12)", text: "#94a3b8", border: "rgba(148,163,184,0.3)" },
    sent: { bg: "rgba(14,165,233,0.15)", text: "#7dd3fc", border: "rgba(14,165,233,0.35)" },
    approved: { bg: "rgba(22,163,74,0.15)", text: "#86efac", border: "rgba(22,163,74,0.35)" },
    denied: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5", border: "rgba(239,68,68,0.35)" },
    pending: { bg: "rgba(245,158,11,0.15)", text: "#fde68a", border: "rgba(245,158,11,0.35)" },
  };
  const c = colors[status] || colors.draft;
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: c.bg, borderWidth: 1, borderColor: c.border }}>
      <Text style={{ color: c.text, fontSize: 11, fontWeight: "800" }}>{status.toUpperCase()}</Text>
    </View>
  );
}

export default function TrackingScreen() {
  const insets = useSafeAreaInsets();

  const [facilityId, setFacilityId] = useState("FAC-DEMO");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [letters, setLetters] = useState<LetterListItem[]>([]);

  // Init
  useEffect(() => {
    (async () => {
      try {
        const f = await Storage.getItem(Keys.facilityId);
        if (f) setFacilityId(f);
      } catch {}
    })();
  }, []);

  async function loadAll() {
    setBusy(true);
    setError("");
    try {
      const list = await clinicFetchLetters({ facility_id: facilityId });
      setLetters(list);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  // Group letters by status
  const groups: LetterGroup[] = useMemo(() => {
    const statusOrder = ["draft", "sent", "pending", "approved", "denied"];
    const groupMap: Record<string, LetterListItem[]> = {};
    for (const l of letters) {
      const s = l.status || "draft";
      if (!groupMap[s]) groupMap[s] = [];
      groupMap[s].push(l);
    }
    const colorMap: Record<string, string> = {
      draft: "#94a3b8",
      sent: UI.info,
      pending: UI.warn,
      approved: UI.success,
      denied: UI.danger,
    };
    const labelMap: Record<string, string> = {
      draft: "Drafts",
      sent: "Sent / Awaiting Response",
      pending: "Pending",
      approved: "Approved",
      denied: "Denied",
    };
    return statusOrder
      .filter(s => groupMap[s]?.length)
      .map(s => ({
        label: labelMap[s] || s,
        status: s,
        color: colorMap[s] || UI.subtext,
        letters: groupMap[s],
      }));
  }, [letters]);

  // Summary stats
  const stats = useMemo(() => {
    const total = letters.length;
    const drafts = letters.filter(l => l.status === "draft").length;
    const sent = letters.filter(l => l.status === "sent").length;
    const approved = letters.filter(l => l.status === "approved").length;
    const denied = letters.filter(l => l.status === "denied").length;
    const approvalRate = approved + denied > 0
      ? Math.round((approved / (approved + denied)) * 100)
      : null;
    return { total, drafts, sent, approved, denied, approvalRate };
  }, [letters]);

  async function quickStatusUpdate(letter_id: string, newStatus: string) {
    setBusy(true);
    try {
      await clinicUpdateLetterStatus({
        facility_id: facilityId,
        letter_id,
        status: newStatus,
      });
      await loadAll();
    } catch (e: any) {
      Alert.alert("Update Failed", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: UI.bg, paddingTop: insets.top }}>
      {/* Header */}
      <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: UI.border }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Text style={{ color: UI.text, fontSize: 18, fontWeight: "900" }}>Submission Tracking</Text>
            <Text style={{ color: UI.subtext, fontSize: 12, marginTop: 4 }}>Monitor prior auth letter lifecycle</Text>
          </View>
          <Pressable
            onPress={loadAll}
            disabled={busy}
            style={{
              paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
              backgroundColor: UI.primary, opacity: busy ? 0.6 : 1,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{busy ? "..." : "Refresh"}</Text>
          </Pressable>
        </View>
      </View>

      {/* Stats bar */}
      {letters.length > 0 ? (
        <View style={{ flexDirection: "row", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: UI.border, flexWrap: "wrap" }}>
          <View style={{ backgroundColor: UI.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: UI.border, alignItems: "center", minWidth: 64 }}>
            <Text style={{ color: UI.text, fontWeight: "900", fontSize: 18 }}>{stats.total}</Text>
            <Text style={{ color: UI.subtext, fontSize: 10, fontWeight: "700" }}>Total</Text>
          </View>
          <View style={{ backgroundColor: UI.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: UI.border, alignItems: "center", minWidth: 64 }}>
            <Text style={{ color: "#94a3b8", fontWeight: "900", fontSize: 18 }}>{stats.drafts}</Text>
            <Text style={{ color: UI.subtext, fontSize: 10, fontWeight: "700" }}>Drafts</Text>
          </View>
          <View style={{ backgroundColor: UI.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: UI.border, alignItems: "center", minWidth: 64 }}>
            <Text style={{ color: UI.info, fontWeight: "900", fontSize: 18 }}>{stats.sent}</Text>
            <Text style={{ color: UI.subtext, fontSize: 10, fontWeight: "700" }}>Sent</Text>
          </View>
          <View style={{ backgroundColor: UI.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: UI.border, alignItems: "center", minWidth: 64 }}>
            <Text style={{ color: UI.success, fontWeight: "900", fontSize: 18 }}>{stats.approved}</Text>
            <Text style={{ color: UI.subtext, fontSize: 10, fontWeight: "700" }}>Approved</Text>
          </View>
          <View style={{ backgroundColor: UI.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: UI.border, alignItems: "center", minWidth: 64 }}>
            <Text style={{ color: UI.danger, fontWeight: "900", fontSize: 18 }}>{stats.denied}</Text>
            <Text style={{ color: UI.subtext, fontSize: 10, fontWeight: "700" }}>Denied</Text>
          </View>
          {stats.approvalRate !== null ? (
            <View style={{ backgroundColor: UI.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: UI.border, alignItems: "center", minWidth: 64 }}>
              <Text style={{ color: stats.approvalRate >= 70 ? UI.success : UI.warn, fontWeight: "900", fontSize: 18 }}>{stats.approvalRate}%</Text>
              <Text style={{ color: UI.subtext, fontSize: 10, fontWeight: "700" }}>Approval</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {error ? <Text style={{ color: UI.danger, padding: 12, fontSize: 12 }}>{error}</Text> : null}

      {/* Grouped letter list */}
      <FlatList
        data={groups}
        keyExtractor={(g) => g.status}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        ListEmptyComponent={
          <Text style={{ color: UI.subtext, textAlign: "center", padding: 32 }}>
            {busy ? "Loading..." : "No letters found. Tap Refresh to load."}
          </Text>
        }
        renderItem={({ item: group }) => (
          <View style={{ marginTop: 12 }}>
            {/* Group header */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: group.color }} />
              <Text style={{ color: group.color, fontWeight: "900", fontSize: 13 }}>{group.label}</Text>
              <Text style={{ color: UI.subtext, fontSize: 12 }}>({group.letters.length})</Text>
            </View>

            {/* Letters in group */}
            {group.letters.map((letter) => (
              <View
                key={letter.letter_id}
                style={{
                  marginHorizontal: 12, marginBottom: 8, padding: 14,
                  backgroundColor: UI.card, borderRadius: 14,
                  borderWidth: 1, borderColor: UI.border,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: UI.text, fontWeight: "900", fontSize: 13, flex: 1 }} numberOfLines={1}>
                    {letter.subject_line || letter.letter_id}
                  </Text>
                  <StatusBadge status={letter.status} />
                </View>

                <View style={{ flexDirection: "row", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                  <Text style={{ color: UI.subtext, fontSize: 11 }}>Type: {letter.letter_type}</Text>
                  <Text style={{ color: UI.subtext, fontSize: 11 }}>Date: {letter.letter_date || "N/A"}</Text>
                  {letter.request_id ? (
                    <Text style={{ color: UI.subtext, fontSize: 11 }}>Req: {letter.request_id}</Text>
                  ) : null}
                </View>

                {/* Quick actions based on current status */}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {letter.status === "draft" ? (
                    <Pressable
                      onPress={() => quickStatusUpdate(letter.letter_id, "sent")}
                      disabled={busy}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                        backgroundColor: "rgba(14,165,233,0.2)", borderWidth: 1, borderColor: "rgba(14,165,233,0.4)",
                        opacity: busy ? 0.6 : 1,
                      }}
                    >
                      <Text style={{ color: "#7dd3fc", fontWeight: "800", fontSize: 11 }}>Mark Sent</Text>
                    </Pressable>
                  ) : null}

                  {letter.status === "sent" ? (
                    <>
                      <Pressable
                        onPress={() => quickStatusUpdate(letter.letter_id, "approved")}
                        disabled={busy}
                        style={{
                          paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                          backgroundColor: "rgba(22,163,74,0.2)", borderWidth: 1, borderColor: "rgba(22,163,74,0.4)",
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        <Text style={{ color: "#86efac", fontWeight: "800", fontSize: 11 }}>Approved</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => quickStatusUpdate(letter.letter_id, "denied")}
                        disabled={busy}
                        style={{
                          paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                          backgroundColor: "rgba(239,68,68,0.2)", borderWidth: 1, borderColor: "rgba(239,68,68,0.4)",
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        <Text style={{ color: "#fca5a5", fontWeight: "800", fontSize: 11 }}>Denied</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        )}
      />
    </View>
  );
}
