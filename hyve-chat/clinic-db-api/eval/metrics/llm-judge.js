// eval/metrics/llm-judge.js
// ============================================================================
// LLM-as-Judge: uses a second LLM pass to score prior auth letter quality.
// Calls a local Ollama instance (or configurable endpoint).
// ============================================================================

const SYSTEM_PROMPT = `You are a medical reviewer evaluating prior authorization letters for insurance payers. Score the following letter on a scale of 1-10 based on these five dimensions:

1. Medical Accuracy — Are diagnoses, procedure codes, and clinical facts correct and consistent?
2. Completeness — Are all required sections present? Is clinical history, conservative treatment, and medical necessity addressed?
3. Persuasiveness — Does the letter make a compelling case for medical necessity with specific evidence?
4. Policy Alignment — Does the letter address the payer's specific criteria and requirements?
5. Professional Tone — Is the language formal, clear, and appropriate for a medical-legal document?

Return ONLY a JSON object with this exact structure (no markdown, no code fences):
{ "score": N, "reasoning": "..." }

Where N is the overall score (1-10) and reasoning explains your assessment across the five dimensions in 2-4 sentences.`;

/**
 * Use an LLM to judge the quality of a generated prior auth letter.
 *
 * @param {string} letterText - the generated letter
 * @param {string} policyCriteria - the payer's policy criteria
 * @param {{ url?: string, model?: string, timeout?: number }} options - LLM config
 * @returns {Promise<{ score: number, reasoning: string, model: string }>}
 */
export async function llmJudge(letterText, policyCriteria, options = {}) {
  const url = options.url || "http://localhost:11434/api/chat";
  const model = options.model || "llama3";
  const timeout = options.timeout || 120_000; // 2 minutes default

  if (!letterText) {
    return {
      score: 0,
      reasoning: "No letter text provided for evaluation.",
      model,
    };
  }

  // Build user prompt with the letter and optional policy criteria
  let userPrompt = `## Prior Authorization Letter to Evaluate\n\n${letterText}`;

  if (policyCriteria) {
    userPrompt += `\n\n## Payer Policy Criteria\n\n${policyCriteria}`;
  }

  const requestBody = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    stream: false,
    options: {
      temperature: 0.1, // Low temperature for consistent scoring
      num_predict: 512,
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(
        `Ollama returned HTTP ${response.status}: ${errorText.slice(0, 500)}`
      );
    }

    const data = await response.json();

    // Ollama chat response structure: { message: { role, content }, ... }
    const content = data?.message?.content || "";

    // Parse JSON from the response. The LLM might wrap it in code fences.
    const parsed = extractJSON(content);

    if (parsed && typeof parsed.score === "number" && typeof parsed.reasoning === "string") {
      return {
        score: Math.max(1, Math.min(10, Math.round(parsed.score))),
        reasoning: parsed.reasoning.trim(),
        model: data?.model || model,
      };
    }

    // Fallback: if parsing fails, try to extract a numeric score from the text
    const fallbackScore = extractNumericScore(content);
    return {
      score: fallbackScore,
      reasoning: `LLM response could not be parsed as JSON. Raw response: ${content.slice(0, 500)}`,
      model: data?.model || model,
    };
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === "AbortError") {
      return {
        score: 0,
        reasoning: `LLM judge timed out after ${timeout}ms.`,
        model,
      };
    }

    return {
      score: 0,
      reasoning: `LLM judge error: ${err.message}`,
      model,
    };
  }
}

/**
 * Try to extract a JSON object from a string that may contain markdown
 * code fences or other surrounding text.
 * @param {string} text
 * @returns {object|null}
 */
function extractJSON(text) {
  if (!text) return null;

  // Try direct parse first
  try {
    return JSON.parse(text.trim());
  } catch {
    // continue to other strategies
  }

  // Try stripping markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue
    }
  }

  // Try finding a JSON object anywhere in the text
  const jsonMatch = text.match(/\{[\s\S]*"score"\s*:\s*\d+[\s\S]*"reasoning"\s*:[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // continue
    }
  }

  return null;
}

/**
 * Fallback: extract a numeric score (1-10) from free text.
 * @param {string} text
 * @returns {number}
 */
function extractNumericScore(text) {
  // Look for patterns like "score: 7", "Score: 8/10", "I give it a 7"
  const patterns = [
    /score[:\s]+(\d+)/i,
    /(\d+)\s*(?:\/\s*10|out\s+of\s+10)/i,
    /\b([1-9]|10)\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num >= 1 && num <= 10) return num;
    }
  }

  return 0;
}
