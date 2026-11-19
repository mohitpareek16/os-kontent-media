#!/bin/bash
# Runs on the server — invoked by GitHub Actions over SSH (see
# .github/workflows/deploy.yml) or by hand. Pulls the latest master,
# rebuilds changed containers, runs migrations.
set -euo pipefail

cd "$(dirname "$0")/.."

# Load Telegram Bot configuration
TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHAT_ID=""
MESSAGE_ID=""

if [ -f .env ]; then
  TELEGRAM_BOT_TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' .env | cut -d '=' -f2- | tr -d '\r"')
  TELEGRAM_CHAT_ID=$(grep '^TELEGRAM_CHAT_ID=' .env | cut -d '=' -f2- | tr -d '\r"')
fi

# Which revision the progress messages describe. Until the fetch lands, the
# only thing we can honestly name is what is already checked out; afterwards
# it is the commit being deployed. Reporting HEAD throughout had every
# message name the *previous* deploy until the reset ran.
DESCRIBE_REF="HEAD"

# Named so a failure says which step died — "encountered an error" sent the
# reader to the Actions log to find out anything at all.
CURRENT_STEP="startup"

# parse_mode=HTML rather than Markdown: the commit subject goes into this
# message verbatim, and legacy Markdown needs its *, _, ` and [ balanced.
# A subject like "fix: don't shadow *args" is a 400 from Telegram — and with
# the response discarded, a deploy that reports nothing at all. HTML only
# cares about three characters, and they are escaped here.
html_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

notify_telegram() {
  local header="$1"
  local step_status="$2"

  if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
    return 0
  fi

  local commit_hash commit_msg text method response
  commit_hash=$(git rev-parse --short "$DESCRIBE_REF" 2>/dev/null || echo "latest")
  commit_msg=$(git log -1 --pretty=%s "$DESCRIBE_REF" 2>/dev/null || echo "")
  commit_msg=$(html_escape "$commit_msg")

  # Real newlines, not %0A — every field below goes through --data-urlencode,
  # which does the encoding itself. The old code hand-wrote %0A and passed the
  # rest raw through -d, so a subject containing & or % or + silently
  # truncated the message at that character.
  text="${header}

📌 <b>Commit:</b> <code>${commit_hash}</code>
📝 <b>Message:</b> ${commit_msg}

${step_status}"

  if [ -z "$MESSAGE_ID" ]; then
    method="sendMessage"
  else
    method="editMessageText"
  fi

  # || true keeps a Telegram outage from failing an otherwise good deploy, but
  # the response is inspected rather than dropped: a notification that never
  # arrives should leave a trace in the Actions log, not silence.
  response=$(curl -sS -m 15 -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    ${MESSAGE_ID:+--data-urlencode "message_id=${MESSAGE_ID}"} \
    --data-urlencode "parse_mode=HTML" \
    --data-urlencode "text=${text}" 2>&1 || true)

  case "$response" in
    *'"ok":true'*)
      if [ -z "$MESSAGE_ID" ]; then
        MESSAGE_ID=$(printf '%s' "$response" | grep -o '"message_id":[0-9]*' | head -n 1 | cut -d':' -f2 || true)
      fi
      ;;
    *)
      # Not fatal, but say so loudly — this is the exact failure that makes a
      # successful deploy look like it never happened.
      echo "WARNING: Telegram ${method} failed: ${response}" >&2
      ;;
  esac
}

on_error() {
  notify_telegram "❌ <b>Kontent Media Deployment Failed!</b>" \
    "⚠️ <b>Failed during: ${CURRENT_STEP}</b>"
}

trap on_error ERR

# The prod overlay adds HTTPS and the TLS nginx config; without certs on the
# host this is a plain-HTTP box. Held in one place so the `exec` below talks
# to the same compose project the build just wrote.
COMPOSE_FILES=(-f docker-compose.yml)
if [ -d "/etc/letsencrypt/live" ]; then
  COMPOSE_FILES+=(-f docker-compose.prod.yml)
fi

# Step 1: Start & Pull latest code
CURRENT_STEP="[1/4] fetching latest code"
echo "==> Fetching latest master"
git fetch origin master
# Only now can the messages name the commit actually being deployed.
DESCRIBE_REF="origin/master"
notify_telegram "🔄 <b>Kontent Media Deployment In Progress...</b>" \
  "⏳ <b>[1/4]</b> Fetching latest code from <code>master</code>..."
git reset --hard origin/master

# Step 2: Building containers
CURRENT_STEP="[2/4] building containers"
echo "==> Building and restarting containers"
notify_telegram "🔄 <b>Kontent Media Deployment In Progress...</b>" \
  "⏳ <b>[2/4]</b> Building &amp; restarting Docker containers..."
docker compose "${COMPOSE_FILES[@]}" up -d --build

# Step 3: Database migrations
CURRENT_STEP="[3/4] database migrations"
echo "==> Running database migrations"
notify_telegram "🔄 <b>Kontent Media Deployment In Progress...</b>" \
  "⏳ <b>[3/4]</b> Running database migrations..."
docker compose "${COMPOSE_FILES[@]}" exec -T app alembic upgrade head

# Step 4: Prune images
CURRENT_STEP="[4/4] pruning images"
echo "==> Pruning unused images"
notify_telegram "🔄 <b>Kontent Media Deployment In Progress...</b>" \
  "⏳ <b>[4/4]</b> Pruning unused Docker images..."
docker image prune -f

# Step 5: Complete!
CURRENT_STEP="complete"
DESCRIBE_REF="HEAD"
COMMIT_HASH=$(git rev-parse --short HEAD)
echo "==> Deploy complete: ${COMMIT_HASH}"
notify_telegram "🚀 <b>Kontent Media Deployed Successfully!</b>" \
  "✅ All services are UP and database migrations applied."
