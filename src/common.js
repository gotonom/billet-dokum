/* Plant model shared by every panel. Each unit's state is a pure function of plant time T
   (minutes since today's 00:00 wall clock), so the control centre and the detail pages always agree.
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
  DIA: 178, LEN: 7000,
  CROP_BUTT: 300,        // start end (on the starting head): start-up structure is cut off
  CROP_HEAD: 200,        // last end cast
  T_PER_M: Math.PI * 0.089 * 0.089 * 2.70,   // t per metre of Ø178 billet
  E_CYCLE: 288, H_CYCLE: 720, H_COUNT: 5,
  // casting table, minutes into the cast cycle
  PREP_END: 25, CAST_START: 40, UNLOAD_END: 138, FILL_END: 18,
  POST_WATER: 8,         // water stays on after the metal stops: 6 min full, 2 min taper
  TILT_MIN: 6,           // table tilts away before the crane lifts the logs
  // after homogenising: forced cooling, then an ambient buffer until the logs are cool enough for UT
  COOL_MIN: 60, BUFFER_MIN: 240, SAW_MIN: 100,
  // metal accounting per cast (t)
  HEEL_E: 4, HEEL_B: 3, LAUNDER: .45, B1_SKIM: .12,
  // burners at full fire (Nm³/h): regenerative melters, B1, homogenisers
  GAS_E: 750, GAS_B: 160, GAS_H: 260,
  HEEL_DRAIN: .5,        // heel left after draining into sows before an alloy change
  // casting-water interlock: alarm and trip as a share of setpoint, absolute floor per mould
  W_ALARM: .90, W_TRIP: .80, W_MIN: 35,
  H2_START: .30,         // B1 furnace H₂ (Alspek) above this blocks the start
  MG_FADE: .01,          // Mg lost in B1 fluxing and holding; the melter aims this much higher
  SLOTS: ['6063', '6063', '6060', '6063', '6082', '6063', '6063', '6060', '6063', '6063'],
  ALLOYS: {
    '6063': { v: 123, color: '--a6063', temp: 695, soak: [575, 585, 580], airMax: 600, spec: { Si: [.20, .60, .43], Fe: [0, .35, .20], Cu: [0, .10, .02], Mn: [0, .10, .03], Mg: [.45, .90, .50], Cr: [0, .10, .01], Zn: [0, .10, .02], Ti: [0, .10, .02] } },
    '6060': { v: 128, color: '--a6060', temp: 692, soak: [575, 585, 580], airMax: 600, spec: { Si: [.30, .60, .42], Fe: [.10, .30, .19], Cu: [0, .10, .02], Mn: [0, .10, .03], Mg: [.35, .60, .46], Cr: [0, .05, .01], Zn: [0, .15, .02], Ti: [0, .10, .02] } },
    // 6082 starts melting near 580 °C: soak lower and never let the air run hot
    '6082': { v: 105, color: '--a6082', temp: 700, soak: [550, 565, 560], airMax: 575, spec: { Si: [.70, 1.30, 1.00], Fe: [0, .50, .24], Cu: [0, .10, .04], Mn: [.40, 1.00, .55], Mg: [.60, 1.20, .78], Cr: [0, .25, .04], Zn: [0, .20, .02], Ti: [0, .10, .02] } },
  },
};
PLANT.LOG_T = PLANT.T_PER_M * PLANT.LEN / 1000;
PLANT.NET_M = (PLANT.LEN - PLANT.CROP_BUTT - PLANT.CROP_HEAD) / 1000;
PLANT.COOL_AT = PLANT.UNLOAD_END + 640;             // homogeniser unloads 640 min after loading
PLANT.BUF_AT = PLANT.COOL_AT + PLANT.COOL_MIN;
PLANT.SAW_AT = PLANT.BUF_AT + PLANT.BUFFER_MIN;
const alloyColor = a => `var(${PLANT.ALLOYS[a].color})`;
const mouldName = i => 'K-' + pad(i + 1);

/* ---------- casting recipe: speed by cast length, integrated once per alloy ---------- */
function vTarget(L, vs) {
  if (L < 20) return 50;
  if (L < 250) return 50 + (vs - 50) * (L - 20) / 230;
  if (L < 6850) return vs;
  return vs - (vs - 80) * clamp((L - 6850) / 150, 0, 1);
}
function wTarget(v, vs) { return 45 + 65 * clamp((v - 50) / (vs - 50), 0, 1); }  // l/min per mould
const PROFILES = {};
function profile(alloy) {
  if (PROFILES[alloy]) return PROFILES[alloy];
  const vs = PLANT.ALLOYS[alloy].v, Ls = [0], dt = 1 / 60;   // 1 s steps
  const FILL = .5;                                              // metal fills, platen waits 30 s
  let L = 0, t = 0, tRamp = 0;
  for (let i = 0; i < 30; i++) Ls.push(0);
  t = FILL;
  while (L < PLANT.LEN) {
    L = Math.min(PLANT.LEN, L + vTarget(L, vs) * dt); t += dt; Ls.push(L);
    if (!tRamp && L >= 250) tRamp = t;
  }
  return PROFILES[alloy] = { vs, Ls, FILL, tRamp, tEnd: t, tTaper: t + PLANT.POST_WATER };
}
function lengthAt(p, tc) { if (tc <= 0) return 0; const i = tc * 60; if (i >= p.Ls.length - 1) return PLANT.LEN; const a = Math.floor(i); return lerp(p.Ls[a], p.Ls[a + 1], i - a); }

