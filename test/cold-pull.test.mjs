import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const saved = new Map();
const helpers = runInNewContext(`${source.slice(source.indexOf('function coldPullSettings('), source.indexOf('function spaghettiStatus('))}; ({ coldPullNozzle, coldPullInstructions })`, { escape: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'), localStorage: { getItem: key => saved.get(key) } });
const render = (material, cleaner = 'PETG') => {
  saved.set('cold-pull:c5:1', JSON.stringify({ material, cleaner }));
  return helpers.coldPullNozzle('c5', 1);
};
test('matches Flashforge loading and pull temperatures for every table row', () => {
  for (const [material, cleaner, filament, loading, pull] of [
    ['PLA', 'PETG', 'PLA', '250°C', 80], ['PETG', 'PETG', 'PETG', '250°C', 95],
    ['SILK', 'PETG', 'SILK', '250°C', 80], ['ABS', 'PETG', 'PETG', '250°C', 95],
    ['ABS', 'PLA', 'PLA', '250°C', 80],
    ['Others', 'PETG', 'PETG', 'the loading temperature specified for the original filament', 95],
    ['Others', 'PLA', 'PLA', 'the loading temperature specified for the original filament', 80],
  ]) assert.ok(render(material, cleaner).includes(`Use ${filament}. Heat to ${loading}; cool to ${pull}°C before pulling.`));
});
test('unknown filament never supplies guessed temperatures; nozzle and printer settings are isolated', () => {
  assert.doesNotMatch(render('TPU'), /Heat to/);
  render('PETG');
  assert.doesNotMatch(helpers.coldPullNozzle('c5', 2), /Heat to/);
  assert.doesNotMatch(helpers.coldPullNozzle('c5p', 1), /Heat to/);
});
test('due cold-pull tasks expand all four nozzles only for C5 series', () => {
  const html = helpers.coldPullInstructions({ id: 'c5p' }, { id: 'cold-pull', due: true });
  assert.match(html, /class="cold-pull-instructions" open/);
  assert.equal((html.match(/data-cold-nozzle=/g) || []).length, 4);
  assert.equal(helpers.coldPullInstructions({ id: 'ad5m' }, { id: 'cold-pull' }), '');
  assert.equal(helpers.coldPullInstructions({ id: 'c5' }, { id: 'lubrication' }), '');
  assert.doesNotMatch(helpers.coldPullInstructions({ id: 'c5' }, { id: 'cold-pull', due: false }), /instructions" open/);
});

test('maintenance uses fresh API materials by slot and drops stale readings', () => {
  saved.clear();
  const printer = { id: 'c5p', connected: true, lastSeen: new Date().toISOString(), nozzles: ['PLA', 'PETG', 'SILK', 'ABS'].map(material => ({ material, hasFilament: true })) };
  const html = helpers.coldPullInstructions(printer, { id: 'cold-pull', due: true });
  assert.match(html, /Use printer: PETG/);
  assert.match(html, /Use SILK. Heat to 250°C; cool to 80°C/);
  for (const unavailable of [{ ...printer, connected: false }, { ...printer, lastSeen: new Date(Date.now() - 16000).toISOString() }]) {
    const html = helpers.coldPullInstructions(unavailable, { id: 'cold-pull' });
    assert.match(html, /Fresh printer report unavailable/);
    assert.doesNotMatch(html, /Heat to/);
  }
});

test('current API material takes priority over a saved manual selection', () => {
  render('PLA');
  const html = helpers.coldPullNozzle('c5', 1, 'PETG', true);
  assert.match(html, /Use PETG. Heat to 250°C; cool to 95°C/);
  assert.match(html, /data-cold-material disabled/);
  assert.doesNotMatch(html, /Manual selection active/);
});
