#!/usr/bin/env bash
#
# smoke.sh — end-to-end check of every endpoint.
#
# Creates its own users/tasks, then deletes them on exit (even if a test fails
# or you Ctrl-C). Nothing it makes should survive the run.
#
#   ./smoke.sh
#
# Needs the server running (npm run dev) and psql on PATH for cleanup.

BASE=${BASE:-http://localhost:3003}
DB_URL=${DATABASE_URL:-postgres://aragoler@localhost:5432/db}

PASS=0
FAIL=0
USER_IDS=""
TASK_IDS=""
BODY=""

# --- cleanup -----------------------------------------------------------------

csv() { printf '%s' "$1" | xargs | tr ' ' ','; }

cleanup() {
  echo
  echo "--- cleanup"
  local users tasks
  tasks=$(csv "$TASK_IDS")
  users=$(csv "$USER_IDS")

  # tasks first: the FK is ON DELETE RESTRICT, so a user with tasks won't drop.
  [ -n "$tasks" ] && psql "$DB_URL" -qc "DELETE FROM tasks WHERE id IN ($tasks)" >/dev/null 2>&1
  if [ -n "$users" ]; then
    psql "$DB_URL" -qc "DELETE FROM tasks WHERE user_id IN ($users)" >/dev/null 2>&1
    psql "$DB_URL" -qc "DELETE FROM users WHERE user_id IN ($users)" >/dev/null 2>&1
  fi
  echo "removed users [${users:-none}] tasks [${tasks:-none}]"

  echo
  echo "--- $PASS passed, $FAIL failed"

  # A partial run used to report "0 failed" and look like a pass. Count the
  # assertions in this file and complain if we didn't reach the end.
  local want
  want=$(grep -cE '^[[:space:]]*(call|call_raw|contains|count)[[:space:]]' "$0")
  if [ "$((PASS + FAIL))" -ne "$want" ]; then
    echo "--- INCOMPLETE: ran $((PASS + FAIL)) of $want assertions"
    exit 1
  fi

  [ "$FAIL" -eq 0 ] || exit 1
}
trap cleanup EXIT

# --- helpers -----------------------------------------------------------------

# call METHOD PATH EXPECTED_STATUS [JSON_BODY]
call() {
  local method=$1 path=$2 want=$3 data=${4-} out code
  if [ -n "$data" ]; then
    out=$(curl -s --max-time 10 -w $'\n%{http_code}' -X "$method" "$BASE$path" \
            -H 'Content-Type: application/json' -d "$data")
  else
    out=$(curl -s --max-time 10 -w $'\n%{http_code}' -X "$method" "$BASE$path")
  fi
  code=${out##*$'\n'}
  BODY=${out%$'\n'*}
  record "$code" "$want" "$method $path"
}

# call_raw METHOD PATH EXPECTED_STATUS CURL_ARGS...   (no Content-Type added)
call_raw() {
  local method=$1 path=$2 want=$3; shift 3
  local out code
  out=$(curl -s --max-time 10 -w $'\n%{http_code}' -X "$method" "$BASE$path" "$@")
  code=${out##*$'\n'}
  BODY=${out%$'\n'*}
  record "$code" "$want" "$method $path (raw)"
}

record() {
  local got=$1 want=$2 label=$3
  if [ "$got" = "$want" ]; then
    PASS=$((PASS + 1))
    printf '  ok    %-3s  %s\n' "$got" "$label"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL  got %s want %s  %s\n        %s\n' "$got" "$want" "$label" "$BODY"
  fi
}

# contains SUBSTRING DESCRIPTION — asserts against the last response body
contains() {
  if printf '%s' "$BODY" | grep -q -- "$1"; then
    PASS=$((PASS + 1)); printf '  ok         body contains %s\n' "$1"
  else
    FAIL=$((FAIL + 1)); printf '  FAIL       body missing %s\n        %s\n' "$1" "$BODY"
  fi
}

# count SUBSTRING N — asserts SUBSTRING appears exactly N times in the last body.
# '"id":' matches the id field only; "user_id": has an underscore before id.
count() {
  local got
  got=$(printf '%s' "$BODY" | grep -o -- "$1" | wc -l | tr -d ' ')
  if [ "$got" = "$2" ]; then
    PASS=$((PASS + 1)); printf '  ok         %s x%s\n' "$1" "$2"
  else
    FAIL=$((FAIL + 1)); printf '  FAIL       %s want x%s got x%s\n        %s\n' "$1" "$2" "$got" "$BODY"
  fi
}

# field NAME — pulls "name":"123" out of the last response
field() { printf '%s' "$BODY" | sed -n 's/.*"'"$1"'":"\([0-9]*\)".*/\1/p'; }

# --- preflight ---------------------------------------------------------------

if ! curl -s -o /dev/null --max-time 3 "$BASE/tasks/1"; then
  echo "server not answering on $BASE — is 'npm run dev' running?"
  exit 1
fi
if ! psql "$DB_URL" -qc 'SELECT 1' >/dev/null 2>&1; then
  echo "cannot reach postgres at $DB_URL — cleanup would fail, aborting"
  exit 1
fi

# --- happy path --------------------------------------------------------------

echo "--- happy path"

call POST /users 201 '{"username":"smoke-adi"}'
U1=$(field user_id); USER_IDS="$USER_IDS $U1"

call POST /users 201 '{"username":"smoke-dana"}'
U2=$(field user_id); USER_IDS="$USER_IDS $U2"

call POST "/users/$U1/tasks" 201 '{"body":"buy milk"}'
T1=$(field id); TASK_IDS="$TASK_IDS $T1"
contains '"done":false'

call GET "/users/$U1/tasks" 200
contains 'buy milk'

call GET "/tasks/$T1" 200
contains 'buy milk'

call PATCH "/tasks/$T1" 200
contains '"done":true'

echo "--- ownership"
call DELETE "/users/$U2/tasks/$T1" 404      # dana may not delete adi's task
call GET    "/tasks/$T1" 200                # ...and it survived
call DELETE "/users/$U1/tasks/$T1" 200      # owner may
call GET    "/tasks/$T1" 404                # ...and it's gone

call GET "/users/$U1/tasks" 200
contains '\[\]'

# --- pagination --------------------------------------------------------------
#
# Three tasks, created in order, so created_at + id ordering is deterministic.
# Every assertion below uses a single-row page, so none of them depend on the
# join preserving the derived table's ordering.

echo "--- pagination"

call POST "/users/$U1/tasks" 201 '{"body":"page-1"}'
P1=$(field id); TASK_IDS="$TASK_IDS $P1"
call POST "/users/$U1/tasks" 201 '{"body":"page-2"}'
P2=$(field id); TASK_IDS="$TASK_IDS $P2"
call POST "/users/$U1/tasks" 201 '{"body":"page-3"}'
P3=$(field id); TASK_IDS="$TASK_IDS $P3"

# no params: DEFAULT_LIMIT is 10, so all three come back
call GET "/users/$U1/tasks" 200
count '"id":' 3

# limit is a row count, and ordering is oldest first
call GET "/users/$U1/tasks?limit=1" 200
count '"id":' 1
contains 'page-1'

# offset skips ROWS, not pages
call GET "/users/$U1/tasks?limit=1&offset=1" 200
count '"id":' 1
contains 'page-2'

# offset past the end: the user still exists, so 200 [] and never 404
call GET "/users/$U1/tasks?offset=99" 200
contains '\[\]'

# limit=0 is a valid empty page, not a bad request
call GET "/users/$U1/tasks?limit=0" 200
contains '\[\]'

# over MAX_LIMIT clamps silently to 50 rather than erroring
call GET "/users/$U1/tasks?limit=500" 200
count '"id":' 3

# invalid values must 400 — never fall back to the default, and never reach
# Postgres as NULL, which would mean LIMIT NULL = no limit at all.
call GET "/users/$U1/tasks?limit=abc"    400
call GET "/users/$U1/tasks?limit=-1"     400
call GET "/users/$U1/tasks?limit=1.5"    400
call GET "/users/$U1/tasks?limit=1e3"    400
call GET "/users/$U1/tasks?offset=abc"   400
call GET "/users/$U1/tasks?offset=-1"    400

# a repeated param arrives as an array, not a string, so z.string() rejects it
call GET "/users/$U1/tasks?limit=1&limit=2" 400

# unknown params are stripped by z.object, not rejected
call GET "/users/$U1/tasks?foo=bar" 200
count '"id":' 3

# --- 400: malformed requests -------------------------------------------------

echo "--- 400 bad request"

call POST /users 400 '{}'
call POST /users 400 '{"username":"   "}'
call POST /users 400 '{"username":123}'
call POST "/users/$U1/tasks" 400 '{}'
call POST "/users/$U1/tasks" 400 '{"body":"   "}'
call POST "/users/$U1/tasks" 400 '{"body":{"x":1}}'
call GET  /tasks/abc 400
call GET  /tasks/0   400
call GET  /tasks/-1  400
call GET  /tasks/1e3 400
call GET  /users/abc/tasks 400

# no Content-Type: express.json() skips, req.body is undefined in Express 5
call_raw POST "/users/$U1/tasks" 400 -d '{"body":"x"}'

# malformed JSON: thrown inside express.json() before any handler runs, so the
# error middleware is the only thing that can answer it.
call POST /users 400 '{"username":'
contains 'bad_req'

# --- 413 / 415: express.json() rejects before routing ------------------------

echo "--- 413 payload too large"

# limit is 5kb; 6000 x's plus quotes is comfortably over.
BIG=$(printf 'x%.0s' $(seq 1 6000))
call POST "/users/$U1/tasks" 413 "{\"body\":\"$BIG\"}"
contains 'body_too_large'

echo "--- 415 unsupported charset"

# a charset body-parser will not decode (anything not starting "utf-").
# 400 / 413 / 415 is the complete set of statuses express.json() can throw, so
# the middleware's three branches cover it with nothing left leaking to 500.
call_raw POST /users 415 \
  -H 'Content-Type: application/json; charset=iso-8859-1' \
  -d '{"username":"smoke-415"}'

# --- 404: well-formed, not there ---------------------------------------------

echo "--- 404 not found"

call GET    /tasks/999999999 404
call PATCH  /tasks/999999999 404
call GET    /users/999999999/tasks 404
call POST   /users/999999999/tasks 404 '{"body":"orphan"}'
call DELETE "/users/999999999/tasks/999999999" 404