/* ---------- alloy correction: what to add to bring a sample back to target ---------- */
// f = element fraction in the additive, y = recovery into the melt (rest oxidises into the dross)
const ADDITIVES = {
  Si: { name: 'Silisyum metal (topak, %98,5)', f: .985, y: .92, how: 'karıştırarak 15–20 dk çözündürülür' },
  Mg: { name: 'Saf magnezyum külçe (%99,8)', f: .998, y: .90, how: 'en son, çan ile banyo altına daldırılır' },
  Mn: { name: 'Mn tablet (%75 Mn)', f: .75, y: .95, how: 'karıştırarak 20 dk' },
  Cu: { name: 'AlCu50 ön alaşım', f: .50, y: .98, how: 'karıştırarak 10 dk' },
  Fe: { name: 'Fe tablet (%75 Fe)', f: .75, y: .95, how: 'karıştırarak 20 dk', minOnly: true },   // Fe follows the scrap mix; added only below spec min
};
const ADD_ORDER = ['Si', 'Fe', 'Mn', 'Cu', 'Mg'];        // Mg last: it burns off if added early
const chemTol = (lo, hi) => Math.max(.015, (hi - lo) * .05);   // internal window around target
const addable = el => !!ADDITIVES[el] && !ADDITIVES[el].minOnly;
function solveLinear(A, b) {                             // Gaussian elimination, small n
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
// chem in wt %, M melt mass in kg, aim = optional per-element furnace aim (defaults to the spec target).
// Elements below their window are raised to the aim; additions dilute each other, so the amounts are
// solved together. Nothing can take an element out: above the spec maximum the only fix is diluting
// with primary metal, after which the alloying elements are re-solved.
function correction(alloy, chem, M, aim = {}, nested) {
  const spec = PLANT.ALLOYS[alloy].spec, S = [], high = [], over = [], tgt = {};
  for (const [el, [lo, hi, tg]] of Object.entries(spec)) {
    const c = chem[el], tol = chemTol(lo, hi), t = tgt[el] = aim[el] ?? tg;
    if (c == null || isNaN(c)) continue;
    if (c > hi) high.push({ el, c, hi, goal: lo > 0 ? t + tol : hi - tol });
    else if (lo > 0 && ADDITIVES[el] && (ADDITIVES[el].minOnly ? c < lo : c < t - tol)) S.push(el);
    else if (lo > 0 && addable(el) && c > t + tol) over.push(el);
  }
  S.sort((a, b) => ADD_ORDER.indexOf(a) - ADD_ORDER.indexOf(b));
  const A = S.map((ei, i) => S.map((ej, j) => (i === j ? ADDITIVES[ei].y * ADDITIVES[ei].f * 100 : 0) - tgt[ei]));
  const x = S.length ? solveLinear(A, S.map(e => M * (tgt[e] - chem[e]))) : [];
  const adds = S.map((el, i) => ({ el, kg: x[i], from: chem[el], to: tgt[el], ...ADDITIVES[el] }));
  const total = adds.reduce((s, a) => s + a.kg, 0), M2 = M + total, final = {};
  for (const el in spec) { const a = adds.find(q => q.el === el); final[el] = (M * chem[el] + (a ? a.kg * a.y * a.f * 100 : 0)) / M2; }
  // dilution: the worst offender sets the primary needed, then the rest is corrected on the diluted melt
  let dilute = null;
  if (high.length && !nested) {
    const D = Math.max(...high.map(h => M * (h.c / h.goal - 1)));
    const dil = {}; for (const el in chem) dil[el] = chem[el] * M / (M + D);
    dilute = { primer: D, after: correction(alloy, dil, M + D, aim, true) };
  }
  return { adds, total, final, high, over, M, aim: tgt, dilute };
}
// does this melt fit an alloy's spec, counting elements that could still be raised by additions?
function fitsAlloy(alloy, chem) {
  return Object.entries(PLANT.ALLOYS[alloy].spec).every(([el, [lo, hi]]) => chem[el] <= hi && (chem[el] >= lo || addable(el)));
}

/* ---------- wall clock: minutes since today's 00:00, safe across midnight and DST ---------- */
const DAY0 = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const dayIndex = ms => { const d = new Date(ms); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); };
function wallT(ms = Date.now()) {
  const d = new Date(ms);
  return (dayIndex(ms) - dayIndex(DAY0)) * 1440 + d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 6e4;
}
function plantDate(T) { const d = new Date(DAY0); d.setMinutes(Math.floor(T)); return d; }

