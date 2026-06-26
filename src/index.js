'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const winston = require('winston');

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || '/tmp';
const DB_PATH = path.join(DATA_DIR, 'pensees.db');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'pixelcalm' },
  transports: [new winston.transports.Console()],
});

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS pensees (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    texte    TEXT    NOT NULL,
    saved_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

const insertPensee = db.prepare('INSERT INTO pensees (texte) VALUES (?)');
const getPensees  = db.prepare('SELECT id, texte, saved_at FROM pensees ORDER BY id DESC LIMIT 60');
const countTotal  = db.prepare('SELECT COUNT(*) as n FROM pensees');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.on('finish', () => logger.info('request', { method: req.method, path: req.path, status: res.statusCode }));
  next();
});

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
app.get('/ready',   (_req, res) => res.json({ status: 'ready' }));

app.post('/api/pensee', (req, res) => {
  const texte = (req.body.texte || '').trim();
  if (!texte || texte.length > 280) {
    return res.status(400).json({ error: 'Texte requis (1–280 caractères)' });
  }
  insertPensee.run(texte);
  const { n } = countTotal.get();
  return res.status(201).json({ ok: true, total: n });
});

app.get('/api/pensees', (_req, res) => {
  res.json(getPensees.all());
});

app.get('/', (_req, res) => {
  const { n } = countTotal.get();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pixel Calm</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Georgia', serif;
      background: #02020a;
      min-height: 100vh;
      overflow-x: hidden;
      color: #e8e8f0;
    }

    /* ── STARFIELD ── */
    #canvas {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 0;
    }

    /* ── PAGES ── */
    .page {
      position: relative;
      z-index: 1;
      display: none;
      min-height: 100vh;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      padding: 2rem;
    }
    .page.active { display: flex; }

    /* ── ENTRY PAGE ── */
    #page-entry {
      gap: 2rem;
      text-align: center;
    }
    .tagline {
      font-size: clamp(1rem, 2.5vw, 1.3rem);
      color: #8888aa;
      letter-spacing: .08em;
      font-style: italic;
    }
    .thought-input-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.2rem;
      width: 100%;
      max-width: 520px;
    }
    textarea {
      width: 100%;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      color: #e8e8f0;
      font-family: inherit;
      font-size: 1.15rem;
      line-height: 1.6;
      padding: 1rem 1.2rem;
      resize: none;
      outline: none;
      transition: border-color .3s, box-shadow .3s;
      height: 110px;
    }
    textarea::placeholder { color: #44445a; }
    textarea:focus {
      border-color: rgba(160,120,255,0.5);
      box-shadow: 0 0 0 3px rgba(140,100,255,0.1);
    }
    .char-count { font-size: .78rem; color: #44445a; align-self: flex-end; margin-top: -0.8rem; }
    .btn-release {
      background: none;
      border: 1px solid rgba(180,140,255,0.4);
      border-radius: 30px;
      color: #c0a0ff;
      cursor: pointer;
      font-family: inherit;
      font-size: 1rem;
      letter-spacing: .12em;
      padding: .75rem 2.5rem;
      transition: background .3s, border-color .3s, color .3s, transform .15s;
    }
    .btn-release:hover {
      background: rgba(160,120,255,0.1);
      border-color: rgba(180,140,255,0.7);
      color: #d8b4fe;
    }
    .btn-release:active { transform: scale(.97); }
    .btn-release:disabled { opacity: .4; cursor: default; transform: none; }

    .nav-link {
      font-size: .85rem;
      color: #44445a;
      cursor: pointer;
      letter-spacing: .06em;
      text-decoration: none;
      transition: color .3s;
    }
    .nav-link:hover { color: #8888aa; }

    /* ── FLOAT PAGE ── */
    #page-float {
      gap: 0;
    }
    #floating-thought {
      font-size: clamp(1.6rem, 4vw, 2.8rem);
      color: rgba(230,220,255,0.92);
      text-align: center;
      max-width: 700px;
      line-height: 1.5;
      transition: none;
      pointer-events: none;
      text-shadow: 0 0 40px rgba(160,120,255,0.4);
      will-change: transform, opacity, font-size;
    }
    .breathe-hint {
      position: fixed;
      bottom: 2.5rem;
      left: 50%;
      transform: translateX(-50%);
      font-size: .8rem;
      color: #333355;
      letter-spacing: .15em;
      animation: fadePulse 4s ease-in-out infinite;
    }
    @keyframes fadePulse {
      0%, 100% { opacity: .3; }
      50%       { opacity: .7; }
    }

    /* ── JOURNAL PAGE ── */
    #page-journal {
      align-items: flex-start;
      padding: 3rem 2rem;
      max-width: 680px;
      margin: 0 auto;
    }
    .journal-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      width: 100%;
      margin-bottom: 2rem;
    }
    .journal-title {
      font-size: 1.4rem;
      color: #9090c0;
      letter-spacing: .1em;
    }
    .journal-count { font-size: .82rem; color: #44445a; }
    .journal-list {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: .85rem;
    }
    .journal-item {
      border-left: 2px solid rgba(130,100,220,0.3);
      padding: .7rem 1rem;
      background: rgba(255,255,255,0.025);
      border-radius: 0 8px 8px 0;
    }
    .journal-text {
      font-size: 1rem;
      color: #c8c8e0;
      line-height: 1.5;
    }
    .journal-time {
      font-size: .72rem;
      color: #333355;
      margin-top: .35rem;
    }
    .empty-journal {
      color: #333355;
      font-style: italic;
      font-size: .9rem;
    }

    /* ── LOGO / TITLE ── */
    .logo {
      font-size: clamp(2rem, 5vw, 3rem);
      font-weight: 300;
      letter-spacing: .35em;
      color: rgba(200,185,255,0.7);
      text-shadow: 0 0 60px rgba(160,120,255,0.25);
      margin-bottom: .2rem;
    }
    .logo span { color: rgba(160,120,255,0.9); }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>

  <!-- ── ENTRY ── -->
  <section id="page-entry" class="page active">
    <p class="logo">pixel<span>calm</span></p>
    <p class="tagline">Écris ta pensée. Regarde-la partir.</p>
    <div class="thought-input-wrap">
      <textarea id="thought-input" placeholder="Qu'est-ce qui occupe ton esprit en ce moment ?" maxlength="280"></textarea>
      <p class="char-count"><span id="char-count">0</span> / 280</p>
      <button class="btn-release" id="btn-release">Lâcher prise →</button>
    </div>
    <a class="nav-link" id="link-journal">✦ ${n} pensées libérées</a>
  </section>

  <!-- ── FLOAT ── -->
  <section id="page-float" class="page">
    <div id="floating-thought"></div>
    <p class="breathe-hint">respire</p>
  </section>

  <!-- ── JOURNAL ── -->
  <section id="page-journal" class="page">
    <div class="journal-header">
      <span class="journal-title">Journal</span>
      <a class="nav-link" id="link-back">← retour</a>
    </div>
    <div class="journal-list" id="journal-list">
      <p class="empty-journal">Chargement…</p>
    </div>
  </section>

<script>
// ── Starfield ──
(function () {
  const canvas = document.getElementById('canvas');
  const ctx    = canvas.getContext('2d');
  let W, H, stars;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function makeStars(n) {
    stars = Array.from({ length: n }, () => ({
      x:     Math.random() * W,
      y:     Math.random() * H,
      r:     Math.random() * 1.2 + 0.2,
      alpha: Math.random() * 0.6 + 0.1,
      speed: Math.random() * 0.0003 + 0.0001,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    for (const s of stars) {
      const a = s.alpha * (0.6 + 0.4 * Math.sin(s.speed * t + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = \`rgba(200,190,255,\${a})\`;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); makeStars(220); });
  resize();
  makeStars(220);
  requestAnimationFrame(draw);
})();

// ── Audio ──
let audioCtx = null;
let ambientStarted = false;

function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function startAmbient() {
  if (ambientStarted) return;
  ambientStarted = true;
  const ctx = initAudio();

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 6);
  master.connect(ctx.destination);

  function makeNoise() {
    const buf  = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop   = true;
    src.start();
    return src;
  }

  // Pluie douce : bruit filtré autour de 2–5 kHz
  const rain       = makeNoise();
  const rainBP     = ctx.createBiquadFilter();
  rainBP.type      = 'bandpass';
  rainBP.frequency.value = 3200;
  rainBP.Q.value   = 0.6;
  const rainGain   = ctx.createGain();
  rainGain.gain.value = 0.45;
  rain.connect(rainBP);
  rainBP.connect(rainGain);
  rainGain.connect(master);

  // Pluie fine (haute fréquence)
  const rain2      = makeNoise();
  const rainHP     = ctx.createBiquadFilter();
  rainHP.type      = 'highpass';
  rainHP.frequency.value = 7000;
  const rainGain2  = ctx.createGain();
  rainGain2.gain.value = 0.12;
  rain2.connect(rainHP);
  rainHP.connect(rainGain2);
  rainGain2.connect(master);

  // Vent doux : bruit grave avec LFO lent
  const wind       = makeNoise();
  const windLP     = ctx.createBiquadFilter();
  windLP.type      = 'lowpass';
  windLP.frequency.value = 280;
  const windGain   = ctx.createGain();
  windGain.gain.value = 0.35;
  const windLFO    = ctx.createOscillator();
  const windLFOAmp = ctx.createGain();
  windLFO.frequency.value  = 0.07;
  windLFOAmp.gain.value    = 0.18;
  windLFO.connect(windLFOAmp);
  windLFOAmp.connect(windGain.gain);
  windLFO.start();
  wind.connect(windLP);
  windLP.connect(windGain);
  windGain.connect(master);
}

function playReleaseSound() {
  const ctx = initAudio();
  const t   = ctx.currentTime;

  // Delay (pseudo-reverb)
  const delay    = ctx.createDelay(1.0);
  const fbGain   = ctx.createGain();
  const wetGain  = ctx.createGain();
  delay.delayTime.value = 0.28;
  fbGain.gain.value     = 0.35;
  wetGain.gain.value    = 0.28;
  delay.connect(fbGain);
  fbGain.connect(delay);
  delay.connect(wetGain);
  wetGain.connect(ctx.destination);

  function tone(freq, type, startT, duration, peakVol) {
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, startT);
    g.gain.linearRampToValueAtTime(peakVol, startT + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, startT + duration);
    osc.connect(g);
    g.connect(ctx.destination);
    g.connect(delay);
    osc.start(startT);
    osc.stop(startT + duration + 0.1);
  }

  // Whoosh montant
  const whoosh = ctx.createOscillator();
  const wGain  = ctx.createBiquadFilter();
  const wVol   = ctx.createGain();
  whoosh.type = 'sine';
  whoosh.frequency.setValueAtTime(180, t);
  whoosh.frequency.exponentialRampToValueAtTime(1400, t + 2.8);
  wGain.type = 'bandpass';
  wGain.frequency.value = 500;
  wGain.Q.value = 1.5;
  wVol.gain.setValueAtTime(0, t);
  wVol.gain.linearRampToValueAtTime(0.14, t + 0.15);
  wVol.gain.exponentialRampToValueAtTime(0.001, t + 3.2);
  whoosh.connect(wGain);
  wGain.connect(wVol);
  wVol.connect(ctx.destination);
  wVol.connect(delay);
  whoosh.start(t);
  whoosh.stop(t + 3.5);

  // Carillon A mineur : A4 C5 E5
  tone(440,   'sine',     t,        2.5, 0.10);
  tone(523.25,'sine',     t + 0.18, 2.2, 0.07);
  tone(659.25,'triangle', t + 0.32, 1.8, 0.05);
}

// ── Pages ──
function show(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Entry ──
const textarea  = document.getElementById('thought-input');
const charCount = document.getElementById('char-count');
const btnRelease = document.getElementById('btn-release');
const linkJournal = document.getElementById('link-journal');

textarea.addEventListener('input', () => {
  charCount.textContent = textarea.value.length;
});

btnRelease.addEventListener('click', async () => {
  const texte = textarea.value.trim();
  if (!texte) { textarea.focus(); return; }

  btnRelease.disabled = true;
  startAmbient();
  playReleaseSound();

  // Show float page
  show('page-float');
  startFloat(texte);

  // Save in background
  try {
    const res = await fetch('/api/pensee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texte }),
    });
    if (res.ok) {
      const data = await res.json();
      const link = document.getElementById('link-journal');
      if (link) link.textContent = \`✦ \${data.total} pensées libérées\`;
    }
  } catch (_) {}

  textarea.value = '';
  charCount.textContent = '0';
  btnRelease.disabled = false;
});

linkJournal.addEventListener('click', () => {
  loadJournal();
  show('page-journal');
});

// ── Float animation ──
function startFloat(texte) {
  const el = document.getElementById('floating-thought');
  el.textContent = texte;

  // Reset
  el.style.transition   = 'none';
  el.style.opacity      = '1';
  el.style.transform    = 'translateY(0) scale(1)';
  el.style.filter       = 'blur(0px)';

  const totalMs = 6000;
  const start   = performance.now();

  function tick(now) {
    const t = Math.min((now - start) / totalMs, 1); // 0 → 1

    // ease-out cubic
    const e = 1 - Math.pow(1 - t, 3);

    const scale   = 1 - e * 0.94;         // 1 → 0.06
    const opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    const ty      = -e * window.innerHeight * 0.35;
    const blur    = e * 6;

    el.style.transform = \`translateY(\${ty}px) scale(\${scale})\`;
    el.style.opacity   = opacity;
    el.style.filter    = \`blur(\${blur}px)\`;

    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      // Return to entry after a brief pause
      setTimeout(() => show('page-entry'), 600);
    }
  }

  requestAnimationFrame(tick);
}

// ── Journal ──
document.getElementById('link-back').addEventListener('click', () => show('page-entry'));

async function loadJournal() {
  const list = document.getElementById('journal-list');
  list.innerHTML = '<p class="empty-journal">Chargement…</p>';
  try {
    const res  = await fetch('/api/pensees');
    const data = await res.json();
    if (!data.length) {
      list.innerHTML = '<p class="empty-journal">Aucune pensée libérée pour l&#39;instant.</p>';
      return;
    }
    list.innerHTML = data.map(p => \`
      <div class="journal-item">
        <div class="journal-text">\${escHtml(p.texte)}</div>
        <div class="journal-time">\${fmtDate(p.saved_at)}</div>
      </div>
    \`).join('');
  } catch (_) {
    list.innerHTML = '<p class="empty-journal">Impossible de charger le journal.</p>';
  }
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmtDate(s) {
  try { return new Date(s + 'Z').toLocaleString('fr-FR'); } catch (_) { return s; }
}

// ── Ambient démarre dès la première interaction (politique autoplay) ──
['pointerdown', 'keydown'].forEach(evt =>
  document.addEventListener(evt, () => startAmbient(), { once: true })
);
</script>
</body>
</html>`);
});

module.exports = app;

if (require.main === module) {
  const server = app.listen(PORT, () => logger.info('server started', { port: PORT }));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
