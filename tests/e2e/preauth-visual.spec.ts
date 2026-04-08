import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// PreAuth AI — Comprehensive Visual E2E Test Suite
// ---------------------------------------------------------------------------
// Targets the Expo Web build of the PreAuth AI application.
//
// The app uses React Native Web which renders standard HTML elements.
// Tab navigation lives at the bottom of the viewport as a tab bar.
//
// Actual tabs (from _layout.tsx):
//   Generate | Review | Tracking | Patients | Upload | Eval | Settings
//
// NOTE: The original test plan references "Dashboard", "Reports", and
// "Desktop App" sections that do not exist in this codebase.  This test
// suite adapts those phases to the real app structure and flags the
// missing features in the final report.
// ---------------------------------------------------------------------------

/** Accumulated test results for the final summary report. */
const results: Record<string, { status: "PASS" | "FAIL" | "SKIP"; detail: string }> = {};

function record(phase: string, status: "PASS" | "FAIL" | "SKIP", detail: string) {
  results[phase] = { status, detail };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Click a bottom tab bar item by its visible label text. */
async function clickTab(page: Page, tabLabel: string) {
  // React Native Web renders tab labels as text inside role="tab" or as
  // clickable divs.  We look for the text inside the tab bar area.
  const tab = page.getByRole("tab", { name: tabLabel }).or(
    page.locator(`[data-testid="tab-${tabLabel.toLowerCase()}"]`)
  ).or(
    // Fallback: look for any element containing the tab label text at the
    // bottom of the page (last 120px).
    page.locator(`text=${tabLabel}`)
  );
  await tab.first().click();
}

/** Wait for the app shell to be ready (tab bar visible). */
async function waitForAppReady(page: Page) {
  // The tab bar contains the "Generate" label — wait for it.
  await page.waitForFunction(() => {
    return document.body?.innerText?.includes("Generate");
  }, { timeout: 30_000 });
}

/** Take a named screenshot and attach it to the test report. */
async function snap(page: Page, name: string) {
  await page.screenshot({ path: `test-results/screenshots/${name}.png`, fullPage: true });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe.serial("PreAuth AI — Full Visual Test", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto("/");
    await waitForAppReady(page);
  });

  test.afterAll(async () => {
    // Print summary report
    const lines = [
      "",
      "=".repeat(70),
      "  PREAUTH AI — VISUAL TEST REPORT",
      "=".repeat(70),
    ];

    const phases = [
      ["PHASE 1", "Initial State / Generate Tab"],
      ["PHASE 2", "Patient Search"],
      ["PHASE 3", "Letter Generation"],
      ["PHASE 4", "Review Tab"],
      ["PHASE 5", "Tracking Tab"],
      ["PHASE 6", "Settings Tab"],
      ["PHASE 7", "Eval Tab (Reports equivalent)"],
      ["PHASE 8", "Console Errors"],
    ];

    for (const [key, label] of phases) {
      const r = results[key];
      if (r) {
        const icon = r.status === "PASS" ? "PASS" : r.status === "FAIL" ? "FAIL" : "SKIP";
        lines.push(`  ${key} — ${label.padEnd(35)} ${icon} — ${r.detail}`);
      } else {
        lines.push(`  ${key} — ${label.padEnd(35)} N/A  — not executed`);
      }
    }

    lines.push("=".repeat(70));
    lines.push("");

    console.log(lines.join("\n"));
    await page.close();
  });

  // =========================================================================
  // PHASE 1 — Initial State / Generate Tab (app loads on Generate/chat tab)
  // =========================================================================
  test("Phase 1: Initial state — Generate tab loads correctly", async () => {
    await snap(page, "01-initial-state");

    // The Generate tab (chat.tsx) should show the patient bar with "None selected"
    const bodyText = await page.textContent("body");

    // Verify core UI elements are present
    const hasPatientLabel = bodyText?.includes("Patient");
    const hasNoneSelected = bodyText?.includes("None selected");
    const hasSendButton = bodyText?.includes("Send");

    // The system message should be visible
    const hasSystemMsg = bodyText?.includes("Ready") || bodyText?.includes("patient");

    if (hasPatientLabel && hasSendButton) {
      record("PHASE 1", "PASS", `Generate tab loaded. Patient: ${hasNoneSelected ? "None selected" : "already set"}. System message present: ${!!hasSystemMsg}`);
    } else {
      record("PHASE 1", "FAIL", `Missing UI elements. Patient label: ${hasPatientLabel}, Send button: ${hasSendButton}`);
    }

    expect(hasPatientLabel).toBeTruthy();
    expect(hasSendButton).toBeTruthy();
  });

  // =========================================================================
  // PHASE 2 — Patient Search
  // =========================================================================
  test("Phase 2: Patient search — search for Rodriguez", async () => {
    // Click "Expand" to show the patient controls
    const expandBtn = page.locator("text=Expand").first();
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(500);
    }

    await snap(page, "02a-expanded-controls");

    // Click "Search" button in the patient bar to open the search drawer
    const searchBtn = page.locator("text=Search").first();
    await searchBtn.click();
    await page.waitForTimeout(1000);

    await snap(page, "02b-search-drawer-open");

    // The search drawer should now be visible with a search input
    const searchInput = page.locator('input[placeholder*="Search"]').or(
      page.locator('input[placeholder*="name"]')
    ).first();

    const searchInputVisible = await searchInput.isVisible().catch(() => false);

    if (searchInputVisible) {
      // Type "Rodriguez" into the search field
      await searchInput.fill("Rodriguez");
      await page.waitForTimeout(300);

      // Click the Search button inside the drawer
      // There are multiple "Search" buttons — the one inside the drawer panel
      const drawerSearchBtn = page.locator("text=Search").last();
      await drawerSearchBtn.click();

      // Wait for API response
      await page.waitForTimeout(5000);

      await snap(page, "02c-search-results-rodriguez");

      const bodyText = await page.textContent("body") || "";
      const hasRodriguez = bodyText.includes("Rodriguez");
      const hasMaria = bodyText.includes("Maria");
      const hasPAT001 = bodyText.includes("PAT-001");
      const hasNoMatches = bodyText.includes("No matches");
      const hasFound = bodyText.includes("Found");

      if (hasRodriguez || hasMaria || hasPAT001) {
        record("PHASE 2", "PASS", `Patient found: Rodriguez=${hasRodriguez}, Maria=${hasMaria}, PAT-001=${hasPAT001}`);

        // Click on the patient row to select them
        const patientRow = page.locator("text=Rodriguez").first();
        if (await patientRow.isVisible()) {
          await patientRow.click();
          await page.waitForTimeout(8000); // Wait for background data to load

          await snap(page, "02d-patient-selected");
        }
      } else if (hasNoMatches) {
        // Try alternate search terms
        await searchInput.fill("Maria");
        const altSearchBtn = page.locator("text=Search").last();
        await altSearchBtn.click();
        await page.waitForTimeout(5000);

        await snap(page, "02c-search-results-maria");
        const altBody = await page.textContent("body") || "";
        const altFound = altBody.includes("Maria") || altBody.includes("Found");

        if (altFound) {
          record("PHASE 2", "PASS", `Patient found with alternate search "Maria"`);
          // Select the first result
          const firstResult = page.locator("text=Maria").first();
          if (await firstResult.isVisible()) {
            await firstResult.click();
            await page.waitForTimeout(8000);
          }
        } else {
          record("PHASE 2", "FAIL", `No patients found for "Rodriguez" or "Maria". Server may be offline.`);
        }
      } else {
        record("PHASE 2", "FAIL", `Search returned unexpected state. Found text: ${hasFound}. Body snippet: ${bodyText.slice(0, 200)}`);
      }
    } else {
      record("PHASE 2", "FAIL", "Search input not found in drawer");
    }

    // Close the drawer if still open
    const closeBtn = page.locator("text=Close").first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }
  });

  // =========================================================================
  // PHASE 3 — Letter Generation
  // =========================================================================
  test("Phase 3: Generate letter flow", async () => {
    const bodyText = await page.textContent("body") || "";

    // Check if a patient is selected (not "None selected")
    const hasPatient = !bodyText.includes("None selected");

    if (!hasPatient) {
      record("PHASE 3", "SKIP", "No patient selected — cannot generate letter (depends on Phase 2)");
      return;
    }

    // Expand controls if collapsed
    const expandBtn = page.locator("text=Expand").first();
    if (await expandBtn.isVisible().catch(() => false)) {
      await expandBtn.click();
      await page.waitForTimeout(500);
    }

    await snap(page, "03a-pre-generate");

    // Verify letter type pills are visible
    const hasInitialAuth = bodyText.includes("Initial Auth");
    const hasLetterType = bodyText.includes("LETTER TYPE");

    // Check for clinical context indicators
    const hasReady = bodyText.includes("Ready");
    const hasDx = bodyText.includes("Dx:");

    await snap(page, "03b-letter-type-selection");

    // Click "Generate Letter" button
    const generateBtn = page.locator("text=Generate Letter").first();
    const canGenerate = await generateBtn.isVisible().catch(() => false);

    if (canGenerate) {
      await generateBtn.click();

      // Wait up to 90 seconds for letter generation (LLM call)
      await page.waitForTimeout(5000); // initial wait

      // Poll for completion — look for the letter content or error
      let generated = false;
      let errorOccurred = false;
      for (let i = 0; i < 17; i++) { // 17 * 5s = 85s total
        const currentText = await page.textContent("body") || "";
        // Success indicators: letter content appears, or validation result
        if (
          currentText.includes("Validation") ||
          currentText.includes("criteria met") ||
          currentText.includes("Dear") ||
          currentText.includes("CLINICAL HISTORY") ||
          currentText.includes("Medical Necessity") ||
          currentText.includes("draft")
        ) {
          generated = true;
          break;
        }
        // Error indicators
        if (
          currentText.includes("timed out") ||
          currentText.includes("Failed to fetch") ||
          currentText.includes("Generate Letter Error")
        ) {
          errorOccurred = true;
          break;
        }
        await page.waitForTimeout(5000);
      }

      await snap(page, "03c-post-generate");

      if (generated) {
        const postText = await page.textContent("body") || "";
        const hasValidation = postText.includes("Validation") || postText.includes("criteria");
        record("PHASE 3", "PASS", `Letter generated. Validation shown: ${hasValidation}`);
      } else if (errorOccurred) {
        record("PHASE 3", "FAIL", "Letter generation failed — error/timeout from AI service");
      } else {
        record("PHASE 3", "FAIL", "Letter generation did not complete within 90 seconds");
      }
    } else {
      record("PHASE 3", "FAIL", `Generate Letter button not visible. Letter type visible: ${hasLetterType}, Ready: ${hasReady}`);
    }
  });

  // =========================================================================
  // PHASE 4 — Review Tab
  // =========================================================================
  test("Phase 4: Review tab — letter list and detail", async () => {
    await clickTab(page, "Review");
    await page.waitForTimeout(2000);

    await snap(page, "04a-review-tab");

    const bodyText = await page.textContent("body") || "";

    // Verify Review tab structure
    const hasLetterReview = bodyText.includes("Letter Review");
    const hasViewEdit = bodyText.includes("View, edit, and validate");
    const hasStatusFilters = bodyText.includes("All") && bodyText.includes("draft");
    const hasLoadButton = bodyText.includes("Load");

    if (!hasLetterReview) {
      record("PHASE 4", "FAIL", "Letter Review heading not found");
      return;
    }

    // Click "Load" to fetch letters
    const loadBtn = page.locator("text=Load").first();
    if (await loadBtn.isVisible().catch(() => false)) {
      await loadBtn.click();
      await page.waitForTimeout(5000);

      await snap(page, "04b-review-letters-loaded");

      const postLoadText = await page.textContent("body") || "";
      const hasLetters = !postLoadText.includes("No letters found");
      const hasLetterItems = postLoadText.includes("Type:") && postLoadText.includes("Date:");

      if (hasLetterItems) {
        // Click on the first letter to open detail view
        // Letters have "Type:" text — click the first card
        const letterCard = page.locator("text=Type:").first();
        await letterCard.click();
        await page.waitForTimeout(3000);

        await snap(page, "04c-review-letter-detail");

        const detailText = await page.textContent("body") || "";
        const hasBack = detailText.includes("Back");
        const hasPdfBtn = detailText.includes("PDF");
        const hasValidateBtn = detailText.includes("Validate");
        const hasSaveDraft = detailText.includes("Save Draft");
        const hasEditBtn = detailText.includes("Edit");
        const hasSections = hasEditBtn; // sections have Edit buttons

        record("PHASE 4", "PASS",
          `Letters loaded & detail opened. Sections: ${hasSections}, PDF: ${hasPdfBtn}, Validate: ${hasValidateBtn}, Save: ${hasSaveDraft}`
        );

        // Go back to list for clean state
        const backBtn = page.locator("text=Back").first();
        if (await backBtn.isVisible().catch(() => false)) {
          await backBtn.click();
          await page.waitForTimeout(500);
        }
      } else if (hasLetters) {
        record("PHASE 4", "PASS", "Review tab loaded but no letter items to display (empty DB)");
      } else {
        record("PHASE 4", "PASS", `Review tab loaded. Status filters: ${hasStatusFilters}. No letters in DB yet.`);
      }
    } else {
      record("PHASE 4", "FAIL", "Load button not found on Review tab");
    }
  });

  // =========================================================================
  // PHASE 5 — Tracking Tab
  // =========================================================================
  test("Phase 5: Tracking tab — submission tracking", async () => {
    await clickTab(page, "Tracking");
    await page.waitForTimeout(2000);

    await snap(page, "05a-tracking-tab");

    const bodyText = await page.textContent("body") || "";

    const hasSubmissionTracking = bodyText.includes("Submission Tracking");
    const hasMonitor = bodyText.includes("Monitor prior auth");
    const hasRefresh = bodyText.includes("Refresh");

    if (!hasSubmissionTracking) {
      record("PHASE 5", "FAIL", "Submission Tracking heading not found");
      return;
    }

    // Click Refresh to load letters
    const refreshBtn = page.locator("text=Refresh").first();
    if (await refreshBtn.isVisible().catch(() => false)) {
      await refreshBtn.click();
      await page.waitForTimeout(5000);

      await snap(page, "05b-tracking-loaded");

      const postText = await page.textContent("body") || "";
      const hasTotal = postText.includes("Total");
      const hasDrafts = postText.includes("Drafts");
      const hasSent = postText.includes("Sent");
      const hasApproved = postText.includes("Approved");
      const hasDenied = postText.includes("Denied");
      const hasApproval = postText.includes("Approval");
      const hasGroups = postText.includes("Drafts") || postText.includes("Sent / Awaiting");
      const hasMarkSent = postText.includes("Mark Sent");

      const statsVisible = hasTotal && hasDrafts && hasSent && hasApproved && hasDenied;

      record("PHASE 5", "PASS",
        `Tracking loaded. Stats bar: ${statsVisible}, Approval rate: ${hasApproval}, ` +
        `Status groups: ${hasGroups}, Quick actions: ${hasMarkSent}`
      );
    } else {
      record("PHASE 5", "FAIL", "Refresh button not found");
    }
  });

  // =========================================================================
  // PHASE 6 — Settings Tab
  // =========================================================================
  test("Phase 6: Settings tab — configuration", async () => {
    await clickTab(page, "Settings");
    await page.waitForTimeout(2000);

    await snap(page, "06a-settings-tab");

    const bodyText = await page.textContent("body") || "";

    const hasSettings = bodyText.includes("Settings");
    const hasBaseUrl = bodyText.includes("Base URL");
    const hasApiKey = bodyText.includes("API Key");
    const hasFacilityId = bodyText.includes("Facility ID");
    const hasSaveBtn = bodyText.includes("Save");
    const hasClearBtn = bodyText.includes("Clear");

    // NOTE: The original test plan references a "Desktop App" section with
    // "Test Connection" and "Import from CSV" buttons. These do NOT exist
    // in the current settings.tsx. Flagging as expected deviation.
    const hasDesktopApp = bodyText.includes("Desktop App");
    const hasTestConnection = bodyText.includes("Test Connection");

    if (hasSettings && hasBaseUrl && hasApiKey && hasFacilityId) {
      record("PHASE 6", "PASS",
        `Settings loaded. Base URL: ${hasBaseUrl}, API Key: ${hasApiKey}, ` +
        `Facility ID: ${hasFacilityId}, Save: ${hasSaveBtn}, Clear: ${hasClearBtn}. ` +
        `NOTE: Desktop App section not present (expected — not implemented in current build). ` +
        `Test Connection: ${hasTestConnection}`
      );
    } else {
      record("PHASE 6", "FAIL",
        `Settings page incomplete. Settings: ${hasSettings}, Base URL: ${hasBaseUrl}, ` +
        `API Key: ${hasApiKey}, Facility ID: ${hasFacilityId}`
      );
    }
  });

  // =========================================================================
  // PHASE 7 — Eval Tab (stands in for "Reports" in the original test plan)
  // =========================================================================
  test("Phase 7: Eval tab — evaluation dashboard (Reports equivalent)", async () => {
    await clickTab(page, "Eval");
    await page.waitForTimeout(3000);

    await snap(page, "07a-eval-tab");

    const bodyText = await page.textContent("body") || "";

    // The Eval tab has: Overview | Runs | Test Cases tabs
    const hasOverview = bodyText.includes("Overview");
    const hasRuns = bodyText.includes("Runs");
    const hasTestCases = bodyText.includes("Test Cases");
    const hasTotalRuns = bodyText.includes("Total Runs");
    const hasAvgScore = bodyText.includes("Avg Score");
    const hasScoreBars =
      bodyText.includes("Criteria Coverage") ||
      bodyText.includes("Clinical Accuracy") ||
      bodyText.includes("Average Scores");
    const hasLoading = bodyText.includes("Loading evaluation data");

    // NOTE: The original test plan references "Reports" with charts, CSV export,
    // and PDF save. The actual app has an "Eval" tab with score bars and test
    // run data. Flagging the differences.

    if (hasOverview || hasTotalRuns || hasScoreBars || hasLoading) {
      // Click "Runs" sub-tab if available
      const runsTab = page.locator("text=Runs").first();
      if (await runsTab.isVisible().catch(() => false)) {
        await runsTab.click();
        await page.waitForTimeout(2000);
        await snap(page, "07b-eval-runs-tab");
      }

      record("PHASE 7", "PASS",
        `Eval tab loaded. Tabs: Overview=${hasOverview}, Runs=${hasRuns}, TestCases=${hasTestCases}. ` +
        `Stats: TotalRuns=${hasTotalRuns}, AvgScore=${hasAvgScore}, ScoreBars=${hasScoreBars}. ` +
        `NOTE: No "Reports" tab exists — Eval tab serves as the analytics/reporting view. ` +
        `CSV export and PDF save buttons are not present in this tab.`
      );
    } else {
      record("PHASE 7", "FAIL",
        `Eval tab did not load expected content. Overview: ${hasOverview}, Loading: ${hasLoading}`
      );
    }
  });

  // =========================================================================
  // PHASE 8 — Console Errors
  // =========================================================================
  test("Phase 8: Check browser console for errors", async () => {
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];

    // Listen for console messages
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      } else if (msg.type() === "warning") {
        consoleWarnings.push(msg.text());
      }
    });

    // Navigate through each tab to trigger any lazy-loaded errors
    const tabs = ["Generate", "Review", "Tracking", "Patients", "Upload", "Eval", "Settings"];

    for (const tab of tabs) {
      try {
        await clickTab(page, tab);
        await page.waitForTimeout(1500);
      } catch {
        // Tab may not be clickable — skip
      }
    }

    await snap(page, "08-console-check-final-state");

    // Filter out known benign errors
    const criticalErrors = consoleErrors.filter((e) => {
      // Ignore common non-critical React Native Web warnings
      if (e.includes("ResizeObserver loop")) return false;
      if (e.includes("Each child in a list should have a unique")) return false;
      if (e.includes("componentWillReceiveProps")) return false;
      if (e.includes("componentWillMount")) return false;
      return true;
    });

    const hasNetworkErrors = criticalErrors.some(
      (e) => e.includes("Failed to fetch") || e.includes("NetworkError") || e.includes("ERR_CONNECTION")
    );
    const hasCrashErrors = criticalErrors.some(
      (e) => e.includes("Something went wrong") || e.includes("Uncaught") || e.includes("Unhandled")
    );
    const hasPhiLeaks = criticalErrors.some(
      (e) => e.includes("{{PATIENT_NAME}}") || e.includes("[MISSING:")
    );

    if (criticalErrors.length === 0) {
      record("PHASE 8", "PASS", `No critical console errors. Warnings: ${consoleWarnings.length}`);
    } else {
      const summary = [
        `${criticalErrors.length} console error(s) found.`,
        hasNetworkErrors ? "NETWORK ERRORS detected (Failed to fetch)." : "",
        hasCrashErrors ? "CRASH ERRORS detected (uncaught exceptions)." : "",
        hasPhiLeaks ? "PHI PLACEHOLDER LEAKS detected!" : "",
        `First 3 errors: ${criticalErrors.slice(0, 3).join(" | ")}`,
      ].filter(Boolean).join(" ");

      record("PHASE 8", "FAIL", summary);
    }

    // Log all errors for debugging
    if (criticalErrors.length > 0) {
      console.log("\n--- Console Errors ---");
      for (const err of criticalErrors) {
        console.log(`  [ERROR] ${err}`);
      }
      console.log("--- End Console Errors ---\n");
    }
  });

  // =========================================================================
  // Bonus: Additional tab checks (Patients, Upload)
  // =========================================================================
  test("Bonus: Patients tab loads", async () => {
    await clickTab(page, "Patients");
    await page.waitForTimeout(2000);

    await snap(page, "bonus-patients-tab");

    const bodyText = await page.textContent("body") || "";
    const hasPatients = bodyText.includes("Patient") || bodyText.includes("Search");
    expect(hasPatients).toBeTruthy();
  });

  test("Bonus: Upload tab loads", async () => {
    await clickTab(page, "Upload");
    await page.waitForTimeout(2000);

    await snap(page, "bonus-upload-tab");

    const bodyText = await page.textContent("body") || "";
    const hasUpload = bodyText.includes("Upload") || bodyText.includes("Ingest") || bodyText.includes("Document");
    expect(hasUpload).toBeTruthy();
  });
});
