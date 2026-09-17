const el = part => document.getElementById(`height-${part}`);
const labels = { disabled: 'Disabled', calibration: 'Mark nozzle & part', watching: 'Watching this layer', tracking: 'No sustained widening', suspect: 'Inspect print', warning: 'Possible air printing', unknown: 'Cannot measure', idle: 'Waiting for printing' };
const px = value => Number.isFinite(value) ? `${value.toFixed(1)} px` : '—';
let local = false;
let darkChessReference = false;
export function renderHeight(value, localTools = false) {
  local = localTools;
  darkChessReference = value?.referenceRule === 'light-head-dark-chess-v1';
  const h = value || { state: 'unknown', message: 'Dashboard disconnected. Gap readings are unavailable.' };
  el('badge').textContent = labels[h.state] || 'Cannot measure';
  el('badge').className = `badge ${['suspect','warning'].includes(h.state) ? 'warning' : 'unknown'}`;
  el('message').textContent = h.message;
  el('expected').textContent = px(h.gapPx);
  el('expected').previousElementSibling.textContent = h.rule === 'light-head-dark-chess-v1' ? 'Gap beyond healthy spacing' : 'Visible gap';
  el('rule').textContent = h.rule === 'light-head-dark-chess-v1'
    ? 'Dark chess rule: a gap of at least 3 pixels beyond healthy head-to-piece spacing, present throughout a completed layer, triggers an air-printing alert. The gap does not need to keep growing.'
    : 'Watches for separation that grows or stays wider than an earlier layer. Brief travel gaps do not count.';
  el('measured').textContent = h.samples ?? '—';
  el('gap').textContent = px(h.deltaPx);
  el('layer').textContent = `Current layer: ${h.layer ?? '—'}${h.completedLayer != null ? ` · Last completed check: layer ${h.completedLayer}` : ''}`;
  el('uncertainty').textContent = h.state === 'disabled' ? 'Gap sampling and alerts are paused.' : 'Samples about every 3–4 seconds. Alerts require comparable views throughout a completed layer; obscured views remain unknown.';
  el('timestamp').textContent = h.capturedAt ? `Close-up captured ${new Date(h.capturedAt).toLocaleString()}` : 'No image yet.';
  if (h.imageUrl && el('image').getAttribute('src') !== h.imageUrl) el('image').src = h.imageUrl;
  el('image').hidden = !h.imageUrl;
  el('placeholder').hidden = Boolean(h.imageUrl);
  el('calibrate').disabled = !local || !h.imageUrl;
  el('local').hidden = local;
  el('history').replaceChildren(...(h.history || []).slice(0,5).map(item => {
    const li = document.createElement('li');
    li.textContent = `Layer ${item.layer} · ${labels[item.state] || 'Cannot measure'}${item.deltaPx != null ? ` · ${px(item.deltaPx)} change` : ''}`;
    return li;
  }));
}

