// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import { networkInterfaces } from 'node:os';
import { isIPv4 } from 'node:net';

export function isPrivateIPv4(address) {
  if (!isIPv4(address)) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function lanAddresses(interfaces = networkInterfaces()) {
  return [...new Set(Object.values(interfaces).flat().filter(entry =>
    !entry.internal && entry.family === 'IPv4' && isPrivateIPv4(entry.address)
  ).map(entry => entry.address))];
}

export function canUseLocalTools(req, port) {
  const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '');
  return peer === '127.0.0.1' && req.headers.host === `localhost${port === 80 ? '' : `:${port}`}`;
}

export function requestAccessError(req, port, addresses = lanAddresses(), { allowLanReadOnly = false } = {}) {
  if (Object.keys(req.headers).some(key => key === 'forwarded' || key === 'x-real-ip' || key.startsWith('x-forwarded-'))) return 'Proxied dashboard requests are not supported.';
  const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '') || '';
  if (peer !== '127.0.0.1' && !(allowLanReadOnly && isPrivateIPv4(peer))) return 'Use the dashboard on this Mac.';
  const hosts = ['127.0.0.1', 'localhost', ...(allowLanReadOnly ? addresses : [])].map(address => `${address}${port === 80 ? '' : `:${port}`}`);
  if (!hosts.includes(req.headers.host)) return 'Use the local dashboard address.';
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return 'Origin not allowed.';
  if (req.headers['sec-fetch-site'] === 'cross-site') return 'Cross-site requests are not allowed.';
  if (!['GET', 'HEAD'].includes(req.method || 'GET') && !canUseLocalTools(req, port)) return 'Changes are available only at localhost on the dashboard Mac.';
  return null;
}
