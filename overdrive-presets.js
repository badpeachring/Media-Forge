(() => {
  if (window.__mfOverdriveLoaded) return;
  window.__mfOverdriveLoaded = true;
  const $ = id => document.getElementById(id);
  const HORDE = 'https://aihorde.net/api/v2';
  const AGENT = 'MediaForge:3.0:badpeachring';
  const SDXL_RE = /xl|illustrious|pony|flux|chroma|sd3|hidream|noobai|wai-nsfw/i;

  let activePreset = null;
  let liveWorkers = [];
  let prevPromptBackup = '';
  window.__mfKudos = 0;
  window.__mfFastWorkers = [];

  const PRESETS = [
    {
      id: '3d_char',
      title: '🎮 3D CHARACTER FORGE',
      sub: 'Fast 512px Free-Safe • 20 steps • 1st-order sampler • Unreal 5 / Octane',
      color: 'from-fuchsia-600/35 to-purple-900/45 border-fuchsia-400',
      mode: 'txt2img',
      size: '512x512',
      sampler: 'k_euler_a',
      steps: 20,
      cfg: 7,
      modelRegex: /dreamshaper|epicrealism|absolutereality|realistic|deliberate|cyberrealistic|icbinp/i,
      prefix: 'hyper-realistic 3D character render, Unreal Engine 5 MetaHuman, Octane render, subsurface skin scattering, volumetric studio rim lighting, sharp focus, ',
      neg: '2d, flat, cartoon, anime, sketch, blurry, lowres, deformed anatomy, extra fingers, bad hands, watermark, text'
    },
    {
      id: 'surgical_edit',
      title: '🖌️ SURGICAL PHOTO EDIT',
      sub: 'Mask & Inpaint • 0.85 Denoise • Locks original face & scene',
      color: 'from-cyan-600/35 to-sky-950/50 border-cyan-400',
      mode: 'img2img',
      size: '512x512',
      sampler: 'k_euler_a',
      steps: 20,
      cfg: 7,
      denoise: 0.85,
      modelRegex: /inpaint|epicrealism|realistic|deliberate|icbinp|absolutereality/i,
      prefix: 'seamless photographic edit, exact matching lighting and natural skin texture, photorealistic, ',
      neg: 'mismatch lighting, seam, pasted look, blurry, lowres, deformed, extra limbs, watermark'
    },
    {
      id: 'raw_photo',
      title: '📸 RAW 35mm PHOTOREAL',
      sub: 'Fast 512px Free-Safe • 1st-order DPM++ 2M • Natural DSLR skin',
      color: 'from-emerald-600/30 to-teal-950/50 border-emerald-400',
      mode: 'txt2img',
      size: '512x512',
      sampler: 'k_dpmpp_2m',
      steps: 20,
      cfg: 6.5,
      modelRegex: /epicrealism|realistic|cyberrealistic|absolutereality|icbinp|deliberate/i,
      prefix: 'candid 35mm DSLR photograph, natural lighting, realistic skin pores, shallow depth of field, sharp focus, ',
      neg: '3d render, cgi, plastic skin, airbrushed, cartoon, anime, blurry, watermark'
    },
    {
      id: 'rapid_draft',
      title: '⚡ RAPID 10s DRAFT',
      sub: 'Lowest-ETA GPU • 14 steps • Fastest possible Horde queue',
      color: 'from-amber-600/30 to-orange-950/50 border-amber-400',
      mode: 'txt2img',
      size: '512x512',
      sampler: 'k_euler_a',
      steps: 14,
      cfg: 6.5,
      modelRegex: /./,
      prefix: '',
      neg: 'blurry, lowres, watermark, deformed'
    }
  ];

  function getKey() {
    try { return JSON.parse(localStorage.getItem('media_forge_cfg_v1') || '{}').apiKey || '0000000000'; } catch { return '0000000000'; }
  }

  async function syncAccountAndWorkers() {
    const k = getKey();
    if (k && k !== '0000000000') {
      try {
        const ur = await fetch(HORDE + '/find_user', { headers: { apikey: k, 'Client-Agent': AGENT } });
        if (ur.ok) { const u = await ur.json(); window.__mfKudos = Number(u.kudos || 0); }
      } catch {}
    } else { window.__mfKudos = 0; }
    try {
      const r = await fetch(HORDE + '/status/models?type=image', { headers: { 'Client-Agent': AGENT } });
      const raw = await r.json();
      liveWorkers = (Array.isArray(raw) ? raw : []).filter(m => m.count > 0).sort((a, b) => (a.eta || 999) - (b.eta || 999));
      window.__mfFastWorkers = liveWorkers.filter(m => !SDXL_RE.test(m.name) && (m.eta || 999) < 180);
      if (!window.__mfFastWorkers.length) window.__mfFastWorkers = liveWorkers.filter(m => !SDXL_RE.test(m.name));
    } catch {}
  }

  function pickFastestModel(regex) {
    const sel = $('modelSelect');
    if (!sel) return 'Auto';
    const lowKudos = (window.__mfKudos || 0) < 50;
    const pool = lowKudos ? window.__mfFastWorkers : liveWorkers;
    const hit = pool.find(m => regex.test(m.name)) || pool[0];
    if (hit) {
      let opt = Array.from(sel.options).find(o => o.value === hit.name);
      if (!opt) {
        opt = document.createElement('option');
        opt.value = hit.name;
        opt.textContent = `${hit.name} (~${hit.eta}s • ${hit.count} GPUs)`;
        sel.appendChild(opt);
      }
      sel.value = hit.name;
      return `${hit.name} (~${hit.eta}s)`;
    }
    sel.value = 'AUTO';
    return 'Auto (Fastest SD1.5)';
  }

  async function activatePreset(p) {
    activePreset = p;
    if (!liveWorkers.length) await syncAccountAndWorkers();
    if (p.mode === 'img2img') $('modeImgBtn')?.click();
    else $('modeTxtBtn')?.click();

    const lowKudos = (window.__mfKudos || 0) < 50;
    const safeSize = lowKudos ? '512x512' : p.size;
    const safeSteps = lowKudos ? Math.min(20, p.steps) : p.steps;

    if ($('sizePreset')) $('sizePreset').value = safeSize;
    if ($('samplerIn')) $('samplerIn').value = p.sampler;
    if ($('stepsIn')) { $('stepsIn').value = String(safeSteps); if ($('stepsVal')) $('stepsVal').textContent = String(safeSteps); }
    if ($('cfgIn')) { $('cfgIn').value = String(p.cfg); if ($('cfgVal')) $('cfgVal').textContent = String(p.cfg); }
    if (p.denoise && $('denoiseIn')) { $('denoiseIn').value = String(p.denoise); if ($('denoiseVal')) $('denoiseVal').textContent = String(p.denoise); }
    if ($('negPromptIn')) $('negPromptIn').value = p.neg;
    if ($('nsfwToggle')) $('nsfwToggle').checked = true;

    const chosen = pickFastestModel(p.modelRegex);
    renderPresetCards(chosen);
  }

  function sanitizeLlmOutput(rawOut, fallbackInput) {
    let txt = String(rawOut || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    txt = txt.replace(/^(output|enhanced|prompt|result)\s*:\s*/i, '').trim();
    const hasChatter = /(okay,\s*let'?s|the user wants|let me |step \d|here is |sure,|i will )/i.test(txt);
    if (hasChatter || txt.length < 12) {
      const parts = txt.split(/\n+/).map(s => s.trim()).filter(s => s && !/(okay,|user wants|let me|here is|step \d|tackle)/i.test(s));
      txt = parts.length ? parts[parts.length - 1] : '';
    }
    txt = txt.replace(/^["'\s]+|["'\s]+$/g, '');
    if (!txt || txt.length < 12) {
      return `${fallbackInput}, natural realistic textures, cinematic lighting, sharp focus, highly detailed, photorealistic`;
    }
    return txt.slice(0, 420);
  }

  async function expandPromptWithLLM() {
    const raw = $('promptIn')?.value.trim();
    if (!raw) return alert('Type a rough idea or edit instruction first.');
    prevPromptBackup = raw;
    const btn = $('mfExpandBtn');
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Enhancing tags (chatter-filtered)...';
    try {
      const r = await fetch(HORDE + '/generate/text/async', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: getKey(), 'Client-Agent': AGENT },
        body: JSON.stringify({
          prompt: `Convert to concise comma-separated image prompt tags only. No commentary.\nInput: red jacket in rain\nTags: person wearing wet red leather jacket, rainy night street, neon reflections, 35mm lens, photorealistic, sharp focus\nInput: ${raw}\nTags:`,
          params: { max_length: 85, max_context_length: 512, temperature: 0.55, top_p: 0.9, stop_sequence: ['\n', 'Input:'] }
        })
      });
      const d = await r.json();
      if (!r.ok || !d.id) throw new Error(d.message || 'Text workers busy');
      let got = '';
      for (let i = 0; i < 10; i++) {
        await new Promise(res => setTimeout(res, 2000));
        const sr = await fetch(HORDE + '/generate/text/status/' + d.id, { headers: { 'Client-Agent': AGENT } });
        const st = await sr.json();
        if (st.done && st.generations?.[0]?.text) { got = st.generations[0].text; break; }
      }
      $('promptIn').value = sanitizeLlmOutput(got, raw);
      $('mfUndoPromptBtn')?.classList.remove('hidden');
    } catch {
      $('promptIn').value = sanitizeLlmOutput('', raw);
      $('mfUndoPromptBtn')?.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.querySelector('span').textContent = '✨ AI ENHANCE / EXPAND PROMPT';
    }
  }

  async function runInstantFlux() {
    const raw = $('promptIn')?.value.trim();
    if (!raw) return alert('Type a prompt first.');
    const prompt = activePreset?.prefix && !raw.startsWith(activePreset.prefix) ? activePreset.prefix + raw : raw;
    const btn = $('mfFluxFastBtn');
    const stBox = $('statusBox');
    btn.disabled = true;
    if (stBox) { stBox.classList.remove('hidden'); stBox.textContent = '⚡ Connecting to ZeroGPU FLUX.1-schnell (1024px • ~10s, zero queue)...'; }
    try {
      const { Client } = await import('https://esm.sh/@gradio/client');
      const client = await Client.connect('black-forest-labs/FLUX.1-schnell');
      const res = await client.predict('/infer', { prompt, seed: 0, randomize_seed: true, width: 1024, height: 1024, num_inference_steps: 4 });
      const findUrl = o => { if (!o) return ''; if (typeof o === 'string' && /^https?:/.test(o)) return o; if (o.url) return o.url; if (typeof o === 'object') { for (const v of Object.values(o)) { const h = findUrl(v); if (h) return h; } } return ''; };
      const imgUrl = findUrl(res.data);
      if (!imgUrl) throw new Error('No image URL returned.');
      if (stBox) stBox.textContent = '⚡ ZeroGPU FLUX complete! Saved to Vault.';
      if (window.MediaForge?.addVaultItem) window.MediaForge.addVaultItem({ id: 'v_' + Date.now(), url: imgUrl, prompt, model: 'FLUX.1-schnell (ZeroGPU)', seed: 'random', worker: 'ZeroGPU', ts: new Date().toLocaleTimeString() });
      if ($('resImg')) { $('resImg').src = imgUrl; $('resultCard')?.classList.remove('hidden'); }
      else window.open(imgUrl, '_blank');
    } catch (e) {
      if (stBox) stBox.textContent = 'ZeroGPU FLUX busy/capped: ' + e.message + ' — use main Generate button for AI Horde.';
    } finally {
      btn.disabled = false;
    }
  }

  function renderPresetCards(chosen = '') {
    const box = $('mfOverdriveGrid');
    if (!box) return;
    box.innerHTML = PRESETS.map(p => {
      const on = activePreset?.id === p.id;
      return `<button type='button' data-od='${p.id}' class='p-3 rounded-2xl border text-left transition-all bg-gradient-to-br ${on ? p.color + ' ring-2 ring-white/60' : 'from-zinc-950 to-zinc-900 border-zinc-800/80'}'><div class='flex items-center justify-between gap-1'><span class='text-xs font-black text-white'>${p.title}</span>${on ? `<span class='px-1.5 py-0.5 rounded bg-black/60 text-[9px] font-black text-emerald-300'>ARMED</span>` : ''}</div><div class='text-[10px] text-zinc-300/85 mt-0.5 leading-snug'>${p.sub}</div></button>`;
    }).join('');
    box.querySelectorAll('[data-od]').forEach(b => b.onclick = () => { const p = PRESETS.find(x => x.id === b.dataset.od); if (p) activatePreset(p); });
    const hud = $('mfOverdriveHud');
    if (hud) {
      const kTxt = (window.__mfKudos || 0) < 50 ? 'Free Safe Cap (512px/20st)' : `${Math.round(window.__mfKudos)} Kudos`;
      hud.innerHTML = activePreset
        ? `<div class='flex items-center justify-between gap-2'><span class='text-[10px] font-black text-cyan-300 truncate'>${activePreset.title}</span><span class='text-[9px] text-zinc-300 shrink-0'>${chosen || 'Auto'} • ${kTxt}</span></div>`
        : `<span class='text-zinc-400'>Mode: ${kTxt} • Tap any preset above to auto-pick fastest non-black GPU.</span>`;
    }
  }

  function mountOverdriveBar() {
    const viewImg = $('view-image');
    if (!viewImg || $('mfOverdriveWrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'mfOverdriveWrap';
    wrap.className = 'bg-zinc-950/95 border border-purple-500/35 rounded-2xl p-3.5 space-y-2.5 shadow-lg';
    wrap.innerHTML = `<div class='flex items-center justify-between gap-2'><div><div class='text-[10px] font-black uppercase tracking-wider text-purple-400'>Overdrive Presets v3</div><div class='text-sm font-black tracking-wide text-white'>1-TAP FAST &amp; SAFE MODES</div></div><button id='mfOdResetBtn' type='button' class='px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-zinc-400'>Off</button></div><div id='mfOverdriveGrid' class='grid grid-cols-1 gap-2'></div><div id='mfOverdriveHud' class='text-[10px] font-mono text-cyan-300 bg-black/60 border border-zinc-900 rounded-xl px-2.5 py-1.5'></div><button id='mfFluxFastBtn' type='button' class='w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-600/80 to-cyan-600/80 border border-emerald-300/40 text-left'><span class='block text-xs font-black text-white'>⚡ Instant 10s Render (ZeroGPU FLUX 1024px)</span><span class='block text-[9px] text-emerald-100/85'>Skips AI Horde queue completely for fast Text-to-Image (SFW)</span></button>`;
    viewImg.prepend(wrap);
    $('mfFluxFastBtn').onclick = runInstantFlux;
    $('mfOdResetBtn').onclick = () => { activePreset = null; renderPresetCards(); };

    const promptArea = $('promptIn');
    if (promptArea && !$('mfExpandBar')) {
      const btnWrap = document.createElement('div');
      btnWrap.id = 'mfExpandBar';
      btnWrap.className = 'flex items-center gap-2 mt-2';
      btnWrap.innerHTML = `<button id='mfExpandBtn' type='button' class='flex-1 py-2 px-3 rounded-xl bg-indigo-600/30 border border-indigo-400/50 text-left'><span class='block text-xs font-black text-indigo-100'>✨ AI ENHANCE / EXPAND PROMPT</span><span class='block text-[10px] text-indigo-300/75'>Clean tag expander (blocks LLM chatter)</span></button><button id='mfUndoPromptBtn' type='button' class='hidden px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-left shrink-0'><span class='block text-xs font-bold text-zinc-300'>Undo</span><span class='block text-[9px] text-zinc-500'>Revert</span></button>`;
      promptArea.insertAdjacentElement('afterend', btnWrap);
      $('mfExpandBtn').onclick = expandPromptWithLLM;
      $('mfUndoPromptBtn').onclick = () => { if (prevPromptBackup) { $('promptIn').value = prevPromptBackup; $('mfUndoPromptBtn').classList.add('hidden'); } };
    }
    syncAccountAndWorkers().then(() => renderPresetCards());
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.includes('/api/v2/generate/async') && init?.body && activePreset?.prefix) {
      try {
        const payload = JSON.parse(init.body);
        if (payload.prompt && !payload.prompt.startsWith(activePreset.prefix)) {
          payload.prompt = activePreset.prefix + payload.prompt;
          init = { ...init, body: JSON.stringify(payload) };
        }
      } catch {}
    }
    return origFetch(input, init);
  };

  mountOverdriveBar();
})();