/* ══════════════════════════════════════════════════════
   PhotoChooser – Grading core (defaults, maths, looks)
   Mirrors grading.py – keep both in sync.
══════════════════════════════════════════════════════ */
(function () {
  const LUMA = [0.2126, 0.7152, 0.0722];
  const K = { lift: 0.25, gamma: 0.5, gain: 0.5, offset: 0.25 };
  const CURVE_SAMPLES = 1024;
  const IDENTITY_CURVE = () => [[0, 0], [1, 1]];

  const defaultGrade = () => ({
    exposure: 0, temp: 0, tint: 0,
    contrast: 1, pivot: 0.435,
    shadows: 0, highlights: 0,
    sat: 50, hue: 50, boost: 0,
    lift:   { x: 0, y: 0, m: 0 },
    gamma:  { x: 0, y: 0, m: 0 },
    gain:   { x: 0, y: 0, m: 1 },
    offset: { x: 0, y: 0, m: 0 },
    curves: { y: IDENTITY_CURVE(), r: IDENTITY_CURVE(), g: IDENTITY_CURVE(), b: IDENTITY_CURVE() },
    lut: null, lut_mix: 1,
    clarity: 0, dehaze: 0,
    sharpen: 0,
    ai: 0,                // amount (0..100) of the learned per-photo LUT ("Couleur IA")
    locals: [],
  });

  // ── Local adjustments (zones) ─────────────────────────
  const MAX_LOCALS = 6, LOCAL_PIVOT = 0.435, CLARITY_GAIN = 1.5;
  // channel order of the AI mask stack (same as grading.MASK_NAMES)
  const MASK_NAMES = ["sky", "person", "vegetation", "water", "ground", "building", "foreground", "background"];
  const LOCAL_LABELS = { sky: "Ciel", person: "Personnes", vegetation: "Végétation", water: "Eau",
    ground: "Relief / sol", building: "Bâtiments", foreground: "Premier plan", background: "Arrière-plan", brush: "Pinceau" };
  const LOCAL_ADJ = ["exposure", "contrast", "shadows", "highlights", "temp", "tint", "sat", "clarity"];
  const defaultLocal = () => ({
    id: "", name: "", mask: "brush", invert: false, on: true, auto: false, amount: 100, paint: null,
    exposure: 0, contrast: 1, shadows: 0, highlights: 0, temp: 0, tint: 0, sat: 50, clarity: 0,
  });
  function localEffective(l) {
    const d = defaultLocal();
    return !!l.on && l.amount > 0.01 && LOCAL_ADJ.some(k => !close(l[k], d[k]));
  }
  const defaultGeo = () => ({ rot: 0, flip: false, angle: 0, crop: null, aspect: "free" });

  const clone = o => JSON.parse(JSON.stringify(o));

  function merge(base, over) {
    for (const [k, v] of Object.entries(over || {})) {
      if (base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) && v && typeof v === "object" && !Array.isArray(v))
        merge(base[k], v);
      else base[k] = clone(v);
    }
    return base;
  }

  function normalize(edits) {
    edits = edits || {};
    const grade = merge(defaultGrade(), edits.grade);
    grade.locals = (grade.locals || []).map(l => merge(defaultLocal(), l));
    return { grade, geo: merge(defaultGeo(), edits.geo) };
  }

  const close = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

  function curvesIdentity(c) {
    return ["y", "r", "g", "b"].every(k => {
      const p = c[k] || IDENTITY_CURVE();
      return p.length === 2 && close(p[0][0], 0) && close(p[0][1], 0) && close(p[1][0], 1) && close(p[1][1], 1);
    });
  }

  function gradeIdentity(g) {
    const d = defaultGrade();
    if ((g.locals || []).some(localEffective)) return false;
    for (const k of ["exposure", "temp", "tint", "contrast", "shadows", "highlights", "sat", "hue", "boost", "clarity", "dehaze", "ai", "sharpen"])
      if (!close(g[k], d[k])) return false;
    for (const w of ["lift", "gamma", "gain", "offset"])
      for (const c of ["x", "y", "m"]) if (!close(g[w][c], d[w][c])) return false;
    if (!curvesIdentity(g.curves)) return false;
    if (g.lut && g.lut_mix > 1e-4) return false;
    return true;
  }

  function geoIdentity(geo) {
    const c = geo.crop;
    const full = !c || (close(c.x, 0) && close(c.y, 0) && close(c.w, 1) && close(c.h, 1));
    return (geo.rot % 360) === 0 && !geo.flip && close(geo.angle, 0) && full;
  }

  // ── Colour maths ──────────────────────────────────────
  function wheelRGB(w, k) {
    const cb = w.x * k, cr = w.y * k;
    return [1.5748 * cr, -0.187324 * cb - 0.468124 * cr, 1.8556 * cb];
  }

  function wbGains(temp, tint, exposure) {
    const t = temp / 100, ti = tint / 100;
    const l = [0.5 * t + 0.2 * ti, -0.4 * ti, -0.5 * t + 0.2 * ti];
    const n = LUMA[0] * l[0] + LUMA[1] * l[1] + LUMA[2] * l[2];
    return l.map(v => Math.pow(2, v - n + exposure));
  }

  /** Values fed to the shader (same as grading.prepare) */
  function uniforms(g) {
    const off = wheelRGB(g.offset, K.offset).map(v => v + g.offset.m);
    const lift = wheelRGB(g.lift, K.lift).map(v => v + g.lift.m);
    const gain = wheelRGB(g.gain, K.gain).map(v => g.gain.m * (1 + v));
    const gexp = wheelRGB(g.gamma, K.gamma).map(v => Math.pow(4, -(g.gamma.m + v)));
    const hue = (g.hue - 50) / 50 * Math.PI;
    return {
      wb: wbGains(g.temp, g.tint, g.exposure),
      wbOn: !(close(g.temp, 0) && close(g.tint, 0) && close(g.exposure, 0)),
      offset: off, lift, gain, gexp,
      contrast: g.contrast, pivot: g.pivot,
      sh: g.shadows / 100 * 1.0, hl: g.highlights / 100 * 0.8,
      curvesOn: !curvesIdentity(g.curves),
      hueCos: Math.cos(hue), hueSin: Math.sin(hue),
      sat: g.sat / 50, boost: g.boost / 100,
      colorOn: !(close(g.hue, 50) && close(g.sat, 50) && close(g.boost, 0)),
      lutMix: g.lut_mix,
      clarity: g.clarity / 100 * CLARITY_GAIN,
      dehaze: g.dehaze / 100,
      ai: (g.ai || 0) / 100,
      sharpen: (g.sharpen || 0) / 100 * 2.0,
      // every layer keeps its slot (index) so brush paint textures line up
      locals: (g.locals || []).slice(0, MAX_LOCALS).map((l, i) => ({
        on: localEffective(l),
        mask: MASK_NAMES.indexOf(l.mask), invert: l.invert ? 1 : 0, paint: l.paint ? i : -1,
        amount: Math.min(l.amount, 100) / 100,
        wb: wbGains(l.temp, l.tint, l.exposure),
        wbOn: !(close(l.temp, 0) && close(l.tint, 0) && close(l.exposure, 0)),
        p: [l.contrast, l.shadows / 100, l.highlights / 100 * 0.8, l.sat / 50],
        clarity: l.clarity / 100 * CLARITY_GAIN,
      })),
    };
  }

  // ── Curves (Fritsch–Carlson monotone cubic) ───────────
  function makeSpline(points) {
    const pts = [...points].sort((a, b) => a[0] - b[0]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const n = xs.length;
    if (n < 2) return () => (ys[0] ?? 0);
    const d = [];
    for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / Math.max(xs[k + 1] - xs[k], 1e-9));
    const m = new Array(n).fill(0);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] > 0 ? (d[k - 1] + d[k]) / 2 : 0;
    for (let k = 0; k < n - 1; k++) {
      if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; }
      else {
        const a = m[k] / d[k], b = m[k + 1] / d[k], s = a * a + b * b;
        if (s > 9) { const t = 3 / Math.sqrt(s); m[k] = t * a * d[k]; m[k + 1] = t * b * d[k]; }
      }
    }
    return x => {
      if (x <= xs[0]) return clamp01(ys[0]);
      if (x >= xs[n - 1]) return clamp01(ys[n - 1]);
      let k = 0;
      while (k < n - 2 && x >= xs[k + 1]) k++;
      const h = Math.max(xs[k + 1] - xs[k], 1e-9);
      const t = Math.min(Math.max((x - xs[k]) / h, 0), 1), t2 = t * t, t3 = t2 * t;
      const y = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k]
              + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
      return clamp01(y);
    };
  }
  const clamp01 = v => Math.min(1, Math.max(0, v));

  /** RGBA Float32Array(1024*4): composite channel(Y(x)) */
  function buildCurveLut(curves) {
    const fy = makeSpline(curves.y || IDENTITY_CURVE());
    const fr = makeSpline(curves.r || IDENTITY_CURVE());
    const fg = makeSpline(curves.g || IDENTITY_CURVE());
    const fb = makeSpline(curves.b || IDENTITY_CURVE());
    const out = new Float32Array(CURVE_SAMPLES * 4);
    for (let i = 0; i < CURVE_SAMPLES; i++) {
      const y = fy(i / (CURVE_SAMPLES - 1));
      out[i * 4] = fr(y); out[i * 4 + 1] = fg(y); out[i * 4 + 2] = fb(y); out[i * 4 + 3] = 1;
    }
    return out;
  }

  // ── Geometry ──────────────────────────────────────────
  function straightenScale(w, h, rad) {
    const a = Math.abs(rad), c = Math.cos(a), s = Math.sin(a);
    return Math.min(w / (w * c + h * s), h / (w * s + h * c));
  }

  /** srcW/srcH: upright source size → sizes of every stage */
  function geometry(srcW, srcH, geo, ignoreCrop = false) {
    const rot = ((geo.rot % 360) + 360) % 360;
    const oriW = rot % 180 ? srcH : srcW, oriH = rot % 180 ? srcW : srcH;
    const rad = (geo.angle || 0) * Math.PI / 180;
    const s = Math.abs(geo.angle || 0) > 1e-3 ? straightenScale(oriW, oriH, rad) : 1;
    const crop = (!ignoreCrop && geo.crop) || { x: 0, y: 0, w: 1, h: 1 };
    const baseW = oriW * s, baseH = oriH * s;
    return { rot, oriW, oriH, rad, s, crop, baseW, baseH,
             outW: Math.max(1, Math.round(baseW * crop.w)), outH: Math.max(1, Math.round(baseH * crop.h)) };
  }

  // ── .cube parser ──────────────────────────────────────
  function parseCube(text) {
    let size = 0, min = [0, 0, 0], max = [1, 1, 1];
    const vals = [];
    for (let line of text.split(/\r?\n/)) {
      line = line.trim();
      if (!line || line[0] === "#") continue;
      const up = line.toUpperCase();
      if (up.startsWith("TITLE")) continue;
      if (up.startsWith("LUT_1D_SIZE")) throw new Error("LUT 1D non supportée");
      if (up.startsWith("LUT_3D_SIZE")) { size = parseInt(line.split(/\s+/)[1]); continue; }
      if (up.startsWith("DOMAIN_MIN")) { min = line.split(/\s+/).slice(1, 4).map(Number); continue; }
      if (up.startsWith("DOMAIN_MAX")) { max = line.split(/\s+/).slice(1, 4).map(Number); continue; }
      const p = line.split(/\s+/);
      if (p.length >= 3) {
        const a = +p[0], b = +p[1], c = +p[2];
        if (!isNaN(a) && !isNaN(b) && !isNaN(c)) vals.push(a, b, c);
      }
    }
    if (!size || vals.length < size ** 3 * 3) throw new Error("Fichier .cube invalide");
    return { size, data: new Float32Array(vals.slice(0, size ** 3 * 3)), min, max };
  }

  // ── Looks (creative presets) ──────────────────────────
  /** Unit (Cb, Cr) direction of an RGB colour — wheels & vectorscope share it */
  function hueDir(r, g, b) {
    const y = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
    const cb = (b - y) / 1.8556, cr = (r - y) / 1.5748, l = Math.hypot(cb, cr) || 1;
    return { x: cb / l, y: cr / l };
  }
  // m = wheel master: 0 is neutral for lift/gamma/offset, 1 for gain
  const W = (rgb, r, m = 0) => { const d = hueDir(...rgb); return { x: d.x * r, y: d.y * r, m }; };
  const TEAL = [0, 0.55, 0.6], ORANGE = [1, 0.55, 0.15], BLUE = [0.2, 0.4, 1], AMBER = [1, 0.7, 0.2], GREEN = [0.3, 1, 0.5];

  // A look replaces the creative part of the grade; WB/exposure/LUT are kept.
  const LOOKS = [
    { id: "natural", name: "Naturel +", grade: { contrast: 1.08, sat: 53, boost: 20 } },
    { id: "punch", name: "Vif", grade: { contrast: 1.15, pivot: 0.45, sat: 56, boost: 35, shadows: -8 } },
    { id: "teal_orange", name: "Teal & Orange", grade: {
        contrast: 1.12, sat: 54, boost: 10, lift: W(TEAL, 0.35, -0.01), gamma: W(TEAL, 0.08), gain: W(ORANGE, 0.22, 1) } },
    { id: "golden", name: "Golden hour", grade: {
        temp: 18, contrast: 1.06, sat: 54, boost: 18, highlights: -12, gain: W(AMBER, 0.2, 1), lift: W(ORANGE, 0.1, 0.01) } },
    { id: "film_warm", name: "Film chaud", grade: {
        temp: 10, sat: 46, gamma: W(ORANGE, 0.1), lift: W(TEAL, 0.15, 0.02),
        curves: { y: [[0, 0.05], [0.25, 0.23], [0.75, 0.8], [1, 0.96]] } } },
    { id: "nordic", name: "Froid nordique", grade: {
        temp: -18, contrast: 1.1, sat: 40, gain: W(BLUE, 0.1, 1), lift: W(BLUE, 0.12) } },
    { id: "matte", name: "Matte fade", grade: {
        sat: 44, contrast: 0.95, curves: { y: [[0, 0.09], [0.5, 0.5], [1, 0.94]] }, lift: W(GREEN, 0.08) } },
    { id: "bleach", name: "Bleach bypass", grade: { contrast: 1.35, pivot: 0.45, sat: 24, shadows: -10 } },
    { id: "bw", name: "N&B contrasté", grade: {
        sat: 0, contrast: 1.2, curves: { y: [[0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]] } } },
    { id: "bw_soft", name: "N&B doux", grade: { sat: 0, contrast: 0.92, lift: { x: 0, y: 0, m: 0.03 } } },
  ];

  // A style is layered on top of the corrections (auto, sliders…) and can be removed
  // again: grade.look remembers what it replaced.
  function addLook(g, look, sign) {
    const L = look.grade;
    if (L.contrast) g.contrast = sign > 0 ? g.contrast * L.contrast : g.contrast / L.contrast;
    for (const k of ["boost", "shadows", "highlights", "temp", "tint"])
      if (L[k]) g[k] = Math.max(-100, Math.min(100, g[k] + sign * L[k]));
    for (const w of ["lift", "gamma", "gain"]) {
      if (!L[w]) continue;
      g[w].x += sign * L[w].x; g[w].y += sign * L[w].y;
      g[w].m += sign * (L[w].m - (w === "gain" ? 1 : 0));
    }
  }

  function removeLook(g) {
    const st = g.look;
    if (!st) return g;
    const look = LOOKS.find(l => l.id === st.id);
    if (look) addLook(g, look, -1);
    if (st.prevSat != null) g.sat = st.prevSat;
    if (st.prevY) g.curves.y = st.prevY;
    delete g.look;
    return g;
  }

  /** Returns a new grade with the style applied (clicking the active style removes it). */
  function applyLook(grade, look) {
    const g = clone(grade), same = g.look && g.look.id === look.id;
    removeLook(g);
    if (same) return g;
    const L = look.grade;
    const st = { id: look.id, prevSat: g.sat, prevY: L.curves && L.curves.y ? clone(g.curves.y) : null };
    addLook(g, look, 1);
    if (L.sat != null) g.sat = g.sat * L.sat / 50;
    if (st.prevY) g.curves.y = clone(L.curves.y);
    g.look = st;
    return g;
  }

  /** Output uv (0..1, y down) → upright source uv. Mirror of the shader's geometry. */
  function outToSrc(u, v, geom, geo) {
    const bx = geom.crop.x + u * geom.crop.w, by = geom.crop.y + v * geom.crop.h;
    const qx = (bx - 0.5) * geom.oriW * geom.s, qy = (by - 0.5) * geom.oriH * geom.s;
    const cs = Math.cos(geom.rad), sn = Math.sin(geom.rad);
    let ox = (qx * cs - qy * sn) / geom.oriW + 0.5, oy = (qx * sn + qy * cs) / geom.oriH + 0.5;
    if (geo.flip) ox = 1 - ox;
    if (geom.rot === 90) return [oy, 1 - ox];
    if (geom.rot === 180) return [1 - ox, 1 - oy];
    if (geom.rot === 270) return [1 - oy, ox];
    return [ox, oy];
  }

  /** Grade usable on another photo: AI zones follow that photo's masks, brush paint does not travel. */
  function portableGrade(grade) {
    const g = clone(grade);
    delete g.auto_ref;      // belongs to the photo it was computed for
    g.locals = (g.locals || []).filter(l => l.mask !== "brush").map(l => ({ ...l, paint: null }));
    return g;
  }

  /** Merge a smart-auto result: its zones replace previous auto zones, user zones are kept. */
  function mergeAuto(grade, auto) {
    const a = clone(auto), zones = a.locals || [];
    delete a.locals;
    const keep = (grade.locals || []).filter(l => !l.auto);
    delete grade.auto_ref;
    merge(grade, a);
    grade.locals = keep.concat(zones.map(l => merge(defaultLocal(), l))).slice(0, MAX_LOCALS);
    return grade;
  }

  window.Grade = {
    MAX_LOCALS, MASK_NAMES, LOCAL_LABELS, LOCAL_ADJ, defaultLocal, localEffective,
    outToSrc, portableGrade, mergeAuto,
    LUMA, K, CURVE_SAMPLES, LOOKS,
    defaultGrade, defaultGeo, clone, merge, normalize,
    gradeIdentity, geoIdentity, curvesIdentity,
    isIdentity: e => { const n = normalize(e); return gradeIdentity(n.grade) && geoIdentity(n.geo); },
    wheelRGB, uniforms, makeSpline, buildCurveLut, geometry, straightenScale,
    parseCube, hueDir, applyLook, removeLook,
  };
})();