export function initHeight(api, refresh) {
  const steps = [['nozzle','Nozzle tip'],['top','Part edge below nozzle'],['anchor','Fixed printer frame']];
  const canvas = el('canvas'), ctx = canvas.getContext('2d');
  let reference, picture, selected = 0;
  const coordinates = {};
  function select(index) {
    selected = index;
    el('step').textContent = `Mark ${steps[index][1].toLowerCase()} in the image, or enter its pixel coordinates.`;
    for (const [i,[key]] of steps.entries()) coordinates[key].button.setAttribute('aria-pressed', String(i === index));
  }
  function draw() {
    if (!picture) return;
    ctx.drawImage(picture, 0, 0);
    for (const [index,[key, label]] of steps.entries()) {
      const { x, y } = coordinates[key];
      if (x.value === '' || y.value === '') continue;
      const px = Number(x.value), py = Number(y.value);
      ctx.beginPath(); ctx.arc(px, py, 5, 0, 2*Math.PI); ctx.lineWidth = 2; ctx.strokeStyle = '#ffbf00'; ctx.stroke();
      ctx.fillStyle = '#101828'; ctx.fillRect(px+7, py-19, 165, 19);
      ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif'; ctx.fillText(`${index+1}. ${label}`, px+9, py-5);
    }
  }
  for (const [index,[key,label]] of steps.entries()) {
    const row = document.createElement('div'); row.className = 'height-point';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = `${index+1}. ${label}`;
    button.addEventListener('click', () => select(index)); row.append(button);
    const inputs = {};
    for (const axis of ['x','y']) {
      const field = document.createElement('label'); field.textContent = axis.toUpperCase();
      const input = document.createElement('input'); input.type = 'number'; input.min = '13'; input.step = '1'; input.required = true; input.setAttribute('aria-label', `${label} ${axis} coordinate`); input.addEventListener('input',draw);
      field.append(input); row.append(field); inputs[axis] = input;
    }
    coordinates[key] = { ...inputs, button }; el('points').append(row);
  }
  function reset() { for (const point of Object.values(coordinates)) point.x.value = point.y.value = ''; select(0); draw(); }
  canvas.addEventListener('click', event => {
    if (!picture) return;
    const rect = canvas.getBoundingClientRect(), point = coordinates[steps[selected][0]];
    point.x.value = Math.round((event.clientX-rect.left)*canvas.width/rect.width);
    point.y.value = Math.round((event.clientY-rect.top)*canvas.height/rect.height);
    draw(); select(Math.min(steps.length-1,selected+1));
  });
  el('calibrate').addEventListener('click', async () => {
    if (!local) return;
    el('calibrate').disabled = true;
    try {
      reference = await api('/api/height/a5mp/reference', { method:'POST' });
      steps[0][1] = darkChessReference ? 'Lower light-gray head edge' : 'Nozzle tip';
      steps[1][1] = darkChessReference ? 'Dark piece edge below head' : 'Part edge below nozzle';
      for (const [i,[key,label]] of steps.entries()) {
        coordinates[key].button.textContent = `${i+1}. ${label}`;
        for (const axis of ['x','y']) coordinates[key][axis].setAttribute('aria-label', `${label} ${axis} coordinate`);
      }
      el('reference-guide').textContent = darkChessReference
        ? 'Use a healthy view where the light-gray head nearly touches the silk-black piece. Mark the lower gray edge, the piece directly below it, and a stationary printer-frame feature away from the moving head.'
        : 'Mark the actual nozzle tip, the part edge directly below it, and a stationary printer-frame feature.';
      picture = null; reset(); el('form-error').textContent = '';
      el('reference-info').textContent = `Frozen at layer ${reference.layer} · ${new Date(reference.capturedAt).toLocaleString()}`;
      const nextPicture = new Image();
      nextPicture.src = reference.imageUrl;
      await nextPicture.decode(); picture = nextPicture;
      canvas.width = reference.width; canvas.height = reference.height;
      for (const point of Object.values(coordinates)) { point.x.max = reference.width-14; point.y.max = reference.height-14; }
      draw(); el('dialog').showModal();
    } catch (error) { el('message').textContent = error.message; }
    finally { el('calibrate').disabled = !local; }
  });
  el('close').addEventListener('click', () => el('dialog').close());
  el('reset').addEventListener('click',reset);
  el('form').addEventListener('submit', async event => {
    event.preventDefault(); el('save').disabled = true; el('form-error').textContent = 'Validating reference landmarks…';
    try {
      const value = { snapshotId:reference.id };
      for (const [key] of steps) value[key] = [Number(coordinates[key].x.value), Number(coordinates[key].y.value)];
      await api('/api/height/a5mp/calibration', { method:'PUT', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(value), signal:AbortSignal.timeout(15000) });
      el('dialog').close(); await refresh();
    } catch (error) { el('form-error').textContent = error.message; }
    finally { el('save').disabled = false; }
  });
  el('image').addEventListener('error', () => { el('image').hidden = true; el('placeholder').hidden = false; el('placeholder').textContent = 'Close-up image could not be loaded.'; });
}
