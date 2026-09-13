#!/bin/zsh
cd "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print 'Node.js 22 or newer is required.'
  read '?Press Enter to close.'
  exit 1
fi
if curl --silent --fail --max-time 2 http://127.0.0.1:3000/api/printers >/dev/null; then
  open http://localhost:3000
  exit 0
fi
node server.mjs &
dashboard_pid=$!
trap 'kill "$dashboard_pid" 2>/dev/null' EXIT INT TERM
for attempt in {1..30}; do
  if curl --silent --fail --max-time 1 http://127.0.0.1:3000/api/printers >/dev/null; then
    open http://localhost:3000
    break
  fi
  sleep 0.2
done
wait "$dashboard_pid"
