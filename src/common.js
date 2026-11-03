/* Plant model shared by every panel. Each unit's state is a pure function of plant time T
   (minutes since today's 00:00), so the control centre and the detail pages always agree.
   Numbers marked VARSAYIM in the README are assumptions until the plant confirms them. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const mod = (a, n) => ((a % n) + n) % n;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const NF = [0, 1, 2, 3].map(d => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmt = (x, d = 0) => (x == null || isNaN(x)) ? '—' : NF[d].format(x);
const pad = (x, n = 2) => String(x).padStart(n, '0');
const hhmm = T => { const m = mod(Math.floor(T), 1440); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
const dur = m => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60); return h ? `${h} sa ${pad(m % 60)} dk` : `${m} dk`; };
// write markup only when it changed, so hover, focus and CSS animations survive the 4 Hz tick
const setHTML = (e, html) => { if (e._h !== html) { e._h = html; e.innerHTML = html; } };
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
// stable pseudo-random per (cast, salt) so every page draws the same cast the same way
const rnd = (n, s) => { const x = Math.sin(n * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
// small live wobble for readings: slow plant drift + a little real-time jitter
const wob = (T, seed) => { const r = Date.now() / 1000; return Math.sin(T * .7 + seed) * .5 + Math.sin(r / 1.7 + seed * 3) * .35 + Math.sin(r / .6 + seed * 7) * .15; };

const PLANT = {
  CYCLE: 144,            // one cast every 144 min → 10 casts a day
  PER_DAY: 10,
  MOULDS: 64, ROWS: 8,   // 7" hot-top table, 8 × 8
  DIA: 178, LEN: 7000, CROP_HEAD: 300, CROP_TAIL: 200,
  T_PER_M: Math.PI * 0.089 * 0.089 * 2.70,   // t per metre of Ø178 billet
  E_CYCLE: 288, H_CYCLE: 720, H_COUNT: 5,
  PREP_END: 15, CAST_START: 40, UNLOAD_END: 125, FILL_END: 18,
  COOL_AT: 765, COOL_MIN: 60, SAW_AT: 825, SAW_MIN: 100,
  SLOTS: ['6063', '6063', '6060', '6063', '6082', '6063', '6063', '6060', '6063', '6063'],
  ALLOYS: {
    '6063': { v: 123, color: '--a6063', temp: 695, spec: { Si: [.20, .60, .43], Fe: [0, .35, .20], Cu: [0, .10, .02], Mn: [0, .10, .03], Mg: [.45, .90, .50], Cr: [0, .10, .01], Zn: [0, .10, .02], Ti: [0, .10, .02] } },
    '6060': { v: 128, color: '--a6060', temp: 692, spec: { Si: [.30, .60, .42], Fe: [.10, .30, .19], Cu: [0, .10, .02], Mn: [0, .10, .03], Mg: [.35, .60, .46], Cr: [0, .05, .01], Zn: [0, .15, .02], Ti: [0, .10, .02] } },
    '6082': { v: 105, color: '--a6082', temp: 700, spec: { Si: [.70, 1.30, 1.00], Fe: [0, .50, .24], Cu: [0, .10, .04], Mn: [.40, 1.00, .55], Mg: [.60, 1.20, .78], Cr: [0, .25, .04], Zn: [0, .20, .02], Ti: [0, .10, .02] } },
  },
};
PLANT.LOG_T = PLANT.T_PER_M * PLANT.LEN / 1000;
PLANT.NET_M = (PLANT.LEN - PLANT.CROP_HEAD - PLANT.CROP_TAIL) / 1000;
const alloyColor = a => `var(${PLANT.ALLOYS[a].color})`;
const mouldName = i => 'K-' + pad(i + 1);

/* ---------- casting recipe: speed by cast length, integrated once per alloy ---------- */
function vTarget(L, vs) {
  if (L < 20) return 50;
  if (L < 450) return 50 + (vs - 50) * (L - 20) / 430;
  if (L < 6850) return vs;
  return vs - (vs - 80) * clamp((L - 6850) / 150, 0, 1);
}
function wTarget(v, vs) { return 45 + 65 * clamp((v - 50) / (vs - 50), 0, 1); }  // l/min per mould
const PROFILES = {};
function profile(alloy) {
  if (PROFILES[alloy]) return PROFILES[alloy];
  const vs = PLANT.ALLOYS[alloy].v, Ls = [0], dt = 1 / 60;   // 1 s steps
  const FILL = .5;                                              // metal fills, platen waits 30 s
  let L = 0, t = 0, tRamp = 0, tSteady = 0;
  for (let i = 0; i < 30; i++) Ls.push(0);
  t = FILL;
  while (L < PLANT.LEN) {
    L = Math.min(PLANT.LEN, L + vTarget(L, vs) * dt); t += dt; Ls.push(L);
    if (!tRamp && L >= 450) tRamp = t;
    if (!tSteady && L >= 6850) tSteady = t;
  }
  return PROFILES[alloy] = { vs, Ls, FILL, tRamp, tSteady, tEnd: t, tTaper: t + 2.5 };
}
function lengthAt(p, tc) { if (tc <= 0) return 0; const i = tc * 60; if (i >= p.Ls.length - 1) return PLANT.LEN; const a = Math.floor(i); return lerp(p.Ls[a], p.Ls[a + 1], i - a); }

