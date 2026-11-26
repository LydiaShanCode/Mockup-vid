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
    gapFill: 'edges',
    heightPct: 1,
    safari: false,
    barStyle: 'auto',
    uiTime: '9:41',
    uiUrl: 'example.com',
    uiNetwork: '5G',
    uiBattery: 100,
    gapColor: '#ffffff',
  };

  // iPhone-style proportions (screen in points: 393 × 852)

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

  // Geometry is width-based so the phone can be made shorter without the
  // corners, island and buttons changing size. Units: iPhone points (393 wide).
  const STD_ASPECT = 852 / 393;           // standard screen height / width
  const METAL = 0.0175, BEZEL = 0.0278;   // fractions of body width
  const STATUS_H = 54, TOOLBAR_H = 86;    // Safari UI heights in points

  function phoneGeometry(W, H) {
    const stdBodyRatio = (1 - 2 * (METAL + BEZEL)) * STD_ASPECT + 2 * (METAL + BEZEL);
    // "Size" is the height of a standard-height phone; shortening keeps the width.
    let bodyW = Math.min((H * state.size) / stdBodyRatio, W * 0.9);
    const m = bodyW * METAL, b = bodyW * BEZEL;
    const sw = bodyW - 2 * (m + b);
    const sh = sw * STD_ASPECT * state.heightPct;
    const bodyH = sh + 2 * (m + b);
    const x = (W - bodyW) / 2, y = (H - bodyH) / 2;
    const screen = { x: x + m + b, y: y + m + b, w: sw, h: sh, r: sw * (55 / 393) };
    return { x, y, w: bodyW, h: bodyH, m, b, screen, r: screen.r + m + b };
  }

  function drawButtons(g) {
    const f = FRAMES[state.frame];
    const t = g.w * 0.0113;           // how far the buttons stick out
    const bw = t * 1.6;
    ctx.fillStyle = f.button;
    const btn = (side, top, len) => {
      if (g.w * (top + len) > g.h - g.r * 0.6) return; // skip if the phone is too short
      const bx = side === 'left' ? g.x - t : g.x + g.w - bw + t;
      rr(bx, g.y + g.w * top, bw, g.w * len, bw / 2);
      ctx.fill();
    };
    btn('left', 0.34, 0.093);   // action button
    btn('left', 0.505, 0.175);  // volume up
    btn('left', 0.722, 0.175);  // volume down
    btn('right', 0.557, 0.268); // side button
  }

  // Small offscreen canvas used to sample edge colours and to make a cheap blur
  // (downscale, then upscale with smoothing) that works in every browser.
  const sampler = document.createElement('canvas');
  const sctx = sampler.getContext('2d', { willReadFrequently: true });
  const edgeColors = {}; // smoothed colours per side, so the fill doesn't flicker

  function avgColor(data, idxs) {
    let r = 0, g = 0, b = 0;
    for (const i of idxs) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
    const n = idxs.length || 1;
    return [r / n, g / n, b / n];
  }

  function sampleEdges(src, sw, sh) {
    const W = 24, H = Math.max(2, Math.round(24 * sh / sw));
    sampler.width = W; sampler.height = H;
    sctx.drawImage(src, 0, 0, W, H);
    let d;
    try { d = sctx.getImageData(0, 0, W, H).data; } catch (e) { return null; }
    const row = (y) => Array.from({ length: W }, (_, x) => (y * W + x) * 4);
    const col = (x) => Array.from({ length: H }, (_, y) => (y * W + x) * 4);
    const fresh = { top: avgColor(d, row(0)), bottom: avgColor(d, row(H - 1)),
                    left: avgColor(d, col(0)), right: avgColor(d, col(W - 1)) };
    for (const k in fresh) {
      const prev = edgeColors[k];
      edgeColors[k] = prev ? prev.map((v, i) => v + (fresh[k][i] - v) * 0.35) : fresh[k];
    }
    return edgeColors;
  }
  const rgb = (c) => `rgb(${c.map(Math.round).join(',')})`;

  // Where the recording sits on the screen: below the status bar and above the
  // Safari toolbar when the Safari UI is on, otherwise the whole screen.
  function contentRect(s) {
    if (!state.safari) return s;
    const u = s.w / 393;
    return { x: s.x, y: s.y + STATUS_H * u, w: s.w, h: s.h - (STATUS_H + TOOLBAR_H) * u };
  }

  function placed(sw, sh, c, mode) {
    const k = mode === 'contain' ? Math.min(c.w / sw, c.h / sh) : Math.max(c.w / sw, c.h / sh);
    const dw = sw * k, dh = sh * k;
    const dx = c.x + (c.w - dw) / 2, dy = c.y + (c.h - dh) / 2;
    // visible part, clipped to the content rect
    return { x0: Math.max(dx, c.x), y0: Math.max(dy, c.y),
             x1: Math.min(dx + dw, c.x + c.w), y1: Math.min(dy + dh, c.y + c.h) };
  }

  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

  // Colour actually behind the top / bottom of the screen (drives the bar style)
  function fillColor(side) {
    if (state.gapFill === 'black') return [0, 0, 0];
    if (state.gapFill === 'color') return hexToRgb(state.gapColor);
    return edgeColors[side] || [240, 240, 236];
  }

  function drawGaps(src, sw, sh, s, c) {
    const v = placed(sw, sh, c, state.fit);
    if (state.gapFill === 'black') { ctx.fillStyle = '#000'; ctx.fillRect(s.x, s.y, s.w, s.h); return; }
    if (state.gapFill === 'color') { ctx.fillStyle = state.gapColor; ctx.fillRect(s.x, s.y, s.w, s.h); return; }
    const e = sampleEdges(src, sw, sh);
    if (state.gapFill === 'blur') {
      sampler.width = 12; sampler.height = Math.max(2, Math.round(12 * sh / sw));
      sctx.drawImage(src, 0, 0, sampler.width, sampler.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      drawFitted(sampler, sampler.width, sampler.height, s.x, s.y, s.w, s.h, 'cover');
      return;
    }
    if (!e) { ctx.fillStyle = '#000'; ctx.fillRect(s.x, s.y, s.w, s.h); return; }
    if (v.y0 > s.y + 0.5) { ctx.fillStyle = rgb(e.top); ctx.fillRect(s.x, s.y, s.w, v.y0 - s.y + 1); }
    if (v.y1 < s.y + s.h - 0.5) { ctx.fillStyle = rgb(e.bottom); ctx.fillRect(s.x, v.y1 - 1, s.w, s.y + s.h - v.y1 + 1); }
    if (v.x0 > s.x + 0.5) { ctx.fillStyle = rgb(e.left); ctx.fillRect(s.x, v.y0, v.x0 - s.x + 1, v.y1 - v.y0); }
    if (v.x1 < s.x + s.w - 0.5) { ctx.fillStyle = rgb(e.right); ctx.fillRect(v.x1 - 1, v.y0, s.x + s.w - v.x1 + 1, v.y1 - v.y0); }
  }

  function drawScreenContent(s) {
    ctx.save();
    rr(s.x, s.y, s.w, s.h, s.r);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(s.x, s.y, s.w, s.h);
    let src = null, sw = 0, sh = 0;
    if (state.source === 'video' && video.videoWidth && video.readyState >= 2) {
      src = video; sw = video.videoWidth; sh = video.videoHeight;
    } else if (state.source === 'image' && state.screenImage) {
      src = state.screenImage; sw = src.naturalWidth; sh = src.naturalHeight;
    }
    const c = contentRect(s);
    if (src) {
      if (state.fit === 'contain' || state.safari) drawGaps(src, sw, sh, s, c);
      ctx.save();
      ctx.beginPath();
      ctx.rect(c.x, c.y, c.w, c.h);
      ctx.clip();
      drawFitted(src, sw, sh, c.x, c.y, c.w, c.h, state.fit);
      ctx.restore();
    } else if (state.source === 'video' && video.videoWidth) {
      // video selected but no frame decoded yet: keep the black screen
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
    if (state.safari) drawSafariUI(s, src ? null : [240, 240, 236]);
    ctx.restore();
  }

  // ---------- Safari / iOS chrome ----------
  const UI_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Segoe UI", sans-serif';
  const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  function isDark(side, fallback) {
    if (state.barStyle === 'light') return false;
    if (state.barStyle === 'dark') return true;
    return lum(fallback || fillColor(side)) < 0.5;
  }

  function drawSafariUI(s, fallback) {
    const u = s.w / 393;
    const X = (p) => s.x + p * u, Y = (p) => s.y + p * u, YB = (p) => s.y + s.h - p * u;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // --- status bar ---
    const fg = isDark('top', fallback) ? '#fff' : '#000';
    const cy = Y(30);
    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = `600 ${17 * u}px ${UI_FONT}`;
    ctx.fillText(state.uiTime, X(64), cy + 0.5 * u);

    // right cluster, laid out right-to-left from x = 360
    let rx = 360;
    // battery
    const bw = 25, bh = 12;
    const bx = rx - bw - 2;
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = fg;
    ctx.lineWidth = 1 * u;
    rr(X(bx), cy - (bh / 2) * u, bw * u, bh * u, 3.8 * u); ctx.stroke();
    rr(X(bx + bw + 0.8), cy - 2 * u, 1.6 * u, 4 * u, 0.8 * u); ctx.fill();
    ctx.globalAlpha = 1;
    const lvl = Math.max(0.06, state.uiBattery / 100);
    rr(X(bx + 2), cy - (bh / 2 - 2) * u, (bw - 4) * lvl * u, (bh - 4) * u, 2.2 * u); ctx.fill();
    rx = bx - 6;
    // network
    if (state.uiNetwork === 'wifi') {
      const wx = X(rx - 8.5), wy = cy + 5 * u;
      ctx.beginPath(); ctx.moveTo(wx, wy); ctx.arc(wx, wy, 3.2 * u, -Math.PI * 0.75, -Math.PI * 0.25); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 2 * u;
      for (const r of [7, 11]) { ctx.beginPath(); ctx.arc(wx, wy, r * u, -Math.PI * 0.75, -Math.PI * 0.25); ctx.stroke(); }
      rx -= 17 + 6;
    } else {
      ctx.textAlign = 'right';
      ctx.font = `600 ${14 * u}px ${UI_FONT}`;
      ctx.fillText(state.uiNetwork, X(rx), cy + 0.5 * u);
      rx -= ctx.measureText(state.uiNetwork).width / u + 6;
    }
    // signal bars
    [4.5, 6.8, 9.2, 11.5].forEach((h, i) => {
      rr(X(rx - 17 + i * 4.6), cy + (5.75 - h) * u, 3 * u, h * u, 0.9 * u);
      ctx.fill();
    });

    // --- Safari toolbar ---
    const dark = isDark('bottom', fallback);
    const ink = dark ? '#fff' : '#1d1d1f';
    const dim = dark ? 'rgba(255,255,255,0.4)' : 'rgba(60,60,67,0.3)';
    const by = YB(57);
    const glass = (x, w) => {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.14)';
      ctx.shadowBlur = 14 * u;
      ctx.shadowOffsetY = 3 * u;
      ctx.fillStyle = dark ? 'rgba(44,44,46,0.86)' : 'rgba(252,252,252,0.86)';
      rr(X(x), by - 23 * u, w * u, 46 * u, 23 * u); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 0.8 * u;
      rr(X(x) + 0.4 * u, by - 22.6 * u, (w - 0.8) * u, 45.2 * u, 22.6 * u); ctx.stroke();
      ctx.strokeStyle = dark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.06)';
      rr(X(x), by - 23 * u, w * u, 46 * u, 23 * u); ctx.stroke();
    };
    glass(33, 46);       // back
    glass(88, 217);      // address
    glass(314, 46);      // more

    ctx.lineWidth = 2.4 * u;
    // back chevron (disabled look)
    ctx.strokeStyle = dim;
    ctx.beginPath();
    ctx.moveTo(X(60), by - 9 * u); ctx.lineTo(X(51.5), by); ctx.lineTo(X(60), by + 9 * u);
    ctx.stroke();
    // more (•••)
    ctx.fillStyle = ink;
    for (const dx of [-7.5, 0, 7.5]) { ctx.beginPath(); ctx.arc(X(337 + dx), by, 2.1 * u, 0, Math.PI * 2); ctx.fill(); }

    // page menu icon (left of the URL)
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.8 * u;
    [[-5, 14], [0, 14], [5, 9]].forEach(([dy, len]) => {
      ctx.beginPath(); ctx.moveTo(X(104), by + dy * u); ctx.lineTo(X(104 + len), by + dy * u); ctx.stroke();
    });
    // reload icon
    const rcx = X(284), rr_ = 6.8 * u;
    ctx.beginPath(); ctx.arc(rcx, by, rr_, -Math.PI * 0.35, Math.PI * 1.45); ctx.stroke();
    const ax = rcx + rr_ * Math.cos(-Math.PI * 0.35), ay = by + rr_ * Math.sin(-Math.PI * 0.35);
    ctx.beginPath();
    ctx.moveTo(ax - 4.5 * u, ay - 2.2 * u); ctx.lineTo(ax + 0.3 * u, ay + 0.2 * u); ctx.lineTo(ax - 0.6 * u, ay + 4.8 * u);
    ctx.stroke();

    // URL text, shrunk / truncated to fit
    const maxW = 150 * u;
    let size = 16.5, text = state.uiUrl || '';
    ctx.font = `400 ${size * u}px ${UI_FONT}`;
    while (ctx.measureText(text).width > maxW && size > 13) { size -= 0.5; ctx.font = `400 ${size * u}px ${UI_FONT}`; }
    if (ctx.measureText(text).width > maxW) {
      while (text.length > 1 && ctx.measureText('…' + text).width > maxW) text = text.slice(1);
      text = '…' + text;
    }
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.fillText(text, X(196.5), by + 0.5 * u);
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
      ctx.shadowBlur = g.w * 0.165 * state.shadow;
      ctx.shadowOffsetY = g.w * 0.062 * state.shadow;
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
      const iw = s.w * (126 / 393), ih = s.w * (37 / 393);
      const ix = s.x + (s.w - iw) / 2, iy = s.y + s.w * (11 / 393);
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
  function syncFit() {
    $('gapRow').hidden = state.fit !== 'contain' && !state.safari;
    $('safariBox').hidden = !state.safari;
    $('gapColor').hidden = state.gapFill !== 'color';
  }
  $('fit').addEventListener('change', (e) => { state.fit = e.target.value; syncFit(); });
  $('gapFill').addEventListener('change', (e) => { state.gapFill = e.target.value; syncFit(); });
  $('gapColor').addEventListener('input', (e) => { state.gapColor = e.target.value; });

  function setHeight(pct) {
    pct = Math.max(50, Math.min(100, Math.round(pct)));
    state.heightPct = pct / 100;
    $('heightPct').value = pct;
    $('heightVal').textContent = pct + '%';
  }
  $('heightPct').addEventListener('input', (e) => setHeight(+e.target.value));
  $('resetHeight').addEventListener('click', () => setHeight(100));
  // Size the screen so the recording fills it exactly (plus the Safari bars).
  $('matchHeight').addEventListener('click', () => {
    const sw = state.source === 'video' ? video.videoWidth : state.screenImage && state.screenImage.naturalWidth;
    const sh = state.source === 'video' ? video.videoHeight : state.screenImage && state.screenImage.naturalHeight;
    if (!sw || !sh) return;
    const pts = 393 * (sh / sw) + (state.safari ? STATUS_H + TOOLBAR_H : 0);
    setHeight((pts / 852) * 100);
    if (pts / 852 < 0.5) setStatus('This recording is wider than the phone can get; gaps will be filled.');
  });

  $('safari').addEventListener('change', (e) => { state.safari = e.target.checked; syncFit(); });
  $('uiUrl').addEventListener('input', (e) => { state.uiUrl = e.target.value; });
  $('uiTime').addEventListener('input', (e) => { state.uiTime = e.target.value; });
  $('uiNetwork').addEventListener('change', (e) => { state.uiNetwork = e.target.value; });
  $('uiBattery').addEventListener('input', (e) => { state.uiBattery = +e.target.value; });
  $('barStyle').addEventListener('change', (e) => { state.barStyle = e.target.value; });
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
    $('matchHeight').disabled = !state.source;
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
