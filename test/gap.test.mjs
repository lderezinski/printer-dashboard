// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { DARK_CHESS_RULE, DARK_CHESS_JOB, GapMonitor, summarizeGapLayer } from '../gap.mjs';
import { mkdtemp, mkdir, symlink, readFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const windowFor = gaps => ({layer:10,startedAt:1000,full:true,points:gaps.map((gapPx,i)=>({gapPx,at:3000+i*4000}))});
const end = 65000;
test('dark chess flags a constant visible gap without any previous layer baseline',()=>{
  const window={...windowFor(Array(16).fill(4)),rule:DARK_CHESS_RULE};
  assert.equal(summarizeGapLayer(window,end).state,'suspect');
  assert.equal(summarizeGapLayer({...window,full:false},end).state,'unknown');
  for (const gaps of [Array(16).fill(0),Array(16).fill(2),[0,0,0,0,7,7,0,0,0,0,0,0,0,0,0,0], [4,4,4,4,4,4,4,0,4,4,4,4,4,4,4,4]]) {
    assert.equal(summarizeGapLayer({...windowFor(gaps),rule:DARK_CHESS_RULE},end).state,'tracking');
  }
  assert.equal(summarizeGapLayer({...window,points:window.points.filter((_,i)=>i<4||i>10)},end).state,'unknown');
});
test('dark chess rule is scoped to the exact A5MP job and calibrated run',()=>{
  let sample={job:DARK_CHESS_JOB,layer:213}, key='run';
  const monitor=new GapMonitor('/nonexistent',()=>sample,()=>key);
  monitor.config={id:'ref',jobKey:key,job:DARK_CHESS_JOB,referenceLayer:213,rule:DARK_CHESS_RULE};
  assert.equal(monitor.context().rule,DARK_CHESS_RULE);
  key='next-run'; assert.equal(monitor.context(),null);
  key='run'; sample={job:'White chess pieces.3mf',layer:213}; assert.equal(monitor.context(),null);
  monitor.config.job=sample.job; assert.equal(monitor.context(),null);
});
test('dark chess measurements reach the layer alert, while legacy measurements are rejected',()=>{
  const start=Date.now()-70000;
  let sample={connected:true,rawState:'printing',lastSeen:new Date(start-1000).toISOString(),layer:1,job:DARK_CHESS_JOB};
  const monitor=new GapMonitor('/nonexistent',()=>sample,()=> 'run');
  monitor.config={id:'ref',jobKey:'run',job:DARK_CHESS_JOB,referenceLayer:1,rule:DARK_CHESS_RULE};
  monitor.status(start-1000);
  sample={...sample,lastSeen:new Date(start).toISOString(),layer:2}; monitor.status(start);
  function observe(at,rule) {
    const request={startedAt:at-1,jobKey:'run',sample:{...sample},gapContext:monitor.context()};
    monitor.observe({heightCapturedAt:at,heightWidth:640,heightHeight:480,heightJpeg:'aW1n',heightReferenceJpeg:'aW1n',heightMeasurement:{state:'measured',rule,gapPx:4,confidence:.95}},request);
  }
  observe(start+1,'landmark-gap'); assert.equal(monitor.window.points.length,0);
  for(let i=0;i<16;i++) observe(start+2000+i*4000,DARK_CHESS_RULE);
  sample={...sample,lastSeen:new Date(start+64000).toISOString(),layer:3}; monitor.status(start+64000);
  assert.equal(monitor.completed.state,'suspect');
  assert.match(monitor.completed.message,/light-gray head and silk-black/);
  sample.rawState='paused'; monitor.status(start+64001);
  assert.equal(monitor.completed,null);
});
test('widening without recovery is flagged only after a sufficiently observed full layer',()=>{
  const window=windowFor(Array.from({length:16},(_,i)=>i*.4));
  const result=summarizeGapLayer(window,end);
  assert.equal(result.state,'suspect');
  assert.ok(result.deltaPx>=3);
  assert.equal(summarizeGapLayer({...window,full:false},end).state,'unknown');
  assert.equal(summarizeGapLayer({...window,points:window.points.slice(0,5)},end).state,'unknown');
});
test('brief travel lifts, closing gaps, steady gaps and jitter cannot become a widening alert',()=>{
  for(const gaps of [Array(16).fill(1), Array.from({length:16},(_,i)=>5-i*.3),[0,0,0,0,7,7,0,0,0,0,0,0,0,0,0,0],Array.from({length:16},(_,i)=>i%2*.5)]) {
    assert.equal(summarizeGapLayer(windowFor(gaps),end,0).state,'tracking');
  }
});
test('gap staying open above an earlier baseline is flagged even if within-layer height is constant',()=>{
  assert.equal(summarizeGapLayer(windowFor(Array(16).fill(6)),end,1).state,'suspect');
  assert.equal(summarizeGapLayer(windowFor(Array(16).fill(6)),end,null).state,'tracking');
});
test('occlusion or sparse coverage cannot prove the gap persisted throughout the layer',()=>{
  const window=windowFor(Array.from({length:16},(_,i)=>i*.4));
  assert.equal(summarizeGapLayer({...window,points:window.points.filter((_,i)=>i<4||i>10)},end).state,'unknown');
});
test('layer transitions discard startup partial layer and reset on pause, rollback or a new run',()=>{
  let sample={connected:true,rawState:'printing',lastSeen:new Date(1000).toISOString(),layer:10,job:'pawn'}, key='run1';
  const monitor=new GapMonitor('/nonexistent',()=>sample,()=>key);
  monitor.config={id:'ref',jobKey:key,job:'pawn',referenceLayer:1};
  const status=(at,layer,state='printing')=>{sample={...sample,layer,rawState:state,lastSeen:new Date(at).toISOString()};monitor.status(at);};
  status(1000,10);assert.equal(monitor.window.full,false);
  status(2000,11);assert.equal(monitor.completed.state,'unknown');assert.equal(monitor.window.full,true);
  monitor.baseline=2;
  status(3000,11,'paused');assert.equal(monitor.window,null);assert.equal(monitor.baseline,null);
  status(4000,11);assert.equal(monitor.window.full,false);
  status(5000,3);assert.equal(monitor.window.full,false);
  key='run2';status(6000,1);assert.equal(monitor.window,null);assert.deepEqual(monitor.history,[]);
});
test('stale printer or image data cannot show an active gap result',()=>{
  const now=Date.now(); let sample={connected:true,rawState:'printing',lastSeen:new Date(now).toISOString(),layer:1,job:'pawn'};
  const monitor=new GapMonitor('/nonexistent',()=>sample,()=> 'run');
  monitor.config={id:'ref',jobKey:'run',job:'pawn',referenceLayer:1};
  monitor.latest={state:'measured',gapPx:5,capturedAt:now};
  assert.equal(monitor.view(now).gapPx,5);
  assert.equal(monitor.view(now+12001).gapPx,null);
  sample.rawState='paused';assert.equal(monitor.view(now).state,'idle');
  sample.rawState='printing';assert.equal(monitor.view(now+15001).state,'unknown');
});
test('late frames from another layer or job cannot enter the current gap trend',()=>{
  const now=Date.now();const sample={connected:true,rawState:'printing',lastSeen:new Date(now-1000).toISOString(),layer:2,job:'pawn'};
  const monitor=new GapMonitor('/nonexistent',()=>sample,()=> 'run');
  monitor.config={id:'ref',jobKey:'run',job:'pawn',referenceLayer:1};monitor.status(now-1000);
  const result={heightCapturedAt:now,heightWidth:640,heightHeight:480,heightJpeg:'aW1n',heightReferenceJpeg:'aW1n',heightMeasurement:{state:'measured',gapPx:3,confidence:.95}};
  const request={startedAt:now-500,jobKey:'run',gapContext:{calibrationId:'ref'},sample:{job:'pawn',layer:1}};
  monitor.observe(result,request);assert.equal(monitor.window.points.length,0);
  monitor.observe(result,{...request,sample:{...request.sample,layer:2},jobKey:'old'});assert.equal(monitor.window.points.length,0);
  monitor.observe(result,{...request,sample:{...request.sample,layer:2}});assert.equal(monitor.window.points.length,1);
  monitor.observe(result,{...request,sample:{...request.sample,layer:2}});assert.equal(monitor.window.points.length,1);
});

const repository=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('gap reference validates and saves without any scale or layer-height settings',{skip:!existsSync(path.join(repository,'data/obico-venv/bin/python'))},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'gap-reference-test-'));
  try {
    const data=path.join(root,'data');await mkdir(data);
    await symlink(path.join(repository,'data/obico-venv'),path.join(data,'obico-venv'));
    for(const script of ['gap_tracker.py','height_tracker.py']) await symlink(path.join(repository,script),path.join(root,script));
    const fixture=path.join(root,'fixture.jpg');
    await promisify(execFile)(path.join(data,'obico-venv/bin/python'),['-B','-c','import cv2,numpy as np,sys; rng=np.random.default_rng(22); cv2.imwrite(sys.argv[1],rng.integers(30,210,(480,640,3),dtype=np.uint8))',fixture]);
    const sample=()=>({connected:true,rawState:'printing',lastSeen:new Date().toISOString(),layer:2,job:'pawn'});
    const monitor=new GapMonitor(root,sample,()=> 'run');
    const now=Date.now(),jpeg=(await readFile(fixture)).toString('base64');
    monitor.observe({heightCapturedAt:now,heightWidth:640,heightHeight:480,heightJpeg:jpeg,heightReferenceJpeg:jpeg},{jobKey:'run',startedAt:now-1000,sample:sample()});
    const reference=monitor.freeze();
    await monitor.calibrate({snapshotId:reference.id,nozzle:[300,200],top:[300,205],anchor:[60,60]});
    assert.equal(monitor.context().calibrationId,monitor.config.id);
    assert.equal(monitor.view().state,'unknown');
    assert.equal((await stat(path.join(data,'gap-a5mp.json'))).mode & 0o777,0o600);
    const restored=new GapMonitor(root,sample,()=> 'run');await restored.load();
    assert.equal(restored.context().calibrationId,monitor.config.id);
  } finally {await rm(root,{recursive:true,force:true});}
});
