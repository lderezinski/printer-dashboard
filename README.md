# Flashforge Health

A local dashboard with live cloud monitoring, remaining-time estimates, print history, and independent maintenance reminders for AD5M, Adventurer 5M Pro, Creator 5 and Creator 5 Pro. Flashforge cloud stays enabled. Requires Node.js 22 or newer and your installed, signed-in Flash Studio on this Mac. Dependencies are installed; for a new checkout run `npm ci` first.

Sanitized examples for the private files stored under `data/` are available in
`data.example/`.

## Run

```sh
npm start
```

Open http://localhost:3000 on this Mac. Or double-click **Start Dashboard.command** in Finder. Keep the Terminal window open while monitoring; press Control-C to stop.

From a phone, tablet, or computer on the same home network, open the LAN address printed in the Terminal when the dashboard starts. Keep this Mac awake and the dashboard running. If the Mac's address changes, use the new address. A DHCP reservation for this Mac in your router can keep the address consistent. If macOS asks whether Node may accept incoming connections, choose Allow for LAN access.

Devices on your LAN can view the dashboard and edit its settings, existing history, and maintenance records. **Add past print** and **Check a sliced job** are available only through `http://localhost:3000` on this Mac; opening any IP address hides those tools. Manual history creation is also blocked by the server for IP access and non-loopback clients. There is no dashboard login. No router port forwarding or public hosting is needed.

## Connect the printers

Example private-network addresses are prefilled for the four 3D printers. Replace them with each printer's LAN address in **Settings**.

Keep Flashforge cloud enabled. The dashboard uses Flash Studio’s saved sign-in session and the installed networking library to retrieve your account’s printer list and MQTT connection information. Leave Flash Studio installed in `/Applications/Flash Studio.app`. It need not stay open after sign-in; when its session expires, sign in there again and click **Reconnect cloud** in the dashboard.

Cloud status is matched by account device ID, serial number, model/PID, and the configured IP address. Addresses changing on your network can prevent a match; update **Settings** on the printer card. Settings remain in `data/printers.json` with owner-only permissions. Account tokens are read only by a private helper process and sent to the verified Flashforge service. Broker credentials pass to Node through a private pipe; neither tokens nor raw cloud reports are written into dashboard records or sent to the browser.

The installed Flash Studio 1.7.17 networking library (3.4.3) is Intel-only; the helper uses the Mac’s system Python under Rosetta. The library handles the two authenticated HTTPS reads. MQTT.js handles the status stream directly because the native status callback did not deliver the current live messages during testing. The provider advertises `mqtt.voxelshare.com` on plain MQTT port 1883; TLS on 8883 was unavailable during verification. This is not an end-to-end encrypted status transport.

Only fresh `device_action` / `device_status` messages populate the dashboard. Retained messages and cached REST device details are excluded. Measurements expire after 15 seconds without a fresh report. The connection retries after failures and renews broker credentials every 30 minutes from Flash Studio’s current saved session, without rotating its refresh token or sending a login-sync command. The production monitor only subscribes; it never publishes printer commands.

Both Adventurers have a local fallback. The AD5M’s authenticated-identity HTTP status read also supplies remaining time with cloud enabled on its current firmware. If unavailable, it falls back to TCP status. The A5MP falls back to TCP, which does not supply remaining time. TCP sends only `M119`, `M27`, `M105`, then `M119` again to detect job transitions. C5/C5P do not have this fallback; they show unavailable when cloud reports stop. Their local HTTP service still requires LAN Only, but the dashboard does not change that setting.

The Node service listens on IPv4 port 3000 and accepts loopback or private-network clients. Host checks permit only localhost and this Mac's current private IPv4 addresses; browser requests must use the same origin. Credentials and private data files are never served as static assets. Set `FLASHFORGE_CLOUD=off` when running isolated local tests that must not use the account session.

## Camera failure detection

The Home tab shows **AD5M**, **A5MP**, **C5**, and **C5P camera checks** using
the A5MP, C5, and C5P internal Flashforge MJPEG cameras, plus a Tapo C120
wherever configured. The AD5M has no internal camera installed and uses only
its C120; no internal-camera tile or capture worker is started for it. The A5MP tile pairs its
gap check with its spaghetti check: two independently annotated
views of the same internal camera, side by side on wider screens and stacked
on phones. Each check keeps its own result, capture time, and history; either
alert contributes to Need attention.

