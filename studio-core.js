(() => {
  const $ = id => document.getElementById(id);
  const HORDE = 'https://aihorde.net/api/v2';
  const AGENT = 'MediaForge:4.0:badpeachring';
  const CFG_KEY = 'media_forge_cfg_v1';
  const Q_KEY = 'media_forge_queue_v1';
  const V_KEY = 'media_forge_vault_v1';
  const SDXL_RE = /xl|illustrious|pony|flux|chroma|sd3|hidream|noobai|wai-nsfw/i;

  let cfg = (() => { try { return { apiKey: '0000000000', ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return { apiKey: '0000000000' }; } })();
  let queue = (() => { try { return JSON.parse(localStorage.getItem(Q_KEY) || '[]'); } catch { return []; } })();
  let vault = (() => { try { return JSON.parse(localStorage.getItem(V_KEY) || '[]'); } catch { return []; } })();
  let kudos = 0, liveWorkers = [], fastWorkers = [], activePreset = null, mode = 'txt2img';
  let tool = 'wand', brushSize = 26, wandTol = 42, expandPx = 8, hdMode = false, hasMask = false;
  let undoStack = [], rawImg = null, prevPromptBackup = '', lastResult = null;

  const saveCfg = () => localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  const saveQ = () => localStorage.setItem(Q_KEY, JSON.stringify(queue.slice(0, 30)));
  const saveV = () => localStorage.setItem(V_KEY, JSON.stringify(vault.slice(0, 25)));
  const getKey = () => (cfg.apiKey || '').trim() || '0000000000';

  const PRESETS = [
    { id: 'surgical_edit', title: '🖌️ Photo Edit', sub: 'Tap/Circle mask • 0.85', color: 'from-cyan-600/35 to-sky-950/60 border-cyan-400', mode: 'img2img', size: '512x512', sampler: 'k_euler_a', steps: 20, cfg: 7, denoise: 0.85, rx: /inpaint|epicrealism|deliberate|realistic|dreamshaper|icbinp/i, prefix: 'seamless edit, matching lighting and style, ', neg: 'mismatch lighting, seam, blurry, deformed, bad anatomy, watermark' },
    { id: '3d_char', title: '🎮 3D Character', sub: 'UE5 / Octane • 20st', color: 'from-fuchsia-600/35 to-purple-950/60 border-fuchsia-400', mode: 'txt2img', size: '512x512', sampler: 'k_euler_a', steps: 20, cfg: 7, rx: /dreamshaper|epicrealism|deliberate|absolutereality|realistic/i, prefix: 'hyper-realistic 3D character render, Unreal Engine 5 MetaHuman, Octane render, subsurface skin scattering, volumetric lighting, ', neg: '2d, flat, sketch, blurry, deformed anatomy, extra fingers, watermark' },
    { id: 'raw_photo', title: '📸 Raw 35mm', sub: 'DSLR skin • DPM++ 2M', color: 'from-emerald-600/30 to-teal-950/60 border-emerald-400', mode: 'txt2img', size: '512x512', sampler: 'k_dpmpp_2m', steps: 20, cfg: 6.5, rx: /epicrealism|realistic|cyberrealistic|absolutereality|icbinp|deliberate/i, prefix: 'candid 35mm DSLR photograph, natural lighting, realistic skin pores, sharp focus, ', neg: '3d render, cgi, plastic skin, cartoon, blurry, watermark' },
    { id: 'rapid_draft', title: '⚡ 10s Draft', sub: 'Fastest Horde GPU', color: 'from-amber-600/30 to-orange-950/60 border-amber-400', mode: 'txt2img', size: '512x512', sampler: 'k_euler_a', steps: 14, cfg: 6.5, rx: /./, prefix: '', neg: 'blurry, lowres, deformed, watermark' }
  ];

  const setDiag = (msg, isErr = false) => {
    const el = $('mfEditDiag');
    if (!el) return;
    el.classList.remove('hidden');
    el.className = `p-2 rounded-lg text-[10px] font-mono break-words border ${isErr ? 'bg-rose-950/80 border-rose-500/50 text-rose-200' : 'bg-zinc-950 border-cyan-500/40 text-cyan-200'}`;
    el.textContent = msg;
  };

  function switchTab(tab) {
    ['image', 'video', 'queue', 'vault', 'custom'].forEach(t => $('view-' + t)?.classList.toggle('hidden', t !== tab));
    document.querySelectorAll('.mf-tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.className = on ? 'mf-tab px-1 py-1.5 rounded-xl bg-fuchsia-500/20 border border-fuchsia-400/50 text-fuchsia-200 text-center' : 'mf-tab px-1 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 text-center';
    });
    if (tab === 'queue') renderQueue();
    if (tab === 'vault') renderVault();
    updateQBadge();
  }

  function setMode(m) {
    mode = m;
    const isImg = m === 'img2img';
    $('imgUploadWrap').classList.toggle('hidden', !isImg);
    $('mfEditTip').classList.toggle('hidden', !isImg);
    $('modeTxtBtn').className = !isImg ? 'p-2.5 rounded-xl border bg-fuchsia-600/20 border-fuchsia-400 text-left' : 'p-2.5 rounded-xl border bg-zinc-900 border-zinc-800 text-left';
    $('modeImgBtn').className = isImg ? 'p-2.5 rounded-xl border bg-cyan-600/20 border-cyan-400 text-left' : 'p-2.5 rounded-xl border bg-zinc-900 border-zinc-800 text-left';
  }

  async function syncWorkersAndKudos() {
    const k = getKey();
    if (k !== '0000000000') {
      try {
        const ur = await fetch(HORDE + '/find_user', { headers: { apikey: k, 'Client-Agent': AGENT } });
        if (ur.ok) { const u = await ur.json(); kudos = Number(u.kudos || 0); }
      } catch {}
    } else { kudos = 0; }
    $('kudosBadge').textContent = kudos >= 50 ? `${Math.round(kudos)} Kudos` : 'Free Safe Mode';
    try {
      const r = await fetch(HORDE + '/status/models?type=image', { headers: { 'Client-Agent': AGENT } });
      const raw = await r.json();
      liveWorkers = (Array.isArray(raw) ? raw : []).filter(m => m.count > 0).sort((a, b) => (a.eta || 999) - (b.eta || 999));
      fastWorkers = liveWorkers.filter(m => !SDXL_RE.test(m.name));
      const pool = kudos < 50 ? fastWorkers : liveWorkers;
      $('modelSelect').innerHTML = '<option value="AUTO">Auto (Fastest Native-512px GPU)</option>' + pool.slice(0, 40).map(m => `<option value="${m.name.replaceAll('"', '&quot;')}">${m.name} (~${m.eta}s • ${m.count} GPUs)</option>`).join('');
    } catch {}
    renderPresets();
  }

  function pickFastModel(rx, preferInpaint = false) {
    const pool = kudos < 50 ? fastWorkers : liveWorkers;
    if (preferInpaint) {
      const inp = pool.find(m => /inpaint/i.test(m.name) && (m.eta || 999) < 180);
      if (inp) return inp.name;
    }
    const hit = pool.find(m => rx.test(m.name)) || pool[0];
    return hit ? hit.name : 'Deliberate';
  }

  function renderPresets(chosen = '') {
    $('mfOverdriveGrid').innerHTML = PRESETS.map(p => {
      const on = activePreset?.id === p.id;
      return `<button type='button' data-od='${p.id}' class='p-2.5 rounded-xl border text-left bg-gradient-to-br ${on ? p.color + ' ring-2 ring-white/60' : 'from-zinc-950 to-zinc-900 border-zinc-800'}'><div class='flex items-center justify-between'><span class='text-xs font-black text-white'>${p.title}</span>${on ? `<span class='px-1.5 py-0.5 rounded bg-black/60 text-[8px] font-black text-emerald-300'>ON</span>` : ''}</div><div class='text-[10px] text-zinc-300/85 mt-0.5'>${p.sub}</div></button>`;
    }).join('');
    $('mfOverdriveGrid').querySelectorAll('[data-od]').forEach(b => b.onclick = () => {
      const p = PRESETS.find(x => x.id === b.dataset.od);
      if (!p) return;
      activePreset = p;
      setMode(p.mode);
      $('sizePreset').value = kudos < 50 ? '512x512' : p.size;
      $('samplerIn').value = p.sampler;
      $('stepsIn').value = String(kudos < 50 ? Math.min(20, p.steps) : p.steps);
      $('stepsVal').textContent = $('stepsIn').value;
      $('cfgIn').value = String(p.cfg); $('cfgVal').textContent = String(p.cfg);
      if (p.denoise) { $('denoiseIn').value = String(p.denoise); $('denoiseVal').textContent = String(p.denoise); }
      $('negPromptIn').value = p.neg;
      const mName = pickFastModel(p.rx, p.id === 'surgical_edit');
      if (Array.from($('modelSelect').options).some(o => o.value === mName)) $('modelSelect').value = mName;
      renderPresets(mName);
    });
    const kTxt = kudos < 50 ? 'Free Safe (512px/20st)' : `${Math.round(kudos)} Kudos`;
    $('mfOverdriveHud').textContent = activePreset ? `ARMED: ${activePreset.title} • ${chosen || $('modelSelect').value} • ${kTxt}` : `Ready (${fastWorkers.length} fast GPUs) • ${kTxt}`;
  }

  function calcDims(w, h) {
    const maxS = hdMode ? 768 : 512;
    const s = Math.min(maxS / Math.max(w, h), 1);
    return [Math.min(maxS, Math.max(256, Math.round((w * s) / 64) * 64)), Math.min(maxS, Math.max(256, Math.round((h * s) / 64) * 64))];
  }

  function renderPhotoToCanvas(img) {
    rawImg = img;
    const bg = $('mfBgCanvas'), mk = $('mfMaskCanvas'), ov = $('mfOvCanvas');
    const [nw, nh] = calcDims(img.naturalWidth || 512, img.naturalHeight || 512);
    bg.width = mk.width = ov.width = nw; bg.height = mk.height = ov.height = nh;
    bg.getContext('2d').drawImage(img, 0, 0, nw, nh);
    mk.getContext('2d').clearRect(0, 0, nw, nh);
    ov.getContext('2d').clearRect(0, 0, nw, nh);
    undoStack = []; hasMask = false;
    $('mfNoImgHint').classList.add('hidden');
    $('mfCanvasWrap').classList.remove('hidden');
    $('clearSourceBtn').classList.remove('hidden');
    updateMaskBadge();
    setDiag(`Loaded (${nw}x${nh}). Tap directly on the shirt/object with 🪄 Tap Wand, or draw a quick ⭕ Loop!`);
  }

  function loadBlob(blob) {
    const fr = new FileReader();
    fr.onload = () => { const img = new Image(); img.onload = () => renderPhotoToCanvas(img); img.src = fr.result; };
    fr.readAsDataURL(blob);
  }

  function loadUrlIntoEditor(url) {
    setMode('img2img');
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => renderPhotoToCanvas(img);
    img.src = url;
  }

  function pushUndo() {
    const mk = $('mfMaskCanvas'); if (!mk.width) return;
    undoStack.push(mk.getContext('2d').getImageData(0, 0, mk.width, mk.height));
    if (undoStack.length > 15) undoStack.shift();
  }

  function updateMaskBadge() {
    const bg = $('mfBgCanvas');
    if (!bg.width) { $('mfMaskBadge').textContent = 'No Photo Loaded'; return; }
    if (hasMask) {
      $('mfMaskBadge').textContent = `Inpaint ${bg.width}x${bg.height} • 0.85`;
      $('mfMaskBadge').className = 'px-2 py-0.5 rounded bg-rose-600 text-[10px] font-black text-white';
      if (Number($('denoiseIn').value) < 0.78) { $('denoiseIn').value = '0.85'; $('denoiseVal').textContent = '0.85'; }
    } else {
      $('mfMaskBadge').textContent = `Photo ${bg.width}x${bg.height} (No Mask)`;
      $('mfMaskBadge').className = 'px-2 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300';
    }
  }

  function checkMask() {
    const mk = $('mfMaskCanvas'); if (!mk.width) { hasMask = false; updateMaskBadge(); return; }
    const d = mk.getContext('2d').getImageData(0, 0, mk.width, mk.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 20) { n++; if (n > 4) break; }
    hasMask = n > 4; updateMaskBadge();
  }

  function wandFill(sx0, sy0) {
    const bg = $('mfBgCanvas'), mk = $('mfMaskCanvas');
    const w = bg.width, h = bg.height;
    const sx = Math.max(0, Math.min(w - 1, Math.round(sx0))), sy = Math.max(0, Math.min(h - 1, Math.round(sy0)));
    const bgD = bg.getContext('2d').getImageData(0, 0, w, h).data;
    const mCtx = mk.getContext('2d'), mImg = mCtx.getImageData(0, 0, w, h), mD = mImg.data;
    const p0 = (sy * w + sx) * 4, r0 = bgD[p0], g0 = bgD[p0 + 1], b0 = bgD[p0 + 2];
    const tolSq = (wandTol * 2.4) ** 2, vis = new Uint8Array(w * h), q = new Int32Array(w * h);
    let hd = 0, tl = 0; const st = sy * w + sx; vis[st] = 1; q[tl++] = st;
    const sub = $('mfWandSubChk').checked;
    while (hd < tl) {
      const idx = q[hd++], o = idx * 4;
      if (sub) mD[o + 3] = 0; else { mD[o] = 255; mD[o + 1] = 42; mD[o + 2] = 109; mD[o + 3] = 255; }
      const x = idx % w, y = (idx / w) | 0;
      const nbs = []; if (x > 0) nbs.push(idx - 1); if (x + 1 < w) nbs.push(idx + 1); if (y > 0) nbs.push(idx - w); if (y + 1 < h) nbs.push(idx + w);
      for (let i = 0; i < nbs.length; i++) {
        const ni = nbs[i]; if (vis[ni]) continue;
        const no = ni * 4, dr = bgD[no] - r0, dg = bgD[no + 1] - g0, db = bgD[no + 2] - b0;
        if (dr * dr + dg * dg + db * db <= tolSq) { vis[ni] = 1; q[tl++] = ni; }
      }
    }
    mCtx.putImageData(mImg, 0, 0); checkMask();
    setDiag(`🪄 ${sub ? 'Erased' : 'Highlighted'} ${tl.toLocaleString()} px (Spread ${wandTol}). Tap again to grab shaded folds, or ↩️ Undo.`);
  }

  function exportMaskPngB64() {
    const mk = $('mfMaskCanvas'); if (!mk.width || !hasMask) return '';
    const w = mk.width, h = mk.height;
    const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    if (expandPx > 0) tctx.filter = `blur(${Math.max(1, Math.round(expandPx * 0.65))}px)`;
    tctx.drawImage(mk, 0, 0);
    const src = tctx.getImageData(0, 0, w, h).data;
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const octx = out.getContext('2d'), dstImg = octx.createImageData(w, h), dst = dstImg.data;
    let px = 0;
    for (let i = 0; i < src.length; i += 4) {
      const on = src[i + 3] > 14, v = on ? 255 : 0; if (on) px++;
      dst[i] = v; dst[i + 1] = v; dst[i + 2] = v; dst[i + 3] = 255;
    }
    if (px < 15) return '';
    octx.putImageData(dstImg, 0, 0);
    return out.toDataURL('image/png').split(',')[1];
  }

  function initCanvasEvents() {
    const mk = $('mfMaskCanvas'), ov = $('mfOvCanvas');
    let drawing = false, pts = [], last = null, start = null;
    const ptOf = e => { const r = mk.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * mk.width, y: ((e.clientY - r.top) / r.height) * mk.height }; };
    mk.onpointerdown = e => {
      if (!mk.width) return;
      const p = ptOf(e); pushUndo();
      if (tool === 'wand') { wandFill(p.x, p.y); return; }
      drawing = true; mk.setPointerCapture(e.pointerId); start = last = p; pts = [p];
      if (tool === 'brush' || tool === 'erase') {
        const c = mk.getContext('2d'); c.save();
        c.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
        c.fillStyle = '#ff2a6d'; c.beginPath(); c.arc(p.x, p.y, (brushSize / 2) * (mk.width / 320), 0, Math.PI * 2); c.fill(); c.restore();
      }
    };
    mk.onpointermove = e => {
      if (!drawing) return;
      const p = ptOf(e);
      if (tool === 'brush' || tool === 'erase') {
        const c = mk.getContext('2d'); c.save();
        c.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
        c.strokeStyle = '#ff2a6d'; c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = brushSize * (mk.width / 320);
        c.beginPath(); c.moveTo(last.x, last.y); c.lineTo(p.x, p.y); c.stroke(); c.restore(); last = p;
      } else if (tool === 'circle') {
        pts.push(p); const o = ov.getContext('2d'); o.clearRect(0, 0, ov.width, ov.height);
        o.strokeStyle = '#38bdf8'; o.lineWidth = 3; o.setLineDash([6, 4]); o.beginPath(); o.moveTo(pts[0].x, pts[0].y); pts.forEach(q => o.lineTo(q.x, q.y)); o.stroke();
      } else if (tool === 'box') {
        const o = ov.getContext('2d'); o.clearRect(0, 0, ov.width, ov.height);
        o.strokeStyle = '#38bdf8'; o.lineWidth = 3; o.fillStyle = 'rgba(56,189,248,0.22)';
        o.fillRect(start.x, start.y, p.x - start.x, p.y - start.y); o.strokeRect(start.x, start.y, p.x - start.x, p.y - start.y); last = p;
      }
    };
    mk.onpointerup = e => {
      if (!drawing) return;
      drawing = false; if (mk.hasPointerCapture(e.pointerId)) mk.releasePointerCapture(e.pointerId);
      const sub = $('mfWandSubChk').checked;
      if (tool === 'circle' && pts.length > 2) {
        ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
        const c = mk.getContext('2d'); c.save(); c.globalCompositeOperation = sub ? 'destination-out' : 'source-over';
        c.fillStyle = '#ff2a6d'; c.beginPath(); c.moveTo(pts[0].x, pts[0].y); pts.forEach(q => c.lineTo(q.x, q.y)); c.closePath(); c.fill(); c.restore();
      } else if (tool === 'box' && start && last) {
        ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
        const c = mk.getContext('2d'); c.save(); c.globalCompositeOperation = sub ? 'destination-out' : 'source-over';
        c.fillStyle = '#ff2a6d'; c.fillRect(start.x, start.y, last.x - start.x, last.y - start.y); c.restore();
      }
      checkMask();
    };
  }

  function updateQBadge() {
    const act = queue.filter(j => j.state === 'queued' || j.state === 'processing');
    $('mfQBadge').textContent = `(${act.length})`;
    const onQ = !$('view-queue').classList.contains('hidden');
    if (act.length && !onQ) {
      $('mfFloatingQStrip').classList.remove('hidden');
      $('mfStripTitle').textContent = `${act.length} Active Job${act.length > 1 ? 's' : ''} Rendering`;
      $('mfStripSub').textContent = act[0].statusText;
    } else { $('mfFloatingQStrip').classList.add('hidden'); }
  }

  function addVaultItem(item) { vault.unshift(item); saveV(); renderVault(); }

  function showResult(item) {
    lastResult = item;
    $('resImg').src = item.url;
    $('resMeta').textContent = `${item.model} • Seed: ${item.seed || 'rnd'} • ${item.ts}`;
    $('resultCard').classList.remove('hidden');
  }

  function renderVault() {
    const g = $('mfVaultGrid');
    if (!vault.length) { g.innerHTML = `<div class='bg-zinc-900/80 border border-zinc-800 rounded-xl p-6 text-center text-xs text-zinc-500'>No saved renders yet.</div>`; return; }
    g.innerHTML = vault.map((v, i) => `<div class='bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 space-y-2'><img src='${v.url}' class='w-full rounded-lg bg-black max-h-80 object-contain'><div class='text-xs font-bold text-white line-clamp-2'>${(v.prompt || '').replaceAll('<', '&lt;')}</div><div class='text-[10px] font-mono text-zinc-400'>${v.model} • ${v.ts}</div><div class='grid grid-cols-3 gap-1.5'><button data-vdl='${i}' class='py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black'>Save</button><button data-ved='${i}' class='py-1.5 rounded-lg bg-cyan-600 text-white text-[10px] font-black'>Edit Photo</button><button data-vrm='${i}' class='py-1.5 rounded-lg bg-rose-950 text-rose-300 text-[10px] font-bold'>Delete</button></div></div>`).join('');
    g.querySelectorAll('[data-vdl]').forEach(b => b.onclick = () => window.open(vault[b.dataset.vdl].url, '_blank'));
    g.querySelectorAll('[data-ved]').forEach(b => b.onclick = () => { const v = vault[b.dataset.ved]; $('promptIn').value = v.prompt || ''; loadUrlIntoEditor(v.url); switchTab('image'); });
    g.querySelectorAll('[data-vrm]').forEach(b => b.onclick = () => { vault.splice(Number(b.dataset.vrm), 1); saveV(); renderVault(); });
  }

  function renderQueue() {
    updateQBadge();
    const box = $('mfQueueList');
    if (!queue.length) { box.innerHTML = `<div class='bg-zinc-900/80 border border-zinc-800 rounded-xl p-6 text-center text-xs text-zinc-500'>Queue is empty. Tap Generate in Image tab to stack jobs.</div>`; return; }
    box.innerHTML = queue.map((j, i) => {
      const run = j.state === 'queued' || j.state === 'processing';
      const pill = j.state === 'done' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : j.state === 'error' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' : 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      return `<div class='bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2'><div class='flex justify-between gap-2'><span class='px-2 py-0.5 rounded-full border text-[10px] font-black uppercase ${pill}'>${j.state}</span><span class='text-[10px] font-mono text-zinc-400 truncate'>${j.modeLabel} • ${j.size} • ${j.createdAt}</span></div><div class='text-xs font-bold text-white line-clamp-2'>${j.prompt.replaceAll('<', '&lt;')}</div><div class='text-[11px] font-mono ${j.state === 'error' ? 'text-rose-400' : 'text-cyan-300'}'>${j.statusText}</div>${j.imgUrl ? `<img src='${j.imgUrl}' class='w-full rounded-lg bg-black max-h-80 object-contain'><div class='grid grid-cols-3 gap-1.5'><button data-qdl='${i}' class='py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black'>Save</button><button data-qed='${i}' class='py-1.5 rounded-lg bg-cyan-600 text-white text-[10px] font-black'>Edit Photo</button><button data-qvd='${i}' class='py-1.5 rounded-lg bg-violet-600 text-white text-[10px] font-black'>To Video</button></div>` : ''}<div class='flex justify-end'>${run ? `<button data-qcn='${i}' class='px-2.5 py-1 rounded bg-rose-950 text-[10px] font-bold text-rose-300'>Cancel</button>` : `<button data-qrm='${i}' class='px-2.5 py-1 rounded bg-zinc-800 text-[10px] font-bold text-zinc-400'>Remove</button>`}</div></div>`;
    }).join('');
    box.querySelectorAll('[data-qdl]').forEach(b => b.onclick = () => window.open(queue[b.dataset.qdl].imgUrl, '_blank'));
    box.querySelectorAll('[data-qed]').forEach(b => b.onclick = () => { const j = queue[b.dataset.qed]; $('promptIn').value = j.prompt; loadUrlIntoEditor(j.imgUrl); switchTab('image'); });
    box.querySelectorAll('[data-qvd]').forEach(b => b.onclick = () => { const j = queue[b.dataset.qvd]; if (window.MediaForge?.onSendToVideo) { window.MediaForge.onSendToVideo(j.imgUrl, j.prompt); switchTab('video'); } });
    box.querySelectorAll('[data-qcn]').forEach(b => b.onclick = () => { const j = queue[b.dataset.qcn]; if (j.jobId) fetch(HORDE + '/generate/status/' + j.jobId, { method: 'DELETE', headers: { apikey: getKey(), 'Client-Agent': AGENT } }).catch(() => {}); j.state = 'error'; j.statusText = 'Cancelled'; saveQ(); renderQueue(); });
    box.querySelectorAll('[data-qrm]').forEach(b => b.onclick = () => { queue.splice(Number(b.dataset.qrm), 1); saveQ(); renderQueue(); });
  }

  async function toDataUrl(url) {
    if (!url.startsWith('http')) return url;
    try { const r = await fetch(url); const b = await r.blob(); return await new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => res(url); f.readAsDataURL(b); }); } catch { return url; }
  }

  function pollJob(job) {
    job._errs = 0;
    const tm = setInterval(async () => {
      if (job.state !== 'queued' && job.state !== 'processing') return clearInterval(tm);
      try {
        const cr = await fetch(HORDE + '/generate/check/' + job.jobId, { headers: { 'Client-Agent': AGENT } });
        if (!cr.ok) throw new Error('HTTP ' + cr.status);
        const ck = await cr.json(); job._errs = 0;
        if (ck.faulted) { clearInterval(tm); job.state = 'error'; job.statusText = 'Worker faulted — retry.'; saveQ(); renderQueue(); return; }
        if (!ck.done) { job.state = ck.processing ? 'processing' : 'queued'; job.statusText = `Queue #${ck.queue_position ?? '?'} • ~${ck.wait_time ?? '?'}s • ${ck.processing ? 'Rendering...' : 'Waiting'}`; saveQ(); renderQueue(); return; }
        clearInterval(tm); job.statusText = 'Downloading...'; renderQueue();
        const sr = await fetch(HORDE + '/generate/status/' + job.jobId, { headers: { 'Client-Agent': AGENT } });
        const st = await sr.json(); const g = st.generations?.[0];
        if (!g?.img) throw new Error('Empty worker response');
        if (g.censored) { job.state = 'error'; job.statusText = 'Blocked censored black frame from worker — try another model.'; saveQ(); renderQueue(); return; }
        const raw = g.img.startsWith('http') ? g.img : 'data:image/webp;base64,' + g.img;
        job.imgUrl = await toDataUrl(raw); job.seed = g.seed || ''; job.modelUsed = g.model || job.model;
        job.state = 'done'; job.statusText = `Done • ${job.modelUsed} • Seed: ${job.seed}`;
        saveQ(); renderQueue();
        const item = { id: 'v_' + Date.now(), url: job.imgUrl, prompt: job.prompt, model: job.modelUsed, seed: job.seed, ts: new Date().toLocaleTimeString() };
        addVaultItem(item); showResult(item);
      } catch (e) {
        job._errs = (job._errs || 0) + 1;
        if (job._errs < 6) { job.statusText = `Reconnecting (${job._errs}/6)...`; renderQueue(); }
        else { clearInterval(tm); job.state = 'error'; job.statusText = 'Poll error: ' + e.message; saveQ(); renderQueue(); }
      }
    }, 5000);
  }

  async function submitJob() {
    const rawPos = $('promptIn').value.trim();
    if (!rawPos) return alert('Enter a prompt first.');
    const isImg = mode === 'img2img';
    const bg = $('mfBgCanvas');
    if (isImg && !bg.width) return alert('Tap 📂 Gallery or 📋 Paste to load a photo first.');
    const pos = activePreset?.prefix && !rawPos.startsWith(activePreset.prefix) ? activePreset.prefix + rawPos : rawPos;
    const neg = $('negPromptIn').value.trim();
    const lowK = kudos < 50;
    let [w, h] = $('sizePreset').value.split('x').map(Number);
    let steps = Number($('stepsIn').value), sampler = $('samplerIn').value, model = $('modelSelect').value;
    const maskB64 = isImg ? exportMaskPngB64() : '';
    if (isImg) { w = bg.width; h = bg.height; }
    if (lowK) {
      w = Math.min(512, Math.max(256, Math.round(w / 64) * 64));
      h = Math.min(512, Math.max(256, Math.round(h / 64) * 64));
      steps = Math.min(20, steps);
      if (/sde|heun|dpm_2|2s_a|lms/i.test(sampler)) sampler = 'k_euler_a';
      if (model === 'AUTO' || SDXL_RE.test(model)) model = pickFastModel(/inpaint|epicrealism|dreamshaper|deliberate|realistic|icbinp/i, !!maskB64);
    } else if (model === 'AUTO') { model = pickFastModel(/./, !!maskB64); }

    const params = { width: w, height: h, n: 1, steps, cfg_scale: Number($('cfgIn').value), sampler_name: sampler, karras: !lowK };
    if ($('seedIn').value.trim()) params.seed = $('seedIn').value.trim();
    if (isImg) params.denoising_strength = maskB64 ? Math.max(0.75, Number($('denoiseIn').value)) : Number($('denoiseIn').value);
    const nsfw = $('nsfwToggle').checked;
    const payload = { prompt: neg ? `${pos} ### ${neg}` : pos, params, models: [model], nsfw, censor_nsfw: !nsfw, r2: true, slow_workers: true, trusted_workers: false };
    if (isImg) {
      payload.source_image = bg.toDataURL('image/webp', 0.88).split(',')[1];
      payload.source_processing = maskB64 ? 'inpainting' : 'img2img';
      if (maskB64) payload.source_mask = maskB64;
    }

    const job = { id: 'q_' + Date.now(), jobId: '', prompt: rawPos, model, size: `${w}x${h}`, modeLabel: maskB64 ? 'Masked Inpaint' : isImg ? 'Full Photo Edit' : 'Text-to-Image', state: 'queued', statusText: `Submitting to ${model}...`, imgUrl: '', seed: '', createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    queue.unshift(job); saveQ(); renderQueue();
    if ($('mfAutoClearChk').checked) $('promptIn').value = '';
    $('statusBox').classList.remove('hidden'); $('statusBox').textContent = `Stacked (${job.modeLabel} • ${w}x${h} • ${model})!`;
    try {
      const r = await fetch(HORDE + '/generate/async', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: getKey(), 'Client-Agent': AGENT }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok || !d.id) throw new Error(d.message || JSON.stringify(d.errors || d));
      job.jobId = d.id; job.statusText = `Queued on ${model} (${steps}st)...`; saveQ(); renderQueue(); pollJob(job);
    } catch (e) {
      job.state = 'error'; job.statusText = 'Submit error: ' + e.message; saveQ(); renderQueue();
      setDiag('Submit error: ' + e.message, true);
    }
  }

  async function runZeroGpu(spaceId, isEdit) {
    const prompt = $('promptIn').value.trim(); if (!prompt) return alert('Enter a prompt first.');
    const bg = $('mfBgCanvas'); if (isEdit && !bg.width) return alert('Load a photo first.');
    const st = $('statusBox'); st.classList.remove('hidden'); st.textContent = `⚡ Connecting to ZeroGPU (${spaceId})...`;
    try {
      const { Client, handle_file } = await import('https://esm.sh/@gradio/client');
      const client = await Client.connect(spaceId);
      let res;
      if (!isEdit) {
        res = await client.predict('/infer', { prompt, seed: 0, randomize_seed: true, width: 1024, height: 1024, num_inference_steps: 4 });
      } else {
        const blob = await new Promise(r => bg.toBlob(r, 'image/png'));
        const api = await client.view_api(); const entries = Object.entries(api.named_endpoints || {});
        const [epName, ep] = entries.find(([k]) => /infer|edit|gen|pred/i.test(k)) || entries[0];
        const args = ep.parameters.map(p => { const nm = ((p.parameter_name || p.label || '') + ' ' + (p.component || '')).toLowerCase(); if (/image|file/.test(nm)) return handle_file(blob); if (/prompt|text|inst/.test(nm)) return prompt; if (/random/.test(nm)) return true; return p.parameter_default !== undefined ? p.parameter_default : null; });
        res = await client.predict(epName, args);
      }
      const findUrl = o => { if (!o) return ''; if (typeof o === 'string' && /^https?:/.test(o)) return o; if (o.url) return o.url; if (typeof o === 'object') { for (const v of Object.values(o)) { const h = findUrl(v); if (h) return h; } } return ''; };
      const url = findUrl(res.data); if (!url) throw new Error('No image URL returned.');
      const item = { id: 'v_' + Date.now(), url, prompt, model: spaceId.split('/')[1], seed: 'rnd', ts: new Date().toLocaleTimeString() };
      addVaultItem(item); showResult(item); st.textContent = '⚡ ZeroGPU complete! Saved to Vault.';
    } catch (e) { st.textContent = 'ZeroGPU busy/capped: ' + e.message; setDiag('ZeroGPU busy: ' + e.message, true); }
  }

  async function enhancePrompt() {
    const raw = $('promptIn').value.trim(); if (!raw) return alert('Type an idea first.');
    prevPromptBackup = raw; $('mfExpandBtn').disabled = true;
    const fallback = `${raw}, realistic texture, exact matching lighting, sharp focus, highly detailed`;
    try {
      const r = await fetch(HORDE + '/generate/text/async', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: getKey(), 'Client-Agent': AGENT }, body: JSON.stringify({ prompt: `Convert into concise comma-separated visual tags only. No commentary.\nInput: ${raw}\nTags:`, params: { max_length: 75, max_context_length: 512, temperature: 0.5, stop_sequence: ['\n', 'Input:'] } }) });
      const d = await r.json(); if (!r.ok || !d.id) throw new Error('busy');
      let out = '';
      for (let i = 0; i < 8; i++) {
        await new Promise(z => setTimeout(z, 2000));
        const st = await (await fetch(HORDE + '/generate/text/status/' + d.id, { headers: { 'Client-Agent': AGENT } })).json();
        if (st.done && st.generations?.[0]?.text) { out = st.generations[0].text; break; }
      }
      out = out.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^(tags|output|prompt)\s*:\s*/i, '').trim();
      $('promptIn').value = (!out || out.length < 10 || /(okay,|user wants|let me|here is|tackle)/i.test(out)) ? fallback : out.slice(0, 380);
    } catch { $('promptIn').value = fallback; }
    $('mfUndoPromptBtn').classList.remove('hidden'); $('mfExpandBtn').disabled = false;
  }

  window.MediaForge = { switchTab, addVaultItem, onSendToVideo: null };

  $('mfTabs').onclick = e => { const b = e.target.closest('.mf-tab'); if (b) switchTab(b.dataset.tab); };
  $('modeTxtBtn').onclick = () => setMode('txt2img');
  $('modeImgBtn').onclick = () => setMode('img2img');
  $('mfPickFileIn').onchange = e => { const f = e.target.files?.[0]; if (f) loadBlob(f); e.target.value = ''; };
  $('mfPasteImgBtn').onclick = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) { const t = it.types.find(x => x.startsWith('image/')); if (t) { loadBlob(await it.getType(t)); return; } }
      setDiag('No image in clipboard. Copy a photo first, then tap Paste.', true);
    } catch (e) { setDiag('Clipboard permission blocked (' + e.message + ') — use 📂 Gallery or long-press Paste.', true); }
  };
  window.addEventListener('paste', e => { for (const it of (e.clipboardData?.items || [])) { if (it.type.startsWith('image/')) { setMode('img2img'); loadBlob(it.getAsFile()); break; } } });
  $('clearSourceBtn').onclick = () => { rawImg = null; hasMask = false; $('mfBgCanvas').width = 0; $('mfCanvasWrap').classList.add('hidden'); $('mfNoImgHint').classList.remove('hidden'); $('clearSourceBtn').classList.add('hidden'); updateMaskBadge(); };
  $('mfHdToggleBtn').onclick = () => { hdMode = !hdMode; $('mfHdLbl').textContent = hdMode ? 'HD 768px' : 'Safe 512px'; $('mfHdLbl').className = hdMode ? 'block text-[11px] font-black text-amber-300' : 'block text-[11px] font-black text-emerald-300'; if (rawImg) renderPhotoToCanvas(rawImg); };
  document.querySelectorAll('.mf-tl').forEach(b => b.onclick = () => {
    tool = b.dataset.tl;
    document.querySelectorAll('.mf-tl').forEach(x => x.className = x === b ? 'mf-tl p-1.5 rounded-lg border text-center bg-rose-600/30 border-rose-400' : 'mf-tl p-1.5 rounded-lg border text-center bg-zinc-950 border-zinc-800');
    $('mfBrushBar').classList.toggle('hidden', tool !== 'brush' && tool !== 'erase');
    const tips = { wand: 'Tap once on a shirt/object to highlight it! Tap folds to add more.', circle: 'Draw a loose circle around the shirt — fills automatically on lift!', box: 'Drag a box over the area to replace.', brush: 'Freehand paint mask.', erase: 'Erase mask areas to protect original pixels.' };
    $('mfToolTip').textContent = tips[tool] || '';
  });
  $('mfTolIn').oninput = e => { wandTol = Number(e.target.value); $('mfTolVal').textContent = wandTol; };
  $('mfExpIn').oninput = e => { expandPx = Number(e.target.value); $('mfExpVal').textContent = '+' + expandPx + 'px'; };
  $('mfBrushSzIn').oninput = e => { brushSize = Number(e.target.value); $('mfBrushSzVal').textContent = brushSize + 'px'; };
  $('denoiseIn').oninput = e => { $('denoiseVal').textContent = Number(e.target.value).toFixed(2); };
  $('stepsIn').oninput = e => $('stepsVal').textContent = e.target.value;
  $('cfgIn').oninput = e => $('cfgVal').textContent = e.target.value;
  $('mfUndoMaskBtn').onclick = () => { if (!undoStack.length) return; $('mfMaskCanvas').getContext('2d').putImageData(undoStack.pop(), 0, 0); checkMask(); };
  $('mfMaskClear').onclick = () => { pushUndo(); const m = $('mfMaskCanvas'); m.getContext('2d').clearRect(0, 0, m.width, m.height); checkMask(); };
  $('mfMaskInvert').onclick = () => { pushUndo(); const m = $('mfMaskCanvas'), c = m.getContext('2d'), im = c.getImageData(0, 0, m.width, m.height), d = im.data; for (let i = 0; i < d.length; i += 4) { const on = d[i + 3] > 20; d[i] = on ? 0 : 255; d[i + 1] = on ? 0 : 42; d[i + 2] = on ? 0 : 109; d[i + 3] = on ? 0 : 255; } c.putImageData(im, 0, 0); checkMask(); };
  document.querySelectorAll('.mf-qpr').forEach(b => b.onclick = () => { $('promptIn').value = b.dataset.qpr; if (b.dataset.qneg) $('negPromptIn').value = b.dataset.qneg; });
  $('mfOdResetBtn').onclick = () => { activePreset = null; renderPresets(); };
  $('mfRefreshModelsBtn').onclick = syncWorkersAndKudos;
  $('mfExpandBtn').onclick = enhancePrompt;
  $('mfUndoPromptBtn').onclick = () => { if (prevPromptBackup) { $('promptIn').value = prevPromptBackup; $('mfUndoPromptBtn').classList.add('hidden'); } };
  $('genBtn').onclick = submitJob;
  $('mfFluxFastBtn').onclick = () => runZeroGpu('black-forest-labs/FLUX.1-schnell', false);
  $('mfZeroEditBtn').onclick = () => runZeroGpu('black-forest-labs/FLUX.1-Kontext-dev', true);
  $('mfFloatingQStrip').onclick = () => switchTab('queue');
  $('mfQNewBtn').onclick = () => switchTab('image');
  $('mfQClearDoneBtn').onclick = () => { queue = queue.filter(j => j.state === 'queued' || j.state === 'processing'); saveQ(); renderQueue(); };
  $('mfVaultClearBtn').onclick = () => { if (confirm('Clear all saved items?')) { vault = []; saveV(); renderVault(); } };
  $('resDlBtn').onclick = () => lastResult && window.open(lastResult.url, '_blank');
  $('resRemixBtn').onclick = () => { if (lastResult) { $('promptIn').value = lastResult.prompt || ''; loadUrlIntoEditor(lastResult.url); } };
  $('resVidBtn').onclick = () => { if (lastResult && window.MediaForge.onSendToVideo) { window.MediaForge.onSendToVideo(lastResult.url, lastResult.prompt); switchTab('video'); } };
  $('apiKeyIn').value = cfg.apiKey || '';
  $('saveCfgBtn').onclick = () => { cfg.apiKey = $('apiKeyIn').value.trim() || '0000000000'; saveCfg(); syncWorkersAndKudos(); alert('Saved!'); };
  $('mfTestKeyBtn').onclick = syncWorkersAndKudos;
  $('mfGuideBtn').onclick = () => $('mfGuideModal').classList.remove('hidden');
  $('mfCloseGuide').onclick = () => $('mfGuideModal').classList.add('hidden');

  initCanvasEvents(); syncWorkersAndKudos(); renderQueue(); renderVault();
  queue.forEach(j => { if ((j.state === 'queued' || j.state === 'processing') && j.jobId) pollJob(j); });
})();