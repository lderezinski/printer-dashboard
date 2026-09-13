# Flashforge Health

A local dashboard with live cloud monitoring, remaining-time estimates, print history, and independent maintenance reminders for AD5M, Adventurer 5M Pro, Creator 5 and Creator 5 Pro. Flashforge cloud stays enabled. Requires Node.js 22 or newer and your installed, signed-in Flash Studio on this Mac. Dependencies are installed; for a new checkout run `npm ci` first.

## Run

```sh
npm start
```

Open http://localhost:3000 on this Mac. Or double-click **Start Dashboard.command** in Finder. Keep the Terminal window open while monitoring; press Control-C to stop.

From a phone, tablet, or computer on the same home network, open **http://192.168.50.10:3000**. Keep this Mac awake and the dashboard running. The Terminal prints the current LAN address at startup; if the Mac's address changes, use the new address. A DHCP reservation for this Mac in your router can keep the address consistent. If macOS asks whether Node may accept incoming connections, choose Allow for LAN access.

Devices on your LAN can view the dashboard and edit its settings, existing history, and maintenance records. **Add past print** and **Check a sliced job** are available only through `http://localhost:3000` on this Mac; opening any IP address hides those tools. Manual history creation is also blocked by the server for IP access and non-loopback clients. There is no dashboard login. No router port forwarding or public hosting is needed.

## Connect the printers

The four supplied addresses are prefilled: AD5M `192.168.50.101`, A5MP `192.168.50.102`, C5 `192.168.50.10152`, and C5P `192.168.50.10154`.

Keep Flashforge cloud enabled. The dashboard uses Flash Studio’s saved sign-in session and the installed networking library to retrieve your account’s printer list and MQTT connection information. Leave Flash Studio installed in `/Applications/Flash Studio.app`. It need not stay open after sign-in; when its session expires, sign in there again and click **Reconnect cloud** in the dashboard.

Cloud status is matched by account device ID, serial number, model/PID, and the configured IP address. Addresses changing on your network can prevent a match; update **Settings** on the printer card. Settings remain in `data/printers.json` with owner-only permissions. Account tokens are read only by a private helper process and sent to the verified Flashforge service. Broker credentials pass to Node through a private pipe; neither tokens nor raw cloud reports are written into dashboard records or sent to the browser.

The installed Flash Studio 1.7.17 networking library (3.4.3) is Intel-only; the helper uses the Mac’s system Python under Rosetta. The library handles the two authenticated HTTPS reads. MQTT.js handles the status stream directly because the native status callback did not deliver the current live messages during testing. The provider advertises `mqtt.voxelshare.com` on plain MQTT port 1883; TLS on 8883 was unavailable during verification. This is not an end-to-end encrypted status transport.

Only fresh `device_action` / `device_status` messages populate the dashboard. Retained messages and cached REST device details are excluded. Measurements expire after 15 seconds without a fresh report. The connection retries after failures and renews broker credentials every 30 minutes from Flash Studio’s current saved session, without rotating its refresh token or sending a login-sync command. The production monitor only subscribes; it never publishes printer commands.

Both Adventurers have a local fallback. The AD5M’s authenticated-identity HTTP status read also supplies remaining time with cloud enabled on its current firmware. If unavailable, it falls back to TCP status. The A5MP falls back to TCP, which does not supply remaining time. TCP sends only `M119`, `M27`, `M105`, then `M119` again to detect job transitions. C5/C5P do not have this fallback; they show unavailable when cloud reports stop. Their local HTTP service still requires LAN Only, but the dashboard does not change that setting.

The Node service listens on IPv4 port 3000 and accepts loopback or private-network clients. Host checks permit only localhost and this Mac's current private IPv4 addresses; browser requests must use the same origin. Credentials and private data files are never served as static assets. Set `FLASHFORGE_CLOUD=off` when running isolated local tests that must not use the account session.

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

Use **Add task** on a printer card, or **Manage** beside an existing task. Each task has independent printing-hours and/or calendar-days intervals. Your requested tasks are configured: **Check for nozzle bend** every **100 printing hours** on C5/C5P, and **Lubrication** every **200 printing hours** on all four printers. These are your chosen schedules, not a manufacturer schedule supplied by the app. A reminder becomes due when either limit is reached. Reminders appear in the dashboard; there are no email, push, or operating-system notifications.