/* ---------- burner profiles (shared by the live units and the gas accounting) ---------- */
const MELT_DEFS = [['ŞARJ', 0, 30], ['ERGİTME', 30, 190], ['ALAŞIM', 190, 222], ['NUMUNE', 222, 250], ['HAZIR', 250, 270], ['TRANSFER', 270, 288]];
const meltBurn = L => L < 30 ? 20 : L < 150 ? 100 : L < 190 ? 70 : L < 222 ? 35 : L < 250 ? 25 : L < 270 ? 20 : 10;
const HOMO_DEFS = [['YÜKLEME', 0, 20], ['ISITMA', 20, 260], ['BEKLETME', 260, 620], ['BOŞALTMA', 620, 640], ['BOŞ', 640, 720]];
const homoBurn = L => L < 20 ? 0 : L < 260 ? 100 - 65 * smooth((L - 20) / 240) : L < 620 ? 10 : L < 640 ? 0 : 6;
const holdBurn = (c, castEnd) => c < 18 ? 25 : c < 40 ? 45 : c < castEnd ? 30 : 15;
// Nm³ of gas one cast uses in each unit (each cast gets one melter cycle, one B1 cycle, one homogeniser cycle)
const GAS = (() => {
  let e = 0, h = 0, b = 0;
  for (let L = 0; L < 288; L += .5) e += meltBurn(L) / 100 * PLANT.GAS_E / 120;
  for (let L = 0; L < 720; L += .5) h += homoBurn(L) / 100 * PLANT.GAS_H / 120;
  for (let c = 0; c < 144; c += .5) b += holdBurn(c, 100) / 100 * PLANT.GAS_B / 120;
  return { e, h, b, total: e + h + b };
})();

