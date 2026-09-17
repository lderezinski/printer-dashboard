import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIPv4, lanAddresses, requestAccessError, canUseLocalTools } from '../network.mjs';

const addresses = ['192.168.50.10'];
const request = (host = '192.168.50.10:3000', peer = '192.168.50.20', headers = {}) => ({
  socket: { remoteAddress: peer }, headers: { host, ...headers }
});
const check = req => requestAccessError(req, 3000, addresses, { allowLanReadOnly: true });

test('local tools require both localhost and an actual loopback client', () => {
  assert.equal(canUseLocalTools(request('localhost:3000', '127.0.0.1'), 3000), true);
  assert.equal(canUseLocalTools(request('localhost:3000', '::ffff:127.0.0.1'), 3000), true);
  for (const req of [request(), request('localhost:3000'), request('127.0.0.1:3000', '127.0.0.1'),
    request('192.168.50.10:3000', '127.0.0.1'), request('localhost:3001', '127.0.0.1'),
    request('192.168.50.10:3000', '192.168.50.20', { 'x-forwarded-for': '127.0.0.1' })]) {
    assert.equal(canUseLocalTools(req, 3000), false);
  }
});

test('only private IPv4 interfaces become LAN addresses', () => {
  for (const ip of ['10.0.0.2', '172.16.0.2', '172.31.255.254', '192.168.50.10']) assert.equal(isPrivateIPv4(ip), true);
  for (const ip of ['172.15.0.1', '172.32.0.1', '8.8.8.8', '192.168.999.1', '::1', '127.0.0.1']) assert.equal(isPrivateIPv4(ip), false);
  assert.deepEqual(lanAddresses({ en0: [
    { address: addresses[0], family: 'IPv4', internal: false },
    { address: addresses[0], family: 'IPv4', internal: false },
    { address: '8.8.8.8', family: 'IPv4', internal: false },
    { address: '10.0.0.2', family: 'IPv4', internal: true }
  ] }), addresses);
});

test('LAN and local clients can access their dashboard origin', () => {
  assert.equal(check(request()), null);
  assert.equal(check(request(undefined, undefined, { origin: 'http://192.168.50.10:3000' })), null);
  assert.equal(check(request('localhost:3000', '127.0.0.1')), null);
  assert.equal(check(request('127.0.0.1:3000', '::ffff:127.0.0.1')), null);
});

test('reject public clients, unrecognized hosts, and other browser origins', () => {
  for (const req of [request(undefined, '8.8.8.8'), request('attacker.example:3000'),
    request('192.168.50.20:3000'), request('192.168.50.10:3001'),
    request(undefined, undefined, { origin: 'https://attacker.example' }),
    request(undefined, undefined, { origin: 'null' }),
    request(undefined, undefined, { origin: 'http://localhost:3000' }),
    request(undefined, undefined, { 'sec-fetch-site': 'cross-site' })]) assert.ok(check(req));
});

test('LAN access is disabled by default and local hostname checks still apply', () => {
  assert.ok(requestAccessError(request(), 3000, addresses));
  assert.equal(requestAccessError(request('localhost:3000', '127.0.0.1'), 3000, addresses), null);
  assert.ok(requestAccessError(request('192.168.50.10:3000', '127.0.0.1'), 3000, addresses));
});

test('LAN opt-in permits viewing but never modifying dashboard state', () => {
  for (const method of ['PUT', 'POST', 'PATCH', 'DELETE']) {
    assert.ok(check({ ...request(), method }));
    assert.ok(check({ ...request('localhost:3000'), method }));
    assert.ok(check({ ...request('127.0.0.1:3000', '127.0.0.1'), method }));
    assert.equal(check({ ...request('localhost:3000', '127.0.0.1'), method }), null);
  }
});

test('proxy headers cannot turn forwarded requests into trusted local requests', () => {
  for (const key of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip']) {
    assert.ok(check(request('localhost:3000', '127.0.0.1', { [key]: '127.0.0.1' })));
  }
});
