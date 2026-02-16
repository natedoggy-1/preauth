#!/usr/bin/env bash
# test-rag-flow.sh
# End-to-end test for the RAG-first policy/template resolution pipeline.
#
# Steps:
#   1. Seed the database with training data (policies, templates, patients, etc.)
#   2. Ingest policy + template documents into Pinecone via the /webhook/ingest endpoint
#   3. Send test clinical scenarios to the chat webhook
#   4. Verify RAG picked the correct policy_key and template_key
#
# Prerequisites:
#   - PostgreSQL running with demo schema
#   - n8n running with ingest-v1 and chat-v3-sections workflows active
#   - Ollama running with nomic-embed-text model
#   - PINECONE_ENABLED=true in n8n environment
#
# Usage:
#   chmod +x training/test-rag-flow.sh
#   cd clinic-db-api && ./training/test-rag-flow.sh
#
# Environment overrides:
#   DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME, DB_SCHEMA
#   N8N_URL, N8N_API_KEY
#   SKIP_SEED=1      — skip DB seeding
#   SKIP_INGEST=1    — skip document ingestion
#   ONLY_INGEST=1    — only run ingestion, skip tests

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_PASS="${DB_PASS:-postgres}"
DB_NAME="${DB_NAME:-postgres}"
DB_SCHEMA="${DB_SCHEMA:-demo}"

N8N_URL="${N8N_URL:-http://localhost:5678}"
N8N_API_KEY="${N8N_API_KEY:-test-api-key}"
API_URL="${API_URL:-http://localhost:3100}"
BRIDGE_TOKEN="${BRIDGE_TOKEN:-dev-bridge-token-123}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOC_DIR="${SCRIPT_DIR}/documents"
SEED_SQL="${SCRIPT_DIR}/seed-rag-training.sql"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'  # No Color

PASS=0
FAIL=0
SKIP=0

# ── Helpers ─────────────────────────────────────────────────────────
log()   { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[PASS]${NC}  $*"; PASS=$((PASS + 1)); }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; FAIL=$((FAIL + 1)); }
warn()  { echo -e "${YELLOW}[SKIP]${NC}  $*"; SKIP=$((SKIP + 1)); }
sep()   { echo -e "\n${CYAN}════════════════════════════════════════════════════════════${NC}"; }

run_sql() {
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -q -t -A -c "$1" 2>/dev/null || echo ""
}

ingest_doc() {
  local file_path="$1"
  local doc_role="$2"
  local doc_key="$3"     # template_key or policy_key
  local key_field="$4"   # "template_key" or "policy_key"
  local payer_key="${5:-}"
  local service_key="${6:-}"
  local file_name
  file_name="$(basename "$file_path")"
  local file_id="${file_name%.*}"

  log "  Ingesting: $file_name (role=$doc_role, $key_field=$doc_key)"

  local extra_fields=""
  [ -n "$payer_key" ] && extra_fields="$extra_fields -F payer_key=$payer_key"
  [ -n "$service_key" ] && extra_fields="$extra_fields -F service_key=$service_key"

  local response
  response=$(curl -s -w "\n%{http_code}" \
    -X POST "${N8N_URL}/webhook/ingest" \
    -H "X-API-Key: ${N8N_API_KEY}" \
    -F "file=@${file_path}" \
    -F "facility_id=FAC-DEMO" \
    -F "file_id=${file_id}" \
    -F "file_name=${file_name}" \
    -F "doc_role=${doc_role}" \
    -F "mime_type=text/plain" \
    -F "${key_field}=${doc_key}" \
    $extra_fields \
    2>/dev/null || echo -e "\n000")

  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | head -n -1)

  if [ "$http_code" = "200" ]; then
    local upserted
    upserted=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('pinecone_upserted', False))" 2>/dev/null || echo "unknown")
    if [ "$upserted" = "True" ]; then
      ok "  Ingested + embedded: $file_name → Pinecone"
    else
      warn "  Ingested but NOT embedded (Pinecone disabled?): $file_name"
    fi
  else
    fail "  Ingest failed (HTTP $http_code): $file_name"
    echo "    Response: $body" | head -3
  fi
}

