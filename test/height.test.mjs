import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedHeight, compareHeight, validateCalibration, HeightMonitor } from '../height.mjs';
import { mkdtemp, mkdir, symlink, readFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const profile = { firstLayerMm: .15, layerMm: .12 };
const measured = (heightMm = 1, uncertaintyMm = 1) => ({ state:'measured', heightMm, uncertaintyMm, confidence:.95 });
const context = (capturedAt, expectedMm = 5, jobKey = 'job', layer = 42) => ({ capturedAt, expectedMm, jobKey, layer });
const calibration = { bed:[200,300], top:[200,270], anchor:[50,50], scaleBottom:[400,300], scaleTop:[400,200], scaleMm:20, firstLayerMm:.15, layerMm:.12, uniformLayers:true };

test('expected Z accounts for first layer and rejects missing or invalid slice data', () => {
  assert.equal(expectedHeight(1,profile),.15);
  assert.equal(expectedHeight(17,profile),2.07);
  assert.equal(expectedHeight(42,profile),5.07);
  for (const layer of [0,-1,2.5,NaN,undefined]) assert.equal(expectedHeight(layer,profile),null);
  assert.equal(expectedHeight(3,{layerZ:[.2,.35,.6]}),.6);
  assert.equal(expectedHeight(4,{layerZ:[.2,.35,.6]}),null);
  assert.equal(expectedHeight(1,{firstLayerMm:Infinity,layerMm:.12}),null);
  assert.equal(expectedHeight(1,{layerZ:['bad']}),null);
});

test('requires three repeated shortfalls after allowing for measurement uncertainty', () => {
  let value = compareHeight(null,measured(),context(1000));
  assert.equal(value.state,'checking');
  value = compareHeight(value,measured(),context(21000));
  assert.equal(value.state,'checking');
  value = compareHeight(value,measured(),context(41000));
  assert.equal(value.state,'suspect');
  value = compareHeight(value,measured(),context(61000,8));
  assert.equal(value.state,'suspect');
  value = compareHeight(value,measured(),context(81000,8));
  value = compareHeight(value,measured(),context(101000,8));
  assert.equal(value.state,'warning');
  assert.equal(compareHeight(value,measured(4),context(121000)).state,'tracking');
  assert.equal(compareHeight(value,measured(1,4),context(121000)).count,0);
});

test('unknown, weak or nonsensical measurements cannot mean zero height or continue an alert', () => {
  const previous = { ...context(1000),count:2 };
  for (const measurement of [null,{state:'unknown',reason:'Occluded'},measured(NaN),measured(-1),measured(1,-1),{...measured(),confidence:.81}]) {
    const result = compareHeight(previous,measurement,context(21000));
    assert.equal(result.state,'unknown'); assert.equal(result.measuredMm,null); assert.equal(result.count,0);
  }
});

test('duplicate images, layer rollback, job changes and long gaps restart confirmation', () => {
  const previous = { ...context(1000),count:2 };
  for (const next of [context(1000),context(500),context(92000),context(21000,5,'new'),context(21000,5,'job',41)]) {
    assert.equal(compareHeight(previous,measured(),next).count,1);
  }
});

test('calibration requires a real scale, usable points, and confirmed layer settings', () => {
  assert.equal(validateCalibration(calibration,640,480).profile.layerMm,.12);
  for (const value of [{...calibration,uniformLayers:false},{...calibration,scaleMm:0},{...calibration,scaleTop:[400,299]},{...calibration,bed:[1,300]},{...calibration,top:[NaN,30]},{...calibration,layerMm:4}]) assert.throws(()=>validateCalibration(value,640,480));
});

test('height view rejects stale results, stale status, paused jobs and changed jobs', () => {
  const now = Date.now();
  let sample = { connected:true,rawState:'printing',lastSeen:new Date(now).toISOString(),job:'pawn',layer:42 };
  let key = 'job';
  const monitor = new HeightMonitor('/nonexistent',()=>sample,()=>key);
  assert.equal(monitor.view(now).state,'calibration');
  monitor.config = { id:'calibration',jobKey:key,job:'pawn',referenceLayer:2,profile };
  monitor.latest = compareHeight(null,measured(5),context(now,5));
  assert.equal(monitor.view(now).state,'tracking');
  assert.equal(monitor.view(now+15001).measuredMm,null);
  sample.lastSeen = new Date(now+90001).toISOString();
  assert.equal(monitor.view(now+90001).state,'unknown');
  sample.lastSeen = new Date(now).toISOString(); sample.rawState = 'paused';
  assert.equal(monitor.view(now).state,'idle');
  sample.rawState = 'printing'; key = 'new';
  assert.equal(monitor.view(now).state,'calibration');
  assert.equal(monitor.view(now).measuredMm,null);
});

test('only fresh matching frames can become calibration references; frozen data stays stable', () => {
  const now = Date.now();
  const monitor = new HeightMonitor('/nonexistent',()=>({job:'pawn',layer:10,connected:true,rawState:'printing',lastSeen:new Date(now).toISOString()}),()=> 'job');
  const request = { jobKey:'job',startedAt:now-1000,sample:{job:'pawn',layer:10} };
  const result = { heightCapturedAt:now,heightJpeg:Buffer.from('annotated').toString('base64'),heightReferenceJpeg:Buffer.from('raw').toString('base64'),heightWidth:640,heightHeight:480 };
  monitor.observe(result,{...request,jobKey:'old'});
  assert.throws(()=>monitor.freeze());
  monitor.observe({...result,heightCapturedAt:now-2000},request);
  assert.throws(()=>monitor.freeze());
  monitor.observe(result,request);
  const reference = monitor.freeze();
  assert.equal(reference.layer,10);
  assert.equal(monitor.frozen.image.toString(),'raw');
  monitor.observe({...result,heightReferenceJpeg:Buffer.from('new').toString('base64')},request);
  assert.equal(monitor.frozen.image.toString(),'raw');
  monitor.snapshot.capturedAt = now-61000;
  assert.throws(()=>monitor.freeze());
});

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('calibration validates real image patches, persists privately and reloads for the same run', { skip: !existsSync(path.join(repository,'data/obico-venv/bin/python')) }, async () => {
  const root = await mkdtemp(path.join(tmpdir(),'height-calibration-test-'));
  try {
    const data = path.join(root,'data'); await mkdir(data);
    await symlink(path.join(repository,'data/obico-venv'),path.join(data,'obico-venv'));
    await symlink(path.join(repository,'height_tracker.py'),path.join(root,'height_tracker.py'));
    const imagePath = path.join(root,'fixture.jpg');
    await promisify(execFile)(path.join(data,'obico-venv/bin/python'), ['-B','-c',
      'import cv2,numpy as np,sys; rng=np.random.default_rng(22); img=rng.integers(30,210,(480,640,3),dtype=np.uint8); cv2.imwrite(sys.argv[1],img)', imagePath]);
    let key = 'run-one';
    const sample = () => ({ job:'pawn',layer:25,connected:true,rawState:'printing',lastSeen:new Date().toISOString() });
    const monitor = new HeightMonitor(root,sample,()=>key);
    const now = Date.now(), jpeg = (await readFile(imagePath)).toString('base64');
    monitor.observe({heightCapturedAt:now,heightJpeg:jpeg,heightReferenceJpeg:jpeg,heightWidth:640,heightHeight:480}, {jobKey:key,startedAt:now-1000,sample:sample()});
    const reference = monitor.freeze();
    await monitor.calibrate({...calibration,top:[200,275],firstLayerMm:.2,layerMm:.2,snapshotId:reference.id});
    assert.equal(monitor.context().expectedMm,5);
    assert.equal((await stat(path.join(data,'height-a5mp.json'))).mode & 0o777,0o600);
    assert.equal((await stat(path.join(data,monitor.config.referenceFile))).mode & 0o777,0o600);
    const restored = new HeightMonitor(root,sample,()=>key); await restored.load();
    assert.equal(restored.context().calibrationId,monitor.config.id);
    assert.equal(restored.view().state,'unknown'); // No measurement invented on save or restart.
    key = 'run-two'; assert.equal(restored.context(),null);
    assert.equal(restored.view().state,'calibration');
  } finally { await rm(root,{recursive:true,force:true}); }
});