/* ---------- per-cast facts (memoised) ---------- */
const DAY0 = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const CASTS = new Map();
function castInfo(n) {
  if (CASTS.has(n)) return CASTS.get(n);
  const slot = mod(n, PLANT.PER_DAY), date = new Date(DAY0 + n * PLANT.CYCLE * 60000);
  const alloy = PLANT.SLOTS[slot], a = PLANT.ALLOYS[alloy];
  const closed = [];
  if (rnd(n, 1) < .45) closed.push(Math.floor(rnd(n, 2) * PLANT.MOULDS));
  if (rnd(n, 3) < .15) { const j = Math.floor(rnd(n, 4) * PLANT.MOULDS); if (!closed.includes(j)) closed.push(j); }
  const logs = PLANT.MOULDS - closed.length;
  const utRej = rnd(n, 5) < .18 ? 1 : 0;
  const dross = 15 + rnd(n, 6) * 8;                         // kg/t
  const gross = logs * PLANT.LOG_T * (1 + (rnd(n, 7) - .5) * .004);
  const net = (logs - utRej) * PLANT.T_PER_M * PLANT.NET_M;
  const charged = gross * (1 + dross / 1000 + .004);
  const corr = rnd(n, 8) < .3;                               // first sample Mg low → correction
  const chem = {}, chem1 = {};
  for (const [el, [lo, hi, tg]] of Object.entries(a.spec)) {
    const span = Math.max(.01, (hi - lo) * .06);
    chem[el] = +(tg + (rnd(n, 20 + el.charCodeAt(0) + el.charCodeAt(1)) - .5) * span).toFixed(3);
    chem1[el] = chem[el];
  }
  if (corr) chem1.Mg = +(a.spec.Mg[0] - .01 - rnd(n, 9) * .03).toFixed(3);
  const primer = 34 + rnd(n, 10) * 16, ic = 20 + rnd(n, 11) * 8;
  const info = {
    n, slot, id: `D-${pad(date.getDate())}${pad(date.getMonth() + 1)}-${pad(slot + 1)}`, date, alloy, prof: profile(alloy),
    closed, logs, utRej, dross, gross, net, charged, recovery: net / charged * 100,
    h2In: .24 + rnd(n, 12) * .08, h2Out: .10 + rnd(n, 13) * .04, grain: 105 + rnd(n, 14) * 35,
    corr, chem, chem1, mgAdd: corr ? Math.round(10 + rnd(n, 15) * 14) : 0,
    mix: { primer, ic, dis: 100 - primer - ic },
    gas: 72 + rnd(n, 16) * 14, kwh: 88 + rnd(n, 17) * 16,     // per net tonne
    start: n * PLANT.CYCLE + PLANT.CAST_START,
  };
  info.end = info.start + info.prof.tTaper;
  CASTS.set(n, info);
  return info;
}

/* ---------- phase helper ---------- */
function phaseOf(list, x) { for (let i = 0; i < list.length; i++) if (x < list[i][1]) return i; return list.length - 1; }
function mkPhases(defs, T0) { return defs.map(([key, a, b]) => ({ key, start: T0 + a, end: T0 + b })); }