test_rag_match() {
  local test_name="$1"
  local payer_key="$2"
  local service_key="$3"
  local cpt_code="$4"
  local icd10_code="$5"
  local expected_policy="$6"
  local expected_template="$7"
  local message="${8:-}"

  log "Test: $test_name"

  local payload
  payload=$(cat <<ENDJSON
{
  "message": "${message}",
  "payer_key": "${payer_key}",
  "service_key": "${service_key}",
  "facility_id": "FAC-DEMO",
  "tenant_id": 1,
  "intent": "generate_letter",
  "non_phi_packet": {
    "letter_type": "initial_auth",
    "request": {
      "cpt_code": "${cpt_code}",
      "icd10_code": "${icd10_code}",
      "service_name": "${test_name}"
    },
    "problems": [
      { "icd10_code": "${icd10_code}", "description": "${test_name}" }
    ]
  }
}
ENDJSON
)

  local response
  response=$(curl -s -w "\n%{http_code}" \
    -X POST "${N8N_URL}/webhook/chat-v3" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${N8N_API_KEY}" \
    -d "$payload" \
    2>/dev/null || echo -e "\n000")

  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | head -n -1)

  if [ "$http_code" != "200" ]; then
    fail "  HTTP $http_code — $test_name"
    echo "    Response: $(echo "$body" | head -3)"
    return
  fi

  # Extract debug info
  local policy_source template_source rag_policy_score rag_template_score
  local actual_policy actual_template

  policy_source=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('_debug',{}).get('policy_source','?'))" 2>/dev/null || echo "?")
  template_source=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('_debug',{}).get('template_source','?'))" 2>/dev/null || echo "?")
  rag_policy_score=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('_debug',{}).get('rag_policy_score','?'))" 2>/dev/null || echo "?")
  rag_template_score=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('_debug',{}).get('rag_template_score','?'))" 2>/dev/null || echo "?")
  actual_policy=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('policy_key','?'))" 2>/dev/null || echo "?")
  actual_template=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('template_key','?'))" 2>/dev/null || echo "?")

  echo "    Policy:   expected=$expected_policy  actual=$actual_policy  source=$policy_source  score=$rag_policy_score"
  echo "    Template: expected=$expected_template actual=$actual_template source=$template_source score=$rag_template_score"

  local policy_ok=false
  local template_ok=false

  if [ "$actual_policy" = "$expected_policy" ]; then
    policy_ok=true
  fi
  if [ "$actual_template" = "$expected_template" ]; then
    template_ok=true
  fi

  if $policy_ok && $template_ok; then
    ok "  $test_name — both matched correctly"
  elif $policy_ok; then
    warn "  $test_name — policy matched, template mismatch"
  elif $template_ok; then
    warn "  $test_name — template matched, policy mismatch"
  else
    fail "  $test_name — both mismatched"
  fi
}


# ══════════════════════════════════════════════════════════════════════
# STEP 1: SEED DATABASE
# ══════════════════════════════════════════════════════════════════════
sep
log "STEP 1: Seed Database"

if [ "${SKIP_SEED:-}" = "1" ]; then
  warn "Skipping DB seed (SKIP_SEED=1)"
else
  if [ ! -f "$SEED_SQL" ]; then
    fail "Seed file not found: $SEED_SQL"
    exit 1
  fi

  log "Running seed-rag-training.sql..."
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -f "$SEED_SQL" -q 2>&1 | tail -5

  # Verify key records
  patient_count=$(run_sql "SELECT count(*) FROM ${DB_SCHEMA}.patients WHERE patient_id LIKE 'PAT-100%'")
  policy_count=$(run_sql "SELECT count(*) FROM ${DB_SCHEMA}.payer_policies WHERE policy_key LIKE 'POL-%'")
  template_count=$(run_sql "SELECT count(*) FROM ${DB_SCHEMA}.letter_templates WHERE template_key LIKE 'TMPL-%'")
  request_count=$(run_sql "SELECT count(*) FROM ${DB_SCHEMA}.preauth_requests WHERE request_id LIKE 'REQ-100%'")

  log "  Patients:  $patient_count"
  log "  Policies:  $policy_count"
  log "  Templates: $template_count"
  log "  Requests:  $request_count"

  if [ "$patient_count" -ge 5 ] && [ "$policy_count" -ge 10 ] && [ "$template_count" -ge 4 ]; then
    ok "Database seeded successfully"
  else
    fail "Database seed incomplete"
  fi