/* ---------- per-cast facts (memoised) ---------- */
const CASTS = new Map();
const alloyOf = n => PLANT.SLOTS[mod(n, PLANT.PER_DAY)];
// alloy change: drain a furnace's heel into sows when the old metal would push an element of the new
// alloy more than half its window (e.g. 6082 → 6063 carries Si, Mg and Mn over)
function needsDrain(prev, next, heelShare) {
  if (prev === next) return false;
  const a = PLANT.ALLOYS[prev].spec, b = PLANT.ALLOYS[next].spec;
  return Object.keys(b).some(el => heelShare * (a[el][2] - b[el][2]) > chemTol(b[el][0], b[el][1]) / 2);
}
function castInfo(n) {
  if (CASTS.has(n)) return CASTS.get(n);
  const slot = mod(n, PLANT.PER_DAY), date = plantDate(n * PLANT.CYCLE);
  const alloy = alloyOf(n), a = PLANT.ALLOYS[alloy], spec = a.spec;
  const closed = [];
  if (rnd(n, 1) < .45) closed.push(Math.floor(rnd(n, 2) * PLANT.MOULDS));
  if (rnd(n, 3) < .15) { const j = Math.floor(rnd(n, 4) * PLANT.MOULDS); if (!closed.includes(j)) closed.push(j); }
  const logs = PLANT.MOULDS - closed.length;
  const utRej = rnd(n, 5) < .18 ? 1 : 0;
  const dross = 15 + rnd(n, 6) * 8;                         // kg per tonne charged
  const gross = logs * PLANT.LOG_T * (1 + (rnd(n, 7) - .5) * .004);
  const net = (logs - utRej) * PLANT.T_PER_M * PLANT.NET_M;
  // previous metal left in each furnace: the melter last made cast n-2, B1 cast n-1
  const prevE = alloyOf(n - 2), prevB = alloyOf(n - 1);
  const drainE = needsDrain(prevE, alloy, PLANT.HEEL_E / (PLANT.HEEL_E + 32)), drainB = needsDrain(prevB, alloy, PLANT.HEEL_B / (PLANT.HEEL_B + 32));
  const heelEt = drainE ? PLANT.HEEL_DRAIN : PLANT.HEEL_E, heelBt = drainB ? PLANT.HEEL_DRAIN : PLANT.HEEL_B;
  const heelE = PLANT.ALLOYS[prevE].spec, heelB = PLANT.ALLOYS[prevB].spec;
  // mass balance: B1 ends every cast on its normal heel, the melter every transfer on its normal heel
  const transfer = gross + PLANT.LAUNDER + PLANT.B1_SKIM + (PLANT.HEEL_B - heelBt);
  const drossW = dross * transfer / 1000;
  // chemistry: charge scatter (scrap mix varies, more often low) mixed with the melter heel = first sample.
  // The melter aims so that, after mixing with B1's heel and the Mg fade, B1 lands on target.
  const chem1 = {}, aim = {};
  for (const [el, [lo, hi, tg]] of Object.entries(spec)) {
    const r = rnd(n, 20 + el.charCodeAt(0) + el.charCodeAt(1));
    const chg = lo > 0 && addable(el) ? tg + (r - .62) * (hi - lo) * .22 : tg + (r - .5) * Math.max(.01, (hi - lo) * .06);
    chem1[el] = +((heelEt * heelE[el][2] + 32 * chg) / (heelEt + 32)).toFixed(3);
    if (lo > 0 && addable(el)) aim[el] = +(((heelBt + transfer) * (tg + (el === 'Mg' ? PLANT.MG_FADE : 0)) - heelBt * heelB[el][2]) / transfer).toFixed(3);
  }
  const recipe = correction(alloy, chem1, (PLANT.HEEL_E + transfer + drossW) * 1000, aim), corr = recipe.adds.length > 0;
  const chem = {}, b1chem = {};
  for (const el in chem1) {
    chem[el] = +(recipe.final[el] + (corr && recipe.adds.some(x => x.el === el) ? (rnd(n, 40 + el.charCodeAt(0)) - .5) * .008 : 0)).toFixed(3);
    b1chem[el] = +((heelBt * heelB[el][2] + transfer * chem[el]) / (heelBt + transfer) - (el === 'Mg' ? PLANT.MG_FADE : 0) + (rnd(n, 60 + el.charCodeAt(0)) - .5) * .004).toFixed(3);
  }
  const primer = 34 + rnd(n, 10) * 16, ic = 20 + rnd(n, 11) * 8;
  const info = {
    n, slot, id: `D-${pad(date.getDate())}${pad(date.getMonth() + 1)}-${pad(slot + 1)}`, date, alloy, prof: profile(alloy),
    closed, logs, utRej, dross, gross, net, transfer, drossW, charge: transfer + drossW - recipe.total / 1000 + (PLANT.HEEL_E - heelEt),
    drainE, drainB, heelEt, heelBt, sows: (PLANT.HEEL_E - heelEt) + (PLANT.HEEL_B - heelBt),
    castYield: net / gross * 100, meltLoss: (drossW + PLANT.B1_SKIM) / (transfer + drossW) * 100,
    h2In: .22 + rnd(n, 12) * .08, h2Out: .10 + rnd(n, 13) * .04, grain: 105 + rnd(n, 14) * 35,
    limca: 4 + rnd(n, 19) * 6,                                // inclusions after the filter, k/kg N20
    corr, chem, chem1, aim, recipe, b1chem, heelAlloyB: prevB, heelAlloyE: prevE,
    mix: { primer, ic, dis: 100 - primer - ic },
    start: n * PLANT.CYCLE + PLANT.CAST_START,
  };
  info.gas = GAS.total / gross;                               // Nm³ per tonne cast
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
    ['DÖKÜM', cs + p.tRamp, cs + p.tEnd], ['BİTİŞ', cs + p.tEnd, cs + p.tTaper], ['BOŞALTMA', cs + p.tTaper, PLANT.UNLOAD_END]];
  const phases = mkPhases(bounds, n * C), pi = phaseOf(bounds.map(b => [b[1], b[2]]), c);
  const tc = c - cs, metal = pi === 2 || pi === 3;
  const L = pi < 2 ? 0 : lengthAt(p, tc);
  const vT = metal && tc > p.FILL ? vTarget(L, p.vs) : 0;
  const v = vT ? vT * (1 + wob(T, 1) * .012) : 0;
  let wT = 0;
  if (metal) wT = tc < p.FILL ? 45 : wTarget(vT, p.vs);
  else if (pi === 4) wT = wTarget(80, p.vs) * clamp((PLANT.POST_WATER - (tc - p.tEnd)) / 2, 0, 1);   // full 6 min, taper 2
  const w = wT ? wT * (1 + wob(T, 2) * .015) : 0;
  const logs = cast.logs;
  const unloadT = c - (cs + p.tTaper), unloadLen = PLANT.UNLOAD_END - cs - p.tTaper;
  const tilt = pi === 5 ? smooth(unloadT / PLANT.TILT_MIN) : 0;
  const unload = pi === 5 ? clamp((unloadT - PLANT.TILT_MIN) / (unloadLen - PLANT.TILT_MIN - 1), 0, 1) : 0;   // crane, done 1 min early
  return {
    n, cast, c, phase: TABLE_PHASES[pi], pi, phases, L, v, vT, w, wT, logs, metal, tilt, unload,
    progress: L / PLANT.LEN,
    tons: L / 1000 * PLANT.T_PER_M * logs,
    water: w * logs * 60 / 1000,                              // m³/h
    waterIn: 24 + wob(T, 3) * .6,
    waterOut: w ? 24 + 14 * (metal ? v / p.vs : clamp(1 - (tc - p.tEnd) / PLANT.POST_WATER, 0, 1) * .6) + wob(T, 4) * .5 : null,
    pitTemp: 30 + (metal ? 4 * (L / PLANT.LEN) : 0) + wob(T, 17) * .4,
    launder: metal ? a.temp + wob(T, 5) * 2.2 : null,
    level: metal ? 75 + wob(T, 6) * 1.6 : 0,                  // mm metal head in the hot-top
    h2Out: metal ? cast.h2Out + wob(T, 7) * .004 : null,
    rotor: metal ? 380 + wob(T, 9) * 6 : (pi === 1 ? 120 : 0), argon: metal ? 42 + wob(T, 10) * 1.5 : 0,
    rod: metal ? .8 + wob(T, 11) * .03 : 0,                   // kg/t AlTi5B1
    filterDp: metal ? 14 + 10 * clamp(tc / p.tEnd, 0, 1) + wob(T, 12) * .8 : 0,   // mm metal head across the CFF
    air: metal ? 1.6 + wob(T, 13) * .05 : 0,                  // Nl/min per mould
    oil: metal ? .5 + wob(T, 14) * .02 : 0,                   // ml/min per mould
    pit: 1.15 + wob(T, 15) * .01,                             // m standing water
    tank: 96 + wob(T, 18) * .5,                               // emergency gravity tank, %
    ph: 7.6 + wob(T, 19) * .05, cond: 410 + wob(T, 20) * 8,   // casting-water quality
    hyd: 18 + (pi === 5 && unload > 0 ? 6 : 0) + wob(T, 16) * .3,
  };
}

