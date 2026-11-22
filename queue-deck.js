(() => {
  if (window.__mfQueueDeckLoaded) return;
  window.__mfQueueDeckLoaded = true;
  const $ = id => document.getElementById(id);
  const HORDE = 'https://aihorde.net/api/v2';
  const AGENT = 'MediaForge:1.0:badpeachring';
  const Q_KEY = 'media_forge_queue_v1';

  let queue = (() => { try { return JSON.parse(localStorage.getItem(Q_KEY) || '[]'); } catch { return []; } })();
  let clearAfterQueue = false;
  const saveQ = () => localStorage.setItem(Q_KEY, JSON.stringify(queue.slice(0, 30)));
  const getKey = () => { try { return JSON.parse(localStorage.getItem('media_forge_cfg_v1') || '{}').apiKey || '0000000000'; } catch { return '0000000000'; } };

  function mountQueueUI() {
    const nav = $('mfTabs');
    const main = document.querySelector('main');
    if (!nav || !main || $('view-queue')) return;

    nav.className = 'bg-zinc-950/90 border-b border-zinc-800 px-2 py-2 grid grid-cols-5 gap-1';
    const qBtn = document.createElement('button');
    qBtn.dataset.tab = 'queue';
    qBtn.id = 'mfQueueTabBtn';
    qBtn.className = 'mf-tab px-1.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 text-center';
    qBtn.innerHTML = `<span class='block text-xs font-black'>Queue <span id='mfQBadge' class='text-amber-300'>(0)</span></span><span class='block text-[9px] opacity-75'>Stacked Jobs</span>`;
    nav.insertBefore(qBtn, nav.children[2]);

    const sec = document.createElement('section');
    sec.id = 'view-queue';
    sec.className = 'hidden space-y-3';
    sec.innerHTML = `<div class='flex items-center justify-between gap-2 bg-zinc-900/90 border border-amber-500/40 rounded-xl p-3'>
      <div>
        <div class='text-xs font-black text-amber-300'>Parallel Render Queue Deck</div>
        <div class='text-[10px] text-zinc-400'>Stack unlimited jobs — go back to Image tab anytime to queue more</div>
      </div>
      <div class='flex gap-1.5 shrink-0'>
        <button id='mfQNewBtn' type='button' class='px-2.5 py-1.5 rounded-lg bg-fuchsia-600 text-white text-[10px] font-black'>+ Stack Another</button>
        <button id='mfQClearDoneBtn' type='button' class='px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] font-bold'>Clear Done</button>
      </div>
    </div>
    <div id='mfQueueList' class='space-y-2.5'></div>`;
    main.appendChild(sec);

    const strip = document.createElement('div');
    strip.id = 'mfFloatingQStrip';
    strip.className = 'hidden fixed bottom-2 inset-x-3 z-40 bg-zinc-950/95 backdrop-blur border border-amber-400/50 rounded-xl px-3 py-2 shadow-2xl flex items-center justify-between gap-2 cursor-pointer';
    strip.innerHTML = `<div class='min-w-0'><div id='mfStripTitle' class='text-xs font-black text-amber-300 truncate'>0 Active Renders in Queue</div><div id='mfStripSub' class='text-[10px] text-zinc-400 truncate'>Tap to view stacked jobs or keep building new ones</div></div><span class='px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-400/40 text-[10px] font-black text-amber-200 shrink-0'>Open Queue</span>`;
    strip.onclick = () => switchToTab('queue');
    document.body.appendChild(strip);

    const genBtn = $('genBtn');
    if (genBtn && !$('mfStackOpts')) {
      const optBar = document.createElement('label');
      optBar.id = 'mfStackOpts';
      optBar.className = 'flex items-center justify-between px-3 py-2 rounded-xl bg-zinc-900/90 border border-zinc-800 text-[11px] text-zinc-300 cursor-pointer';
      optBar.innerHTML = `<span>Clear prompt text automatically after sending to Queue</span><input id='mfAutoClearChk' type='checkbox' class='w-4 h-4 accent-fuchsia-500'>`;
      genBtn.parentElement.insertAdjacentElement('beforebegin', optBar);
      $('mfAutoClearChk').onchange = e => { clearAfterQueue = e.target.checked; };
    }

    nav.addEventListener('click', e => {
      const b = e.target.closest('.mf-tab');
      if (b) switchToTab(b.dataset.tab);
    });
    $('mfQNewBtn').onclick = () => switchToTab('image');
    $('mfQClearDoneBtn').onclick = () => {
      queue = queue.filter(j => j.state === 'queued' || j.state === 'processing');
      saveQ(); renderQueue();
    };
  }

  function switchToTab(tab) {
    ['image', 'video', 'queue', 'vault', 'custom'].forEach(t => $('view-' + t)?.classList.toggle('hidden', t !== tab));
    document.querySelectorAll('.mf-tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.className = on ? 'mf-tab px-1.5 py-1.5 rounded-xl bg-fuchsia-500/20 border border-fuchsia-400/50 text-fuchsia-200 text-center' : 'mf-tab px-1.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 text-center';
    });
    if (tab === 'queue') renderQueue();
    if (tab === 'vault' && window.MediaForge?.switchTab) window.MediaForge.switchTab('vault');
  }

  function updateBadges() {
    const active = queue.filter(j => j.state === 'queued' || j.state === 'processing');
    const badge = $('mfQBadge');
    if (badge) badge.textContent = `(${active.length})`;
    const strip = $('mfFloatingQStrip');
    if (!strip) return;
    const onQueueTab = !$('view-queue')?.classList.contains('hidden');
    if (active.length && !onQueueTab) {
      strip.classList.remove('hidden');
      $('mfStripTitle').textContent = `${active.length} Active Job${active.length > 1 ? 's' : ''} Rendering in Queue`;
      const top = active[0];
      $('mfStripSub').textContent = `${top.statusText} • Keep customizing & stacking more!`;
    } else {
      strip.classList.add('hidden');
    }
  }

  function renderQueue() {
    updateBadges();
    const box = $('mfQueueList');
    if (!box) return;
    if (!queue.length) {
      box.innerHTML = `<div class='bg-zinc-900/80 border border-zinc-800 rounded-xl p-6 text-center space-y-2'><div class='text-xs font-bold text-zinc-300'>Queue Deck is Empty</div><div class='text-[11px] text-zinc-400'>Every time you tap Generate in the Image tab, the job shoots straight here so you can immediately customize and stack another one.</div></div>`;
      return;
    }
    box.innerHTML = queue.map((j, idx) => {
      const isRunning = j.state === 'queued' || j.state === 'processing';
      const pill = j.state === 'done' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : j.state === 'error' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' : 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      return `<div class='bg-zinc-900/95 border border-zinc-800 rounded-xl p-3 space-y-2'>
        <div class='flex items-center justify-between gap-2'>
          <span class='px-2 py-0.5 rounded-full border text-[10px] font-black uppercase ${pill}'>${j.state}</span>
          <span class='text-[10px] font-mono text-zinc-400 truncate'>${j.modeLabel} • ${j.size} • ${j.createdAt}</span>
        </div>
        <div class='text-xs font-bold text-white line-clamp-2'>${j.prompt.replaceAll('<', '&lt;')}</div>
        <div class='text-[11px] font-mono ${j.state === 'error' ? 'text-rose-400' : 'text-cyan-300'}'>${j.statusText}</div>
        ${j.imgUrl ? `<img src='${j.imgUrl}' class='w-full rounded-lg border border-zinc-700 bg-black max-h-80 object-contain'>
          <div class='grid grid-cols-3 gap-1.5 pt-1'>
            <button data-qdl='${idx}' class='py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black'>Save / Open</button>
            <button data-qremix='${idx}' class='py-1.5 rounded-lg bg-cyan-600 text-white text-[10px] font-black'>Remix Edit</button>
            <button data-qvid='${idx}' class='py-1.5 rounded-lg bg-violet-600 text-white text-[10px] font-black'>To Video</button>
          </div>` : ''}
        <div class='flex justify-end gap-1.5'>
          ${isRunning ? `<button data-qcancel='${idx}' class='px-2.5 py-1 rounded-lg bg-rose-950 border border-rose-500/40 text-[10px] font-bold text-rose-300'>Cancel Job</button>` : `<button data-qdel='${idx}' class='px-2.5 py-1 rounded-lg bg-zinc-800 text-[10px] font-bold text-zinc-400'>Remove Card</button>`}
        </div>
      </div>`;
    }).join('');

    box.querySelectorAll('[data-qdl]').forEach(b => b.onclick = () => window.open(queue[b.dataset.qdl].imgUrl, '_blank'));
    box.querySelectorAll('[data-qremix]').forEach(b => b.onclick = () => {
      const j = queue[b.dataset.qremix];
      $('promptIn').value = j.prompt;
      if ($('seedIn') && j.seed) $('seedIn').value = j.seed;
      $('modeImgBtn')?.click();
      switchToTab('image');
      alert('Loaded prompt & seed into Photo-to-Image! Pick/upload the saved image to mask or restyle.');
    });
    box.querySelectorAll('[data-qvid]').forEach(b => b.onclick = () => {
      const j = queue[b.dataset.qvid];
      if (window.MediaForge?.onSendToVideo) { window.MediaForge.onSendToVideo(j.imgUrl, j.prompt); switchToTab('video'); }
    });
    box.querySelectorAll('[data-qcancel]').forEach(b => b.onclick = () => {
      const j = queue[b.dataset.qcancel];
      if (j.jobId) fetch(HORDE + '/generate/status/' + j.jobId, { method: 'DELETE', headers: { apikey: getKey(), 'Client-Agent': AGENT } }).catch(() => {});
      j.state = 'error'; j.statusText = 'Cancelled by user'; saveQ(); renderQueue();
    });
    box.querySelectorAll('[data-qdel]').forEach(b => b.onclick = () => { queue.splice(Number(b.dataset.qdel), 1); saveQ(); renderQueue(); });
  }

  function pollSingleJob(job) {
    const timer = setInterval(async () => {
      if (job.state !== 'queued' && job.state !== 'processing') return clearInterval(timer);
      try {
        const cr = await fetch(HORDE + '/generate/check/' + job.jobId, { headers: { 'Client-Agent': AGENT } });
        const ck = await cr.json();
        if (ck.faulted) {
          clearInterval(timer);
          job.state = 'error'; job.statusText = 'Worker faulted — try another model.'; saveQ(); renderQueue(); return;
        }
        if (!ck.done) {
          job.state = ck.processing ? 'processing' : 'queued';
          job.statusText = `Queue #${ck.queue_position ?? '?'} • Est Wait: ${ck.wait_time ?? '?'}s • ${ck.processing ? 'Rendering on GPU...' : 'Waiting in line'}`;
          saveQ(); renderQueue(); return;
        }
        clearInterval(timer);
        job.statusText = 'Downloading finished render...'; saveQ(); renderQueue();
        const sr = await fetch(HORDE + '/generate/status/' + job.jobId, { headers: { 'Client-Agent': AGENT } });
        const st = await sr.json();
        const g = st.generations?.[0];
        if (!g || !g.img) throw new Error('No image returned');
        job.imgUrl = g.img.startsWith('http') ? g.img : 'data:image/webp;base64,' + g.img;
        job.seed = g.seed || '';
        job.modelUsed = g.model || job.model;
        job.state = 'done';
        job.statusText = `Done • Model: ${job.modelUsed} • Seed: ${job.seed}`;
        saveQ(); renderQueue();
        if (window.MediaForge?.addVaultItem) {
          window.MediaForge.addVaultItem({ id: 'v_' + Date.now(), url: job.imgUrl, prompt: job.prompt, model: job.modelUsed, seed: job.seed, worker: g.worker_name || 'GPU', ts: new Date().toLocaleTimeString() });
        }
      } catch (e) {
        clearInterval(timer);
        job.state = 'error'; job.statusText = 'Error: ' + e.message; saveQ(); renderQueue();
      }
    }, 3500);
  }

  async function queueCurrentImageJob(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const pos = $('promptIn')?.value.trim();
    if (!pos) return alert('Type a prompt describing what you want first.');
    const isImgMode = !$('imgUploadWrap')?.classList.contains('hidden');
    const prevImg = $('sourcePreview');
    if (isImgMode && (!prevImg?.src || prevImg.src === location.href)) return alert('Pick a source photo first (or switch to Text-to-Image).');

    const neg = $('negPromptIn')?.value.trim() || '';
    const fullPrompt = neg ? `${pos} ### ${neg}` : pos;
    const sizeVal = $('sizePreset')?.value || '512x512';
    const [width, height] = sizeVal.split('x').map(Number);
    const nsfw = $('nsfwToggle')?.checked ?? true;
    const model = $('modelSelect')?.value || 'AUTO';
    const seed = $('seedIn')?.value.trim() || '';

    const params = {
      width, height, n: 1,
      steps: Number($('stepsIn')?.value || 25),
      cfg_scale: Number($('cfgIn')?.value || 7),
      sampler_name: $('samplerIn')?.value || 'k_euler_a',
      karras: true
    };
    if (seed) params.seed = seed;
    if (isImgMode) params.denoising_strength = Number($('denoiseIn')?.value || 0.65);

    const payload = { prompt: fullPrompt, params, nsfw, censor_nsfw: !nsfw, r2: true, slow_workers: true, trusted_workers: false };
    if (model && model !== 'AUTO') payload.models = [model];

    if (isImgMode) {
      const bg = $('mfBgCanvas');
      if (bg && bg.width) {
        payload.source_image = bg.toDataURL('image/webp', 0.88).split(',')[1];
      } else if (prevImg.src.startsWith('data:')) {
        payload.source_image = prevImg.src.split(',')[1];
      }
      payload.source_processing = 'img2img';
    }

    const job = {
      id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      jobId: '',
      prompt: pos,
      model,
      size: sizeVal,
      modeLabel: isImgMode ? 'Photo Edit / Inpaint' : 'Text-to-Image',
      state: 'queued',
      statusText: 'Dispatching to AI Horde cluster...',
      imgUrl: '',
      seed: '',
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
    queue.unshift(job);
    saveQ();
    renderQueue();

    if (clearAfterQueue && $('promptIn')) $('promptIn').value = '';
    const stBox = $('statusBox');
    if (stBox) {
      stBox.classList.remove('hidden');
      stBox.textContent = `Stacked in Queue! (${queue.filter(x => x.state === 'queued' || x.state === 'processing').length} active) — Ready for your next prompt.`;
    }

    try {
      const r = await fetch(HORDE + '/generate/async', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: getKey(), 'Client-Agent': AGENT },
        body: JSON.stringify(payload)
      });
      const d = await r.json();
      if (!r.ok || !d.id) throw new Error(d.message || 'Rejected by cluster');
      job.jobId = d.id;
      job.statusText = `Queued (${d.id.slice(0, 6)}) • Waiting for GPU...`;
      saveQ(); renderQueue();
      pollSingleJob(job);
    } catch (err) {
      job.state = 'error';
      job.statusText = 'Submit failed: ' + err.message;
      saveQ(); renderQueue();
    }
  }

  mountQueueUI();
  const genBtn = $('genBtn');
  if (genBtn) genBtn.addEventListener('click', queueCurrentImageJob, true);
  queue.forEach(j => { if ((j.state === 'queued' || j.state === 'processing') && j.jobId) pollSingleJob(j); });
  renderQueue();
})();