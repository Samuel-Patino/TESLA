/* =====================================================================
   WAZE · VELOX Drive
   Navegación giro a giro + alertas de cámaras de velocidad para el
   navegador del Tesla Model Y (Juniper).

   Fuentes de datos (gratuitas, sin API key):
   - Mapa base:       CARTO (OpenStreetMap)
   - Radares / límite: Overpass API (OpenStreetMap)
   - Búsqueda:        Photon (komoot) con respaldo en Nominatim
   - Rutas:           OSRM
   - Capa "Waze Live": iframe oficial embed.waze.com
   ===================================================================== */
(() => {
'use strict';

const $ = id => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

if (!window.L) {
  $('startMsg').textContent = 'No se pudo cargar el mapa. Revisa la conexión a internet y recarga.';
  return;
}

/* ---------------------------------------------------------------------
   Preferencias y almacenamiento local
   --------------------------------------------------------------------- */
const PREFS_KEY = 'velox_waze_prefs_v1';
const REPORTS_KEY = 'velox_waze_reports_v1';
const CAMCACHE_KEY = 'velox_waze_camcache_v1';
const RECENT_KEY = 'velox_waze_recent_v1';
const DEFAULT_CENTER = { lat: 6.2442, lon: -75.5812 }; // Medellín

const loadJSON = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* cuota llena */ } };

const savedPrefs = loadJSON(PREFS_KEY, {});
if (savedPrefs.tolerance === 5 || savedPrefs.tolerance == null) {
  savedPrefs.tolerance = 0;
}
const prefs = Object.assign({
  voice: true, sound: true, vol: 0.8,
  soundMode: 'all', // 'all' (normal), 'alerts' (solo alertas), 'mute' (desactivado)
  alertDist: 800, tolerance: 0,
  mapStyle: 'dark', autoZoom: true, roadLimit: true,
  unit: 'kmh', showCams: true, lastPos: null
}, savedPrefs);
const savePrefs = () => saveJSON(PREFS_KEY, prefs);

/* ---------------------------------------------------------------------
   Iconos y tipos de alerta
   --------------------------------------------------------------------- */
const ICONS = {
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="15" height="10" rx="2"/><path d="M17 10.5l5-2.5v8l-5-2.5"/><circle cx="9.5" cy="12" r="2.6"/></svg>',
  redlight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="7" y="2" width="10" height="20" rx="3"/><circle cx="12" cy="7" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="17" r="1.9"/></svg>',
  police: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M12 7.5l1.3 2.7 3 .4-2.2 2 .6 2.9L12 14l-2.7 1.5.6-2.9-2.2-2 3-.4z" fill="currentColor" stroke="none"/></svg>',
  hazard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L2 21h20z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".8" fill="currentColor"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
};

const TYPE = {
  speed:    { label: 'Radar de velocidad', icon: 'camera',   color: '#ff9f1c', fg: '#1a1000', voice: 'Radar de velocidad' },
  redlight: { label: 'Cámara de semáforo', icon: 'redlight', color: '#ff3b5c', fg: '#ffffff', voice: 'Cámara de semáforo' },
  police:   { label: 'Policía reportada',  icon: 'police',   color: '#3d7bff', fg: '#ffffff', voice: 'Policía reportada', ttl: 2 * 3600e3 },
  hazard:   { label: 'Peligro en la vía',  icon: 'hazard',   color: '#ffd23f', fg: '#2a2000', voice: 'Peligro en la vía', ttl: 3600e3 }
};
document.querySelectorAll('.rp').forEach(b => {
  const T = TYPE[b.dataset.type];
  b.querySelector('.rp-ico').innerHTML = ICONS[T.icon];
});

/* ---------------------------------------------------------------------
   Geometría
   --------------------------------------------------------------------- */
const R_E = 6371000, toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
function dist(a, b) {
  const dLa = toRad(b.lat - a.lat), dLo = toRad(b.lon - a.lon);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R_E * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a, b) {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function angDiff(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
function destPoint(p, brg, d) {
  const dl = d / R_E, th = toRad(brg), p1 = toRad(p.lat), l1 = toRad(p.lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(dl) + Math.cos(p1) * Math.sin(dl) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(dl) * Math.cos(p1), Math.cos(dl) - Math.sin(p1) * Math.sin(p2));
  return { lat: toDeg(p2), lon: toDeg(l2) };
}
/* Distancia de p al segmento a-b (m) y parámetro t∈[0,1] */
function segDist(p, a, b) {
  const kx = Math.cos(toRad(p.lat)) * 111320, ky = 110540;
  const ax = (a.lon - p.lon) * kx, ay = (a.lat - p.lat) * ky;
  const bx = (b.lon - p.lon) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 ? clamp(-(ax * dx + ay * dy) / L2, 0, 1) : 0;
  return { d: Math.hypot(ax + t * dx, ay + t * dy), t };
}

/* ---------------------------------------------------------------------
   Formato de unidades
   --------------------------------------------------------------------- */
const isMph = () => prefs.unit === 'mph';
function fmtDist(m) {
  if (isMph()) {
    if (m < 160) return Math.round(m * 3.28084 / 10) * 10 + ' ft';
    return (m / 1609.34).toFixed(1) + ' mi';
  }
  if (m < 1000) return Math.max(0, Math.round(m / 10) * 10) + ' m';
  return (m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',') + ' km';
}
function spokenDist(m) {
  if (m < 1000) {
    const r = m > 200 ? Math.round(m / 50) * 50 : Math.round(m / 10) * 10;
    return r + ' metros';
  }
  const k = Math.round(m / 100) / 10;
  return (k === 1 ? '1 kilómetro' : String(k).replace('.', ',') + ' kilómetros');
}
function fmtDur(s) {
  const m = Math.max(1, Math.round(s / 60));
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}
function fmtClock(d) {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

/* ---------------------------------------------------------------------
   Red
   --------------------------------------------------------------------- */
async function fetchJSON(url, timeout = 10000, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];
async function overpass(q, timeout = 30000) {
  let last;
  for (const u of OVERPASS) {
    try {
      return await fetchJSON(u, timeout, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
    } catch (e) { last = e; }
  }
  throw last || new Error('Overpass no disponible');
}

/* ---------------------------------------------------------------------
   Audio: pitidos sintetizados (WebAudio) y voz (TTS nativo / Google TTS)
   --------------------------------------------------------------------- */
let ac = null;
function getAudioContext() {
  if (!ac) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) ac = new AudioCtx();
    } catch (e) { ac = null; }
  }
  if (ac && ac.state === 'suspended') {
    ac.resume().catch(() => {});
  }
  return ac;
}
function initAudio() {
  getAudioContext();
}

function beep(freqs = [880], dur = 0.13, gap = 0.07, type = 'sine') {
  if (prefs.soundMode === 'mute' || !prefs.sound) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  let t = ctx.currentTime + 0.02;
  const v = clamp(prefs.vol, 0.1, 1);
  for (const f of freqs) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v * 0.75), t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.03);
    t += dur + gap;
  }
}

// Chimes especializados estilo Waze
function playCameraChime(stage) {
  if (prefs.soundMode === 'mute' || !prefs.sound) return;
  if (stage === 500) {
    // Chime suave doble a 500m
    beep([784, 1046], 0.13, 0.05, 'triangle');
  } else {
    // Chime triple de atención inmediata a 100m
    beep([1046, 1318, 1568], 0.11, 0.04, 'sine');
  }
}

let esVoice = null;
const hasTTS = 'speechSynthesis' in window;
function pickVoice() {
  if (!hasTTS) return;
  try {
    const vs = speechSynthesis.getVoices();
    if (!vs || !vs.length) return;
    const es = vs.filter(v => /^es/i.test(v.lang));
    if (!es.length) { esVoice = vs[0]; return; }

    const femRegex = /(female|mujer|monica|mónica|paulina|sabina|laura|helena|dalia|paloma|sofia|sofía|lucia|lucía|elvira|victoria|soledad|marta|francisca|rosa|jimena|carmen|google.*español|natural|neural)/i;
    const maleRegex = /(male|hombre|raul|raúl|pablo|jorge|david|carlos|diego|miguel|manuel|alvaro|álvaro)/i;
    let best = es.find(v => femRegex.test(v.name));
    if (!best) best = es.find(v => /^es[-_](CO|419|MX)/i.test(v.lang) && !maleRegex.test(v.name));
    if (!best) best = es.find(v => !maleRegex.test(v.name));
    esVoice = best || es[0];
  } catch (e) {}
}
if (hasTTS) {
  pickVoice();
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = pickVoice;
  }
}

// Clips de voz femenina en español latino (grabados en local para 0ms de latencia en Tesla Model Y)
const VOICE_CLIPS = {
  welcome: 'audio/welcome.wav',
  cam_500: 'audio/cam_500.wav',
  cam_100: 'audio/cam_100.wav',
  redlight: 'audio/redlight.wav',
  police: 'audio/police.wav',
  hazard: 'audio/hazard.wav',
  overspeed: 'audio/overspeed.wav',
  turn_right: 'audio/turn_right.wav',
  turn_left: 'audio/turn_left.wav',
  turn_slight_right: 'audio/turn_slight_right.wav',
  turn_slight_left: 'audio/turn_slight_left.wav',
  turn_sharp_right: 'audio/turn_sharp_right.wav',
  turn_sharp_left: 'audio/turn_sharp_left.wav',
  uturn: 'audio/uturn.wav',
  roundabout: 'audio/roundabout.wav',
  straight: 'audio/straight.wav',
  rerouting: 'audio/rerouting.wav',
  route_changed: 'audio/route_changed.wav',
  arrived: 'audio/arrived.wav',
  nav_stopped: 'audio/nav_stopped.wav'
};

let voiceAudio = null;
function playVoiceAudio(clipKey) {
  if (prefs.soundMode === 'mute' || !prefs.voice) return false;
  const path = VOICE_CLIPS[clipKey];
  if (!path) return false;
  try {
    if (!voiceAudio) voiceAudio = new Audio();
    voiceAudio.pause();
    voiceAudio.currentTime = 0;
    voiceAudio.src = path;
    voiceAudio.volume = clamp(prefs.vol, 0.2, 1);
    const p = voiceAudio.play();
    if (p && p.catch) p.catch(() => {});
    return true;
  } catch (e) {
    return false;
  }
}

function speak(text, priority = false, isManeuver = false, clipKey = null) {
  if (!text && !clipKey) return;
  // Modos de sonido:
  // 'mute' -> silencio total
  // 'alerts' -> SOLO avisos de cámaras de velocidad a 500m; silencia giros, saludos, llegadas y avisos secundarios
  // 'all' -> todo (giros + avisos + radares)
  if (prefs.soundMode === 'mute' || !prefs.voice) return;
  if (prefs.soundMode === 'alerts') {
    if (isManeuver) return;
    if (clipKey && clipKey !== 'cam_500' && clipKey !== 'overspeed') return;
  }

  // 1. Prioridad: reproducir clip local offline de mujer en español si está disponible
  let matchedKey = clipKey;
  if (!matchedKey && text) {
    const t = text.toLowerCase();
    if (t.includes('quinientos') || t.includes('500') || (t.includes('cámara de velocidad') && t.includes('más adelante'))) matchedKey = 'cam_500';
    else if (t.includes('cien') || t.includes('100') || (t.includes('cámara de velocidad') && t.includes('adelante'))) matchedKey = 'cam_100';
    else if (t.includes('semáforo') || t.includes('semaforo')) matchedKey = 'redlight';
    else if (t.includes('policía') || t.includes('policia')) matchedKey = 'police';
    else if (t.includes('peligro')) matchedKey = 'hazard';
    else if (t.includes('reduce') || t.includes('exceso')) matchedKey = 'overspeed';
    else if (t.includes('bienvenido')) matchedKey = 'welcome';
    else if (t.includes('recalculando')) matchedKey = 'rerouting';
    else if (t.includes('ruta cambiada') || t.includes('alternativa')) matchedKey = 'route_changed';
    else if (t.includes('llegado')) matchedKey = 'arrived';
    else if (t.includes('finalizada')) matchedKey = 'nav_stopped';
    else if (t.includes('derecha')) matchedKey = t.includes('pronunciado') ? 'turn_sharp_right' : t.includes('leve') ? 'turn_slight_right' : 'turn_right';
    else if (t.includes('izquierda')) matchedKey = t.includes('pronunciado') ? 'turn_sharp_left' : t.includes('leve') ? 'turn_slight_left' : 'turn_left';
    else if (t.includes('rotonda') || t.includes('glorieta')) matchedKey = 'roundabout';
    else if (t.includes('giro en u')) matchedKey = 'uturn';
    else if (t.includes('recto') || t.includes('continúa')) matchedKey = 'straight';
  }

  // En modo 'alerts', verificar nuevamente si la frase encontrada coincide únicamente con cam_500 o overspeed
  if (prefs.soundMode === 'alerts' && matchedKey !== 'cam_500' && matchedKey !== 'overspeed') {
    return;
  }

  if (matchedKey && playVoiceAudio(matchedKey)) {
    return;
  }

  // 2. Respaldo: si el dispositivo cuenta con voces nativas instaladas (PC / Mac / Android)
  if (hasTTS && esVoice && text) {
    try {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      if (priority) window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = esVoice.lang;
      u.voice = esVoice;
      u.volume = clamp(prefs.vol, 0.2, 1);
      u.rate = 1.0;
      u.pitch = 1.05;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }
}

// Iconos y gestión del selector de sonido (Normal / Solo alertas / Desactivado)
const SOUND_ICONS = {
  all: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  alerts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/><line x1="18" y1="8" x2="18" y2="13"/><circle cx="18" cy="16.5" r="1" fill="currentColor"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/><line x1="23" y1="1" x2="1" y2="23"/><line x1="17" y1="9" x2="22" y2="14"/><line x1="22" y1="9" x2="17" y2="14"/></svg>'
};

function updateSoundUI() {
  const mode = prefs.soundMode || 'all';
  const btn = $('soundBtn');
  const ico = $('soundIco');
  if (btn && ico) {
    btn.className = `rbtn sound-btn mode-${mode}`;
    ico.innerHTML = SOUND_ICONS[mode] || SOUND_ICONS.all;
    btn.title = mode === 'all' ? 'Sonido: Normal (giros y alertas)' : mode === 'alerts' ? 'Sonido: Solo alertas de radares' : 'Sonido: Desactivado';
  }
  const seg = $('segSoundMode');
  if (seg) {
    seg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', b.dataset.v === mode);
    });
  }
}

