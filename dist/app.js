import { inspectGcode, readTimeEstimate, HEADER_LIMIT } from './gcode.js';
import { initHeight, renderHeight } from './height.js';
const $ = selector => document.querySelector(selector);
const viewTabs = [...document.querySelectorAll('.view-tabs [role="tab"]')];
let localTools = false;
function selectView(tab, focus = false) {
  if (tab.hidden) return;
  for (const item of viewTabs) {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
  }
  const laserView = tab.id === 'tab-laser';
  $('.summary').hidden = laserView;
  $('.cloud-status').hidden = laserView;
  $('#temperature-note').hidden = laserView;
  if (focus) tab.focus();
}
for (const tab of viewTabs) {
  tab.addEventListener('click', () => selectView(tab));
  tab.addEventListener('keydown', event => {
    const availableTabs = viewTabs.filter(item => !item.hidden);
    const index = availableTabs.indexOf(tab);
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % availableTabs.length;
    else if (event.key === 'ArrowLeft') next = (index + availableTabs.length - 1) % availableTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = availableTabs.length - 1;
    else return;
    event.preventDefault();
    selectView(availableTabs[next], true);
  });
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const temp = value => value === null || value === undefined ? '—' : Math.round(value);
const hoursLabel = hours => { if (hours == null) return '—'; const minutes = Math.floor(hours * 60 + 1e-7); return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; };
const time = seconds => seconds === null || seconds === undefined ? '—' : seconds < 60 ? '<1 min' : `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}h ` : ''}${Math.floor((seconds % 3600) / 60)}m`;
let selected = null;
let refreshing = false;
let latestPrinters = [];
let latestCameras = {};
let latestExternalCameras = {};
let maintenanceId = null;
let maintenanceTaskId = null;
let latestHistory = [];
let timingId = null;
let timingSource = null;
let timingVersion = 0;
const timingDialog = $('#timing-dialog');
const dialog = $('#settings');
const form = $('#settings-form');
const maintenanceDialog = $('#maintenance-dialog');

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(6000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function temperature(label, value) {
  return `<div class="temp"><dt>${escape(label)}</dt><dd>${temp(value?.current)} <span class="target">/ ${temp(value?.target)}°</span></dd></div>`;
}
function spaghettiStatus(p, cameras = latestCameras, externalCameras = latestExternalCameras) {
  if (!p.connected || p.rawState !== 'printing') return '';
  const sources = [
    { camera: cameras[p.id], label: 'Integrated camera' },
    { camera: externalCameras[p.id], label: 'Tapo C120' },
  ].filter(({ camera }) => camera?.enabled);
  const windows = sources.map(({ camera, label }) => {
    const current = ['clear', 'suspect', 'warning'].includes(camera.state);
    // Frames resets on a new print or interrupted detection sequence. Do not count older history.
    const history = current ? (camera.history || []).slice(0, Math.min(5, camera.frames || 0)) : [];
    return { label, checked: history.length, positive: history.filter(h => ['suspect', 'warning'].includes(h.state)).length,
      warning: history.some(h => h.state === 'warning') };
  });
  const best = windows.filter(w => w.checked).sort((a, b) => b.positive - a.positive || Number(b.warning) - Number(a.warning) || b.checked - a.checked)[0];
  const complete = windows.length > 0 && windows.every(w => w.checked === 5);
  const tone = windows.some(w => w.warning) ? 'error' : best?.positive ? 'warning' : complete ? 'ok' : 'unknown';
  const details = windows.length ? windows.map(w => `${w.label}: ${w.checked ? `${w.positive} positive in ${w.checked} recent checks` : 'waiting for current checks'}`).join('. ') : 'Camera checks unavailable.';
  const title = `Last 5 checks per camera; the higher positive count is shown. Inspect image and Check print now count as positive. ${details}`;
  return `<span class="spaghetti-status ${tone}" title="${escape(title)}">Spaghetti detected ${best ? best.positive : '—'}/5</span>`;
}
function card(p) {
  const live = p.connected;
  const body = live ? `${p.error || p.rawState === 'error' ? `<p class="printer-error">${p.error ? `Printer error: ${escape(p.error)}` : 'Printer reports an error.'} · Check the printer screen.</p>` : ''}
    <p class="job">${escape(p.job || (p.rawState === 'ready' ? 'Ready for the next print' : p.state))}</p>
    <div class="time-remaining"><div><span class="help">${p.rawState === 'printing' ? 'Estimated time remaining' : 'Print timing'}</span><strong>${p.remaining !== null && p.remaining !== undefined ? time(p.remaining) : p.rawState === 'printing' ? 'Not available yet' : escape(p.state)}</strong>${p.remaining !== null && p.remaining !== undefined ? `<small>Printer estimate · Finish around ${escape(new Date(Date.parse(p.lastSeen) + p.remaining * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</small>` : ''}</div><span class="percent">${p.progress === null ? '—' : Math.round(p.progress) + '%'}</span></div>
    ${p.progress !== null ? `<progress value="${p.progress}" max="100" aria-label="${escape(p.name)} print progress"></progress>` : ''}
    <div class="job-meta"><span>${p.layer !== null && p.layers > 0 ? `Layer ${p.layer} / ${p.layers}` : 'No layer information'}</span><span>${p.remaining !== null && p.remaining !== undefined ? 'Estimate may change during printing' : 'Percentage is reported separately'}</span></div>
    <dl class="temps">${p.nozzles.map((n, i) => temperature(p.tools === 1 ? 'Nozzle' : `Tool ${i + 1}`, n)).join('')}${temperature('Bed', p.bed)}${p.chamber ? temperature('Chamber', p.chamber) : ''}${p.door ? `<div class="temp"><dt>Door / lid</dt><dd>${escape(p.door)}</dd></div>` : ''}</dl>`
    : `<div class="empty"><p>${escape(p.message)}</p>${!p.configured ? `<button data-settings="${p.id}">Connect printer</button>` : ''}${p.lastSeen ? `<small>Last seen ${escape(new Date(p.lastSeen).toLocaleString())}</small>` : ''}</div>`;
  const m = p.maintenance;
  const maintenance = `<div class="maintenance-block ${m.due ? 'due' : ''}"><div class="maintenance-heading"><strong>${m.due ? 'Maintenance due' : 'Maintenance'}</strong><button class="text-button" data-maintenance="${p.id}">Add task</button></div>
    ${m.schedules.length ? m.schedules.map(task => `<div class="maintenance-task ${task.due ? 'due' : ''}"><div class="maintenance-heading"><span>${escape(task.name)}${task.due ? ' · Due now' : ''}</span><button class="text-button" data-maintenance="${p.id}" data-task="${escape(task.id)}">Manage</button></div><p class="help">${[task.hours ? `Every ${task.hours} printing hours${task.hoursRemaining !== null ? ` · ${hoursLabel(task.hoursRemaining)} left` : ' · Tracking unavailable'}` : '', task.dueAt ? `Due ${new Date(task.dueAt).toLocaleDateString()}` : ''].filter(Boolean).join(' · ')}</p>${task.initialDueLifetimeHours != null ? `<p class="help">First due at ${task.initialDueLifetimeHours.toLocaleString()} total hours · No prior service recorded</p>` : ''}${task.lastServiced ? `<p class="help">Serviced ${new Date(task.lastServiced).toLocaleDateString()}</p>` : ''}</div>`).join('') : '<p>No reminders set</p>'}
    ${m.baseline ? `<div class="baseline-total"><strong>${hoursLabel(m.lifetimeHours)} total printing</strong><p class="help">Baseline + printing observed since ${escape(new Date(m.baseline.recordedAt).toLocaleDateString())}</p><details><summary>Machine baseline</summary><dl class="baseline-details"><dt>Printing counter</dt><dd>${hoursLabel(m.baseline.printingSeconds / 3600)}</dd><dt>Material counter</dt><dd>${m.baseline.materialCm.toLocaleString()} cm</dd><dt>Nozzles</dt><dd>${m.baseline.nozzleDiameters.map(n => `${n} mm`).join(' / ')}</dd><dt>Build volume</dt><dd>${m.baseline.buildVolume.join(' × ')} mm</dd><dt>Firmware</dt><dd>${escape(m.baseline.firmwareVersion)}</dd><dt>Serial number</dt><dd>${escape(m.baseline.serialNumber)}</dd></dl></details></div>` : ''}
    <p class="help">${m.hoursAvailable ? `${m.observedHours.toFixed(2)} printing hours observed since ${new Date(m.trackingSince).toLocaleDateString()}` : 'Print hours are not available for this printer yet.'}</p></div>`;
  return `<article class="card"><div class="card-top"><div><h2>${escape(p.name)}</h2><p class="model">${escape(p.model)}</p></div><div class="printer-status"><span class="badge ${p.health}">${escape(p.state)}</span>${spaghettiStatus(p)}</div></div><div class="card-body">${body}${maintenance}</div><div class="card-bottom"><span>${escape(p.host || 'Connection not set')}${p.transport ? ` · ${escape(p.transport)}` : ''}</span><button class="text-button" data-settings="${p.id}">Settings</button></div></article>`;
}
function renderHome(printers) {
  const hasEstimate = p => p.connected && p.rawState === 'printing' && Number.isFinite(p.remaining) && p.remaining >= 0;
  const ordered = [...printers].sort((a, b) => {
    const aTimed = hasEstimate(a), bTimed = hasEstimate(b);
    if (aTimed !== bTimed) return aTimed ? -1 : 1;
    return aTimed ? a.remaining - b.remaining : 0;
  });
  const dueCount = printers.reduce((count, p) => count + p.maintenance.schedules.filter(task => task.due).length, 0);
  $('#maintenance-due').textContent = dueCount;
  $('#home-maintenance').textContent = dueCount ? `${dueCount} maintenance ${dueCount === 1 ? 'task is' : 'tasks are'} due · Manage tasks in 3D printers.` : 'No maintenance tasks are due.';
  $('#home-maintenance').className = dueCount ? 'home-maintenance-due' : 'help';
  $('#completion-order').innerHTML = ordered.map((p, index) => {
    const timed = hasEstimate(p);
    const due = p.maintenance.schedules.filter(task => task.due);
    const finish = timed && Number.isFinite(Date.parse(p.lastSeen)) ? new Date(Date.parse(p.lastSeen) + p.remaining * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;
    return `<li class="completion-row"><span class="completion-rank" aria-label="${timed ? `Completion order ${index + 1}` : 'No completion estimate'}">${timed ? index + 1 : '—'}</span>
      <div class="completion-printer"><h3>${escape(p.name)}</h3><p class="printer-status"><span>${escape(p.connected ? p.state : 'Unavailable')}</span>${spaghettiStatus(p)}</p>${p.connected && p.job ? `<p class="completion-job">${escape(p.job)}</p>` : ''}</div>
      <div class="completion-time"><span class="help">${timed ? 'Estimated remaining' : 'Completion estimate'}</span><strong>${timed ? time(p.remaining) : p.connected && p.rawState === 'ready' ? 'No active print' : 'Not available'}</strong>${finish ? `<p>Finish around ${escape(finish)}</p>` : ''}</div>
      <div class="completion-maintenance ${due.length ? 'due' : ''}"><strong>${due.length ? 'Maintenance due' : 'Maintenance'}</strong>${due.length ? `<ul>${due.map(task => `<li>${escape(task.name)}</li>`).join('')}</ul>` : `<p>${p.maintenance.schedules.length ? 'No tasks due' : 'No reminders set'}</p>`}</div></li>`;
  }).join('');
}
function laserCard(p) {
  const supply = s => {
    const name = s.kind === 'toner' ? s.name.replace(/ Toner Cartridge$/i, '') : s.name;
    const status = s.status === 'Some remaining · amount not reported' ? 'Some remaining' : s.status;
    return `<li class="laser-supply ${s.low ? 'low' : ''}"><div class="supply-heading"><span class="supply-name"><span class="supply-dot ${escape(s.color)}" aria-hidden="true"></span>${escape(name)}</span><span>${escape(status)}</span></div>${s.percent !== null ? `<progress value="${s.percent}" max="100" aria-label="${escape(name)}: ${escape(status)}"></progress>` : ''}</li>`;
  };
  const toner = (p.supplies || []).filter(s => s.kind === 'toner');
  const maintenance = (p.supplies || []).filter(s => s.kind === 'maintenance');
  const body = p.connected ? `${p.alerts.length ? `<ul class="printer-error">${p.alerts.map(a => `<li>${escape(a)}</li>`).join('')}</ul>` : ''}
    <div class="laser-readings"><div><span class="help">Printer display</span><strong>${escape(p.display || p.state)}</strong></div><div><span class="help">${escape(p.pageCountLabel)}</span><strong>${p.pageCount === null ? '—' : p.pageCount.toLocaleString()}</strong></div></div>
    <h3 class="supply-title">Toner</h3>${toner.length ? `<ul class="laser-supplies">${toner.map(supply).join('')}</ul>` : '<p class="help">Toner levels are not reported.</p>'}
    ${maintenance.length ? `<h3 class="supply-title">Drums & other supplies</h3><ul class="laser-supplies">${maintenance.map(supply).join('')}</ul>` : ''}
    ${p.supplyMessage ? `<p class="help">${escape(p.supplyMessage)}</p>` : ''}`
    : `<div class="empty"><p>${escape(p.message)}</p></div>`;
  const seen = p.lastSeen ? `${p.connected ? 'Read' : 'Last reached'} ${new Date(p.lastSeen).toLocaleTimeString()}` : '';
  return `<article class="card laser-card"><div class="card-top"><div><h2>${escape(p.name)}</h2><p class="model">${p.color ? 'Color printer' : 'Monochrome all-in-one'}</p></div><span class="badge ${escape(p.health)}">${escape(p.state)}</span></div><div class="card-body">${body}</div><div class="card-bottom"><span>${escape(p.host || 'Connection not set')}${seen ? `<br>${escape(seen)}` : ''}</span><button class="text-button" data-settings="${escape(p.id)}">Settings</button></div></article>`;
}
function renderLaserQueues(printers) {
  $('#laser-queues').innerHTML = printers.map(p => {
    const q = p.queue;
    const jobs = q?.jobs || [];
    const label = q?.available ? jobs.length ? `${q.limited ? 'At least ' : ''}${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}` : 'Queue empty' : 'Queue unavailable';
    const progress = job => job.completed !== null ? `${job.completed}${job.total !== null ? ` / ${job.total}` : ''} ${job.unit} printed` : job.total !== null ? `${job.total} ${job.unit}` : 'Page count not reported';
    const body = !q?.available ? `<p class="help">${escape(q?.message || 'Waiting for queue status…')}</p>`
      : jobs.length ? `<ol class="queue-jobs">${jobs.map(job => `<li><div class="queue-job-heading"><strong>${escape(job.name)}</strong><span class="badge ${escape(job.health)}">${escape(job.state)}</span></div><p class="help">Job ${job.id} · ${escape(progress(job))}</p></li>`).join('')}</ol>${q.limited ? '<p class="help">Showing the first 100 jobs reported by the printer.</p>' : ''}`
      : '<p class="queue-empty">No queued jobs</p>';
    return `<article class="card queue-card"><div class="card-top"><h3>${escape(p.name)}</h3><span class="help">${escape(label)}</span></div><div class="card-body">${body}</div><div class="card-bottom"><span>${escape(p.host || 'Not configured')}</span><span>${q?.checkedAt ? `${q.available ? 'Read' : 'Checked'} ${escape(new Date(q.checkedAt).toLocaleTimeString())}` : 'Waiting for first reading'}</span></div></article>`;
  }).join('');
}
const cameraIds = ['ad5m', 'a5mp', 'c5', 'c5p'];
const internalCameraIds = ['a5mp', 'c5', 'c5p'];
const cameraViews = [...internalCameraIds.map(id => [id, '']), ...cameraIds.map(id => [id, 'tapo'])];
const cameraElement = (id, part, source = '') => document.getElementById(`camera-${id === 'ad5m' ? '' : id + '-'}${source === 'tapo' ? 'tapo-' : ''}${part}`);
function renderCamera(camera, id, source = '') {
  const element = part => cameraElement(id, part, source);
  if (source === 'tapo') {
    element('tile').hidden = !camera?.enabled;
    if (!camera?.enabled) return;
  }
  const c = camera || { state: 'unavailable', message: 'Restart the dashboard to enable camera detection.' };
  const labels = { clear: 'No spaghetti detected', suspect: 'Inspect image', warning: 'Check print now', starting: 'Starting', idle: 'Waiting for printing', unavailable: 'Unavailable', disabled: 'Not configured' };
  element('badge').textContent = labels[c.state] || 'Unavailable';
  element('badge').className = `badge ${c.state === 'clear' ? 'ok' : ['warning', 'suspect'].includes(c.state) ? 'warning' : 'unknown'}`;
  element('message').textContent = c.message;
  element('detail').textContent = `${c.frames || 0} images checked this session · ${c.checking ? 'Checking a new image…' : 'Checks about every 20–25 seconds while printing.'}`;
  element('timestamp').textContent = c.capturedAt ? `Last analyzed image: ${new Date(c.capturedAt).toLocaleString()}` : 'No image analyzed yet.';
  if (element('air')) element('air').textContent = c.airPrinting?.message || 'Filament flow has not been checked.';
  const img = element('image');
  if (c.imageUrl && img.getAttribute('src') !== c.imageUrl) img.src = c.imageUrl;
  img.hidden = !c.imageUrl;
  element('placeholder').hidden = Boolean(c.imageUrl);
  element('history').innerHTML = (c.history || []).slice(0, 5).map(h => `<li><time>${escape(new Date(h.capturedAt).toLocaleTimeString())}</time><span>${escape(labels[h.state])}</span></li>`).join('');
}
for (const [id, source] of cameraViews) {
  const element = part => cameraElement(id, part, source);
  element('image').addEventListener('error', () => {
    element('image').hidden = true;
    element('placeholder').hidden = false;
    element('placeholder').textContent = 'The last analyzed image could not be loaded.';
  });
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const data = await api('/api/printers');
    localTools = location.hostname === 'localhost' && data.capabilities?.localTools === true;
    $('#add-print').hidden = !localTools;
    $('#tab-job').hidden = !localTools;
    $('#gcode-file').disabled = !localTools;
    if (!localTools && !$('#panel-job').hidden) selectView(viewTabs[0]);
    const printers = data.printers;
    latestPrinters = printers;
    latestCameras = data.cameras || {};
    latestExternalCameras = data.externalCameras || {};
    for (const id of internalCameraIds) renderCamera(data.cameras?.[id], id);
    for (const id of cameraIds) renderCamera(data.externalCameras?.[id], id, 'tapo');
    renderHeight(data.cameras?.a5mp?.airPrinting, localTools);
    renderHome(printers);
    renderLaserQueues(data.laserPrinters || []);
    const cloudCount = printers.filter(p => p.connected && p.transport?.startsWith('Flashforge cloud')).length;
    $('#cloud-state').textContent = data.cloud?.connected && cloudCount ? '' : data.cloud?.message || 'Cloud connection unavailable.';
    latestHistory = data.history || [];
    renderHistory();
    const focused = document.activeElement?.dataset?.settings;
    const focusedMaintenance = document.activeElement?.dataset?.maintenance;
    $('#printers').innerHTML = printers.map(card).join('');
    $('#laser-printers').innerHTML = data.laserPrinters ? data.laserPrinters.map(laserCard).join('') : '<p class="help">Restart the dashboard service to load laser printer status.</p>';
    if (focused && !dialog.open) document.querySelector(`[data-settings="${focused}"]`)?.focus({ preventScroll: true });
    if (focusedMaintenance && !maintenanceDialog.open) document.querySelector(`[data-maintenance="${focusedMaintenance}"]`)?.focus({ preventScroll: true });
    $('#online').innerHTML = `${printers.filter(p => p.connected).length}<small> / 4</small>`;
    $('#printing').textContent = printers.filter(p => p.connected && p.rawState === 'printing').length;
    $('#attention').textContent = printers.filter(p => p.maintenance.due || (p.connected && ['error', 'warning'].includes(p.health)) || ['suspect', 'warning'].includes(data.cameras?.[p.id]?.airPrinting?.state) || ['suspect', 'warning'].includes(data.externalCameras?.[p.id]?.state) || (['suspect', 'warning'].includes(data.cameras?.[p.id]?.state || (p.id === 'ad5m' ? data.camera?.state : null)))).length;
    $('#unavailable').textContent = printers.filter(p => !p.connected).length;
    $('#updated').textContent = `Updated ${new Date(data.checkedAt).toLocaleTimeString()}`;
    $('#updated').dataset.status = 'updated';
    $('#connection-error').hidden = true;
    $('#storage-error').textContent = data.storageError || '';
    $('#storage-error').hidden = !data.storageError;
  } catch {
    for (const indicator of document.querySelectorAll('.spaghetti-status')) {
      indicator.textContent = 'Spaghetti detected —/5';
      indicator.className = 'spaghetti-status unknown';
      indicator.title = 'Dashboard disconnected. Waiting for current camera checks.';
    }
    renderHeight(null, false);
    for (const [id, source] of cameraViews) {
      const element = part => cameraElement(id, part, source);
      element('badge').textContent = 'Unavailable';
      element('badge').className = 'badge unknown';
      element('message').textContent = 'Dashboard disconnected. The image and detection result are stale.';
      if (element('air')) element('air').textContent = 'Air printing: printer status unavailable.';
    }
    $('#connection-error').textContent = 'Dashboard service disconnected. Readings below are stale. Restart the app on this Mac to reconnect.';
    $('#connection-error').hidden = false;
    $('#updated').textContent = 'Updates stopped';
    $('#updated').dataset.status = 'stopped';
    for (const id of ['online', 'printing', 'attention', 'unavailable', 'maintenance-due']) $(`#${id}`).textContent = '—';
  } finally {
    for (const id of ['attention', 'unavailable', 'maintenance-due']) {
      const count = $(`#${id}`);
      count.classList.toggle('count-alert', Number(count.textContent) > 0);
    }
    refreshing = false;
  }
}
async function openPrinterSettings(event) {
  const button = event.target.closest('[data-settings]');
  if (!button) return;
  selected = button.dataset.settings;
  const printerId = selected;
  form.reset();
  const laser = ['mfc_l2710dw', 'hl_l3270cdw'].includes(selected);
  $('#settings-title').textContent = `${({ ad5m: 'AD5M', a5mp: 'A5MP', c5: 'C5', c5p: 'C5P', mfc_l2710dw: 'MFC-L2710DW', hl_l3270cdw: 'HL-L3270CDW' })[selected]} connection`;
  $('#form-error').textContent = '';
  $('#save').disabled = true;
  $('#connection-help').textContent = laser ? 'Enter this Brother printer’s LAN IP address. Local monitoring requires SNMP read access with the community name public. No Brother cloud account is needed.' : 'Keep cloud enabled. Cloud status uses your signed-in Flash Studio session on this Mac. The IP address matches each cloud report to its printer. Adventurers also have a local fallback.';
  dialog.showModal();
  try {
    const data = await api(`/api/printers/${printerId}/settings`);
    if (selected !== printerId || !dialog.open) return;
    $('#host').value = data.host;
    $('#save').disabled = false;
  } catch { $('#form-error').textContent = 'Could not load settings. Check that the dashboard service is running.'; }
}
$('#printers').addEventListener('click', openPrinterSettings);
$('#laser-printers').addEventListener('click', openPrinterSettings);
function close() { dialog.close(); selected = null; form.reset(); }
$('#close').addEventListener('click', close);
$('#cancel').addEventListener('click', close);
dialog.addEventListener('cancel', () => { selected = null; form.reset(); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  $('#save').disabled = true;
  $('#form-error').textContent = '';
  try {
    await api(`/api/printers/${selected}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: $('#host').value.trim() }) });
    close();
    await refresh();
  } catch (error) { $('#form-error').textContent = error.message; }
  finally { $('#save').disabled = false; }
});
$('#printers').addEventListener('click', event => {
  const button = event.target.closest('[data-maintenance]');
  if (!button) return;
  const printer = latestPrinters.find(p => p.id === button.dataset.maintenance);
  if (!printer) return;
  maintenanceId = printer.id;
  maintenanceTaskId = button.dataset.task || null;
  const schedule = printer.maintenance.schedules.find(s => s.id === maintenanceTaskId);
  const { hoursAvailable } = printer.maintenance;
  $('#maintenance-title').textContent = `${printer.name} maintenance`;
  $('#maintenance-name').value = schedule?.name || '';
  $('#maintenance-hours').value = schedule?.hours || '';
  $('#maintenance-days').value = schedule?.days || '';
  $('#maintenance-hours').disabled = !hoursAvailable;
  $('#maintenance-help').textContent = hoursAvailable ? 'Hours count only while this app is running and receiving printing status. Earlier use and time offline are not included.' : 'Calendar reminders work now. Printing hours cannot be counted until live monitoring is connected.';
  $('#maintenance-error').textContent = '';
  $('#mark-serviced').hidden = !schedule;
  maintenanceDialog.showModal();
});
$('#maintenance-close').addEventListener('click', () => maintenanceDialog.close());
async function saveMaintenance(serviced = false) {
  $('#maintenance-save').disabled = true;
  $('#mark-serviced').disabled = true;
  $('#maintenance-error').textContent = '';
  try {
    const value = serviced ? { id: maintenanceTaskId } : { id: maintenanceTaskId, name: $('#maintenance-name').value, hours: $('#maintenance-hours').disabled ? null : $('#maintenance-hours').value, days: $('#maintenance-days').value };
    await api(`/api/printers/${maintenanceId}/${serviced ? 'serviced' : 'maintenance'}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    maintenanceDialog.close();
    await refresh();
  } catch (error) { $('#maintenance-error').textContent = error.message; }
  finally { $('#maintenance-save').disabled = false; $('#mark-serviced').disabled = false; }
}
$('#maintenance-form').addEventListener('submit', event => { event.preventDefault(); void saveMaintenance(); });
$('#mark-serviced').addEventListener('click', () => { void saveMaintenance(true); });
const clockTime = seconds => {
  if (seconds === null || seconds === undefined) return '—';
  const n = Math.round(seconds);
  return `${Math.floor(n / 3600)}:${String(Math.floor(n % 3600 / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
};
function readDuration(value) {
  if (!value.trim()) return null;
  if (!/^\d{1,4}:[0-5]\d:[0-5]\d$/.test(value.trim())) throw new Error('Enter durations as hours:minutes:seconds, for example 7:37:55.');
  const [h, m, s] = value.trim().split(':').map(Number);
  if (h * 3600 + m * 60 + s === 0) throw new Error('A duration must be greater than zero.');
  return h * 3600 + m * 60 + s;
}
function renderHistory() {
  const focused = document.activeElement?.dataset?.timing;
  const comparisons = latestHistory.filter(r => r.deltaSeconds !== null);
  $('#history-summary').textContent = `${latestHistory.length} print records · ${comparisons.length} completed comparisons. Live prints are tracked while connected. Add earlier prints manually.`;
  if (!latestHistory.length) { $('#print-history').innerHTML = '<p class="help">Prints will appear when detected. You can also add a past print with its estimate and actual duration.</p>'; return; }
  const states = { active: 'In progress · last observed', completed: 'Completed', unknown: 'Outcome unconfirmed', cancelled: 'Cancelled', failed: 'Failed' };
  $('#print-history').innerHTML = `<div class="table-scroll"><table><caption>Times shown as hours:minutes:seconds. Observed durations are approximate to the polling interval.</caption><thead><tr><th>Print</th><th>Outcome / coverage</th><th>Slicer estimate</th><th>Actual total</th><th>Difference</th><th>Timing</th></tr></thead><tbody>${latestHistory.map(r => {
    const printer = latestPrinters.find(p => p.id === r.printerId);
    const delta = r.deltaSeconds;
    return `<tr><td class="history-job"><strong>${escape(printer?.name || r.printerId)}</strong><small>${escape(r.job)}</small><small>${escape(new Date(r.firstSeenAt).toLocaleString())}${r.origin === 'monitor' ? ' · First seen' : ' · Ended'}</small></td>
      <td>${escape(states[r.effectiveStatus] || r.effectiveStatus)}${r.origin === 'monitor' ? `<small>${!r.startedAt ? 'Start not observed' : 'Start observed'}${r.hasGap ? ' · Monitoring gap' : ''}</small>` : '<small>Manual record</small>'}${r.status === 'active' ? `<small>Last seen ${escape(new Date(r.lastSeenAt).toLocaleString())}</small>` : ''}</td>
      <td>${clockTime(r.estimate?.seconds)}${r.estimate ? `<small>${r.estimate.source === 'gcode' ? escape(r.estimate.generatedBy) : 'Entered manually'}</small>` : ''}</td>
      <td>${r.actualSeconds !== null ? `${r.actualSource === 'observed' ? '≈ ' : ''}${clockTime(r.actualSeconds)}<small>${r.actualSource === 'manual' ? 'Entered manually' : 'Observed, including pauses'}</small>` : `—${r.origin === 'monitor' ? `<small>${clockTime(r.observedSpanSeconds)} observation span; total unknown</small>` : ''}`}</td>
      <td>${delta === null ? '—' : `${delta === 0 ? '' : delta > 0 ? '+' : '−'}${clockTime(Math.abs(delta))}<small>${Math.abs(r.deltaPercent).toFixed(1)}% ${delta > 0 ? 'longer' : delta < 0 ? 'shorter' : 'difference'}</small>`}</td>
      <td><button class="text-button" data-timing="${r.id}">${r.estimate ? 'Edit timing' : 'Add estimate'}</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
  if (focused && !timingDialog.open) document.querySelector(`[data-timing="${focused}"]`)?.focus({ preventScroll: true });
}
function openTiming(run = null) {
  timingVersion++;
  timingId = run?.id || null;
  timingSource = run?.estimate?.source === 'gcode' ? { filename: run.estimate.filename, generatedBy: run.estimate.generatedBy } : null;
  $('#timing-form').reset();
  $('#timing-title').textContent = run ? 'Print timing' : 'Add past print';
  $('#timing-job').textContent = run ? `${latestPrinters.find(p => p.id === run.printerId)?.name || run.printerId} · ${run.job}` : 'Record a finished print, including prints from before monitoring began.';
  $('#manual-print-fields').hidden = Boolean(run);
  $('#timing-name').required = !run;
  $('#timing-date').required = !run;
  const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  $('#timing-date').value = localDate.toISOString().slice(0, 16);
  $('#timing-estimate').value = run?.estimate ? clockTime(run.estimate.seconds) : '';
  $('#timing-actual').value = run?.actualOverrideSeconds != null ? clockTime(run.actualOverrideSeconds) : '';
  $('#timing-actual').disabled = run?.status === 'active';
  $('#timing-actual').required = !run;
  $('#timing-outcome').disabled = run?.status === 'active';
  $('#timing-outcome').value = run ? run.outcomeOverride || '' : 'completed';
  $('#timing-help').textContent = run?.status === 'active' ? 'Total actual time and outcome become editable after this print ends.' : run ? `${run.notes.join(' ')} Leave actual total blank to use observed timing where available. Confirm completion only if you know the print succeeded.` : 'Enter total elapsed time, including pauses. The date records when the print ended.';
  $('#timing-source').textContent = timingSource ? `Estimate from ${timingSource.filename} · ${timingSource.generatedBy}` : 'Choose the sliced file for this specific print, or enter its estimate below.';
  $('#timing-error').textContent = '';
  $('#timing-save').disabled = false;
  timingDialog.showModal();
}
$('#add-print').addEventListener('click', () => { if (localTools) openTiming(); });
$('#print-history').addEventListener('click', event => {
  const button = event.target.closest('[data-timing]');
  const run = button && latestHistory.find(r => r.id === button.dataset.timing);
  if (run) openTiming(run);
});
$('#timing-close').addEventListener('click', () => { timingVersion++; timingDialog.close(); });
timingDialog.addEventListener('cancel', () => { timingVersion++; });
$('#timing-estimate').addEventListener('input', () => { timingSource = null; $('#timing-source').textContent = 'Estimate entered manually.'; });
$('#timing-file').addEventListener('change', async event => {
  const version = ++timingVersion;
  const file = event.target.files[0];
  if (!file) return;
  $('#timing-error').textContent = '';
  $('#timing-save').disabled = true;
  try {
    if (!/\.gcode$/i.test(file.name)) throw new Error('Choose a Flash Studio .gcode export.');
    const text = await file.slice(0, HEADER_LIMIT).text();
    if (version !== timingVersion) return;
    const estimate = readTimeEstimate(text, file.name);
    timingSource = { filename: estimate.filename, generatedBy: estimate.generatedBy };
    $('#timing-estimate').value = clockTime(estimate.seconds);
    $('#timing-source').textContent = `Estimate from ${estimate.filename} · ${estimate.generatedBy}. Saving attaches it to the print shown above.`;
    if (!timingId && !$('#timing-name').value) $('#timing-name').value = file.name;
  } catch (error) { if (version === timingVersion) $('#timing-error').textContent = error.message; }
  finally { if (version === timingVersion) $('#timing-save').disabled = false; }
});
$('#timing-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!timingId && !localTools) return;
  $('#timing-save').disabled = true;
  $('#timing-error').textContent = '';
  try {
    const value = { estimateSeconds: readDuration($('#timing-estimate').value), estimateSource: timingSource,
      actualSeconds: $('#timing-actual').disabled ? null : readDuration($('#timing-actual').value), outcome: $('#timing-outcome').disabled ? null : $('#timing-outcome').value || null };
    if (!timingId) Object.assign(value, { printerId: $('#timing-printer').value, job: $('#timing-name').value, printedAt: new Date($('#timing-date').value).toISOString() });
    await api(timingId ? `/api/history/${timingId}` : '/api/history', { method: timingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    timingVersion++;
    timingDialog.close();
    await refresh();
  } catch (error) { $('#timing-error').textContent = error.message; }
  finally { $('#timing-save').disabled = false; }
});
let inspectionVersion = 0;
$('#gcode-file').addEventListener('change', async event => {
  if (!localTools) return;
  const version = ++inspectionVersion;
  const file = event.target.files[0];
  $('#job-error').textContent = '';
  $('#job-report').replaceChildren();
  if (!file) return;
  try {
    if (!/\.gcode$/i.test(file.name)) throw new Error('Choose a .gcode file exported by Flash Studio.');
    const text = await file.slice(0, HEADER_LIMIT).text();
    if (version !== inspectionVersion) return;
    const report = inspectGcode(text, file.name);
    const grams = n => n === null ? 'Unknown' : `${n.toFixed(2)} g`;
    $('#job-report').innerHTML = `<h3>${escape(report.filename)}</h3><p>${escape(report.printer || 'Unknown printer')} · ${escape(report.estimatedTime || 'Unknown time')} · ${report.layers ?? 'Unknown'} layers</p>
      <p class="job-hold">${report.metadataComplete ? 'Requirements extracted · Inventory not verified' : 'Cannot verify requirements'}</p>
      <div class="table-scroll"><table><caption>Per-channel requirements from the sliced file</caption><thead><tr><th>Channel</th><th>Material / color</th><th>Summary estimate</th><th>Filament record</th><th>Available</th></tr></thead><tbody>${report.channels.map(c => `<tr><td>${c.channel}</td><td>${escape(c.material)} · ${escape(c.color)}<small>${escape(c.profile || '')}</small></td><td>${grams(c.summaryGrams)}</td><td>${grams(c.recordGrams)}</td><td>Not measured</td></tr>`).join('')}</tbody></table></div>
      <p>Declared total: <strong>${grams(report.totalGrams)}</strong></p>
      ${report.issues.length ? `<ul class="error-text">${report.issues.map(s => `<li>${escape(s)}</li>`).join('')}</ul>` : ''}
      ${report.warnings.length ? `<ul class="job-warnings">${report.warnings.map(s => `<li>${escape(s)}</li>`).join('')}</ul>` : ''}
      <p class="help">${escape(report.limitation)} Higher estimates are a starting point for planning, not a verified minimum supply.</p>`;
  } catch (error) { if (version === inspectionVersion) $('#job-error').textContent = error.message; }
});
$('#cloud-reconnect').addEventListener('click', async () => {
  $('#cloud-reconnect').disabled = true;
  try { await api('/api/cloud/reconnect', { method: 'POST' }); await refresh(); }
  catch (error) { $('#cloud-state').textContent = error.message; }
  finally { $('#cloud-reconnect').disabled = false; }
});
initHeight(api, refresh);
void refresh();
setInterval(refresh, 5000);
