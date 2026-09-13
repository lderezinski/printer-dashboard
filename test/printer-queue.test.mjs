import test from 'node:test';
import assert from 'node:assert/strict';
import ipp from 'ipp';
import { LASER_MODELS } from '../brother.mjs';
import { normalizeQueue, readPrinterQueue } from '../printer-queue.mjs';

test('queue preserves job order and held/printing states while excluding finished jobs', () => {
  const result = normalizeQueue({ statusCode: 'successful-ok', 'job-attributes-tag': [
    { 'job-id': 9, 'job-name': 'Report.pdf', 'job-state': 'processing', 'job-media-sheets': 5, 'job-media-sheets-completed': 2 },
    { 'job-id': 12, 'job-name': 'en\u001eInvoice.pdf', 'job-state': 4 },
    { 'job-id': 13, 'job-state': 'pending', 'job-impressions': 8 },
    { 'job-id': 1, 'job-state': 'completed' },
    { 'job-id': 2, 'job-state': 7 },
  ] });
  assert.deepEqual(result.jobs.map(j => j.id), [9, 12, 13]);
  assert.deepEqual(result.jobs.map(j => j.state), ['Printing', 'Held', 'Queued']);
  assert.equal(result.jobs[0].completed, 2);
  assert.equal(result.jobs[0].unit, 'sheets');
  assert.equal(result.jobs[1].name, 'Invoice.pdf');
  assert.equal(result.jobs[1].health, 'warning');
  assert.equal(result.jobs[1].total, null);
  assert.equal(result.jobs[1].completed, null);
  assert.equal(result.jobs[2].name, 'Job 13');
  assert.equal(result.jobs[2].total, 8);
  assert.equal(result.jobs[2].unit, 'impressions');
});
test('empty, single-job, limited, and rejected queues remain distinct', () => {
  assert.deepEqual(normalizeQueue({ statusCode: 'successful-ok' }).jobs, []);
  assert.equal(normalizeQueue({ statusCode: 'successful-ok', 'job-attributes-tag': { 'job-id': 1, 'job-state': 'pending' } }).jobs.length, 1);
  assert.throws(() => normalizeQueue({ statusCode: 'client-error-forbidden' }), /not accepted/);
  assert.throws(() => normalizeQueue({ statusCode: 'successful-ok', 'job-attributes-tag': {} }), /invalid queue/);
  const rows = Array.from({ length: 100 }, (_, i) => ({ 'job-id': i + 1, 'job-state': 'pending' }));
  assert.equal(normalizeQueue({ statusCode: 'successful-ok', 'job-attributes-tag': rows }).limited, true);
});

function fakePrinter({ wrongModel = false, queueError = false, httpError = false, badId = false, truncated = false } = {}) {
  const requests = [];
  const fetcher = async (url, options) => {
    const req = ipp.parse(options.body);
    requests.push({ url, options, req });
    if (httpError) return new Response('', { status: 403 });
    let buffer = ipp.serialize({ version: '1.1', id: badId ? req.id + 1 : req.id,
      statusCode: queueError && req.operation === 'Get-Jobs' ? 'client-error-forbidden' : 'successful-ok',
      'operation-attributes-tag': { 'attributes-charset': 'utf-8', 'attributes-natural-language': 'en' },
      ...(req.operation === 'Get-Printer-Attributes' ? { 'printer-attributes-tag': { 'printer-make-and-model': wrongModel ? 'Other printer' : 'Brother MFC-L2710DW series' } } : {}),
    });
    if (truncated) buffer = buffer.subarray(0, buffer.length - 1);
    return new Response(buffer, { headers: { 'Content-Type': 'application/ipp' } });
  };
  return { fetcher, requests };
}
test('transport verifies model, asks only for active jobs, and never sends print commands', async () => {
  const { fetcher, requests } = fakePrinter();
  const result = await readPrinterQueue({ host: '192.168.1.105' }, LASER_MODELS[0], fetcher);
  assert.equal(result.available, true);
  assert.deepEqual(result.jobs, []);
  assert.deepEqual(requests.map(r => r.req.operation), ['Get-Printer-Attributes', 'Get-Jobs']);
  assert.ok(requests.every(r => r.url === 'http://192.168.1.105:631/ipp/print' && r.options.redirect === 'error'));
  assert.equal(requests[1].req['operation-attributes-tag']['which-jobs'], 'not-completed');
  assert.equal(requests[1].req['operation-attributes-tag']['my-jobs'], false);
  assert.equal(requests[1].req['operation-attributes-tag'].limit, 100);
});
test('wrong models, denied access, malformed responses, and offline devices are not empty queues', async () => {
  for (const options of [{ wrongModel: true }, { queueError: true }, { httpError: true }, { badId: true }, { truncated: true }]) {
    const { fetcher, requests } = fakePrinter(options);
    await assert.rejects(readPrinterQueue({ host: '192.168.1.105' }, LASER_MODELS[0], fetcher));
    if (options.wrongModel) assert.equal(requests.length, 1);
  }
  await assert.rejects(readPrinterQueue({ host: '192.168.1.105' }, LASER_MODELS[0], async () => { throw new TypeError('offline'); }));
  await assert.rejects(readPrinterQueue({ host: '8.8.8.8' }, LASER_MODELS[0]), /private LAN/);
});
