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

const prefs = Object.assign({
  voice: true, sound: true, vol: 0.8,
  alertDist: 800, tolerance: 5,
  mapStyle: 'dark', autoZoom: true, roadLimit: true,
  unit: 'kmh', showCams: true, lastPos: null
}, loadJSON(PREFS_KEY, {}));
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
const fmtClock = d => d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });

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
   Audio: pitidos (WebAudio) y voz (speechSynthesis)
   --------------------------------------------------------------------- */
let ac = null;
function initAudio() {
  if (ac) return;
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; }
}
function beep(freqs = [880], dur = 0.13, gap = 0.07, type = 'sine') {
  if (!prefs.sound || !ac) return;
  if (ac.state === 'suspended') ac.resume();
  let t = ac.currentTime + 0.02;
  for (const f of freqs) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, prefs.vol * 0.6), t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + dur + 0.03);
    t += dur + gap;
  }
}
let esVoice = null;
const hasTTS = 'speechSynthesis' in window;
function pickVoice() {
  if (!hasTTS) return;
  const vs = speechSynthesis.getVoices();
  esVoice = vs.find(v => /^es[-_](CO|419|MX|US)/i.test(v.lang)) || vs.find(v => /^es/i.test(v.lang)) || null;
}
if (hasTTS) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(text, priority = false) {
  if (!prefs.voice || !hasTTS || !text) return;
  try {
    if (priority) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = esVoice ? esVoice.lang : 'es-ES';
    if (esVoice) u.voice = esVoice;
    u.volume = clamp(prefs.vol, 0.05, 1);
    u.rate = 1.03;
    speechSynthesis.speak(u);
  } catch (e) { /* sin voz */ }
}

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

const tileGroup = L.layerGroup().addTo(map);

function applyMapStyle() {
  tileGroup.clearLayers();
  const style = prefs.mapStyle || 'dark';

  if (style === 'osm' || style === 'light') {
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxNativeZoom: 19,
      maxZoom: 20,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });
    tileGroup.addLayer(osm);
    document.body.classList.add('light');
  } else if (style === 'sat') {
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 18,
      maxZoom: 20,
      attribution: '© Esri World Imagery'
    });
    const ref = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 18,
      maxZoom: 20
    });
    tileGroup.addLayer(sat);
    tileGroup.addLayer(ref);
    document.body.classList.remove('light');
  } else {
    // dark (predeterminado para Tesla)
    const base = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 18,
      maxZoom: 20,
      attribution: '© OpenStreetMap, Esri'
    });
    const ref = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 18,
      maxZoom: 20
    });
    tileGroup.addLayer(base);
    tileGroup.addLayer(ref);
    document.body.classList.remove('light');
  }
}
applyMapStyle();

const routeLayer = L.layerGroup().addTo(map);
const camLayer = L.layerGroup().addTo(map);

