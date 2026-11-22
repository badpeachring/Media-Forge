(() => {
  const CFG_KEY = 'media_forge_cfg_v1';
  const VAULT_KEY = 'media_forge_vault_v1';
  const HORDE = 'https://aihorde.net/api/v2';
  const AGENT = 'MediaForge:1.0:badpeachring';
  const $ = id => document.getElementById(id);

  const THEMES = [
    { id: 'mf-obsidian', name: 'Obsidian Neon', desc: 'Pitch black + vivid violet' },
    { id: 'mf-crimson', name: 'Crimson Tactical', desc: 'Deep blood-red gradient' },
    { id: 'mf-cyber', name: 'Cyber Blueprint', desc: 'Midnight steel blue glow' },
    { id: 'mf-olive', name: 'Field Ops Olive', desc: 'Rugged dark tactical green' }
  ];

  const defaultCfg = () => ({
    theme: 'mf-obsidian',
    apiKey: '0000000000',
    chips: [
      { name: 'Photoreal', text: 'photorealistic, 8k raw photo, sharp focus, natural lighting' },
      { name: 'Cinematic', text: 'cinematic lighting, dramatic shadows, anamorphic 35mm film' },
      { name: 'Cyberpunk', text: 'neon reflections, dark rain, high contrast sci-fi aesthetic' },
      { name: 'Anime', text: 'high detail anime illustration, crisp lineart, vibrant colors' }
    ]
  });

  let cfg = (() => { try { return { ...defaultCfg(), ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return defaultCfg(); } })();
  let vault = (() => { try { return JSON.parse(localStorage.getItem(VAULT_KEY) || '[]'); } catch { return []; } })();
  let mode = 'txt2img';
  let sourceB64 = '';
  let activeJobId = '';
  let pollTimer = null;
  let lastResult = null;

  const saveCfg = () => localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  const saveVault = () => localStorage.setItem(VAULT_KEY, JSON.stringify(vault.slice(0, 40)));
  const getKey = () => (cfg.apiKey || '0000000000').trim() || '0000000000';

  function applyTheme() {
    THEMES.forEach(t => document.body.classList.remove(t.id));
    document.body.classList.add(cfg.theme || 'mf-obsidian');
  }

  function switchTab(tab) {
    ['image', 'video', 'vault', 'custom'].forEach(t => $('view-' + t)?.classList.toggle('hidden', t !== tab));
    document.querySelectorAll('.mf-tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.className = on ? 'mf-tab px-2 py-1.5 rounded-xl bg-fuchsia-500/20 border border-fuchsia-400/50 text-fuchsia-200 text-center' : 'mf-tab px-2 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 text-center';
    });
    if (tab === 'vault') renderVault();
    if (tab === 'custom') renderCustom();
  }

  function setMode(m) {
    mode = m;
    const isImg = m === 'img2img';
    $('imgUploadWrap').classList.toggle('hidden', !isImg);
    $('modeTxtBtn').className = !isImg ? 'p-2.5 rounded-xl bg-fuchsia-600/25 border border-fuchsia-400 text-left' : 'p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-left';
    $('modeImgBtn').className = isImg ? 'p-2.5 rounded-xl bg-cyan-600/25 border border-cyan-400 text-left' : 'p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-left';
  }

  function renderChips() {
    $('styleChipsBox').innerHTML = cfg.chips.map((c, i) => `<button data-chip='${i}' class='px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-700 text-[11px] font-bold text-fuchsia-200 hover:border-fuchsia-400'>+ ${c.name}</button>`).join('');
    $('styleChipsBox').querySelectorAll('[data-chip]').forEach(b => b.onclick = () => {
      const c = cfg.chips[Number(b.dataset.chip)];
      const cur = $('promptIn').value.trim();
      $('promptIn').value = cur ? cur + ', ' + c.text : c.text;
    });
  }

  async function loadModels() {
    const sel = $('modelSelect');
    sel.innerHTML = '<option value="AUTO">Loading live GPUs...</option>';
    try {
      const r = await fetch(HORDE + '/status/models?type=image', { headers: { 'Client-Agent': AGENT } });
      const list = (await r.json()).filter(m => m.count > 0).sort((a, b) => b.count - a.count).slice(0, 45);
      sel.innerHTML = '<option value="AUTO">Auto (Fastest Available GPU)</option>' + list.map(m => `<option value="${m.name.replaceAll('"', '&quot;')}">${m.name} (${m.count} GPUs • ~${m.eta}s)</option>`).join('');
    } catch {
      sel.innerHTML = '<option value="AUTO">Auto (Fastest Available GPU)</option><option value="Deliberate">Deliberate</option><option value="AlbedoBase XL (SDXL)">AlbedoBase XL (SDXL)</option>';
    }
  }

  function encodeImageToB64(srcUrl) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const [w, h] = $('sizePreset').value.split('x').map(Number);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        const scale = Math.max(w / img.width, h / img.height);
        const dw = img.width * scale, dh = img.height * scale;
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        const dataUrl = cv.toDataURL('image/webp', 0.88);
        res({ dataUrl, raw: dataUrl.split(',')[1] });
      };
      img.onerror = () => rej(new Error('Could not read image'));
      img.src = srcUrl;
    });
  }

  async function handleFileSelect(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const out = await encodeImageToB64(reader.result);
      sourceB64 = out.raw;
      $('sourcePreview').src = out.dataUrl;
      $('sourcePreview').classList.remove('hidden');
      $('clearSourceBtn').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }

  function setStatus(msg) {
    $('statusBox').classList.remove('hidden');
    $('statusBox').textContent = msg;
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    $('genBtn').disabled = false;
    $('genBtn').classList.remove('opacity-50');
    $('cancelBtn').classList.add('hidden');
  }

  async function cancelJob() {
    const id = activeJobId;
    activeJobId = '';
    stopPolling();
    setStatus('Job cancelled.');
    if (id) fetch(HORDE + '/generate/status/' + id, { method: 'DELETE', headers: { apikey: getKey(), 'Client-Agent': AGENT } }).catch(() => {});
  }

  async function startGenerate() {
    const pos = $('promptIn').value.trim();
    if (!pos) return alert('Type a prompt describing what you want first.');
    if (mode === 'img2img' && !sourceB64) return alert('Pick a source photo first (or switch to Text-to-Image).');

    const neg = $('negPromptIn').value.trim();
    const fullPrompt = neg ? `${pos} ### ${neg}` : pos;
    const [width, height] = $('sizePreset').value.split('x').map(Number);
    const nsfw = $('nsfwToggle').checked;
    const model = $('modelSelect').value;
    const seed = $('seedIn').value.trim();

    const params = {
      width, height, n: 1,
      steps: Number($('stepsIn').value),
      cfg_scale: Number($('cfgIn').value),
      sampler_name: $('samplerIn').value,
      karras: true
    };
    if (seed) params.seed = seed;
    if (mode === 'img2img') params.denoising_strength = Number($('denoiseIn').value);

    const payload = {
      prompt: fullPrompt, params,
      nsfw, censor_nsfw: !nsfw,
      r2: true, slow_workers: true, trusted_workers: false
    };
    if (model && model !== 'AUTO') payload.models = [model];
    if (mode === 'img2img') {
      payload.source_image = sourceB64;
      payload.source_processing = 'img2img';
    }

    $('genBtn').disabled = true;
    $('genBtn').classList.add('opacity-50');
    $('cancelBtn').classList.remove('hidden');
    setStatus('Submitting job to AI Horde cluster...');

    try {
      const r = await fetch(HORDE + '/generate/async', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: getKey(), 'Client-Agent': AGENT },
        body: JSON.stringify(payload)
      });
      const d = await r.json();
      if (!r.ok || !d.id) throw new Error(d.message || 'Request rejected (HTTP ' + r.status + ')');
      activeJobId = d.id;
      setStatus(`Queued! Job ID: ${d.id.slice(0, 8)} • Waiting for GPU worker...`);

      pollTimer = setInterval(async () => {
        if (!activeJobId) return stopPolling();
        try {
          const cr = await fetch(HORDE + '/generate/check/' + activeJobId, { headers: { 'Client-Agent': AGENT } });
          const ck = await cr.json();
          if (ck.faulted) { stopPolling(); setStatus('Worker faulted — try another model or Auto.'); return; }
          if (!ck.done) {
            setStatus(`Queue #${ck.queue_position ?? '?'} • Est Wait: ${ck.wait_time ?? '?'}s • Processing: ${ck.processing ? 'YES' : 'Waiting'}`);
            return;
          }
          stopPolling();
          setStatus('Downloading finished image...');
          const sr = await fetch(HORDE + '/generate/status/' + activeJobId, { headers: { 'Client-Agent': AGENT } });
          const st = await sr.json();
          const g = st.generations?.[0];
          if (!g || !g.img) throw new Error('No image returned.');
          const imgUrl = g.img.startsWith('http') ? g.img : 'data:image/webp;base64,' + g.img;
          lastResult = { id: 'v_' + Date.now(), url: imgUrl, prompt: pos, model: g.model || model, seed: g.seed || '', worker: g.worker_name || 'GPU', ts: new Date().toLocaleTimeString() };
          vault.unshift(lastResult);
          saveVault();
          $('resultImg').src = imgUrl;
          $('resultMeta').textContent = `Model: ${lastResult.model} | Seed: ${lastResult.seed} | Worker: ${lastResult.worker}`;
          $('resultWrap').classList.remove('hidden');
          setStatus('Done! Saved to Vault.');
        } catch (err) { stopPolling(); setStatus('Polling error: ' + err.message); }
      }, 3500);
    } catch (e) {
      stopPolling();
      setStatus('ERROR: ' + e.message);
    }
  }

  function renderVault() {
    const box = $('vaultGrid');
    if (!vault.length) { box.innerHTML = '<div class="text-xs text-zinc-500 p-4 text-center">No saved media yet. Generate your first image!</div>'; return; }
    box.innerHTML = vault.map((it, idx) => `<div class='bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 space-y-2'><img src='${it.url}' class='w-full rounded-lg bg-black max-h-72 object-contain'><div class='text-xs font-bold text-white line-clamp-2'>${it.prompt.replaceAll('<', '&lt;')}</div><div class='text-[10px] font-mono text-zinc-400'>${it.model} • Seed: ${it.seed} • ${it.ts}</div><div class='grid grid-cols-3 gap-1.5'><button data-vopen='${idx}' class='py-1.5 rounded-lg bg-emerald-700 text-white text-[10px] font-bold'>Open/Save</button><button data-vseed='${idx}' class='py-1.5 rounded-lg bg-zinc-800 text-zinc-200 text-[10px] font-bold'>Reuse Prompt</button><button data-vdel='${idx}' class='py-1.5 rounded-lg bg-rose-950 text-rose-300 text-[10px] font-bold'>Delete</button></div></div>`).join('');
    box.querySelectorAll('[data-vopen]').forEach(b => b.onclick = () => window.open(vault[b.dataset.vopen].url, '_blank'));
    box.querySelectorAll('[data-vseed]').forEach(b => b.onclick = () => {
      const it = vault[b.dataset.vseed];
      $('promptIn').value = it.prompt;
      $('seedIn').value = it.seed;
      switchTab('image');
    });
    box.querySelectorAll('[data-vdel]').forEach(b => b.onclick = () => { vault.splice(Number(b.dataset.vdel), 1); saveVault(); renderVault(); });
  }

  function renderCustom() {
    $('apiKeyIn').value = cfg.apiKey;
    $('themeGrid').innerHTML = THEMES.map(t => `<button data-th='${t.id}' class='p-2.5 rounded-xl border text-left ${cfg.theme === t.id ? 'bg-fuchsia-600/25 border-fuchsia-400' : 'bg-zinc-950 border-zinc-800'}'><span class='block text-xs font-black text-white'>${t.name}</span><span class='block text-[10px] text-zinc-400'>${t.desc}</span></button>`).join('');
    $('themeGrid').querySelectorAll('[data-th]').forEach(b => b.onclick = () => { cfg.theme = b.dataset.th; saveCfg(); applyTheme(); renderCustom(); });
    $('customChipsList').innerHTML = cfg.chips.map((c, i) => `<div class='flex items-center justify-between gap-2 p-2 rounded-lg bg-zinc-950 border border-zinc-800'><div class='min-w-0'><div class='text-xs font-bold text-white'>${c.name}</div><div class='text-[10px] text-zinc-400 truncate'>${c.text}</div></div><button data-dchip='${i}' class='px-2 py-1 rounded bg-rose-950 text-rose-300 text-[10px] font-bold shrink-0'>Remove</button></div>`).join('');
    $('customChipsList').querySelectorAll('[data-dchip]').forEach(b => b.onclick = () => { cfg.chips.splice(Number(b.dataset.dchip), 1); saveCfg(); renderChips(); renderCustom(); });
  }

  $('mfTabs').onclick = e => { const b = e.target.closest('.mf-tab'); if (b) switchTab(b.dataset.tab); };
  $('modeTxtBtn').onclick = () => setMode('txt2img');
  $('modeImgBtn').onclick = () => setMode('img2img');
  $('sourceFileIn').onchange = e => handleFileSelect(e.target.files?.[0]);
  $('clearSourceBtn').onclick = () => { sourceB64 = ''; $('sourcePreview').classList.add('hidden'); $('clearSourceBtn').classList.add('hidden'); $('sourceFileIn').value = ''; };
  $('denoiseIn').oninput = e => $('denoiseVal').textContent = e.target.value;
  $('stepsIn').oninput = e => $('stepsVal').textContent = e.target.value;
  $('cfgIn').oninput = e => $('cfgVal').textContent = e.target.value;
  $('refreshModelsBtn').onclick = loadModels;
  $('genBtn').onclick = startGenerate;
  $('cancelBtn').onclick = cancelJob;
  $('quickGuideBtn').onclick = () => $('guideModal').classList.remove('hidden');
  $('closeGuideBtn').onclick = () => $('guideModal').classList.add('hidden');
  $('dlResultBtn').onclick = () => { if (lastResult) window.open(lastResult.url, '_blank'); };
  $('lockSeedBtn').onclick = () => { if (lastResult?.seed) { $('seedIn').value = lastResult.seed; alert('Seed locked: ' + lastResult.seed); } };
  $('remixResultBtn').onclick = async () => {
    if (!lastResult) return;
    setMode('img2img');
    try {
      const out = await encodeImageToB64(lastResult.url);
      sourceB64 = out.raw;
      $('sourcePreview').src = out.dataUrl;
      $('sourcePreview').classList.remove('hidden');
      $('clearSourceBtn').classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch { alert('Save the image first and upload via Pick Photo (CORS protected).'); }
  };
  $('sendVideoBtn').onclick = () => {
    if (window.MediaForge?.onSendToVideo && lastResult) { window.MediaForge.onSendToVideo(lastResult.url, lastResult.prompt); switchTab('video'); }
    else alert('Ready for Patch 2! Install Patch 2 to send photos straight into Video Lab.');
  };
  $('clearVaultBtn').onclick = () => { if (confirm('Clear saved Vault history?')) { vault = []; saveVault(); renderVault(); } };
  $('checkKeyBtn').onclick = async () => {
    cfg.apiKey = $('apiKeyIn').value.trim() || '0000000000';
    saveCfg();
    $('keyInfoBox').textContent = 'Checking AI Horde account...';
    try {
      const r = await fetch(HORDE + '/find_user', { headers: { apikey: getKey(), 'Client-Agent': AGENT } });
      const d = await r.json();
      $('keyInfoBox').textContent = r.ok ? `User: ${d.username} | Kudos: ${Math.round(d.kudos || 0).toLocaleString()}` : 'Saved (Anonymous / Invalid key)';
    } catch { $('keyInfoBox').textContent = 'Saved locally.'; }
  };
  $('addChipBtn').onclick = () => {
    const name = $('newChipName').value.trim(), text = $('newChipText').value.trim();
    if (!name || !text) return alert('Enter both a label and prompt text.');
    cfg.chips.push({ name, text });
    $('newChipName').value = ''; $('newChipText').value = '';
    saveCfg(); renderChips(); renderCustom();
  };

  window.MediaForge = { switchTab, addVaultItem: it => { vault.unshift(it); saveVault(); }, onSendToVideo: null };
  applyTheme(); renderChips(); loadModels();
})();