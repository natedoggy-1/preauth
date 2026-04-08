# PreAuth AI — E2E Visual Test Suite

Playwright-based visual test suite that exercises every major flow of the PreAuth AI application running as an Expo Web build.

## Prerequisites

1. **Node.js 18+** installed
2. **Expo web server** running:
   ```bash
   cd hyve-chat && npx expo start --web
   ```
3. **Clinic DB API** running (for patient search / letter generation):
   ```bash
   cd hyve-chat/clinic-db-api && npm start
   ```

## Setup

```bash
cd tests/e2e
npm install
npx playwright install chromium
```

## Run Tests

```bash
# Default: headless against http://localhost:8081
npx playwright test

# Headed (watch the browser):
npx playwright test --headed

# Custom app URL:
APP_URL=http://localhost:19006 npx playwright test

# Debug mode (step through):
npx playwright test --debug
```

## View Report

```bash
npx playwright show-report
```

Screenshots are saved to `test-results/screenshots/`.

## Test Phases

| Phase | What it tests | Source tab |
|-------|---------------|-----------|
| 1 | App loads, Generate tab visible | `chat.tsx` |
| 2 | Patient search (Rodriguez/Maria) | `chat.tsx` drawer |
| 3 | Letter generation end-to-end | `chat.tsx` |
| 4 | Review tab: letter list, detail, editing | `review.tsx` |
| 5 | Tracking tab: stats, status groups, actions | `tracking.tsx` |
| 6 | Settings tab: config fields | `settings.tsx` |
| 7 | Eval tab: dashboard, runs, test cases | `evaluation.tsx` |
| 8 | Console errors: network, crashes, PHI leaks | all tabs |

## Known Deviations from Original Test Plan

The original test plan references features that do not exist in the current codebase:

- **Dashboard tab**: No separate dashboard — the app opens on the Generate tab
- **Reports tab**: Replaced by the Eval tab (evaluation framework dashboard)
- **Desktop App section in Settings**: Not implemented — Settings only has Base URL, API Key, Facility ID
- **Test Connection button**: Not present in current Settings
- **Import from CSV button**: Not present
- **Export PDF / Save PDF in Reports**: Not present (Eval tab has no export)

The test suite adapts these phases to test the equivalent functionality that exists.