/* Marcador del vehículo */
const meIcon = L.divIcon({
  className: '', iconSize: [64, 64], iconAnchor: [32, 32],
  html: '<div class="me-wrap"><div class="me-acc"></div><div class="me-arrow"><svg viewBox="0 0 48 48"><path d="M24 4 L40 42 L24 33 L8 42 Z" fill="#33ccff" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg></div></div>'
});
let meMarker = null, arrowRot = 0;
function updateMe() {
  if (!pos) return;
  const ll = [pos.lat, pos.lon];
  if (!meMarker) meMarker = L.marker(ll, { icon: meIcon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
  else meMarker.setLatLng(ll);
  if (pos.heading != null) {
    const d = ((pos.heading - arrowRot) % 360 + 540) % 360 - 180;
    arrowRot += d;
    const el = meMarker.getElement();
    const arrow = el && el.querySelector('.me-arrow');
    if (arrow) arrow.style.transform = `rotate(${arrowRot}deg)`;
  }
}

/* Seguimiento de cámara */
let follow = true, manualZoomUntil = 0;
function setFollow(v) {
  follow = v;
  $('recenter').hidden = v || !pos;
  if (v) followNow(true);
}
function followNow(animate) {
  if (!pos || !follow) return;
  let z = map.getZoom();
  if (prefs.autoZoom && Date.now() > manualZoomUntil) {
    const s = pos.speed;
    const tz = s < 25 ? 17 : s < 60 ? 16.25 : s < 95 ? 15.5 : 15;
    if (Math.abs(tz - z) >= 0.25) z = tz;
  }
  const p = map.project([pos.lat, pos.lon], z);
  const off = map.getSize().y * (nav && nav.active ? 0.22 : 0.1);
  const c = map.unproject(p.subtract(L.point(0, off)), z);
  map.setView(c, z, { animate: !!animate, duration: 0.6 });
}
map.on('dragstart', () => { if (follow) setFollow(false); });
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
  for (const c of list) if (!osmCams.has(c.id)) { osmCams.set(c.id, c); added++; }
  if (added) {
    renderCams();
    updateCamInfo();
    if (nav) recountRouteCams();
  }
}

/* Marcadores de radares (solo los visibles) */
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
    let count = 0;
    for (const c of allCams()) {
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
  setOverspeed(!!(lim && s > lim + prefs.tolerance));
}
function setOverspeed(v) {
  if (v === overspeed) return;
  overspeed = v;
  document.body.classList.toggle('overspeed', v);
  if (v) {
    beep([1320, 1320, 1320], 0.09, 0.06, 'square');
    if (Date.now() - lastOverVoice > 20000) { lastOverVoice = Date.now(); speak('Reduce la velocidad'); }
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
  const moving = pos.speed > 5 && pos.heading != null;
  let best = null;
  for (const c of allCams()) {
    if (Math.abs(c.lat - pos.lat) > 0.02) continue;
    const d = dist(pos, c);
    let st = alertState.get(c.id);
    if (d > maxD) { if (st && d > maxD + 150) alertState.delete(c.id); continue; }
    if (st && st.passed) continue;
    let ahead = true;
    if (moving) ahead = angDiff(pos.heading, bearing(pos, c)) < (d < 120 ? 70 : 40);
    if (!ahead || d < 15) {
      if (st && st.announced && d < 150) st.passed = true;
      continue;
    }
    if (!best || d < best.d) best = { cam: c, d };
  }
  if (best) {
    let st = alertState.get(best.cam.id);
    if (!st) { st = { announced: false, near: false, passed: false, startD: best.d }; alertState.set(best.cam.id, st); }
    if (!st.announced) { st.announced = true; announceCam(best.cam, best.d); }
    if (!st.near && best.d < 150) { st.near = true; beep([1046, 1046], 0.12); }
    activeAlert = { cam: best.cam, d: best.d, startD: Math.max(st.startD, best.d) };
  } else activeAlert = null;
  renderAlert();
  updateSpeedUI();
}
function announceCam(c, d) {
  const T = TYPE[c.type] || TYPE.speed;
  if (c.type === 'police' || c.type === 'hazard') beep([740, 988], 0.12);
  else beep([880, 1175, 1568], 0.11, 0.05);
  let msg = `${T.voice} a ${spokenDist(d)}`;
  if (c.maxspeed) msg += `. Límite ${c.maxspeed}`;
  speak(msg, true);
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

async function routeTo(dest, keepActive = false) {
  const origin = pos || centerPos();
  if (!pos && !keepActive) toast('Sin GPS: la ruta se calcula desde el centro del mapa.');
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon.toFixed(6)},${origin.lat.toFixed(6)};${dest.lon.toFixed(6)},${dest.lat.toFixed(6)}?overview=full&geometries=geojson&steps=true`;
  const r = await fetchJSON(url, 15000);
  if (r.code !== 'Ok' || !r.routes || !r.routes.length) throw new Error('Sin ruta');
  buildNav(r.routes[0], dest, keepActive);
}

function buildNav(route, dest, keepActive) {
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
  nav = {
    dest, coords, cum, total, duration: route.duration, steps,
    along: 0, seg: 0, off: 0, lastReroute: Date.now(),
    active: !!keepActive, routeCams: [], arrived: false
  };
  if (sim.on) sim.along = 0;

  routeLayer.clearLayers();
  const ll = coords.map(c => [c.lat, c.lon]);
  L.polyline(ll, { color: '#0a3d80', weight: 15, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer);
  L.polyline(ll, { color: '#33ccff', weight: 8, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer);
  L.marker([dest.lat, dest.lon], {
    keyboard: false, interactive: false,
    icon: L.divIcon({ className: '', iconSize: [44, 44], iconAnchor: [22, 42], html: '<div class="dest-mk"><svg viewBox="0 0 24 24"><path d="M12 22s-7-6.4-7-12a7 7 0 0 1 14 0c0 5.6-7 12-7 12z" fill="#ff3b5c" stroke="#fff" stroke-width="1.6"/><circle cx="12" cy="10" r="2.6" fill="#fff"/></svg></div>' })
  }).addTo(routeLayer);

  // Descargar radares a lo largo de la ruta
  let s = 90, w = 180, n = -90, e = -180;
  coords.forEach(c => { s = Math.min(s, c.lat); n = Math.max(n, c.lat); w = Math.min(w, c.lon); e = Math.max(e, c.lon); });
  nav.bbox = { s: s - 0.005, w: w - 0.005, n: n + 0.005, e: e + 0.005 };
  ensureCamerasBBox(nav.bbox.s, nav.bbox.w, nav.bbox.n, nav.bbox.e);
  recountRouteCams();

  if (keepActive) { navUpdate(); }
  else showPreview();
}

/* Radares a menos de 35 m de la ruta */
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
    if (best < 35) list.push({ id: c.id, along });
  }
  nav.routeCams = list;
  $('pvCams').textContent = list.length;
  updateEta();
}

function showPreview() {
  const n = nav;
  $('pvName').textContent = n.dest.title || 'Destino';
  $('pvAddr').textContent = n.dest.sub || '';
  $('pvTime').textContent = fmtDur(n.duration);
  $('pvDist').textContent = fmtDist(n.total);
  $('pvEta').textContent = fmtClock(new Date(Date.now() + n.duration * 1000));
  $('pvCams').textContent = n.routeCams.length;
  $('pvWaze').href = `https://www.waze.com/ul?ll=${n.dest.lat.toFixed(6)},${n.dest.lon.toFixed(6)}&navigate=yes&zoom=17`;
  $('preview').hidden = false;
  setFollow(false);
  $('recenter').hidden = true;
  map.fitBounds(L.latLngBounds(n.coords.map(c => [c.lat, c.lon])), { paddingTopLeft: [480, 90], paddingBottomRight: [100, 260] });
}

function startNav() {
  if (!nav) return;
  nav.active = true;
  $('preview').hidden = true;
  $('searchBox').hidden = true;
  $('maneuver').hidden = false;
  $('etaBar').hidden = false;
  document.body.classList.add('navigating');
  setFollow(true);
  navUpdate();
  const first = nav.steps[0];
  const cams = nav.routeCams.length;
  speak(`${first ? first.text : 'Iniciando ruta'}. ${cams ? (cams === 1 ? 'Hay 1 radar en la ruta' : `Hay ${cams} radares en la ruta`) : ''}`, true);
}

function endNav() {
  nav = null;
  routeLayer.clearLayers();
  $('preview').hidden = true;
  $('maneuver').hidden = true;
  $('thenRow').hidden = true;
  $('etaBar').hidden = true;
  $('searchBox').hidden = false;
  document.body.classList.remove('navigating');
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

let rerouting = false;
function navUpdate() {
  const n = nav;
  if (!n || !pos) return;
  const pr = project(n, pos);
  if (pr.d > 45) n.off++;
  else { n.off = 0; n.along = pr.along; n.seg = pr.seg; }

  if (n.active && n.off >= 3 && !rerouting && Date.now() - n.lastReroute > 10000) {
    rerouting = true; n.lastReroute = Date.now();
    speak('Recalculando ruta', true); toast('Recalculando ruta…');
    routeTo(n.dest, true).catch(() => toast('No se pudo recalcular la ruta')).finally(() => { rerouting = false; });
    return;
  }

  // Próxima maniobra
  let k = -1;
  for (let i = 1; i < n.steps.length; i++) if (n.steps[i].along > n.along + 3) { k = i; break; }
  const remaining = Math.max(0, n.total - n.along);

  if (k === -1 || remaining < 25) {
    if (remaining < 30 && n.active && !n.arrived) {
      n.arrived = true;
      speak('Has llegado a tu destino', true);
      toast('🏁 Has llegado a tu destino');
      setTimeout(() => { if (nav === n) endNav(); }, 5000);
    }
  }
  if (k !== -1) {
    const st = n.steps[k], dTo = st.along - n.along;
    $('mIco').innerHTML = arrowSvg(st.raw);
    $('mDist').textContent = fmtDist(dTo);
    $('mText').textContent = st.text;
    const nx = n.steps[k + 1];
    if (nx && nx.along - st.along < 250 && nx.raw.maneuver.type !== 'arrive') {
      $('thenRow').hidden = false;
      $('thenIco').innerHTML = arrowSvg(nx.raw);
      $('thenTxt').textContent = MOD_ES[nx.raw.maneuver.modifier] || '';
    } else $('thenRow').hidden = true;

    if (n.active && !st.quiet) {
      const v = pos.speed, sp = st.spoken;
      const farD = v > 70 ? 1000 : 400, nearD = v > 70 ? 350 : 160, nowD = Math.max(35, v / 3.6 * 4);
      if (!sp.now && dTo <= nowD) { sp.now = sp.near = sp.far = true; speak(st.text, true); }
      else if (!sp.near && dTo <= nearD) { sp.near = sp.far = true; speak(`En ${spokenDist(dTo)}, ${lowerFirst(st.text)}`); }
      else if (!sp.far && dTo <= farD && dTo > nearD + 50) { sp.far = true; speak(`En ${spokenDist(dTo)}, ${lowerFirst(st.text)}`); }
    }
  }
  updateEta();
}
const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);

function updateEta() {
  const n = nav; if (!n) return;
  const remaining = Math.max(0, n.total - n.along);
  const dur = n.total > 0 ? n.duration * remaining / n.total : 0;
  $('etaTime').textContent = fmtClock(new Date(Date.now() + dur * 1000));
  $('etaRemain').textContent = fmtDur(dur);
  $('etaDist').textContent = fmtDist(remaining);
  const left = n.routeCams.filter(c => c.along > n.along).length;
  $('etaCamsN').textContent = left;
  $('etaCams').style.opacity = left ? 1 : 0.45;
}

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
$('navStop').onclick = () => { endNav(); speak('Navegación finalizada', true); };

/* ---------------------------------------------------------------------
   Reportes
   --------------------------------------------------------------------- */
let reportAt = null;
const LIMITS = [null, 30, 40, 50, 60, 80, 90, 100, 120];
$('rpLimitChips').innerHTML = LIMITS.map(v => `<button data-v="${v == null ? '' : v}">${v == null ? 'Sin dato' : v}</button>`).join('');
function openReport(at) {
  reportAt = at;
  $('settings').hidden = true;
  $('rpWhere').textContent = at ? 'En el punto seleccionado del mapa' : 'En tu ubicación actual';
  $('rpLimit').hidden = true;
  document.querySelectorAll('.rp').forEach(b => b.classList.remove('sel'));
  $('reportSheet').hidden = false;
}
$('reportBtn').onclick = () => openReport(null);
$('rpClose').onclick = () => { $('reportSheet').hidden = true; };
map.on('contextmenu', e => openReport({ lat: e.latlng.lat, lon: e.latlng.lng }));
$('rpGrid').addEventListener('click', e => {
  const b = e.target.closest('.rp'); if (!b) return;
  document.querySelectorAll('.rp').forEach(x => x.classList.toggle('sel', x === b));
  if (b.dataset.type === 'speed') $('rpLimit').hidden = false;
  else saveReport(b.dataset.type, null);
});
$('rpLimitChips').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  saveReport('speed', b.dataset.v ? +b.dataset.v : null);
});
function saveReport(type, maxspeed) {
  const p = reportAt || pos;
  if (!p) { toast('Sin GPS: mantén presionado el mapa para reportar en ese punto.', 4000); return; }
  const r = { id: 'u' + Date.now().toString(36), lat: p.lat, lon: p.lon, type, maxspeed, src: 'user', t: Date.now() };
  reports.push(r);
  saveJSON(REPORTS_KEY, reports);
  $('reportSheet').hidden = true;
  renderCams(); updateCamInfo();
  if (nav) recountRouteCams();
  beep([660, 990], 0.08);
  toast(`${TYPE[type].label} reportado${TYPE[type].ttl ? ' (expira en ' + Math.round(TYPE[type].ttl / 3600e3) + ' h)' : ''}`);
}

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
    } else toast('Simulación: siguiendo la ruta.');
    sim.last = performance.now();
    sim.timer = setInterval(simTick, 250);
    setFollow(true);
  } else {
    toast('Simulación desactivada');
    alertState.clear();
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
$('zIn').onclick = () => { manualZoomUntil = Date.now() + 30000; map.zoomIn(); };
$('zOut').onclick = () => { manualZoomUntil = Date.now() + 30000; map.zoomOut(); };
$('recenter').onclick = () => { manualZoomUntil = 0; setFollow(true); };
$('camBtn').onclick = () => {
  prefs.showCams = !prefs.showCams; savePrefs();
  $('camBtn').classList.toggle('on', prefs.showCams);
  renderCams();
  toast(prefs.showCams ? 'Radares visibles en el mapa' : 'Radares ocultos (las alertas siguen activas)');
};

let liveOn = false;
$('liveBtn').onclick = () => {
  liveOn = !liveOn;
  $('liveBtn').classList.toggle('on', liveOn);
  if (liveOn) {
    const c = pos || centerPos();
    $('wazeFrame').src = `https://embed.waze.com/iframe?zoom=${Math.round(clamp(map.getZoom(), 3, 17))}&lat=${c.lat.toFixed(5)}&lon=${c.lon.toFixed(5)}&ct=livemap`;
    $('wazeLive').hidden = false;
    toast('Waze Live: tráfico y reportes en tiempo real. Las alertas de radar siguen activas.', 4000);
  } else {
    $('wazeLive').hidden = true;
    $('wazeFrame').src = 'about:blank';
  }
};

/* Pantalla completa */
const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
$('fsBtn').onclick = () => {
  const el = document.documentElement;
  try {
    if (!isFs()) (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } catch (e) { /* no soportado */ }
};
['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => setTimeout(() => map.invalidateSize(), 200)));

/* ---------------------------------------------------------------------
   Ajustes
   --------------------------------------------------------------------- */
$('setBtn').onclick = () => { $('reportSheet').hidden = true; $('settings').hidden = !$('settings').hidden; updateCamInfo(); };
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
    if (key === 'unit') { updateSpeedUI(); renderAlert(); if (nav) { navUpdate(); updateEta(); } }
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
  if (ac && ac.state === 'suspended') { try { await ac.resume(); } catch (e) { /* ignorar */ } }
  beep([660, 990], 0.09);
  if (hasTTS && prefs.voice) speak('Bienvenido. Alertas de radares activadas.');
  started = true;
  $('start').hidden = true;
  startGPS();
  requestWake();
  ensureCamerasAround(centerPos());
  updateStatus(); updateCamInfo(); updateSpeedUI();
};

renderCams();
updateStatus();
updateCamInfo();
})();
