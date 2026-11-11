#!/usr/bin/env bash
# Protocol smoke test for the Seçki İstanbul MCP server (web/functions/mcp.ts), with raw curl.
#
#   bash web/scripts/mcp-smoke.sh                          # local: npx wrangler pages dev dist-demo --port 8791
#   bash web/scripts/mcp-smoke.sh https://secki.istanbul   # live
#
# Checks HTTP codes and key fields of both protocol eras (2025 initialize handshake and 2026-07-28), the
# HTTP guard (405, 403 on every method, 413, CORS preflight, no JSON-RPC batches), the refused
# subscriptions/listen stream, /llms.txt, /llms-full.txt and /.well-known/. Prints one line per step and exits non-zero on the first failure. Read-only: it only
# calls the two read-only tools.
set -euo pipefail

BASE="${1:-http://127.0.0.1:8791}"
BASE="${BASE%/}"
MCP="$BASE/mcp"
MODERN=2026-07-28
META='"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"mcp-smoke","version":"1.0.0"},"io.modelcontextprotocol/clientCapabilities":{}}'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
STEP=0

fail() {
  echo "FAIL  $STEP. $1" >&2
  [[ -s "$TMP/body" ]] && { echo "----- response body (first 600 bytes) -----" >&2; head -c 600 "$TMP/body" >&2; echo >&2; }
  exit 1
}
pass() { echo "ok    $STEP. $1"; }

# req METHOD URL [BODY] [extra curl args...] -> sets CODE; body in $TMP/body, headers in $TMP/headers
req() {
  local method="$1" url="$2" body="${3:-}"
  shift 3 || shift $#
  local args=(-sS -o "$TMP/body" -D "$TMP/headers" -w '%{http_code}' -X "$method" "$url" "$@")
  [[ -n "$body" ]] && args+=(-H 'content-type: application/json' --data-binary "$body")
  CODE="$(curl "${args[@]}")"
}
expect_code() { [[ "$CODE" == "$1" ]] || fail "$2: expected HTTP $1, got $CODE"; }
expect_body() { grep -q -- "$1" "$TMP/body" || fail "$2: body lacks $1"; }
expect_header() { grep -qi -- "$1" "$TMP/headers" || fail "$2: headers lack $1"; }
ACCEPT=(-H 'accept: application/json, text/event-stream')

echo "Seçki İstanbul MCP smoke test against $MCP"