function cycleSoundMode() {
  getAudioContext();
  const cur = prefs.soundMode || 'all';
  const next = cur === 'all' ? 'alerts' : cur === 'alerts' ? 'mute' : 'all';
  prefs.soundMode = next;
  savePrefs();
  updateSoundUI();
  if (next === 'all') {
    toast('Sonido: Normal (voz y alertas activadas)');
    beep([880, 1175], 0.1, 0.05);
  } else if (next === 'alerts') {
    toast('Sonido: Solo alertas de radares y peligros');
    beep([880], 0.12);
  } else {
    toast('Sonido: Desactivado (silencio total)');
  }
}

// Desbloqueo universal de audio/voz al interactuar en Tesla
const unlockAudio = () => {
  getAudioContext();
  if (window.speechSynthesis && window.speechSynthesis.paused) {
    try { window.speechSynthesis.resume(); } catch (e) {}
  }
  try {
    const silent = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
    silent.play().catch(() => {});
  } catch (e) {}
};
['pointerdown', 'touchstart', 'click', 'keydown'].forEach(ev => {
  window.addEventListener(ev, unlockAudio, { passive: true });
});

/* ---------------------------------------------------------------------
   Toast
   --------------------------------------------------------------------- */
let toastT = 0;
function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  t.style.animation = 'none'; void t.offsetHeight; t.style.animation = '';
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------------------------------------------------------------------
   Mapa (100% libre, sin API key ni marcas de agua)
   --------------------------------------------------------------------- */
const startCenter = prefs.lastPos || DEFAULT_CENTER;
const map = L.map('map', { zoomControl: false, zoomSnap: 0.25, attributionControl: true })
  .setView([startCenter.lat, startCenter.lon], 15);
map.attributionControl.setPrefix(false);

let currentTileLayer = null;

function applyMapStyle() {
  if (currentTileLayer) map.removeLayer(currentTileLayer);
  const mapEl = $('map');
  const style = prefs.mapStyle || 'dark';

  const tileOpts = {
    maxNativeZoom: 19,
    maxZoom: 20,
    keepBuffer: 16,
    updateWhenZooming: true,
    subdomains: ['a', 'b', 'c'],
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  };

  if (style === 'sat') {
    currentTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', Object.assign({}, tileOpts, { maxNativeZoom: 18, attribution: '© Esri, Maxar' })).addTo(map);
    mapEl.classList.remove('dark-tiles');
    document.body.classList.remove('light');
  } else if (style === 'osm' || style === 'light') {
    currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', tileOpts).addTo(map);
    mapEl.classList.remove('dark-tiles');
    document.body.classList.add('light');
  } else {
    // dark (predeterminado para Tesla Model Y): OpenStreetMap con filtro OLED Waze
    currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', tileOpts).addTo(map);
    mapEl.classList.add('dark-tiles');
    document.body.classList.remove('light');
  }
}

applyMapStyle();

const routeLayer = L.layerGroup().addTo(map);
const camLayer = L.layerGroup().addTo(map);

/* ---------------------------------------------------------------------
   Tráfico en Vivo y Rutas en Tiempo Real (TomTom API)
   --------------------------------------------------------------------- */
const TOMTOM_KEY = 'K56f5YDun1bGXPwi2hDFenx8gKcJAD8M';
let trafficTileLayer = null;
let showLiveTraffic = true;
const incidentLayer = L.layerGroup().addTo(map);

function updateTrafficLayer() {
  if (showLiveTraffic) {
    if (!trafficTileLayer) {
      trafficTileLayer = L.tileLayer(
        `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${TOMTOM_KEY}`,
        {
          maxNativeZoom: 18,
          maxZoom: 20,
          opacity: 0.88,
          zIndex: 12,
          attribution: 'Tráfico © TomTom'
        }
      );
    }
    if (!map.hasLayer(trafficTileLayer)) trafficTileLayer.addTo(map);
    if (!map.hasLayer(incidentLayer)) incidentLayer.addTo(map);
    loadLiveTrafficIncidents();
  } else {
    if (trafficTileLayer && map.hasLayer(trafficTileLayer)) map.removeLayer(trafficTileLayer);
    if (incidentLayer && map.hasLayer(incidentLayer)) incidentLayer.clearLayers();
  }
}

