#!/bin/bash
# Start the three local services from cron's minimal environment.
set -eu
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${FLASHFORGE_NODE:-$HOME/.nvm/versions/node/v22.21.1/bin/node}"
export PATH="$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$PROJECT_DIR"
umask 077
mkdir -p data/startup
exec >> data/startup/boot.log 2>&1
if [ ! -x "$NODE_BIN" ]; then
  echo "Node executable unavailable: $NODE_BIN"
  exit 1
fi

start_task() {
  local name="$1"
  shift
  local pidfile="data/startup/$name.pid"
  local expected="$NODE_BIN $*"
  if [ -f "$pidfile" ]; then
    local pid
    pid="$(cat "$pidfile")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && [ "$(ps -p "$pid" -o command= 2>/dev/null || true)" = "$expected" ]; then
      echo "$name already running ($pid)"
      return
    fi
  fi
  nohup "$NODE_BIN" "$@" >> "data/startup/$name.log" 2>&1 < /dev/null &
  echo "$!" > "$pidfile"
  echo "Started $name ($!)"
}

date
start_task dashboard "$PROJECT_DIR/server.mjs"
start_task static-server "$PROJECT_DIR/scripts/serve-static-site.mjs"
# Allow the dashboard to begin serving before producing the initial snapshot.
for attempt in {1..30}; do
  if curl --silent --fail --max-time 1 http://127.0.0.1:3000/api/printers > /dev/null; then
    break
  fi
  sleep 1
done
start_task static-updater "$PROJECT_DIR/scripts/render-static-site.mjs" --watch
# Keep the boot job attached to its children for the lifetime of the services.
wait
