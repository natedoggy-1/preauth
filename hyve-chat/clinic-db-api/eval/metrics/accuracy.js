// eval/metrics/accuracy.js
// ============================================================================
// Deterministic accuracy metrics for evaluating generated prior auth letters.
// All scores are 0.0 to 1.0.
// ============================================================================

/**
 * Evaluate criteria coverage: what percentage of policy criteria items
 * are addressed in the generated letter.
 *
 * Parses policyCriteria by splitting on numbered list items (1., 2., etc.)
 * and checks each criterion for keyword presence in the letter text
 * (case-insensitive substring match).
 *
 * @param {string} letterText - the generated letter
 * @param {string} policyCriteria - the payer's policy criteria text
 * @returns {{ score: number, addressed: string[], missed: string[] }}
 */
export function evaluateCriteriaCoverage(letterText, policyCriteria) {
  if (!letterText || !policyCriteria) {
    return { score: 0, addressed: [], missed: [] };
  }

  const letterLower = letterText.toLowerCase();

  // Split on numbered items: "1.", "2.", "3)" etc., or bullet points
  const items = policyCriteria
    .split(/(?:^|\n)\s*\d+[.)]\s*/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  if (items.length === 0) {
    return { score: 1.0, addressed: [], missed: [] };
  }

  const addressed = [];
  const missed = [];

  for (const criterion of items) {
    // Extract meaningful keywords (4+ characters) from the criterion
    const keywords = criterion
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length >= 4);

    if (keywords.length === 0) {
      // Trivial criterion with no substantial keywords; count as addressed
      addressed.push(criterion);
      continue;
    }

    // A criterion is "addressed" if at least 40% of its keywords appear in the letter
    const matchCount = keywords.filter((w) => letterLower.includes(w)).length;
    const matchRatio = matchCount / keywords.length;

    if (matchRatio >= 0.4) {
      addressed.push(criterion);
    } else {
      missed.push(criterion);
    }
  }

  const total = addressed.length + missed.length;
  const score = total > 0 ? addressed.length / total : 0;

  return {
    score: Math.round(score * 1000) / 1000,
    addressed,
    missed,
  };
}

/**
 * Evaluate clinical accuracy: check that ICD-10 and CPT codes present in the
 * letter match the expected codes.
 *
 * ICD-10 pattern: letter followed by 2-3 digits, dot, 1+ digits (e.g. M51.16, G89.4)
 * CPT pattern: standalone 5-digit numbers in common procedural ranges
 *
 * @param {string} letterText
 * @param {{ icd10: string[], cpt: string[] }} expectedCodes
 * @returns {{ score: number, found: string[], missing: string[], fabricated: string[] }}
 */
export function evaluateClinicalAccuracy(letterText, expectedCodes) {
  if (!letterText || !expectedCodes) {
    return { score: 0, found: [], missing: [], fabricated: [] };
  }

  const icd10Expected = (expectedCodes.icd10 || []).map((c) => c.toUpperCase().trim());
  const cptExpected = (expectedCodes.cpt || []).map((c) => c.trim());

  // Extract ICD-10 codes from letter (e.g. M51.16, G89.4, S13.4, E11.65)
  const icd10Regex = /\b([A-Z]\d{2,3}\.\d{1,4})\b/gi;
  const icd10Found = [];
  let match;
  while ((match = icd10Regex.exec(letterText)) !== null) {
    const code = match[1].toUpperCase();
    if (!icd10Found.includes(code)) {
      icd10Found.push(code);
    }
  }

  // Extract CPT codes from letter (5-digit numbers that look like CPT codes)
  // Common CPT ranges: 10000-69999 (surgery), 70000-79999 (radiology),
  // 80000-89999 (pathology), 90000-99999 (medicine/E&M)
  const cptRegex = /\b(\d{5})\b/g;
  const cptFound = [];
  while ((match = cptRegex.exec(letterText)) !== null) {
    const code = match[1];
    const num = parseInt(code, 10);
    // Filter to plausible CPT ranges (10000-99999), excluding things like ZIP codes
    // by only capturing codes that appear near medical context or match expected
    if (num >= 10000 && num <= 99999) {
      if (!cptFound.includes(code)) {
        cptFound.push(code);
      }
    }
  }

  const allExpected = [...icd10Expected, ...cptExpected];
  const allFound = [...icd10Found, ...cptFound];

  // Codes that are expected and found in the letter
  const found = allExpected.filter((code) => allFound.includes(code));

  // Codes that are expected but NOT found in the letter
  const missing = allExpected.filter((code) => !allFound.includes(code));

  // Codes that are found in the letter but NOT in the expected set (hallucinated/fabricated)
  const fabricated = allFound.filter((code) => !allExpected.includes(code));

  // Score: proportion of expected codes found, with a penalty for fabricated codes
  const expectedTotal = allExpected.length;
  if (expectedTotal === 0) {
    // No expected codes provided; score based on absence of fabricated codes
    return {
      score: fabricated.length === 0 ? 1.0 : Math.max(0, 1.0 - fabricated.length * 0.2),
      found,
      missing,
      fabricated,
    };
  }

  const foundRatio = found.length / expectedTotal;
  const fabricatedPenalty = fabricated.length * 0.1;
  const score = Math.max(0, Math.min(1.0, foundRatio - fabricatedPenalty));

  return {
    score: Math.round(score * 1000) / 1000,
    found,
    missing,
    fabricated,
  };
}

