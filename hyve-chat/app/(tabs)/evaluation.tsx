// app/(tabs)/evaluation.tsx
// Evaluation Framework Dashboard — View eval runs, scores, and feedback
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "expo-router";
import {
  evalFetchRuns,
  evalFetchDashboard,
  evalFetchTestCases,
} from "../lib/api";

type EvalRun = {
  run_id: string;
  run_name: string;
  run_type: string;
  model_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  summary: any;
};

type DashboardData = {
  total_runs: number;
  total_test_cases: number;
  avg_criteria_coverage: number;
  avg_clinical_accuracy: number;
  avg_format_compliance: number;
  avg_completeness: number;
  avg_llm_judge_score: number;
  recent_runs: any[];
};

const COLORS = {
  bg: "#0d1117",
  card: "#161b22",
  border: "#30363d",
  text: "#c9d1d9",
  textMuted: "#8b949e",
  accent: "#1f6feb",
  green: "#3fb950",
  red: "#f85149",
  yellow: "#d29922",
};

export default function EvaluationScreen() {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [testCaseCount, setTestCaseCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "runs" | "cases">("dashboard");

  const loadData = useCallback(async () => {
    try {
      const [runsData, dashData, casesData] = await Promise.all([
        evalFetchRuns({ limit: 20 }).catch(() => []),
        evalFetchDashboard().catch(() => null),
        evalFetchTestCases().catch(() => []),
      ]);
      setRuns(runsData);
      setDashboard(dashData);
      setTestCaseCount(casesData.length);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  function ScoreBar({ label, value, max = 1 }: { label: string; value: number; max?: number }) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    const color = pct >= 80 ? COLORS.green : pct >= 60 ? COLORS.yellow : COLORS.red;
    return (
      <View style={styles.scoreRow}>
        <Text style={styles.scoreLabel}>{label}</Text>
        <View style={styles.scoreBarBg}>
          <View style={[styles.scoreBarFill, { width: `${pct}%`, backgroundColor: color }]} />
        </View>
        <Text style={[styles.scoreValue, { color }]}>
          {max === 1 ? `${(value * 100).toFixed(0)}%` : `${value.toFixed(1)}/${max}`}
        </Text>
      </View>
    );
  }

  function StatusBadge({ status }: { status: string }) {
    const color =
      status === "completed" ? COLORS.green :
      status === "running" ? COLORS.yellow :
      COLORS.textMuted;
    return (
      <View style={[styles.badge, { borderColor: color }]}>
        <Text style={[styles.badgeText, { color }]}>{status}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={COLORS.accent} />
        <Text style={[styles.text, { marginTop: 12 }]}>Loading evaluation data...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Tab Selector */}
      <View style={styles.tabBar}>
        {(["dashboard", "runs", "cases"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === "dashboard" ? "Overview" : tab === "runs" ? "Runs" : "Test Cases"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
      >
        {activeTab === "dashboard" && (
          <>
            {/* Stats Cards */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{dashboard?.total_runs ?? runs.length}</Text>
                <Text style={styles.statLabel}>Total Runs</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{testCaseCount}</Text>
                <Text style={styles.statLabel}>Test Cases</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>
                  {dashboard?.avg_llm_judge_score ? dashboard.avg_llm_judge_score.toFixed(1) : "--"}
                </Text>
                <Text style={styles.statLabel}>Avg Score</Text>
              </View>
            </View>

            {/* Score Bars */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Average Scores</Text>
              <ScoreBar label="Criteria Coverage" value={dashboard?.avg_criteria_coverage ?? 0} />
              <ScoreBar label="Clinical Accuracy" value={dashboard?.avg_clinical_accuracy ?? 0} />
              <ScoreBar label="Format Compliance" value={dashboard?.avg_format_compliance ?? 0} />
              <ScoreBar label="Completeness" value={dashboard?.avg_completeness ?? 0} />
              <ScoreBar label="LLM Judge" value={dashboard?.avg_llm_judge_score ?? 0} max={10} />
            </View>

            {runs.length === 0 && (
              <View style={styles.card}>
                <Text style={styles.textMuted}>
                  No evaluation runs yet. Run the evaluation seeder and runner to generate test data.
                </Text>
              </View>
            )}
          </>
        )}

        {activeTab === "runs" && (
          <>
            {runs.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.textMuted}>No evaluation runs found.</Text>
              </View>
            ) : (
              runs.map((run) => (
                <View key={run.run_id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>{run.run_name || run.run_id}</Text>
                    <StatusBadge status={run.status} />
                  </View>
                  <Text style={styles.textMuted}>
                    Type: {run.run_type} | Model: {run.model_id || "default"}
                  </Text>
                  <Text style={styles.textMuted}>
                    Started: {new Date(run.started_at).toLocaleString()}
                  </Text>
                  {run.summary && (
                    <View style={{ marginTop: 8 }}>
                      {run.summary.avg_criteria_coverage != null && (
                        <ScoreBar label="Coverage" value={run.summary.avg_criteria_coverage} />
                      )}
                      {run.summary.avg_llm_judge_score != null && (
                        <ScoreBar label="Judge" value={run.summary.avg_llm_judge_score} max={10} />
                      )}
                    </View>
                  )}
                </View>
              ))
            )}
          </>
        )}

        {activeTab === "cases" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Golden Test Cases</Text>
            <Text style={styles.textMuted}>
              {testCaseCount} test case{testCaseCount !== 1 ? "s" : ""} loaded.
            </Text>
            <Text style={[styles.textMuted, { marginTop: 8 }]}>
              Run `node eval/seed-golden-cases.js` to seed test cases, then use the evaluation
              runner to execute them against your current model configuration.
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1, padding: 16 },
  text: { color: COLORS.text, fontSize: 14 },
  textMuted: { color: COLORS.textMuted, fontSize: 13 },

  tabBar: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingTop: 50 },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.accent },
  tabText: { color: COLORS.textMuted, fontSize: 14, fontWeight: "500" },
  tabTextActive: { color: COLORS.accent },

  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statValue: { color: COLORS.text, fontSize: 24, fontWeight: "700" },
  statLabel: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },

  card: {
    backgroundColor: COLORS.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  cardTitle: { color: COLORS.text, fontSize: 16, fontWeight: "600", marginBottom: 8 },

  scoreRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  scoreLabel: { color: COLORS.textMuted, fontSize: 12, width: 120 },
  scoreBarBg: { flex: 1, height: 8, backgroundColor: COLORS.border, borderRadius: 4, marginHorizontal: 8 },
  scoreBarFill: { height: 8, borderRadius: 4 },
  scoreValue: { fontSize: 12, fontWeight: "600", width: 45, textAlign: "right" },

  badge: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: "500" },
});