/* ---------- casting table + launder ---------- */
const TABLE_PHASES = ['HAZIRLIK', 'HAZIR', 'BAŞLANGIÇ', 'DÖKÜM', 'BİTİŞ', 'BOŞALTMA'];
function table(T) {
  const C = PLANT.CYCLE, n = Math.floor((T - PLANT.UNLOAD_END) / C) + 1, c = T - n * C;
  const cast = castInfo(n), p = cast.prof, a = PLANT.ALLOYS[cast.alloy], cs = PLANT.CAST_START;
  const bounds = [['HAZIRLIK', PLANT.UNLOAD_END - C, PLANT.PREP_END], ['HAZIR', PLANT.PREP_END, cs], ['BAŞLANGIÇ', cs, cs + p.tRamp],
    ['DÖKÜM', cs + p.tRamp, cs + p.tSteady], ['BİTİŞ', cs + p.tSteady, cs + p.tTaper], ['BOŞALTMA', cs + p.tTaper, PLANT.UNLOAD_END]];
  const phases = mkPhases(bounds, n * C), pi = phaseOf(bounds.map(b => [b[1], b[2]]), c);
  const tc = c - cs, casting = pi >= 2 && tc < p.tEnd, metal = casting;
  const L = pi < 2 ? 0 : lengthAt(p, tc);
  const vT = casting && tc > p.FILL ? vTarget(L, p.vs) : 0;
  const v = vT ? vT * (1 + wob(T, 1) * .012) : 0;
  let wT = 0;
  if (pi >= 2 && tc < p.tEnd) wT = tc < p.FILL ? 45 : wTarget(vT, p.vs);
  else if (pi === 4) wT = wTarget(80, p.vs) * clamp(1 - (tc - p.tEnd) / 2.5, 0, 1);
  const w = wT ? wT * (1 + wob(T, 2) * .015) : 0;
  const logs = cast.logs;
  const unload = pi === 5 ? clamp((c - (cs + p.tTaper) - 6) / 14, 0, 1) : 0;   // tilt 6 min, then crane 14 min
  return {
    n, cast, c, phase: TABLE_PHASES[pi], pi, phases, L, v, vT, w, wT, logs, metal, unload,
    progress: L / PLANT.LEN,
    tons: L / 1000 * PLANT.T_PER_M * logs,
    water: w * logs * 60 / 1000,                              // m³/h
    waterIn: 24 + wob(T, 3) * .6, waterOut: w ? 24 + 6.5 * (v / p.vs) + wob(T, 4) * .5 : null,
    launder: metal ? a.temp + wob(T, 5) * 2.2 : null,
    level: metal ? 75 + wob(T, 6) * 1.6 : 0,                  // mm metal head in the hot-top
    h2Out: metal ? cast.h2Out + wob(T, 7) * .004 : null, h2In: metal ? cast.h2In + wob(T, 8) * .006 : null,
    rotor: metal ? 380 + wob(T, 9) * 6 : (pi === 1 ? 120 : 0), argon: metal ? 42 + wob(T, 10) * 1.5 : 0,
    rod: metal ? 1.0 + wob(T, 11) * .03 : 0,                  // kg/t AlTi5B1
    filterDp: metal ? 14 + 10 * clamp(tc / p.tEnd, 0, 1) + wob(T, 12) * .8 : 0,   // mm metal head across the CFF
    air: metal ? 1.6 + wob(T, 13) * .05 : 0,                  // Nl/min per mould
    oil: metal ? .5 + wob(T, 14) * .02 : 0,                   // ml/min per mould
    pit: 1.15 + wob(T, 15) * .01,                             // m standing water
    hyd: 18 + (pi === 5 && unload > 0 ? 6 : 0) + wob(T, 16) * .3,
  };
}

