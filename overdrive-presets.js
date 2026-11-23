(() => {
  if (window.__mfOverdriveLoaded) return;
  window.__mfOverdriveLoaded = true;
  const $ = id => document.getElementById(id);
  const HORDE = 'https://aihorde.net/api/v2';
  const AGENT = 'MediaForge:1.0:badpeachring';

  let activePreset = null;
  let liveWorkers = [];
  let prevPromptBackup = '';

  const PRESETS = [
    {
      id: '3d_char',
      title: '🎮 REALISTIC 3D CHARACTER FORGE',
      sub: '30 Quality configurations • 1-tap Quality configurations • Unreal Engine 5',
      color: 'from-fuchsia-600/35 to-purple-900/45 border-fuchsia-400',
      mode: 'txt2img',
      size: '512x768',
      sampler: 'k_dpmpp_2m',
      steps: 32,
      cfg: 7.5,
      modelRegex: /juggernaut|albedobase|epicrealism|dreamshaper|flux|realistic|cyberrealistic/i,
      prefix: 'hyper-realistic 3D character render, Unreal Engine 5.4 MetaHuman quality, Octane render, subsurface skin scattering, intricate fabric & pores, volumetric studio rim lighting, 8k raytracing, ',
      neg: '2d, flat, cartoon, anime, sketch, painting, blurry, lowres, deformed anatomy, extra fingers, bad hands, watermark, text'
    },
    {
      id: 'surgical_edit',
      title: '🖌️ MAGIC ERASER • SURGICAL PHOTO EDIT',
      sub: 'Denoising Strength: 0.85 locked • Mask Outlines • Lock Pose & Scene',
      color: 'from-cyan-600/35 to-sky-950/50 border-cyan-400',
      mode: 'img2img',
      size: '768x768',
      sampler: 'k_dpmpp_2m',
      steps: 30,
      cfg: 7,
      denoise: 0.85,
      modelRegex: /inpaint|epicrealism|realistic|juggernaut|deliberate/i,
      prefix: 'seamless photographic edit, exact same lighting and skin tone match, natural realistic textures, ',
      neg: 'mismatch lighting, seam, pasted look, blurry, lowres, deformed, extra limbs, watermark'
    },
    {
      id: 'raw_photo',
      title: '📸 RAW 35mm DSLR PHOTOREAL',
      sub: 'DSLR candid, natural skin tone, avoids AI plastic sheen',
      color: 'from-emerald-600/30 to-teal-950/50 border-emerald-400',
      mode: 'txt2img',
      size: '768x768',
      sampler: 'k_dpmpp_sde',
      steps: 28,
      cfg: 6.5,
      modelRegex: /epicrealism|juggernaut|realistic|cyberrealistic|flux/i,
      prefix: 'candid 35mm DSLR photograph, natural unedited lighting, realistic skin pores, shallow depth of field, sharp focus, ',
      neg: '3d render, cgi, plastic skin, airbrushed, cartoon, anime, blurry, watermark'
    },
    {
      id: 'rapid_draft',
      title: '⚡ RAPID 10s DRAFT',
      sub: 'Fastest visual test queue (512x512) before Overdrive rendering',
      color: 'from-amber-600/30 to-orange-950/50 border-amber-400',
      mode: 'txt2img',
      size: '512x512',
      sampler: 'k_euler_a',
      steps: 15,
      cfg: 6.5,
      modelRegex: /./,
      prefix: '',
      neg: 'blurry, lowres, watermark, deformed'
    }
  ];

  function getKey() {
    try { return JSON.parse(localStorage.getItem('media_forge_cfg_v1') || '{}').apiKey || '0000000000'; } catch { return '0000000000'; }
  }

  async function fetchWorkers() {
    try {
      const r = await fetch(HORDE + '/status/models?type=image', { headers: { 'Client-Agent': AGENT } });
      liveWorkers = (await r.json()).filter(m => m.count > 0).sort((a, b) => b.count - a.count);
    } catch {}
  }

  function pickBestModel(regex) {
    const sel = $('modelSelect');
    if (!sel) return;
    const opts = Array.from(sel.options);
    const hitOpt = opts.find(o => o.value !== 'AUTO' && regex.test(o.value));
    if (hitOpt) { sel.value = hitOpt.value; return hitOpt.value; }
    const hitLive = liveWorkers.find(m => regex.test(m.name));
    if (hitLive) {
      const opt = document.createElement('option');
      opt.value = hitLive.name; opt.textContent = `${hitLive.name} (${hitLive.count} GPUs)`;
      sel.appendChild(opt); sel.value = hitLive.name;
      return hitLive.name;
    }
    sel.value = 'AUTO';
    return 'Auto (Fastest Worker)';
  }

  async function activatePreset(p) {
    activePreset = p;
    if (!liveWorkers.length) await fetchWorkers();

    if (p.mode === 'img2img') $('modeImgBtn')?.click();
    else $('modeTxtBtn')?.click();

    if ($('sizePreset')) $('sizePreset').value = p.size;
    if ($('samplerIn')) $('samplerIn').value = p.sampler;
    if ($('stepsIn')) { $('stepsIn').value = String(p.steps); if ($('stepsVal')) $('stepsVal').textContent = String(p.steps); }
    if ($('cfgIn')) { $('cfgIn').value = String(p.cfg); if ($('cfgVal')) $('cfgVal').textContent = String(p.cfg); }
    if (p.denoise && $('denoiseIn')) { $('denoiseIn').value = String(p.denoise); if ($('denoiseVal')) $('denoiseVal').textContent = String(p.denoise); }
    if ($('negPromptIn')) $('negPromptIn').value = p.neg;
    if ($('nsfwToggle')) $('nsfwToggle').checked = true;

    if (p.id === 'surgical_edit' && $('mfControlNetIn')) {
      $('mfControlNetIn').value = '';
    }

    const chosenModel = pickBestModel(p.modelRegex);
    renderPresetCards(chosenModel);

    if (p.id === 'surgical_edit') {
      const prev = $('sourcePreview');
      if (!prev?.src || prev.src === location.href) {
        $('imgUploadWrap')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  function renderPresetCards(chosenModel = '') {
    const box = $('mfOverdriveGrid');
    if (!box) return;
    box.innerHTML = PRESETS.map(p => {
      const on = activePreset?.id === p.id;
      return `<button type='button' data-od='${p.id}' class='p-3.5 rounded-2xl border text-left transition-all bg-gradient-to-br ${on ? p.color + ' ring-2 ring-white/60' : 'from-zinc-950 to-zinc-900 border-zinc-800/80'}'>
        <div class='flex items-center justify-between gap-1'>
          <span class='text-xs font-black text-white'>${p.title}</span>
          ${on ? `<span class='px-1.5 py-0.5 rounded bg-black/60 text-[9px] font-black text-emerald-300'>ARMED</span>` : ''}
        </div>
        <div class='text-[10px] text-zinc-300/85 mt-0.5 leading-snug'>${p.sub}</div>
      </button>`;
    }).join('');

    box.querySelectorAll('[data-od]').forEach(b => b.onclick = () => {
      const p = PRESETS.find(x => x.id === b.dataset.od);
      if (p) activatePreset(p);
    });

    const hud = $('mfOverdriveHud');
    if (hud) {
      hud.innerHTML = activePreset
        ? `<div class='flex items-center justify-between'><span class='text-[10px] font-black text-cyan-300'>OVERDRIVE: ${activePreset.title.split(' ')[1]}</span><span class='text-[9px] text-zinc-400'>${chosenModel || 'Auto'} (${activePreset.steps} steps)</span></div>`
        : `<span class='text-zinc-500'>Select an Overdrive Preset at the top for instant configurations.</span>`;
    }
  }

  async function expandPromptWithLLM() {
    const raw = $('promptIn').value.trim();
    if (!raw) return alert('Type a rough idea or edit instruction first.');
    prevPromptBackup = raw;
    const btn = $('mfExpandBtn');
    btn.disabled = true;
    btn.querySelector('span').textContent = '🤖 Thinking... Directing Scene Details...';
    const isEdit = !$('imgUploadWrap')?.classList.contains('hidden');
    const sys = isEdit
      ? 'You are an expert inpainting photo descriptor. Convert the user\'s clothing/object edit directive into a single natural, continuous, detailed prompt. Focus on describing natural texture, fabric, skin, and specific materials matching the scene. Do not add chatty intro or formatting, just tags and photorealistic lighting details.'
      : 'You are an expert prompt artist. Write a cinematic, natural photographic and atmospheric description based on the user request. Describe pose, cinematic lighting, 3D/UE5 depth, or candid realism. Write one paragraph as natural descriptive photography, do not add introductory phrases, use lowercase with tags.';
    try {
      const r = await fetch(HORDE + '/generate/text/async', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: getKey(), 'Client-Agent': AGENT },
        body: JSON.stringify({
          prompt: `${sys}\n\nInput: ${raw}\nEnhanced: `,
          params: { max_length: 120, max_context_length: 512, temperature: 0.7, top_p: 0.9 }
        })
      });
      const d = await r.json();
      if (!r.ok || !d.id) throw new Error(d.message || 'Horde Text Queue Busy');
      for (let i = 0; i < 12; i++) {
        await new Promise(res => setTimeout(res, 2000));
        const sr = await fetch(HORDE + '/generate/text/status/' + d.id, { headers: { 'Client-Agent': AGENT } });
        const st = await sr.json();
        if (st.done && st.generations?.[0]?.text) {
          const resText = st.generations[0].text.trim().replace(/^["']|["']$/g, '');
          if (resText) {
            $('promptIn').value = resText;
            $('mfUndoPromptBtn')?.classList.remove('hidden');
          }
          break;
        }
      }
    } catch (e) {
      alert('Enhance busy. Original prompt intact.');
    } finally {
      btn.disabled = false;
      btn.querySelector('span').textContent = '✨ AI ENHANCE / EXPAND PROMPT';
    }
  }

  function mountOverdriveBar() {
    const viewImg = $('view-image');
    if (!viewImg || $('mfOverdriveWrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'mfOverdriveWrap';
    wrap.className = 'bg-zinc-950/95 border border-purple-500/35 rounded-2xl p-4.5 space-y-3 shadow-lg';
    wrap.innerHTML = `<div class='flex items-center justify-between gap-2'>
      <div>
        <div class='text-[10px] font-black uppercase tracking-wider text-purple-400'>Overdrive Preset Option</div>
        <div class='text-sm font-black tracking-wide text-white'>SELECT MODE &amp; PRESET</div>
      </div>
      <button id='mfOdResetBtn' type='button' class='px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-zinc-400'>Reset Preset</button>
    </div>
    <div id='mfOverdriveGrid' class='grid grid-cols-1 gap-2.5'></div>
    <div id='mfOverdriveHud' class='text-[10px] font-mono text-cyan-300 bg-black/60 border border-zinc-900 rounded-xl px-3 py-2'></div>`;
    viewImg.prepend(wrap);

    const promptArea = $('promptIn');
    if (promptArea && !$('mfExpandBar')) {
      const btnWrap = document.createElement('div');
      btnWrap.id = 'mfExpandBar';
      btnWrap.className = 'flex items-center gap-2 mt-2';
      btnWrap.innerHTML = `<button id='mfExpandBtn' type='button' class='flex-1 py-2 px-3 rounded-xl bg-indigo-600/30 border border-indigo-400/50 text-left transition-all hover:bg-indigo-600/40'><span class='block text-xs font-black text-indigo-100'>✨ AI ENHANCE / EXPAND PROMPT</span><span class='block text-[10px] text-indigo-300/75'>Expands prompts using our free AI model</span></button><button id='mfUndoPromptBtn' type='button' class='hidden px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-left shrink-0 hover:bg-zinc-800'><span class='block text-xs font-bold text-zinc-300'>Undo</span><span class='block text-[9px] text-zinc-500'>Revert</span></button>`;
      promptArea.insertAdjacentElement('afterend', btnWrap);
      $('mfExpandBtn').onclick = expandPromptWithLLM;
      $('mfUndoPromptBtn').onclick = () => {
        if (prevPromptBackup) { $('promptIn').value = prevPromptBackup; $('mfUndoPromptBtn').classList.add('hidden'); }
      };
    }

    $('mfOdResetBtn').onclick = () => { activePreset = null; renderPresetCards(); };
    renderPresetCards();
    fetchWorkers();
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