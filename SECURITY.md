# Security

This is a local, single-user printer monitor. It has no login and should not be
published as a public website or placed behind a public reverse proxy.

## Access and private configuration

By default the server binds to `127.0.0.1`. Open `http://localhost:3000` on the
dashboard Mac to change settings, history, maintenance, and calibration records.
All modifying API requests require both a loopback peer and the localhost host
name. Host/origin checks reject other websites and forwarded/proxy headers.
These checks do not protect against malicious software already running on the Mac.

Optional settings belong in ignored, private `data/security.json`:

```json
{
  "allowLanReadOnly": false,
  "allowInsecureMqtt": false
}
```

Only these boolean keys are accepted; malformed configuration stops startup.
`FLASHFORGE_LAN=on|off` and `FLASHFORGE_ALLOW_INSECURE_MQTT=on|off` override the
corresponding file settings. Restart the server after changing them.

LAN sharing is explicitly opt-in and read-only. Anyone on the allowed network
can view camera images, status, filenames, history, and maintenance information.
Printer settings and baseline serial numbers require local access. LAN viewing
uses HTTP, so it is appropriate only on a trusted home network. Do not enable
router port forwarding, tunnels, or public proxies for this service.

Cloud MQTT uses certificate-verified TLS on port 8883 by default, with no
automatic downgrade. `allowInsecureMqtt: true` explicitly enables plain MQTT
on port 1883 for brokers that lack working TLS. Broker credentials and status
then travel unencrypted; the dashboard displays a warning while connected.
This option does not disable certificate verification for HTTPS account reads.
The monitor subscribes to status and does not publish printer commands.

Local printer and camera protocols may also be unencrypted. Keep printers and
cameras on a trusted network, use unique camera credentials, and keep their
firmware updated. Application hardening does not secure the devices themselves.

## Before committing or publishing

Install the pinned, checksum-verified scanner and enable this checkout's hook:

```sh
python3 scripts/install-gitleaks.py
npm run security:hooks
npm run security:check
npm audit --omit=dev
```

The pre-commit hook scans staged content, including content changed again after
staging, and fails if the scanner is missing. The full check also scans current
non-ignored files and reachable branch/tag history. Both reject private data
paths and redact credential findings. Git hooks can be bypassed, so the GitHub
security workflow repeats the checks and audits JavaScript and Python dependencies.
CI begins running after the workflow is pushed to GitHub.

Keep real printer addresses, camera accounts, account tokens, serial numbers,
images, logs, history, and audit reports in ignored `data/`. Use sanitized
examples for documentation. Never force-add real data or private key files.
The scanner cannot recognize every secret or personal detail: review the diff
and history before making a repository public. Author email addresses and old
network details can remain in historical commits even after current files change.

Use the pinned Python audit tools in a separate environment when auditing:

```sh
python3 -m venv /tmp/printer-audit-venv
/tmp/printer-audit-venv/bin/python -m pip install -r requirements-security.txt
/tmp/printer-audit-venv/bin/python -m pip_audit -r requirements-security.txt
/tmp/printer-audit-venv/bin/python -m pip_audit -r requirements-obico.txt
```

If a real credential has ever been committed or published, revoke or rotate it
first. Removing it in a later commit is insufficient; review Git history and
GitHub artifacts separately before publication. Do not put secrets or private
network details in a public issue or pull request.
