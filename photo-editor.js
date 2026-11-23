(() => {
  if (window.__mfPhotoEdLoaded) return;
  window.__mfPhotoEdLoaded = true;
  const $ = id => document.getElementById(id);
  const HORDE = 'https://aihorde.net/api/v2';
  const AGENT = 'MediaForge:2.0:badpeachring';

  let prevPromptBackup = '';
  let tool = 'wand';
  let brushSize = 26;
  let wandTol = 40;
  let expandPx = 8;
  let hdMode = false;
  let hasMask = false;
  let undoStack = [];
  let allCachedModels = [];
  let rawLoadedImg = null;

  const getKey = () => {
    try { return JSON.parse(localStorage.getItem('media_forge_cfg_v1') || '{}').apiKey || '0000000000'; } catch { return '0000000000'; }
  };

  const setDiag = (msg, isErr = false) => {
    const el = $('mfEditDiag');
    if (!el) return;
    el.classList.remove('hidden');
    el.className = `p-2 rounded-lg text-[10px] font-mono break-words border ${isErr ? 'bg-rose-950/80 border-rose-500/50 text-rose-200' : 'bg-zinc-950 border-cyan-500/40 text-cyan-200'}`;
    el.textContent = msg;
  };

  function calcSafeDims(w, h) {
    const maxSide = hdMode ? 768 : 512;
    const scale = Math.min(maxSide / Math.max(w, h), 1);
    let nw = Math.max(256, Math.round((w * scale) / 64) * 64);
    let nh = Math.max(256, Math.round((h * scale) / 64) * 64);
    if (nw > maxSide) nw = maxSide;
    if (nh > maxSide) nh = maxSide;
    return [nw, nh];
  }

  function mountPromptExpander() {
    const promptEl = $('promptIn');
    if (!promptEl || $('mfExpandBar')) return;
    const bar = document.createElement('div');
    bar.id = 'mfExpandBar';
    bar.className = 'flex items-center gap-1.5 mt-1.5';
    bar.innerHTML = `<button id='mfExpandBtn' type='button' class='flex-1 py-1.5 px-2.5 rounded-lg bg-indigo-600/30 border border-indigo-400/50 text-left'><span class='block text-[11px] font-black text-indigo-200'>AI Context &amp; Prompt Enhancer</span><span class='block text-[9px] text-indigo-300/75'>Turns casual edit commands into photoreal lighting &amp; skin tags</span></button><button id='mfUndoPromptBtn' type='button' class='hidden px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-left shrink-0'><span class='block text-[11px] font-bold text-zinc-200'>Undo</span><span class='block text-[9px] text-zinc-400'>Revert</span></button>`;
    promptEl.insertAdjacentElement('afterend', bar);
    $('mfExpandBtn').onclick = expandPromptWithLLM;
    $('mfUndoPromptBtn').onclick = () => { if (prevPromptBackup) { $('promptIn').value = prevPromptBackup; $('mfUndoPromptBtn').classList.add('hidden'); } };
  }

  async function expandPromptWithLLM() {
    const raw = $('promptIn').value.trim();
    if (!raw) return alert('Type a rough edit or scene idea first.');
    prevPromptBackup = raw;
    const btn = $('mfExpandBtn');
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Enhancing via free LLM...';
    const isEdit = !$('imgUploadWrap')?.classList.contains('hidden');
    const sys = isEdit
      ? 'Rewrite this photo inpainting edit into concise comma-separated Stable Diffusion tags describing replacement garment/object, realistic skin texture, exact scene lighting match, photorealistic detail. Output ONLY tags.'
      : 'Expand this idea into a detailed photorealistic Stable Diffusion prompt with subject, lighting, lens, and texture. Output ONLY the prompt.';
    try {
      const r = await fetch(HORDE + '/generate/text/async', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: getKey(), 'Client-Agent': AGENT },
        body: JSON.stringify({ prompt: `${sys}\n\nRequest: ${raw}\nPrompt:`, params: { max_length: 120, max_context_length: 1024, temperature: 0.7, top_p: 0.9 } })
      });
      const d = await r.json();
      if (!r.ok || !d.id) throw new Error(d.message || 'Text workers busy');
      for (let i = 0; i < 15; i++) {
        await new Promise(res => setTimeout(res, 2000));
        const sr = await fetch(HORDE + '/generate/text/status/' + d.id, { headers: { 'Client-Agent': AGENT } });
        const st = await sr.json();
        if (st.done && st.generations?.[0]?.text) {
          const clean = st.generations[0].text.trim().replace(/^["']|["']$/g, '');
          if (clean) { $('promptIn').value = clean; $('mfUndoPromptBtn').classList.remove('hidden'); }
          break;
        }
      }
    } catch (e) { setDiag('Prompt enhancer busy: ' + e.message, true); }
    finally { btn.disabled = false; btn.querySelector('span').textContent = 'AI Context & Prompt Enhancer'; }
  }

  function pushUndo() {
    const mk = $('mfMaskCanvas');
    if (!mk || !mk.width) return;
    undoStack.push(mk.getContext('2d').getImageData(0, 0, mk.width, mk.height));
    if (undoStack.length > 15) undoStack.shift();
  }

  function checkMaskState() {
    const mk = $('mfMaskCanvas');
    if (!mk || !mk.width) { hasMask = false; updateMaskBadge(); return; }
    const d = mk.getContext('2d').getImageData(0, 0, mk.width, mk.height).data;
    let cnt = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 20) { cnt++; if (cnt > 5) break; }
    hasMask = cnt > 5;
    updateMaskBadge();
  }

  function updateMaskBadge() {
    const b = $('mfMaskBadge');
    const bg = $('mfBgCanvas');
    const dimTxt = bg?.width ? `${bg.width}x${bg.height}` : '';
    if (!b) return;
    if (hasMask) {
      b.textContent = `Inpaint ${dimTxt} • 0.85`;
      b.className = 'px-2 py-0.5 rounded bg-rose-600 text-[10px] font-black text-white';
      if ($('denoiseIn') && Number($('denoiseIn').value) < 0.78) {
        $('denoiseIn').value = '0.85';
        if ($('denoiseVal')) $('denoiseVal').textContent = '0.85';
      }
    } else {
      b.textContent = `Full Edit ${dimTxt}`;
      b.className = 'px-2 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300';
    }
  }

  function magicWandFill(startX, startY) {
    const bg = $('mfBgCanvas'), mk = $('mfMaskCanvas');
    const w = bg.width, h = bg.height;
    const sx = Math.max(0, Math.min(w - 1, Math.round(startX)));
    const sy = Math.max(0, Math.min(h - 1, Math.round(startY)));
    const bgD = bg.getContext('2d').getImageData(0, 0, w, h).data;
    const mkCtx = mk.getContext('2d');
    const mkImg = mkCtx.getImageData(0, 0, w, h);
    const mkD = mkImg.data;
    const p0 = (sy * w + sx) * 4;
    const r0 = bgD[p0], g0 = bgD[p0 + 1], b0 = bgD[p0 + 2];
    const tolSq = (wandTol * 2.4) ** 2;
    const vis = new Uint8Array(w * h);
    const q = new Int32Array(w * h);
    let head = 0, tail = 0;
    const startIdx = sy * w + sx;
    vis[startIdx] = 1;
    q[tail++] = startIdx;
    const erasing = $('mfWandSubChk')?.checked;

    while (head < tail) {
      const idx = q[head++];
      const off = idx * 4;
      if (erasing) { mkD[off + 3] = 0; } else { mkD[off] = 255; mkD[off + 1] = 42; mkD[off + 2] = 109; mkD[off + 3] = 255; }
      const x = idx % w, y = (idx / w) | 0;
      const nbs = [];
      if (x > 0) nbs.push(idx - 1);
      if (x + 1 < w) nbs.push(idx + 1);
      if (y > 0) nbs.push(idx - w);
      if (y + 1 < h) nbs.push(idx + w);
      for (let i = 0; i < nbs.length; i++) {
        const ni = nbs[i];
        if (vis[ni]) continue;
        const no = ni * 4;
        const dr = bgD[no] - r0, dg = bgD[no + 1] - g0, db = bgD[no + 2] - b0;
        if (dr * dr + dg * dg + db * db <= tolSq) {
          vis[ni] = 1;
          q[tail++] = ni;
        }
      }
    }
    mkCtx.putImageData(mkImg, 0, 0);
    checkMaskState();
    setDiag(`Magic Wand ${erasing ? 'removed' : 'selected'} ${tail.toLocaleString()} pixels (Spread ${wandTol}). Tap another spot to add more!`);
  }

  function renderLoadedImage(img) {
    rawLoadedImg = img;
    const bg = $('mfBgCanvas'), mk = $('mfMaskCanvas'), ov = $('mfOvCanvas');
    if (!bg || !mk || !ov) return;
    const [nw, nh] = calcSafeDims(img.naturalWidth || 512, img.naturalHeight || 512);
    bg.width = mk.width = ov.width = nw;
    bg.height = mk.height = ov.height = nh;
    bg.getContext('2d').drawImage(img, 0, 0, nw, nh);
    mk.getContext('2d').clearRect(0, 0, nw, nh);
    ov.getContext('2d').clearRect(0, 0, nw, nh);
    undoStack = [];
    hasMask = false;
    updateMaskBadge();
    $('mfMaskStudio')?.classList.remove('hidden');
    setDiag(`Photo ready & scaled to ${nw}x${nh} (${hdMode ? 'HD' : 'Free Safe Mode'}). Tap the shirt with Magic Wand or Circle it!`);
  }

  function loadBlobIntoEditor(blob) {
    const fr = new FileReader();
    fr.onload = () => {
      const prev = $('sourcePreview');
      if (prev) prev.src = fr.result;
      $('clearSourceBtn')?.classList.remove('hidden');
      const img = new Image();
      img.onload = () => renderLoadedImage(img);
      img.src = fr.result;
    };
    fr.readAsDataURL(blob);
  }

  async function pasteFromClipboard() {
    try {
      if (!navigator.clipboard?.read) throw new Error('Use long-press Paste or pick from gallery');
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const imgType = it.types.find(t => t.startsWith('image/'));
        if (imgType) { loadBlobIntoEditor(await it.getType(imgType)); return; }
      }
      setDiag('No image found in clipboard. Copy a photo first, then tap Paste.', true);
    } catch (e) {
      setDiag('Clipboard notice: ' + e.message + ' — or tap anywhere & paste.', true);
    }
  }

  function mountMaskEditor() {
    const wrap = $('imgUploadWrap');
    const prev = $('sourcePreview');
    if (!wrap || !prev || $('mfMaskStudio')) return;

    const pasteRow = document.createElement('div');
    pasteRow.className = 'grid grid-cols-2 gap-1.5';
    pasteRow.innerHTML = `<button id='mfPasteImgBtn' type='button' class='py-2 px-2.5 rounded-xl bg-fuchsia-600/30 border border-fuchsia-400/50 text-left'><span class='block text-xs font-black text-fuchsia-200'>📋 Paste Image</span><span class='block text-[9px] text-fuchsia-300/80'>From clipboard / Photos</span></button><button id='mfHdToggleBtn' type='button' class='py-2 px-2.5 rounded-xl bg-zinc-950 border border-zinc-700 text-left'><span id='mfHdLbl' class='block text-xs font-black text-emerald-300'>Safe 512px (Free)</span><span class='block text-[9px] text-zinc-400'>Prevents Kudos errors</span></button>`;
    prev.insertAdjacentElement('beforebegin', pasteRow);

    const box = document.createElement('div');
    box.id = 'mfMaskStudio';
    box.className = 'hidden space-y-2.5 pt-2 border-t border-zinc-800';
    box.innerHTML = `<div class='flex items-center justify-between gap-2'><div><div class='text-xs font-black text-rose-300'>Smart Photo Selector (Zero Tracing)</div><div id='mfToolTip' class='text-[10px] text-zinc-400'>Tap once on a shirt or object to auto-select it!</div></div><span id='mfMaskBadge' class='px-2 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300'>Ready</span></div>
      <div class='grid grid-cols-5 gap-1'>
        <button data-tl='wand' type='button' class='mf-tl p-1.5 rounded-lg border text-center bg-rose-600/30 border-rose-400'><span class='block text-xs font-black text-white'>🪄 Tap</span><span class='block text-[8px] text-rose-200'>Wand</span></button>
        <button data-tl='circle' type='button' class='mf-tl p-1.5 rounded-lg border text-center bg-zinc-950 border-zinc-800'><span class='block text-xs font-black text-zinc-200'>⭕ Loop</span><span class='block text-[8px] text-zinc-400'>Circle</span></button>
        <button data-tl='box' type='button' class='mf-tl p-1.5 rounded-lg border text-center bg-zinc-950 border-zinc-800'><span class='block text-xs font-black text-zinc-200'>🔲 Box</span><span class='block text-[8px] text-zinc-400'>Drag</span></button>
        <button data-tl='brush' type='button' class='mf-tl p-1.5 rounded-lg border text-center bg-zinc-950 border-zinc-800'><span class='block text-xs font-black text-zinc-200'>🖌️ Draw</span><span class='block text-[8px] text-zinc-400'>Brush</span></button>
        <button data-tl='erase' type='button' class='mf-tl p-1.5 rounded-lg border text-center bg-zinc-950 border-zinc-800'><span class='block text-xs font-black text-zinc-200'>🧽 Rub</span><span class='block text-[8px] text-zinc-400'>Erase</span></button>
      </div>
      <div class='relative w-full rounded-xl overflow-hidden border border-rose-500/40 bg-black flex justify-center select-none'>
        <canvas id='mfBgCanvas' class='max-w-full max-h-80 block'></canvas>
        <canvas id='mfMaskCanvas' class='max-w-full max-h-80 block absolute inset-0 m-auto touch-none opacity-65'></canvas>
        <canvas id='mfOvCanvas' class='max-w-full max-h-80 block absolute inset-0 m-auto pointer-events-none'></canvas>
      </div>
      <div class='grid grid-cols-4 gap-1.5'>
        <button id='mfUndoMaskBtn' type='button' class='py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-[10px] font-black text-white'>↩️ Undo</button>
        <button id='mfMaskInvert' type='button' class='py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-[10px] font-black text-cyan-300'>🔄 Invert</button>
        <button id='mfMaskClear' type='button' class='py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-[10px] font-black text-amber-300'>🗑️ Clear</button>
        <label class='flex items-center justify-center gap-1 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-[10px] font-bold text-rose-300 cursor-pointer'><input id='mfWandSubChk' type='checkbox' class='accent-rose-500'>Subtract</label>
      </div>
      <div class='grid grid-cols-2 gap-2'>
        <div id='mfWandBar'><div class='flex justify-between text-[10px]'><span class='font-bold text-zinc-300'>Tap Spread</span><span id='mfTolVal' class='font-mono text-rose-300'>40</span></div><input id='mfTolIn' type='range' min='12' max='95' value='40' class='w-full accent-rose-500'></div>
        <div><div class='flex justify-between text-[10px]'><span class='font-bold text-zinc-300'>Edge Blend</span><span id='mfExpVal' class='font-mono text-cyan-300'>+8px</span></div><input id='mfExpIn' type='range' min='0' max='18' value='8' class='w-full accent-cyan-500'></div>
      </div>
      <div id='mfBrushBar' class='hidden'><div class='flex justify-between text-[10px]'><span class='font-bold text-zinc-300'>Brush Size</span><span id='mfBrushSzVal' class='font-mono text-rose-300'>26px</span></div><input id='mfBrushSzIn' type='range' min='8' max='72' value='26' class='w-full accent-rose-500'></div>
      <div class='flex flex-wrap gap-1'>
        <button type='button' data-qpr='wearing a stylish black fitted jacket, natural lighting, photorealistic' class='mf-qpr px-2 py-1 rounded-lg bg-zinc-950 border border-zinc-700 text-[10px] text-zinc-200'>Swap Top</button>
        <button type='button' data-qpr='wearing a red string bikini, natural sun-kissed skin texture, realistic anatomy, exact matching lighting, photorealistic' class='mf-qpr px-2 py-1 rounded-lg bg-zinc-950 border border-zinc-700 text-[10px] text-zinc-200'>Swimsuit → Bikini</button>
        <button type='button' data-qpr='clean empty natural background matching surroundings, seamless texture, photorealistic' class='mf-qpr px-2 py-1 rounded-lg bg-zinc-950 border border-zinc-700 text-[10px] text-zinc-200'>Remove Object</button>
      </div>
      <button id='mfZeroEditBtn' type='button' class='w-full py-2 px-3 rounded-xl bg-violet-950/80 border border-violet-400/50 text-left'><span class='block text-xs font-black text-violet-200'>⚡ Text-Only Edit (No Highlighting • ZeroGPU)</span><span class='block text-[9px] text-violet-300/80'>Sends photo + prompt to FLUX Kontext Space (SFW edits)</span></button>
      <div id='mfEditDiag' class='hidden'></div>`;

    prev.insertAdjacentElement('afterend', box);
    prev.classList.add('!hidden');

    $('mfPasteImgBtn').onclick = pasteFromClipboard;
    window.addEventListener('paste', e => {
      const items = e.clipboardData?.items || [];
      for (const it of items) { if (it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { $('modeImgBtn')?.click(); loadBlobIntoEditor(f); } break; } }
    });
    $('mfHdToggleBtn').onclick = () => {
      hdMode = !hdMode;
      $('mfHdLbl').textContent = hdMode ? 'HD 768px (Needs Key)' : 'Safe 512px (Free)';
      $('mfHdLbl').className = hdMode ? 'block text-xs font-black text-amber-300' : 'block text-xs font-black text-emerald-300';
      if (rawLoadedImg) renderLoadedImage(rawLoadedImg);
    };

    const tips = {
      wand: 'Tap once on a shirt or object to auto-select it! Tap again to add shaded parts.',
      circle: 'Draw a quick loose circle around the shirt — auto-fills inside when you lift!',
      box: 'Drag a simple rectangle over the area to replace.',
      brush: 'Smooth paint touch-up brush.',
      erase: 'Erase mask areas you want to keep 100% original.'
    };
    box.querySelectorAll('.mf-tl').forEach(b => b.onclick = () => {
      tool = b.dataset.tl;
      box.querySelectorAll('.mf-tl').forEach(x => x.className = x === b ? 'mf-tl p-1.5 rounded-lg border text-center bg-rose-600/30 border-rose-400' : 'mf-tl p-1.5 rounded-lg border text-center bg-zinc-950 border-zinc-800');
      $('mfToolTip').textContent = tips[tool] || '';
      $('mfBrushBar').classList.toggle('hidden', tool !== 'brush' && tool !== 'erase');
    });
    box.querySelectorAll('.mf-qpr').forEach(b => b.onclick = () => { if ($('promptIn')) $('promptIn').value = b.dataset.qpr; });

    const syncFromPreview = () => {
      if (!prev.src || prev.src === location.href) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => renderLoadedImage(img);
      img.src = prev.src;
    };
    new MutationObserver(syncFromPreview).observe(prev, { attributes: true, attributeFilter: ['src'] });
    if (prev.src && prev.src !== location.href) syncFromPreview();

    const mk = $('mfMaskCanvas'), ov = $('mfOvCanvas');
    let drawing = false, pts = [], lastPt = null, startPt = null;
    const getPt = e => { const r = mk.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * mk.width, y: ((e.clientY - r.top) / r.height) * mk.height }; };

    mk.onpointerdown = e => {
      const pt = getPt(e);
      pushUndo();
      if (tool === 'wand') { magicWandFill(pt.x, pt.y); return; }
      drawing = true;
      mk.setPointerCapture(e.pointerId);
      startPt = lastPt = pt;
      pts = [pt];
      if (tool === 'brush' || tool === 'erase') {
        const ctx = mk.getContext('2d');
        ctx.save();
        ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
        ctx.fillStyle = '#ff2a6d';
        ctx.beginPath(); ctx.arc(pt.x, pt.y, (brushSize / 2) * (mk.width / 320), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    };
    mk.onpointermove = e => {
      if (!drawing) return;
      const pt = getPt(e);
      if (tool === 'brush' || tool === 'erase') {
        const ctx = mk.getContext('2d');
        ctx.save();
        ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
        ctx.strokeStyle = '#ff2a6d'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineWidth = brushSize * (mk.width / 320);
        ctx.beginPath(); ctx.moveTo(lastPt.x, lastPt.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
        ctx.restore();
        lastPt = pt;
      } else if (tool === 'circle') {
        pts.push(pt);
        const octx = ov.getContext('2d');
        octx.clearRect(0, 0, ov.width, ov.height);
        octx.strokeStyle = '#38bdf8'; octx.lineWidth = 3; octx.setLineDash([6, 4]);
        octx.beginPath(); octx.moveTo(pts[0].x, pts[0].y);
        pts.forEach(p => octx.lineTo(p.x, p.y));
        octx.stroke();
      } else if (tool === 'box') {
        const octx = ov.getContext('2d');
        octx.clearRect(0, 0, ov.width, ov.height);
        octx.strokeStyle = '#38bdf8'; octx.lineWidth = 3; octx.fillStyle = 'rgba(56,189,248,0.22)';
        octx.fillRect(startPt.x, startPt.y, pt.x - startPt.x, pt.y - startPt.y);
        octx.strokeRect(startPt.x, startPt.y, pt.x - startPt.x, pt.y - startPt.y);
        lastPt = pt;
      }
    };
    mk.onpointerup = e => {
      if (!drawing) return;
      drawing = false;
      if (mk.hasPointerCapture(e.pointerId)) mk.releasePointerCapture(e.pointerId);
      const erasing = $('mfWandSubChk')?.checked;
      if (tool === 'circle' && pts.length > 2) {
        ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
        const ctx = mk.getContext('2d');
        ctx.save();
        ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
        ctx.fillStyle = '#ff2a6d';
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        pts.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath(); ctx.fill(); ctx.restore();
      } else if (tool === 'box' && startPt && lastPt) {
        ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
        const ctx = mk.getContext('2d');
        ctx.save();
        ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
        ctx.fillStyle = '#ff2a6d';
        ctx.fillRect(startPt.x, startPt.y, lastPt.x - startPt.x, lastPt.y - startPt.y);
        ctx.restore();
      }
      checkMaskState();
    };

    $('mfTolIn').oninput = e => { wandTol = Number(e.target.value); $('mfTolVal').textContent = wandTol; };
    $('mfExpIn').oninput = e => { expandPx = Number(e.target.value); $('mfExpVal').textContent = '+' + expandPx + 'px'; };
    $('mfBrushSzIn').oninput = e => { brushSize = Number(e.target.value); $('mfBrushSzVal').textContent = brushSize + 'px'; };
    $('mfUndoMaskBtn').onclick = () => { if (!undoStack.length) return; mk.getContext('2d').putImageData(undoStack.pop(), 0, 0); checkMaskState(); };
    $('mfMaskClear').onclick = () => { pushUndo(); mk.getContext('2d').clearRect(0, 0, mk.width, mk.height); checkMaskState(); };
    $('mfMaskInvert').onclick = () => {
      pushUndo();
      const ctx = mk.getContext('2d'), imgD = ctx.getImageData(0, 0, mk.width, mk.height), d = imgD.data;
      for (let i = 0; i < d.length; i += 4) {
        const on = d[i + 3] > 20;
        d[i] = on ? 0 : 255; d[i + 1] = on ? 0 : 42; d[i + 2] = on ? 0 : 109; d[i + 3] = on ? 0 : 255;
      }
      ctx.putImageData(imgD, 0, 0); checkMaskState();
    };
    $('mfZeroEditBtn').onclick = runZeroGpuTextEdit;
    $('clearSourceBtn')?.addEventListener('click', () => { $('mfMaskStudio').classList.add('hidden'); hasMask = false; rawLoadedImg = null; });
  }

  async function runZeroGpuTextEdit() {
    const bg = $('mfBgCanvas');
    const prompt = $('promptIn')?.value.trim();
    if (!bg?.width || !prompt) return alert('Load/paste a photo and type what to change first.');
    setDiag('Connecting to ZeroGPU FLUX.1-Kontext Space (no mask needed)...');
    try {
      const blob = await new Promise(res => bg.toBlob(res, 'image/png'));
      const { Client, handle_file } = await import('https://esm.sh/@gradio/client');
      const client = await Client.connect('black-forest-labs/FLUX.1-Kontext-dev');
      const api = await client.view_api();
      const entries = Object.entries(api.named_endpoints || {});
      const [epName, ep] = entries.find(([k]) => /infer|gen|edit|pred/i.test(k)) || entries[0];
      setDiag(`Mapped ${epName}. Running instruction edit on ZeroGPU...`);
      const args = ep.parameters.map(p => {
        const nm = ((p.parameter_name || p.label || '') + ' ' + (p.component || '')).toLowerCase();
        if (/image|file/.test(nm)) return handle_file(blob);
        if (/prompt|text|inst/.test(nm)) return prompt;
        if (/random/.test(nm)) return true;
        return p.parameter_default !== undefined ? p.parameter_default : null;
      });
      const res = await client.predict(epName, args);
      const findUrl = o => { if (!o) return ''; if (typeof o === 'string' && /^https?:/.test(o)) return o; if (o.url) return o.url; if (typeof o === 'object') { for (const v of Object.values(o)) { const h = findUrl(v); if (h) return h; } } return ''; };
      const url = findUrl(res.data);
      if (!url) throw new Error('No image URL returned from Space.');
      setDiag('ZeroGPU Edit finished! Saved to Vault.');
      if (window.MediaForge?.addVaultItem) window.MediaForge.addVaultItem({ id: 'v_' + Date.now(), url, prompt, model: 'FLUX.1-Kontext', seed: '', worker: 'ZeroGPU', ts: new Date().toLocaleTimeString() });
      window.open(url, '_blank');
    } catch (e) { setDiag('ZeroGPU busy/capped: ' + e.message + ' — use main Generate button for AI Horde Inpaint.', true); }
  }

  function exportBinaryMaskB64() {
    const mk = $('mfMaskCanvas');
    if (!mk || !hasMask) return '';
    const w = mk.width, h = mk.height;
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    if (expandPx > 0) tctx.filter = `blur(${Math.max(1, Math.round(expandPx * 0.65))}px)`;
    tctx.drawImage(mk, 0, 0);
    const src = tctx.getImageData(0, 0, w, h).data;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const octx = out.getContext('2d');
    const dstImg = octx.createImageData(w, h);
    const dst = dstImg.data;
    let painted = 0;
    for (let i = 0; i < src.length; i += 4) {
      const on = src[i + 3] > 14;
      const v = on ? 255 : 0;
      if (on) painted++;
      dst[i] = v; dst[i + 1] = v; dst[i + 2] = v; dst[i + 3] = 255;
    }
    if (painted < 15) return '';
    octx.putImageData(dstImg, 0, 0);
    return out.toDataURL('image/webp', 0.9).split(',')[1];
  }

  async function syncModelsCache() {
    try {
      const r = await fetch(HORDE + '/status/models?type=image', { headers: { 'Client-Agent': AGENT } });
      allCachedModels = (await r.json()).filter(m => m.count > 0).sort((a, b) => b.count - a.count);
    } catch {}
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.includes('/api/v2/generate/async') && init?.body) {
      try {
        const payload = JSON.parse(init.body);
        const isAnon = getKey() === '0000000000';
        payload.params = payload.params || {};
        if (payload.source_image) {
          const bg = $('mfBgCanvas');
          if (bg && bg.width) {
            payload.source_image = bg.toDataURL('image/webp', 0.85).split(',')[1];
            payload.params.width = bg.width;
            payload.params.height = bg.height;
          }
          const maskB64 = exportBinaryMaskB64();
          if (maskB64) {
            payload.source_mask = maskB64;
            payload.source_processing = 'inpainting';
            payload.params.denoising_strength = Math.max(0.75, Number(payload.params.denoising_strength || 0.85));
            if (payload.models?.[0] && /flux|chroma|sd3|hidream/i.test(payload.models[0])) delete payload.models;
            if (!payload.models && allCachedModels.length) {
              const inp = allCachedModels.find(m => /inpaint/i.test(m.name) && m.count >= 2) || allCachedModels.find(m => /epicrealism|realistic|deliberate|icbinp/i.test(m.name) && m.count >= 2);
              if (inp) payload.models = [inp.name];
            }
          }
        }
        if (isAnon) {
          payload.params.width = Math.min(512, Math.max(256, Math.round((payload.params.width || 512) / 64) * 64));
          payload.params.height = Math.min(512, Math.max(256, Math.round((payload.params.height || 512) / 64) * 64));
          payload.params.steps = Math.min(22, Number(payload.params.steps || 20));
          payload.params.karras = false;
        }
        init = { ...init, body: JSON.stringify(payload) };
      } catch {}
      const res = await origFetch(input, init);
      if (!res.ok) {
        try {
          const clone = res.clone();
          const err = await clone.json();
          setDiag(`AI Horde HTTP ${res.status} (${err.rc || 'Error'}): ${err.message || JSON.stringify(err.errors || err)}`, true);
        } catch {}
      } else {
        setDiag('Dispatched cleanly to AI Horde! Watch progress in the Queue tab.');
      }
      return res;
    }
    return origFetch(input, init);
  };

  mountPromptExpander();
  mountMaskEditor();
  syncModelsCache();
})();