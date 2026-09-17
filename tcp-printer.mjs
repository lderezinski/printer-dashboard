// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import net from 'node:net';
import { normalize, validateConfig } from './printer.mjs';

const COMMANDS = ['M119', 'M27', 'M105', 'M119'];

export function parseTcp(responses, printer) {
  const [before, progress, temperatures, after] = responses;
  const field = (text, name) => text.match(new RegExp(`^${name}:\\s*([^\\r\\n]*)`, 'm'))?.[1]?.trim();
  const state = field(after, 'MachineStatus');
  if (!state) throw new Error('Printer response is missing its state.');
  const states = { READY: 'ready', IDLE: 'ready', BUILDING_FROM_SD: 'printing', PRINTING: 'printing', BUILDING: 'printing', BUILDING_COMPLETED: 'completed', COMPLETED: 'completed', PAUSED: 'pause', PAUSE: 'pause', BUSY: 'busy', ERROR: 'error', HEATING: 'heating' };
  const detail = { status: states[state] || state.toLowerCase(), printFileName: field(after, 'CurrentFile') || '' };
  if (field(after, 'MoveMode') === 'PAUSED' && detail.status === 'printing') detail.status = 'pause';
  // A job can change while the three read-only commands are in flight.
  const sameJob = field(before, 'CurrentFile') === detail.printFileName && field(before, 'MachineStatus') === state;
  const bytes = progress.match(/SD printing byte\s+(\d+)\s*\/\s*(\d+)/i);
  const layers = progress.match(/Layer:\s*(\d+)\s*\/\s*(\d+)/i);
  if (sameJob && bytes && Number(bytes[2]) > 0 && Number(bytes[1]) <= Number(bytes[2])) detail.printProgress = Number(bytes[1]) / Number(bytes[2]);
  if (sameJob && layers) { detail.printLayer = Number(layers[1]); detail.targetPrintLayer = Number(layers[2]); }
  for (const [key, current, target] of [['T0', 'rightTemp', 'rightTargetTemp'], ['B', 'platTemp', 'platTargetTemp']]) {
    const match = temperatures.match(new RegExp(`\\b${key}:\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\/\\s*(-?\\d+(?:\\.\\d+)?)`));
    if (match) { detail[current] = Number(match[1]); detail[target] = Number(match[2]); }
  }
  return { ...normalize(detail, printer), transport: 'Local status · Cloud stays enabled' };
}

export function readTcpPrinter(config, printer, connect = net.createConnection) {
  validateConfig(config);
  if (printer.tools !== 1) return Promise.reject(new Error('This printer has no compatible TCP status service.'));
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.host, port: 8899 });
    let buffer = '', index = 0, settled = false;
    const responses = [];
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Status request timed out. Check power and network connection.')), 4000);
    socket.setEncoding('utf8');
    socket.on('error', () => finish(new Error('Unreachable. Check power, LAN address, and this Mac’s network connection.')));
    socket.on('end', () => finish(new Error('Printer closed the status connection before replying.')));
    socket.on('connect', () => socket.write(`~${COMMANDS[index]}\r\n`));
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 16384) return finish(new Error('Unexpectedly large printer response.'));
      const end = buffer.match(/(?:^|\r?\n)ok\r?\n/);
      if (!end) return;
      const response = buffer.slice(0, end.index + end[0].length);
      if (!response.includes(`CMD ${COMMANDS[index]} Received.`)) return finish(new Error('Unexpected printer status response.'));
      responses.push(response);
      buffer = buffer.slice(end.index + end[0].length);
      index++;
      if (index === COMMANDS.length) {
        try { finish(null, parseTcp(responses, printer)); } catch (error) { finish(error); }
      } else socket.write(`~${COMMANDS[index]}\r\n`);
    });
  });
}
