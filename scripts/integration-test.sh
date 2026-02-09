#!/usr/bin/env bash
set -euo pipefail

SERVER_A="http://43.134.124.4:9100"
SERVER_B="http://150.109.16.237:9100"
PASS=0
FAIL=0

pass() { echo "  ✓ PASS: $1"; ((PASS++)) || true; }
fail() { echo "  ✗ FAIL: $1 -- $2"; ((FAIL++)) || true; }

test_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then pass "$desc"; else fail "$desc" "expected=$expected actual=$actual"; fi
}

echo "========================================="
echo "  Agent Bridge Integration Tests"
echo "========================================="
echo ""

# --- Test 1: Server reachability ---
echo "=== Test 1: Server reachability ==="
INFO_A=$(curl -sf "$SERVER_A/info" 2>/dev/null || echo '{}')
test_eq "Server A /info reachable" "cloud-a" "$(echo "$INFO_A" | jq -r '.machine_id // empty')"
INFO_B=$(curl -sf "$SERVER_B/info" 2>/dev/null || echo '{}')
test_eq "Server B /info reachable" "cloud-b" "$(echo "$INFO_B" | jq -r '.machine_id // empty')"
echo ""

# --- Test 2: Local spawn on Server B ---
echo "=== Test 2: Local spawn on Server B ==="
SPAWN_B=$(curl -sf -X POST "$SERVER_B/spawn" -H 'Content-Type: application/json' \
  -d '{"type":"generic","agent_id":"agent-b1","task":"test task on B"}' 2>/dev/null || echo '{}')
test_eq "Spawn on B ok" "true" "$(echo "$SPAWN_B" | jq -r '.ok // empty')"
test_eq "Spawn on B machine" "cloud-b" "$(echo "$SPAWN_B" | jq -r '.machine // empty')"
echo ""

# --- Test 3: Local spawn on Server A ---
echo "=== Test 3: Local spawn on Server A ==="
SPAWN_A=$(curl -sf -X POST "$SERVER_A/spawn" -H 'Content-Type: application/json' \
  -d '{"type":"generic","agent_id":"agent-a1","task":"test task on A"}' 2>/dev/null || echo '{}')
test_eq "Spawn on A ok" "true" "$(echo "$SPAWN_A" | jq -r '.ok // empty')"
test_eq "Spawn on A machine" "cloud-a" "$(echo "$SPAWN_A" | jq -r '.machine // empty')"
echo ""

# --- Test 4: Cross-machine locate (A finds agent on B) ---
echo "=== Test 4: Cross-machine locate ==="
LOCATE=$(curl -sf "$SERVER_A/locate?agent_id=agent-b1" 2>/dev/null || echo '{}')
test_eq "Locate agent-b1 from A" "cloud-b" "$(echo "$LOCATE" | jq -r '.machine // empty')"
echo ""

# --- Test 5: Cross-machine message delivery (A → B) ---
echo "=== Test 5: Cross-machine message (A → B) ==="
MSG_RESULT=$(curl -sf -X POST "$SERVER_A/message" -H 'Content-Type: application/json' \
  -d '{"agent_id":"agent-b1","from":"server-a","message":"hello from A"}' 2>/dev/null || echo '{}')
test_eq "Cross-machine message ok" "true" "$(echo "$MSG_RESULT" | jq -r '.ok // empty')"
echo ""

# --- Test 6: Verify message arrived on B ---
echo "=== Test 6: Verify message on B ==="
MSGS=$(curl -sf "$SERVER_B/test/messages?agent_id=agent-b1" 2>/dev/null || echo '{"messages":[]}')
test_eq "Message count >= 1" "true" "$(echo "$MSGS" | jq '[.messages | length >= 1] | .[0]')"
test_eq "Message from" "server-a" "$(echo "$MSGS" | jq -r '.messages[0].from // empty')"
test_eq "Message content" "hello from A" "$(echo "$MSGS" | jq -r '.messages[0].message // empty')"
echo ""

# --- Test 7: Bidirectional (B → A) ---
echo "=== Test 7: Bidirectional message (B → A) ==="
MSG_BA=$(curl -sf -X POST "$SERVER_B/message" -H 'Content-Type: application/json' \
  -d '{"agent_id":"agent-a1","from":"server-b","message":"hello from B"}' 2>/dev/null || echo '{}')
test_eq "B→A message ok" "true" "$(echo "$MSG_BA" | jq -r '.ok // empty')"
MSGS_A=$(curl -sf "$SERVER_A/test/messages?agent_id=agent-a1" 2>/dev/null || echo '{"messages":[]}')
test_eq "Message arrived on A" "server-b" "$(echo "$MSGS_A" | jq -r '.messages[0].from // empty')"
echo ""

# --- Test 8: Remote spawn forwarding (A spawns on B) ---
echo "=== Test 8: Remote spawn forwarding ==="
REMOTE_SPAWN=$(curl -sf -X POST "$SERVER_A/spawn" -H 'Content-Type: application/json' \
  -d '{"type":"generic","agent_id":"agent-b2","task":"remote spawned","machine":"cloud-b"}' 2>/dev/null || echo '{}')
test_eq "Remote spawn ok" "true" "$(echo "$REMOTE_SPAWN" | jq -r '.ok // empty')"
# Verify agent exists on B
AGENTS_B=$(curl -sf "$SERVER_B/agents" 2>/dev/null || echo '[]')
HAS_B2=$(echo "$AGENTS_B" | jq '[.[] | select(.id=="agent-b2")] | length > 0')
test_eq "agent-b2 exists on B" "true" "$HAS_B2"
echo ""

# --- Test 9: Stop agent ---
echo "=== Test 9: Stop agent ==="
STOP=$(curl -sf -X POST "$SERVER_B/stop" -H 'Content-Type: application/json' \
  -d '{"agent_id":"agent-b1"}' 2>/dev/null || echo '{}')
test_eq "Stop agent ok" "true" "$(echo "$STOP" | jq -r '.ok // empty')"
# Verify agent is gone
AGENTS_B2=$(curl -sf "$SERVER_B/agents" 2>/dev/null || echo '[]')
HAS_B1=$(echo "$AGENTS_B2" | jq '[.[] | select(.id=="agent-b1")] | length == 0')
test_eq "agent-b1 removed" "true" "$HAS_B1"
echo ""

# --- Cleanup ---
echo "=== Cleanup ==="
curl -sf -X POST "$SERVER_A/stop" -H 'Content-Type: application/json' -d '{"agent_id":"agent-a1"}' >/dev/null 2>&1 || true
curl -sf -X POST "$SERVER_B/stop" -H 'Content-Type: application/json' -d '{"agent_id":"agent-b2"}' >/dev/null 2>&1 || true
echo "  Cleaned up test agents"
echo ""

# --- Summary ---
echo "========================================="
echo "  Results: $PASS passed, $FAIL failed"
echo "========================================="
if [ "$FAIL" -eq 0 ]; then
  echo "  ALL TESTS PASSED"
  exit 0
else
  echo "  SOME TESTS FAILED"
  exit 1
fi