All spaghetti checks use Obico's official open-source ONNX model. Each
analyzes a new frame about every 20–25 seconds while its own fresh printer
status says `printing`. Camera addresses follow the printer hosts in
`data/printers.json`, using `http://PRINTER_IP:8080/?action=stream`. Internal cameras require no separate camera account. A missing or
disabled internal camera reports **Unavailable** and retries automatically.

Configured C120 cameras remain active as independent additional views in the same
printer tile, each with its own detector, image, timestamp, and history. Their
private accounts are read from ignored `data/camera-PRINTER_ID.json` files
(`host`, `username`, `password`), using RTSP `stream1`. Without that file, the
extra view stays hidden. If a configured C120 becomes unavailable, its status
shows the failure while internal monitoring continues; an unavailable internal
camera likewise does not stop the C120. Either source can raise Need attention.
Camera credentials are never sent to the browser.

This is a local integration of Obico's detector, not the Obico phone app or
cloud service. Images stay on this Mac and its dashboard clients. For each camera, the latest
image and 12 recent results are held in memory and are cleared on restart.
Each printer's Python worker starts automatically with its first active print
and stops with the dashboard. Keep the Mac awake and dashboard running.

Results distinguish **No spaghetti detected**, **Inspect image**, **Check print
now**, **Waiting for printing**, and **Unavailable**. The timestamp always
identifies the last analyzed image; it is a periodically refreshed still, not
live video. A camera result expires after 60 seconds and printer status after
15 seconds. Results from a previous print are discarded. Pauses, job changes,
errors, and long gaps reset the repeated-detection counter.

Alerts appear in Home and the Need attention count. No printer commands,
automatic pauses, phone notifications, or emails are sent. An Obico box score
of at least 0.3 requests inspection; three consecutive frames with a score of
at least 0.6 produce a repeated-detection warning. These initial dashboard
rules require tuning with real prints; they are not Obico Cloud's temporal
algorithm or a probability that a print is good. Ornate shapes, supports,
glare and printhead occlusion can cause false alarms or missed failures.
**No spaghetti detected does not confirm extrusion.** During setup the
user-reported A5MP no-extrusion image produced only a weak 0.117 detection,
below this dashboard's inspection threshold.

Dependencies and the 202 MB model are installed in ignored `data/` directories.
For a fresh checkout on a compatible Python 3.11+ environment:

