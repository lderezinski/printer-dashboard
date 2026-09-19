# Flashforge Health

I want one place to see what the printers are doing, which one will finish next, and whether a print needs attention. Preferably before a chess piece becomes a plate of spaghetti.

This dashboard runs locally on a Mac and monitors the AD5M, Adventurer 5M Pro, Creator 5, and Creator 5 Pro. It brings together live Flashforge cloud status, camera checks, remaining-time estimates, print history, and separate maintenance reminders for each printer. The Brother laser printers get a spot here too.

You'll need Node.js 22 or newer and Flash Studio installed and signed in on the Mac running the dashboard. For a new checkout, run `npm ci` first. Cloud monitoring uses that Flash Studio session; the connection options are explained below.

Real settings belong in `data/`, which stays out of Git. The examples in `data.example/` have the private details removed. Please keep it that way.

## License

The original dashboard code is licensed under the **GNU Affero General Public
License, version 3 only** (`AGPL-3.0-only`). See [LICENSE](LICENSE).
Copyright (C) 2026 Flashforge Health contributors.

You can use, modify, and share it, including commercially, under those terms.
Keep the notices and provide the corresponding source when the license requires
it, including an offer to users interacting with a modified version over a network.
There is no warranty. The printers will still have their own opinions.

Other people's code keeps its own license. The full review and dependency list
are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), with collected upstream
notices in [licenses/third-party.txt](licenses/third-party.txt).
**The Obico model weights and Flashforge's non-free networking library are not
cleared for redistribution by this review.** They aren't included in this
repository, and the dashboard's AGPL license doesn't grant rights to them.
Read the review before packaging a ready-to-run download or offering a hosted service.

## Get it running

```sh
npm start
```

Open http://localhost:3000 on this Mac. You can also double-click **Start Dashboard.command** in Finder. Leave its Terminal window open while monitoring; press Control-C to stop. The Mac needs to stay awake, even if the print has decided to take all night.

By default, you can open the dashboard only on this Mac. To view it from a phone, tablet, or another computer on your home network, start with `FLASHFORGE_LAN=on npm start`, or set `allowLanReadOnly` to `true` in the ignored `data/security.json` (see `data.example/security.json`). Use the LAN address printed in Terminal. Allow Node incoming connections if macOS asks. If the Mac's address changes, use the new address.

LAN access is **read-only**. Make settings, history, maintenance, and calibration changes at `http://localhost:3000` on this Mac. Cloud reconnection and local tools also require that address. Opening an IP address gives you the read-only view, even on the same Mac.

### Isolated static Home page

The public-view renderer writes **`static-site/index.html`**, a Home
page with embedded styling and separate WebP camera snapshots in `static-site/images/`. A small clock-only script updates timestamp colors; it makes no network requests.
There are no API calls, links, tabs, forms, settings, or cloud reconnect controls. The output
directory contains only generated public files; renderer code stays in `scripts/`.

Public photos use only the A5MP, C5, and C5P integrated cameras, plus the AD5M's
Tapo C120. Additional C120 views on the other printers are not exported, even if
an integrated camera is unavailable. Photos are reduced to a maximum width of
640 pixels (never enlarged), preserve aspect ratio and existing detection markings,
and use WebP quality 65. Encoding uses the existing OpenCV environment in
`data/obico-venv`; no image processing is needed on the cloud server.

Image filenames include their content hash. Identical photos keep the same name
and modification time, so incremental upload tools and browsers can reuse them.
Photos are written before HTML is replaced atomically. After every export, cleanup
keeps the two latest images per printer (at most eight total), always preserving
the image referenced by the current page. Unrelated files are left alone. When syncing to a server,
transfer images before publishing the new HTML and remove obsolete images only
afterward. Transfer the whole `static-site/` tree, not just `index.html`.

```sh
npm run static:render   # Generate one snapshot
npm run static:watch    # Generate immediately, then every 60 seconds
npm run static:serve    # Serve the snapshot at http://localhost:8080
```

Run the watcher and static server in separate terminals while the dashboard is
running. These are independent processes; restarting the dashboard does not
require restarting them. These commands do not install a login/startup service.
For a dashboard using a different local port, set
`STATIC_DASHBOARD_URL=http://127.0.0.1:3001` on the renderer. `STATIC_PORT` changes
the static server's port. The source must remain an HTTP loopback address.

The page refreshes every 60 seconds and prominently shows its capture time.
Each printer and camera has a separate report/capture timestamp. These timestamps
and the page capture time are green through 70 seconds old, yellow over 70 seconds
through 5 minutes, and red after 5 minutes. Colors update every second using the
viewer’s clock, including when viewing an old export. Missing or future timestamps
are neutral; estimated future finish times are not age-colored. The content security
policy permits only the exact clock script by its hash and prohibits network calls. Printer readings
older than 15 seconds and camera checks older than 60 seconds are unavailable at
export time. The page describes a snapshot, not live status. If the dashboard is
unreachable, the watcher replaces the page with an unavailable snapshot. If the
watcher or Mac stops, the timestamp stops advancing; the old file may still be
served and must not be treated as current.

Exported fields are limited to fixed printer names, reported states, progress,
remaining/finish estimates, current print filenames (without directory paths),
maintenance due counts in the overview, enabled camera snapshots and
detection summaries using all available checks from the current sequence (up to
12 retained checks). Finishing-next tiles show wrapping print filenames in place
of maintenance tasks. Laserjet queues and their document filenames are omitted. Directory paths,
custom headings, IP addresses, serial numbers, access codes, credentials, history,
maintenance descriptions, and raw error messages are excluded. Camera images
show the camera's actual view. Generated snapshots are ignored by Git.

The static server binds only to `127.0.0.1`, serves only `/`, `/index.html`, and
the generated image filenames under `/images/`. It allows only GET/HEAD, disables
HTML caching, caches immutable images, and has no proxy or dashboard API routes.
A future public tunnel may target **this static server on port 8080**. Alternatively,
a static host can serve only the contents of `static-site/`; configure HTML
responses with `Cache-Control: no-store` to keep minute-by-minute refreshes current.
Do not point public hosting at the repository, `dist/`, or the private dashboard
on port 3000. No tunnel or web server installation is performed by these commands.

#### Automatic upload over SSH

To upload after each export, put the destination in ignored, private
`data/static-site-sync.json` and restart `npm run static:watch`:

```json
{
  "enabled": true,
  "destination": "root@your-server:/var/www/status/"
}
```

