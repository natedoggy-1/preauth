// ============================================================================
// routes/eval.js
// ============================================================================
// Evaluation Framework API — Prior Auth AI Platform
// ============================================================================
// Provides endpoints for managing golden test cases, evaluation runs,
// per-case results, A/B tests, feedback collection, and an aggregate
// dashboard. Mounted at /api/eval in server.js.
//
// Usage in server.js:
//   import createEvalRouter from './routes/eval.js';
//   app.use('/api/eval', requireToken, createEvalRouter(pool, CLINIC_SCHEMA));
// ============================================================================

import express from "express";

function genId(prefix = "eval") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function createEvalRouter(pool, CLINIC_SCHEMA) {
  const router = express.Router();
  const S = CLINIC_SCHEMA;

  // ==========================================================================
  // TEST CASES
  // ==========================================================================

  // GET /test-cases — list active test cases
  router.get("/test-cases", async (req, res) => {
    try {
      const difficulty = (req.query.difficulty || "").trim();
      const service_category = (req.query.service_category || "").trim();

      let sql = `SELECT * FROM ${S}.eval_test_cases WHERE is_active = true`;
      const params = [];
      let idx = 1;

      if (difficulty) {
        sql += ` AND difficulty = $${idx++}`;
        params.push(difficulty);
      }
      if (service_category) {
        sql += ` AND service_category = $${idx++}`;
        params.push(service_category);
      }

      sql += ` ORDER BY created_at DESC;`;

      const r = await pool.query(sql, params);
      res.json({ ok: true, test_cases: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // POST /test-cases — create a test case
  router.post("/test-cases", async (req, res) => {
    try {
      const b = req.body;
      const test_case_id = genId("tc");

      await pool.query(
        `INSERT INTO ${S}.eval_test_cases
         (test_case_id, case_name, patient_profile, service_category, payer_id,
          expected_output, expected_sections, difficulty, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
        [
          test_case_id,
          b.case_name,
          JSON.stringify(b.patient_profile),
          b.service_category || null,
          b.payer_id || null,
          b.expected_output,
          b.expected_sections ? JSON.stringify(b.expected_sections) : null,
          b.difficulty || "medium",
          b.tags || null,
        ]
      );

      res.json({ ok: true, test_case_id });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GET /test-cases/:id — single test case
  router.get("/test-cases/:id", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT * FROM ${S}.eval_test_cases WHERE test_case_id = $1 LIMIT 1;`,
        [req.params.id]
      );
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "Test case not found" });
      res.json({ ok: true, test_case: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // PUT /test-cases/:id — update a test case
  router.put("/test-cases/:id", async (req, res) => {
    try {
      const b = req.body;
      const test_case_id = req.params.id;

      const r = await pool.query(
        `UPDATE ${S}.eval_test_cases SET
           case_name          = COALESCE($2, case_name),
           patient_profile    = COALESCE($3, patient_profile),
           service_category   = COALESCE($4, service_category),
           payer_id           = COALESCE($5, payer_id),
           expected_output    = COALESCE($6, expected_output),
           expected_sections  = COALESCE($7, expected_sections),
           difficulty         = COALESCE($8, difficulty),
           tags               = COALESCE($9, tags),
           is_active          = COALESCE($10, is_active),
           updated_at         = now()
         WHERE test_case_id = $1
         RETURNING test_case_id;`,
        [
          test_case_id,
          b.case_name || null,
          b.patient_profile ? JSON.stringify(b.patient_profile) : null,
          b.service_category || null,
          b.payer_id || null,
          b.expected_output || null,
          b.expected_sections ? JSON.stringify(b.expected_sections) : null,
          b.difficulty || null,
          b.tags || null,
          b.is_active != null ? b.is_active : null,
        ]
      );

      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "Test case not found" });
      res.json({ ok: true, test_case_id });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // ==========================================================================
  // EVALUATION RUNS
  // ==========================================================================

  // POST /runs — create an evaluation run
  router.post("/runs", async (req, res) => {
    try {
      const b = req.body;
      const run_id = genId("run");

      await pool.query(
        `INSERT INTO ${S}.eval_runs
         (run_id, run_name, run_type, model_id, config)
         VALUES ($1, $2, $3, $4, $5);`,
        [
          run_id,
          b.run_name || null,
          b.run_type,
          b.model_id || null,
          b.config ? JSON.stringify(b.config) : null,
        ]
      );

      res.json({ ok: true, run_id });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GET /runs — list runs
  router.get("/runs", async (req, res) => {
    try {
      const status = (req.query.status || "").trim();
      const limit = Math.min(Number(req.query.limit || 50), 200);

      let sql = `SELECT * FROM ${S}.eval_runs`;
      const params = [];
      let idx = 1;

      if (status) {
        sql += ` WHERE status = $${idx++}`;
        params.push(status);
      }

      sql += ` ORDER BY started_at DESC LIMIT $${idx}`;
      params.push(limit);

      const r = await pool.query(sql, params);
      res.json({ ok: true, runs: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GET /runs/:id — single run with aggregated metrics
  router.get("/runs/:id", async (req, res) => {
    try {
      const run_id = req.params.id;

      const runRes = await pool.query(
        `SELECT * FROM ${S}.eval_runs WHERE run_id = $1 LIMIT 1;`,
        [run_id]
      );
      if (!runRes.rows[0]) return res.status(404).json({ ok: false, error: "Run not found" });

      const metricsRes = await pool.query(
        `SELECT
           COUNT(*)::int                             AS total_cases,
           AVG(criteria_coverage_score)              AS avg_criteria_coverage,
           AVG(clinical_accuracy_score)              AS avg_clinical_accuracy,
           AVG(format_compliance_score)              AS avg_format_compliance,
           AVG(completeness_score)                   AS avg_completeness,
           AVG(llm_judge_score)                      AS avg_llm_judge,
           AVG(human_score)                          AS avg_human_score,
           AVG(generation_time_ms)                   AS avg_generation_time_ms,
           AVG(retrieval_precision)                  AS avg_retrieval_precision,
           AVG(retrieval_recall)                     AS avg_retrieval_recall,
           AVG(retrieval_f1)                         AS avg_retrieval_f1,
           COUNT(*) FILTER (WHERE human_reviewer IS NOT NULL)::int AS human_reviewed_count
         FROM ${S}.eval_results
         WHERE run_id = $1;`,
        [run_id]
      );

      res.json({
        ok: true,
        run: runRes.rows[0],
        metrics: metricsRes.rows[0] || null,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // ==========================================================================
  // RESULTS
  // ==========================================================================

  // POST /results — store a per-case result
  router.post("/results", async (req, res) => {
    try {
      const b = req.body;
      const result_id = genId("res");

      await pool.query(
        `INSERT INTO ${S}.eval_results
         (result_id, run_id, test_case_id, generated_output, generation_time_ms,
          retrieval_precision, retrieval_recall, retrieval_f1, retrieved_chunks,
          criteria_coverage_score, clinical_accuracy_score,
          format_compliance_score, completeness_score,
          llm_judge_score, llm_judge_reasoning, llm_judge_model,
          human_reviewer, human_score, human_notes, human_reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20);`,
        [
          result_id,
          b.run_id,
          b.test_case_id,
          b.generated_output,
          b.generation_time_ms || null,
          b.retrieval_precision ?? null,
          b.retrieval_recall ?? null,
          b.retrieval_f1 ?? null,
          b.retrieved_chunks ? JSON.stringify(b.retrieved_chunks) : null,
          b.criteria_coverage_score ?? null,
          b.clinical_accuracy_score ?? null,
          b.format_compliance_score ?? null,
          b.completeness_score ?? null,
          b.llm_judge_score ?? null,
          b.llm_judge_reasoning || null,
          b.llm_judge_model || null,
          b.human_reviewer || null,
          b.human_score ?? null,
          b.human_notes || null,
          b.human_reviewed_at || null,
        ]
      );

      res.json({ ok: true, result_id });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // ==========================================================================
  // METRICS
  // ==========================================================================

  // GET /metrics/:run_id — aggregate metrics for a run
  router.get("/metrics/:run_id", async (req, res) => {
    try {
      const run_id = req.params.run_id;

      const aggRes = await pool.query(
        `SELECT
           COUNT(*)::int                             AS total_cases,
           AVG(criteria_coverage_score)              AS avg_criteria_coverage,
           AVG(clinical_accuracy_score)              AS avg_clinical_accuracy,
           AVG(format_compliance_score)              AS avg_format_compliance,
           AVG(completeness_score)                   AS avg_completeness,
           AVG(llm_judge_score)                      AS avg_llm_judge,
           AVG(human_score)                          AS avg_human_score,
           AVG(generation_time_ms)                   AS avg_generation_time_ms,
           MIN(generation_time_ms)                   AS min_generation_time_ms,
           MAX(generation_time_ms)                   AS max_generation_time_ms,
           AVG(retrieval_precision)                  AS avg_retrieval_precision,
           AVG(retrieval_recall)                     AS avg_retrieval_recall,
           AVG(retrieval_f1)                         AS avg_retrieval_f1,
           COUNT(*) FILTER (WHERE criteria_coverage_score >= 0.8)::int  AS pass_criteria_coverage,
           COUNT(*) FILTER (WHERE clinical_accuracy_score >= 0.8)::int  AS pass_clinical_accuracy,
           COUNT(*) FILTER (WHERE format_compliance_score >= 0.8)::int  AS pass_format_compliance,
           COUNT(*) FILTER (WHERE completeness_score >= 0.8)::int       AS pass_completeness,
           COUNT(*) FILTER (WHERE llm_judge_score >= 0.7)::int          AS pass_llm_judge,
           COUNT(*) FILTER (WHERE human_reviewer IS NOT NULL)::int      AS human_reviewed_count
         FROM ${S}.eval_results
         WHERE run_id = $1;`,
        [run_id]
      );

      const byDifficultyRes = await pool.query(
        `SELECT
           tc.difficulty,
           COUNT(*)::int                AS case_count,
           AVG(r.criteria_coverage_score) AS avg_criteria_coverage,
           AVG(r.clinical_accuracy_score) AS avg_clinical_accuracy,
           AVG(r.llm_judge_score)         AS avg_llm_judge,
           AVG(r.generation_time_ms)      AS avg_generation_time_ms
         FROM ${S}.eval_results r
         JOIN ${S}.eval_test_cases tc ON tc.test_case_id = r.test_case_id
         WHERE r.run_id = $1
         GROUP BY tc.difficulty
         ORDER BY tc.difficulty;`,
        [run_id]
      );

      const agg = aggRes.rows[0] || {};
      const total = agg.total_cases || 0;

      res.json({
        ok: true,
        run_id,
        aggregate: agg,
        pass_rates: total > 0 ? {
          criteria_coverage: (agg.pass_criteria_coverage || 0) / total,
          clinical_accuracy: (agg.pass_clinical_accuracy || 0) / total,
          format_compliance: (agg.pass_format_compliance || 0) / total,
          completeness: (agg.pass_completeness || 0) / total,
          llm_judge: (agg.pass_llm_judge || 0) / total,
        } : null,
        by_difficulty: byDifficultyRes.rows,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // ==========================================================================
  // FEEDBACK
  // ==========================================================================

  // POST /feedback — submit a feedback item
  router.post("/feedback", async (req, res) => {
    try {
      const b = req.body;
      const feedback_id = genId("fb");

      await pool.query(
        `INSERT INTO ${S}.eval_feedback
         (feedback_id, letter_id, log_id, feedback_type, feedback_source,
          original_text, edited_text, diff_summary, tags, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);`,
        [
          feedback_id,
          b.letter_id || null,
          b.log_id || null,
          b.feedback_type,
          b.feedback_source || null,
          b.original_text || null,
          b.edited_text || null,
          b.diff_summary || null,
          b.tags || null,
          b.created_by || null,
        ]
      );

      res.json({ ok: true, feedback_id });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GET /feedback — list feedback
  router.get("/feedback", async (req, res) => {
    try {
      const letter_id = (req.query.letter_id || "").trim();
      const feedback_type = (req.query.feedback_type || "").trim();

      let sql = `SELECT * FROM ${S}.eval_feedback WHERE 1=1`;
      const params = [];
      let idx = 1;

      if (letter_id) {
        sql += ` AND letter_id = $${idx++}`;
        params.push(letter_id);
      }
      if (feedback_type) {
        sql += ` AND feedback_type = $${idx++}`;
        params.push(feedback_type);
      }

      sql += ` ORDER BY created_at DESC LIMIT 200;`;

      const r = await pool.query(sql, params);
      res.json({ ok: true, feedback: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // ==========================================================================
  // A/B TESTS
  // ==========================================================================

  // POST /ab-tests — create an A/B test
  router.post("/ab-tests", async (req, res) => {
    try {
      const b = req.body;
      const ab_test_id = genId("ab");

      await pool.query(
        `INSERT INTO ${S}.eval_ab_tests
         (ab_test_id, test_name, variant_a_config, variant_b_config, allocation_pct, status)
         VALUES ($1,$2,$3,$4,$5,$6);`,
        [
          ab_test_id,
          b.test_name || null,
          JSON.stringify(b.variant_a_config),
          JSON.stringify(b.variant_b_config),
          b.allocation_pct ?? 0.5,
          b.status || "draft",
        ]
      );

      res.json({ ok: true, ab_test_id });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GET /ab-tests — list A/B tests
  router.get("/ab-tests", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT * FROM ${S}.eval_ab_tests ORDER BY started_at DESC NULLS LAST, ab_test_id DESC;`
      );
      res.json({ ok: true, ab_tests: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GET /ab-tests/:id — single A/B test with results from both variants
  router.get("/ab-tests/:id", async (req, res) => {
    try {
      const ab_test_id = req.params.id;

      const testRes = await pool.query(
        `SELECT * FROM ${S}.eval_ab_tests WHERE ab_test_id = $1 LIMIT 1;`,
        [ab_test_id]
      );
      if (!testRes.rows[0]) return res.status(404).json({ ok: false, error: "A/B test not found" });

      const ab_test = testRes.rows[0];

      // Fetch runs associated with this A/B test (convention: config contains ab_test_id)
      const runsRes = await pool.query(
        `SELECT r.run_id, r.run_name, r.run_type, r.model_id, r.config, r.status,
                COUNT(res.result_id)::int           AS result_count,
                AVG(res.criteria_coverage_score)     AS avg_criteria_coverage,
                AVG(res.clinical_accuracy_score)     AS avg_clinical_accuracy,
                AVG(res.format_compliance_score)     AS avg_format_compliance,
                AVG(res.completeness_score)          AS avg_completeness,
                AVG(res.llm_judge_score)             AS avg_llm_judge,
                AVG(res.generation_time_ms)          AS avg_generation_time_ms
         FROM ${S}.eval_runs r
         LEFT JOIN ${S}.eval_results res ON res.run_id = r.run_id
         WHERE r.config->>'ab_test_id' = $1
         GROUP BY r.run_id
         ORDER BY r.started_at;`,
        [ab_test_id]
      );

      res.json({
        ok: true,
        ab_test,
        variant_runs: runsRes.rows,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // ==========================================================================
  // DASHBOARD
  // ==========================================================================

  // GET /dashboard — aggregate stats across all evaluation activity
  router.get("/dashboard", async (req, res) => {
    try {
      // Total runs and their statuses
      const runsOverviewRes = await pool.query(
        `SELECT
           COUNT(*)::int                                           AS total_runs,
           COUNT(*) FILTER (WHERE status = 'running')::int         AS running_runs,
           COUNT(*) FILTER (WHERE status = 'completed')::int       AS completed_runs,
           COUNT(*) FILTER (WHERE status = 'failed')::int          AS failed_runs
         FROM ${S}.eval_runs;`
      );

      // Average scores across all completed runs (last 30 days)
      const recentScoresRes = await pool.query(
        `SELECT
           COUNT(*)::int                  AS total_results,
           AVG(criteria_coverage_score)   AS avg_criteria_coverage,
           AVG(clinical_accuracy_score)   AS avg_clinical_accuracy,
           AVG(format_compliance_score)   AS avg_format_compliance,
           AVG(completeness_score)        AS avg_completeness,
           AVG(llm_judge_score)           AS avg_llm_judge,
           AVG(human_score)               AS avg_human_score,
           AVG(generation_time_ms)        AS avg_generation_time_ms
         FROM ${S}.eval_results r
         JOIN ${S}.eval_runs rn ON rn.run_id = r.run_id
         WHERE rn.started_at >= now() - INTERVAL '30 days';`
      );

      // Score trends: average scores per run over time (last 20 runs)
      const trendsRes = await pool.query(
        `SELECT
           rn.run_id,
           rn.run_name,
           rn.started_at,
           rn.model_id,
           COUNT(r.result_id)::int          AS case_count,
           AVG(r.criteria_coverage_score)   AS avg_criteria_coverage,
           AVG(r.clinical_accuracy_score)   AS avg_clinical_accuracy,
           AVG(r.completeness_score)        AS avg_completeness,
           AVG(r.llm_judge_score)           AS avg_llm_judge,
           AVG(r.generation_time_ms)        AS avg_generation_time_ms
         FROM ${S}.eval_runs rn
         LEFT JOIN ${S}.eval_results r ON r.run_id = rn.run_id
         WHERE rn.status = 'completed'
         GROUP BY rn.run_id
         ORDER BY rn.started_at DESC
         LIMIT 20;`
      );

      // Top safety issues
      const safetyRes = await pool.query(
        `SELECT
           check_type,
           severity,
           COUNT(*)::int AS occurrence_count
         FROM ${S}.eval_safety_log
         WHERE resolved = false
         GROUP BY check_type, severity
         ORDER BY
           CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
           occurrence_count DESC
         LIMIT 20;`
      );

      // Feedback summary
      const feedbackRes = await pool.query(
        `SELECT
           feedback_type,
           COUNT(*)::int AS count
         FROM ${S}.eval_feedback
         GROUP BY feedback_type
         ORDER BY count DESC;`
      );

      // Test case coverage
      const testCaseRes = await pool.query(
        `SELECT
           COUNT(*)::int                                    AS total_test_cases,
           COUNT(*) FILTER (WHERE is_active = true)::int    AS active_test_cases,
           COUNT(DISTINCT difficulty)::int                   AS difficulty_levels
         FROM ${S}.eval_test_cases;`
      );

      res.json({
        ok: true,
        dashboard: {
          runs: runsOverviewRes.rows[0] || {},
          recent_scores: recentScoresRes.rows[0] || {},
          trends: trendsRes.rows,
          top_safety_issues: safetyRes.rows,
          feedback_summary: feedbackRes.rows,
          test_cases: testCaseRes.rows[0] || {},
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  return router;
}
