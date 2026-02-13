# Files Edited — PHI Firewall Fix

## Changed Files

### 1. `hyve-chat/app/lib/phiFirewall.ts`
- Added optional `skipKeys` parameter to `assertNoPHI()`
- Allows callers to exempt top-level keys from the PHI scan
- Patient data is still fully validated

### 2. `hyve-chat/app/lib/api.ts`
- Updated `chatNonPhiCase()` (line 320) to skip admin-authored metadata keys:
  - `template` (letter template body/instructions)
  - `payer_policy` (clinical criteria, required docs)
  - `parent_letter` (denial reason/code for appeals)
  - `sections` (section-based generation data)

## Why
The `template_body` field contains dates and numbers in the letter template
that triggered PHI regex patterns (e.g. date formats, long numeric IDs),
even though it's admin-authored content — not patient data.