# 1. legacy initialize, once per 2025 revision; record which version the server echoes
STEP=1
for v in 2025-11-25 2025-06-18 2025-03-26; do
  req POST "$MCP" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"$v\",\"capabilities\":{},\"clientInfo\":{\"name\":\"mcp-smoke\",\"version\":\"1.0.0\"}}}" "${ACCEPT[@]}"
  expect_code 200 "initialize $v"
  expect_body '"serverInfo"' "initialize $v"
  echoed="$(grep -o '"protocolVersion":"[^"]*"' "$TMP/body" | head -1 | cut -d'"' -f4)"
  [[ -n "$echoed" ]] || fail "initialize $v: no protocolVersion"
  pass "legacy initialize $v -> 200, server answers protocolVersion $echoed"
done

STEP=2
req POST "$MCP" '{"jsonrpc":"2.0","method":"notifications/initialized"}' "${ACCEPT[@]}" -H 'mcp-protocol-version: 2025-11-25'
expect_code 202 "notifications/initialized"
pass "notifications/initialized -> 202"

STEP=3
req POST "$MCP" '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' "${ACCEPT[@]}" -H 'mcp-protocol-version: 2025-11-25'
expect_code 200 "legacy tools/list"
expect_body '"search_events"' "legacy tools/list"
expect_body '"get_event"' "legacy tools/list"
expect_body '"readOnlyHint":true' "legacy tools/list"
pass "legacy tools/list -> 200, search_events + get_event, readOnlyHint"

STEP=4
req POST "$MCP" "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"server/discover\",\"params\":{$META}}" "${ACCEPT[@]}" \
  -H "mcp-protocol-version: $MODERN" -H 'mcp-method: server/discover'
expect_code 200 "server/discover"
expect_body '"supportedVersions"' "server/discover"
expect_body '"cacheScope":"public"' "server/discover"
pass "modern server/discover -> 200, cacheScope public"

STEP=5
req POST "$MCP" "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"search_events\",\"arguments\":{\"when\":\"this_weekend\",\"limit\":3},$META}}" "${ACCEPT[@]}" \
  -H "mcp-protocol-version: $MODERN" -H 'mcp-method: tools/call' -H 'mcp-name: search_events'
expect_code 200 "tools/call search_events"
expect_body '"structuredContent"' "tools/call search_events"
expect_body '"range"' "tools/call search_events"
grep -q '"isError":true' "$TMP/body" && fail "tools/call search_events returned isError"
pass "modern tools/call search_events {when:this_weekend, limit:3} -> 200, structuredContent"

STEP=6
req POST "$MCP" "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"search_events\",\"arguments\":{},$META}}" "${ACCEPT[@]}" \
  -H "mcp-protocol-version: $MODERN" -H 'mcp-method: tools/call'
expect_code 400 "tools/call without Mcp-Name"
expect_body '-32020' "tools/call without Mcp-Name"
pass "tools/call without Mcp-Name -> 400 -32020"

STEP=7
req POST "$MCP" '{"jsonrpc":"2.0","id":6,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2099-01-01","io.modelcontextprotocol/clientCapabilities":{}}}}' "${ACCEPT[@]}" \
  -H 'mcp-protocol-version: 2099-01-01' -H 'mcp-method: server/discover'
expect_code 400 "unsupported version"
expect_body '-32022' "unsupported version"
pass "protocol version 2099-01-01 -> 400 -32022"

STEP=8
for m in GET DELETE; do
  req "$m" "$MCP" ""
  expect_code 405 "$m /mcp"
  expect_header '^allow: POST, OPTIONS' "$m /mcp"
  expect_body 'llms.txt' "$m /mcp"
done
pass "GET and DELETE -> 405, Allow: POST, OPTIONS, helpful text"

STEP=9
req POST "$MCP" "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"server/discover\",\"params\":{$META}}" "${ACCEPT[@]}" \
  -H "mcp-protocol-version: $MODERN" -H 'mcp-method: server/discover' -H 'origin: https://evil.example'
expect_code 403 "foreign Origin"
pass "Origin https://evil.example -> 403"

STEP=10
req OPTIONS "$MCP" "" -H 'origin: http://localhost:6274' -H 'access-control-request-method: POST'
expect_code 204 "OPTIONS preflight"
expect_header '^access-control-allow-origin: http://localhost:6274' "OPTIONS preflight"
pass "OPTIONS from http://localhost:6274 -> 204 with CORS headers"

STEP=11
req GET "$BASE/llms.txt" ""
expect_code 200 "/llms.txt"
expect_header '^content-type: text/plain' "/llms.txt"
expect_body '/mcp' "/llms.txt"
pass "/llms.txt -> 200 text/plain"

STEP=12
req POST "$MCP" "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"subscriptions/listen\",\"params\":{$META}}" "${ACCEPT[@]}" \
  -H "mcp-protocol-version: $MODERN" -H 'mcp-method: subscriptions/listen' --max-time 5
expect_code 404 "subscriptions/listen"
expect_body '-32601' "subscriptions/listen"
pass "subscriptions/listen -> 404 -32601 at once (no open stream)"

STEP=13
head -c 70000 /dev/zero | tr '\0' 'x' > "$TMP/big"
printf '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"search_events","arguments":{"query":"%s"},%s}}' "$(cat "$TMP/big")" "$META" > "$TMP/bigbody"
CODE="$(curl -sS -o "$TMP/body" -D "$TMP/headers" -w '%{http_code}' -X POST "$MCP" "${ACCEPT[@]}" -H 'content-type: application/json' \
  -H "mcp-protocol-version: $MODERN" -H 'mcp-method: tools/call' -H 'mcp-name: search_events' --data-binary @"$TMP/bigbody")"
expect_code 413 "70 KB body"
pass "70 KB body -> 413"

STEP=14
req GET "$BASE/.well-known/oauth-protected-resource" ""
expect_code 404 "/.well-known/oauth-protected-resource"
expect_header '^content-type: application/json' "/.well-known/oauth-protected-resource"
pass "/.well-known/oauth-protected-resource -> 404 JSON (no SPA fallback)"

STEP=15
req POST "$MCP" "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",\"params\":{\"name\":\"get_event\",\"arguments\":{\"id\":\"e0123456789a\"},$META}}" "${ACCEPT[@]}" \
  -H "mcp-protocol-version: $MODERN" -H 'mcp-method: tools/call' -H 'mcp-name: get_event'
expect_code 200 "get_event unknown id"
expect_body '"isError":true' "get_event unknown id"
expect_body 'No upcoming event matches' "get_event unknown id"
pass "get_event unknown id -> isError with a recoverable message"

STEP=16
req POST "$MCP" '[{"jsonrpc":"2.0","id":11,"method":"tools/list"},{"jsonrpc":"2.0","id":12,"method":"ping"}]' "${ACCEPT[@]}" -H 'mcp-protocol-version: 2025-11-25'
expect_code 400 "JSON-RPC batch"
expect_body '-32600' "JSON-RPC batch"
expect_body 'Batching is not supported' "JSON-RPC batch"
pass "legacy JSON-RPC batch of 2 -> 400 -32600 (one message per POST)"

STEP=17
for m in GET DELETE; do
  req "$m" "$MCP" "" -H 'origin: https://evil.example'
  expect_code 403 "$m /mcp from a foreign Origin"
done
req POST "$MCP" '{"jsonrpc":"2.0","id":13,"method":"tools/list"}' "${ACCEPT[@]}" -H 'mcp-protocol-version: 2025-11-25' -H 'origin: http://secki.istanbul'
expect_code 403 "POST from http://secki.istanbul"
pass "foreign Origin on GET/DELETE and http://secki.istanbul on POST -> 403"

STEP=18
req GET "$BASE/llms-full.txt" ""
expect_code 301 "/llms-full.txt"
expect_header '^location: .*/llms.txt' "/llms-full.txt"
pass "/llms-full.txt -> 301 to /llms.txt"

STEP=19
req POST "$MCP" '{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"search_events","arguments":{"query":"caz","when":"next_30_days","limit":2}}}' "${ACCEPT[@]}" -H 'mcp-protocol-version: 2025-11-25'
expect_code 200 "legacy tools/call search_events caz"
expect_body '"structuredContent"' "legacy tools/call search_events caz"
expect_body '"flags"' "legacy tools/call search_events caz"
grep -q '"isError":true' "$TMP/body" && fail "search_events caz returned isError"
pass "legacy tools/call search_events {query:caz} -> 200, flags field"

echo "All $STEP steps passed."
