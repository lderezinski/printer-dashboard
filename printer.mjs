export const MODELS = [
  { id: 'ad5m', name: 'AD5M', model: 'Adventurer 5M', tools: 1, defaultHost: '192.168.50.101' },
  { id: 'a5mp', name: 'A5MP', model: 'Adventurer 5M Pro', tools: 1, defaultHost: '192.168.50.102' },
  { id: 'c5', name: 'C5', model: 'Creator 5', tools: 4, defaultHost: '192.168.50.10152' },
  { id: 'c5p', name: 'C5P', model: 'Creator 5 Pro', tools: 4, defaultHost: '192.168.50.10154' },
];

export function number(value) {
  if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

export function normalize(detail, printer) {
  const rawState = typeof detail.status === 'string' ? detail.status.toLowerCase() : 'unknown';
  const labels = { ready: 'Ready', printing: 'Printing', pause: 'Paused', paused: 'Paused', error: 'Error', completed: 'Completed', heating: 'Heating', busy: 'Busy', pausing: 'Pausing', canceling: 'Canceling', cancel: 'Canceling', calibrate_doing: 'Calibrating', downloading: 'Downloading', cloud_slicing: 'Slicing', sending: 'Sending', unzipping: 'Unzipping' };
  const errorCode = String(detail.errorCode ?? '').trim();
  const error = errorCode && !/^0+$/.test(errorCode) ? errorCode : null;
  const progress = number(detail.printProgress);
  const active = ['printing', 'pause', 'paused', 'heating', 'pausing', 'error', 'completed'].includes(rawState);
  return {
    state: labels[rawState] || `Unknown (${rawState})`, rawState,
    health: error || rawState === 'error' ? 'error' : ['pause', 'paused', 'pausing'].includes(rawState) ? 'warning' : labels[rawState] ? 'ok' : 'unknown',
    error, job: active && typeof detail.printFileName === 'string' ? detail.printFileName : '',
    progress: active && progress !== null ? Math.min(100, progress * 100) : null,
    remaining: rawState === 'printing' ? number(detail.estimatedTime) : null,
    layer: active ? number(detail.printLayer) : null,
    layers: active ? number(detail.targetPrintLayer) : null,
    nozzles: Array.from({ length: printer.tools }, (_, i) => ({
      current: number(printer.tools === 1 ? detail.rightTemp : detail.nozzleTemps?.[i]),
      target: number(printer.tools === 1 ? detail.rightTargetTemp : detail.nozzleTargetTemps?.[i]),
    })),
    bed: { current: number(detail.platTemp), target: number(detail.platTargetTemp) },
    chamber: printer.id === 'c5p' ? { current: number(detail.chamberTemp), target: number(detail.chamberTargetTemp) } : null,
    door: printer.id === 'c5p' && ['open', 'close'].includes(detail.doorStatus) ? (detail.doorStatus === 'open' ? 'Open' : 'Closed') : null,
    firmware: typeof detail.firmwareVersion === 'string' ? detail.firmwareVersion : null,
  };
}

export function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings.');
  const { host = '', serialNumber = '', checkCode = '' } = value;
  if (![host, serialNumber, checkCode].every(v => typeof v === 'string' && v.length <= 128)) throw new Error('Invalid settings.');
  if (host) {
    const parts = host.split('.');
    if (parts.length !== 4 || parts.some(p => !/^(0|[1-9]\d{0,2})$/.test(p) || Number(p) > 255)) throw new Error('Enter the printer’s LAN IPv4 address, such as 192.168.1.50.');
    const [a, b] = parts.map(Number);
    if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) throw new Error('Use a private LAN address (10.x, 172.16–31.x, or 192.168.x).');
  }
  return { host, serialNumber: serialNumber.trim(), checkCode: checkCode.trim() };
}

export async function readPrinter(config, printer, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`http://${config.host}:8898/detail`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber: config.serialNumber, checkCode: config.checkCode }),
      signal: AbortSignal.timeout(3500), redirect: 'error',
    });
  } catch {
    throw new Error('Unreachable. Check power, LAN address, and that this Mac is on the same network.');
  }
  if (!response.ok) throw new Error(`Printer returned HTTP ${response.status}.`);
  let payload;
  try { payload = await response.json(); } catch { throw new Error('Printer returned an unreadable response.'); }
  if (!payload || typeof payload !== 'object') throw new Error('Unexpected printer response.');
  if (payload.code === -2) throw new Error('Enable LAN mode on the printer.');
  if (payload.code === 1) throw new Error('Access denied. Check the serial number and LAN access code.');
  if (payload.code !== 0) throw new Error('Printer rejected the status request. Check LAN mode and connection settings.');
  if (!payload.detail || typeof payload.detail !== 'object' || Array.isArray(payload.detail) || typeof payload.detail.status !== 'string') throw new Error('Printer response is missing status details.');
  return normalize(payload.detail, printer);
}
