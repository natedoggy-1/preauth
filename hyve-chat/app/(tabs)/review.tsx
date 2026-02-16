// app/(tabs)/review.tsx
// ============================================================================
// v3 — Letter Review / Edit Screen (Blueprint §7)
// ============================================================================
// Displays generated letters with:
//   - Clean formatted letter view
//   - Inline section editing
//   - Section regenerate button
//   - Validation results with highlighted issues
//   - Save / submit workflow
// ============================================================================

import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Storage, Keys } from "../lib/storage";
import {
  clinicFetchLetters,
  clinicFetchLetter,
  clinicValidateLetter,
  clinicSaveLetter,
  clinicUpdateLetterStatus,
  clinicLogGeneration,
  clinicDownloadLetterPdf,
  evalSubmitFeedback,
  type Config as ApiConfig,
  type LetterListItem,
  type LetterDetail,
  type LetterStatusHistoryItem,
  type ValidationResult,
  type ValidationIssue,
} from "../lib/api";

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
};

// Section boundary detection: splits letter text into labeled sections
function splitLetterIntoSections(text: string): { name: string; content: string }[] {
  if (!text) return [];

  // Common section header patterns in PA letters
  const sectionPatterns = [
    /^(RE:|To:|Dear\s)/im,
    /^(CLINICAL\s+HISTORY|Clinical\s+History):?\s*/im,
    /^(CONSERVATIVE\s+TREATMENT|Conservative\s+Treatment)\s*(HISTORY|History)?:?\s*/im,
    /^(MEDICAL\s+NECESSITY|Medical\s+Necessity):?\s*/im,
    /^(SUPPORTING\s+EVIDENCE|Supporting\s+Evidence):?\s*/im,
    /^(CONCLUSION|Conclusion):?\s*/im,
    /^(TREATMENT\s+PLAN|Treatment\s+Plan):?\s*/im,
    /^(DIAGNOSIS|Diagnosis|DIAGNOS[EI]S):?\s*/im,
    /^(IMAGING|Imaging\s+Results?):?\s*/im,
    /^(MEDICATIONS?|Medication\s+History):?\s*/im,
  ];

  // Try to split by double newlines and section headers
  const lines = text.split("\n");
  const sections: { name: string; content: string }[] = [];
  let currentSection = { name: "header", content: "" };

  for (const line of lines) {
    let matched = false;
    for (const pattern of sectionPatterns) {
      const m = line.match(pattern);
      if (m) {
        // Save current section
        if (currentSection.content.trim()) {
          sections.push({ ...currentSection, content: currentSection.content.trim() });
        }
        // Start new section
        const sectionName = m[1]
          .replace(/[:\s]+$/, "")
          .toLowerCase()
          .replace(/\s+/g, "_");
        currentSection = { name: sectionName, content: line + "\n" };
        matched = true;
        break;
      }
    }
    if (!matched) {
      currentSection.content += line + "\n";
    }
  }

  // Push final section
  if (currentSection.content.trim()) {
    sections.push({ ...currentSection, content: currentSection.content.trim() });
  }

  // If no sections detected, return whole letter as one section
  if (sections.length <= 1) {
    return [{ name: "full_letter", content: text.trim() }];
  }

  return sections;
}