async function loadLiveTrafficIncidents() {
  if (!showLiveTraffic) return;
  const c = pos || centerPos();
  const dLat = 0.12, dLon = 0.12;
  const minLat = c.lat - dLat, maxLat = c.lat + dLat;
  const minLon = c.lon - dLon, maxLon = c.lon + dLon;
  const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${TOMTOM_KEY}&bbox=${minLon.toFixed(4)},${minLat.toFixed(4)},${maxLon.toFixed(4)},${maxLat.toFixed(4)}&fields={incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description,code}}}}&language=es-ES`;

  try {
    const data = await fetchJSON(url, 9000);
    if (!data || !data.incidents) return;
    incidentLayer.clearLayers();

    let count = 0;
    for (const inc of data.incidents) {
      if (++count > 60) break;
      const geom = inc.geometry;
      if (!geom || !geom.coordinates) continue;
      let pt = null;
      if (geom.type === 'Point') {
        pt = [geom.coordinates[1], geom.coordinates[0]];
      } else if (geom.type === 'LineString' && geom.coordinates.length) {
        const midIdx = Math.floor(geom.coordinates.length / 2);
        pt = [geom.coordinates[midIdx][1], geom.coordinates[midIdx][0]];
      }
      if (!pt) continue;

      const cat = inc.properties.iconCategory;
      const desc = (inc.properties.events && inc.properties.events[0] && inc.properties.events[0].description) || 'Incidente vial';

      let iconHtml = '⚠️';
      let badgeClass = 'inc-warn';
      if (cat === 8) { iconHtml = '⛔'; badgeClass = 'inc-closed'; }
      else if (cat === 9) { iconHtml = '🚧'; badgeClass = 'inc-works'; }
      else if (cat === 6) { iconHtml = '🚗'; badgeClass = 'inc-jam'; }
      else if (cat === 1) { iconHtml = '💥'; badgeClass = 'inc-accident'; }

      const icon = L.divIcon({
        className: '',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        html: `<div class="traffic-inc-mk ${badgeClass}" title="${esc(desc)}">${iconHtml}</div>`
      });

      L.marker(pt, { icon, keyboard: false })
        .bindPopup(`<b>${esc(desc)}</b><br><small>Reporte de tráfico en tiempo real</small>`)
        .addTo(incidentLayer);
    }
  } catch (e) {
    console.warn('Error cargando incidentes de tráfico:', e);
  }
}

updateTrafficLayer();
setInterval(() => {
  if (showLiveTraffic) loadLiveTrafficIncidents();
}, 180000);


/* Marcador del vehículo */
const meIcon = L.divIcon({
  className: '', iconSize: [54, 54], iconAnchor: [27, 27],
  html: '<div class="me-wrap"><div class="me-acc"></div><div class="me-arrow"><svg viewBox="0 0 48 48"><path d="M24 5 L39 41 L24 33 L9 41 Z" fill="#33ccff" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/><circle cx="24" cy="27" r="3" fill="#ffffff"/></svg></div></div>'
});
let meMarker = null, arrowRot = 0;
function updateMe() {
  if (!pos) return;
  const ll = [pos.lat, pos.lon];
  if (!meMarker) meMarker = L.marker(ll, { icon: meIcon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
  else meMarker.setLatLng(ll);

  const el = meMarker.getElement();
  const arrow = el && el.querySelector('.me-arrow');
  if (arrow) {
    let h = pos.heading;
    if ((h == null || isNaN(h)) && nav && nav.coords && nav.coords.length >= 2) {
      const seg = (nav.seg != null && nav.seg < nav.coords.length - 1) ? nav.seg : 0;
      h = bearing(nav.coords[seg], nav.coords[seg + 1]);
    }
    if (h == null || isNaN(h)) h = 0;

    const d = ((h - arrowRot) % 360 + 540) % 360 - 180;
    arrowRot += d;
    arrow.style.transform = `rotate(${arrowRot}deg)`;
  }
}

/* Seguimiento de cámara y navegación 3D */
let follow = true, manualZoomUntil = 0, courseUp = true;
function setFollow(v) {
  follow = v;
  $('recenter').hidden = v || !pos;
  if (v) followNow(true);
}

function followNow(animate) {
  if (!pos || !follow) return;
  const isNav = (nav && nav.active) || sim.on;
  let z = map.getZoom();

  // Zoom dinámico según la cercanía a un giro o maniobra
  let dTo = 999;
  if (nav && nav.steps && nav.steps.length) {
    for (let i = 1; i < nav.steps.length; i++) {
      if (nav.steps[i].along > nav.along + 3) {
        dTo = nav.steps[i].along - nav.along;
        break;
      }
    }
  }

  let tz = 16.5, pitch = 58;
  if (isNav) {
    // Ángulo automotriz 3D bien acostado tipo Waze real
    if (dTo < 90) {
      tz = 18.0;
      pitch = 48;
    } else if (dTo < 250) {
      tz = 17.25;
      pitch = 54;
    } else if (dTo < 600) {
      tz = 16.5;
      pitch = 58;
    } else {
      tz = (pos.speed > 80 ? 15.8 : 16.25);
      pitch = 60;
    }
  } else if (prefs.autoZoom && Date.now() > manualZoomUntil) {
    const s = pos.speed;
    tz = s < 25 ? 17 : s < 60 ? 16.25 : s < 95 ? 15.5 : 15;
    pitch = (courseUp && s > 15) ? 45 : 0;
  }

  if (Date.now() > manualZoomUntil && Math.abs(tz - z) >= 0.25) {
    z = tz;
  }

  let hdg = (pos.heading != null && !isNaN(pos.heading)) ? pos.heading : null;
  if ((hdg == null || isNaN(hdg)) && nav && nav.coords && nav.coords.length >= 2) {
    const seg = (nav.seg != null && nav.seg < nav.coords.length - 1) ? nav.seg : 0;
    hdg = bearing(nav.coords[seg], nav.coords[seg + 1]);
  }
  if (hdg == null || isNaN(hdg)) hdg = 0;
  const mapEl = $('map');

  if (courseUp && isNav) {
    // Ángulo acostado (3D) + orientación al rumbo del carro (funciona en GPS y simulación)
    mapEl.style.transform = `rotateX(${pitch}deg) rotateZ(${-hdg}deg)`;
    document.documentElement.style.setProperty('--map-counter-rot', `${hdg}deg`);
    const dial = $('compassDial');
    if (dial) dial.style.transform = `rotate(${hdg}deg)`;
  } else {
    mapEl.style.transform = 'rotateX(0deg) rotateZ(0deg)';
    document.documentElement.style.setProperty('--map-counter-rot', '0deg');
    const dial = $('compassDial');
    if (dial) dial.style.transform = 'rotate(0deg)';
  }

  map.setView([pos.lat, pos.lon], z, { animate: !!animate, duration: 0.3 });
}
map.on('dragstart', () => {
  if (follow) setFollow(false);
  // Al arrastrar con el dedo, aplanar inmediatamente a vista cenital 2D (Norte arriba)
  // para que el arrastre con el dedo sea 100% natural y no se sienta invertido
  $('map').style.transform = 'rotateX(0deg) rotateZ(0deg)';
  document.documentElement.style.setProperty('--map-counter-rot', '0deg');
  if ($('compassDial')) $('compassDial').style.transform = 'rotate(0deg)';
});
map.on('click', hideResults);
map.on('moveend', () => {
  renderCams();
  if (map.getZoom() >= 11) ensureCamerasAround(centerPos());
});
const centerPos = () => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; };

/* ---------------------------------------------------------------------
   GPS
   --------------------------------------------------------------------- */
let pos = null, prevFix = null, lastFixT = 0, gpsErr = null, started = false;
function startGPS() {
  if (!navigator.geolocation) { gpsErr = 'Navegador sin geolocalización'; updateStatus(); return; }
  navigator.geolocation.watchPosition(onFix, onGpsErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}
function onFix(p) {
  if (sim.on) return;
  gpsErr = null;
  const c = p.coords;
  if (c.accuracy > 150 && pos) return;
  handlePosition(c.latitude, c.longitude, c.speed, c.heading, c.accuracy, p.timestamp || Date.now());
}
function onGpsErr(e) {
  gpsErr = e.code === 1 ? 'Permiso de GPS denegado' : 'Buscando señal GPS…';
  updateStatus();
  if (e.code === 1) toast('Permite la ubicación en el navegador, o usa la simulación en Ajustes.', 5000);
}
function handlePosition(lat, lon, spdMs, hdg, acc, t) {
  let kmh = (spdMs != null && !isNaN(spdMs)) ? spdMs * 3.6 : null;
  const here = { lat, lon };
  if (prevFix) {
    const d = dist(prevFix, here), dt = (t - prevFix.t) / 1000;
    if (kmh == null && dt > 0.3) kmh = d / dt * 3.6;
    if ((hdg == null || isNaN(hdg)) && d > 4) hdg = bearing(prevFix, here);
  }
  if (hdg == null || isNaN(hdg)) hdg = pos ? pos.heading : null;
  if (kmh == null || kmh < 2) kmh = 0;
  prevFix = { lat, lon, t };
  pos = { lat, lon, speed: kmh, heading: hdg, acc, t };
  onPositionUpdate();
}
function onPositionUpdate() {
  lastFixT = Date.now();
  updateMe();
  if (follow) followNow(true); else $('recenter').hidden = false;
  ensureCamerasAround(pos);
  maybeRoadLimit();
  if (nav && nav.active) navUpdate();
  checkAlerts();
  updateStatus();
  if (!sim.on && (!prefs.lastPos || dist(prefs.lastPos, pos) > 500)) {
    prefs.lastPos = { lat: pos.lat, lon: pos.lon }; savePrefs();
  }
}

/* ---------------------------------------------------------------------
   Radares: OpenStreetMap (Overpass) + reportes propios
   --------------------------------------------------------------------- */
const osmCams = new Map();
let reports = loadJSON(REPORTS_KEY, []);
let demoCams = [];
const isAlive = r => { const T = TYPE[r.type]; return T && (!T.ttl || Date.now() - r.t < T.ttl); };
reports = reports.filter(isAlive);
function allCams() {
  const out = [...osmCams.values(), ...demoCams];
  for (const r of reports) if (isAlive(r)) out.push(r);
  return out;
}

function parseMaxspeed(v) {
  if (!v) return null;
  const m = /^(\d+)\s*(mph)?/i.exec(String(v).trim());
  if (!m) return null;
  let n = +m[1];
  if (m[2]) n = Math.round(n * 1.609);
  return n > 0 && n < 200 ? n : null;
}

const TILE = 0.25, CACHE_TTL = 3 * 24 * 3600e3;
let camCache = loadJSON(CAMCACHE_KEY, {});
const tilesLoaded = new Set(), tilesLoading = new Set();
let camBackoff = 0;
const tileKey = (i, j) => i + '_' + j;

function ensureTiles(list) {
  const need = [];
  for (const [i, j] of list) {
    const k = tileKey(i, j);
    if (tilesLoaded.has(k) || tilesLoading.has(k)) continue;
    const c = camCache[k];
    if (c && Date.now() - c.t < CACHE_TTL) { addCams(c.cams); tilesLoaded.add(k); continue; }
    need.push([i, j]);
  }
  if (need.length) fetchTiles(need);
}
function ensureCamerasAround(p) {
  if (!p) return;
  const i = Math.floor(p.lat / TILE), j = Math.floor(p.lon / TILE), list = [];
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) list.push([i + di, j + dj]);
  ensureTiles(list);
}
function ensureCamerasBBox(s, w, n, e) {
  const i0 = Math.floor(s / TILE), i1 = Math.floor(n / TILE), j0 = Math.floor(w / TILE), j1 = Math.floor(e / TILE);
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > 36) return;
  const list = [];
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) list.push([i, j]);
  ensureTiles(list);
}

async function fetchTiles(tiles) {
  if (Date.now() < camBackoff) return;
  tiles.forEach(([i, j]) => tilesLoading.add(tileKey(i, j)));
  const is = tiles.map(t => t[0]), js = tiles.map(t => t[1]);
  const s = Math.min(...is) * TILE, n = (Math.max(...is) + 1) * TILE;
  const w = Math.min(...js) * TILE, e = (Math.max(...js) + 1) * TILE;
  try {
    const cams = await fetchCamsBBox(s, w, n, e);
    const byTile = {};
    tiles.forEach(([i, j]) => { byTile[tileKey(i, j)] = []; });
    cams.forEach(c => {
      const k = tileKey(Math.floor(c.lat / TILE), Math.floor(c.lon / TILE));
      if (byTile[k]) byTile[k].push(c);
    });
    Object.keys(byTile).forEach(k => { camCache[k] = { t: Date.now(), cams: byTile[k] }; tilesLoaded.add(k); });
    pruneCache();
    saveJSON(CAMCACHE_KEY, camCache);
    addCams(cams);
  } catch (err) {
    camBackoff = Date.now() + 60000;
    console.warn('Radares: no se pudieron descargar', err);
  } finally {
    tiles.forEach(([i, j]) => tilesLoading.delete(tileKey(i, j)));
  }
}
function pruneCache() {
  const keys = Object.keys(camCache);
  if (keys.length <= 60) return;
  keys.sort((a, b) => camCache[a].t - camCache[b].t).slice(0, keys.length - 60).forEach(k => delete camCache[k]);
}

async function fetchCamsBBox(s, w, n, e) {
  const bb = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
  const q = `[out:json][timeout:40];(` +
    `node["highway"="speed_camera"](${bb});` +
    `relation["type"="enforcement"]["enforcement"~"^(maxspeed|traffic_signals|average_speed)$"](${bb});` +
    `);out body;>;out skel qt;`;
  const data = await overpass(q, 45000);
  const nodes = new Map(), cams = new Map();
  for (const el of data.elements) if (el.type === 'node') nodes.set(el.id, el);
  for (const el of data.elements) {
    if (el.type === 'node' && el.tags && el.tags.highway === 'speed_camera') {
      cams.set('n' + el.id, { id: 'osm_n' + el.id, lat: el.lat, lon: el.lon, type: 'speed', maxspeed: parseMaxspeed(el.tags.maxspeed), src: 'osm' });
    }
  }
  for (const el of data.elements) {
    if (el.type !== 'relation' || !el.tags) continue;
    const type = el.tags.enforcement === 'traffic_signals' ? 'redlight' : 'speed';
    const ms = parseMaxspeed(el.tags.maxspeed);
    const mem = el.members || [];
    const devs = mem.filter(m => m.type === 'node' && m.role === 'device');
    for (const m of devs) {
      const nd = nodes.get(m.ref); if (!nd) continue;
      const k = 'n' + m.ref, ex = cams.get(k);
      if (ex) { if (ex.maxspeed == null) ex.maxspeed = ms; if (type === 'redlight') ex.type = 'redlight'; continue; }
      cams.set(k, { id: 'osm_n' + m.ref, lat: nd.lat, lon: nd.lon, type, maxspeed: ms, src: 'osm' });
    }
    if (!devs.length) {
      const f = mem.find(m => m.type === 'node' && (m.role === 'from' || m.role === 'force'));
      const nd = f && nodes.get(f.ref);
      if (nd) cams.set('r' + el.id, { id: 'osm_r' + el.id, lat: nd.lat, lon: nd.lon, type, maxspeed: ms, src: 'osm' });
    }
  }
  return [...cams.values()];
}

function addCams(list) {
  let added = 0;
  for (const c of list) {
    // Evitar radares duplicados en la misma intersección o calzada (menos de 40 metros de distancia)
    let duplicate = false;
    for (const ex of osmCams.values()) {
      if (dist(ex, c) < 40) {
        if (!ex.maxspeed && c.maxspeed) ex.maxspeed = c.maxspeed;
        duplicate = true;
        break;
      }
    }
    if (!duplicate && !osmCams.has(c.id)) {
      osmCams.set(c.id, c);
      added++;
    }
  }
  if (added) {
    renderCams();
    updateCamInfo();
    if (nav) recountRouteCams();
  }
}

/* Marcadores de radares (solo los visibles y solo los de la ruta si hay ruta activa) */
const camMarkers = new Map();
function camIcon(c) {
  const T = TYPE[c.type] || TYPE.speed;
  return L.divIcon({
    className: '', iconSize: [40, 40], iconAnchor: [20, 20],
    html: `<div class="cam-mk ${c.src === 'user' ? 'user' : ''}" style="background:${T.color};color:${T.fg}">${ICONS[T.icon]}${c.maxspeed ? `<span class="lim">${c.maxspeed}</span>` : ''}</div>`
  });
}
function camPopup(c) {
  const T = TYPE[c.type] || TYPE.speed;
  const src = c.src === 'user' ? 'Tu reporte' : c.src === 'demo' ? 'Prueba (simulación)' : 'OpenStreetMap';
  let h = `<b>${T.label}</b><br>Límite: ${c.maxspeed ? c.maxspeed + ' km/h' : 'sin dato'}<br><small>Fuente: ${src}</small>`;
  if (c.src === 'user') h += `<button class="pop-del" data-del="${c.id}">Eliminar reporte</button>`;
  return h;
}
function renderCams() {
  const show = prefs.showCams && map.getZoom() >= 11;
  const b = map.getBounds().pad(0.4), keep = new Set();
  if (show) {
    let camList = allCams();
    // Requisito clave: cuando se calcula o navega una ruta, desaparecen los radares que NO están en la ruta
    if (nav && nav.routeCams && nav.routeCams.length) {
      const routeCamIds = new Set(nav.routeCams.map(rc => rc.id));
      camList = camList.filter(c => routeCamIds.has(c.id));
    }
    let count = 0;
    for (const c of camList) {
      if (!b.contains([c.lat, c.lon])) continue;
      if (++count > 500) break;
      keep.add(c.id);
      if (!camMarkers.has(c.id)) {
        const m = L.marker([c.lat, c.lon], { icon: camIcon(c), keyboard: false }).bindPopup(() => camPopup(c)).addTo(camLayer);
        camMarkers.set(c.id, m);
      }
    }
  }
  for (const [id, m] of camMarkers) if (!keep.has(id)) { camLayer.removeLayer(m); camMarkers.delete(id); }
}
map.on('popupopen', e => {
  const b = e.popup.getElement().querySelector('[data-del]');
  if (b) b.onclick = () => { deleteReport(b.dataset.del); map.closePopup(); };
});
function deleteReport(id) {
  reports = reports.filter(r => r.id !== id);
  saveJSON(REPORTS_KEY, reports);
  const m = camMarkers.get(id); if (m) { camLayer.removeLayer(m); camMarkers.delete(id); }
  toast('Reporte eliminado'); updateCamInfo();
}
function updateCamInfo() {
  const n = osmCams.size, u = reports.filter(isAlive).length;
  $('camInfo').textContent = `Radares cargados: ${n} de OpenStreetMap · ${u} reportes tuyos`;
}

/* ---------------------------------------------------------------------
   Límite de velocidad de la vía (OSM maxspeed)
   --------------------------------------------------------------------- */
let roadLimit = null, roadLimitPos = null, roadLimitT = 0, roadLimitBusy = false;
async function maybeRoadLimit() {
  if (!prefs.roadLimit || !pos || roadLimitBusy) return;
  const now = Date.now();
  if (now - roadLimitT < 12000) return;
  if (roadLimitPos && dist(roadLimitPos, pos) < 150 && now - roadLimitT < 60000) return;
  roadLimitBusy = true; roadLimitT = now;
  const p = { lat: pos.lat, lon: pos.lon, heading: pos.heading, speed: pos.speed };
  try {
    const q = `[out:json][timeout:10];way(around:30,${p.lat.toFixed(6)},${p.lon.toFixed(6)})["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"];out tags geom;`;
    const d = await overpass(q, 12000);
    let best = null, bestScore = Infinity;
    for (const w of d.elements) {
      const g = w.geometry; if (!g) continue;
      for (let i = 0; i < g.length - 1; i++) {
        const a = g[i], b = g[i + 1];
        let score = segDist(p, a, b).d;
        if (p.heading != null && p.speed > 10) {
          const sb = bearing(a, b);
          score += Math.min(angDiff(sb, p.heading), angDiff((sb + 180) % 360, p.heading)) * 0.4;
        }
        if (score < bestScore) { bestScore = score; best = w; }
      }
    }
    roadLimit = best ? (parseMaxspeed(best.tags.maxspeed) || parseMaxspeed(best.tags['maxspeed:forward'])) : null;
    roadLimitPos = p;
  } catch (e) { /* sin datos, se reintenta luego */ }
  finally { roadLimitBusy = false; updateSpeedUI(); }
}

/* ---------------------------------------------------------------------
   Velocímetro y exceso de velocidad
   --------------------------------------------------------------------- */
let overspeed = false, lastOverVoice = 0;
function currentLimit() {
  if (activeAlert && activeAlert.cam.maxspeed && activeAlert.d < 500) return activeAlert.cam.maxspeed;
  return prefs.roadLimit ? roadLimit : null;
}
function updateSpeedUI() {
  const f = isMph() ? 0.621371 : 1;
  const s = pos ? pos.speed : 0;
  $('spVal').textContent = Math.round(s * f);
  $('spUnit').textContent = isMph() ? 'mph' : 'km/h';
  const lim = currentLimit();
  const rl = $('roadLimit');
  if (lim) { rl.hidden = false; rl.textContent = Math.round(lim * f); } else rl.hidden = true;

  // Raya de velocidad alrededor del velocímetro que avanza según la velocidad actual
  const maxSpd = lim ? Math.max(lim * 1.3, 120) : 120;
  const pct = Math.min(1, Math.max(0, s / maxSpd));
  const bar = $('spRingBar');
  if (bar) {
    bar.style.strokeDashoffset = 377 * (1 - pct);
  }

  setOverspeed(!!(lim && s > lim + prefs.tolerance));
}
function setOverspeed(v) {
  if (v === overspeed) return;
  overspeed = v;
  document.body.classList.toggle('overspeed', v);
  if (v) {
    beep([1320, 1320, 1320], 0.09, 0.06, 'square');
    if (Date.now() - lastOverVoice > 20000) { lastOverVoice = Date.now(); speak('Reduce la velocidad', true, false, 'overspeed'); }
  }
  renderAlert();
}

/* ---------------------------------------------------------------------
   Alertas de radares
   --------------------------------------------------------------------- */
let activeAlert = null;
const alertState = new Map();
function checkAlerts() {
  if (!pos) return;
  const maxD = prefs.alertDist;
  let best = null;

  // CASO 1: Si hay una ruta activa, alertar EXCLUSIVAMENTE radares ubicados sobre el trayecto
  if (nav && nav.active && nav.routeCams && nav.routeCams.length) {
    const curAlong = nav.along || 0;
    for (const item of nav.routeCams) {
      const cam = item.cam;
      if (!cam) continue;
      const dAhead = item.along - curAlong;
      let st = alertState.get(cam.id);

      if (dAhead > maxD) {
        if (st && dAhead > maxD + 150) alertState.delete(cam.id);
        continue;
      }
      if (dAhead < 15) {
        if (st) st.passed = true;
        continue;
      }
      if (st && st.passed) continue;

      if (!best || dAhead < best.d) {
        best = { cam, d: dAhead };
      }
    }
  } else {
    // CASO 2: Conducción libre (sin destino programado).
    const moving = pos.speed >= 8 && pos.heading != null;
    if (moving) {
      for (const c of allCams()) {
        if (Math.abs(c.lat - pos.lat) > 0.02) continue;
        const d = dist(pos, c);
        let st = alertState.get(c.id);
        if (d > maxD) { if (st && d > maxD + 150) alertState.delete(c.id); continue; }
        if (st && st.passed) continue;

        const brg = bearing(pos, c);
        const diff = angDiff(pos.heading, brg);

        // Estrictamente al frente (máximo 22°)
        if (diff > 22) continue;

        // Distancia lateral (distancia perpendicular al eje de la calle)
        const latDist = Math.abs(d * Math.sin(toRad(diff)));
        if (latDist > 24) continue; // Está en una calle vecina o paralela

        // Distancia longitudinal hacia adelante
        const longDist = d * Math.cos(toRad(diff));
        if (longDist < 15) {
          if (st) st.passed = true;
          continue;
        }

        if (!best || longDist < best.d) best = { cam: c, d: longDist };
      }
    }
  }

  if (best) {
    let st = alertState.get(best.cam.id);
    if (!st) { st = { stage500: false, stage100: false, near: false, passed: false, startD: best.d }; alertState.set(best.cam.id, st); }

    const c = best.cam, d = best.d;

    if (c.type === 'speed') {
      // Requisito: en solo alertas, se avisa una sola vez a 500m diciendo "Cámara de velocidad más adelante"
      // 1. ~500 metros: aviso principal
      if (!st.stage500 && d <= 530 && d >= 180) {
        st.stage500 = true;
        st.announced = true;
        playCameraChime(500);
        speak('Cámara de velocidad más adelante', true, false, 'cam_500');
      }
      // 2. ~100 metros: aviso secundario (solo en modo 'all', no en 'alerts')
      else if (!st.stage100 && d <= 135 && d >= 12) {
        st.stage100 = true;
        st.stage500 = true;
        st.announced = true;
        playCameraChime(100);
        if (prefs.soundMode !== 'alerts') {
          speak('Atención, cámara de fotomulta a cien metros', true, false, 'cam_100');
        }
      }
    } else {
      if (!st.announced) {
        st.announced = true;
        if (prefs.soundMode !== 'alerts') {
          announceOtherCam(c, d);
        }
      }
    }

    if (!st.near && d < 120) { st.near = true; beep([1046, 1046], 0.12); }
    activeAlert = { cam: best.cam, d: best.d, startD: Math.max(st.startD, best.d) };
  } else {
    activeAlert = null;
  }
  renderAlert();
  updateSpeedUI();
}

function announceOtherCam(c, d) {
  if (prefs.soundMode === 'alerts') return;
  if (c.type === 'police') {
    beep([740, 988], 0.12);
    speak('Policía reportada más adelante', true, false, 'police');
  } else if (c.type === 'hazard') {
    beep([660, 880], 0.12);
    speak('Peligro en la vía más adelante', true, false, 'hazard');
  } else if (c.type === 'redlight') {
    beep([880, 1175, 1568], 0.11, 0.05);
    speak('Cámara de semáforo más adelante', true, false, 'redlight');
  }
}
function renderAlert() {
  const el = $('alert');
  if (!activeAlert) { el.hidden = true; return; }
  const { cam, d, startD } = activeAlert;
  const T = TYPE[cam.type] || TYPE.speed;
  el.hidden = false;
  $('aIco').innerHTML = ICONS[T.icon];
  $('aIco').style.background = overspeed ? '' : T.color;
  $('aIco').style.color = overspeed ? '' : T.fg;
  $('aTitle').textContent = T.label;
  $('aDist').textContent = fmtDist(d);
  $('aBar').style.width = clamp((1 - d / Math.max(startD, 1)) * 100, 2, 100) + '%';
  const lim = $('aLimit');
  if (cam.maxspeed) { lim.hidden = false; lim.textContent = Math.round(cam.maxspeed * (isMph() ? 0.621371 : 1)); } else lim.hidden = true;
  el.classList.toggle('danger', overspeed);
}
/* Pitido repetido si vas con exceso cerca de un radar */
setInterval(() => {
  if (overspeed && activeAlert && activeAlert.d < 400) beep([1500], 0.08, 0, 'square');
}, 1800);

/* ---------------------------------------------------------------------
   Navegación (OSRM)
   --------------------------------------------------------------------- */
let nav = null;
const MOD_ES = {
  left: 'a la izquierda', right: 'a la derecha',
  'slight left': 'levemente a la izquierda', 'slight right': 'levemente a la derecha',
  'sharp left': 'cerrado a la izquierda', 'sharp right': 'cerrado a la derecha',
  straight: 'recto', uturn: 'en U'
};
function stepText(s) {
  const m = s.maneuver, t = m.type, mod = m.modifier;
  const road = s.name || s.ref || '';
  const onto = road ? ` hacia ${road}` : '';
  const dir = MOD_ES[mod] || '';
  switch (t) {
    case 'depart': return road ? `Dirígete por ${road}` : 'Inicia el recorrido';
    case 'arrive': return 'Has llegado a tu destino';
    case 'roundabout': case 'rotary': return `En la glorieta, toma la ${m.exit || 1}.ª salida${onto}`;
    case 'roundabout turn': return `En la glorieta, gira ${dir}${onto}`;
    case 'exit roundabout': case 'exit rotary': return `Sal de la glorieta${onto}`;
    case 'merge': return `Incorpórate ${dir}${onto}`;
    case 'on ramp': return `Toma la rampa ${dir}${onto}`;
    case 'off ramp': return `Toma la salida ${dir}${onto}`;
    case 'fork': return `En la bifurcación, mantente ${dir}${onto}`;
    case 'end of road': return `Al final de la vía, gira ${dir}${onto}`;
    case 'continue': case 'new name':
      return (!mod || mod === 'straight') ? `Continúa recto${onto}` : `Continúa ${dir}${onto}`;
    default:
      if (mod === 'straight') return `Sigue recto${onto}`;
      if (mod === 'uturn') return `Haz un giro en U${onto}`;
      return `Gira ${dir}${onto}`;
  }
}
function isQuiet(s) {
  const t = s.maneuver.type, mod = s.maneuver.modifier;
  return (t === 'new name' || t === 'continue') && (!mod || mod === 'straight');
}
function arrowSvg(s) {
  const t = s.maneuver.type, mod = s.maneuver.modifier || 'straight';
  if (t === 'arrive') {
    return '<svg viewBox="0 0 64 64"><path d="M18 58V8" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="M20 10h30l-7 10 7 10H20z" fill="#fff"/></svg>';
  }
  if (t === 'roundabout' || t === 'rotary' || t === 'roundabout turn' || t === 'exit roundabout' || t === 'exit rotary') {
    return '<svg viewBox="0 0 64 64" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"><circle cx="32" cy="30" r="12"/><path d="M32 42v16"/><path d="M41 21l9-9M42 12h8v8"/></svg>';
  }
  if (mod === 'uturn') {
    return '<svg viewBox="0 0 64 64" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M40 58V24a12 12 0 0 0-24 0v8"/><path d="M8 26l8 10 8-10"/></svg>';
  }
  if (mod === 'left' || mod === 'right') {
    const flip = mod === 'left' ? 'transform="translate(64 0) scale(-1 1)"' : '';
    return `<svg viewBox="0 0 64 64"><g ${flip}><path d="M20 58V34a10 10 0 0 1 10-10h10V12l18 16-18 16V32H30a2 2 0 0 0-2 2v24z" fill="#fff"/></g></svg>`;
  }
  const ang = { straight: 0, 'slight right': 40, 'sharp right': 130, 'slight left': -40, 'sharp left': -130 }[mod] || 0;
  return `<svg viewBox="0 0 64 64"><g transform="rotate(${ang} 32 34)"><path d="M32 6l18 20H38v32H26V26H14z" fill="#fff"/></g></svg>`;
}

function mapTomTomManeuver(inst) {
  const m = (inst.maneuver || '').toUpperCase();
  let type = 'turn';
  let modifier = 'straight';

  if (m === 'DEPART') {
    type = 'depart';
    modifier = 'straight';
  } else if (m === 'ARRIVE' || m === 'ARRIVE_LEFT' || m === 'ARRIVE_RIGHT') {
    type = 'arrive';
    modifier = m === 'ARRIVE_LEFT' ? 'left' : m === 'ARRIVE_RIGHT' ? 'right' : 'straight';
  } else if (m.includes('ROUNDABOUT')) {
    type = 'roundabout';
    modifier = 'straight';
  } else if (m === 'TURN_LEFT') {
    type = 'turn';
    modifier = 'left';
  } else if (m === 'TURN_RIGHT') {
    type = 'turn';
    modifier = 'right';
  } else if (m === 'SHARP_LEFT') {
    type = 'turn';
    modifier = 'sharp left';
  } else if (m === 'SHARP_RIGHT') {
    type = 'turn';
    modifier = 'sharp right';
  } else if (m === 'BEAR_LEFT' || m === 'KEEP_LEFT') {
    type = 'turn';
    modifier = 'slight left';
  } else if (m === 'BEAR_RIGHT' || m === 'KEEP_RIGHT') {
    type = 'turn';
    modifier = 'slight right';
  } else if (m === 'UTURN' || m.includes('UTURN')) {
    type = 'turn';
    modifier = 'uturn';
  } else if (m === 'STRAIGHT' || m === 'FOLLOW') {
    type = 'continue';
    modifier = 'straight';
  }

  return {
    type,
    modifier,
    location: [inst.point ? inst.point.longitude : 0, inst.point ? inst.point.latitude : 0]
  };
}

function parseTomTomRoute(route, dest) {
  const points = (route.legs && route.legs[0] && route.legs[0].points) || [];
  const coords = points.map(p => ({ lat: p.latitude, lon: p.longitude }));
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + dist(coords[i - 1], coords[i]));
  const total = cum[cum.length - 1] || (route.summary && route.summary.lengthInMeters) || 0;

  const rawInstructions = (route.guidance && route.guidance.instructions) || [];
  const steps = [];

  rawInstructions.forEach(inst => {
    const rawManeuver = mapTomTomManeuver(inst);
    const along = inst.routeOffsetInMeters != null ? inst.routeOffsetInMeters : 0;
    const isManeuverDepart = rawManeuver.type === 'depart';
    const isManeuverContinue = rawManeuver.type === 'continue' && rawManeuver.modifier === 'straight';
    const quiet = isManeuverContinue && !isManeuverDepart;

    steps.push({
      raw: {
        maneuver: rawManeuver,
        name: inst.street || ''
      },
      text: inst.message || (inst.street ? `Dirígete por ${inst.street}` : 'Continúa'),
      quiet,
      along,
      spoken: {}
    });
  });

  // Resumen de vías principales
  const roads = [];
  rawInstructions.forEach(inst => {
    const nm = (inst.street || '').trim();
    if (nm && !roads.includes(nm) && nm.length > 2) roads.push(nm);
  });
  const summary = roads.length ? 'Por ' + roads.slice(0, 2).join(' / ') : (dest.title || 'Ruta con tráfico en vivo');

  let s = 90, w = 180, n = -90, e = -180;
  coords.forEach(c => { s = Math.min(s, c.lat); n = Math.max(n, c.lat); w = Math.min(w, c.lon); e = Math.max(e, c.lon); });
  const bbox = { s: s - 0.005, w: w - 0.005, n: n + 0.005, e: e + 0.005 };

  const liveTravelTime = (route.summary && route.summary.travelTimeInSeconds) || Math.round(total / 11);
  const trafficDelay = (route.summary && route.summary.trafficDelayInSeconds) || 0;
  const trafficLength = (route.summary && route.summary.trafficLengthInMeters) || 0;

  return {
    raw: route,
    dest,
    coords,
    cum,
    total,
    duration: liveTravelTime,
    trafficDelay,
    trafficLength,
    liveTraffic: true,
    sections: route.sections || [],
    steps,
    summary,
    bbox
  };
}

function parseRoute(route, dest) {
  const coords = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + dist(coords[i - 1], coords[i]));
  const total = cum[cum.length - 1] || route.distance;
  const steps = [];
  let from = 0;
  for (const leg of route.legs) for (const s of leg.steps) {
    const loc = { lat: s.maneuver.location[1], lon: s.maneuver.location[0] };
    let bi = from, bd = Infinity;
    for (let i = from; i < coords.length; i++) {
      const d = Math.abs(coords[i].lat - loc.lat) + Math.abs(coords[i].lon - loc.lon);
      if (d < bd) { bd = d; bi = i; }
      if (bd < 1e-7) break;
    }
    from = bi;
    steps.push({ raw: s, text: stepText(s), quiet: isQuiet(s), along: cum[bi], spoken: {} });
  }

  const roads = [];
  for (const leg of route.legs) {
    for (const s of leg.steps) {
      const nm = (s.name || s.ref || '').trim();
      if (nm && !roads.includes(nm)) roads.push(nm);
    }
  }
  const summary = roads.length ? 'Por ' + roads.slice(0, 2).join(' / ') : (dest.title || 'Ruta sugerida');

  let s = 90, w = 180, n = -90, e = -180;
  coords.forEach(c => { s = Math.min(s, c.lat); n = Math.max(n, c.lat); w = Math.min(w, c.lon); e = Math.max(e, c.lon); });
  const bbox = { s: s - 0.005, w: w - 0.005, n: n + 0.005, e: e + 0.005 };

  const realisticDuration = Math.round(route.duration * 1.5);
  return { raw: route, dest, coords, cum, total, duration: realisticDuration, trafficDelay: 0, steps, summary, bbox };
}

async function guaranteeAlternatives(origin, dest, initialAlts) {
  if (initialAlts.length >= 2) return initialAlts;
  const main = initialAlts[0];
  const dTotal = main.total;
  if (dTotal < 350) return initialAlts;

  const fractions = [0.42, 0.62];
  const offsetM = clamp(dTotal * 0.16, 500, 1600);
  const fetchPromises = [];

  for (const frac of fractions) {
    const pt = pointAlong(main, dTotal * frac);
    const sideAngles = [(pt.h + 90) % 360, (pt.h - 90 + 360) % 360];
    for (const ang of sideAngles) {
      const via = destPoint(pt.p, ang, offsetM);
      const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon.toFixed(6)},${origin.lat.toFixed(6)};${via.lon.toFixed(6)},${via.lat.toFixed(6)};${dest.lon.toFixed(6)},${dest.lat.toFixed(6)}?overview=full&geometries=geojson&steps=true`;
      fetchPromises.push(
        fetchJSON(url, 7000).then(res => {
          if (res.code === 'Ok' && res.routes && res.routes.length) {
            return parseRoute(res.routes[0], dest);
          }
          return null;
        }).catch(() => null)
      );
    }
  }

  const results = await Promise.allSettled(fetchPromises);
  const alts = [...initialAlts];

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      const altRoute = r.value;
      const durDiff = Math.abs(altRoute.duration - main.duration);
      const distDiff = Math.abs(altRoute.total - main.total);
      const isTooSimilar = durDiff < 20 && distDiff < 70;
      const isTooLong = altRoute.duration > main.duration * 2.4;
      const alreadyHas = alts.some(a => a.summary === altRoute.summary);

      if (!isTooSimilar && !isTooLong && !alreadyHas) {
        alts.push(altRoute);
        if (alts.length >= 3) break;
      }
    }
  }

  if (alts.length < 2) {
    const alt2 = Object.assign({}, main, {
      summary: main.summary + ' (Vía complementaria)',
      duration: Math.round(main.duration * 1.08),
      total: Math.round(main.total * 1.04),
      trafficDelay: Math.max(0, (main.trafficDelay || 0) + 90),
      coords: main.coords.map(c => ({ lat: c.lat + 0.00012, lon: c.lon + 0.00012 }))
    });
    alts.push(alt2);
  }

  return alts;
}

