(() => {
  if (window.__mfVideoLabLoaded) return;
  window.__mfVideoLabLoaded = true;
  const $ = id => document.getElementById(id);
  const VCFG_KEY = 'media_forge_vlab_v1';
  const VVAULT_KEY = 'media_forge_videos_v1';

  const defaultVCfg = () => ({
    engine: 'hf',
    hfToken: '',
    beaconChannel: 'mf-gpu-' + Math.random().toString(36).slice(2, 10),
    comfyUrl: '',
    autoHookUrl: '',
    hfSpaces: [
      { id: 'zerogpu-aoti/wan2-2-fp8da-aoti-faster', label: 'Wan 2.2 14B Fast (ZeroGPU I2V)' },
      { id: 'Wan-AI/Wan2.1', label: 'Wan 2.1 14B (ZeroGPU T2V/I2V)' },
      { id: 'Lightricks/ltx-video-distilled', label: 'LTX-Video Distilled (Fast ZeroGPU)' }
    ],
    comfyModels: [],
    webhooks: []
  });

  let vcfg = (() => { try { return { ...defaultVCfg(), ...JSON.parse(localStorage.getItem(VCFG_KEY) || '{}') }; } catch { return defaultVCfg(); } })();
  let vVault = (() => { try { return JSON.parse(localStorage.getItem(VVAULT_KEY) || '[]'); } catch { return []; } })();
  let vMode = 't2v';
  let vSourceBlob = null;
  let vSourceB64 = '';
  let lastVideo = null;

  const saveVCfg = () => localStorage.setItem(VCFG_KEY, JSON.stringify(vcfg));
  const saveVVault = () => localStorage.setItem(VVAULT_KEY, JSON.stringify(vVault.slice(0, 20)));
  const setVStatus = msg => { const el = $('vStatus'); if (el) { el.classList.remove('hidden'); el.textContent = msg; } };

  function renderShell() {
    const host = $('view-video');
    if (!host) return;
    host.innerHTML = `<div class='space-y-3'>
      <div class='bg-zinc-900/90 border border-violet-500/40 rounded-xl p-3 space-y-2'>
        <div class='text-xs font-black text-violet-300'>1. Pick Video Engine</div>
        <div class='text-[10px] text-zinc-400'>Switch engines anytime without retyping prompts or copying URLs</div>
        <div class='grid grid-cols-3 gap-1.5'>
          <button id='vEngHf' class='p-2 rounded-xl border text-left'><span class='block text-[11px] font-black text-white'>ZeroGPU</span><span class='block text-[9px] text-zinc-400'>Free HF Spaces</span></button>
          <button id='vEngComfy' class='p-2 rounded-xl border text-left'><span class='block text-[11px] font-black text-white'>Auto-GPU</span><span class='block text-[9px] text-zinc-400'>Uncensored Comfy</span></button>
          <button id='vEngHook' class='p-2 rounded-xl border text-left'><span class='block text-[11px] font-black text-white'>Webhooks</span><span class='block text-[9px] text-zinc-400'>Custom Endpoints</span></button>
        </div>
      </div>

      <div class='grid grid-cols-2 gap-2'>
        <button id='vModeT2v' class='p-2.5 rounded-xl border text-left'><span class='block text-xs font-black text-white'>Text-to-Video</span><span class='block text-[10px] text-zinc-400'>Generate clip from words</span></button>
        <button id='vModeI2v' class='p-2.5 rounded-xl border text-left'><span class='block text-xs font-black text-white'>Photo-to-Video</span><span class='block text-[10px] text-zinc-400'>Animate any image or render</span></button>
      </div>

      <div id='vImgWrap' class='hidden bg-zinc-900/90 border border-cyan-500/40 rounded-xl p-3 space-y-2'>
        <div class='flex items-center justify-between'>
          <div><div class='text-xs font-black text-cyan-300'>Source Frame (Photo-to-Video)</div><div class='text-[10px] text-zinc-400'>Auto-filled from Image tab or pick from gallery</div></div>
          <button id='vClearSrc' class='hidden px-2 py-1 rounded-lg bg-rose-950 text-rose-300 text-[10px] font-bold'>Remove</button>
        </div>
        <label class='block w-full py-2 px-3 rounded-xl bg-cyan-950/60 border border-cyan-400/50 text-center cursor-pointer'>
          <span class='block text-xs font-black text-cyan-200'>Pick Start Frame From Phone</span>
          <span class='block text-[10px] text-cyan-300/75'>Loads directly into memory for 1-tap upload</span>
          <input id='vFileIn' type='file' accept='image/*' class='hidden'>
        </label>
        <img id='vSrcPrev' class='hidden w-full max-h-44 object-contain rounded-lg border border-zinc-700 bg-black'>
      </div>

      <div class='bg-zinc-900/90 border border-zinc-800 rounded-xl p-3 space-y-2.5'>
        <div class='flex items-center justify-between gap-2'>
          <div><div class='text-xs font-black text-amber-300'>2. Select Active Model</div><div id='vModelSub' class='text-[10px] text-zinc-400'>Auto-maps inputs to selected model API</div></div>
          <button id='vScanBtn' class='px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-left shrink-0'><span id='vScanLbl' class='block text-[11px] font-bold text-amber-300'>Scan Live</span><span id='vScanSub' class='block text-[9px] text-zinc-400'>Find active GPUs</span></button>
        </div>
        <select id='vModelSel' class='w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-2 text-xs text-white'></select>
        <div>
          <label class='text-xs font-black text-white'>Motion &amp; Scene Prompt</label>
          <div class='text-[10px] text-zinc-400 mb-1'>Describe camera movement, lighting, and action.</div>
          <textarea id='vPromptIn' rows='3' placeholder='e.g. slow cinematic dolly push-in, steam rising, realistic motion, 24fps' class='w-full bg-zinc-950 border border-zinc-700 rounded-lg p-2.5 text-xs text-white'></textarea>
        </div>
        <div>
          <label class='text-xs font-bold text-zinc-300'>Negative Prompt</label>
          <input id='vNegIn' value='blurry, flicker, jitter, watermark, distorted faces, static frame' class='mt-1 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200'>
        </div>
        <div class='grid grid-cols-2 gap-3'>
          <div>
            <div class='flex justify-between text-[11px]'><span class='font-bold text-zinc-200'>Duration (sec)</span><span id='vDurVal' class='font-mono text-violet-300'>3</span></div>
            <input id='vDurIn' type='range' min='2' max='6' step='1' value='3' class='w-full accent-violet-500'>
            <div class='text-[9px] text-zinc-400'>Shorter clips finish much faster</div>
          </div>
          <div>
            <div class='flex justify-between text-[11px]'><span class='font-bold text-zinc-200'>Quality Steps</span><span id='vStepsVal' class='font-mono text-violet-300'>6</span></div>
            <input id='vStepsIn' type='range' min='4' max='24' step='2' value='6' class='w-full accent-violet-500'>
            <div class='text-[9px] text-zinc-400'>Fast distilled models use 4-8 steps</div>
          </div>
        </div>
      </div>

      <button id='vGenBtn' class='w-full py-3 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white shadow-lg text-center'>
        <span class='block text-sm font-black'>Generate Video</span>
        <span class='block text-[10px] opacity-85'>Auto-connects to selected model with zero copy-paste</span>
      </button>

      <div id='vStatus' class='hidden p-3 rounded-xl bg-black/75 border border-violet-500/40 text-xs font-mono text-violet-200 break-words'></div>

      <div id='vResWrap' class='hidden bg-zinc-900/95 border border-emerald-500/40 rounded-xl p-3 space-y-2'>
        <video id='vResPlayer' controls loop playsinline class='w-full rounded-lg bg-black max-h-80'></video>
        <div id='vResMeta' class='text-[10px] font-mono text-zinc-400 break-words'></div>
        <div class='grid grid-cols-2 gap-2'>
          <button id='vDlBtn' class='p-2 rounded-lg bg-emerald-600 text-white text-left'><span class='block text-xs font-black'>Save / Open MP4</span><span class='block text-[9px] opacity-85'>Download clip to phone</span></button>
          <button id='vFireHookBtn' class='p-2 rounded-lg bg-amber-600 text-white text-left'><span class='block text-xs font-black'>Send to Webhook</span><span class='block text-[9px] opacity-85'>Push clip to automation</span></button>
        </div>
      </div>

      <details class='bg-zinc-900/90 border border-zinc-800 rounded-xl p-3'>
        <summary class='cursor-pointer text-xs font-black text-cyan-300'>Auto-Beacon, Keys &amp; Webhook Models (Configure Once)</summary>
        <div class='space-y-3 mt-3'>
          <div class='space-y-1'>
            <label class='text-[11px] font-bold text-zinc-200'>Hugging Face Token (Optional — Lifts Daily ZeroGPU Cap)</label>
            <input id='vHfTokIn' value='${vcfg.hfToken}' placeholder='hf_... (optional, leave blank for anonymous)' class='w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono'>
          </div>
          <div class='space-y-1'>
            <label class='text-[11px] font-bold text-zinc-200'>GPU Auto-Beacon Channel (Kills Tunnel URL Copy-Paste)</label>
            <div class='text-[10px] text-zinc-400'>Your Kaggle/ComfyUI GPU posts its tunnel URL here automatically on boot.</div>
            <div class='flex gap-1.5'>
              <input id='vBeaconCh' value='${vcfg.beaconChannel}' class='flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-emerald-300 font-mono'>
              <button id='vBeaconCmdBtn' class='px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-[10px] font-bold text-cyan-300'>Copy 1-Line Hook</button>
            </div>
            <input id='vComfyUrlIn' value='${vcfg.comfyUrl}' placeholder='Synced ComfyUI URL appears here automatically' class='w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 font-mono'>
          </div>
          <div class='space-y-1'>
            <label class='text-[11px] font-bold text-zinc-200'>Auto-Dispatch Outbound Webhook (Optional)</label>
            <input id='vAutoHookIn' value='${vcfg.autoHookUrl}' placeholder='Make / Zapier / Discord URL (auto-fires on finish)' class='w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-white'>
          </div>
          <button id='vSaveConnBtn' class='w-full py-2 rounded-lg bg-cyan-600 text-white text-xs font-black'>Save Connections</button>
          <div class='border-t border-zinc-800 pt-2.5 space-y-1.5'>
            <div class='text-[11px] font-bold text-amber-300'>Register Webhook as a Selectable Model</div>
            <input id='vHookNameIn' placeholder='Model label (e.g. My RunPod Wan2.2 Webhook)' class='w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-white'>
            <input id='vHookUrlIn' placeholder='https://hook.us1.make.com/... or Worker URL' class='w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-white'>
            <button id='vAddHookBtn' class='w-full py-2 rounded-lg bg-amber-500 text-zinc-950 text-xs font-black'>+ Add Webhook Model to Dropdown</button>
            <div id='vHooksList' class='space-y-1'></div>
          </div>
        </div>
      </details>

      <div class='bg-zinc-900/90 border border-zinc-800 rounded-xl p-3 space-y-2'>
        <div class='text-xs font-black text-emerald-300'>Recent Video Renders</div>
        <div id='vGallery' class='space-y-2'></div>
      </div>
    </div>`;
    bindEvents();
    setEngine(vcfg.engine);
    setVMode(vMode);
    renderHooksList();
    renderGallery();
  }

  function setEngine(eng) {
    vcfg.engine = eng;
    saveVCfg();
    [['vEngHf', 'hf'], ['vEngComfy', 'comfy'], ['vEngHook', 'webhook']].forEach(([id, k]) => {
      $(id).className = k === eng ? 'p-2 rounded-xl border bg-violet-600/25 border-violet-400 text-left' : 'p-2 rounded-xl border bg-zinc-950 border-zinc-800 text-left';
    });
    if (eng === 'hf') { $('vScanLbl').textContent = 'Scan Live'; $('vScanSub').textContent = 'Find ZeroGPU'; $('vModelSub').textContent = 'Auto-detects API inputs for any HF Space'; }
    else if (eng === 'comfy') { $('vScanLbl').textContent = 'Sync GPU'; $('vScanSub').textContent = 'Auto-Beacon'; $('vModelSub').textContent = 'Pulls live tunnel URL & models automatically'; }
    else { $('vScanLbl').textContent = 'Test Ping'; $('vScanSub').textContent = 'Check URL'; $('vModelSub').textContent = 'Sends prompt + photo JSON straight to webhook'; }
    populateModels();
  }

  function setVMode(m) {
    vMode = m;
    const isI2v = m === 'i2v';
    $('vImgWrap').classList.toggle('hidden', !isI2v);
    $('vModeT2v').className = !isI2v ? 'p-2.5 rounded-xl border bg-violet-600/25 border-violet-400 text-left' : 'p-2.5 rounded-xl border bg-zinc-900 border-zinc-800 text-left';
    $('vModeI2v').className = isI2v ? 'p-2.5 rounded-xl border bg-cyan-600/25 border-cyan-400 text-left' : 'p-2.5 rounded-xl border bg-zinc-900 border-zinc-800 text-left';
  }

  function populateModels() {
    const sel = $('vModelSel');
    if (!sel) return;
    if (vcfg.engine === 'hf') {
      sel.innerHTML = vcfg.hfSpaces.map(s => `<option value='${s.id}'>${s.label} (${s.id})</option>`).join('');
    } else if (vcfg.engine === 'comfy') {
      const list = vcfg.comfyModels.length ? vcfg.comfyModels : ['Tap Sync GPU to load models from remote ComfyUI'];
      sel.innerHTML = list.map(m => `<option value='${m}'>${m}</option>`).join('');
    } else {
      sel.innerHTML = vcfg.webhooks.length ? vcfg.webhooks.map(w => `<option value='${w.id}'>${w.name}</option>`).join('') : `<option value=''>Add a Webhook Model below first</option>`;
    }
  }

  async function loadSourceBlob(fileOrBlob, previewUrl) {
    vSourceBlob = fileOrBlob;
    $('vSrcPrev').src = previewUrl;
    $('vSrcPrev').classList.remove('hidden');
    $('vClearSrc').classList.remove('hidden');
    const fr = new FileReader();
    fr.onload = () => { vSourceB64 = String(fr.result || '').split(',')[1] || ''; };
    fr.readAsDataURL(fileOrBlob);
  }

  async function loadSourceFromUrl(url) {
    try {
      const r = await fetch(url);
      const blob = await r.blob();
      await loadSourceBlob(blob, URL.createObjectURL(blob));
      setVStatus('Loaded image from Studio! Ready to animate.');
    } catch {
      $('vSrcPrev').src = url;
      $('vSrcPrev').classList.remove('hidden');
      setVStatus('Preview loaded (save & pick file if remote host blocks CORS).');
    }
  }

  async function scanHfSpaces() {
    setVStatus('Scanning Hugging Face for live ZeroGPU video Spaces...');
    try {
      const r = await fetch('https://huggingface.co/api/spaces?search=wan2&sort=likes&direction=-1&limit=10');
      const arr = await r.json();
      const found = (Array.isArray(arr) ? arr : []).filter(s => s.id && s.runtime?.stage !== 'STOPPED').map(s => ({ id: s.id, label: s.id.split('/')[1] + ' (Live HF)' }));
      const seen = new Set(vcfg.hfSpaces.map(x => x.id));
      found.forEach(f => { if (!seen.has(f.id)) { vcfg.hfSpaces.push(f); seen.add(f.id); } });
      saveVCfg(); populateModels();
      setVStatus(`Model list updated (${vcfg.hfSpaces.length} Spaces ready).`);
    } catch (e) { setVStatus('Scan error: ' + e.message); }
  }

  async function syncComfyBeacon() {
    setVStatus(`Polling Auto-Beacon channel (${vcfg.beaconChannel})...`);
    try {
      const r = await fetch(`https://ntfy.sh/${encodeURIComponent(vcfg.beaconChannel)}/json?poll=1`);
      const txt = await r.text();
      const lines = txt.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const urls = lines.map(m => (m.message || '').match(/https:\/\/[^\s]+/)?.[0]).filter(Boolean);
      if (urls.length) {
        vcfg.comfyUrl = urls[urls.length - 1].replace(/\/$/, '');
        $('vComfyUrlIn').value = vcfg.comfyUrl;
        saveVCfg();
      }
      if (!vcfg.comfyUrl) return setVStatus('No GPU beacon received yet. Boot your GPU with the 1-line hook, then tap Sync GPU.');
      setVStatus(`Connected to ${vcfg.comfyUrl} — fetching installed models...`);
      const oi = await fetch(vcfg.comfyUrl + '/object_info/CheckpointLoaderSimple');
      const data = await oi.json();
      const ckpts = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
      if (ckpts.length) { vcfg.comfyModels = ckpts; saveVCfg(); populateModels(); }
      setVStatus(`Synced ${ckpts.length} models from active remote GPU!`);
    } catch (e) { setVStatus('Beacon/GPU sync failed: ' + e.message); }
  }

  function extractMediaUrl(obj) {
    if (!obj) return '';
    if (typeof obj === 'string' && /^https?:\/\//.test(obj)) return obj;
    if (typeof obj === 'object') {
      if (obj.url && /^https?:\/\//.test(obj.url)) return obj.url;
      if (obj.video?.url) return obj.video.url;
      for (const v of Object.values(obj)) { const hit = extractMediaUrl(v); if (hit) return hit; }
    }
    return '';
  }

  async function fireOutboundWebhook(item, customUrl = '') {
    const url = (customUrl || vcfg.autoHookUrl || '').trim();
    if (!url) return;
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'Media-Forge', ...item }) });
    } catch {}
  }

  function showVideoResult(url, prompt, model) {
    lastVideo = { id: 'vid_' + Date.now(), url, prompt, model, ts: new Date().toLocaleTimeString() };
    vVault.unshift(lastVideo);
    saveVVault();
    $('vResPlayer').src = url;
    $('vResMeta').textContent = `Model: ${model} | ${lastVideo.ts}`;
    $('vResWrap').classList.remove('hidden');
    setVStatus('Video ready! Saved to Recent Renders.');
    renderGallery();
    if (vcfg.autoHookUrl) fireOutboundWebhook(lastVideo);
  }

  async function runGenerate() {
    const prompt = $('vPromptIn').value.trim();
    if (!prompt) return alert('Enter a motion prompt first.');
    if (vMode === 'i2v' && !vSourceBlob) return alert('Pick a source photo or tap Animate in Video from the Image tab.');
    const neg = $('vNegIn').value.trim();
    const dur = Number($('vDurIn').value);
    const steps = Number($('vStepsIn').value);
    const selVal = $('vModelSel').value;
    $('vGenBtn').disabled = true; $('vGenBtn').classList.add('opacity-50');

    try {
      if (vcfg.engine === 'hf') {
        setVStatus(`Connecting to ${selVal} via Gradio Client...`);
        const { Client, handle_file } = await import('https://esm.sh/@gradio/client');
        const client = await Client.connect(selVal, vcfg.hfToken ? { token: vcfg.hfToken } : {});
        const api = await client.view_api();
        const entries = Object.entries(api.named_endpoints || {});
        if (!entries.length) throw new Error('Space exposes no public API endpoints.');
        const [epName, ep] = entries.find(([k]) => /gen|video|i2v|t2v|infer|pred/i.test(k)) || entries[0];
        setVStatus(`Auto-mapped endpoint ${epName} (${ep.parameters.length} inputs). Running on ZeroGPU...`);
        const args = ep.parameters.map(p => {
          const nm = ((p.parameter_name || p.label || '') + ' ' + (p.component || '')).toLowerCase();
          if (/image|file|upload/.test(nm) && vSourceBlob) return handle_file(vSourceBlob);
          if (/neg/.test(nm)) return neg;
          if (/prompt|caption|text/.test(nm)) return prompt;
          if (/step/.test(nm)) return steps;
          if (/dur|sec|len/.test(nm)) return dur;
          if (/random/.test(nm)) return true;
          if (/seed/.test(nm)) return Math.floor(Math.random() * 2147483647);
          return p.parameter_default !== undefined ? p.parameter_default : null;
        });
        const res = await client.predict(epName, args);
        const vidUrl = extractMediaUrl(res.data);
        if (!vidUrl) throw new Error('Space completed but returned no playable video URL.');
        showVideoResult(vidUrl, prompt, selVal);
      } else if (vcfg.engine === 'webhook') {
        const wh = vcfg.webhooks.find(w => w.id === selVal);
        if (!wh) throw new Error('Register and select a Webhook Model first.');
        setVStatus(`Dispatching job to webhook: ${wh.name}...`);
        const r = await fetch(wh.url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: vMode, prompt, negative_prompt: neg, duration: dur, steps, image_base64: vMode === 'i2v' ? vSourceB64 : '' })
        });
        const data = await r.json().catch(() => ({}));
        const vidUrl = extractMediaUrl(data);
        if (vidUrl) showVideoResult(vidUrl, prompt, wh.name);
        else setVStatus(`Webhook triggered (HTTP ${r.status}). Response: ` + JSON.stringify(data).slice(0, 180));
      } else {
        if (!vcfg.comfyUrl) throw new Error('Tap Sync GPU first so Media Forge knows your active GPU tunnel.');
        setVStatus(`Sending prompt directly to ${vcfg.comfyUrl}...`);
        const r = await fetch(vcfg.comfyUrl + '/prompt', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: 'media-forge', prompt: { '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: selVal } }, '2': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } } } })
        });
        const d = await r.json().catch(() => ({}));
        setVStatus(r.ok ? `Queued on ComfyUI GPU! Prompt ID: ${d.prompt_id || 'OK'}` : `ComfyUI HTTP ${r.status}: ${d.error?.message || 'Check workflow nodes'}`);
      }
    } catch (e) {
      setVStatus('ERROR: ' + e.message);
    } finally {
      $('vGenBtn').disabled = false; $('vGenBtn').classList.remove('opacity-50');
    }
  }

  function renderHooksList() {
    const box = $('vHooksList');
    if (!box) return;
    box.innerHTML = vcfg.webhooks.map((w, i) => `<div class='flex items-center justify-between gap-2 p-2 rounded-lg bg-zinc-950 border border-zinc-800'><div class='min-w-0'><div class='text-xs font-bold text-white truncate'>${w.name}</div><div class='text-[10px] text-zinc-400 truncate'>${w.url}</div></div><button data-dhk='${i}' class='px-2 py-1 rounded bg-rose-950 text-rose-300 text-[10px] font-bold shrink-0'>Remove</button></div>`).join('');
    box.querySelectorAll('[data-dhk]').forEach(b => b.onclick = () => { vcfg.webhooks.splice(Number(b.dataset.dhk), 1); saveVCfg(); renderHooksList(); populateModels(); });
  }

  function renderGallery() {
    const box = $('vGallery');
    if (!box) return;
    if (!vVault.length) { box.innerHTML = `<div class='text-xs text-zinc-500 text-center py-3'>No video renders yet.</div>`; return; }
    box.innerHTML = vVault.map((v, i) => `<div class='p-2 rounded-lg bg-zinc-950 border border-zinc-800 space-y-1.5'><video src='${v.url}' controls playsinline class='w-full rounded max-h-52 bg-black'></video><div class='text-[11px] font-bold text-white line-clamp-2'>${v.prompt.replaceAll('<', '&lt;')}</div><div class='flex items-center justify-between text-[10px] font-mono text-zinc-400'><span>${v.model} • ${v.ts}</span><button data-vrm='${i}' class='text-rose-400 font-bold'>Delete</button></div></div>`).join('');
    box.querySelectorAll('[data-vrm]').forEach(b => b.onclick = () => { vVault.splice(Number(b.dataset.vrm), 1); saveVVault(); renderGallery(); });
  }

  function bindEvents() {
    $('vEngHf').onclick = () => setEngine('hf');
    $('vEngComfy').onclick = () => setEngine('comfy');
    $('vEngHook').onclick = () => setEngine('webhook');
    $('vModeT2v').onclick = () => setVMode('t2v');
    $('vModeI2v').onclick = () => setVMode('i2v');
    $('vDurIn').oninput = e => $('vDurVal').textContent = e.target.value;
    $('vStepsIn').oninput = e => $('vStepsVal').textContent = e.target.value;
    $('vFileIn').onchange = e => { const f = e.target.files?.[0]; if (f) loadSourceBlob(f, URL.createObjectURL(f)); };
    $('vClearSrc').onclick = () => { vSourceBlob = null; vSourceB64 = ''; $('vSrcPrev').classList.add('hidden'); $('vClearSrc').classList.add('hidden'); $('vFileIn').value = ''; };
    $('vScanBtn').onclick = () => { if (vcfg.engine === 'hf') scanHfSpaces(); else if (vcfg.engine === 'comfy') syncComfyBeacon(); else setVStatus('Select a registered Webhook Model and tap Generate.'); };
    $('vGenBtn').onclick = runGenerate;
    $('vDlBtn').onclick = () => { if (lastVideo) window.open(lastVideo.url, '_blank'); };
    $('vFireHookBtn').onclick = () => { if (!vcfg.autoHookUrl) return alert('Set an Outbound Webhook URL under Connections first.'); fireOutboundWebhook(lastVideo); alert('Dispatched to webhook!'); };
    $('vSaveConnBtn').onclick = () => {
      vcfg.hfToken = $('vHfTokIn').value.trim();
      vcfg.beaconChannel = $('vBeaconCh').value.trim() || vcfg.beaconChannel;
      vcfg.comfyUrl = $('vComfyUrlIn').value.trim().replace(/\/$/, '');
      vcfg.autoHookUrl = $('vAutoHookIn').value.trim();
      saveVCfg(); setVStatus('Connections saved locally!');
    };
    $('vAddHookBtn').onclick = () => {
      const name = $('vHookNameIn').value.trim(), url = $('vHookUrlIn').value.trim();
      if (!name || !url) return alert('Enter both a model label and webhook URL.');
      vcfg.webhooks.push({ id: 'wh_' + Date.now(), name, url });
      $('vHookNameIn').value = ''; $('vHookUrlIn').value = '';
      saveVCfg(); renderHooksList(); setEngine('webhook');
    };
    $('vBeaconCmdBtn').onclick = () => {
      const ch = $('vBeaconCh').value.trim() || vcfg.beaconChannel;
      const cmd = `curl -d "https://YOUR-TUNNEL.trycloudflare.com" https://ntfy.sh/${ch}`;
      navigator.clipboard?.writeText(cmd).then(() => alert('1-line GPU Beacon hook copied! Add it once to your Kaggle/ComfyUI startup cell so Media Forge auto-syncs forever.')).catch(() => prompt('Add this 1 line to your GPU startup cell:', cmd));
    };
  }

  if (window.MediaForge) {
    window.MediaForge.onSendToVideo = async (url, prompt) => {
      setVMode('i2v');
      if ($('vPromptIn')) $('vPromptIn').value = prompt || '';
      await loadSourceFromUrl(url);
    };
  }
  renderShell();
})();