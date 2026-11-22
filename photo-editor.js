(() => {
  if (window.__mfPhotoEdLoaded) return;
  window.__mfPhotoEdLoaded = true;
  const $ = id => document.getElementById(id);
  const HORDE = 'https://aihorde.net/api/v2';
  const AGENT = 'MediaForge:1.0:badpeachring';

  let prevPromptBackup = '';
  let brushMode = 'paint';
  let brushSize = 28;
  let hasMaskStrokes = false;
  let allCachedModels = [];

  const getKey = () => {
    try { return JSON.parse(localStorage.getItem('media_forge_cfg_v1') || '{}').apiKey || '0000000000'; } catch { return '0000000000'; }
  };

  function mountPromptExpander() {
    const promptEl = $('promptIn');
    if (!promptEl || $('mfExpandBar')) return;
    const bar = document.createElement('div');
    bar.id = 'mfExpandBar';
    bar.className = 'flex items-center gap-1.5 mt-1.5';
    bar.innerHTML = `<button id='mfExpandBtn' type='button' class='flex-1 py-1.5 px-2.5 rounded-lg bg-indigo-600/30 border border-indigo-400/50 text-left'><span class='block text-[11px] font-black text-indigo-200'>AI Context &amp; Prompt Enhancer</span><span class='block text-[9px] text-indigo-300/75'>Expands rough ideas into detailed lighting, anatomy &amp; camera tags</span></button><button id='mfUndoPromptBtn' type='button' class='hidden px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-left shrink-0'><span class='block text-[11px] font-bold text-zinc-200'>Undo</span><span class='block text-[9px] text-zinc-400'>Revert</span></button>`;
    promptEl.insertAdjacentElement('afterend', bar);
    $('mfExpandBtn').onclick = expandPromptWithLLM;
    $('mfUndoPromptBtn').onclick = () => {
      if (prevPromptBackup) { $('promptIn').value = prevPromptBackup; $('mfUndoPromptBtn').classList.add('hidden'); }
    };
  }

  async function expandPromptWithLLM() {
    const raw = $('promptIn').value.trim();
    if (!raw) return alert('Type a rough idea or edit instruction first.');
    prevPromptBackup = raw;
    const btn = $('mfExpandBtn');
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Enhancing context via free LLM...';
    const isEdit = !$('imgUploadWrap')?.classList.contains('hidden');
    const sys = isEdit
      ? 'You are an expert Stable Diffusion inpainting prompt engineer. Rewrite the user edit request into a concise, vivid comma-separated image prompt describing the exact replacement clothing/object, natural skin texture, seamless lighting match, and photorealistic detail. Output ONLY the prompt tags, no explanations.'
      : 'You are an expert Stable Diffusion and Flux prompt engineer. Expand the user concept into a detailed, vivid image generation prompt with subject details, spatial layout, lighting, lens, and texture. Output ONLY the prompt, no explanations.';
    try {
      const r = await fetch(HORDE + '/generate/text/async', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: getKey(), 'Client-Agent': AGENT },
        body: JSON.stringify({
          prompt: `${sys}\n\nUser request: ${raw}\nEnhanced prompt:`,
          params: { max_length: 140, max_context_length: 1024, temperature: 0.7, top_p: 0.9 }
        })
      });
      const d = await r.json();
      if (!r.ok || !d.id) throw new Error(d.message || 'Text worker busy');
      for (let i = 0; i < 18; i++) {
        await new Promise(res => setTimeout(res, 2000));
        const sr = await fetch(HORDE + '/generate/text/status/' + d.id, { headers: { 'Client-Agent': AGENT } });
        const st = await sr.json();
        if (st.done && st.generations?.[0]?.text) {
          const clean = st.generations[0].text.trim().replace(/^["']|["']$/g, '');
          if (clean) {
            $('promptIn').value = clean;
            $('mfUndoPromptBtn').classList.remove('hidden');
          }
          break;
        }
      }
    } catch (e) {
      alert('Prompt enhancer queue busy (' + e.message + '). Your original prompt is untouched.');
    } finally {
      btn.disabled = false;
      btn.querySelector('span').textContent = 'AI Context & Prompt Enhancer';
    }
  }

  function mountMaskEditor() {
    const wrap = $('imgUploadWrap');
    const prev = $('sourcePreview');
    if (!wrap || !prev || $('mfMaskStudio')) return;

    const box = document.createElement('div');
    box.id = 'mfMaskStudio';
    box.className = 'hidden space-y-2 pt-1 border-t border-zinc-800';
    box.innerHTML = `<div class='flex items-center justify-between gap-2'><div><div class='text-xs font-black text-rose-300'>Photoshop Mask Brush (Inpainting)</div><div class='text-[10px] text-zinc-400'>Paint over ONLY what you want replaced (e.g. clothing to swap)</div></div><span id='mfMaskBadge' class='px-2 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300'>Full Restyle</span></div>
      <div class='relative w-full rounded-xl overflow-hidden border border-rose-500/40 bg-black flex justify-center'>
        <canvas id='mfBgCanvas' class='max-w-full max-h-72 block'></canvas>
        <canvas id='mfMaskCanvas' class='max-w-full max-h-72 block absolute inset-0 m-auto touch-none cursor-crosshair opacity-65'></canvas>
      </div>
      <div class='grid grid-cols-4 gap-1.5'>
        <button id='mfBrushPaint' type='button' class='p-1.5 rounded-lg bg-rose-600/30 border border-rose-400 text-left'><span class='block text-[10px] font-black text-white'>Paint Mask</span><span class='block text-[8px] text-rose-200'>Area to edit</span></button>
        <button id='mfBrushErase' type='button' class='p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-left'><span class='block text-[10px] font-black text-zinc-300'>Eraser</span><span class='block text-[8px] text-zinc-400'>Keep original</span></button>
        <button id='mfMaskInvert' type='button' class='p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-left'><span class='block text-[10px] font-black text-cyan-300'>Invert</span><span class='block text-[8px] text-zinc-400'>Swap background</span></button>
        <button id='mfMaskClear' type='button' class='p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-left'><span class='block text-[10px] font-black text-amber-300'>Clear</span><span class='block text-[8px] text-zinc-400'>Reset mask</span></button>
      </div>
      <div>
        <div class='flex justify-between text-[10px]'><span class='font-bold text-zinc-300'>Brush Size</span><span id='mfBrushSzVal' class='font-mono text-rose-300'>28px</span></div>
        <input id='mfBrushSzIn' type='range' min='8' max='72' value='28' class='w-full accent-rose-500'>
      </div>
      <div>
        <label class='block text-[11px] font-bold text-zinc-200'>Structure &amp; Pose Lock (ControlNet)</label>
        <select id='mfControlNetIn' class='mt-1 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white'>
          <option value=''>Auto (Pure Inpaint when masked / Free Img2Img)</option>
          <option value='depth'>Depth Lock (Preserves 3D body shape &amp; camera depth)</option>
          <option value='canny'>Canny Edge Lock (Preserves exact outlines &amp; creases)</option>
          <option value='openpose'>OpenPose Lock (Locks human skeleton &amp; limb positions)</option>
        </select>
        <div class='text-[9px] text-zinc-400 mt-0.5'>For swapping outfits/skin, leave on Auto with a painted mask &amp; 0.85+ Change Strength.</div>
      </div>`;

    prev.insertAdjacentElement('afterend', box);
    prev.classList.add('!hidden');

    const syncImageToCanvases = () => {
      if (!prev.src || prev.src === location.href) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const bg = $('mfBgCanvas'), mk = $('mfMaskCanvas');
        bg.width = mk.width = img.naturalWidth || 512;
        bg.height = mk.height = img.naturalHeight || 512;
        bg.getContext('2d').drawImage(img, 0, 0, bg.width, bg.height);
        mk.getContext('2d').clearRect(0, 0, mk.width, mk.height);
        hasMaskStrokes = false;
        updateMaskBadge();
        $('mfMaskStudio').classList.remove('hidden');
      };
      img.src = prev.src;
    };

    const obs = new MutationObserver(syncImageToCanvases);
    obs.observe(prev, { attributes: true, attributeFilter: ['src'] });
    if (prev.src && prev.src !== location.href) syncImageToCanvases();

    const mk = $('mfMaskCanvas');
    let drawing = false;
    const getPt = e => {
      const r = mk.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * mk.width, y: ((e.clientY - r.top) / r.height) * mk.height };
    };
    const strokeAt = e => {
      const ctx = mk.getContext('2d');
      const { x, y } = getPt(e);
      ctx.save();
      ctx.globalCompositeOperation = brushMode === 'erase' ? 'destination-out' : 'source-over';
      ctx.fillStyle = '#ff2a6d';
      ctx.beginPath();
      ctx.arc(x, y, (brushSize / 2) * (mk.width / 320), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (brushMode === 'paint') { hasMaskStrokes = true; updateMaskBadge(); }
    };
    mk.onpointerdown = e => { drawing = true; mk.setPointerCapture(e.pointerId); strokeAt(e); };
    mk.onpointermove = e => { if (drawing) strokeAt(e); };
    mk.onpointerup = e => { drawing = false; if (mk.hasPointerCapture(e.pointerId)) mk.releasePointerCapture(e.pointerId); };

    $('mfBrushPaint').onclick = () => {
      brushMode = 'paint';
      $('mfBrushPaint').className = 'p-1.5 rounded-lg bg-rose-600/30 border border-rose-400 text-left';
      $('mfBrushErase').className = 'p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-left';
    };
    $('mfBrushErase').onclick = () => {
      brushMode = 'erase';
      $('mfBrushErase').className = 'p-1.5 rounded-lg bg-cyan-600/30 border border-cyan-400 text-left';
      $('mfBrushPaint').className = 'p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-left';
    };
    $('mfBrushSzIn').oninput = e => { brushSize = Number(e.target.value); $('mfBrushSzVal').textContent = brushSize + 'px'; };
    $('mfMaskClear').onclick = () => {
      mk.getContext('2d').clearRect(0, 0, mk.width, mk.height);
      hasMaskStrokes = false; updateMaskBadge();
    };
    $('mfMaskInvert').onclick = () => {
      const ctx = mk.getContext('2d');
      const imgData = ctx.getImageData(0, 0, mk.width, mk.height);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const painted = d[i + 3] > 20;
        d[i] = painted ? 0 : 255; d[i + 1] = painted ? 0 : 42; d[i + 2] = painted ? 0 : 109; d[i + 3] = painted ? 0 : 255;
      }
      ctx.putImageData(imgData, 0, 0);
      hasMaskStrokes = true; updateMaskBadge();
    };
    $('clearSourceBtn')?.addEventListener('click', () => { $('mfMaskStudio').classList.add('hidden'); hasMaskStrokes = false; });
  }

  function updateMaskBadge() {
    const b = $('mfMaskBadge');
    if (!b) return;
    if (hasMaskStrokes) {
      b.textContent = 'Inpaint Active (0.85)';
      b.className = 'px-2 py-0.5 rounded bg-rose-600 text-[10px] font-black text-white';
      if ($('denoiseIn') && Number($('denoiseIn').value) < 0.8) {
        $('denoiseIn').value = '0.85';
        if ($('denoiseVal')) $('denoiseVal').textContent = '0.85';
      }
    } else {
      b.textContent = 'Full Restyle';
      b.className = 'px-2 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300';
    }
  }

  function exportBinaryMaskB64() {
    const mk = $('mfMaskCanvas');
    if (!mk || !hasMaskStrokes) return '';
    const out = document.createElement('canvas');
    out.width = mk.width; out.height = mk.height;
    const octx = out.getContext('2d');
    octx.fillStyle = '#000000';
    octx.fillRect(0, 0, out.width, out.height);
    const src = mk.getContext('2d').getImageData(0, 0, mk.width, mk.height).data;
    const dstImg = octx.getImageData(0, 0, out.width, out.height);
    const dst = dstImg.data;
    let paintedPixels = 0;
    for (let i = 0; i < src.length; i += 4) {
      if (src[i + 3] > 20) { dst[i] = 255; dst[i + 1] = 255; dst[i + 2] = 255; dst[i + 3] = 255; paintedPixels++; }
    }
    if (paintedPixels < 15) return '';
    octx.putImageData(dstImg, 0, 0);
    return out.toDataURL('image/png').split(',')[1];
  }

  function mountModelFilter() {
    const sel = $('modelSelect');
    if (!sel || $('mfArchFilter')) return;
    const bar = document.createElement('div');
    bar.id = 'mfArchFilter';
    bar.className = 'grid grid-cols-3 gap-1.5';
    bar.innerHTML = `<button data-flt='all' class='mf-flt py-1 px-2 rounded-lg bg-amber-500/25 border border-amber-400 text-[10px] font-bold text-amber-200'>All GPUs</button><button data-flt='context' class='mf-flt py-1 px-2 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px] font-bold text-zinc-400'>High-Context (Flux/XL)</button><button data-flt='inpaint' class='mf-flt py-1 px-2 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px] font-bold text-zinc-400'>Inpaint Specialists</button>`;
    sel.insertAdjacentElement('beforebegin', bar);

    const syncCache = async () => {
      try {
        const r = await fetch(HORDE + '/status/models?type=image', { headers: { 'Client-Agent': AGENT } });
        allCachedModels = (await r.json()).filter(m => m.count > 0).sort((a, b) => b.count - a.count);
      } catch {}
    };
    syncCache();

    bar.querySelectorAll('.mf-flt').forEach(b => b.onclick = async () => {
      bar.querySelectorAll('.mf-flt').forEach(x => x.className = x === b ? 'mf-flt py-1 px-2 rounded-lg bg-amber-500/25 border border-amber-400 text-[10px] font-bold text-amber-200' : 'mf-flt py-1 px-2 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px] font-bold text-zinc-400');
      if (!allCachedModels.length) await syncCache();
      const modeF = b.dataset.flt;
      let list = allCachedModels;
      if (modeF === 'context') list = allCachedModels.filter(m => /flux|chroma|xl|pony|illustrious|hidream|juggernaut/i.test(m.name));
      if (modeF === 'inpaint') list = allCachedModels.filter(m => /inpaint/i.test(m.name));
      sel.innerHTML = '<option value="AUTO">Auto (Best Matching Worker)</option>' + list.slice(0, 45).map(m => `<option value="${m.name.replaceAll('"', '&quot;')}">${m.name} (${m.count} GPUs • ~${m.eta}s)</option>`).join('');
    });
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.includes('/api/v2/generate/async') && init?.body) {
      try {
        const payload = JSON.parse(init.body);
        if (payload.source_image) {
          const maskB64 = exportBinaryMaskB64();
          const ctrl = $('mfControlNetIn')?.value || '';
          if (maskB64) {
            payload.source_mask = maskB64;
            payload.source_processing = 'inpainting';
            payload.params = payload.params || {};
            payload.params.denoising_strength = Math.max(0.8, Number(payload.params.denoising_strength || 0.85));
            if (!payload.models && allCachedModels.length) {
              const inp = allCachedModels.find(m => /inpaint/i.test(m.name));
              if (inp) payload.models = [inp.name];
            }
          } else if (ctrl) {
            payload.params = payload.params || {};
            payload.params.control_type = ctrl;
            payload.params.image_is_control = false;
          }
          init = { ...init, body: JSON.stringify(payload) };
        }
      } catch {}
    }
    return origFetch(input, init);
  };

  mountPromptExpander();
  mountMaskEditor();
  mountModelFilter();
})();