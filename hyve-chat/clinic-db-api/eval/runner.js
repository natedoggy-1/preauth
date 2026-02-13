// ============================================================================
// eval/runner.js
// ============================================================================
// Evaluation runner — executes all active golden test cases against the
// current model configuration and stores scored results.
//
// Usage:
//   node eval/runner.js [--model llama3] [--run-name "nightly v3"]
// ============================================================================

import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import {
  evaluateCriteriaCoverage,
  evaluateClinicalAccuracy,
  evaluateFormatCompliance,
  evaluateCompleteness,
} from "./metrics/accuracy.js";
import { llmJudge } from "./metrics/llm-judge.js";
import { runSafetyChecks } from "./safety.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const S = process.env.CLINIC_SCHEMA || "demo";
const LLM_URL = process.env.LLM_URL || "http://localhost:11434/api/chat";
const LLM_MODEL = process.env.LLM_MODEL || "llama3";
const CLINIC_API = `http://127.0.0.1:${process.env.PORT || 7777}`;
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || "dev-bridge-token";

const pool = new pg.Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "Newaza",
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}

async function run() {
  const model = getArg("model") || LLM_MODEL;
  const runName = getArg("run-name") || `eval-${new Date().toISOString().slice(0, 10)}-${model}`;

  console.log(`Starting evaluation run: ${runName}`);
  console.log(`Model: ${model} | LLM URL: ${LLM_URL} | API: ${CLINIC_API}`);

  // 1. Load active test cases
  const casesRes = await pool.query(
    `SELECT * FROM ${S}.eval_test_cases WHERE is_active = true ORDER BY test_case_id;`
  );
  const testCases = casesRes.rows;
  console.log(`Found ${testCases.length} active test cases.`);

  if (testCases.length === 0) {
    console.log("No test cases. Run 'node eval/seed-golden-cases.js' first.");
    await pool.end();
    return;
  }

  // 2. Create eval run
  const run_id = genId("run");
  await pool.query(
    `INSERT INTO ${S}.eval_runs (run_id, run_name, run_type, model_id, config, status)
     VALUES ($1, $2, 'automated', $3, $4, 'running');`,
    [run_id, runName, model, JSON.stringify({ llm_url: LLM_URL, model, timestamp: new Date().toISOString() })]
  );
  console.log(`Created run: ${run_id}\n`);

  const results = [];

  // 3. For each test case, generate letter and evaluate
  for (const tc of testCases) {
    console.log(`--- ${tc.test_case_id}: ${tc.case_name} ---`);

    const profile = tc.patient_profile;
    const startMs = Date.now();

    try {
      // Build a non_phi_packet from the test case profile
      const nonPhiPacket = {
        problems: profile.problems || [],
        therapy: profile.therapy || [],
        imaging: profile.imaging || [],
        med_trials: profile.med_trials || [],
        coverage: profile.coverage || {},
        cpt_codes: profile.cpt_codes || [],
        icd10_codes: profile.icd10_codes || [],
      };

      // Call the LLM directly (bypass n8n for eval — simulates the prompt build)
      const systemPrompt = [
        "You are a clinical prior-authorization letter generator.",
        "Generate a complete prior-authorization letter using the patient data provided.",
        "Include sections: CLINICAL HISTORY, CONSERVATIVE TREATMENT, DIAGNOSTIC IMAGING, MEDICAL NECESSITY.",
        "Use a professional, clinical tone.",
        'If data is missing, write "[MISSING: ...]" rather than inventing.',
        "Return ONLY the final letter text. No JSON. No markdown fences.",
      ].join("\n");

      const userPrompt = [
        "PATIENT DATA:",
        JSON.stringify(nonPhiPacket, null, 2),
        "",
        "POLICY CRITERIA:",
        tc.payer_id === "AETNA"
          ? "Aetna Clinical Policy Bulletin: Requires documented functional assessment, minimum 6 weeks conservative therapy, imaging correlation."
          : "BCBS Medical Policy: Requires minimum 6 weeks physical therapy, documented imaging findings, failed conservative management.",
      ].join("\n");

      const llmResp = await fetch(LLM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: false,
          options: { temperature: 0.3, num_predict: 8192 },
        }),
        signal: AbortSignal.timeout(120000),
      });

      const llmJson = await llmResp.json();
      const letterText =
        llmJson?.message?.content ||
        llmJson?.choices?.[0]?.message?.content ||
        llmJson?.response ||
        "";

      const genTimeMs = Date.now() - startMs;
      console.log(`  Generated in ${genTimeMs}ms (${letterText.length} chars)`);

      // 4. Run automated metrics
      const policyCriteria = tc.payer_id === "AETNA"
        ? "1. Documented functional assessment scores\n2. Minimum 6 weeks conservative therapy\n3. Imaging correlation with symptoms\n4. Failed at least 2 medication classes\n5. Documented neurological examination"
        : "1. Minimum 6 weeks physical therapy\n2. At least 2 epidural steroid injections attempted\n3. MRI or CT imaging demonstrating pathology\n4. Failed at least 2 conservative treatment modalities\n5. Documentation of functional limitations";

      const coverage = evaluateCriteriaCoverage(letterText, policyCriteria);
      const accuracy = evaluateClinicalAccuracy(letterText, {
        icd10: profile.icd10_codes || [],
        cpt: profile.cpt_codes || [],
      });
      const format = evaluateFormatCompliance(letterText, tc.expected_sections || []);
      const completeness = evaluateCompleteness(letterText);

      console.log(`  Coverage: ${(coverage.score * 100).toFixed(0)}% | Accuracy: ${(accuracy.score * 100).toFixed(0)}% | Format: ${(format.score * 100).toFixed(0)}% | Complete: ${(completeness.score * 100).toFixed(0)}%`);

      // 5. LLM-as-Judge (optional, can be slow)
      let judgeResult = { score: null, reasoning: null, model: null };
      try {
        judgeResult = await llmJudge(letterText, policyCriteria, { url: LLM_URL, model });
        console.log(`  Judge: ${judgeResult.score}/10`);
      } catch (e) {
        console.log(`  Judge: skipped (${e.message})`);
      }

      // 6. Safety checks
      const safety = runSafetyChecks(
        letterText,
        profile,
        ["NASS guidelines", "AMA CPT guidelines"],
        profile.cpt_codes || []
      );
      if (!safety.passed) {
        console.log(`  Safety: ${safety.issues.length} issue(s) found`);
      }

      // 7. Store result
      const result_id = genId("res");
      await pool.query(
        `INSERT INTO ${S}.eval_results
         (result_id, run_id, test_case_id, generated_output, generation_time_ms,
          criteria_coverage_score, clinical_accuracy_score,
          format_compliance_score, completeness_score,
          llm_judge_score, llm_judge_reasoning, llm_judge_model)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12);`,
        [
          result_id, run_id, tc.test_case_id, letterText, genTimeMs,
          coverage.score, accuracy.score, format.score, completeness.score,
          judgeResult.score, judgeResult.reasoning, judgeResult.model,
        ]
      );

      results.push({ test_case_id: tc.test_case_id, coverage: coverage.score, accuracy: accuracy.score, format: format.score, completeness: completeness.score, judge: judgeResult.score });
      console.log(`  Stored: ${result_id}\n`);
    } catch (e) {
      console.error(`  ERROR: ${e.message}\n`);
      // Store failed result
      const result_id = genId("res");
      await pool.query(
        `INSERT INTO ${S}.eval_results
         (result_id, run_id, test_case_id, generated_output, generation_time_ms)
         VALUES ($1,$2,$3,$4,$5);`,
        [result_id, run_id, tc.test_case_id, `ERROR: ${e.message}`, Date.now() - startMs]
      );
    }
  }

  // 8. Update run summary
  const avgCoverage = results.reduce((s, r) => s + r.coverage, 0) / (results.length || 1);
  const avgAccuracy = results.reduce((s, r) => s + r.accuracy, 0) / (results.length || 1);
  const avgFormat = results.reduce((s, r) => s + r.format, 0) / (results.length || 1);
  const avgComplete = results.reduce((s, r) => s + r.completeness, 0) / (results.length || 1);
  const avgJudge = results.filter((r) => r.judge != null).reduce((s, r) => s + r.judge, 0) / (results.filter((r) => r.judge != null).length || 1);

  await pool.query(
    `UPDATE ${S}.eval_runs SET
       status = 'completed',
       completed_at = now(),
       summary = $2
     WHERE run_id = $1;`,
    [
      run_id,
      JSON.stringify({
        total_cases: testCases.length,
        completed_cases: results.length,
        avg_criteria_coverage: avgCoverage,
        avg_clinical_accuracy: avgAccuracy,
        avg_format_compliance: avgFormat,
        avg_completeness: avgComplete,
        avg_llm_judge_score: avgJudge,
      }),
    ]
  );

  console.log("=== SUMMARY ===");
  console.log(`Run: ${run_id}`);
  console.log(`Cases: ${results.length}/${testCases.length}`);
  console.log(`Avg Coverage: ${(avgCoverage * 100).toFixed(1)}%`);
  console.log(`Avg Accuracy: ${(avgAccuracy * 100).toFixed(1)}%`);
  console.log(`Avg Format:   ${(avgFormat * 100).toFixed(1)}%`);
  console.log(`Avg Complete: ${(avgComplete * 100).toFixed(1)}%`);
  console.log(`Avg Judge:    ${avgJudge.toFixed(1)}/10`);
  console.log("===============");

  await pool.end();
}

run().catch((e) => {
  console.error("Runner failed:", e);
  process.exit(1);
});
