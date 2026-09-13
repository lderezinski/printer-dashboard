import snmp from 'net-snmp';
import { validateConfig } from './printer.mjs';

export const LASER_MODELS = [
  { id: 'mfc_l2710dw', name: 'MFC-L2710DW', model: 'Brother MFC-L2710DW', color: false },
  { id: 'hl_l3270cdw', name: 'HL-L3270CDW', model: 'Brother HL-L3270CDW', color: true },
];

// Standard Host Resources MIB and Printer MIB (RFC 2790 / RFC 3805).
export const OIDS = {
  model: '1.3.6.1.2.1.25.3.2.1.3.1',
  deviceStatus: '1.3.6.1.2.1.25.3.2.1.5.1',
  status: '1.3.6.1.2.1.25.3.5.1.1.1',
  errors: '1.3.6.1.2.1.25.3.5.1.2.1',
  counterUnit: '1.3.6.1.2.1.43.10.2.1.3.1.1',
  counter: '1.3.6.1.2.1.43.10.2.1.4.1.1',
  display: '1.3.6.1.2.1.43.16.5.1.2.1.1',
};
export const SUPPLIES_OID = '1.3.6.1.2.1.43.11.1.1';
const errorLabels = ['Paper low', 'Out of paper', 'Toner low', 'Out of toner', 'Cover open', 'Paper jam', 'Printer offline', 'Service requested', 'Input tray missing', 'Output tray missing', 'Supply missing', 'Output tray nearly full', 'Output tray full', 'Input tray empty', 'Maintenance overdue'];
const warningBits = new Set([0, 2, 7, 11, 14]);
const asText = value => Buffer.isBuffer(value) ? value.toString('utf8').replace(/\0/g, '').trim() : typeof value === 'string' ? value.trim() : '';

export function normalizeBrother(values, printer) {
  const model = asText(values[OIDS.model]);
  if (!model.toLowerCase().includes(printer.model.toLowerCase())) throw new Error(`Expected ${printer.model}, but this address reports ${model || 'an unidentified device'}. Check Settings.`);
  const code = values[OIDS.status];
  if (!Number.isInteger(code) || code < 1 || code > 5) throw new Error('Printer did not report a valid status.');
  const bits = Buffer.isBuffer(values[OIDS.errors]) ? values[OIDS.errors] : Buffer.alloc(0);
  const activeBits = errorLabels.flatMap((_, i) => bits[Math.floor(i / 8)] & (0x80 >> (i % 8)) ? [i] : []);
  const alerts = activeBits.map(i => errorLabels[i]);
  let health = activeBits.some(i => !warningBits.has(i)) || values[OIDS.deviceStatus] === 5 ? 'error'
    : alerts.length || values[OIDS.deviceStatus] === 3 || values[OIDS.deviceStatus] === 4 ? 'warning' : code < 3 ? 'unknown' : 'ok';
  const display = asText(values[OIDS.display]);
  let state = ({ 1: 'Other', 2: 'Unknown', 3: 'Ready', 4: 'Printing', 5: 'Warming up' })[code];
  if (code === 3 && /sleep/i.test(display)) state = 'Sleep';
  if (health === 'error') state = 'Needs attention';
  if (!alerts.length && values[OIDS.deviceStatus] === 5) alerts.push('Printer reports a fault. Check its screen.');
  const rows = new Map();
  for (const [oid, value] of Object.entries(values)) {
    if (!oid.startsWith(`${SUPPLIES_OID}.`)) continue;
    const [column, ...index] = oid.slice(SUPPLIES_OID.length + 1).split('.');
    const key = index.join('.');
    if (!rows.has(key)) rows.set(key, {});
    rows.get(key)[column] = value;
  }
  const supplies = [...rows.entries()].filter(([, row]) => asText(row[6])).map(([id, row]) => {
    const name = asText(row[6]);
    const level = Number.isFinite(row[9]) ? row[9] : null;
    const maximum = Number.isFinite(row[8]) ? row[8] : null;
    const receptacle = row[4] === 4;
    const percent = level !== null && level >= 0 && maximum > 0 ? Math.min(100, Math.round(level / maximum * 100)) : null;
    const status = level === -3 ? (receptacle ? 'Space available · amount not reported' : 'Some remaining · amount not reported')
      : level === 0 ? (receptacle ? 'Full' : 'Empty') : percent !== null ? `${percent}% ${receptacle ? 'space ' : ''}remaining` : 'Level not reported';
    const color = /cyan/i.test(name) ? 'cyan' : /magenta/i.test(name) ? 'magenta' : /yellow/i.test(name) ? 'yellow' : /black/i.test(name) ? 'black' : 'neutral';
    return { id, name, percent, status, color, kind: row[5] === 3 ? 'toner' : 'maintenance', low: level === 0 || (percent !== null && percent <= 10) };
  });
  if (health === 'ok' && supplies.some(s => s.low)) health = 'warning';
  const counter = values[OIDS.counter];
  const unit = values[OIDS.counterUnit];
  return { reportedModel: model, state, rawState: code === 4 ? 'printing' : 'ready', health, display, alerts, supplies,
    pageCount: Number.isFinite(counter) && counter >= 0 && [7, 8].includes(unit) ? counter : null,
    pageCountLabel: unit === 8 ? 'Sheets printed' : 'Impressions printed', transport: 'Local SNMP' };
}

export function readBrotherPrinter(config, printer, createSession = snmp.createSession) {
  validateConfig(config);
  if (!config.host) return Promise.reject(new Error('Enter the printer’s IP address in Settings.'));
  return new Promise((resolve, reject) => {
    const session = createSession(config.host, 'public', { version: snmp.Version2c, timeout: 1800, retries: 0, transport: 'udp4' });
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      session.close();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Printer status timed out. Check power, the IP address, and SNMP access.')), 10000);
    session.on('error', () => finish(new Error('Unable to reach the printer. Check its network connection.')));
    const values = {};
    const collect = varbinds => {
      for (const entry of varbinds) if (!snmp.isVarbindError(entry)) values[entry.oid] = entry.value;
    };
    session.get(Object.values(OIDS), (error, varbinds) => {
      if (finished) return;
      if (error) return finish(new Error('Printer did not respond. Check power, the IP address, and SNMP read access (community: public).'));
      collect(varbinds);
      try { normalizeBrother(values, printer); } catch (error) { return finish(error); }
      let count = 0;
      const completeSupplies = error => {
        if (finished) return;
        try {
          if (error) for (const oid of Object.keys(values)) if (oid.startsWith(`${SUPPLIES_OID}.`)) delete values[oid];
          finish(null, { ...normalizeBrother(values, printer), supplyMessage: error ? 'Supply readings could not be retrieved.' : '' });
        } catch (error) { finish(error); }
      };
      // These Brother firmwares answer GETNEXT but time out on GETBULK.
      const next = oid => session.getNext([oid], (error, entries) => {
        if (finished) return;
        if (error) return completeSupplies(error);
        const entry = entries?.[0];
        if (!entry || snmp.isVarbindError(entry) || !entry.oid.startsWith(`${SUPPLIES_OID}.`)) return completeSupplies();
        if (++count > 300 || Object.hasOwn(values, entry.oid)) return completeSupplies(new Error('Invalid supply table.'));
        collect(entries);
        next(entry.oid);
      });
      next(SUPPLIES_OID);
    });
  });
}