/* ---------- melting furnaces E1, E2 ---------- */
function melter(k, T) {
  const L = mod(T + (k === 0 ? 270 : 126), PLANT.E_CYCLE), n = Math.round((T - L + 270) / PLANT.CYCLE), cast = castInfo(n);
  const pi = phaseOf(MELT_DEFS.map(d => [d[1], d[2]]), L), phases = mkPhases(MELT_DEFS, T - L);
  const heel = cast.heelEt, charge = cast.charge, s = clamp((L - 30) / 160, 0, 1), drain = cast.drainE && L < 5;
  // OES result comes 6 min after each sample; additions go in right after the first result
  const sample1 = phases[3].start + 2, corrAt = sample1 + 7, sample2 = corrAt + 14;
  const full = heel + charge, skim = L >= 216 ? cast.drossW : 0, added = T >= corrAt ? cast.recipe.total / 1000 : 0;
  let temp, mass, liq;
  if (pi === 0) {   // a drained furnace first taps its old heel into sows (5 min), then charges
    const c0 = cast.drainE ? 5 : 0;
    temp = lerp(718, 682, L / 30); mass = drain ? lerp(PLANT.HEEL_E, heel, L / 5) : heel + charge * smooth((L - c0) / (30 - c0)); liq = (drain ? mass : heel) / mass;
  }
  else if (pi === 1) { temp = 672 + 83 * Math.pow(s, 2.2); mass = full; liq = (heel + charge * smooth(s * 1.08)) / mass; }
  else if (pi === 2) { temp = lerp(755, 748, (L - 190) / 32); mass = full - skim; liq = 1; }
  else if (pi === 3) { temp = lerp(748, 742, (L - 222) / 28); mass = full - skim + added; liq = 1; }
  else if (pi === 4) { temp = lerp(742, 738, (L - 250) / 20); mass = full - skim + added; liq = 1; }
  else { temp = lerp(738, 732, (L - 270) / 18); mass = full - skim + added - cast.transfer * (L - 270) / 18; liq = 1; }
  temp += wob(T, 30 + k) * 1.4;
  const burn = meltBurn(L);
  const chemOk = cast.corr ? T >= sample2 + 6 : T >= sample1 + 6;
  return {
    k, name: 'E' + (k + 1), L, n, cast, phase: MELT_DEFS[pi][0], pi, phases, temp, mass, liq, burn,
    gas: burn / 100 * PLANT.GAS_E * (1 + wob(T, 32 + k) * .02),
    roof: pi === 1 ? 1060 + 80 * (burn / 100) + wob(T, 34 + k) * 8 : 880 + burn * 2 + wob(T, 34 + k) * 6,
    stir: pi === 2, door: pi === 0 && !drain, drain, skimmed: L >= 216, sample1, corrAt, sample2, chemOk,
    pressure: pi === 0 ? 0 : 8 + wob(T, 36 + k) * 1.5,       // Pa
  };
}

/* ---------- holding / casting furnace B1 ---------- */
// ARITMA: argon lance + flux 18–26, skim 26, release sample 27 (result 33), settle until the cast at 40
const HOLD_DEFS = [['DOLUM', 0, 18], ['ARITMA', 18, 40], ['DÖKÜM', 40, null], ['BEKLEME', null, 144]];
const B1_SAMPLE = 27, B1_RESULT = 33;
function holder(T) {
  const n = Math.floor(T / PLANT.CYCLE), c = T - n * PLANT.CYCLE, cast = castInfo(n), p = cast.prof;
  const castEnd = PLANT.CAST_START + p.tEnd;
  const defs = HOLD_DEFS.map(d => [d[0], d[1] ?? castEnd, d[2] ?? castEnd]);
  const pi = phaseOf(defs.map(d => [d[1], d[2]]), c), phases = mkPhases(defs, n * PLANT.CYCLE);
  const frac = pi === 2 ? lengthAt(p, c - PLANT.CAST_START) / PLANT.LEN : (pi === 3 ? 1 : 0);
  const out = cast.gross + PLANT.LAUNDER, poured = frac * cast.gross;
  const heel = cast.heelBt, full = heel + cast.transfer, skim = c >= 26 ? PLANT.B1_SKIM : 0;
  // before an alloy change B1 taps its heel into sows at the end of the wait (8 min from c = 130)
  const next = castInfo(n + 1), drain = pi === 3 && next.drainB && c >= 130;
  let mass = pi === 0 ? heel + cast.transfer * smooth(c / 18) : full - skim - frac * out;
  if (drain) mass = lerp(PLANT.HEEL_B, PLANT.HEEL_DRAIN, clamp((c - 130) / 8, 0, 1));
  const temp = (pi === 0 ? lerp(722, 730, c / 18) : pi === 1 ? lerp(730, 736, (c - 18) / 22) : pi === 2 ? lerp(736, 731, (c - 40) / p.tEnd) : 722) + wob(T, 40) * 1.2;
  return {
    name: 'B1', n, cast, c, phase: defs[pi][0], pi, phases, mass, temp, poured,
    tilt: pi === 2 ? 2 + 22 * frac : 0, burn: holdBurn(c, castEnd), lance: c >= 18 && c < 26,
    h2: cast.h2In + wob(T, 41) * .004,                       // Alspek in the furnace
    sampleAt: phases[0].start + B1_SAMPLE, chemOk: c >= B1_RESULT,
    alloyChange: cast.heelAlloyB !== cast.alloy, drain, nextAlloy: next.alloy,
  };
}