function sectionDisplayName(name: string): string {
  const map: Record<string, string> = {
    header: "Header",
    introduction: "Introduction",
    "re:": "RE: Line",
    clinical_history: "Clinical History",
    conservative_treatment: "Conservative Treatment",
    conservative_treatment_history: "Conservative Treatment History",
    medical_necessity: "Medical Necessity",
    supporting_evidence: "Supporting Evidence",
    conclusion: "Conclusion",
    treatment_plan: "Treatment Plan",
    diagnosis: "Diagnosis",
    imaging: "Imaging Results",
    medications: "Medications",
    medication_history: "Medication History",
    full_letter: "Full Letter",
  };
  return map[name] || name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export default function ReviewScreen() {
  const insets = useSafeAreaInsets();

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [facilityId, setFacilityId] = useState("FAC-DEMO");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Letter list
  const [letters, setLetters] = useState<LetterListItem[]>([]);
  const [selectedLetterId, setSelectedLetterId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  // Letter detail
  const [letterDetail, setLetterDetail] = useState<LetterDetail | null>(null);
  const [statusHistory, setStatusHistory] = useState<LetterStatusHistoryItem[]>([]);

  // Section editing
  const [sections, setSections] = useState<{ name: string; content: string }[]>([]);
  const [editingSectionIdx, setEditingSectionIdx] = useState<number | null>(null);
  const [editBuffer, setEditBuffer] = useState("");

  // Validation
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  const cfg: ApiConfig = useMemo(
    () => ({ baseUrl: (baseUrl || "").trim(), apiKey: (apiKey || "").trim(), facilityId: (facilityId || "").trim() }),
    [baseUrl, apiKey, facilityId]
  );

  // Init
  useEffect(() => {
    (async () => {
      try {
        const [u, k, f] = await Promise.all([
          Storage.getItem(Keys.baseUrl),
          Storage.getItem(Keys.apiKey),
          Storage.getItem(Keys.facilityId),
        ]);
        if (u) setBaseUrl(u);
        if (k) setApiKey(k);
        if (f) setFacilityId(f);
      } catch {}
    })();
  }, []);

  // Load letters
  async function loadLetters() {
    setBusy(true);
    setError("");
    try {
      const list = await clinicFetchLetters({
        facility_id: cfg.facilityId,
        status: statusFilter || undefined,
      });
      setLetters(list);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  // Load letter detail
  async function loadLetterDetail(letter_id: string) {
    setBusy(true);
    setError("");
    setValidation(null);
    try {
      const result = await clinicFetchLetter({
        facility_id: cfg.facilityId,
        letter_id,
      });
      setLetterDetail(result.letter);
      setStatusHistory(result.status_history || []);
      setSelectedLetterId(letter_id);

      // Split into sections for editing
      const detected = splitLetterIntoSections(result.letter.letter_body || "");
      setSections(detected);
      setEditingSectionIdx(null);
      setEditBuffer("");
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  // Run validation
  async function runValidation() {
    if (!letterDetail?.letter_body) return;
    setValidating(true);
    setError("");
    try {
      const result = await clinicValidateLetter({
        facility_id: cfg.facilityId,
        letter_body: sections.map(s => s.content).join("\n\n"),
        payer_id: letterDetail.payer_id,
      });
      setValidation(result);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setValidating(false);
    }
  }

  // Save section edit
  function saveEdit(idx: number) {
    if (idx < 0 || idx >= sections.length) return;
    const updated = [...sections];
    updated[idx] = { ...updated[idx], content: editBuffer };
    setSections(updated);
    setEditingSectionIdx(null);
    setEditBuffer("");
  }

  // Save full letter (reassembled from sections)
  async function saveLetter() {
    if (!letterDetail) return;
    setBusy(true);
    setError("");
    try {
      const updatedBody = sections.map(s => s.content).join("\n\n");
      await clinicSaveLetter({
        facility_id: cfg.facilityId,
        patient_id: letterDetail.patient_id,
        letter_type: letterDetail.letter_type,
        letter_body: updatedBody,
        request_id: letterDetail.request_id,
        template_id: letterDetail.template_id,
        coverage_id: letterDetail.coverage_id,
        payer_id: letterDetail.payer_id,
        provider_id: letterDetail.provider_id,
        subject_line: letterDetail.subject_line,
        status: "draft",
      });
      Alert.alert("Saved", "Letter saved as draft.");

      // Log the edit
      try {
        await clinicLogGeneration({
          facility_id: cfg.facilityId,
          letter_id: letterDetail.letter_id,
          patient_id: letterDetail.patient_id,
          letter_type: letterDetail.letter_type,
          payer_id: letterDetail.payer_id,
          provider_id: letterDetail.provider_id,
          template_id: letterDetail.template_id,
          section_count: sections.length,
          validation_passed: validation?.passed,
          validation_issues: validation?.issues,
        });
      } catch {}
    } catch (e: any) {
      setError(e?.message || String(e));
      Alert.alert("Save Failed", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  // Update letter status
  async function updateStatus(newStatus: string) {
    if (!letterDetail) return;
    setBusy(true);
    setError("");
    try {
      await clinicUpdateLetterStatus({
        facility_id: cfg.facilityId,
        letter_id: letterDetail.letter_id,
        status: newStatus,
      });
      Alert.alert("Updated", `Status changed to: ${newStatus}`);
      await loadLetterDetail(letterDetail.letter_id);
    } catch (e: any) {
      setError(e?.message || String(e));
      Alert.alert("Update Failed", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  // Back to list
  function backToList() {
    setSelectedLetterId(null);
    setLetterDetail(null);
    setSections([]);
    setValidation(null);
    setEditingSectionIdx(null);
  }

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

  function SeverityBadge({ severity }: { severity: string }) {
    const colors: Record<string, string> = { high: UI.danger, medium: UI.warn, low: UI.info };
    return (
      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: `${colors[severity] || UI.subtext}22` }}>
        <Text style={{ color: colors[severity] || UI.subtext, fontSize: 10, fontWeight: "800" }}>{severity.toUpperCase()}</Text>
      </View>
    );
  }

  // ──────── LETTER LIST VIEW ────────
  if (!selectedLetterId) {
    return (
      <View style={{ flex: 1, backgroundColor: UI.bg, paddingTop: insets.top }}>
        <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: UI.border }}>
          <Text style={{ color: UI.text, fontSize: 18, fontWeight: "900" }}>Letter Review</Text>
          <Text style={{ color: UI.subtext, fontSize: 12, marginTop: 4 }}>View, edit, and validate generated letters</Text>
        </View>

        {/* Filter + Load */}
        <View style={{ padding: 12, flexDirection: "row", gap: 8, flexWrap: "wrap", borderBottomWidth: 1, borderBottomColor: UI.border }}>
          {["", "draft", "sent", "approved", "denied"].map(f => (
            <Pressable
              key={f}
              onPress={() => setStatusFilter(f)}
              style={{
                paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
                borderColor: statusFilter === f ? UI.primary : UI.border,
                backgroundColor: statusFilter === f ? "rgba(31,111,235,0.25)" : "transparent",
              }}
            >
              <Text style={{ color: statusFilter === f ? UI.text : UI.subtext, fontSize: 12, fontWeight: "800" }}>
                {f || "All"}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={loadLetters}
            disabled={busy}
            style={{
              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
              backgroundColor: UI.primary, opacity: busy ? 0.6 : 1,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{busy ? "Loading..." : "Load"}</Text>
          </Pressable>
        </View>

        {error ? (
          <Text style={{ color: UI.danger, padding: 12, fontSize: 12 }}>{error}</Text>
        ) : null}

        <FlatList
          data={letters}
          keyExtractor={(item) => item.letter_id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          ListEmptyComponent={
            <Text style={{ color: UI.subtext, textAlign: "center", padding: 32 }}>
              {busy ? "Loading..." : "No letters found. Tap Load to refresh."}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => loadLetterDetail(item.letter_id)}
              style={{
                marginHorizontal: 12, marginTop: 10, padding: 14,
                backgroundColor: UI.card, borderRadius: 14,
                borderWidth: 1, borderColor: UI.border,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: UI.text, fontWeight: "900", fontSize: 14, flex: 1 }} numberOfLines={1}>
                  {item.subject_line || item.letter_id}
                </Text>
                <StatusBadge status={item.status} />
              </View>
              <View style={{ flexDirection: "row", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                <Text style={{ color: UI.subtext, fontSize: 12 }}>Type: {item.letter_type}</Text>
                <Text style={{ color: UI.subtext, fontSize: 12 }}>Date: {item.letter_date || "N/A"}</Text>
                <Text style={{ color: UI.subtext, fontSize: 12 }}>Patient: {item.patient_id}</Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    );
  }

  // ──────── LETTER DETAIL + EDIT VIEW ────────
  return (
    <View style={{ flex: 1, backgroundColor: UI.bg, paddingTop: insets.top }}>
      {/* Header */}
      <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: UI.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Pressable onPress={backToList} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: UI.btn, borderWidth: 1, borderColor: UI.border }}>
          <Text style={{ color: UI.btnText, fontWeight: "900", fontSize: 12 }}>Back</Text>
        </Pressable>
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <Text style={{ color: UI.text, fontWeight: "900", fontSize: 14 }} numberOfLines={1}>
            {letterDetail?.subject_line || letterDetail?.letter_id || "Letter"}
          </Text>
        </View>
        {letterDetail ? <StatusBadge status={letterDetail.status} /> : null}
      </View>

      {error ? <Text style={{ color: UI.danger, paddingHorizontal: 12, paddingTop: 8, fontSize: 12 }}>{error}</Text> : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
        {/* Validation Results */}
        {validation ? (
          <View style={{ margin: 12, padding: 14, backgroundColor: validation.passed ? "rgba(22,163,74,0.08)" : "rgba(239,68,68,0.08)", borderRadius: 14, borderWidth: 1, borderColor: validation.passed ? "rgba(22,163,74,0.3)" : "rgba(239,68,68,0.3)" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: validation.passed ? "#86efac" : "#fca5a5", fontWeight: "900", fontSize: 14 }}>
                {validation.passed ? "VALIDATION PASSED" : "VALIDATION ISSUES FOUND"}
              </Text>
              {validation.score !== null ? (
                <Text style={{ color: validation.passed ? "#86efac" : "#fca5a5", fontWeight: "900", fontSize: 16 }}>
                  {validation.score}%
                </Text>
              ) : null}
            </View>
            <Text style={{ color: UI.subtext, fontSize: 12, marginTop: 6 }}>
              Criteria: {validation.criteria_met}/{validation.criteria_total} met | Issues: {validation.issue_count}
            </Text>

            {validation.issues.length > 0 ? (
              <View style={{ marginTop: 10, gap: 8 }}>
                {validation.issues.map((issue, idx) => (
                  <View key={idx} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                    <SeverityBadge severity={issue.severity} />
                    <Text style={{ color: UI.text, fontSize: 12, flex: 1, lineHeight: 18 }}>{issue.message}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Letter Sections */}
        {sections.map((sec, idx) => {
          const isEditing = editingSectionIdx === idx;
          const sectionIssues = validation?.issues.filter(i => i.section === sec.name) || [];

          return (
            <View
              key={idx}
              style={{
                margin: 12, marginTop: idx === 0 ? 12 : 0,
                backgroundColor: UI.card,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: sectionIssues.length > 0 ? "rgba(239,68,68,0.4)" : UI.border,
              }}
            >
              {/* Section header */}
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 12, borderBottomWidth: 1, borderBottomColor: UI.border }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: UI.text, fontWeight: "900", fontSize: 13 }}>
                    {sectionDisplayName(sec.name)}
                  </Text>
                  {sectionIssues.length > 0 ? (
                    <View style={{ backgroundColor: "rgba(239,68,68,0.2)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ color: UI.danger, fontSize: 10, fontWeight: "800" }}>{sectionIssues.length} issue{sectionIssues.length > 1 ? "s" : ""}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {isEditing ? (
                    <>
                      <Pressable
                        onPress={() => saveEdit(idx)}
                        style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: UI.success }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>Save</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => { setEditingSectionIdx(null); setEditBuffer(""); }}
                        style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: UI.btn, borderWidth: 1, borderColor: UI.border }}
                      >
                        <Text style={{ color: UI.btnText, fontWeight: "900", fontSize: 11 }}>Cancel</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      onPress={() => { setEditingSectionIdx(idx); setEditBuffer(sec.content); }}
                      disabled={busy}
                      style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: UI.btn, borderWidth: 1, borderColor: UI.border, opacity: busy ? 0.6 : 1 }}
                    >
                      <Text style={{ color: UI.btnText, fontWeight: "900", fontSize: 11 }}>Edit</Text>
                    </Pressable>
                  )}
                </View>
              </View>

              {/* Section content */}
              <View style={{ padding: 12 }}>
                {isEditing ? (
                  <TextInput
                    multiline
                    value={editBuffer}
                    onChangeText={setEditBuffer}
                    style={{
                      color: UI.text, fontSize: 14, lineHeight: 22,
                      minHeight: 120, textAlignVertical: "top",
                      backgroundColor: UI.bg, borderRadius: 10,
                      padding: 10, borderWidth: 1, borderColor: UI.primary,
                    }}
                  />
                ) : (
                  <Text style={{ color: UI.text, fontSize: 14, lineHeight: 22 }}>
                    {sec.content}
                  </Text>
                )}
              </View>

              {/* Section-level issues */}
              {!isEditing && sectionIssues.length > 0 ? (
                <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 6 }}>
                  {sectionIssues.map((issue, iIdx) => (
                    <View key={iIdx} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "rgba(239,68,68,0.06)", padding: 8, borderRadius: 8 }}>
                      <SeverityBadge severity={issue.severity} />
                      <Text style={{ color: UI.subtext, fontSize: 11, flex: 1 }}>{issue.message}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}

        {/* Status History */}
        {statusHistory.length > 0 ? (
          <View style={{ margin: 12, backgroundColor: UI.card, borderRadius: 14, borderWidth: 1, borderColor: UI.border, padding: 14 }}>
            <Text style={{ color: UI.text, fontWeight: "900", fontSize: 13, marginBottom: 10 }}>Status History</Text>
            {statusHistory.map((h, idx) => (
              <View key={idx} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: idx < statusHistory.length - 1 ? 1 : 0, borderBottomColor: UI.border }}>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  {h.old_status ? (
                    <Text style={{ color: UI.subtext, fontSize: 12 }}>{h.old_status}</Text>
                  ) : null}
                  {h.old_status ? <Text style={{ color: UI.subtext, fontSize: 12 }}>-&gt;</Text> : null}
                  <Text style={{ color: UI.text, fontSize: 12, fontWeight: "700" }}>{h.new_status}</Text>
                </View>
                <Text style={{ color: UI.subtext, fontSize: 11 }}>
                  {h.changed_at ? new Date(h.changed_at).toLocaleDateString() : ""}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* Bottom action bar */}
      <View style={{
        padding: 12, paddingBottom: Math.max(12, insets.bottom + 12),
        borderTopWidth: 1, borderTopColor: UI.border, backgroundColor: UI.bg,
        flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "flex-end",
      }}>
        <Pressable
          onPress={async () => {
            try {
              const uri = await clinicDownloadLetterPdf({
                facility_id: cfg?.facilityId || "FAC-DEMO",
                letter_id: letterDetail?.letter_id || "",
              });
              Alert.alert("PDF Downloaded", `Saved to: ${uri}`);
            } catch (e: any) {
              Alert.alert("PDF Error", e.message);
            }
          }}
          disabled={busy || !letterDetail?.letter_id}
          style={{
            paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
            backgroundColor: "#6e40c9", opacity: busy || !letterDetail?.letter_id ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>PDF</Text>
        </Pressable>

        <Pressable
          onPress={runValidation}
          disabled={busy || validating}
          style={{
            paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
            backgroundColor: UI.info, opacity: busy || validating ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>
            {validating ? "Validating..." : "Validate"}
          </Text>
        </Pressable>

        <Pressable
          onPress={saveLetter}
          disabled={busy}
          style={{
            paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
            backgroundColor: UI.primary, opacity: busy ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Save Draft</Text>
        </Pressable>

        {letterDetail?.status === "draft" ? (
          <Pressable
            onPress={() => updateStatus("sent")}
            disabled={busy}
            style={{
              paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
              backgroundColor: UI.success, opacity: busy ? 0.6 : 1,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Mark Sent</Text>
          </Pressable>
        ) : null}

        {letterDetail?.status === "sent" ? (
          <>
            <Pressable
              onPress={() => updateStatus("approved")}
              disabled={busy}
              style={{
                paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
                backgroundColor: UI.success, opacity: busy ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Approved</Text>
            </Pressable>
            <Pressable
              onPress={() => updateStatus("denied")}
              disabled={busy}
              style={{
                paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
                backgroundColor: UI.danger, opacity: busy ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Denied</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}