/* ---------- melting furnaces E1, E2 ---------- */
const MELT_DEFS = [['ŞARJ', 0, 30], ['ERGİTME', 30, 190], ['ALAŞIM', 190, 222], ['NUMUNE', 222, 250], ['HAZIR', 250, 270], ['TRANSFER', 270, 288]];
function melter(k, T) {
  const L = mod(T + (k === 0 ? 270 : 126), PLANT.E_CYCLE), n = Math.round((T - L + 270) / PLANT.CYCLE), cast = castInfo(n);
  const pi = phaseOf(MELT_DEFS.map(d => [d[1], d[2]]), L), phases = mkPhases(MELT_DEFS, T - L);
  const heel = 4, charge = 32, s = clamp((L - 30) / 160, 0, 1);
  let temp, mass, liq, burn;
  if (pi === 0) { temp = lerp(718, 682, L / 30); mass = heel + charge * smooth(L / 30); liq = heel / mass; burn = 20; }
  else if (pi === 1) { temp = 672 + 83 * Math.pow(s, 2.2); mass = heel + charge; liq = (heel + charge * smooth(s * 1.08)) / mass; burn = L < 150 ? 100 : 70; }
  else if (pi === 2) { temp = lerp(755, 748, (L - 190) / 32); mass = 36; liq = 1; burn = 35; }
  else if (pi === 3) { temp = lerp(748, 742, (L - 222) / 28); mass = 36; liq = 1; burn = 25; }
  else if (pi === 4) { temp = lerp(742, 738, (L - 250) / 20); mass = 36; liq = 1; burn = 20; }
  else { temp = lerp(738, 732, (L - 270) / 18); mass = 36 - charge * (L - 270) / 18; liq = 1; burn = 10; }
  temp += wob(T, 30 + k) * 1.4;
  const sample1 = phases[3].start + 10, corrAt = sample1 + 3, sample2 = corrAt + 12;
  const chemOk = cast.corr ? T >= sample2 : T >= sample1;
  return {
    k, name: 'E' + (k + 1), L, n, cast, phase: MELT_DEFS[pi][0], pi, phases, temp, mass, liq, burn,
    gas: burn * 6 * (1 + wob(T, 32 + k) * .02),             // Nm³/h, 600 at full fire
    roof: pi === 1 ? 1060 + 80 * (burn / 100) + wob(T, 34 + k) * 8 : 880 + burn * 2 + wob(T, 34 + k) * 6,
    stir: pi === 2, door: pi === 0, skimmed: pi >= 3, sample1, corrAt, sample2, chemOk,
    pressure: pi === 0 ? 0 : 8 + wob(T, 36 + k) * 1.5,       // Pa
  };
}

/* ---------- holding / casting furnace B1 ---------- */
const HOLD_DEFS = [['DOLUM', 0, 18], ['ARITMA', 18, 40], ['DÖKÜM', 40, null], ['BEKLEME', null, 144]];
function holder(T) {
  const n = Math.floor(T / PLANT.CYCLE), c = T - n * PLANT.CYCLE, cast = castInfo(n), p = cast.prof;
  const castEnd = PLANT.CAST_START + p.tEnd;
  const defs = HOLD_DEFS.map(d => [d[0], d[1] ?? castEnd, d[2] ?? castEnd]);
  const pi = phaseOf(defs.map(d => [d[1], d[2]]), c), phases = mkPhases(defs, n * PLANT.CYCLE);
  const poured = pi === 2 ? lengthAt(p, c - PLANT.CAST_START) / PLANT.LEN * cast.gross : (pi === 3 ? cast.gross : 0);
  const heel = 3, full = heel + 32;
  const mass = pi === 0 ? heel + 32 * smooth(c / 18) : full - poured;
  const temp = (pi === 0 ? lerp(722, 730, c / 18) : pi === 1 ? lerp(730, 736, (c - 18) / 22) : pi === 2 ? lerp(736, 731, (c - 40) / p.tEnd) : 722) + wob(T, 40) * 1.2;
  return {
    name: 'B1', n, cast, c, phase: defs[pi][0], pi, phases, mass, temp, poured,
    tilt: pi === 2 ? 2 + 22 * (poured / cast.gross) : 0,
    burn: pi === 1 ? 45 : pi === 2 ? 30 : pi === 0 ? 25 : 15, lance: pi === 1,
  };
}

