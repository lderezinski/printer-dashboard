import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { HeightMonitor } from './height.mjs';
import { canAnalyze } from './obico.mjs';

const median = values => { const a=[...values].sort((a,b)=>a-b); return a.length ? (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2 : null; };
const quantile = (values,p) => [...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)];
export const DARK_CHESS_RULE = 'light-head-dark-chess-v1';
export const DARK_CHESS_JOB = process.env.FLASHFORGE_DARK_CHESS_JOB || 'a5mp-dark-chess-calibration.3mf';
export function summarizeGapLayer(window, endAt, baseline = null) {
  const duration = endAt-window.startedAt;
  const points = window.points;
  const base = { layer:window.layer, capturedAt:endAt, samples:points.length, deltaPx:null, minimumPx:null };
  const unknown = message => ({...base,state:'unknown',message});
  if (!window.full || duration < 15000 || points.length < 8) return unknown('Not enough comparable views across a complete layer.');
  const bins = Array.from({length:4},()=>[]);
  for (const p of points) bins[Math.min(3,Math.floor(4*(p.at-window.startedAt)/duration))].push(p.gapPx);
  const times = [window.startedAt,...points.map(p=>p.at),endAt];
  const blindGap = Math.max(...times.slice(1).map((at,i)=>at-times[i]));
  if (bins.some(bin=>bin.length < 2) || blindGap > Math.max(12000,duration*.15)) return unknown('The gap was not visible often enough throughout this layer.');
  const quarters = bins.map(median), gaps = points.map(p=>p.gapPx);
  const deltaPx = Math.round((quarters[3]-quarters[0])*100)/100;
  let peak = gaps[0], drawdown = 0;
  for (const gap of gaps) { peak = Math.max(peak,gap); drawdown = Math.max(drawdown,peak-gap); }
  // Several pixels of tolerance prevent tiny edge jitter from becoming a trend.
  const rising = deltaPx >= 3 && drawdown <= 2 && quarters.every((v,i)=>i===0 || v >= quarters[i-1]-1);
  const minimumPx = quantile(gaps,.1);
  if (window.rule === DARK_CHESS_RULE) {
    // A stable open gap is sufficient. No growing trend or learned layer
    // baseline is required; gapPx already excludes the healthy housing offset.
    const open = gaps.every(gap => gap >= 3);
    return {...base, deltaPx, minimumPx, state:open ? 'suspect' : 'tracking',
      message:open ? 'Possible air printing: a gap between the light-gray head and silk-black chess piece persisted across the completed layer. Inspect the A5MP.'
        : 'No persistent head-to-piece gap in the comparable views of this layer.'};
  }
  const heldOpen = Number.isFinite(baseline) && minimumPx >= baseline+3 && drawdown <= 2;
  return { ...base, deltaPx, minimumPx, state:rising || heldOpen ? 'suspect' : 'tracking',
    message:rising ? 'Measured separation grew without closing across the completed layer. Check whether the back of the printer is visible between the nozzle tip and the print.'
      : heldOpen ? 'Measured separation stayed larger than the earlier baseline throughout the completed layer. Check whether the back of the printer is visible between the nozzle tip and the print.'
        : 'No sustained widening found in the comparable views of this layer. Filament flow is still unverified.' };
}

