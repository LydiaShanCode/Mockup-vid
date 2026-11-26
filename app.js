(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const video = $('video');

  const state = {
    source: null,        // 'video' | 'image' | null
    screenImage: null,   // HTMLImageElement when the screen content is a still
    bgMode: 'color',
    bgColor: '#d9d8d3',
    bgImage: null,
    bgBlur: 0,
    bgDim: 0,
    fit: 'cover',
    island: true,
    frame: 'natural',
    size: 0.82,
    shadow: 0.35,
    exporting: false,
    screenMsg: null,
  };

  // iPhone-style proportions (screen in points: 393 × 852)
  const SCREEN_RATIO = 393 / 852;

  const FRAMES = {
    natural: { edge: ['#8d8a83', '#d8d5ce', '#a9a69f', '#e4e1da', '#85827b'], button: '#a3a09a' },
    black:   { edge: ['#1c1c1e', '#4a4a4d', '#2c2c2e', '#55555a', '#1a1a1c'], button: '#3a3a3c' },
    white:   { edge: ['#c9c9c6', '#f7f7f5', '#dcdcd9', '#ffffff', '#c2c2bf'], button: '#d4d4d1' },
    blue:    { edge: ['#2d3647', '#5d6a80', '#3c475a', '#6b788e', '#29313f'], button: '#4a566a' },
  };

  const SWATCHES = [
    '#d9d8d3', '#f5f1e8', '#ffffff', '#1d1d1f', '#e8d5c4', '#f4c7c3', '#ffd66b', '#c7e3c1',
    '#b9d7ea', '#cfc4f2', '#2f3cc9', '#ff5a36', '#0f5132', '#6b4f3a', '#9aa5b1', '#000000',
  ];

  // ---------- helpers ----------
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawFitted(src, sw, sh, x, y, w, h, mode) {
    const s = mode === 'contain' ? Math.min(w / sw, h / sh) : Math.max(w / sw, h / sh);
    const dw = sw * s, dh = sh * s;
    ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function fmt(t) {
    if (!isFinite(t)) t = 0;
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // ---------- rendering ----------
  function drawBackground(W, H) {
    if (state.bgMode === 'image' && state.bgImage) {
      ctx.save();
      const blur = state.bgBlur * (W / 1080);
      if (blur > 0) {
        ctx.filter = `blur(${blur}px)`;
        // overdraw slightly so blurred edges don't fade to transparent
        drawFitted(state.bgImage, state.bgImage.naturalWidth, state.bgImage.naturalHeight,
          -blur * 2, -blur * 2, W + blur * 4, H + blur * 4, 'cover');
      } else {
        drawFitted(state.bgImage, state.bgImage.naturalWidth, state.bgImage.naturalHeight, 0, 0, W, H, 'cover');
      }
      ctx.restore();
      if (state.bgDim > 0) {
        ctx.fillStyle = `rgba(0,0,0,${state.bgDim / 100})`;
        ctx.fillRect(0, 0, W, H);
      }
    } else {
      ctx.fillStyle = state.bgColor;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function phoneGeometry(W, H) {
    // Body height is a fraction of the canvas height, limited by width too.
    const metal = 0.0085, bezel = 0.0135; // fractions of body height
    let bodyH = H * state.size;
    const bodyWFor = (bh) => bh * (1 - 2 * (metal + bezel)) * SCREEN_RATIO + 2 * bh * (metal + bezel);
    const maxW = W * 0.9;
    if (bodyWFor(bodyH) > maxW) bodyH *= maxW / bodyWFor(bodyH);
    const bodyW = bodyWFor(bodyH);
    const x = (W - bodyW) / 2, y = (H - bodyH) / 2;
    const m = bodyH * metal, b = bodyH * bezel;
    const screen = { x: x + m + b, y: y + m + b, w: bodyW - 2 * (m + b), h: bodyH - 2 * (m + b) };
    screen.r = screen.h * 0.0645;
    return { x, y, w: bodyW, h: bodyH, m, b, screen, r: screen.r + m + b };
  }

  function drawButtons(g) {
    const f = FRAMES[state.frame];
    const t = g.h * 0.0055;           // how far the buttons stick out
    const bw = t * 1.6;
    ctx.fillStyle = f.button;
    const btn = (side, top, len) => {
      const bx = side === 'left' ? g.x - t : g.x + g.w - bw + t;
      rr(bx, g.y + g.h * top, bw, g.h * len, bw / 2);
      ctx.fill();
    };
    btn('left', 0.165, 0.045);  // action button
    btn('left', 0.245, 0.085);  // volume up
    btn('left', 0.35, 0.085);   // volume down
    btn('right', 0.27, 0.13);   // side button
  }

  function drawScreenContent(s) {
    ctx.save();
    rr(s.x, s.y, s.w, s.h, s.r);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(s.x, s.y, s.w, s.h);
    if (state.source === 'video' && video.videoWidth) {
      drawFitted(video, video.videoWidth, video.videoHeight, s.x, s.y, s.w, s.h, state.fit);
    } else if (state.source === 'image' && state.screenImage) {
      const im = state.screenImage;
      drawFitted(im, im.naturalWidth, im.naturalHeight, s.x, s.y, s.w, s.h, state.fit);
    } else {
      const grd = ctx.createLinearGradient(s.x, s.y, s.x, s.y + s.h);
      grd.addColorStop(0, '#f2f1ec');
      grd.addColorStop(1, '#e6e4dd');
      ctx.fillStyle = grd;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = '#8e8e93';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `500 ${s.w * 0.055}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.fillText(state.screenMsg || 'Drop a screen recording', s.x + s.w / 2, s.y + s.h / 2);
    }
    ctx.restore();
  }

  function drawPhone(W, H) {
    const g = phoneGeometry(W, H);
    const f = FRAMES[state.frame];

    drawButtons(g);

    // Body with drop shadow
    ctx.save();
    if (state.shadow > 0) {
      ctx.shadowColor = `rgba(0,0,0,${0.15 + state.shadow * 0.35})`;
      ctx.shadowBlur = g.h * 0.08 * state.shadow;
      ctx.shadowOffsetY = g.h * 0.03 * state.shadow;
    }
    const edge = ctx.createLinearGradient(g.x, 0, g.x + g.w, 0);
    const stops = [0, 0.04, 0.5, 0.96, 1];
    f.edge.forEach((c, i) => edge.addColorStop(stops[i], c));
    ctx.fillStyle = edge;
    rr(g.x, g.y, g.w, g.h, g.r);
    ctx.fill();
    ctx.restore();

    // Subtle vertical sheen on metal band
    const sheen = ctx.createLinearGradient(0, g.y, 0, g.y + g.h);
    sheen.addColorStop(0, 'rgba(255,255,255,0.18)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = sheen;
    rr(g.x, g.y, g.w, g.h, g.r);
    ctx.fill();

    // Black bezel
    ctx.fillStyle = '#050505';
    rr(g.x + g.m, g.y + g.m, g.w - 2 * g.m, g.h - 2 * g.m, g.r - g.m);
    ctx.fill();

    drawScreenContent(g.screen);

    // Dynamic Island
    if (state.island) {
      const s = g.screen;
      const iw = s.w * (126 / 393), ih = s.h * (37 / 852);
      const ix = s.x + (s.w - iw) / 2, iy = s.y + s.h * (11 / 852);
      ctx.fillStyle = '#000';
      rr(ix, iy, iw, ih, ih / 2);
      ctx.fill();
      // camera lens
      const cr = ih * 0.2;
      const cx = ix + iw - ih / 2 - cr * 0.6, cy = iy + ih / 2;
      const lens = ctx.createRadialGradient(cx - cr * 0.3, cy - cr * 0.3, 0, cx, cy, cr);
      lens.addColorStop(0, '#2a3550');
      lens.addColorStop(1, '#0a0c14');
      ctx.fillStyle = lens;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function render() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    drawBackground(W, H);
    drawPhone(W, H);
  }

  function loop() {
    render();
    if (state.source === 'video' && !state.exporting) updateTransport();
    requestAnimationFrame(loop);
  }

  // ---------- transport ----------
  function updateTransport() {
    const d = video.duration || 0;
    if (!scrubbing) $('scrub').value = d ? (video.currentTime / d) * 1000 : 0;
    $('time').textContent = `${fmt(video.currentTime)} / ${fmt(d)}`;
    $('playBtn').textContent = video.paused ? '▶' : '❚❚';
  }
  let scrubbing = false;
  $('scrub').addEventListener('input', (e) => {
    scrubbing = true;
    if (video.duration) video.currentTime = (e.target.value / 1000) * video.duration;
  });
  $('scrub').addEventListener('change', () => { scrubbing = false; });
  $('playBtn').addEventListener('click', () => {
    if (video.paused) video.play(); else video.pause();
  });

  // ---------- file loading ----------
  let videoURL = null, bgURL = null, shotURL = null;

  function loadScreen(file) {
    if (!file) return;
    if (file.type.startsWith('image/')) {
      if (shotURL) URL.revokeObjectURL(shotURL);
      shotURL = URL.createObjectURL(file);
      const img = new Image();
      ++loadToken;
      setNotice('');
      img.onload = () => {
        state.screenMsg = null;
        state.screenImage = img;
        state.source = 'image';
        video.pause();
        setControls();
      };
      img.src = shotURL;
    } else {
      tryVideo(file, file.name, true);
    }
    $('videoLabel').textContent = file.name;
    $('videoDrop').classList.add('loaded');
  }

  // Load a video blob into the <video> element. If the browser can't decode it
  // (e.g. HEVC .mov from an iPhone in Chrome), convert it to H.264 MP4 in-browser.
  let loadToken = 0;
  function tryVideo(blob, name, allowConvert) {
    const token = ++loadToken;
    let ready = false, failed = false;
    state.source = null;
    state.screenMsg = 'Loading video…';
    setControls();

    const fail = () => {
      if (failed || token !== loadToken) return;
      failed = true;
      clearTimeout(timer);
      state.source = null;
      setControls();
      if (allowConvert) convertAndLoad(blob, name, token);
      else {
        state.screenMsg = "Can't play this video";
        setNotice("This browser can't play that video, even after conversion. Try exporting it as MP4 (H.264).", 'error');
      }
    };
    const ok = () => {
      if (ready || failed || token !== loadToken) return;
      if (!video.videoWidth) return fail(); // audio plays but the video track can't be decoded
      ready = true;
      clearTimeout(timer);
      state.source = 'video';
      state.screenMsg = null;
      setControls();
      if (!allowConvert) setNotice('Converted to MP4. You can export now.');
      video.play().catch(() => setNotice('Tap ▶ under the preview to start playback.'));
    };

    if (videoURL) URL.revokeObjectURL(videoURL);
    videoURL = URL.createObjectURL(blob);
    video.onloadedmetadata = ok;
    video.onloadeddata = ok;
    video.onerror = fail;
    video.muted = true;
    video.loop = true;
    video.src = videoURL;
    video.load();
    // Starting playback also makes iOS Safari actually load the file.
    video.play().catch(() => {});
    const timer = setTimeout(() => { if (!ready) fail(); }, 10000);
  }

  // ---------- in-browser conversion (ffmpeg.wasm, loaded on demand) ----------
  const FFMPEG_CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
  let ffPromise = null;
  function getFFmpeg() {
    if (!ffPromise) {
      ffPromise = (async () => {
        const { FFmpeg } = await import('./vendor/ffmpeg/index.js');
        const { toBlobURL } = await import('./vendor/util/index.js');
        const ff = new FFmpeg();
        ff.on('progress', ({ progress }) => setConvProgress(progress));
        await ff.load({
          coreURL: await toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        return ff;
      })().catch((err) => { ffPromise = null; throw err; });
    }
    return ffPromise;
  }

  async function convertAndLoad(blob, name, token) {
    state.screenMsg = 'Converting video…';
    setNotice("This browser can't play this video format directly (often HEVC from an iPhone). " +
      'Converting it to MP4 on your device. The first conversion downloads about 32 MB.', 'info', 0);
    const ext = ((name.match(/\.[a-z0-9]+$/i) || ['.mov'])[0]).toLowerCase();
    const input = 'input' + ext, output = 'output.mp4';
    try {
      const ff = await getFFmpeg();
      if (token !== loadToken) return;
      setNotice('Converting video to MP4… keep this tab open.', 'info', 0);
      await ff.writeFile(input, new Uint8Array(await blob.arrayBuffer()));
      const code = await ff.exec([
        '-i', input,
        '-vf', "scale=-2:'min(ih,1600)'",
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart',
        output,
      ]);
      if (code !== 0) throw new Error('ffmpeg exited with code ' + code);
      const data = await ff.readFile(output);
      ff.deleteFile(input).catch(() => {});
      ff.deleteFile(output).catch(() => {});
      if (token !== loadToken) return;
      tryVideo(new Blob([data.buffer], { type: 'video/mp4' }), name, false);
    } catch (err) {
      console.error(err);
      if (token !== loadToken) return;
      state.screenMsg = "Can't play this video";
      setNotice("Couldn't convert this video: " + (err && err.message ? err.message : err) +
        '. Try re-saving it as MP4 (H.264), or open this page in Safari.', 'error');
    }
  }

  function setNotice(text, kind = 'info', progress = null) {
    const n = $('notice');
    n.hidden = !text;
    n.classList.toggle('error', kind === 'error');
    $('noticeText').textContent = text || '';
    $('convProgress').hidden = progress === null;
    if (progress !== null) setConvProgress(progress);
  }
  function setConvProgress(p) {
    p = Math.max(0, Math.min(1, p || 0));
    $('convBar').style.width = `${(p * 100).toFixed(0)}%`;
    if (state.screenMsg && state.screenMsg.startsWith('Converting')) {
      state.screenMsg = `Converting video… ${(p * 100).toFixed(0)}%`;
    }
  }

  function loadBg(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (bgURL) URL.revokeObjectURL(bgURL);
    bgURL = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { state.bgImage = img; };
    img.src = bgURL;
    $('bgLabel').textContent = file.name;
    $('bgDrop').classList.add('loaded');
  }

  function wireDrop(dropEl, inputEl, handler) {
    inputEl.addEventListener('change', () => handler(inputEl.files[0]));
    ['dragenter', 'dragover'].forEach((ev) => dropEl.addEventListener(ev, (e) => {
      e.preventDefault(); dropEl.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((ev) => dropEl.addEventListener(ev, (e) => {
      e.preventDefault(); dropEl.classList.remove('over');
    }));
    dropEl.addEventListener('drop', (e) => handler(e.dataTransfer.files[0]));
  }
  wireDrop($('videoDrop'), $('videoInput'), loadScreen);
  wireDrop($('bgDrop'), $('bgInput'), (f) => { loadBg(f); setBgMode('image'); });

  // Dropping a file anywhere on the stage loads it as the screen recording
  const stage = document.querySelector('.stage');
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => { e.preventDefault(); loadScreen(e.dataTransfer.files[0]); });

  // ---------- controls ----------
  function setBgMode(mode) {
    state.bgMode = mode;
    document.querySelectorAll('#bgMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    $('bgColorBox').hidden = mode !== 'color';
    $('bgImageBox').hidden = mode !== 'image';
  }
  document.querySelectorAll('#bgMode button').forEach((b) =>
    b.addEventListener('click', () => setBgMode(b.dataset.mode)));

  function setBgColor(c) {
    state.bgColor = c;
    $('bgColor').value = c;
    $('bgHex').value = c;
  }
  $('bgColor').addEventListener('input', (e) => setBgColor(e.target.value));
  $('bgHex').addEventListener('change', (e) => {
    let v = e.target.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#([0-9a-f]{3}){1,2}$/i.test(v)) {
      if (v.length === 4) v = '#' + [...v.slice(1)].map((c) => c + c).join('');
      setBgColor(v.toLowerCase());
    } else e.target.value = state.bgColor;
  });
  SWATCHES.forEach((c) => {
    const b = document.createElement('button');
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => setBgColor(c));
    $('swatches').appendChild(b);
  });

  $('bgBlur').addEventListener('input', (e) => { state.bgBlur = +e.target.value; });
  $('bgDim').addEventListener('input', (e) => { state.bgDim = +e.target.value; });
  $('fit').addEventListener('change', (e) => { state.fit = e.target.value; });
  $('island').addEventListener('change', (e) => { state.island = e.target.checked; });
  $('frameColor').addEventListener('change', (e) => { state.frame = e.target.value; });
  $('phoneSize').addEventListener('input', (e) => { state.size = e.target.value / 100; });
  $('shadow').addEventListener('input', (e) => { state.shadow = e.target.value / 100; });
  $('aspect').addEventListener('change', (e) => {
    const [w, h] = e.target.value.split('x').map(Number);
    canvas.width = w; canvas.height = h;
  });

  function setControls() {
    const isVideo = state.source === 'video';
    $('exportBtn').disabled = !isVideo || state.exporting;
    $('playBtn').disabled = !isVideo;
    $('scrub').disabled = !isVideo;
  }

  function setStatus(msg) { $('status').textContent = msg; }

  // ---------- export ----------
  const FORMATS = [
    { label: 'MP4 (H.264)', ext: 'mp4', mimes: ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1', 'video/mp4'] },
    { label: 'WebM (VP9)', ext: 'webm', mimes: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8,opus', 'video/webm'] },
  ];
  const supported = [];
  if (window.MediaRecorder) {
    FORMATS.forEach((f) => {
      const mime = f.mimes.find((m) => MediaRecorder.isTypeSupported(m));
      if (mime) supported.push({ ...f, mime });
    });
  }
  if (!supported.length) {
    $('format').innerHTML = '<option>Not supported in this browser</option>';
    $('format').disabled = true;
  } else {
    supported.forEach((f, i) => $('format').add(new Option(f.label, i)));
  }

  let audioCtx = null, audioDest = null;
  function getAudioTrack() {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const src = audioCtx.createMediaElementSource(video);
        audioDest = audioCtx.createMediaStreamDestination();
        src.connect(audioDest);
        src.connect(audioCtx.destination);
      }
      audioCtx.resume();
      return audioDest.stream.getAudioTracks()[0] || null;
    } catch (err) {
      console.warn('Audio capture unavailable', err);
      return null;
    }
  }

  // Everything up to video.play() runs synchronously inside the click, because
  // iOS Safari only allows unmuted playback / AudioContext from a user gesture.
  function exportVideo() {
    if (state.source !== 'video' || !supported.length || state.exporting) return;
    const format = supported[+$('format').value] || supported[0];
    const fps = +$('fps').value;
    let withAudio = $('audio').checked;

    state.exporting = true;
    setControls();
    $('progress').hidden = false;
    $('bar').style.width = '0%';
    setStatus('Recording… keep this tab visible.');

    const stream = canvas.captureStream(fps);
    if (withAudio) {
      const track = getAudioTrack();
      if (track) stream.addTrack(track); else withAudio = false;
    }
    let mime = format.mime;
    if (!withAudio) {
      // drop the audio codec from the mime type when there's no audio track
      mime = format.mimes.find((m) => !/mp4a|opus/.test(m) && MediaRecorder.isTypeSupported(m)) || format.mime;
    }

    let rec;
    try {
      const pixels = canvas.width * canvas.height;
      rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: Math.round(Math.min(40e6, pixels * fps * 0.12)),
      });
    } catch (err) {
      return finishExport(null, null, 'Export failed: ' + err.message);
    }
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((resolve) => { rec.onstop = resolve; });

    video.pause();
    video.loop = false;
    video.muted = !withAudio;
    video.currentTime = 0;
    const playing = video.play();

    (async () => {
      try {
        await playing;
      } catch (err) {
        if (!video.muted) {
          // Unmuted playback blocked: record without audio instead.
          video.muted = true;
          withAudio = false;
          try { await video.play(); } catch (e2) { return abort(e2); }
        } else return abort(err);
      }

      const tick = setInterval(() => {
        const p = video.duration ? video.currentTime / video.duration : 0;
        $('bar').style.width = `${(p * 100).toFixed(1)}%`;
        $('time').textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
      }, 100);
      const stop = () => setTimeout(() => rec.state !== 'inactive' && rec.stop(), 120);
      video.addEventListener('ended', stop, { once: true });
      // Safety net in case 'ended' never fires.
      const guard = setTimeout(stop, ((video.duration || 600) + 5) * 1000);
      rec.start(250);

      await done;
      clearInterval(tick);
      clearTimeout(guard);
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      const fname = `mockup-${Date.now()}.${format.ext}`;
      download(blob, fname);
      finishExport(stream, blob, `Exported ${(blob.size / 1e6).toFixed(1)} MB ${format.ext.toUpperCase()}` +
        ($('audio').checked && !withAudio ? ' (without audio, because this browser blocked it).' : '.'));
    })();

    function abort(err) {
      console.error(err);
      finishExport(stream, null, 'Export failed: playback was blocked (' + (err && err.message) + '). Tap ▶ once, then try again.');
    }
  }

  let lastExportURL = null;
  function finishExport(stream, blob, msg) {
    if (stream) stream.getTracks().forEach((t) => t.kind === 'video' && t.stop());
    video.muted = true;
    video.loop = true;
    video.currentTime = 0;
    video.play().catch(() => {});
    $('bar').style.width = blob ? '100%' : '0%';
    setStatus(msg);
    if (blob) {
      // Fallback for browsers (e.g. iOS Safari) that ignore the automatic download.
      if (lastExportURL) URL.revokeObjectURL(lastExportURL);
      lastExportURL = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = lastExportURL;
      a.download = `mockup-${Date.now()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
      a.textContent = 'Download video';
      a.className = 'dl';
      $('status').append(' ', a);
    }
    state.exporting = false;
    setControls();
    setTimeout(() => { $('progress').hidden = true; }, 1500);
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  $('exportBtn').addEventListener('click', exportVideo);
  $('pngBtn').addEventListener('click', () => {
    render();
    canvas.toBlob((b) => download(b, `mockup-${Date.now()}.png`), 'image/png');
  });

  // Expose for automated testing
  window.__mockup = { state, render, exportVideo, loadScreen, loadBg };

  loop();
})();