/* ---------- homogenising furnaces H1–H5, cooling chamber, saw ---------- */
const HOMO_DEFS = [['YÜKLEME', 0, 20], ['ISITMA', 20, 260], ['BEKLETME', 260, 620], ['BOŞALTMA', 620, 640], ['BOŞ', 640, 720]];
function homoTemp(L) {   // [air, metal] °C at local time L
  if (L < 20) return [lerp(520, 470, L / 20), 60];
  if (L < 260) { const x = L - 20; return [615 - 145 * Math.exp(-x / 22) - 30 * smooth((x - 120) / 120), 580 - 520 * Math.exp(-x / 48)]; }
  if (L < 620) return [585, 580];
  if (L < 640) return [lerp(584, 525, (L - 620) / 20), 579];
  return [520, null];
}
function homog(k, T) {
  const L = mod(T - PLANT.UNLOAD_END - k * PLANT.CYCLE, PLANT.H_CYCLE), n = Math.round((T - L - PLANT.UNLOAD_END) / PLANT.CYCLE);
  const pi = phaseOf(HOMO_DEFS.map(d => [d[1], d[2]]), L), phases = mkPhases(HOMO_DEFS, T - L);
  let [air, metal] = homoTemp(L);
  air += wob(T, 50 + k) * 1.5; if (metal != null) metal += wob(T, 55 + k) * (L > 260 ? .8 : 1.2);
  const soakFrom = 20 + 48 * Math.log(520 / 5);              // metal reaches 575 °C
  const soak = clamp(L - soakFrom, 0, 640 - soakFrom);
  const burn = pi === 1 ? 100 - 60 * smooth((L - 20) / 240) : pi === 2 ? 22 : pi === 4 ? 8 : 0;
  return { k, name: 'H' + (k + 1), L, n: pi === 4 ? null : n, cast: pi === 4 ? null : castInfo(n), phase: HOMO_DEFS[pi][0], pi, phases, air, metal, soak, soakNeed: 360, burn, gas: burn * 1.2 };
}
function homoCurve(L) { return homoTemp(L); }
function cooler(T) {
  const n = Math.floor((T - PLANT.COOL_AT) / PLANT.CYCLE), t = T - (n * PLANT.CYCLE + PLANT.COOL_AT);
  if (t >= PLANT.COOL_MIN) return { active: false, n, next: (n + 1) * PLANT.CYCLE + PLANT.COOL_AT, cast: castInfo(n) };
  const temp = 25 + 555 * Math.exp(-t / 55) + wob(T, 60) * .8;
  return { active: true, n, cast: castInfo(n), t, temp, rate: 555 / 55 * Math.exp(-t / 55) * 60, avgRate: 330 / (55 * Math.log(555 / 225)) * 60, fans: 100 };
}
function saw(T) {
  const n = Math.floor((T - PLANT.SAW_AT) / PLANT.CYCLE), t = T - (n * PLANT.CYCLE + PLANT.SAW_AT), cast = castInfo(n);
  if (t >= PLANT.SAW_MIN) return { active: false, n, cast, next: (n + 1) * PLANT.CYCLE + PLANT.SAW_AT, done: cast.logs };
  const done = Math.floor(t / PLANT.SAW_MIN * cast.logs);
  return { active: true, n, cast, t, done, cur: Math.min(cast.logs, done + 1), rejIdx: cast.utRej ? Math.floor(cast.logs * rnd(n, 18)) : -1 };
}

/* ---------- where each cast is on the plant floor ---------- */
const STAGES = [
  { key: 'firin', label: 'Ergitme', from: -270, to: 18 },
  { key: 'dokum', label: 'Döküm', from: 18, to: PLANT.UNLOAD_END },
  { key: 'homo', label: 'Homojenizasyon', from: PLANT.UNLOAD_END, to: PLANT.COOL_AT },
  { key: 'sogut', label: 'Soğutma', from: PLANT.COOL_AT, to: PLANT.SAW_AT },
  { key: 'testere', label: 'Testere ve UT', from: PLANT.SAW_AT, to: PLANT.SAW_AT + PLANT.SAW_MIN },
];
function castStage(n, T) {
  const r = T - n * PLANT.CYCLE;
  for (let i = 0; i < STAGES.length; i++) if (r >= STAGES[i].from && r < STAGES[i].to) return { i, ...STAGES[i], p: (r - STAGES[i].from) / (STAGES[i].to - STAGES[i].from) };
  return r >= STAGES[STAGES.length - 1].to ? { i: 5, key: 'stok', label: 'Stok', p: 1 } : null;
}
// casts whose casting has finished, newest first
function doneCasts(T, count = 10) {
  const out = []; let n = Math.floor((T - PLANT.CAST_START) / PLANT.CYCLE);
  while (out.length < count) { const c = castInfo(n); if (c.end <= T) out.push(c); n--; }
  return out;
}
function avg(list, f) { return list.reduce((s, x) => s + f(x), 0) / list.length; }

/* ---------- simulated clock (live by default; ×10 / ×60 demo continues across pages) ---------- */
const SIM = { T0: (Date.now() - DAY0) / 60000, t0: Date.now(), speed: 1 };
try { const s = JSON.parse(sessionStorage.getItem('bd-sim') || 'null'); if (s && s.speed > 1) Object.assign(SIM, s); } catch (e) {}
SIM.T = () => SIM.T0 + (Date.now() - SIM.t0) / 60000 * SIM.speed;
function simSave() { try { sessionStorage.setItem('bd-sim', JSON.stringify({ T0: SIM.T0, t0: SIM.t0, speed: SIM.speed })); } catch (e) {} }
function simSet(speed, T) {
  if (speed === 1 && T == null) { SIM.T0 = (Date.now() - DAY0) / 60000; } else SIM.T0 = T ?? SIM.T();
  SIM.t0 = Date.now(); SIM.speed = speed; simSave(); syncChrome(); tick(true);
}
function simJump(T) { simSet(SIM.speed === 1 ? 10 : SIM.speed, T); }