/* ---------- homogenising furnaces H1–H5, cooling chamber, buffer, saw ---------- */
function homoTemp(L, alloy) {   // [air, metal] °C at local time L, per alloy recipe
  const { soak: [, , st], airMax } = PLANT.ALLOYS[alloy];
  if (L < 20) return [lerp(520, 470, L / 20), 60];
  if (L < 260) { const x = L - 20; return [airMax - (airMax - 470) * Math.exp(-x / 22) - (airMax - st - 5) * smooth((x - 120) / 120), st - (st - 60) * Math.exp(-x / 48)]; }
  if (L < 620) return [st + 5, st];
  if (L < 640) return [lerp(st + 4, 525, (L - 620) / 20), st - 1];
  return [520, null];
}
function soakFrom(alloy) { const [lo, , st] = PLANT.ALLOYS[alloy].soak; return 20 + 48 * Math.log((st - 60) / (st - lo)); }   // metal enters the soak window
function homog(k, T) {
  const L = mod(T - PLANT.UNLOAD_END - k * PLANT.CYCLE, PLANT.H_CYCLE), n = Math.round((T - L - PLANT.UNLOAD_END) / PLANT.CYCLE);
  const pi = phaseOf(HOMO_DEFS.map(d => [d[1], d[2]]), L), phases = mkPhases(HOMO_DEFS, T - L);
  const cast = pi === 4 ? null : castInfo(n), alloy = cast ? cast.alloy : alloyOf(n + PLANT.H_COUNT);
  let [air, metal] = homoTemp(L, alloy);
  air += wob(T, 50 + k) * 1.5; if (metal != null) metal += wob(T, 55 + k) * (L > 260 ? .8 : 1.2);
  const sf = soakFrom(alloy), soak = clamp(L - sf, 0, 620 - sf);
  const burn = homoBurn(L);
  return { k, name: 'H' + (k + 1), L, n: cast ? n : null, cast, alloy, recipe: PLANT.ALLOYS[alloy].soak, airMax: PLANT.ALLOYS[alloy].airMax, phase: HOMO_DEFS[pi][0], pi, phases, air, metal, soak, soakNeed: 360, burn, gas: burn / 100 * PLANT.GAS_H };
}
function homoCurve(L, alloy) { return homoTemp(L, alloy); }
// β → α estimate from the soak the PLC logged (first-order kinetics, as-cast ≈ 30 % α).
// Rate constants per hour are VARSAYIM: 6063 reaches ~92 % after 6 h at 580 °C; Mn makes 6082 fast.
const ALPHA_K = { '6063': .35, '6060': .33, '6082': .8 };
function alphaEstimate(alloy, soakMin) { return 30 + 70 * (1 - Math.exp(-ALPHA_K[alloy] * Math.max(0, soakMin) / 60)); }
function cooler(T) {
  const n = Math.floor((T - PLANT.COOL_AT) / PLANT.CYCLE), t = T - (n * PLANT.CYCLE + PLANT.COOL_AT);
  const cast = castInfo(n), st = PLANT.ALLOYS[cast.alloy].soak[2];
  const curve = x => 25 + (st - 25) * Math.exp(-x / 55);
  const avgRate = (st - 250) / (55 * Math.log((st - 25) / 225)) * 60;
  if (t >= PLANT.COOL_MIN) return { active: false, n, cast, next: (n + 1) * PLANT.CYCLE + PLANT.COOL_AT, avgRate, curve };
  return { active: true, n, cast, t, temp: curve(t) + wob(T, 60) * .8, rate: (st - 25) / 55 * Math.exp(-t / 55) * 60, avgRate, curve, fans: 100 };
}
// ambient buffer between the cooler and UT: logs drift from ~210 °C to ≤ 60 °C
const bufferTemp = t => 25 + 186 * Math.exp(-t / 120);
function buffer(T) {
  const list = [];
  for (let n = Math.floor((T - PLANT.SAW_AT) / PLANT.CYCLE); n <= Math.floor((T - PLANT.BUF_AT) / PLANT.CYCLE); n++) {
    const t = T - (n * PLANT.CYCLE + PLANT.BUF_AT);
    if (t >= 0 && t < PLANT.BUFFER_MIN) list.push({ cast: castInfo(n), t, temp: bufferTemp(t), out: n * PLANT.CYCLE + PLANT.SAW_AT });
  }
  return list;
}
function saw(T) {
  const n = Math.floor((T - PLANT.SAW_AT) / PLANT.CYCLE), t = T - (n * PLANT.CYCLE + PLANT.SAW_AT), cast = castInfo(n);
  const logTemp = bufferTemp(PLANT.BUFFER_MIN) + wob(T, 61) * .6;
  if (t >= PLANT.SAW_MIN) return { active: false, n, cast, next: (n + 1) * PLANT.CYCLE + PLANT.SAW_AT, done: cast.logs, logTemp };
  const done = Math.floor(t / PLANT.SAW_MIN * cast.logs);
  return { active: true, n, cast, t, done, cur: Math.min(cast.logs, done + 1), rejIdx: cast.utRej ? Math.floor(cast.logs * rnd(n, 18)) : -1, logTemp };
}
// which mould a sawn log came from (closed moulds produce none) and its homogenising batch
function logTrace(cast, idx) {
  const moulds = [...Array(PLANT.MOULDS).keys()].filter(i => !cast.closed.includes(i));
  const m = moulds[Math.min(idx, moulds.length - 1)];
  return { id: `${cast.id}-${mouldName(m)}`, mould: mouldName(m), batch: 'H' + (mod(cast.n, PLANT.H_COUNT) + 1) };
}