export class GapMonitor extends HeightMonitor {
  constructor(root,getSample,getJobKey,enabled=true) {
    super(root,getSample,getJobKey); this.enabled=enabled; this.sequence=0; this.nextAt=0;
  }
  async load() {
    try { this.config=JSON.parse(await readFile(path.join(this.root,'data/gap-a5mp.json'),'utf8')); }
    catch(e) { if(e.code!=='ENOENT') this.error='Gap reference could not be read. Mark a fresh reference.'; }
  }
  context(sample=this.getSample()) {
    return this.config?.jobKey===this.getJobKey() && this.config?.job===sample?.job && sample.layer>=this.config.referenceLayer
      && (this.config.rule !== DARK_CHESS_RULE || sample.job === DARK_CHESS_JOB)
      ? { calibrationId:this.config.id,jobKey:this.getJobKey(),rule:this.config.rule } : null;
  }
  suggestedProfile() { return null; }
  async calibrate(value) {
    const frozen=this.frozen;
    if(!frozen || frozen.id!==value?.snapshotId || Date.now()-frozen.createdAt>900000 || frozen.jobKey!==this.getJobKey() || !canAnalyze(this.getSample())) throw new Error('Reference expired or print changed. Capture a new image.');
    const points={};
    for(const key of ['nozzle','top','anchor']) {
      const point=value[key];
      if(!Array.isArray(point) || point.length!==2 || point.some(v=>!Number.isFinite(v)) || point[0]<13 || point[0]>frozen.width-14 || point[1]<13 || point[1]>frozen.height-14) throw new Error(`Mark ${key} inside the image.`);
      points[key]=point;
    }
    const id=randomUUID(), directory=path.join(this.root,'data');
    const config={...points,id,jobKey:frozen.jobKey,job:frozen.job,referenceLayer:frozen.layer,referenceFile:`gap-reference-${id}.jpg`,calibratedAt:new Date().toISOString(),
      ...(frozen.job===DARK_CHESS_JOB ? {rule:DARK_CHESS_RULE} : {})};
    await writeFile(path.join(directory,config.referenceFile),frozen.image,{mode:0o600});
    let validation;
    try {
      const {stdout}=await promisify(execFile)(path.join(directory,'obico-venv/bin/python'),[path.join(this.root,'gap_tracker.py'),path.join(directory,config.referenceFile),JSON.stringify(config)],{timeout:10000,maxBuffer:8192});
      validation=JSON.parse(stdout);
    } catch { throw new Error('Gap reference validator could not run.'); }
    if(!validation.valid) throw new Error(validation.error);
    if(frozen.jobKey!==this.getJobKey() || !canAnalyze(this.getSample())) throw new Error('Print changed while saving. Capture a new reference.');
    await writeFile(path.join(directory,'gap-a5mp.json.tmp'),JSON.stringify(config,null,2),{mode:0o600});
    await rename(path.join(directory,'gap-a5mp.json.tmp'),path.join(directory,'gap-a5mp.json'));
    this.config=config; this.frozen=null; this.history=[]; this.reset(); this.error='';
  }
  reset() { this.window=null; this.latest=null; this.completed=null; this.baseline=null; }
  invalidate() { this.reset(); }
  status(now=Date.now()) {
    const sample=this.getSample(), key=this.getJobKey();
    if(this.sessionJob!==key) {this.sessionJob=key;this.history=[];this.reset();}
    if(!canAnalyze(sample,now) || !this.context(sample) || !Number.isInteger(sample.layer) || sample.layer<1) { this.reset(); return; }
    if(this.window?.jobKey!==key || sample.layer<this.window.layer) this.reset();
    if(!this.window) { this.window={jobKey:key,layer:sample.layer,startedAt:now,full:false,points:[]}; return; }
    if(sample.layer===this.window.layer) return;
    const adjacent=sample.layer===this.window.layer+1;
    const completed=summarizeGapLayer({...this.window,rule:this.config.rule,full:this.window.full&&adjacent},now,this.baseline);
    this.completed=completed; this.history=[completed,...this.history].slice(0,20);
    if(completed.state==='tracking') this.baseline=this.baseline===null ? completed.minimumPx : Math.min(this.baseline,completed.minimumPx);
    if(!adjacent) this.baseline=null;
    this.window={jobKey:key,layer:sample.layer,startedAt:now,full:adjacent,points:[]};
    this.latest=null;
  }
  observe(result,request) {
    super.observe(result,{...request,heightContext:null}); // Validated, unannotated reference image.
    if(request.jobKey!==this.getJobKey() || !this.context() || request.gapContext?.calibrationId!==this.config?.id) return;
    const at=result.heightCapturedAt, measurement=result.heightMeasurement;
    if(!Number.isFinite(at) || at<request.startedAt || at>Date.now() || this.snapshot?.capturedAt!==at || request.sample.layer!==this.window?.layer || at<this.window.startedAt || at<=this.window.lastAt) return;
    this.window.lastAt=at;
    this.latest={...measurement,capturedAt:at,layer:request.sample.layer};
    if(measurement?.state==='measured' && (this.config.rule!==DARK_CHESS_RULE || measurement.rule===DARK_CHESS_RULE) && Number.isFinite(measurement.gapPx) && measurement.gapPx>=0 && measurement.gapPx<=100 && Number.isFinite(measurement.confidence) && measurement.confidence>=.82 && measurement.confidence<=1) {
      this.window.points.push({at,gapPx:measurement.gapPx});
      if(this.window.points.length>10000) { this.window.full=false; this.window.points.shift(); }
    } else this.latest={state:'unknown',reason:measurement?.reason || 'Gap cannot be measured.',capturedAt:at};
  }
  start() {
    if(!this.enabled) return;
    this.stopped=false; this.timer=setInterval(()=>this.tick(),1000); this.timer.unref(); this.tick();
  }
  tick() {
    if(this.stopped || !this.enabled) return;
    const now=Date.now(); this.status(now);
    if(this.pending && now-this.pending.startedAt>15000) { this.error='Close-up timed out. Retrying.'; this.reset(); this.worker?.kill(); return; }
    if(!canAnalyze(this.getSample(),now) || this.pending || now<this.nextAt) return;
    if(!this.worker) {
      const worker=spawn(path.join(this.root,'data/obico-venv/bin/python'),['-B','-u',path.join(this.root,'gap_worker.py')],{cwd:this.root,stdio:['pipe','pipe','ignore']});
      this.worker=worker; this.ready=false;
      this.startupTimer=setTimeout(()=>{if(this.worker===worker&&!this.ready) worker.kill();},15000);
      worker.stdin.on('error',()=>{});
      createInterface({input:worker.stdout}).on('line',line=>{
        if(this.worker!==worker) return;
        try {
          const result=JSON.parse(line);
          if(result.type==='ready') {this.ready=true;clearTimeout(this.startupTimer);this.tick();return;}
          const request=this.pending;
          if(!request || result.id!==request.id) return;
          this.pending=null; this.nextAt=Date.now()+3000; this.error='';
          this.status();
          if(canAnalyze(this.getSample())) this.observe(result,request);
        } catch {this.error='Gap sampler response unavailable. Retrying.';worker.kill();}
      });
      const exited=()=>{if(this.worker!==worker)return;clearTimeout(this.startupTimer);this.worker=null;this.pending=null;this.ready=false;this.nextAt=Date.now()+3000;this.reset();};
      worker.on('exit',exited);worker.on('error',exited);return;
    }
    if(!this.ready) return;
    const sample=this.getSample();
    this.pending={id:++this.sequence,startedAt:now,jobKey:this.getJobKey(),sample:{job:sample.job,layer:sample.layer},gapContext:this.context(sample)};
    this.worker.stdin.write(JSON.stringify({type:'capture',id:this.pending.id,gapContext:this.pending.gapContext})+'\n');
  }
  view(now=Date.now()) {
    const sample=this.getSample(), context=this.context(sample);
    let state='unknown',message='Waiting for fresh A5MP printing status.';
    if(!this.enabled) {state='disabled';message='Gap check is disabled for now.';}
    else if(canAnalyze(sample,now)) {
      if(!context) {state='calibration';message=sample.job===DARK_CHESS_JOB ? 'Use a healthy close-contact view. Mark the lower light-gray head edge, dark chess piece below it, and fixed frame.' : 'Mark the visible nozzle tip, part edge below it, and fixed frame. No ruler or layer-height settings needed.';}
      else if(this.error) message=this.error;
      else if(!this.latest || now-this.latest.capturedAt>12000 || this.latest.state!=='measured') message=this.latest?.reason || 'Waiting for a clear view of the nozzle and part.';
      else if(this.completed?.state==='suspect') {state='suspect';message=this.completed.message;}
      else {state='watching';message=this.window?.full ? 'Watching the gap across this layer. Brief travel gaps do not trigger an alert.' : 'Started partway through this layer. Waiting for the next full layer.';}
    } else if(sample?.connected && now-Date.parse(sample.lastSeen)<=15000 && sample.rawState!=='printing') {state='idle';message='Gap checks resume when the A5MP prints.';}
    const measured=['watching','suspect'].includes(state) && this.latest?.state==='measured';
    return {mode:'gap',rule:context?.rule || null,referenceRule:sample?.job===DARK_CHESS_JOB ? DARK_CHESS_RULE : null,state,message,layer:sample?.layer??null,gapPx:measured?this.latest.gapPx:null,
      samples:this.window?.points.length||0,deltaPx:this.completed?.deltaPx??null,completedLayer:this.completed?.layer??null,
      capturedAt:this.snapshot?.capturedAt??null,imageUrl:this.image?`/api/height/a5mp/image?t=${this.snapshot.capturedAt}`:null,
      calibrated:Boolean(context),history:this.history};
  }
  stop() {this.stopped=true;clearInterval(this.timer);clearTimeout(this.startupTimer);this.worker?.kill();}
}