```sh
python3 -m venv data/obico-venv
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

The gap check is disabled by default for now; its code and saved references are
preserved. Spaghetti detection continues using its own camera captures. To
enable the gap check again, start with `FLASHFORGE_GAP=on npm start`. Set
`FLASHFORGE_DARK_CHESS_JOB` to the exact calibration filename when using the
optional dark-chess rule.

Home starts with **Finishing next**. The **A5MP camera checks** tile below
uses the built-in close-up camera for both gaps and spaghetti.
A single capture worker supplies the A5MP internal frames to both checks, avoiding
competing camera connections. Gap sampling runs about every 3–4 seconds while fresh printer
status says printing; Obico's slower inference does not delay these checks.
This replaces the earlier expected-height/millimeter calibration workflow.

For an A5MP dark-chess calibration job, the temporary
`light-head-dark-chess-v1` rule uses the light-gray print head and the silk-black
chess piece. Their close spacing in the user-confirmed healthy reference is
normal. A gap of at least 3 pixels **beyond that healthy spacing**, present in
all comparable samples across a completed layer, raises **Inspect print** for
possible air printing. A constant open gap counts; widening and recognizable
printer background are not required. The tolerance excludes small tracking jitter
and the normal distance between the housing and the extrusion point.

This profile validates a bright head patch and a dark part patch (allowing silk
highlights), then tracks their separation at the reference pose. It does not
recognize chess shapes or infer extrusion. Hidden, changed, or ambiguous features
remain unknown. It is restricted to the configured dark-chess calibration filename and
the calibrated print run; other jobs keep the generic gap rule. The saved healthy
reference has been selected for this run. A new run needs a fresh healthy
reference, marking the lower gray head edge, the dark piece immediately below,
and a stationary frame feature away from the head. Live failure accuracy remains
unvalidated.

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

## Brother laser printer status

The **Laser printer status** tab monitors Brother MFC-L2710DW and HL-L3270CDW printers on your LAN. Set each address using **Settings** on its card; addresses are saved in the ignored `data/printers.json` under `mfc_l2710dw` and `hl_l3270cdw`. The sanitized `data/printers.example.json` includes both models. New checkouts have no Brother addresses configured until you supply them.

Monitoring uses read-only SNMP v2c queries on UDP port 161 with the community name `public`, every 30 seconds. It reads the model before accepting status, so swapped or incorrect addresses show a model mismatch. These printers respond to GET/GETNEXT; GETBULK timed out during hardware verification. No print, configuration, or SNMP SET commands are sent. This feature runs on the existing local Node server and needs no Brother cloud account.

Cards show the printer display (including Sleep), printing state, detected errors, lifetime sheet/impression counters, toner availability, and available drum/belt/waste-container readings. Unknown levels remain unknown: `-3` means some supply or receptacle space remains, not a percentage. Drum/belt percentages are calculated only from a nonnegative level and a positive maximum. Disconnected printers hide live readings and show the last successful contact. Brother devices do not enter the 3D print history or printing-hour maintenance records.

The bottom of **Home** shows **Laserjet queues**, polling each printer's IPP endpoint on port 631 every 10 seconds. It verifies the reported model and requests only active jobs with `Get-Printer-Attributes` and `Get-Jobs`. Job names, queued/held/printing states, and reported sheet or impression counts are shown; completed jobs are excluded. Empty queues and unavailable queues are displayed separately. These are jobs already received by the printers; jobs held in a computer's local print queue may not appear until submitted. Queue details stay in memory, and no jobs are created, cancelled, or changed. Lists are limited to the first 100 returned jobs.

## What is shown

- Connection status, state, reported error code, job name, progress and layer count.
- Progress as reported by the printer’s byte-progress counter, plus a separate layer count.
- Remaining time is the main reading, with a projected finish day/time and a smaller percentage. Estimates come from the printer, not percentage-based extrapolation.
- Nozzle and bed temperatures for all four printers, plus C5P chamber and door readings. TCP fallback has no ETA, so it displays unavailable.
- Missing or unsupported measurements appear as a dash. Unreachable printers show last-seen time and discard stale measurements. A disconnected dashboard service displays a stale-data warning.

“Need attention” counts reported errors, paused/pausing printers, and due maintenance. “Unavailable” includes unconfigured, unreachable, and unsupported connections. This is status monitoring, not a comprehensive hardware diagnostic.

## Maintenance

Use **Add task** on a printer card, or **Manage** beside an existing task. Each task has independent printing-hours and/or calendar-days intervals. A reminder becomes due when either limit is reached. Reminders appear in the dashboard; there are no email, push, or operating-system notifications.

Hours are **observed printing time**, not lifetime hours: only short intervals (at most 15 seconds) bracketed by two successful printing readings are counted. Pauses, disconnections, Mac sleep, and app downtime are excluded. The counter starts when tracking begins; historical usage is not reconstructed. Calendar reminders continue to work while a printer connection is unavailable.

New reminders begin when saved. Editing preserves the original baseline. **Mark serviced today** adds a local service record and resets only that task’s intervals without resetting other tasks or the accumulated observed-hours total. No past service is inferred. After a task is marked serviced, its next full interval starts from that service. Data is saved atomically to `data/maintenance.json` after each poll and reminder action. Keep the app running to count printing time. A failed save displays a warning.

## Machine baselines

Printer-information baselines are saved only in the ignored `data/maintenance.json`, including printing totals, material counters, nozzle sizes, build volumes, firmware versions, and serial numbers. Expand **Machine baseline** on a card to review them locally.

The displayed lifetime total adds only printing observed **after** the screenshot baseline was recorded. Previously observed app time is not added again. Downtime and missed readings are not backfilled; keep the service running and Mac awake to continue counting. Material counters remain labeled as baseline values; consumption after that point is not yet tracked. Baselines do not establish last-service dates. Each task clearly labels its initial milestone until the first recorded service.

## Estimated versus actual print time

The **Estimated vs actual** section keeps a durable record of each detected print on all four printers. Use **Add estimate** on its row to read the original estimate from that print's Flash Studio G-code, or enter it manually as hours:minutes:seconds. The file is read in the browser; only its estimate, filename and slicer version are saved. Choose the file for that specific print: the app does not infer a match from similar filenames or assign the Creator 5 logo estimate to an Adventurer job.

Completed records show the actual duration, difference, and percentage longer or shorter than estimated. Actual duration is elapsed wall time **including pauses**, distinct from the maintenance printing-hours counter. Automatic timing is approximate to the polling interval. A start is considered observed only after a recent idle reading and before progress indicates a late observation. A printer returning to idle does not prove success: use **Edit timing** to confirm a known outcome. Cancelled, failed, and unconfirmed outcomes are excluded from comparisons.

Prints first seen underway have an unknown total. Disconnections, Mac sleep, restarts and uncertain printer states flag interrupted timing; an observation span is shown without treating it as the full print time. You can enter a known actual total to complete such a record. Manual corrections preserve the observation notes and are labeled as manually entered. A running print's actual total and outcome cannot be overridden until it ends.

Use **Add past print** for earlier jobs or prints missed while monitoring was disconnected. Enter the printer, job, end date, estimate, actual duration and outcome. Automatic monitoring cannot reconstruct jobs that start and finish while the app is closed, or distinguish every same-name restart between polls. Keep this Mac awake and the service running for the best coverage.

Records are saved locally and atomically in `data/history.json`, including active records and estimate provenance.

## Inspect a sliced job

Use **Check a sliced job → Choose G-code** to inspect a Flash Studio `.gcode` export in the browser. The inspector reads only the first 1 MiB and requires a complete configuration header there. It shows the printer profile, each filament channel's material/color and both available quantity estimates. It does not execute G-code, upload a file, or authorize printing. Sliced `.3mf` files are not yet supported.

The sanitized Flash Studio example targets Creator 5 with four 0.4 mm nozzles and PETG channels. Its summary and individual filament records intentionally differ so the discrepancy handling remains covered by tests. A machine-readable inspection is saved in `reports/flashforge-logo-requirements.json`.

Only metadata was inspected; this does not establish actual loaded filament, available quantity, or full printer compatibility. No sample G-code was sent to a printer.

## Validation

```sh
npm test
```

Automated tests cover TCP packet fragmentation, job transitions, state/temperature parsing, elapsed-time gaps, due thresholds, service resets, HTTP errors, and address validation. Tests also cover cloud identity matching, token-field exclusion, retained/stale messages, reconnection behavior and independent maintenance resets. Live hardware checks verified all four printers’ changing cloud status and remaining-time estimates with cloud enabled.

## API references

These interfaces are community-documented, not an official supported developer API:

- [Protocol and compatibility](https://github.com/Parallel-7/flashforge-api-docs)
- [HTTP status schema](https://github.com/Parallel-7/flashforge-api-docs/wiki/HTTP-REST-API)
- [Creator 5 differences](https://github.com/Parallel-7/flashforge-api-docs/wiki/Creator-5-Series)
- [State mappings](https://github.com/Parallel-7/flashforge-api-docs/wiki/State-Machines)

An existing general-purpose Python client is also available at [GhostTypes/ff-5mp-api-py](https://github.com/GhostTypes/ff-5mp-api-py).

## Planned TigerTag integration

See [ROADMAP.md](ROADMAP.md) for the planned Flash Studio → filament checks → selected printer workflow, including individual scales in the SUNLU S4/S2 dryers and the remaining connection dependencies.

TigerTag support has been researched but is not installed or implemented. The [official JavaScript SDK](https://github.com/TigerTag-Project/TigerTag-SDK-JS) can decode an NFC chip's UID and payload offline. A future workflow can scan a spool, preserve its identity and tag data, and associate it with a printer/slot. Quantity readings should carry their source and timestamp; a tag's stored weight is not a real-time measurement of filament consumption. NFC reader selection and tag-reading workflow remain to be chosen. Native Flashforge RFID compatibility has not been verified. [Tiger Studio](https://github.com/TigerTag-Project/TigerTag-Studio-Manager) uses local HTTP 8898 for Flashforge, so its local transport is separate from this dashboard’s cloud status reader.