The watcher exports and syncs every 60 seconds while this Mac is awake and the
watcher is running. `npm run static:render` also uploads when syncing is enabled.
The remote directory must exist, and key-based SSH access and its trusted host
key must already be configured. No keys or credentials are copied into the site.
Set `enabled` to `false` and restart the watcher to stop uploads.

Transfers use `rsync -avzh -e ssh` with noninteractive SSH, strict host-key checks,
and timeouts. Each upload stages only the generated HTML and allowed WebP files,
preserving file timestamps so unchanged images do not transfer again. Images
upload first, then HTML using rsync's temporary-file-and-rename behavior, then
obsolete generated images are removed from the remote `images/` directory.
Other remote files are excluded from cleanup. The remote copy therefore retains
the same two images per printer as the local export after a successful sync.

Rendering and syncing never overlap within a watcher. If an upload takes longer
than a minute, the next tick is skipped. Failures retry at the next export; HTML
is not published if the image upload fails. An unavailable dashboard snapshot is
still synced so the server does not keep displaying old status as current.
This does not install a login/startup service. For the background process used
in this workspace, transfer results are in `data/static-renderer.log`.

There is no dashboard login. Anyone who can reach the LAN listener can see status, camera images, and print history. Do not forward its port or expose it through a public proxy. See [SECURITY.md](SECURITY.md) for the configuration details and checks to run before publishing the repository.

### Dashboard heading

Want your own name at the top? Set the small heading above **3D printer health**
in ignored `data/dashboard.json`:

```json
{
  "heading": "My Workshop / Printers"
}
```

Use one line of plain text, up to 100 characters. Restart the dashboard
and refresh the page after editing. Without this setting, you'll see
**Printer dashboard**. Your personal heading stays out of Git;
`data.example/dashboard.json` has a generic example.

## Connect the printers

Start with **Settings** on each printer card. The four 3D printers have example private-network addresses prefilled; replace those with your printers' actual LAN addresses.

Keep Flashforge cloud enabled. The dashboard uses Flash Studio's saved sign-in session and networking library to get your account's printer list and MQTT connection information. Leave Flash Studio installed in `/Applications/Flash Studio.app`. You can close it after signing in. If the session expires, sign in there again, then click **Reconnect cloud** in the dashboard.

The dashboard matches cloud reports using the account device ID and model/PID, plus the configured serial number when present. Printers with a configured serial remain matched after DHCP changes their IP. Without a configured serial, matching still requires the saved IP address. If an address changes, update **Settings** on that printer's card to restore local fallback access. Settings stay in `data/printers.json` with owner-only permissions. A private helper reads account tokens and sends them to the verified Flashforge service. Broker credentials pass to Node through a private pipe. Tokens and raw cloud reports aren't saved in dashboard records or sent to the browser.

The installed Flash Studio 1.7.18 networking library (3.4.3) is Intel-only; the helper uses the Mac’s system Python under Rosetta. The library handles the two authenticated HTTPS reads. MQTT.js handles the status stream directly because the native status callback did not deliver the current live messages during testing. The dashboard now requires certificate-verified TLS on port 8883 by default and never automatically falls back to plaintext. The provider advertises `mqtt.voxelshare.com` on plain MQTT port 1883; a trusted TLS connection was unavailable during verification. To retain cloud monitoring with this broker, explicitly set `allowInsecureMqtt` to `true` in ignored `data/security.json`, or start with `FLASHFORGE_ALLOW_INSECURE_MQTT=on npm start`. This sends broker credentials and status without transport encryption and displays a persistent warning. Leave this opt-in off when verified TLS is available.

Only fresh `device_action` / `device_status` messages appear in the dashboard. Old retained messages and cached REST details are left out, and measurements expire after 15 seconds without a fresh report. The connection retries after failures and renews broker credentials every 30 minutes from Flash Studio's saved session, without rotating its refresh token or sending a login-sync command. The monitor also reconnects automatically after 60 seconds of silence from a previously printing device or from the whole subscribed feed, at most once every three minutes. The monitor subscribes to status; it never publishes printer commands.

Both Adventurers have a local fallback, started proactively when a cloud report is more than five seconds old. Each printer polls independently, and reports arriving during a failed local read are rechecked before marking the printer disconnected. Brief losses show **Reconnecting** for up to 70 seconds since the last successful report; live measurements still expire after 15 seconds. Camera capture retries immediately when fresh printing status returns. The camera detection sequence resets across monitoring gaps.

Both Adventurers support local status reads. The AD5M’s authenticated-identity HTTP status read also supplies remaining time with cloud enabled on its current firmware. If unavailable, it falls back to TCP status. The A5MP falls back to TCP, which does not supply remaining time. TCP sends only `M119`, `M27`, `M105`, then `M119` again to detect job transitions. C5/C5P do not have this fallback; they show unavailable when cloud reports stop. Their local HTTP service still requires LAN Only, but the dashboard does not change that setting.

The Node service listens on IPv4 port 3000, using loopback by default and private-network access only when explicitly enabled. Host and origin checks restrict requests to the dashboard's own addresses; forwarded/proxy headers are rejected. All write routes require loopback access through the `localhost` hostname. Credentials and private data files are never served as static assets, and read-only clients cannot retrieve printer settings or baseline serial numbers. Set `FLASHFORGE_CLOUD=off` when running isolated local tests that must not use the account session.

## Camera checks: is that supposed to look like spaghetti?

The Home tab has camera checks for **AD5M**, **A5MP**, **C5**, and **C5P**.
The A5MP, C5, and C5P use their internal Flashforge MJPEG cameras, with an
extra Tapo C120 view wherever one is configured. This AD5M setup has no internal
camera, so it uses only its C120; the dashboard doesn't start an internal-camera
tile or capture worker for it.

Each view shows its image and recent checks. The A5MP also has an experimental
gap check, disabled by default and described below. When enabled, it keeps its
own annotations, result, capture time, and history. An alert from either check
contributes to **Need attention**.