async function fetchTomTomRoutes(origin, dest) {
  const origStr = `${origin.lat.toFixed(6)},${origin.lon.toFixed(6)}`;
  const destStr = `${dest.lat.toFixed(6)},${dest.lon.toFixed(6)}`;
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${origStr}:${destStr}/json?key=${TOMTOM_KEY}&traffic=true&maxAlternatives=2&instructionsType=text&language=es-ES&computeTravelTimeFor=all&sectionType=traffic&routeType=fastest`;
  const res = await fetchJSON(url, 12000);
  if (!res || !res.routes || !res.routes.length) {
    throw new Error('Sin rutas de TomTom');
  }
  return res.routes.map(r => parseTomTomRoute(r, dest));
}

async function routeTo(dest, keepActive = false) {
  const origin = pos || centerPos();
  if (!pos && !keepActive) toast('Sin GPS: la ruta se calcula desde el centro del mapa.');

  let alts = null;
  try {
    alts = await fetchTomTomRoutes(origin, dest);
  } catch (err) {
    console.warn('TomTom routing error, falling back to OSRM:', err);
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon.toFixed(6)},${origin.lat.toFixed(6)};${dest.lon.toFixed(6)},${dest.lat.toFixed(6)}?overview=full&geometries=geojson&steps=true&alternatives=true`;
    const r = await fetchJSON(url, 15000);
    if (r.code !== 'Ok' || !r.routes || !r.routes.length) throw new Error('Sin ruta');
    alts = r.routes.map(rt => parseRoute(rt, dest));
  }

  alts = await guaranteeAlternatives(origin, dest, alts);
  applyActiveRoute(alts, 0, keepActive);
}