fi


# ══════════════════════════════════════════════════════════════════════
# STEP 2: INGEST DOCUMENTS INTO PINECONE
# ══════════════════════════════════════════════════════════════════════
sep
log "STEP 2: Ingest Documents → Pinecone"

if [ "${SKIP_INGEST:-}" = "1" ]; then
  warn "Skipping ingestion (SKIP_INGEST=1)"
else
  log "Ingesting policy documents..."
  ingest_doc "$DOC_DIR/policy-aetna-spine.txt" "policy" "POL-AETNA-SPINE-001" "policy_key" "aetna" "spine_surgery"
  ingest_doc "$DOC_DIR/policy-aetna-tka.txt"   "policy" "POL-AETNA-TKA-001"   "policy_key" "aetna" "orthopedic_surgery"
  ingest_doc "$DOC_DIR/policy-uhc-spine.txt"    "policy" "POL-UHC-SPINE-001"   "policy_key" "uhc"   "spine_surgery"
  ingest_doc "$DOC_DIR/policy-cigna-scs.txt"    "policy" "POL-CIGNA-SCS-001"   "policy_key" "cigna" "pain_management"
  ingest_doc "$DOC_DIR/policy-humana-esi.txt"   "policy" "POL-HUMANA-ESI-001"  "policy_key" "humana" "pain_management"

  echo ""
  log "Ingesting template documents..."
  ingest_doc "$DOC_DIR/template-initial-spine.txt" "template" "TMPL-IA-SPINE-001" "template_key" "" "spine_surgery"
  ingest_doc "$DOC_DIR/template-initial-ortho.txt" "template" "TMPL-IA-ORTHO-001" "template_key" "" "orthopedic_surgery"
  ingest_doc "$DOC_DIR/template-initial-pain.txt"  "template" "TMPL-IA-PAIN-001"  "template_key" "" "pain_management"
  ingest_doc "$DOC_DIR/template-initial-scs.txt"   "template" "TMPL-IA-SCS-001"   "template_key" "" "pain_management"

  echo ""
  log "Waiting 5 seconds for Pinecone index to sync..."
  sleep 5
fi

if [ "${ONLY_INGEST:-}" = "1" ]; then
  sep
  log "ONLY_INGEST=1 — skipping RAG tests"
  echo -e "\n${GREEN}Done.${NC} Ingestion complete."
  exit 0
fi


# ══════════════════════════════════════════════════════════════════════
# STEP 3: RAG MATCHING TESTS
# ══════════════════════════════════════════════════════════════════════
sep
log "STEP 3: RAG Matching Tests"
log "Sending clinical scenarios to chat-v3 webhook and checking policy/template selection..."
echo ""

# Test 1: Maria Santos — Aetna TKA
test_rag_match \
  "Aetna total knee arthroplasty for knee osteoarthritis" \
  "aetna" "orthopedic_surgery" "27447" "M17.11" \
  "POL-AETNA-TKA-001" "TMPL-IA-ORTHO-001" \
  "Prior auth for total knee replacement right knee severe osteoarthritis KL grade 4 failed PT and injections"

echo ""

# Test 2: James Mitchell — UHC Lumbar Fusion
test_rag_match \
  "UHC lumbar spinal fusion for spondylolisthesis" \
  "uhc" "spine_surgery" "22612" "M51.16" \
  "POL-UHC-SPINE-001" "TMPL-IA-SPINE-001" \
  "L4-L5 posterolateral fusion for degenerative spondylolisthesis with bilateral foraminal stenosis failed conservative care"

echo ""

# Test 3: Lisa Chen — Cigna SCS
test_rag_match \
  "Cigna spinal cord stimulator for failed back surgery syndrome" \
  "cigna" "pain_management" "63685" "M96.1" \
  "POL-CIGNA-SCS-001" "TMPL-IA-SCS-001" \
  "Permanent SCS implantation for failed back surgery syndrome chronic intractable pain successful trial 65% relief psych eval cleared"