/* ---------- lab results (microscope % α), kept in this browser until a lab backend exists ---------- */
const LAB_KEY = 'bd-lab-v1', LAB_IMG = 'bd-lab-img-';
function labAll() { try { return JSON.parse(localStorage.getItem(LAB_KEY) || '[]'); } catch (e) { return []; } }
function labSaveAll(list) { try { localStorage.setItem(LAB_KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }
// the result that speaks for a cast: newest approved, else newest still in review (rejected ones never count)
function labFor(castId, pos) {
  const r = labAll().filter(x => x.castId === castId && x.status !== 'reddedildi' && (!pos || x.pos === pos)).sort((a, b) => b.created - a.created);
  return r.find(x => x.status === 'onaylandı') || r[0] || null;
}

/* ---------- where each cast is on the plant floor ---------- */
const STAGES = [
  { key: 'firin', label: 'Ergitme', from: -270, to: PLANT.FILL_END },
  { key: 'dokum', label: 'Döküm', from: PLANT.FILL_END, to: PLANT.UNLOAD_END },
  { key: 'homo', label: 'Homojenizasyon', from: PLANT.UNLOAD_END, to: PLANT.COOL_AT },
  { key: 'sogut', label: 'Soğutma', from: PLANT.COOL_AT, to: PLANT.BUF_AT },
  { key: 'tampon', label: 'Soğuma tamponu', from: PLANT.BUF_AT, to: PLANT.SAW_AT },
  { key: 'testere', label: 'UT ve testere', from: PLANT.SAW_AT, to: PLANT.SAW_AT + PLANT.SAW_MIN },
];
PLANT.JOURNEY = STAGES[STAGES.length - 1].to - STAGES[0].from;   // minutes from charging to packed
function castStage(n, T) {
  const r = T - n * PLANT.CYCLE;
  for (let i = 0; i < STAGES.length; i++) if (r >= STAGES[i].from && r < STAGES[i].to) return { i, ...STAGES[i], p: (r - STAGES[i].from) / (STAGES[i].to - STAGES[i].from) };
  return r >= STAGES[STAGES.length - 1].to ? { i: STAGES.length, key: 'stok', label: 'Stok', p: 1 } : null;
}
// casts whose casting (incl. the water after it) has finished, newest first
function doneCasts(T, count = 10) {
  const out = []; let n = Math.floor((T - PLANT.CAST_START) / PLANT.CYCLE);
  while (out.length < count) { const c = castInfo(n); if (c.end <= T) out.push(c); n--; }
  return out;
}
const dayStart = T => Math.floor(T / 1440) * 1440;
// metal poured into the moulds since 00:00 (casts started today, the running one pro rata)
function pouredToday(T) {
  let s = 0;
  for (let n = Math.ceil((dayStart(T) - PLANT.CAST_START) / PLANT.CYCLE); n * PLANT.CYCLE + PLANT.CAST_START <= T; n++) {
    const c = castInfo(n); s += c.gross * lengthAt(c.prof, T - c.start) / PLANT.LEN;
  }
  return s;
}
// good billet that left the saw since 00:00, including logs already cut from the running batch
function shippedToday(T) {
  const fin = PLANT.SAW_AT + PLANT.SAW_MIN, by = {}; let total = 0, batches = 0;
  for (let n = Math.floor((dayStart(T) - fin) / PLANT.CYCLE); n * PLANT.CYCLE + PLANT.SAW_AT <= T; n++) {
    const c = castInfo(n), t0 = n * PLANT.CYCLE + PLANT.SAW_AT, end = t0 + PLANT.SAW_MIN;
    let logs;
    if (end <= T) { if (end < dayStart(T)) continue; logs = c.logs - c.utRej; batches++; }
    else { const s = saw(T); logs = Math.max(0, s.done - (s.rejIdx >= 0 && s.done > s.rejIdx ? 1 : 0)); }
    const t = logs * PLANT.T_PER_M * PLANT.NET_M; by[c.alloy] = (by[c.alloy] || 0) + t; total += t;
  }
  return { total, by, batches };
}
function avg(list, f) { return list.reduce((s, x) => s + f(x), 0) / list.length; }

/* ---------- simulated clock (live by default; ×10 / ×60 demo continues across pages) ---------- */
const SIM = { T0: wallT(), t0: Date.now(), speed: 1 };
try {
  const s = JSON.parse(sessionStorage.getItem('bd-sim') || 'null');
  // saved T is relative to the saving page's day; shift it onto this page's day
  if (s && s.speed > 1) Object.assign(SIM, s, { T0: s.T0 - (dayIndex(DAY0) - (s.day ?? dayIndex(DAY0))) * 1440 });
} catch (e) {}
SIM.T = () => SIM.T0 + (Date.now() - SIM.t0) / 60000 * SIM.speed;
function simSave() { try { sessionStorage.setItem('bd-sim', JSON.stringify({ T0: SIM.T0, t0: SIM.t0, speed: SIM.speed, day: dayIndex(DAY0) })); } catch (e) {} }
function simSet(speed, T) {
  if (speed === 1 && T == null) { SIM.T0 = wallT(); } else SIM.T0 = T ?? SIM.T();
  SIM.t0 = Date.now(); SIM.speed = speed; simSave(); syncChrome(); tick(true);
}
function simJump(T) { simSet(SIM.speed === 1 ? 10 : SIM.speed, T); }

// keep the running step visible when the step row scrolls sideways (phones)
function focusStep(ol) {
  const now = ol.querySelector('li.now');
  if (!now || ol._now === now || ol.scrollWidth <= ol.clientWidth) return;
  ol._now = now; ol.scrollTo({ left: Math.max(0, now.offsetLeft - ol.offsetLeft - 16), behavior: 'smooth' });
}
// heat colour for metal temperatures: cold steel → glowing orange, never through green
const heat = t => t == null ? 'var(--panel-2)' : `color-mix(in srgb, #f97316 ${Math.round(clamp((t - 40) / 540, 0, 1) * 100)}%, #cbd5e1)`;

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
// On a phone the chart is drawn on a narrower canvas, so its 11 px labels stay readable once scaled.
const narrowScreen = () => typeof innerWidth === 'number' && innerWidth <= 720;
function lineChart(o) {
  const narrow = narrowScreen(), W = narrow ? Math.min(o.w || 640, 380) : (o.w || 640), H = narrow ? Math.round((o.h || 220) * .85) : (o.h || 220);
  const m = { l: 40, r: o.y2 ? 36 : 12, t: 14, b: 26, ...(o.m || {}) };
  const X = x => m.l + (x - o.x[0]) / (o.x[1] - o.x[0]) * (W - m.l - m.r);
  const Y = (y, ax) => { const r = ax === 2 ? o.y2 : o.y; return H - m.b - (y - r[0]) / (r[1] - r[0]) * (H - m.t - m.b); };
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.label || ''}" style="display:block;width:100%;height:auto">`;
  for (const z of o.zones || []) s += `<rect x="${X(z.x0)}" y="${m.t}" width="${Math.max(0, X(z.x1) - X(z.x0))}" height="${H - m.t - m.b}" fill="${z.fill || 'var(--panel-2)'}"/>` + (z.label && X(z.x1) - X(z.x0) >= z.label.length * 6.2 ? `<text x="${(X(z.x0) + X(z.x1)) / 2}" y="${m.t + 12}" text-anchor="middle" font-size="11" fill="var(--muted)" font-weight="600">${z.label}</text>` : '');
  for (const b of o.bands || []) s += `<rect x="${m.l}" y="${Y(b.y1, b.ax)}" width="${W - m.l - m.r}" height="${Y(b.y0, b.ax) - Y(b.y1, b.ax)}" fill="${b.fill}" opacity="${b.op ?? .14}"/>`;
  for (const t of o.yTicks || []) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line-2)"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${t}</text>`;
  for (const t of o.y2Ticks || []) s += `<text x="${W - m.r + 6}" y="${Y(t, 2) + 4}" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${t}</text>`;
  const xt = o.xTicks || [], step = narrow && xt.length > 5 ? 2 : 1;   // thin out x labels on a phone
  xt.forEach((t, i) => { if (i % step === 0 || i === xt.length - 1) s += `<text x="${X(t.x ?? t)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === xt.length - 1 ? 'end' : 'middle'}" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${t.l ?? t}</text>`; });
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