/**
 * Evaluate format compliance: check that expected section headers are present
 * in the letter.
 *
 * Looks for section headers as lines that are all-caps or contain the section
 * name (case-insensitive match). Also matches common variations like
 * "CLINICAL HISTORY" matching "Clinical History:" or "## CLINICAL HISTORY".
 *
 * @param {string} letterText
 * @param {string[]} expectedSections - e.g. ['CLINICAL HISTORY', 'CONSERVATIVE TREATMENT', 'MEDICAL NECESSITY']
 * @returns {{ score: number, present: string[], missing: string[] }}
 */
export function evaluateFormatCompliance(letterText, expectedSections) {
  if (!letterText || !expectedSections || expectedSections.length === 0) {
    return { score: 0, present: [], missing: [] };
  }

  const letterLower = letterText.toLowerCase();
  const lines = letterText.split("\n").map((l) => l.trim());

  const present = [];
  const missing = [];

  for (const section of expectedSections) {
    const sectionLower = section.toLowerCase();

    // Strategy 1: exact substring match (case-insensitive)
    if (letterLower.includes(sectionLower)) {
      present.push(section);
      continue;
    }

    // Strategy 2: check if any line is an all-caps version or contains the section name
    // with common delimiters (colon, dash, hash marks)
    const sectionWords = sectionLower.split(/\s+/);
    const lineMatch = lines.some((line) => {
      const lineLower = line.toLowerCase().replace(/^[#*\-]+\s*/, "").replace(/[:]\s*$/, "");
      // All significant words of the section appear in this line
      return sectionWords.every((w) => lineLower.includes(w));
    });

    if (lineMatch) {
      present.push(section);
    } else {
      missing.push(section);
    }
  }

  const total = present.length + missing.length;
  const score = total > 0 ? present.length / total : 0;

  return {
    score: Math.round(score * 1000) / 1000,
    present,
    missing,
  };
}

/**
 * Evaluate completeness: verify the letter has no [MISSING: ...] placeholder
 * markers, and includes expected structural elements (salutation, closing).
 *
 * @param {string} letterText
 * @returns {{ score: number, missingMarkers: string[], hasSalutation: boolean, hasClosing: boolean }}
 */
export function evaluateCompleteness(letterText) {
  if (!letterText) {
    return { score: 0, missingMarkers: [], hasSalutation: false, hasClosing: false };
  }

  const letterLower = letterText.toLowerCase();

  // Find all [MISSING: ...] markers
  const missingRegex = /\[MISSING:\s*[^\]]*\]/gi;
  const missingMarkers = [];
  let match;
  while ((match = missingRegex.exec(letterText)) !== null) {
    missingMarkers.push(match[0]);
  }

  // Also check for other placeholder patterns: [TODO: ...], [INSERT ...], {PLACEHOLDER}
  const placeholderRegex = /\[(?:TODO|INSERT|FILL|TBD|PLACEHOLDER):\s*[^\]]*\]/gi;
  while ((match = placeholderRegex.exec(letterText)) !== null) {
    missingMarkers.push(match[0]);
  }

  // Check for salutation: "Dear" or "Re:" or "To Whom It May Concern"
  const hasSalutation =
    /\bdear\b/i.test(letterText) ||
    /\bre:\s/i.test(letterText) ||
    /to whom it may concern/i.test(letterLower);

  // Check for closing: "Sincerely", "Respectfully", "Thank you"
  const hasClosing =
    /\bsincerely\b/i.test(letterText) ||
    /\brespectfully\b/i.test(letterText) ||
    /\bthank you\b/i.test(letterLower) ||
    /\bregards\b/i.test(letterText);

  // Score: start at 1.0, subtract for each issue
  let score = 1.0;

  // Each missing marker is a -0.15 penalty
  score -= missingMarkers.length * 0.15;

  // Missing salutation is a -0.1 penalty
  if (!hasSalutation) {
    score -= 0.1;
  }

  // Missing closing is a -0.1 penalty
  if (!hasClosing) {
    score -= 0.1;
  }

  score = Math.max(0, Math.min(1.0, score));

  return {
    score: Math.round(score * 1000) / 1000,
    missingMarkers,
    hasSalutation,
    hasClosing,
  };
}