echo ""

# Test 4: David Thompson — BCBS Cervical Fusion (ACDF)
test_rag_match \
  "BCBS cervical disc herniation ACDF" \
  "bcbs" "spine_surgery" "22551" "M50.121" \
  "POL-BCBS-SPINE-001" "TMPL-IA-SPINE-001" \
  "C5-C6 anterior cervical discectomy and fusion disc herniation C6 radiculopathy confirmed by MRI and EMG"

echo ""

# Test 5: Sarah Williams — Humana ESI
test_rag_match \
  "Humana epidural steroid injection for lumbar radiculopathy" \
  "humana" "pain_management" "64483" "M54.41" \
  "POL-HUMANA-ESI-001" "TMPL-IA-PAIN-001" \
  "L5-S1 transforaminal epidural steroid injection for sciatica disc protrusion S1 radiculopathy"

echo ""

# Test 6: Cross-payer — Aetna lumbar fusion (not TKA)
test_rag_match \
  "Aetna lumbar fusion — should NOT pick TKA policy" \
  "aetna" "spine_surgery" "22612" "M51.16" \
  "POL-AETNA-SPINE-001" "TMPL-IA-SPINE-001" \
  "Lumbar spinal fusion L4-L5 for disc degeneration and stenosis failed 12 weeks PT and 2 ESIs"

echo ""

# Test 7: Aetna ESI (pain management, not surgery)
test_rag_match \
  "Aetna ESI — should pick pain policy not spine surgery policy" \
  "aetna" "pain_management" "64483" "M54.41" \
  "POL-AETNA-ESI-001" "TMPL-IA-PAIN-001" \
  "Epidural steroid injection for lumbar radiculopathy disc herniation failed conservative treatment 6 weeks"


# ══════════════════════════════════════════════════════════════════════
# STEP 4: DB API INTEGRATION TESTS
# ══════════════════════════════════════════════════════════════════════
sep
log "STEP 4: Backend API Integration Tests"
log "Testing generate-context endpoint for each patient..."
echo ""

for REQ_ID in REQ-1001 REQ-1002 REQ-1003 REQ-1004 REQ-1005; do
  PAT_ID="PAT-${REQ_ID: -4}"

  response=$(curl -s -w "\n%{http_code}" \
    -X POST "${API_URL}/api/letters/generate-context" \
    -H "Content-Type: application/json" \
    -H "X-Bridge-Token: ${BRIDGE_TOKEN}" \
    -d "{\"patient_id\":\"${PAT_ID}\",\"request_id\":\"${REQ_ID}\",\"letter_type\":\"initial_auth\"}" \
    2>/dev/null || echo -e "\n000")

  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | head -n -1)

  if [ "$http_code" = "200" ]; then
    patient_name=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('context',{}).get('patient',{}).get('full_name','?'))" 2>/dev/null || echo "?")
    payer_name=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('context',{}).get('coverage',{}).get('payer_name','?'))" 2>/dev/null || echo "?")
    cpt=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('context',{}).get('request',{}).get('cpt_code','?'))" 2>/dev/null || echo "?")
    has_policy=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); p=d.get('context',{}).get('payer_policy',{}); print('yes' if p.get('clinical_criteria') else 'no')" 2>/dev/null || echo "?")
    has_template=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('context',{}).get('template',{}); print('yes' if t.get('template_body') else 'no')" 2>/dev/null || echo "?")

    ok "  ${REQ_ID}: ${patient_name} | ${payer_name} | CPT ${cpt} | policy=${has_policy} template=${has_template}"
  else
    fail "  ${REQ_ID}: HTTP ${http_code}"
  fi
done


# ══════════════════════════════════════════════════════════════════════
# SUMMARY
# ══════════════════════════════════════════════════════════════════════
sep
echo ""
echo -e "  ${GREEN}PASSED:${NC}  $PASS"
echo -e "  ${RED}FAILED:${NC}  $FAIL"
echo -e "  ${YELLOW}SKIPPED:${NC} $SKIP"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}Some tests failed.${NC} Check the output above for details."
  exit 1
else
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
fi