/* ---------- page chrome: theme, clock, speed buttons ---------- */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('bd-theme', t); } catch (e) {}
  const b = $('#themeBtn'); if (b) b.setAttribute('aria-pressed', t === 'dark');
  if (window.onTheme) window.onTheme(t);
}
try { const t = localStorage.getItem('bd-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
function syncChrome() {
  $$('[data-speed]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.speed === SIM.speed));
  const d = $('#demoTag'); if (d) d.textContent = SIM.speed === 1 ? 'CANLI SAAT · DEMO VERİ' : `HIZLI DEMO ×${SIM.speed}`;
  const l = $('#clockLbl'); if (l) l.textContent = SIM.speed === 1 ? 'TESİS SAATİ' : `DEMO SAATİ ×${SIM.speed}`;
}
let lastTick = 0;
function tick(force) {
  const T = SIM.T();
  const c = $('#clock');
  if (c) { const m = mod(T, 1440); c.textContent = `${pad(Math.floor(m / 60))}:${pad(Math.floor(m % 60))}:${pad(Math.floor((m * 60) % 60))}`; }
  if (window.onTick) window.onTick(T, force === true);
}
document.addEventListener('DOMContentLoaded', () => {
  $$('[data-speed]').forEach(b => b.addEventListener('click', () => simSet(+b.dataset.speed)));
  const tb = $('#themeBtn');
  if (tb) tb.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  syncChrome();
  if (window.onInit) window.onInit(SIM.T());
  tick(true);
  setInterval(tick, 250);
});

/* ---------- tiny SVG line chart (string out, sized by viewBox) ---------- */
function lineChart(o) {
  const W = o.w || 640, H = o.h || 220, m = { l: 44, r: o.y2 ? 44 : 14, t: 14, b: 26, ...(o.m || {}) };
  const X = x => m.l + (x - o.x[0]) / (o.x[1] - o.x[0]) * (W - m.l - m.r);
  const Y = (y, ax) => { const r = ax === 2 ? o.y2 : o.y; return H - m.b - (y - r[0]) / (r[1] - r[0]) * (H - m.t - m.b); };
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.label || ''}" style="display:block;width:100%;height:auto">`;
  for (const z of o.zones || []) s += `<rect x="${X(z.x0)}" y="${m.t}" width="${Math.max(0, X(z.x1) - X(z.x0))}" height="${H - m.t - m.b}" fill="${z.fill || 'var(--panel-2)'}"/>` + (z.label ? `<text x="${(X(z.x0) + X(z.x1)) / 2}" y="${m.t + 12}" text-anchor="middle" font-size="11" fill="var(--muted)" font-weight="600">${z.label}</text>` : '');
  for (const b of o.bands || []) s += `<rect x="${m.l}" y="${Y(b.y1, b.ax)}" width="${W - m.l - m.r}" height="${Y(b.y0, b.ax) - Y(b.y1, b.ax)}" fill="${b.fill}" opacity="${b.op ?? .14}"/>`;
  for (const t of o.yTicks || []) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line-2)"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${t}</text>`;
  for (const t of o.y2Ticks || []) s += `<text x="${W - m.r + 6}" y="${Y(t, 2) + 4}" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${t}</text>`;
  for (const t of o.xTicks || []) s += `<text x="${X(t.x ?? t)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${t.l ?? t}</text>`;
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="var(--line)"/>`;
  for (const se of o.series) {
    if (!se.pts.length) continue;
    const d = se.pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1], se.ax).toFixed(1)).join('');
    if (se.area) s += `<path d="${d}L${X(se.pts[se.pts.length - 1][0])} ${H - m.b}L${X(se.pts[0][0])} ${H - m.b}Z" fill="${se.color}" opacity=".12"/>`;
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.width || 2}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  if (o.marker != null) s += `<line x1="${X(o.marker)}" x2="${X(o.marker)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="3 3"/>`;
  for (const d of o.dots || []) s += `<circle cx="${X(d[0])}" cy="${Y(d[1], d.ax)}" r="5" fill="${d.color || 'var(--accent)'}" stroke="var(--panel)" stroke-width="2"/>`;
  return s + '</svg>';
}