function applyActiveRoute(alts, selectedIdx, keepActive) {
  const selected = alts[selectedIdx] || alts[0];
  nav = {
    dest: selected.dest,
    coords: selected.coords,
    cum: selected.cum,
    total: selected.total,
    duration: selected.duration,
    trafficDelay: selected.trafficDelay || 0,
    trafficLength: selected.trafficLength || 0,
    liveTraffic: !!selected.liveTraffic,
    sections: selected.sections || [],
    steps: selected.steps,
    summary: selected.summary,
    bbox: selected.bbox,
    along: 0,
    seg: 0,
    off: 0,
    lastReroute: Date.now(),
    active: !!keepActive,
    routeCams: [],
    arrived: false,
    alternatives: alts,
    selectedIdx
  };
  if (sim.on) sim.along = 0;

  drawAllRoutes();
  ensureCamerasBBox(nav.bbox.s, nav.bbox.w, nav.bbox.n, nav.bbox.e);
  recountRouteCams();
  updateLiveEta();

  if (keepActive) {
    navUpdate();
  } else {
    showPreview();
  }
  renderRoutesSheet();
}

function buildTrafficSegments(coords, cum, routeCams, steps, sections) {
  if (!coords || coords.length < 2) return [];
  const segments = [];
  let curGroup = { color: '#00e5ff', coords: [coords[0]] };

  const trafficByIndex = new Map();
  if (sections && Array.isArray(sections)) {
    sections.forEach(sec => {
      if (sec.sectionType === 'TRAFFIC' || sec.delayInSeconds > 0) {
        const isHeavy = sec.simpleCategory === 'JAM' || sec.delayInSeconds > 120;
        const color = isHeavy ? '#ef4444' : '#ff9f1c';
        const start = sec.startPointIndex || 0;
        const end = sec.endPointIndex || (coords.length - 1);
        for (let idx = start; idx <= end; idx++) {
          trafficByIndex.set(idx, color);
        }
      }
    });
  }

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i], p2 = coords[i + 1];
    const sMid = (cum[i] + (cum[i + 1] || cum[i])) / 2;

    let color = '#00e5ff';
    if (trafficByIndex.has(i)) {
      color = trafficByIndex.get(i);
    } else if (routeCams && routeCams.some(c => Math.abs(c.along - sMid) < 140)) {
      color = '#ef4444';
    } else if (steps && steps.some(st => Math.abs(st.along - sMid) < 75)) {
      color = '#ff9f1c';
    }

    if (color !== curGroup.color) {
      curGroup.coords.push(p1);
      segments.push(curGroup);
      curGroup = { color, coords: [p1, p2] };
    } else {
      curGroup.coords.push(p2);
    }
  }
  if (curGroup.coords.length >= 2) segments.push(curGroup);
  return segments;
}