Hours are **observed printing time**, not lifetime hours: only short intervals (at most 15 seconds) bracketed by two successful printing readings are counted. Pauses, disconnections, Mac sleep, and app downtime are excluded. The counter starts when tracking begins; historical usage is not reconstructed. Calendar reminders continue to work while a printer connection is unavailable.

New reminders begin when saved. Editing preserves the original baseline. **Mark serviced today** adds a local service record and resets only that task’s intervals without resetting other tasks or the accumulated observed-hours total. The first reminders use the next 100/200 lifetime-hour milestones, as requested. No past service is inferred. After a task is marked serviced, its next full interval starts from that service. Data is saved atomically to `data/maintenance.json` after each poll and reminder action. Keep the app running to count printing time. A failed save displays a warning.

## Machine baselines

The supplied printer-information screenshots are saved in `data/maintenance.json`, with their original printing totals, material counters in centimeters, nozzle sizes, build volumes, firmware versions, and serial numbers. Expand **Machine baseline** on a card to review them.

| Printer | Starting print counter | Material counter | First nozzle check | First lubrication |
| --- | --- | --- | --- | --- |
| AD5M | example baseline | example material total | — | 200 total hours |
| A5MP | example baseline | example material total | — | 2,000 total hours |
| C5 | example baseline | example material total | 700 total hours | 800 total hours |
| C5P | example baseline | example material total | 400 total hours | 400 total hours |

The displayed lifetime total adds only printing observed **after** the screenshot baseline was recorded. Previously observed app time is not added again. Downtime and missed readings are not backfilled; keep the service running and Mac awake to continue counting. Material counters remain labeled as baseline values; consumption after that point is not yet tracked. Baselines do not establish last-service dates. Each task clearly labels its initial milestone until the first recorded service.

## Estimated versus actual print time

The **Estimated vs actual** section keeps a durable record of each detected print on all four printers. Use **Add estimate** on its row to read the original estimate from that print's Flash Studio G-code, or enter it manually as hours:minutes:seconds. The file is read in the browser; only its estimate, filename and slicer version are saved. Choose the file for that specific print: the app does not infer a match from similar filenames or assign the Creator 5 logo estimate to an Adventurer job.

Completed records show the actual duration, difference, and percentage longer or shorter than estimated. Actual duration is elapsed wall time **including pauses**, distinct from the maintenance printing-hours counter. Automatic timing is approximate to the polling interval. A start is considered observed only after a recent idle reading and before progress indicates a late observation. A printer returning to idle does not prove success: use **Edit timing** to confirm a known outcome. Cancelled, failed, and unconfirmed outcomes are excluded from comparisons.

Prints first seen underway have an unknown total. Disconnections, Mac sleep, restarts and uncertain printer states flag interrupted timing; an observation span is shown without treating it as the full print time. You can enter a known actual total to complete such a record. Manual corrections preserve the observation notes and are labeled as manually entered. A running print's actual total and outcome cannot be overridden until it ends.

Use **Add past print** for earlier jobs or prints missed while monitoring was disconnected. Enter the printer, job, end date, estimate, actual duration and outcome. Automatic monitoring cannot reconstruct jobs that start and finish while the app is closed, or distinguish every same-name restart between polls. Keep this Mac awake and the service running for the best coverage.

Records are saved locally and atomically in `data/history.json`, including active records and estimate provenance. The supplied logo's embedded estimate is **7:37:55**; its filename's rounded time is not used. No actual logo print time has been supplied yet.

## Inspect a sliced job

Use **Check a sliced job → Choose G-code** to inspect a Flash Studio `.gcode` export in the browser. The inspector reads only the first 1 MiB and requires a complete configuration header there. It shows the printer profile, each filament channel's material/color and both available quantity estimates. It does not execute G-code, upload a file, or authorize printing. Sliced `.3mf` files are not yet supported.

The supplied Flash Studio 1.7.17 logo sample targets Creator 5 with four 0.4 mm nozzles and PETG channels. Its summary lists 63.32 g while the individual filament records sum to 61.27 g. Both are preserved and the discrepancy is flagged; the reason for the difference and purge coverage have not been verified. The two orange channels remain distinct. A machine-readable inspection of that sample is saved in `reports/flashforge-logo-requirements.json`.

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