All spaghetti checks use Obico's official downloadable ONNX model. The inference
code is AGPL-licensed; explicit licensing terms for the separate weights remain
unverified (see [the license review](THIRD_PARTY_NOTICES.md#model-weights)). Each
analyzes a new frame about every 20–25 seconds while its own fresh printer
status says `printing`. Camera addresses follow the printer hosts in
`data/printers.json`, using `http://PRINTER_IP:8080/?action=stream`. Internal cameras require no separate camera account. A missing or
disabled internal camera reports **Unavailable** and retries automatically.

Each configured C120 gives you another view in the same printer tile, with its
own detector, image, timestamp, and history. Its private account is read from
an ignored `data/camera-PRINTER_ID.json` file
(`host`, `username`, `password`), using RTSP `stream1`. Without that file, the
extra view stays hidden. If a configured C120 becomes unavailable, its status
shows the failure while internal monitoring continues; an unavailable internal
camera likewise does not stop the C120. Either source can raise Need attention.
Camera credentials are never sent to the browser.

Obico's detector runs locally here. You don't need the Obico phone app or cloud
service for these checks. Images stay on this Mac and its dashboard clients.
The dashboard keeps each camera's latest image and 12 recent results in memory;
restarting clears them. Each printer's Python worker starts with its first
active print and stops with the dashboard. Keep the Mac awake and the dashboard
running if you want the checks to continue.

You'll see **No spaghetti detected**, **Inspect image**, **Check print
now**, **Waiting for printing**, or **Unavailable**. Check the timestamp:
these are periodically refreshed still images, not live video.
A camera result expires after 60 seconds and printer status after
15 seconds. Results from a previous print are discarded. Pauses, job changes,
errors, and long gaps reset the repeated-detection counter.

Alerts appear on Home and in **Need attention**. You'll still need to check
the printer yourself: the dashboard sends no printer commands, automatic pauses,
phone notifications, or emails. An Obico box score
of at least 0.3 requests inspection; three consecutive frames with a score of
at least 0.6 produce a repeated-detection warning. These initial dashboard
rules require tuning with real prints; they are not Obico Cloud's temporal
algorithm or a probability that a print is good. Ornate shapes, supports,
glare and printhead occlusion can cause false alarms or missed failures.
**No spaghetti detected does not confirm extrusion.** During setup, an A5MP
image reported as showing no extrusion scored only 0.117, below the inspection
threshold. A printer can look very busy while successfully printing absolutely
nothing. If you suspect a clog, check it in person.

The dependencies and 202 MB model live in ignored `data/` directories.
To set them up in a fresh checkout, use a compatible Python 3.11+ environment:

```sh
python3 -m venv data/obico-venv
data/obico-venv/bin/python -m pip install --upgrade pip setuptools
data/obico-venv/bin/python -m pip install -r requirements-obico.txt
python3 setup-obico-model.py
```

Use the printer's existing camera and network settings. Internal-camera monitoring is not enabled for the AD5M because no
camera is installed. The dashboard does not install cameras or change
printer settings. Set `FLASHFORGE_CAMERA=off` to disable all camera monitoring,
including for isolated server tests. See `vendor/obico/README.md` for the
upstream commit, AGPL license, model provenance, and integration details. Model
SHA-256 is verified before inference. Each worker uses two CPU inference threads.

The camera checks detect possible visible spaghetti; they do not confirm
extrusion or apply the A5MP chess-specific gap rule to other printers. Camera
failures and stale status remain unavailable, and no printer commands are sent.

### A5MP experimental head-to-print gap check

The gap check is **disabled by default** for now. The code and saved references
are still here, and spaghetti detection continues with its own camera captures.
This is still an experiment, so don't count on it to catch a failed print. To
turn it on, start with `FLASHFORGE_GAP=on npm start`. Set
`FLASHFORGE_DARK_CHESS_JOB` to the exact calibration filename when using the
optional dark-chess rule.

Home starts with **Finishing next**, followed by the camera tiles. When the gap
check is enabled, the **A5MP camera checks** tile uses the built-in close-up camera
for both gaps and spaghetti. One capture worker feeds both checks so they don't
compete for the camera connection. Gap sampling runs about every 3–4 seconds
while fresh printer status says printing; it doesn't wait for Obico's slower
inference. This replaces the earlier expected-height/millimeter calibration workflow.

For an A5MP dark-chess calibration job, the temporary
`light-head-dark-chess-v1` rule uses the light-gray print head and the silk-black
chess piece. Their close spacing in the user-confirmed healthy reference is
normal. A gap of at least 3 pixels **beyond that healthy spacing**, present in
all comparable samples across a completed layer, raises **Inspect print** for
possible air printing. A constant open gap counts; widening and recognizable
printer background are not required. The tolerance excludes small tracking jitter
and the normal distance between the housing and the extrusion point.

This profile checks a bright patch on the head and a dark patch on the part
(allowing for silk highlights), then tracks the distance between them at the
reference pose. It doesn't recognize chess pieces or tell whether filament is
coming out. Hidden, changed, or ambiguous features stay unknown. The profile
applies only to the configured dark-chess calibration filename and calibrated
print run; other jobs use the generic gap rule. The saved healthy reference
belongs to that run. For a new run, select a new healthy reference: mark the
lower gray head edge, the dark piece immediately below it, and a stationary
feature away from the head. Accuracy on live failures is still unvalidated.

Open `http://localhost:3000` on this Mac and choose **Mark nozzle & part**.
For the dark chess profile, use the healthy head/part marks described above.
For other jobs, mark the actual nozzle tip, the part's upper edge immediately
below it, and a stationary frame feature. No ruler, known object
height, or layer-height settings are required. The reference applies only to
this print. The server validates that the selected features are distinguishable;
verify the overlaid markers before relying on the readings.

The tracker measures vertical image separation in pixels at a repeatable
nozzle position. It uses separate patches above the nozzle tip and below the
part edge so both patches do not simply follow the toolhead at contact.
Other nozzle positions, hidden/ambiguous features, glare and detected camera
movement produce **Cannot measure**. This is experimental feature tracking,
not semantic nozzle/part segmentation. Perspective changes or tracking an old
edge can still create false alarms or missed failures.

A completed-layer comparison requires at least eight valid views, at least two
in each quarter of the observed layer, and no blind interval longer than the
larger of 12 seconds or 15% of the layer. A partial startup layer, skipped layer,
pause, stale status, or new print cannot count as a full-layer confirmation.
Layer boundaries come from printer reports and are approximate to polling.

For other jobs, the generic check requests inspection when a gap grows by at least 3 pixels from the
first to last quarter without closing by more than 2 pixels, or stays at least
3 pixels above an earlier completed-layer baseline without closing. Brief
travel lifts that close again do not satisfy that rule. Image jitter smaller
than these thresholds is ignored. A first observed constant gap has no known
healthy baseline and cannot establish a fault. Missing camera coverage stays
unknown, never a clean bill of health. A stable visible gap does not prove
filament is flowing.

The gap may enlarge primarily between layers as the A5MP bed lowers, so the
second rule checks for a gap remaining open throughout the next layer as well.
No automatic pause, filament-drying diagnosis, or notification outside this
dashboard is implemented. Live air-printing failure accuracy is unvalidated;
tests cover synthetic widening, recovery after travel, occlusion, camera
movement, state freshness, and layer/run resets.

References are stored owner-only in ignored `data/gap-a5mp.json` and
`data/gap-reference-*.jpg`. Latest close-ups and the last 20 completed-layer
results are kept in memory. Marking a new reference clears prior measurements.
Calibration writes require localhost; LAN clients can view the panel.
`FLASHFORGE_CAMERA=off` also disables the gap sampler. Legacy height modules
remain available in the source but are not attached to the running monitor.
The existing `/api/height/a5mp/*` routes serve this replacement panel.

```sh
node --test test/gap.test.mjs
data/obico-venv/bin/python -B test/gap_tracker_test.py
```

## The Brother printers get a turn too

The **Laser printer status** tab monitors the Brother MFC-L2710DW and HL-L3270CDW on your LAN. They make fewer plastic noodles, but they still run out of things. Set each address in **Settings** on its card. Addresses are saved in ignored `data/printers.json` under `mfc_l2710dw` and `hl_l3270cdw`. The sanitized `data/printers.example.json` includes both models; a new checkout needs your addresses before it can connect.

Monitoring uses read-only SNMP v2c queries on UDP port 161 with the community name `public`, every 30 seconds. It reads the model before accepting status, so swapped or incorrect addresses show a model mismatch. These printers respond to GET/GETNEXT; GETBULK timed out during hardware verification. No print, configuration, or SNMP SET commands are sent. This feature runs on the existing local Node server and needs no Brother cloud account.

Cards show the printer display (including Sleep), printing state, detected errors, lifetime sheet/impression counters, toner availability, and available drum/belt/waste-container readings. Unknown levels remain unknown: `-3` means some supply or receptacle space remains, not a percentage. Drum/belt percentages are calculated only from a nonnegative level and a positive maximum. Disconnected printers hide live readings and show the last successful contact. Brother devices do not enter the 3D print history or printing-hour maintenance records.

The bottom of **Home** shows **Laserjet queues**, polling each printer's IPP endpoint on port 631 every 10 seconds. It verifies the reported model and requests only active jobs with `Get-Printer-Attributes` and `Get-Jobs`. Job names, queued/held/printing states, and reported sheet or impression counts are shown; completed jobs are excluded. Empty queues and unavailable queues are displayed separately. These are jobs already received by the printers; jobs held in a computer's local print queue may not appear until submitted. Queue details stay in memory, and no jobs are created, cancelled, or changed. Lists are limited to the first 100 returned jobs.

## What you can see

- Connection status, state, reported error code, job name, progress and layer count.
- Progress as reported by the printer’s byte-progress counter, plus a separate layer count.
- Remaining time is the main reading, with a projected finish day/time and a smaller percentage. Estimates come from the printer, not percentage-based extrapolation.
- Nozzle and bed temperatures for all four printers, plus C5P chamber and door readings. TCP fallback has no ETA, so it displays unavailable.
- Missing or unsupported measurements appear as a dash. Unreachable printers show last-seen time and discard stale measurements. A disconnected dashboard service displays a stale-data warning.

**Need attention** counts reported errors, paused/pausing printers, and due maintenance. **Unavailable** means a connection is unconfigured, unreachable, or unsupported. These readings help you decide what to check; they don't diagnose every hardware problem.

## Maintenance reminders

The printers have a to-do list now. Unfortunately, they still expect someone else to do it.

Use **Add task** on a printer card, or **Manage** beside an existing task. Give each task its own printing-hours interval, calendar-days interval, or both. It's due when either limit is reached. Reminders appear in the dashboard; there are no email, push, or operating-system notifications.

The hours counter tracks **printing time the dashboard actually observed**. It counts intervals of at most 15 seconds between two successful printing readings. Pauses, disconnections, Mac sleep, and app downtime don't count. It starts when tracking begins and can't recover earlier usage. Calendar reminders still work while a printer is disconnected.

A new reminder starts when you save it; editing keeps its original baseline. After doing the work, choose **Mark serviced today**. That adds a local service record and starts the next full interval for that task. It doesn't reset other tasks or the accumulated printing-hours total, and it doesn't assume any earlier service was done. Data is saved atomically to `data/maintenance.json` after each poll and reminder action. Keep the app running to count printing time. If a save fails, you'll see a warning.

## Machine baselines

Expand **Machine baseline** on a printer card to review its saved starting information locally: printing totals, material counters, nozzle sizes, build volume, firmware version, and serial number. These records stay in ignored `data/maintenance.json`.

The displayed lifetime total adds only printing observed **after** the screenshot baseline was recorded. Previously observed app time is not added again. Downtime and missed readings are not backfilled; keep the service running and Mac awake to continue counting. Material counters remain labeled as baseline values; consumption after that point is not yet tracked. Baselines do not establish last-service dates. Each task clearly labels its initial milestone until the first recorded service.

## Estimated versus actual print time

This is where the estimate meets the clock. Sometimes they have different opinions.

**Estimated vs actual** saves a record of each detected print across all four printers. Choose **Add estimate** on a row to read the original estimate from that print's Flash Studio G-code, or enter it as hours:minutes:seconds. The browser reads the file; only the estimate, filename, and slicer version are saved. Use the file for that exact print. Similar filenames aren't enough to establish a match, and a Creator 5 logo estimate doesn't belong to an Adventurer job.

Completed records show the actual duration, difference, and percentage longer or shorter than estimated. Actual duration is elapsed wall time **including pauses**, distinct from the maintenance printing-hours counter. Automatic timing is approximate to the polling interval. A start is considered observed only after a recent idle reading and before progress indicates a late observation. A printer returning to idle does not prove success: use **Edit timing** to confirm a known outcome. Cancelled, failed, and unconfirmed outcomes are excluded from comparisons.

If the dashboard first sees a print already underway, it doesn't know the full duration. Disconnections, Mac sleep, restarts, and uncertain printer states flag interrupted timing. You'll see the observed span, clearly separated from a full print time. If you know the actual total, enter it to complete the record. Manual corrections keep the observation notes and are labeled as manually entered. Wait until a running print ends before changing its actual total or outcome.

Use **Add past print** for an earlier job or one missed while monitoring was disconnected. Enter the printer, job, end date, estimate, actual duration, and outcome. The dashboard can't reconstruct a job that started and finished while it was closed, or distinguish every same-name restart between polls. Keeping the Mac awake and the service running gives it the best chance of catching the whole print.

Records are saved locally and atomically in `data/history.json`, including active records and estimate provenance.

## Inspect a sliced job

Choose **Check a sliced job → Choose G-code** to inspect a Flash Studio `.gcode` export in the browser. You'll see the printer profile, each filament channel's material/color, and both available quantity estimates. The inspector reads only the first 1 MiB, which must contain a complete configuration header. It doesn't execute G-code, upload the file, or authorize printing. Sliced `.3mf` files aren't supported yet.

The sanitized Flash Studio example targets Creator 5 with four 0.4 mm nozzles and PETG channels. Its summary and individual filament records intentionally differ so the discrepancy handling remains covered by tests. A machine-readable inspection is saved in `reports/flashforge-logo-requirements.json`.

The inspector can read what the file says. It can't tell you what's actually loaded in the printer, how much filament is left, or whether everything is compatible. No sample G-code was sent to a printer.

## Run the checks

```sh
npm test
```

Automated tests cover TCP packet fragmentation, job transitions, state/temperature parsing, elapsed-time gaps, due thresholds, service resets, HTTP errors, and address validation. Tests also cover cloud identity matching, token-field exclusion, retained/stale messages, reconnection behavior and independent maintenance resets. Live hardware checks verified all four printers’ changing cloud status and remaining-time estimates with cloud enabled.

## Want to help?

Contributions are welcome: bug fixes, clearer documentation, better tests, and support for other printers. **Other brands and models are absolutely welcome.** This started with the printers in my office; it doesn't have to end there. My floor space, however, does.

I can only test the printers I own. If you're adding another model, I'll need you to test it on your hardware and help with any follow-up questions. Please be clear about what you've actually tested and what is still a best guess. A familiar-looking API response isn't quite the same as a successful print.

### From idea to pull request

1. For a new printer integration or a larger change, [open an issue](https://github.com/lderezinski/printer-dashboard/issues) first so we can talk through the approach. Small fixes can go straight to a pull request.
2. Fork the repository, clone your fork, and create a branch for your change. Use Node.js 22 or newer and install dependencies with `npm ci --ignore-scripts`.
3. Keep the change focused. Add or update tests for changed behavior, and update the setup instructions if someone will need to configure something differently. Use sanitized fixtures so automated tests can run without a printer, a cloud account, or your home network.
4. Run the checks below, then push your branch and open a pull request against `main`. Describe what changed, why, and how you tested it. Screenshots help with dashboard changes.

For a new printer, include the model, firmware version, connection method, and any required setup. Tell me which readings work, what happens when the printer is offline, and what you haven't been able to verify. Include sanitized sample responses where useful, and document limitations instead of filling missing readings with reassuring guesses.

### Before you send it over

Set up the secret scanner and local commit hook once:

```sh
python3 scripts/install-gitleaks.py
npm run security:hooks
```

Then check your changes:

```sh
npm test
npm run security:check
npm audit --omit=dev
```

If you change the Python camera or tracking code, also run its tests after installing the Python dependencies described in [Camera checks](#camera-checks-is-that-supposed-to-look-like-spaghetti):

```sh
data/obico-venv/bin/python -B -m unittest discover -s test -p '*_test.py'
```

Keep passwords, tokens, serial numbers, private addresses, camera images, and personal print history out of commits, issues, and screenshots. Real configuration stays in ignored `data/`; shared examples belong in `data.example/` with private details removed. See [SECURITY.md](SECURITY.md) for the security guidance.

GitHub requires the **`audit`** check in **Security checks** to pass before changes can reach `main`. It runs the JavaScript tests, secret scans, and JavaScript and Python dependency audits. Pull request branches must also be up to date with `main`. Only my GitHub account (`lderezinski`) can push or merge into `main`, and the required checks apply to my changes too. Even the person who made the mess has to pass the tests.

## API references

These are community-documented interfaces. They're useful references, but they aren't an officially supported developer API:

- [Protocol and compatibility](https://github.com/Parallel-7/flashforge-api-docs)
- [HTTP status schema](https://github.com/Parallel-7/flashforge-api-docs/wiki/HTTP-REST-API)
- [Creator 5 differences](https://github.com/Parallel-7/flashforge-api-docs/wiki/Creator-5-Series)
- [State mappings](https://github.com/Parallel-7/flashforge-api-docs/wiki/State-Machines)

An existing general-purpose Python client is also available at [GhostTypes/ff-5mp-api-py](https://github.com/GhostTypes/ff-5mp-api-py).

## Planned TigerTag integration

Next on the wish list: keep track of which spool is where and how much is left. "That looks like enough filament" is a bold strategy for an overnight print.

See [ROADMAP.md](ROADMAP.md) for the planned Flash Studio → filament checks → selected printer workflow, including individual scales in the SUNLU S4/S2 dryers and the connections still needed to make it work.

TigerTag support has been researched, but **it isn't installed or implemented yet**. The [official JavaScript SDK](https://github.com/TigerTag-Project/TigerTag-SDK-JS) can decode an NFC chip's UID and payload offline. The idea is to scan a spool, keep its identity and tag data, and associate it with a printer/slot. Quantity readings need a source and timestamp: a weight saved on a tag won't tell you what the printer has used since then. The NFC reader and reading workflow still need to be chosen, and native Flashforge RFID compatibility hasn't been verified. [Tiger Studio](https://github.com/TigerTag-Project/TigerTag-Studio-Manager) uses local HTTP 8898 for Flashforge, separately from this dashboard's cloud status reader.

## Credit where it's due

There is a lot of other people's work behind this dashboard, and I want the people who made it possible to get credit. Thank you to the authors, maintainers, and contributors below. Every project name links to its GitHub source repository.

The list includes the projects used directly, copied upstream code and model integration, every npm module in this checkout's lockfile, the installed Python camera environment, security tools, and the projects named in the roadmap. Yes, it's a long list. Even a printer dashboard has dependencies with dependencies.

This inventory was created against [package.json](package.json), [package-lock.json](package-lock.json), [requirements-obico.txt](requirements-obico.txt), installed package author/repository metadata and notices, [Obico provenance](vendor/obico/README.md), and [ROADMAP.md](ROADMAP.md). These versions describe this checkout; they aren't a promise that everything is the latest release. The indirect Python dependencies reflect the installed environment and aren't all pinned in the requirements file.

### Projects used directly

| Project / module | Authors and contributors credited | Use in this dashboard |
| --- | --- | --- |
| [Node.js](https://github.com/nodejs/node) | Node.js authors and contributors; OpenJS Foundation | JavaScript server, built-in networking/file/process modules, and the `node:test` test runner. |
| [CPython / Python](https://github.com/python/cpython) | Guido van Rossum, the Python core developers and contributors; Python Software Foundation | Camera workers, Flash Studio bootstrap helper, setup scripts, standard-library modules, and Python tests. |
| [MQTT.js (`mqtt`)](https://github.com/mqttjs/MQTT.js) | Adam Rudd, Matteo Collina, Siarhei Buntsevich, Yoseph Maguire, Daniel Lando, and contributors | Flashforge cloud status subscriptions; installed version 5.15.2. |
| [node-net-snmp (`net-snmp`)](https://github.com/markabrahams/node-net-snmp) | Mark Abrahams, Stephen Vickers, NoSpaceships Ltd, and contributors | Brother printer status, counters, and supply readings; installed version 3.29.1. |
| [IPP (`ipp`)](https://github.com/williamkapke/ipp) | William Kapke and contributors | Brother print-queue queries; installed version 1.1.0. |
| [Obico / The Spaghetti Detective](https://github.com/TheSpaghettiDetective/obico-server) | The Obico / The Spaghetti Detective authors and contributors | Local spaghetti-detection model and vendored ONNX inference helpers. Only the inference integration is used; the full Obico server and cloud prediction service are not deployed. |
| [ONNX Runtime (`onnxruntime`)](https://github.com/microsoft/onnxruntime) | Microsoft and ONNX Runtime contributors | CPU inference for the Obico model; pinned version 1.22.1. |
| [OpenCV](https://github.com/opencv/opencv) and [OpenCV Python packages (`opencv-python-headless`)](https://github.com/opencv/opencv-python) | OpenCV authors and contributors; Olli-Pekka Heinisuo and the Python packaging contributors | Camera-image decoding, preprocessing, annotations, and experimental gap tracking; Python package pinned to 4.12.0.88. |
| [NumPy (`numpy`)](https://github.com/numpy/numpy) | Travis E. Oliphant and the NumPy developers and contributors | Image arrays and numerical operations; pinned version 2.2.6. |
| [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg) | ImageIO contributors | Locates the bundled FFmpeg executable for camera capture; pinned version 0.6.0. |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | FFmpeg developers and contributors | Decodes the Tapo C120 RTSP camera streams, invoked through a subprocess. |

The Obico helpers are copied from commit [`49c0bc7001a3fd8d56297fc3032ba287bfe1d50b`](https://github.com/TheSpaghettiDetective/obico-server/tree/49c0bc7001a3fd8d56297fc3032ba287bfe1d50b). The downloaded model is `model-weights-5a6b1be1fa.onnx`; its source URL and checksum are recorded by [setup-obico-model.py](setup-obico-model.py). The vendored source retains its [AGPL-3.0 license](vendor/obico/LICENSE) and [provenance notes](vendor/obico/README.md). This dashboard's alert thresholds and status presentation are implemented separately.

### Additional npm modules

These modules come along with the three direct npm dependencies above. Some support command-line tools, browser compatibility, or type definitions, so they aren't used on every dashboard request. Multiple installed versions share one row. Author credits come from package metadata and license notices; the upstream repositories have the full contributor histories.

| Module | Installed version(s) | Authors and contributors credited |
| --- | --- | --- |
| [@babel/runtime](https://github.com/babel/babel) | 7.29.7 | The Babel Team and contributors |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped) | 22.20.2 | Microsoft TypeScript and the DefinitelyTyped Node.js definition contributors |
| [@types/readable-stream](https://github.com/DefinitelyTyped/DefinitelyTyped) | 4.0.24 | TeamworkGuy2, markdreyer, Matteo Collina, and DefinitelyTyped contributors |
| [@types/ws](https://github.com/DefinitelyTyped/DefinitelyTyped) | 8.18.1 | Paul Loyd, Margus Lamp, Philippe D’Alva, reduckted, teidesu, Bartosz Wojtkowiak, Kyle Hensel, Samuel Skeen, and DefinitelyTyped contributors |
| [abort-controller](https://github.com/mysticatea/abort-controller) | 3.0.0 | Toru Nagashima and contributors |
| [asn1-ber](https://github.com/markabrahams/node-asn1-ber) | 1.2.2 | Mark Abrahams, Stephen Vickers, NoSpaceships Ltd, and contributors |
| [base64-js](https://github.com/beatgammit/base64-js) | 1.5.1 | T. Jameson Little and contributors |
| [bl](https://github.com/rvagg/bl) | 6.1.6 | bl authors and contributors |
| [broker-factory](https://github.com/chrisguttandin/broker-factory) | 3.1.15 | Christoph Guttandin and contributors |
| [buffer](https://github.com/feross/buffer) | 6.0.3 | Feross Aboukhadijeh, Romain Beauxis, James Halliday, and contributors |
| [buffer-from](https://github.com/LinusU/buffer-from) | 1.1.2 | Linus Unnebäck and contributors |
| [commist](https://github.com/mcollina/commist) | 3.2.0 | Matteo Collina and contributors |
| [concat-stream](https://github.com/maxogden/concat-stream) | 2.0.0 | Max Ogden and contributors |
| [debug](https://github.com/debug-js/debug) | 4.4.3 | Josh Junon, TJ Holowaychuk, Nathan Rajlich, Andrew Rhyne, and contributors |
| [event-target-shim](https://github.com/mysticatea/event-target-shim) | 5.0.1 | Toru Nagashima and contributors |
| [events](https://github.com/Gozala/events) | 3.3.0 | Irakli Gozalishvili and contributors |
| [fast-unique-numbers](https://github.com/chrisguttandin/fast-unique-numbers) | 9.0.27 | Christoph Guttandin and contributors |
| [help-me](https://github.com/mcollina/help-me) | 5.0.0 | Matteo Collina and contributors |
| [ieee754](https://github.com/feross/ieee754) | 1.2.1 | Feross Aboukhadijeh, Romain Beauxis, and contributors |
| [inherits](https://github.com/isaacs/inherits) | 2.0.4 | Isaac Z. Schlueter and contributors |
| [ip-address](https://github.com/beaugunderson/ip-address) | 10.7.0 | Beau Gunderson and contributors |
| [js-sdsl](https://github.com/js-sdsl/js-sdsl) | 4.3.0 | ZLY201 and contributors |
| [lru-cache](https://github.com/isaacs/node-lru-cache) | 10.4.3 | Isaac Z. Schlueter and contributors |
| [minimist](https://github.com/minimistjs/minimist) | 1.2.8 | James Halliday and contributors |
| [mqtt-packet](https://github.com/mqttjs/mqtt-packet) | 9.0.2 | Matteo Collina, Adam Rudd, Peter Sorowka, Wouter Klijn, Siarhei Buntsevich, and contributors |
| [ms](https://github.com/vercel/ms) | 2.1.3 | Vercel and contributors |
| [number-allocator](https://github.com/redboltz/number-allocator) | 1.0.14 | Takatoshi Kondo and contributors |
| [process](https://github.com/shtylman/node-process) | 0.11.10 | Roman Shtylman and contributors |
| [process-nextick-args](https://github.com/calvinmetcalf/process-nextick-args) | 2.0.1 | Calvin Metcalf and contributors |
| [readable-stream](https://github.com/nodejs/readable-stream) | 3.6.2, 4.7.0 | Node.js contributors |
| [rfdc](https://github.com/davidmarkclements/rfdc) | 1.4.1 | David Mark Clements and contributors |
| [safe-buffer](https://github.com/feross/safe-buffer) | 5.2.1 | Feross Aboukhadijeh and contributors |
| [smart-buffer](https://github.com/JoshGlazebrook/smart-buffer) | 4.2.0 | Josh Glazebrook, syvita, and contributors |
| [socks](https://github.com/JoshGlazebrook/socks) | 2.8.10 | Josh Glazebrook, castorw, and contributors |
| [split2](https://github.com/mcollina/split2) | 4.2.0 | Matteo Collina and contributors |
| [string_decoder](https://github.com/nodejs/string_decoder) | 1.3.0 | Node.js contributors |
| [tslib](https://github.com/Microsoft/tslib) | 2.8.1 | Microsoft Corp. and contributors |
| [typedarray](https://github.com/substack/typedarray) | 0.0.6 | James Halliday and contributors |
| [undici-types](https://github.com/nodejs/undici) | 6.21.0 | Daniele Belardi, Ethan Arrowood, Matteo Collina, Matthew Aitken, Robert Nagy, Szymon Marczak, Tomas Della Vedova, and contributors |
| [util-deprecate](https://github.com/TooTallNate/util-deprecate) | 1.0.2 | Nathan Rajlich and contributors |
| [worker-factory](https://github.com/chrisguttandin/worker-factory) | 7.0.50 | Christoph Guttandin and contributors |
| [worker-timers](https://github.com/chrisguttandin/worker-timers) | 8.0.34 | Christoph Guttandin, Anthony Ng, and contributors |
| [worker-timers-broker](https://github.com/chrisguttandin/worker-timers-broker) | 8.0.18 | Christoph Guttandin and contributors |
| [worker-timers-worker](https://github.com/chrisguttandin/worker-timers-worker) | 9.0.15 | Christoph Guttandin, Knissing, and contributors |
| [ws](https://github.com/websockets/ws) | 8.21.3 | Einar Otto Stangvik and contributors |

### Additional Python modules and setup tools

These Python packages are installed in `data/obico-venv` alongside the four direct requirements above. npm comes with the local JavaScript toolchain. The last column explains what each one does here.

| Project / module | Installed version | Authors and contributors credited | Role |
| --- | --- | --- | --- |
| [coloredlogs](https://github.com/xolox/python-coloredlogs) | 15.0.1 | Peter Odding and contributors | ONNX Runtime dependency for logging. |
| [humanfriendly](https://github.com/xolox/python-humanfriendly) | 10.0 | Peter Odding and contributors | Formatting and parsing support used by coloredlogs. |
| [FlatBuffers (`flatbuffers`)](https://github.com/google/flatbuffers) | 25.12.19 | Google, Derek Bailey, and FlatBuffers contributors | Serialization support in the ONNX Runtime dependency chain. |
| [mpmath](https://github.com/mpmath/mpmath) | 1.3.0 | Fredrik Johansson and contributors | Arbitrary-precision mathematics dependency of SymPy. |
| [packaging](https://github.com/pypa/packaging) | 26.3 | Donald Stufft, the Python Packaging Authority, and contributors | Package/version handling in the Python dependency chain. |
| [Protocol Buffers (`protobuf`)](https://github.com/protocolbuffers/protobuf) | 7.36.1 | Google and Protocol Buffers contributors | Serialization support in the ONNX Runtime dependency chain. |
| [SymPy (`sympy`)](https://github.com/sympy/sympy) | 1.14.0 | The SymPy development team and contributors | Symbolic mathematics dependency of ONNX Runtime. |
| [pip](https://github.com/pypa/pip) | 26.2.1 | The pip developers and Python Packaging Authority contributors | Installs the Python camera environment. |
| [setuptools](https://github.com/pypa/setuptools) | 84.0.0 | Python Packaging Authority and setuptools contributors | Python package installation/build support. |
| [npm CLI](https://github.com/npm/cli) | Supplied with the local Node.js toolchain | npm CLI authors and contributors | Installs locked JavaScript dependencies and runs the dashboard/test scripts. |

Node.js and Python standard-library modules are credited through their parent projects rather than repeated as third-party packages. Native components bundled inside runtimes, Python wheels, and FFmpeg have additional authors and notices: see the upstream [Node.js license and bundled-component credits](https://github.com/nodejs/node/blob/main/LICENSE), [CPython notices](https://github.com/python/cpython/blob/main/LICENSE), [NumPy notices](https://github.com/numpy/numpy/blob/main/LICENSE.txt), [OpenCV Python third-party notices](https://github.com/opencv/opencv-python/blob/master/LICENSE-3RD-PARTY.txt), [ONNX Runtime notices](https://github.com/microsoft/onnxruntime/blob/main/ThirdPartyNotices.txt), and [FFmpeg credits](https://github.com/FFmpeg/FFmpeg/blob/master/CREDITS), together with the notices shipped in the installed distributions. The package tables above do not enumerate every library compiled into those upstream binaries.

### Security and continuous-integration tools

| Project | Authors and contributors credited | Role |
| --- | --- | --- |
| [Gitleaks](https://github.com/gitleaks/gitleaks) | Gitleaks authors and contributors | Version 8.30.1, checksum-verified installer; scans working files, staged files, and Git history for secrets. |
| [pip-audit](https://github.com/pypa/pip-audit) | Python Packaging Authority and pip-audit contributors | Python dependency auditing in CI; pinned in `requirements-security.txt`. Its transitive tools are installed in the CI environment, separately from the camera runtime. |
| [actions/checkout](https://github.com/actions/checkout) | GitHub and contributors | Checks out the repository for security CI; pinned by commit. |
| [actions/setup-node](https://github.com/actions/setup-node) | GitHub and contributors | Sets up Node.js for security CI; pinned by commit. |
| [actions/setup-python](https://github.com/actions/setup-python) | GitHub and contributors | Sets up Python for security CI; pinned by commit. |

These modules were installed in a separate environment to check dependencies for known security problems. They support the audit tools, not the camera workers. CI may install newer compatible versions. `pip`, `setuptools`, and `packaging` are credited above.

| Audit dependency | Verified version | Authors and contributors credited |
| --- | --- | --- |
| [boolean.py](https://github.com/bastikr/boolean.py) | 5.0 | Sebastian Kraemer and contributors |
| [CacheControl](https://github.com/psf/cachecontrol) | 0.14.4 | Eric Larson, Frost Ming, William Woodruff and contributors |
| [certifi](https://github.com/certifi/python-certifi) | 2026.7.22 | Kenneth Reitz and contributors |
| [charset-normalizer](https://github.com/jawah/charset_normalizer) | 3.5.1 | Ahmed R. TAHRI and contributors |
| [cyclonedx-python-lib](https://github.com/CycloneDX/cyclonedx-python-lib) | 11.12.0 | Paul Horton and contributors |
| [defusedxml](https://github.com/tiran/defusedxml) | 0.7.1 | Christian Heimes and contributors |
| [filelock](https://github.com/tox-dev/py-filelock) | 4.0.0 | tox-dev team and contributors |
| [idna](https://github.com/kjd/idna) | 3.19 | Kim Davies and contributors |
| [license-expression](https://github.com/aboutcode-org/license-expression) | 30.4.4 | nexB. Inc. and others and contributors |
| [markdown-it-py](https://github.com/executablebooks/markdown-it-py) | 4.2.0 | Chris Sewell and contributors |
| [mdurl](https://github.com/executablebooks/mdurl) | 0.1.2 | Taneli Hukkinen and contributors |
| [msgpack](https://github.com/msgpack/msgpack-python) | 1.2.2 | Inada Naoki and contributors |
| [packageurl-python](https://github.com/package-url/packageurl-python) | 0.17.6 | the purl authors and contributors |
| [pip-requirements-parser](https://github.com/nexB/pip-requirements-parser) | 32.0.1 | The pip authors, nexB. Inc. and others and contributors |
| [pip_api](https://github.com/di/pip-api) | 0.0.35 | Dustin Ingram and contributors |
| [platformdirs](https://github.com/tox-dev/platformdirs) | 4.11.9 | tox-dev team and contributors |
| [py-serializable](https://github.com/madpah/serializable) | 2.1.0 | Paul Horton and contributors |
| [Pygments](https://github.com/pygments/pygments) | 2.21.0 | Georg Brandl and contributors |
| [pyparsing](https://github.com/pyparsing/pyparsing) | 3.3.2 | Paul McGuire and contributors |
| [requests](https://github.com/psf/requests) | 2.34.2 | Kenneth Reitz and contributors |
| [rich](https://github.com/Textualize/rich) | 15.0.0 | Will McGugan and contributors |
| [sortedcontainers](https://github.com/grantjenks/python-sortedcontainers) | 2.4.0 | Grant Jenks and contributors |
| [tomli](https://github.com/hukkin/tomli) | 2.4.1 | Taneli Hukkinen and contributors |
| [tomli_w](https://github.com/hukkin/tomli-w) | 1.2.0 | Taneli Hukkinen and contributors |
| [typing_extensions](https://github.com/python/typing_extensions) | 4.16.0 | Guido van Rossum, Jukka Lehtosalo, Łukasz Langa, Michael Lee and contributors |
| [urllib3](https://github.com/urllib3/urllib3) | 2.8.0 | Andrey Petrov and contributors |

### Planned integrations and reference projects

These are the projects behind the current plans and research. Being on this list doesn't mean a project is installed or its integration works yet; the status column spells that out.

| Project | Authors and contributors credited | Status and intended role |
| --- | --- | --- |
| [TigerTag JavaScript SDK](https://github.com/TigerTag-Project/TigerTag-SDK-JS) | TigerTag Project team and contributors | **Planned, not implemented:** decode spool NFC UID/payload data and preserve the TigerTag format for inventory and printer-slot assignments. |
| [TigerScale V3](https://github.com/TigerTag-Project/Tiger-Scale-V3) | TigerTag Project team and contributors | **Hardware/firmware reference for planned scale integration:** investigate individual spool weighing and NFC identification in the SUNLU dryers. Hardware selection, calibration, and dryer suitability remain unverified. |
| [TigerTag Studio Manager / Tiger Studio](https://github.com/TigerTag-Project/TigerTag-Studio-Manager) | TigerTag Project team and contributors | **Research reference:** printer/filament workflow and local Flashforge transport. Its code is not incorporated, and its local transport is not the dashboard's cloud reader. |
| [Flashforge API documentation](https://github.com/Parallel-7/flashforge-api-docs) | Parallel-7 and documentation contributors | **Protocol reference used by the project:** printer status schemas, state mappings, and Creator 5 behavior; also a reference for future job submission research. |
| [FlashForge 5M Python API (`ff-5mp-api-py`)](https://github.com/GhostTypes/ff-5mp-api-py) | GhostTypes and contributors | **Alternative client/reference:** linked for comparison; not imported or installed, and adoption is not currently committed in the roadmap. |

Beyond the plans and references above, no NFC-reader library, scale firmware stack, inventory service, or job-forwarding library has been chosen yet. Add the credits when those choices are made. Flash Studio and its networking library, macOS/Rosetta, printer firmware, and SUNLU/Tapo hardware are also part of the setup or plans, but listing them here doesn't make them open source.

If you change the npm lockfile, Python environment, copied upstream code, or roadmap, update these credits too. The original licenses, author lists, and notices still apply. A thank-you in the README doesn't replace them.