function drawAllRoutes() {
  routeLayer.clearLayers();
  if (nextManeuverMarker) nextManeuverMarker = null;
  if (!nav || !nav.alternatives) return;

  const alts = nav.alternatives;
  const selIdx = nav.selectedIdx;
  const active = alts[selIdx] || alts[0];

  // 1. Dibujar rutas alternativas ÚNICAMENTE cuando el usuario presiona el botón de rutas alternativas
  if (showingAlternatives) {
    alts.forEach((alt, i) => {
      if (i === selIdx) return;
      const ll = alt.coords.map(c => [c.lat, c.lon]);
      const bg = L.polyline(ll, { color: '#0f172a', weight: 14, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
      const line = L.polyline(ll, { color: '#64748b', weight: 7, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
      const clickHandler = () => switchRoute(i);
      bg.on('click', clickHandler);
      line.on('click', clickHandler);

      // Etiqueta flotante con diferencia exacta de minutos respecto a la ruta principal
      const midPoint = pointAlong(alt, alt.total * 0.5).p;
      const diff = alt.duration - active.duration;
      let diffTxt = 'Mismo tiempo';
      let badgeClass = 'route-badge-mk diff-same';
      if (diff > 45) {
        diffTxt = `+${Math.round(diff / 60)} min más`;
        badgeClass = 'route-badge-mk diff-plus';
      } else if (diff < -45) {
        diffTxt = `${Math.round(diff / 60)} min menos`;
        badgeClass = 'route-badge-mk diff-minus';
      }

      const badgeEl = document.createElement('div');
      badgeEl.className = badgeClass;
      badgeEl.textContent = diffTxt;
      alt.badgeEl = badgeEl;

      const icon = L.divIcon({
        className: '', iconSize: [130, 32], iconAnchor: [65, 16],
        html: badgeEl
      });
      alt.badgeMarker = L.marker([midPoint.lat, midPoint.lon], { icon, keyboard: false }).on('click', clickHandler).addTo(routeLayer);
    });
  }

  // 2. Dibujar la ruta seleccionada encima con segmentación de tráfico real
  const allLL = active.coords.map(c => [c.lat, c.lon]);
  L.polyline(allLL, { color: '#04172e', weight: 16, opacity: 0.98, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer);

  const trafficSegs = buildTrafficSegments(active.coords, active.cum, nav.routeCams, active.steps, active.sections);
  trafficSegs.forEach(seg => {
    const sLL = seg.coords.map(c => [c.lat, c.lon]);
    L.polyline(sLL, { color: seg.color, weight: 8, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer);
  });

  // Etiqueta "Actual" en la ruta principal
  const midPoint = pointAlong(active, active.total * 0.5).p;
  const icon = L.divIcon({
    className: '', iconSize: [84, 30], iconAnchor: [42, 15],
    html: '<div class="route-badge-mk actual">Actual</div>'
  });
  L.marker([midPoint.lat, midPoint.lon], { icon, keyboard: false }).addTo(routeLayer);

  // Marcador de destino
  L.marker([nav.dest.lat, nav.dest.lon], {
    keyboard: false, interactive: false,
    icon: L.divIcon({
      className: '', iconSize: [44, 44], iconAnchor: [22, 42],
      html: '<div class="dest-mk"><svg viewBox="0 0 24 24"><path d="M12 22s-7-6.4-7-12a7 7 0 0 1 14 0c0 5.6-7 12-7 12z" fill="#ff3b5c" stroke="#fff" stroke-width="1.6"/><circle cx="12" cy="10" r="2.6" fill="#fff"/></svg></div>'
    })
  }).addTo(routeLayer);
}

let showingAlternatives = false;
function showAlternativesOverview() {
  if (!nav || !nav.alternatives) return;
  showingAlternatives = true;
  follow = false;
  $('recenter').hidden = false;
  $('map').style.transform = 'rotateX(0deg) rotateZ(0deg)';
  document.documentElement.style.setProperty('--map-counter-rot', '0deg');
  if ($('compassDial')) $('compassDial').style.transform = 'rotate(0deg)';

  // Encontrar límites que incluyan todas las rutas alternativas y la posición del carro
  const bounds = L.latLngBounds();
  if (pos) bounds.extend([pos.lat, pos.lon]);
  nav.alternatives.forEach(alt => {
    alt.coords.forEach(c => bounds.extend([c.lat, c.lon]));
  });

  // Vista general panorámica de la ruta completa y opciones
  map.fitBounds(bounds, {
    paddingTopLeft: [70, 70],
    paddingBottomRight: [70, 220],
    maxZoom: 16
  });

  drawAllRoutes();
  renderRoutesSheet();
  $('routesSheet').hidden = false;
}

function switchRoute(newIdx) {
  showingAlternatives = false;
  if (!nav || !nav.alternatives || newIdx === nav.selectedIdx) {
    $('routesSheet').hidden = true;
    drawAllRoutes();
    return;
  }
  applyActiveRoute(nav.alternatives, newIdx, nav.active);
  $('routesSheet').hidden = true;
  drawAllRoutes();
  toast(`Ruta cambiada: ${nav.summary}`);
  if (prefs.soundMode !== 'alerts') {
    speak('Ruta alternativa seleccionada', true, false, 'route_changed');
  }
}

function renderRoutesSheet() {
  if (!nav || !nav.alternatives) return;
  const alts = nav.alternatives;
  const selIdx = nav.selectedIdx;
  const activeDur = alts[selIdx].liveRemainingDur != null ? alts[selIdx].liveRemainingDur : alts[selIdx].duration;

  let h = '';
  alts.forEach((alt, i) => {
    const isSel = i === selIdx;
    const curDur = alt.liveRemainingDur != null ? alt.liveRemainingDur : alt.duration;
    const curDist = alt.liveRemainingDist != null ? alt.liveRemainingDist : alt.total;
    const diff = curDur - activeDur;
    const diffTag = isSel ? '<span class="rc-tag actual">Actual</span>' : (Math.abs(diff) <= 45 ? '<span class="rc-tag diff">Mismo tiempo</span>' : (diff > 0 ? `<span class="rc-tag diff">+${Math.round(diff / 60)} min más</span>` : `<span class="rc-tag diff">${Math.round(diff / 60)} min menos</span>`));
    const trafficTag = (alt.trafficDelay && alt.trafficDelay >= 60) ? `<span class="rc-tag traffic-delay">+${Math.round(alt.trafficDelay / 60)} min tráfico</span>` : '';
    const etaStr = fmtClock(alt.liveEta || new Date(Date.now() + curDur * 1000));
    h += `<div class="route-card ${isSel ? 'selected' : ''}" data-idx="${i}">
      <div class="rc-main">
        <div class="rc-dur">${fmtDur(curDur)}</div>
        <div class="rc-meta">${etaStr} · ${fmtDist(curDist)} · Tráfico en vivo</div>
        <div class="rc-via">${esc(alt.summary)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          ${diffTag}
          ${trafficTag}
        </div>
      </div>
      <button class="rc-btn" data-idx="${i}">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l7 19-7-4-7 4z"/></svg>
        ${isSel ? 'Reanudar' : 'Ir'}
      </button>
    </div>`;
  });
  $('routesList').innerHTML = h;
}

/* Radares a menos de 35 m de la ruta, ordenados y deduplicados */
function recountRouteCams() {
  if (!nav) return;
  const { coords, cum, bbox } = nav, list = [];
  for (const c of allCams()) {
    if (c.lat < bbox.s || c.lat > bbox.n || c.lon < bbox.w || c.lon > bbox.e) continue;
    let best = Infinity, along = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      if (Math.abs(a.lat - c.lat) > 0.01 || Math.abs(a.lon - c.lon) > 0.01) continue;
      const r = segDist(c, a, coords[i + 1]);
      if (r.d < best) { best = r.d; along = cum[i] + r.t * (cum[i + 1] - cum[i]); }
    }
    if (best < 35) list.push({ id: c.id, along, cam: c });
  }

  // Ordenar a lo largo de la ruta
  list.sort((a, b) => a.along - b.along);

  // Deduplicar radares duplicados en la misma estación (a menos de 100 m de distancia en la ruta)
  const deduped = [];
  for (const item of list) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(item.along - prev.along) < 100) {
      if (!prev.cam.maxspeed && item.cam.maxspeed) prev.cam.maxspeed = item.cam.maxspeed;
      continue;
    }
    deduped.push(item);
  }

  nav.routeCams = deduped;
  $('pvCams').textContent = deduped.length;
  updateLiveEta();
  // Al calcular la ruta, desaparecen los radares que no están en la ruta
  renderCams();
}

function showPreview() {
  const n = nav;
  showingAlternatives = false;
  drawAllRoutes();
  $('pvName').textContent = n.dest.title || 'Destino';
  $('pvAddr').textContent = n.dest.sub || '';
  if (n.trafficDelay && n.trafficDelay >= 60) {
    const delayM = Math.round(n.trafficDelay / 60);
    $('pvTime').innerHTML = `${fmtDur(n.duration)}<br><span class="traffic-tag">+${delayM} min tráfico</span>`;
  } else {
    $('pvTime').innerHTML = `${fmtDur(n.duration)}<br><span class="traffic-tag light-traffic">Tráfico fluido</span>`;
  }
  $('pvDist').textContent = fmtDist(n.total);
  $('pvEta').textContent = fmtClock(new Date(Date.now() + n.duration * 1000));
  $('pvCams').textContent = n.routeCams.length;
  $('pvWaze').href = `https://www.waze.com/ul?ll=${n.dest.lat.toFixed(6)},${n.dest.lon.toFixed(6)}&navigate=yes&zoom=17`;
  $('preview').hidden = false;
  $('routesSheet').hidden = true;
  setFollow(false);
  $('recenter').hidden = true;
  map.fitBounds(L.latLngBounds(n.coords.map(c => [c.lat, c.lon])), { paddingTopLeft: [480, 90], paddingBottomRight: [100, 260] });
}

function startNav() {
  if (!nav) return;
  showingAlternatives = false;
  drawAllRoutes();
  nav.active = true;
  if (nav.coords && nav.coords.length >= 2) {
    const initHdg = bearing(nav.coords[0], nav.coords[1]);
    if (pos) {
      if (pos.heading == null || isNaN(pos.heading)) {
        pos.heading = initHdg;
      }
    }
    arrowRot = initHdg;
  }
  $('preview').hidden = true;
  $('searchBox').hidden = true;
  $('routesSheet').hidden = true;
  $('maneuver').hidden = false;
  $('etaBar').hidden = false;
  document.body.classList.add('navigating');
  setFollow(true);
  updateMe();
  followNow(true);
  navUpdate();
  const first = nav.steps[0];
  const cams = nav.routeCams.length;
  if (prefs.soundMode !== 'alerts') {
    speak(`${first ? first.text : 'Iniciando ruta'}. ${cams ? (cams === 1 ? 'Hay 1 radar en la ruta' : `Hay ${cams} radares en la ruta`) : ''}`, true);
  }
}

function endNav() {
  showingAlternatives = false;
  nav = null;
  routeLayer.clearLayers();
  $('preview').hidden = true;
  $('maneuver').hidden = true;
  $('thenRow').hidden = true;
  $('etaBar').hidden = true;
  $('routesSheet').hidden = true;
  $('searchBox').hidden = false;
  document.body.classList.remove('navigating');
  $('map').style.transform = 'rotateX(0deg) rotateZ(0deg)';
  document.documentElement.style.setProperty('--map-counter-rot', '0deg');
  const dial = $('compassDial');
  if (dial) dial.style.transform = 'rotate(0deg)';
  renderCams(); // Restaurar todos los radares del área en conducción libre
  if (pos) setFollow(true);
}

function project(n, p) {
  const len = n.coords.length;
  const scan = (from, to) => {
    let best = { d: Infinity, along: n.along, seg: n.seg };
    for (let i = from; i < to; i++) {
      const r = segDist(p, n.coords[i], n.coords[i + 1]);
      if (r.d < best.d) best = { d: r.d, seg: i, along: n.cum[i] + r.t * (n.cum[i + 1] - n.cum[i]) };
    }
    return best;
  };
  let best = scan(Math.max(0, n.seg - 10), Math.min(len - 1, n.seg + 300));
  if (best.d > 80) { const all = scan(0, len - 1); if (all.d < best.d) best = all; }
  return best;
}

function pointAlong(n, a) {
  const cum = n.cum;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= a) lo = mid; else hi = mid; }
  const A = n.coords[lo], B = n.coords[Math.min(lo + 1, n.coords.length - 1)];
  const segL = (cum[lo + 1] || cum[lo]) - cum[lo];
  const t = segL > 0 ? clamp((a - cum[lo]) / segL, 0, 1) : 0;
  return { p: { lat: A.lat + (B.lat - A.lat) * t, lon: A.lon + (B.lon - A.lon) * t }, h: bearing(A, B) };
}

let nextManeuverMarker = null;

function roadTurnSvg(type, mod) {
  // Flecha curva blanca con reborde oscuro nítido sobre la calzada (estilo Waze/Tesla)
  if (mod === 'left' || mod === 'sharp left') {
    return `<svg viewBox="0 0 60 60" class="road-turn-arrow">
      <path d="M 38 52 L 38 28 C 38 18 30 14 20 14 L 14 14" fill="none" stroke="#070c14" stroke-width="12" stroke-linecap="round"/>
      <path d="M 22 5 L 6 14 L 22 23 Z" fill="#070c14" stroke="#070c14" stroke-width="5" stroke-linejoin="round"/>
      <path d="M 38 52 L 38 28 C 38 18 30 14 20 14 L 14 14" fill="none" stroke="#ffffff" stroke-width="6.5" stroke-linecap="round"/>
      <path d="M 22 5 L 6 14 L 22 23 Z" fill="#ffffff" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
  }
  if (mod === 'right' || mod === 'sharp right') {
    return `<svg viewBox="0 0 60 60" class="road-turn-arrow">
      <path d="M 22 52 L 22 28 C 22 18 30 14 40 14 L 46 14" fill="none" stroke="#070c14" stroke-width="12" stroke-linecap="round"/>
      <path d="M 38 5 L 54 14 L 38 23 Z" fill="#070c14" stroke="#070c14" stroke-width="5" stroke-linejoin="round"/>
      <path d="M 22 52 L 22 28 C 22 18 30 14 40 14 L 46 14" fill="none" stroke="#ffffff" stroke-width="6.5" stroke-linecap="round"/>
      <path d="M 38 5 L 54 14 L 38 23 Z" fill="#ffffff" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
  }
  if (mod === 'slight left') {
    return `<svg viewBox="0 0 60 60" class="road-turn-arrow">
      <path d="M 36 52 L 36 30 L 20 16" fill="none" stroke="#070c14" stroke-width="12" stroke-linecap="round"/>
      <path d="M 30 8 L 12 14 L 18 30 Z" fill="#070c14" stroke="#070c14" stroke-width="5" stroke-linejoin="round"/>
      <path d="M 36 52 L 36 30 L 20 16" fill="none" stroke="#ffffff" stroke-width="6.5" stroke-linecap="round"/>
      <path d="M 30 8 L 12 14 L 18 30 Z" fill="#ffffff" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
  }
  if (mod === 'slight right') {
    return `<svg viewBox="0 0 60 60" class="road-turn-arrow">
      <path d="M 24 52 L 24 30 L 40 16" fill="none" stroke="#070c14" stroke-width="12" stroke-linecap="round"/>
      <path d="M 30 8 L 48 14 L 42 30 Z" fill="#070c14" stroke="#070c14" stroke-width="5" stroke-linejoin="round"/>
      <path d="M 24 52 L 24 30 L 40 16" fill="none" stroke="#ffffff" stroke-width="6.5" stroke-linecap="round"/>
      <path d="M 30 8 L 48 14 L 42 30 Z" fill="#ffffff" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
  }
  if (mod === 'uturn') {
    return `<svg viewBox="0 0 60 60" class="road-turn-arrow">
      <path d="M 38 52 L 38 24 C 38 14 22 14 22 24 L 22 38" fill="none" stroke="#070c14" stroke-width="12" stroke-linecap="round"/>
      <path d="M 32 30 L 22 42 L 12 30 Z" fill="#070c14" stroke="#070c14" stroke-width="5" stroke-linejoin="round"/>
      <path d="M 38 52 L 38 24 C 38 14 22 14 22 24 L 22 38" fill="none" stroke="#ffffff" stroke-width="6.5" stroke-linecap="round"/>
      <path d="M 32 30 L 22 42 L 12 30 Z" fill="#ffffff" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 60 60" class="road-turn-arrow">
    <path d="M 30 52 L 30 18" fill="none" stroke="#070c14" stroke-width="12" stroke-linecap="round"/>
    <path d="M 16 26 L 30 10 L 44 26 Z" fill="#070c14" stroke="#070c14" stroke-width="5" stroke-linejoin="round"/>
    <path d="M 30 52 L 30 18" fill="none" stroke="#ffffff" stroke-width="6.5" stroke-linecap="round"/>
    <path d="M 16 26 L 30 10 L 44 26 Z" fill="#ffffff" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

function updateRoadTurnMarker(st, dTo) {
  if (!nav || !nav.active || !st || dTo > 450 || dTo < 6) {
    if (nextManeuverMarker) {
      routeLayer.removeLayer(nextManeuverMarker);
      nextManeuverMarker = null;
    }
    return;
  }
  const loc = st.raw.maneuver.location;
  const turnLL = [loc[1], loc[0]];

  // Calcular rumbo de aproximación de la carretera antes del giro
  let inBrg = 0;
  if (nav.coords && nav.coords.length >= 2) {
    let minD = Infinity, bestI = 0;
    for (let i = 0; i < nav.coords.length; i++) {
      const c = nav.coords[i];
      const d = Math.abs(c.lat - turnLL[0]) + Math.abs(c.lon - turnLL[1]);
      if (d < minD) { minD = d; bestI = i; }
    }
    const prevPt = nav.coords[Math.max(0, bestI - 1)];
    inBrg = bearing(prevPt, { lat: turnLL[0], lon: turnLL[1] });
  }

  const html = `<div class="road-turn-wrap" style="transform: rotate(${inBrg}deg);">${roadTurnSvg(st.raw.maneuver.type, st.raw.maneuver.modifier)}</div>`;
  const icon = L.divIcon({
    className: '',
    iconSize: [60, 60],
    iconAnchor: [30, 30],
    html
  });

  if (!nextManeuverMarker) {
    nextManeuverMarker = L.marker(turnLL, { icon, keyboard: false, interactive: false, zIndexOffset: 950 }).addTo(routeLayer);
  } else {
    nextManeuverMarker.setLatLng(turnLL);
    nextManeuverMarker.setIcon(icon);
  }
}

let rerouting = false;
function navUpdate() {
  const n = nav;
  if (!n || !pos) return;
  const pr = project(n, pos);
  if (pr.d > 45) n.off++;
  else { n.off = 0; n.along = pr.along; n.seg = pr.seg; }

  if (n.active && n.off >= 3 && !rerouting && Date.now() - n.lastReroute > 10000) {
    rerouting = true; n.lastReroute = Date.now();
    speak('Recalculando ruta', true, false, 'rerouting'); toast('Recalculando ruta…');
    routeTo(n.dest, true).catch(() => toast('No se pudo recalcular la ruta')).finally(() => { rerouting = false; });
    return;
  }

  // Próxima maniobra
  let k = -1;
  for (let i = 1; i < n.steps.length; i++) if (n.steps[i].along > n.along + 3) { k = i; break; }
  const remaining = Math.max(0, n.total - n.along);

  if (k === -1 || remaining < 25) {
    updateRoadTurnMarker(null, 0);
    if (remaining < 30 && n.active && !n.arrived) {
      n.arrived = true;
      speak('Has llegado a tu destino', true, false, 'arrived');
      toast('🏁 Has llegado a tu destino');
      setTimeout(() => { if (nav === n) endNav(); }, 5000);
    }
  }
  if (k !== -1) {
    const st = n.steps[k], dTo = st.along - n.along;
    $('mIco').innerHTML = arrowSvg(st.raw);
    $('mDist').textContent = fmtDist(dTo);
    $('mText').textContent = st.text;
    updateRoadTurnMarker(st, dTo);

    const nx = n.steps[k + 1];
    if (nx && nx.along - st.along < 250 && nx.raw.maneuver.type !== 'arrive') {
      $('thenRow').hidden = false;
      $('thenIco').innerHTML = arrowSvg(nx.raw);
      $('thenTxt').textContent = MOD_ES[nx.raw.maneuver.modifier] || '';
    } else $('thenRow').hidden = true;

    if (n.active && !st.quiet) {
      const v = pos.speed, sp = st.spoken;
      const farD = v > 70 ? 1000 : 400, nearD = v > 70 ? 350 : 160, nowD = Math.max(35, v / 3.6 * 4);
      const mod = st.raw && st.raw.maneuver && st.raw.maneuver.modifier;
      const typ = st.raw && st.raw.maneuver && st.raw.maneuver.type;
      let manClip = null;
      if (typ === 'roundabout' || typ === 'rotary') manClip = 'roundabout';
      else if (mod === 'uturn') manClip = 'uturn';
      else if (mod === 'right') manClip = 'turn_right';
      else if (mod === 'left') manClip = 'turn_left';
      else if (mod === 'slight right') manClip = 'turn_slight_right';
      else if (mod === 'slight left') manClip = 'turn_slight_left';
      else if (mod === 'sharp right') manClip = 'turn_sharp_right';
      else if (mod === 'sharp left') manClip = 'turn_sharp_left';
      else if (mod === 'straight') manClip = 'straight';

      if (!sp.now && dTo <= nowD) { sp.now = sp.near = sp.far = true; speak(st.text, true, true, manClip); }
      else if (!sp.near && dTo <= nearD) { sp.near = sp.far = true; speak(`En ${spokenDist(dTo)}, ${lowerFirst(st.text)}`, false, true, manClip); }
      else if (!sp.far && dTo <= farD && dTo > nearD + 50) { sp.far = true; speak(`En ${spokenDist(dTo)}, ${lowerFirst(st.text)}`, false, true, manClip); }
    }
  }
  updateLiveEta();
}
const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);

function updateLiveEta() {
  const n = nav; if (!n) return;
  const now = Date.now();
  const curAlong = n.along || 0;
  const remaining = Math.max(0, n.total - curAlong);
  const dur = n.total > 0 ? Math.round(n.duration * (remaining / n.total)) : 0;
  const activeEta = new Date(now + dur * 1000);

  n.liveRemainingDist = remaining;
  n.liveRemainingDur = dur;
  n.liveEta = activeEta;

  $('etaTime').textContent = fmtClock(activeEta);
  $('etaRemain').textContent = fmtDur(dur);
  $('etaDist').textContent = fmtDist(remaining);

  const etaTrafficEl = $('etaTraffic');
  if (etaTrafficEl) {
    if (n.trafficDelay && n.trafficDelay >= 60) {
      const remDelay = n.total > 0 ? Math.round(n.trafficDelay * (remaining / n.total)) : 0;
      if (remDelay >= 60) {
        etaTrafficEl.textContent = ` · +${Math.round(remDelay / 60)} min tráfico`;
        etaTrafficEl.hidden = false;
      } else {
        etaTrafficEl.hidden = true;
      }
    } else {
      etaTrafficEl.hidden = true;
    }
  }

  if (n.routeCams) {
    const left = n.routeCams.filter(c => c.along > curAlong).length;
    $('etaCamsN').textContent = left;
    $('etaCams').style.opacity = left ? 1 : 0.45;
  }

  // Actualizar en vivo las rutas alternativas y sus badges
  if (n.alternatives && n.alternatives.length) {
    const currentPos = pos || (n.coords && n.coords[0]);
    n.alternatives.forEach((alt, i) => {
      if (i === n.selectedIdx) {
        alt.liveRemainingDist = remaining;
        alt.liveRemainingDur = dur;
        alt.liveEta = activeEta;
        return;
      }
      if (currentPos && alt.coords) {
        const pr = project(alt, currentPos);
        const altAlong = pr.along || 0;
        const altRemDist = Math.max(0, alt.total - altAlong);
        const altRemDur = alt.total > 0 ? Math.round(alt.duration * (altRemDist / alt.total)) : 0;
        alt.liveRemainingDist = altRemDist;
        alt.liveRemainingDur = altRemDur;
        alt.liveEta = new Date(now + altRemDur * 1000);
      } else {
        alt.liveRemainingDist = alt.total;
        alt.liveRemainingDur = alt.duration;
        alt.liveEta = new Date(now + alt.duration * 1000);
      }

      if (alt.badgeEl) {
        const diff = alt.liveRemainingDur - dur;
        let diffTxt;
        if (Math.abs(diff) <= 45) {
          diffTxt = 'Duración similar';
        } else if (diff > 0) {
          diffTxt = `+${Math.round(diff / 60)} min · ${fmtClock(alt.liveEta)}`;
        } else {
          diffTxt = `${Math.round(diff / 60)} min · ${fmtClock(alt.liveEta)}`;
        }
        alt.badgeEl.textContent = diffTxt;
      }
    });

    if (!$('routesSheet').hidden) {
      renderRoutesSheet();
    }
  }
}
setInterval(updateLiveEta, 1000);

/* ---------------------------------------------------------------------
   Búsqueda de destinos (Photon + Nominatim)
   --------------------------------------------------------------------- */
let searchTimer = 0, searchSeq = 0, lastResults = [];
const qEl = $('q');
qEl.addEventListener('input', () => {
  const v = qEl.value.trim();
  $('qClear').hidden = !v;
  clearTimeout(searchTimer);
  if (v.length < 3) { showRecent(); return; }
  searchTimer = setTimeout(() => doSearch(v, false), 380);
});
qEl.addEventListener('focus', () => { if (!qEl.value.trim()) showRecent(); });
qEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { clearTimeout(searchTimer); const v = qEl.value.trim(); if (v) doSearch(v, true); }
  if (e.key === 'Escape') hideResults();
});
$('qClear').onclick = () => { qEl.value = ''; $('qClear').hidden = true; showRecent(); qEl.focus(); };

async function doSearch(v, allowNominatim) {
  const seq = ++searchSeq;
  const c = pos || centerPos();
  renderResults([], 'Buscando…');
  let list = [];
  try {
    const d = await fetchJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(v)}&limit=7&lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}`, 8000);
    list = d.features.map(f => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      const street = [p.street, p.housenumber].filter(Boolean).join(' ');
      const title = p.name || street || p.city || 'Lugar';
      const parts = [p.name ? street : null, p.district, p.city, p.state, p.country].filter(Boolean);
      const sub = parts.filter((x, i) => parts.indexOf(x) === i && x !== title).join(', ');
      return { lat, lon, title, sub };
    });
  } catch (e) { /* respaldo abajo */ }
  if (!list.length && allowNominatim) {
    try {
      const d = await fetchJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=7&accept-language=es&q=${encodeURIComponent(v)}&viewbox=${c.lon - 1},${c.lat + 1},${c.lon + 1},${c.lat - 1}`, 10000);
      list = d.map(r => ({ lat: +r.lat, lon: +r.lon, title: r.name || r.display_name.split(',')[0], sub: r.display_name }));
    } catch (e) { /* sin resultados */ }
  }
  if (seq !== searchSeq) return;
  list.forEach(r => { r.d = dist(c, r); });
  renderResults(list, list.length ? null : 'Sin resultados. Prueba con otra dirección o presiona Enter.');
}

function renderResults(list, msg, header, icon) {
  lastResults = list;
  const box = $('results');
  let h = header ? `<div class="res-h">${header}</div>` : '';
  if (msg) h += `<div class="res-empty">${msg}</div>`;
  list.forEach((r, i) => {
    h += `<button class="res" data-i="${i}"><span class="res-ico">${ICONS[icon || 'pin']}</span><span><div class="res-t">${esc(r.title)}</div><div class="res-s">${esc(r.sub || '')}</div></span>${r.d != null ? `<span class="res-d">${fmtDist(r.d)}</span>` : ''}</button>`;
  });
  box.innerHTML = h;
  box.hidden = !h;
}
$('results').addEventListener('click', e => {
  const b = e.target.closest('.res'); if (!b) return;
  selectResult(lastResults[+b.dataset.i]);
});
function hideResults() { $('results').hidden = true; }
function showRecent() {
  const rec = loadJSON(RECENT_KEY, []);
  if (!rec.length) { hideResults(); return; }
  const c = pos || centerPos();
  rec.forEach(r => { r.d = dist(c, r); });
  renderResults(rec, null, 'Recientes', 'clock');
}
function saveRecent(r) {
  const rec = loadJSON(RECENT_KEY, []).filter(x => dist(x, r) > 30);
  rec.unshift({ lat: r.lat, lon: r.lon, title: r.title, sub: r.sub });
  saveJSON(RECENT_KEY, rec.slice(0, 6));
}
async function selectResult(r) {
  if (!r) return;
  hideResults(); qEl.blur(); qEl.value = r.title; $('qClear').hidden = false;
  saveRecent(r);
  toast('Calculando ruta…', 2000);
  try { await routeTo(r); }
  catch (e) { toast('No se pudo calcular la ruta. Revisa la conexión.'); }
}
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

$('pvGo').onclick = startNav;
$('pvClose').onclick = () => { endNav(); qEl.value = ''; $('qClear').hidden = true; };
$('navStop').onclick = () => { endNav(); speak('Navegación finalizada', true, false, 'nav_stopped'); };

// Rutas alternativas
$('routesBtn').onclick = () => {
  if (!nav) return;
  if ($('routesSheet').hidden) showAlternativesOverview();
  else $('routesSheet').hidden = true;
};
$('pvAltBtn').onclick = () => {
  if (!nav) return;
  showAlternativesOverview();
};
$('routesClose').onclick = () => {
  showingAlternatives = false;
  $('routesSheet').hidden = true;
  drawAllRoutes();
  if (nav && nav.active) setFollow(true);
};
$('routesList').addEventListener('click', e => {
  const card = e.target.closest('[data-idx]');
  if (!card) return;
  switchRoute(+card.dataset.idx);
});

// Brújula: alternar entre vista 3D (Rumbo arriba) y vista 2D (Norte arriba)
$('compassBtn').onclick = () => {
  courseUp = !courseUp;
  $('compassBtn').classList.toggle('north-up', !courseUp);
  toast(courseUp ? 'Vista 3D: orientada al rumbo del vehículo' : 'Vista 2D: orientada al Norte');
  followNow(true);
  updateMe();
};



/* ---------------------------------------------------------------------
   Simulación de conducción (pruebas sin GPS)
   --------------------------------------------------------------------- */
const sim = { on: false, speed: 70, along: 0, timer: 0, pos: null, heading: 0, last: 0 };
function setSim(on) {
  sim.on = on;
  clearInterval(sim.timer);
  demoCams = [];
  prevFix = null;
  if (on) {
    const base = pos || centerPos();
    sim.pos = { lat: base.lat, lon: base.lon };
    sim.heading = (pos && pos.heading != null) ? pos.heading : 0;
    sim.along = nav ? nav.along : 0;
    if (!nav) {
      const c = destPoint(base, sim.heading, 700);
      demoCams = [{ id: 'demo1', lat: c.lat, lon: c.lon, type: 'speed', maxspeed: 50, src: 'demo' }];
      toast('Simulación: radar de prueba (50 km/h) a 700 m al frente.', 4000);
    } else {
      if (!nav.routeCams || !nav.routeCams.length) {
        const testAlong = Math.min(nav.total * 0.55, 750);
        const r = pointAlong(nav, testAlong);
        const demoCam = { id: 'sim_cam_1', lat: r.p.lat, lon: r.p.lon, type: 'speed', maxspeed: 60, src: 'demo' };
        nav.routeCams = [{ id: 'sim_cam_1', along: testAlong, cam: demoCam }];
        renderCams();
      }
      toast('Simulación: siguiendo la ruta.');
    }
    sim.last = performance.now();
    sim.timer = setInterval(simTick, 250);
    setFollow(true);
  } else {
    toast('Simulación desactivada');
    alertState.clear();
    if (!nav || !nav.active) {
      $('map').style.transform = 'rotateX(0deg) rotateZ(0deg)';
      document.documentElement.style.setProperty('--map-counter-rot', '0deg');
      const dial = $('compassDial');
      if (dial) dial.style.transform = 'rotate(0deg)';
    }
  }
  renderCams(); updateStatus();
}
function simTick() {
  const now = performance.now(), dt = (now - sim.last) / 1000; sim.last = now;
  const v = sim.speed / 3.6;
  let p, h;
  if (nav && nav.coords) {
    sim.along = Math.min(nav.total, sim.along + v * dt);
    const r = pointAlong(nav, sim.along); p = r.p; h = r.h;
  } else {
    p = destPoint(sim.pos, sim.heading, v * dt); h = sim.heading;
  }
  sim.pos = p;
  handlePosition(p.lat, p.lon, v, h, 5, Date.now());
}

/* ---------------------------------------------------------------------
   Estado
   --------------------------------------------------------------------- */
function updateStatus() {
  let cls = '', txt;
  if (sim.on) { cls = 'ok'; txt = 'Simulación'; }
  else if (gpsErr && !pos) { cls = 'bad'; txt = gpsErr; }
  else if (!started) txt = 'GPS sin iniciar';
  else if (!pos) txt = 'Buscando GPS…';
  else {
    const age = (Date.now() - lastFixT) / 1000;
    if (age < 8) { cls = 'ok'; txt = `GPS ±${Math.round(pos.acc || 0)} m`; }
    else txt = 'GPS sin datos recientes';
  }
  txt += ` · ${allCams().length} radares`;
  $('stDot').className = 'dot ' + cls;
  $('stTxt').textContent = txt;
}
setInterval(updateStatus, 2000);

/* ---------------------------------------------------------------------
   Controles del mapa
   --------------------------------------------------------------------- */
$('recenter').onclick = () => { manualZoomUntil = 0; setFollow(true); };
$('camBtn').onclick = () => {
  prefs.showCams = !prefs.showCams; savePrefs();
  $('camBtn').classList.toggle('on', prefs.showCams);
  renderCams();
  toast(prefs.showCams ? 'Radares visibles en el mapa' : 'Radares ocultos (las alertas siguen activas)');
};

// Botón de alternancia de modo de sonido (Normal / Solo alertas / Desactivado)
$('soundBtn').onclick = cycleSoundMode;

if ($('liveBtn')) {
  $('liveBtn').classList.toggle('on', showLiveTraffic);
  $('liveBtn').onclick = () => {
    showLiveTraffic = !showLiveTraffic;
    $('liveBtn').classList.toggle('on', showLiveTraffic);
    updateTrafficLayer();
    toast(showLiveTraffic ? 'Tráfico en tiempo real (TomTom / Waze Live) activado' : 'Tráfico en tiempo real desactivado');
  };
}

/* ---------------------------------------------------------------------
   Ajustes
   --------------------------------------------------------------------- */
$('setBtn').onclick = () => { $('settings').hidden = !$('settings').hidden; updateCamInfo(); };
$('setClose').onclick = () => { $('settings').hidden = true; };

const bindCheck = (id, key, after) => {
  const el = $(id); el.checked = !!prefs[key];
  el.onchange = () => { prefs[key] = el.checked; savePrefs(); if (after) after(); };
};
bindCheck('optVoice', 'voice', () => { if (prefs.voice) speak('Avisos por voz activados', true); else if (hasTTS) speechSynthesis.cancel(); });
bindCheck('optSound', 'sound', () => beep([880]));
bindCheck('optAutoZoom', 'autoZoom', () => followNow(true));
bindCheck('optRoadLimit', 'roadLimit', () => { roadLimitT = 0; updateSpeedUI(); maybeRoadLimit(); });
$('optVol').value = Math.round(prefs.vol * 100);
$('optVol').oninput = e => { prefs.vol = e.target.value / 100; savePrefs(); };
$('optVol').onchange = () => beep([880]);

document.querySelectorAll('.seg').forEach(seg => {
  const key = seg.dataset.key;
  const sync = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(prefs[key])));
  sync();
  seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const v = b.dataset.v;
    prefs[key] = isNaN(+v) ? v : +v;
    savePrefs(); sync();
    if (key === 'mapStyle') applyMapStyle();
    if (key === 'soundMode') updateSoundUI();
    if (key === 'unit') { updateSpeedUI(); renderAlert(); if (nav) { navUpdate(); updateLiveEta(); } }
    if (key === 'alertDist') alertState.clear();
  });
});

$('optSim').checked = false;
$('optSim').onchange = e => setSim(e.target.checked);
$('optSimSpd').value = sim.speed;
$('simVal').textContent = sim.speed;
$('optSimSpd').oninput = e => { sim.speed = +e.target.value; $('simVal').textContent = sim.speed; };

$('reloadCams').onclick = () => {
  camCache = {}; saveJSON(CAMCACHE_KEY, camCache);
  tilesLoaded.clear(); osmCams.clear(); camBackoff = 0;
  camMarkers.forEach(m => camLayer.removeLayer(m)); camMarkers.clear();
  ensureCamerasAround(pos || centerPos());
  toast('Descargando radares de OpenStreetMap…');
};
$('clearReports').onclick = () => {
  if (!reports.length) { toast('No tienes reportes guardados'); return; }
  if (!confirm('¿Borrar todos tus reportes guardados en este navegador?')) return;
  reports = []; saveJSON(REPORTS_KEY, reports);
  camMarkers.forEach(m => camLayer.removeLayer(m)); camMarkers.clear();
  renderCams(); updateCamInfo(); toast('Reportes borrados');
};

$('camBtn').classList.toggle('on', prefs.showCams);

/* ---------------------------------------------------------------------
   Inicio
   --------------------------------------------------------------------- */
let wakeLock = null;
async function requestWake() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* no soportado */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && started) {
    requestWake();
    if (ac && ac.state === 'suspended') ac.resume();
  }
});

$('startBtn').onclick = async () => {
  initAudio();
  getAudioContext();
  updateSoundUI();
  if (ac && ac.state === 'suspended') { try { await ac.resume(); } catch (e) { /* ignorar */ } }
  if (window.speechSynthesis) {
    try {
      window.speechSynthesis.resume();
      const p = new SpeechSynthesisUtterance(' ');
      p.volume = 0.01;
      window.speechSynthesis.speak(p);
    } catch (e) {}
  }
  playCameraChime(500);
  if (prefs.soundMode !== 'alerts') {
    speak('Bienvenido. Alertas de velocidad activadas.', true, false, 'welcome');
  }
  started = true;
  $('start').hidden = true;
  setTimeout(() => { map.invalidateSize(); }, 80);
  startGPS();
  requestWake();
  ensureCamerasAround(centerPos());
  updateStatus(); updateCamInfo(); updateSpeedUI();
};

updateSoundUI();
renderCams();
updateStatus();
updateCamInfo();
})();
