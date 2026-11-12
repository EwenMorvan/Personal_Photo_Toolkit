/* ══════════════════════════════════════════════════════
   Photo Studio – Album module (photo-book maker)

   One pageEl() draws everything: editor page, thumbnails, preview, the browser
   print and the rasterised print files.
   A look   = theme preset + the user's overrides (album.style) → CSS variables.
   A page   = a layout (or its own geometry once frames were moved: page.geom)
              + items (photos: crop, zoom, effect, rotation) + notes (text blocks)
              + extras (free text / logos / icons); album.overlays repeat on every page.
   A background (colour / image) is set for all pages, left or right ones, or one page.
   Two views: one page, or the open book (two pages side by side).
══════════════════════════════════════════════════════ */
(function () {
  const $ = id => document.getElementById(id);
  const { api, toast } = window.App;

  // bgimg: a CSS background drawn in "em" (1em = 1 % of the page width), so it scales with the page
  const TH = (label, o) => ({ label, bg: "#ffffff", fg: "#222222", muted: "#777777", accent: null, bgimg: null, margin: 4.5, gap: 1, radius: 0,
                              bw: 0, bc: "#ffffff", shadow: false, tilt: 0, fs: 1, upper: false, weight: 400, title: "Georgia", text: "Georgia", ...o });
  const THEMES = {
    classique: TH("Classique", {}),
    noir:      TH("Noir", { bg: "#0c0c0e", fg: "#f3f3f3", muted: "#9a9aa2", margin: 3.4, gap: 0.6, weight: 200, title: "Segoe UI", text: "Segoe UI" }),
    carnet:    TH("Carnet", { bg: "#f1e7d3", fg: "#3a2f25", muted: "#7a6853", margin: 5, gap: 2.4, bw: 1.1, bc: "#fdfbf6", shadow: true, tilt: 1.3,
                              title: "Segoe Print", text: "Segoe Print" }),
    minimal:   TH("Minimal", { bg: "#fafafa", fg: "#1c1c1c", muted: "#8a8a8a", margin: 8, gap: 2.6, fs: 0.85, upper: true, weight: 300,
                               title: "Segoe UI Light", text: "Segoe UI" }),
    magazine:  TH("Magazine", { fg: "#111111", muted: "#555555", margin: 1.2, gap: 0.5, fs: 1.1, upper: true, weight: 700, title: "Bahnschrift", text: "Segoe UI" }),
    voyage:    TH("Voyage", { bg: "#eadcc2", fg: "#3b2a1c", muted: "#8a6e52", accent: "#b5532f", margin: 5.5, gap: 2.2, bw: 0.9, bc: "#fffdf8", shadow: true, tilt: 1.8,
                              title: "Ink Free", text: "Candara", fs: 1.05,
                              bgimg: "radial-gradient(ellipse at center, #0000 55%, #7a5a3026 100%), repeating-linear-gradient(45deg, #0000 0 1.2em, #7a5a300d 1.2em 1.32em)" }),
    mer:       TH("Mer", { bg: "#eef8fa", fg: "#12324a", muted: "#5d8296", accent: "#1899b4", margin: 4.5, gap: 1.4, radius: 1.2, title: "Candara", text: "Candara", weight: 700,
                           bgimg: "repeating-radial-gradient(circle at 50% 175%, #0000 0 3.2em, #1899b414 3.2em 3.5em), linear-gradient(180deg, #d9f0f5 0%, #f7fcfd 50%, #e2f2f7 100%)" }),
    montagne:  TH("Montagne", { bg: "#eef1f2", fg: "#1f2d36", muted: "#62737d", accent: "#3f6b52", margin: 4, gap: 0.9, upper: true, weight: 600, title: "Bahnschrift", text: "Corbel", fs: 0.95,
                                bgimg: "repeating-radial-gradient(ellipse at 15% 115%, #0000 0 2.3em, #3d556a16 2.3em 2.5em), repeating-radial-gradient(ellipse at 90% -15%, #0000 0 2.8em, #3d556a10 2.8em 3em)" }),
    foret:     TH("Forêt", { bg: "#16261d", fg: "#f1ecdc", muted: "#a9b79f", accent: "#c8d67a", margin: 4.2, gap: 1.2, radius: 0.6, title: "Constantia", text: "Constantia",
                             bgimg: "radial-gradient(ellipse at 28% 18%, #2a4a37 0%, #16261d 72%)" }),
    coucher:   TH("Coucher de soleil", { bg: "#fbd9c0", fg: "#4a1f3a", muted: "#8b5568", accent: "#d9552f", margin: 4.6, gap: 1.6, radius: 0.8, shadow: true, title: "Gabriola", text: "Palatino Linotype", fs: 1.15,
                                         bgimg: "linear-gradient(180deg, #ffe6c7 0%, #f9c7b1 55%, #eaa7b6 100%)" }),
    nuit:      TH("Nuit étoilée", { bg: "#0f1638", fg: "#eef0ff", muted: "#9aa3d1", accent: "#ffd66e", margin: 4, gap: 1.2, radius: 0.5, weight: 300, title: "Segoe UI Light", text: "Segoe UI",
                                    bgimg: "radial-gradient(circle, #ffffff70 0 .12em, #0000 .15em) 0 0 / 7em 7em, radial-gradient(circle, #ffffff40 0 .09em, #0000 .12em) 3.5em 2em / 9em 9em, radial-gradient(circle, #ffd66e66 0 .1em, #0000 .13em) 1em 5em / 13em 11em, linear-gradient(180deg, #0a1030, #1c2456)" }),
    polaroid:  TH("Polaroid", { bg: "#e9e7e1", fg: "#2b2b2b", muted: "#777777", accent: "#d0453a", margin: 6, gap: 3, bw: 1.5, bc: "#ffffff", shadow: true, tilt: 2.4, title: "Segoe Print", text: "Segoe UI",
                                bgimg: "repeating-linear-gradient(0deg, #0000 0 .5em, #00000006 .5em .55em)" }),
    pastel:    TH("Pastel", { bg: "#f6eef6", fg: "#4b4460", muted: "#8d86a3", accent: "#e58fb1", margin: 5.5, gap: 2, radius: 3, title: "Corbel", text: "Corbel", weight: 700,
                              bgimg: "linear-gradient(135deg, #fde7ef 0%, #eef0fb 50%, #e1f4f4 100%)" }),
    retro:     TH("Rétro", { bg: "#f4e6c8", fg: "#3d2b1f", muted: "#8a6f4d", accent: "#c9762b", margin: 5, gap: 1.8, bw: 0.5, bc: "#3d2b1f", upper: true, weight: 700, title: "Franklin Gothic Medium", text: "Trebuchet MS",
                             bgimg: "repeating-linear-gradient(90deg, #0000 0 5em, #c9762b14 5em 5.5em, #0000 5.5em 6em, #3d2b1f0d 6em 6.2em)" }),
    tropical:  TH("Tropical", { bg: "#fff6dd", fg: "#12443a", muted: "#5d8a79", accent: "#ff6b5c", margin: 4.4, gap: 1.6, radius: 2, title: "Trebuchet MS", text: "Candara", weight: 700,
                                bgimg: "radial-gradient(circle at 100% 0%, #ffd66e66 0 22em, #0000 22.2em), radial-gradient(circle at 0% 100%, #2fb59a33 0 26em, #0000 26.2em), linear-gradient(160deg, #fff7e0, #e6f6ec)" }),
    neige:     TH("Neige", { bg: "#f2f6fa", fg: "#22364a", muted: "#7890a6", accent: "#4a8fd0", margin: 5, gap: 1.2, radius: 0.4, weight: 300, title: "Segoe UI Light", text: "Corbel",
                             bgimg: "radial-gradient(circle, #ffffff 0 .22em, #0000 .26em) 0 0 / 6em 6em, radial-gradient(circle, #ffffffcc 0 .15em, #0000 .19em) 3em 3.4em / 8em 8em, linear-gradient(180deg, #dfeaf4, #f6f9fc)" }),
    journal:   TH("Journal", { bg: "#fbfaf6", fg: "#111111", muted: "#555555", accent: "#a01818", margin: 3, gap: 0.8, upper: true, weight: 700, title: "Times New Roman", text: "Georgia", fs: 1.05,
                               bgimg: "linear-gradient(#111, #111) 3em 2.2em / calc(100% - 6em) .25em no-repeat, linear-gradient(#111, #111) 3em 2.9em / calc(100% - 6em) .08em no-repeat" }),
  };
  const FONTS = ["Georgia", "Cambria", "Constantia", "Times New Roman", "Segoe UI", "Segoe UI Light", "Calibri", "Arial",
                 "Bahnschrift", "Impact", "Segoe Print", "Segoe Script", "Gabriola", "Consolas",
                 "Candara", "Corbel", "Trebuchet MS", "Verdana", "Franklin Gothic Medium", "Palatino Linotype", "Sitka Text",
                 "Ink Free", "MV Boli", "Comic Sans MS", "Courier New"];
  const FALLBACK = f => `"${f}", ${/Print|Script|Gabriola|Ink Free|Boli|Comic/.test(f) ? "cursive" : /Georgia|Cambria|Constantia|Times|Palatino|Sitka/.test(f) ? "serif" : /Consolas|Courier/.test(f) ? "monospace" : "sans-serif"}`;

  // ── frame shapes: all as clip-path polygons in %, so they scale and print like the rest ──
  const pts = list => `polygon(${list.map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(", ")})`;
  const ring = (n, fn) => Array.from({ length: n }, (_, i) => fn(i / n * Math.PI * 2, i));
  /** stretch any outline to fill the frame exactly */
  function fitBox(list) {
    const xs = list.map(p => p[0]), ys = list.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return list.map(([x, y]) => [(x - x0) / (x1 - x0) * 100, (y - y0) / (y1 - y0) * 100]);
  }
  function rnd(seed) { let a = seed; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; }
  const regular = (n, rot = -Math.PI / 2) => pts(fitBox(ring(n, t => [Math.cos(t + rot), Math.sin(t + rot)])));
  function blob(seed) {                                 // hand-drawn pebble: a circle with a few slow waves
    const r = rnd(seed), k = [2, 3, 4, 5].map(f => [f, 0.05 + r() * 0.1, r() * 6.28]);
    return pts(fitBox(ring(72, t => { const d = 1 + k.reduce((s, [f, a, p]) => s + a * Math.sin(f * t + p), 0); return [Math.cos(t) * d, Math.sin(t) * d]; })));
  }
  function rough(seed, amp, step) {                     // torn paper / brush stroke: a rectangle with uneven edges
    const r = rnd(seed), out = [], j = () => (r() - 0.5) * 2 * amp;
    for (let x = 0; x <= 100; x += step) out.push([x, amp + j()]);
    for (let y = step; y <= 100; y += step) out.push([100 - amp + j(), y]);
    for (let x = 100 - step; x >= 0; x -= step) out.push([x, 100 - amp + j()]);
    for (let y = 100 - step; y > 0; y -= step) out.push([amp + j(), y]);
    return pts(out);
  }
  const SHAPES = {
    rect:     ["Rectangle", ""],
    circle:   ["Rond / ovale", "ellipse(50% 50% at 50% 50%)"],
    arch:     ["Arche", pts([[0, 100], [0, 42], ...ring(24, (_, i) => { const t = Math.PI + i / 23 * Math.PI; return [50 + 50 * Math.cos(t), 42 + 42 * Math.sin(t)]; }), [100, 42], [100, 100]])],
    hexagon:  ["Hexagone", regular(6, 0)],
    octagon:  ["Octogone", regular(8, Math.PI / 8)],
    diamond:  ["Losange", regular(4)],
    triangle: ["Triangle", pts([[50, 0], [100, 100], [0, 100]])],
    para:     ["Parallélogramme", pts([[14, 0], [100, 0], [86, 100], [0, 100]])],
    star:     ["Étoile", pts(fitBox(ring(10, (t, i) => { const d = i % 2 ? 0.46 : 1; return [Math.cos(t - Math.PI / 2) * d, Math.sin(t - Math.PI / 2) * d]; })))],
    heart:    ["Cœur", pts(fitBox(ring(64, t => [16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))])))],
    drop:     ["Goutte", pts(fitBox(ring(64, t => [Math.sin(t) * Math.sin(t / 2) ** 1.6, -Math.cos(t)])))],
    flower:   ["Fleur", pts(fitBox(ring(96, t => { const d = 1 + 0.22 * Math.cos(6 * t); return [Math.cos(t) * d, Math.sin(t) * d]; })))],
    stamp:    ["Timbre", pts(fitBox(ring(120, t => { const sq = 1 / Math.max(Math.abs(Math.cos(t)), Math.abs(Math.sin(t))); const d = sq * (1 - 0.035 * (1 + Math.cos(28 * t))); return [Math.cos(t) * d, Math.sin(t) * d]; })))],
    ticket:   ["Ticket", pts([[0, 0], [100, 0], [100, 36], ...ring(10, (_, i) => { const t = -Math.PI / 2 - i / 9 * Math.PI; return [100 + 7 * Math.cos(t), 50 + 14 * Math.sin(t)]; }), [100, 64], [100, 100], [0, 100], [0, 64],
                               ...ring(10, (_, i) => { const t = Math.PI / 2 - i / 9 * Math.PI; return [7 * Math.cos(t), 50 + 14 * Math.sin(t)]; }), [0, 36]])],
    wave:     ["Vague", pts([[0, 0], [100, 0], ...ring(40, (_, i) => [100 - i / 39 * 100, 90 + 9 * Math.sin(i / 39 * Math.PI * 4)])])],
    blob1:    ["Galet 1", blob(7)],
    blob2:    ["Galet 2", blob(23)],
    blob3:    ["Galet 3", blob(91)],
    torn:     ["Papier déchiré", rough(11, 2.2, 2.5)],
    brush:    ["Coup de pinceau", rough(5, 4.5, 7)],
  };

  const EFFECTS = {
    none: ["Aucun", ""], bw: ["Noir & blanc", "grayscale(1) contrast(1.06)"], sepia: ["Sépia", "sepia(.8) saturate(1.1)"],
    warm: ["Chaud", "sepia(.28) saturate(1.2)"], cool: ["Froid", "hue-rotate(-10deg) saturate(.92) brightness(1.03)"],
    fade: ["Délavé", "contrast(.84) brightness(1.08) saturate(.78)"], punch: ["Éclatant", "contrast(1.18) saturate(1.3)"],
    soft: ["Doux", "contrast(.92) brightness(1.05) saturate(1.05)"],
  };

  const A = {
    meta: null, album: null,
    photos: {}, order: [],
    cur: 0,
    sel: null,             // {k: "slot" | "note" | "extra" | "over", i}
    tray: "unused", side: "page", safe: false,
    history: [], hIndex: -1, saveTimer: null,
    pv: 0, pick: null, pickSize: 220,
    view: "single",        // "single" | "spread" (open book)
    bgScope: "all", fileFor: "extra",
  };
  try { if (localStorage.getItem("ps-album-view") === "spread") A.view = "spread"; } catch { /* private mode */ }

  // ── helpers ───────────────────────────────────────────
  const page = () => A.album.pages[A.cur];
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clone = o => JSON.parse(JSON.stringify(o));
  const projQ = () => `project=${encodeURIComponent(A.album.project)}`;
  const thumb = pid => `/api/thumb/${pid}?${projQ()}&v=${(A.photos[pid] || {}).rev || 0}`;
  const render = (pid, max) => `/api/render/${pid}?${projQ()}&max=${max}&v=${(A.photos[pid] || {}).rev || 0}`;
  const asset = name => `/api/albums/${A.album.id}/assets/${name}`;
  const fmt = () => A.meta.formats[A.album.format] || A.meta.formats.square;
  const look = () => ({ ...(THEMES[A.album.theme] || THEMES.classique), ...(A.album.style || {}) });
  const isSel = (k, i) => A.sel && A.sel.k === k && A.sel.i === i;

  /** Geometry of a page: its own (after frames were moved) or the layout's */
  function geomOf(pg) {
    if (pg.type !== "photos") return { slots: [[0, 0, 1, 1]], texts: [] };
    if (pg.geom) return pg.geom;
    const L = A.meta.layouts[pg.layout] || A.meta.layouts["1"];
    return { slots: L.slots, texts: L.texts || [], bleed: L.bleed };
  }
  function ensureGeom(pg) {
    if (!pg.geom) { const g = geomOf(pg); pg.geom = { slots: clone(g.slots), texts: clone(g.texts || []) }; }
    return pg.geom;
  }
  function noteOf(pg, k) {
    pg.notes = pg.notes || [];
    while (pg.notes.length <= k) pg.notes.push({ h: "", t: "" });
    return pg.notes[k];
  }
  async function meta() {
    if (!A.meta) A.meta = await api("GET", "/api/albums/meta");
    return A.meta;
  }
  function usedSet() {
    const s = new Set();
    for (const pg of A.album.pages) for (const it of pg.items || []) if (it && it.pid) s.add(it.pid);
    return s;
  }
  // ── the open book ─────────────────────────────────────
  // Page 0 is the front cover, alone. The inside of the cover cannot be printed, so the
  // first content page is a right-hand page: spreads are [inside, 1], [2, 3], [4, 5]…
  const spreadOf = i => i === 0 ? 0 : (i >> 1) + 1;
  const spreadCount = () => spreadOf(A.album.pages.length - 1) + 1;
  /** [left, right]: a page index, "in" (blank inside of the cover) or null (nothing there) */
  function spreadPages(s) {
    if (s === 0) return [null, 0];
    const l = 2 * (s - 1), r = l + 1;
    return [l === 0 ? "in" : l, r < A.album.pages.length ? r : "in"];
  }
  function ghostEl(kind) {
    const el = document.createElement("div"), f = fmt();
    el.className = "al-page al-ghost" + (kind ? "" : " none");
    el.style.aspectRatio = `${f.w} / ${f.h}`;
    if (kind) el.innerHTML = `<div class="al-in"><span>Intérieur de la couverture<br><small>non imprimable : reste blanc</small></span></div>`;
    return el;
  }

  // ── backgrounds ───────────────────────────────────────
  /** The background of a page: its own, else the one of its side of the book, else the album's */
  function bgOf(pg, idx) {
    const G = A.album.bg || {};
    if (pg.bg) return pg.bg;
    if (idx > 0) { const side = idx % 2 ? G.right : G.left; if (side) return side; }
    return G.all || null;
  }
  const iconSrc = x => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(x.svg.replace(/currentColor/g, x.color || "#222222"));

  function applyLook(el) {
    const L = look(), set = (k, v) => el.style.setProperty(k, v);
    set("--pg-bg", L.bg); set("--pg-fg", L.fg); set("--pg-muted", L.muted);
    set("--pg-margin", L.margin); set("--pg-gap", L.gap); set("--pg-radius", L.radius);
    set("--pg-bw", L.bw); set("--pg-bc", L.bc); set("--pg-shadow", L.shadow ? 1 : 0); set("--pg-tilt", L.tilt);
    set("--pg-fs", L.fs); set("--pg-case", L.upper ? "uppercase" : "none"); set("--pg-weight", L.weight);
    set("--pg-title", FALLBACK(L.title)); set("--pg-text", FALLBACK(L.text));
    set("--pg-bgimg", L.bgimg || "none"); set("--pg-accent", L.accent || L.muted);
    if (el._fg) { set("--pg-fg", el._fg); set("--pg-muted", /^#[0-9a-f]{6}$/i.test(el._fg) ? el._fg + "b3" : el._fg); }
  }
  const place = (d, r) => Object.assign(d.style, { left: r[0] * 100 + "%", top: r[1] * 100 + "%", width: r[2] * 100 + "%", height: r[3] * 100 + "%" });
  function styleItem(slot, frame, img, it) {
    slot.style.transform = it && it.rot ? `rotate(${it.rot}deg)` : "";
    const shape = it && SHAPES[it.shape] ? SHAPES[it.shape][1] : "";
    slot.classList.toggle("shaped", !!shape);
    if (frame) { frame.style.borderRadius = it && it.round && !shape ? `${it.round}%` : ""; frame.style.clipPath = shape; }
    if (!img || !it) return;
    img.style.objectPosition = `${it.x ?? 50}% ${it.y ?? 50}%`;
    img.style.transformOrigin = `${it.x ?? 50}% ${it.y ?? 50}%`;
    img.style.transform = (it.zoom || 1) !== 1 ? `scale(${it.zoom})` : "";
    img.style.filter = (EFFECTS[it.fx] || EFFECTS.none)[1];
  }
  function styleExtra(d, x) {
    place(d, x.r);
    d.style.transform = x.rot ? `rotate(${x.rot}deg)` : "";
    const c = d.firstChild;
    if (x.kind !== "text") c.style.opacity = x.opacity ?? 1;
    else Object.assign(c.style, { fontSize: `calc(${x.size || 3}em * var(--pg-fs))`, color: x.color || "", textAlign: x.align || "center",
                                  fontFamily: `var(--pg-${x.font === "title" ? "title" : "text"})`, fontWeight: x.bold ? 700 : "" });
  }

  // ── the page ──────────────────────────────────────────
  /** opts: {edit, res: "thumb" | pixel width of the page, print} */
  function pageEl(pg, opts = {}) {
    const f = fmt(), g = geomOf(pg);
    const idx = A.album.pages.indexOf(pg);
    const mine = !!opts.edit && pg === page();          // the selection belongs to the current page only
    const el = document.createElement("div");
    el.className = `al-page type-${pg.type}` + (g.bleed ? " bleed" : "") + (opts.edit ? " editable" : "");
    el.style.aspectRatio = `${f.w} / ${f.h}`;
    el.dataset.p = idx;
    const B = bgOf(pg, idx);
    el._fg = B && B.fg;
    applyLook(el);
    if (B && (B.color || B.pid || B.src)) {
      const bg = document.createElement("div");
      bg.className = "al-bg";
      if (B.color) bg.style.background = B.color;
      if (B.src || (B.pid && A.photos[B.pid])) {
        const im = document.createElement("img");
        const px = opts.res === "thumb" ? 0 : (opts.res || 1400);
        im.src = B.src ? asset(B.src) : opts.res === "thumb" ? thumb(B.pid) : render(B.pid, px > 3000 ? 0 : px > 1900 ? 2560 : 1600);
        im.style.opacity = B.opacity ?? 0.35;
        im.draggable = false;
        im.onerror = () => im.remove();
        bg.appendChild(im);
      }
      el.appendChild(bg);
    }
    const inn = document.createElement("div");
    inn.className = "al-in";
    el.appendChild(inn);

    const ed = (cls, value, ph, bind) => {
      const d = document.createElement("div");
      d.className = cls;
      d.textContent = value || "";
      if (opts.edit) { d.contentEditable = "plaintext-only"; d.dataset.ph = ph; d.spellcheck = false; d._bind = bind; }
      return d;
    };

    if (pg.type !== "text" && pg.type !== "blank") {
      const box = document.createElement("div");
      box.className = "al-photos";
      g.slots.forEach((s, i) => {
        const slot = document.createElement("div");
        slot.className = "al-slot" + (mine && isSel("slot", i) ? " sel" : "");
        slot.dataset.i = i;
        place(slot, s);
        const frame = document.createElement("div");
        const it = (pg.items || [])[i];
        frame.className = "al-frame" + (it && it.pid ? "" : " empty");
        let img = null;
        if (it && it.pid) {
          img = document.createElement("img");
          const px = opts.res === "thumb" ? 0 : (opts.res || 1400) * Math.max(s[2], s[3] * f.h / f.w) * (it.zoom || 1);
          img.src = opts.res === "thumb" ? thumb(it.pid) : render(it.pid, px > 3000 ? 0 : px > 1900 ? 2560 : px > 1000 ? 1600 : 1000);
          if (!opts.print) img.loading = "lazy";
          img.draggable = false;
          img.onerror = () => { frame.classList.add("empty"); frame.innerHTML = "<span>photo introuvable</span>"; };
          frame.appendChild(img);
        } else if (opts.edit) frame.innerHTML = "<b>+</b><span>Choisir une photo</span>";
        slot.appendChild(frame);
        styleItem(slot, frame, img, it);
        box.appendChild(slot);
      });
      // note blocks sit beside the photos – never on or under them
      (g.texts || []).forEach((s, k) => {
        const note = (pg.notes || [])[k] || {};
        if (!opts.edit && !note.h && !note.t) return;
        const d = document.createElement("div");
        d.className = "al-note" + (mine && isSel("note", k) ? " sel" : "");
        d.dataset.k = k;
        place(d, s);
        d.appendChild(ed("al-note-h", note.h, "Titre de la note", v => { noteOf(pg, k).h = v; }));
        d.appendChild(ed("al-note-t", note.t, "Écrivez ici un souvenir, une anecdote…", v => { noteOf(pg, k).t = v; }));
        d.lastChild.dataset.multi = "1";
        box.appendChild(d);
      });
      inn.appendChild(box);
    }
    if (pg.type !== "photos" && pg.type !== "blank") {
      const t = document.createElement("div");
      t.className = "al-covertext";
      t.appendChild(ed("al-title", pg.title, "Titre", v => { pg.title = v; }));
      if (pg.type !== "text" && (opts.edit || pg.subtitle)) t.appendChild(ed("al-subtitle", pg.subtitle, "Sous-titre", v => { pg.subtitle = v; }));
      if (pg.type !== "cover" && (opts.edit || pg.text)) {
        t.appendChild(ed("al-text", pg.text, pg.type === "text" ? "Votre texte…" : "Quelques mots…", v => { pg.text = v; }));
        if (pg.type === "text") t.lastChild.dataset.multi = "1";
      }
      inn.appendChild(t);
    }
    // free elements: logos / texts of this page, and those repeated on every page
    const extras = [];
    if (pg.type !== "blank") (A.album.overlays || []).forEach((x, i) => { if (pg.type !== "cover" || x.cover) extras.push([x, "over", i]); });
    (pg.extras || []).forEach((x, i) => extras.push([x, "extra", i]));
    for (const [x, k, i] of extras) {
      const d = document.createElement("div");
      d.className = `al-extra ${x.kind}` + (mine && isSel(k, i) ? " sel" : "");
      d.dataset.k = k; d.dataset.i = i;
      if (x.kind !== "text") {
        const im = document.createElement("img");
        im.src = x.kind === "icon" ? iconSrc(x) : asset(x.src);
        im.draggable = false; d.appendChild(im);
      } else {
        const t = ed("al-xtext", x.text, "Texte", v => { x.text = v; });
        t.dataset.multi = "1";
        d.appendChild(t);
      }
      styleExtra(d, x);
      inn.appendChild(d);
    }
    if (opts.edit && A.safe) {
      const s = document.createElement("div");
      s.className = "al-safe";
      const mx = A.meta.safe_mm / f.w * 100, my = A.meta.safe_mm / f.h * 100;
      s.style.inset = `${my}% ${mx}%`;
      inn.appendChild(s);
    }
    return el;
  }

  // ── albums list ───────────────────────────────────────
  async function showHome() {
    $("al-editor").classList.remove("active");
    $("al-home").classList.add("active");
    A.album = null;
    await meta();
    const list = await api("GET", "/api/albums");
    const grid = $("al-grid");
    grid.innerHTML = "";
    $("al-empty").style.display = list.length ? "none" : "block";
    $("al-count").textContent = list.length ? `${list.length} album${list.length > 1 ? "s" : ""}` : "";
    for (const a of list) {
      const card = document.createElement("div");
      card.className = "proj-card al-card";
      const cover = a.cover ? `<img src="/api/thumb/${a.cover}?project=${encodeURIComponent(a.project)}" alt=""/>` : `<div class="ph">📖</div>`;
      card.innerHTML = `<div class="stack"><div class="ph"></div><div class="ph"></div>${cover}</div>
        <div class="pc-name">${a.name.replace(/_/g, " ")}</div>
        <div class="pc-meta">${a.pages} pages · ${(THEMES[a.theme] || {}).label || a.theme} · ${a.project.replace(/_/g, " ")}</div>
        <button class="al-card-del">Supprimer</button>`;
      card.addEventListener("click", async e => {
        if (e.target.classList.contains("al-card-del")) {
          if (!confirm(`Supprimer l'album « ${a.name} » ? (les photos ne sont pas touchées)`)) return;
          await api("DELETE", `/api/albums/${a.id}`);
          showHome();
          return;
        }
        openAlbum(a.id);
      });
      grid.appendChild(card);
    }
  }

  // ── new album / regenerate dialog ─────────────────────
  let dlgMode = "new";
  async function openDialog(mode, project) {
    dlgMode = mode;
    await meta();
    const projects = await api("GET", "/api/projects");
    if (!projects.length) { toast("Créez d'abord un projet dans PhotoChooser", "info", 4000); return; }
    const sel = (id, opts, val) => { $(id).innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join(""); if (val) $(id).value = val; };
    sel("al-f-project", projects.map(p => [p.name, `${p.name.replace(/_/g, " ")} (♥ ${p.liked_count} / ${p.photo_count})`]), project || (A.album && A.album.project));
    sel("al-f-format", Object.entries(A.meta.formats).map(([k, f]) => [k, f.label]), A.album ? A.album.format : "square");
    sel("al-f-theme", Object.entries(THEMES).map(([k, t]) => [k, t.label]), A.album ? A.album.theme : "classique");
    const regen = mode === "regen";
    $("al-dlg-title").textContent = regen ? "Refaire la mise en page automatiquement" : "Nouvel album";
    $("al-dlg-ok").textContent = regen ? "✦ Refaire" : "✦ Créer automatiquement";
    $("al-f-project").disabled = regen;
    $("al-f-name").parentElement.style.display = regen ? "none" : "";
    $("al-f-theme").parentElement.style.display = regen ? "none" : "";
    $("al-f-name").value = regen ? A.album.name : $("al-f-project").value.replace(/_/g, " ");
    $("al-f-deep").parentElement.style.display = A.meta.ai ? "" : "none";
    $("al-form").style.display = ""; $("al-dlg-actions").style.display = ""; $("al-progress").style.display = "none";
    $("al-dialog").style.display = "flex";
  }

  async function runDialog() {
    const body = { source: $("al-f-source").value, density: $("al-f-density").value, deep: $("al-f-deep").checked && A.meta.ai };
    try {
      let aid;
      if (dlgMode === "regen") {
        aid = A.album.id;
        await flushSave();
        await api("PUT", `/api/albums/${aid}`, { format: $("al-f-format").value });
      } else {
        const a = await api("POST", "/api/albums", { project: $("al-f-project").value, name: $("al-f-name").value.trim() || $("al-f-project").value,
                                                    format: $("al-f-format").value, theme: $("al-f-theme").value });
        aid = a.id;
      }
      $("al-form").style.display = "none"; $("al-dlg-actions").style.display = "none"; $("al-progress").style.display = "";
      let job = await api("POST", `/api/albums/${aid}/generate`, body);
      while (job.state === "running") {
        $("al-progress-text").textContent = job.total ? `Analyse des photos… ${job.done} / ${job.total}` : "Préparation…";
        $("al-progress-bar").value = job.total ? job.done / job.total * 100 : 0;
        await new Promise(r => setTimeout(r, 600));
        job = await api("GET", `/api/albums/jobs/${job.id}`);
      }
      $("al-dialog").style.display = "none";
      if (job.state === "error") { toast(job.error, "error", 6000); if (dlgMode === "new") await api("DELETE", `/api/albums/${aid}`); return; }
      await openAlbum(aid);
      toast(`✦ Album mis en page : ${A.album.pages.length} pages. Les textes sont des premiers jets : cliquez dessus pour les réécrire.`, "success", 6000);
    } catch (e) {
      $("al-dialog").style.display = "none";
      toast("Erreur : " + e.message, "error", 5000);
    }
  }

  // ── editor ────────────────────────────────────────────
  async function openAlbum(aid) {
    await meta();
    A.album = await api("GET", `/api/albums/${aid}`);
    A.album.overlays = A.album.overlays || [];
    A.album.bg = A.album.bg || {};
    const list = await api("GET", `/api/albums/${aid}/photos`);
    A.photos = {}; A.order = [];
    for (const p of list) { A.photos[p.id] = p; A.order.push(p.id); }
    A.cur = 0; A.sel = null;
    A.history = [snap()]; A.hIndex = 0;
    $("al-home").classList.remove("active");
    $("al-editor").classList.add("active");
    $("al-name").value = A.album.name.replace(/_/g, " ");
    $("al-format").innerHTML = Object.entries(A.meta.formats).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join("");
    $("al-format").value = A.album.format;
    setSaved("");
    drawAll();
  }

  function drawAll() { drawStrip(); drawPage(); drawTray(); drawStyle(); }
  function drawPage() { drawCanvas(); drawNav(); drawLayouts(); drawProps(); drawBg(); }

  function fitPage(el, host) {
    const f = fmt(), r = host.getBoundingClientRect();
    const w = Math.max(60, Math.min(r.width, r.height * f.w / f.h));
    el.style.width = w + "px";
    return w;
  }

  /** (Re)draw only the big page(s) – keeps the side panel as it is (sliders being dragged) */
  function drawCanvas() {
    const host = $("al-canvas");
    host.innerHTML = "";
    if (!page()) return;
    const spread = A.view === "spread";
    host.classList.toggle("spread", spread);
    const f = fmt(), r = host.getBoundingClientRect();
    const list = spread ? spreadPages(spreadOf(A.cur)) : [A.cur];
    const w = Math.max(60, Math.min(r.width / list.length, r.height * f.w / f.h));
    for (const p of list) {
      let el;
      if (typeof p === "number") {
        const pg = A.album.pages[p];
        el = pageEl(pg, { edit: true, res: w * (window.devicePixelRatio || 1) });
        bindPage(el, pg);
        el.classList.toggle("cur", spread && p === A.cur);
      } else el = ghostEl(p);
      el.style.width = w + "px";
      host.appendChild(el);
    }
  }

  /** In the open book both pages are live: touching the other one makes it the current page */
  function focusPage(i) {
    if (A.cur === i) return;
    A.cur = i; A.sel = null;
    document.querySelectorAll("#al-canvas .sel").forEach(x => x.classList.remove("sel"));
    document.querySelectorAll("#al-canvas .al-h").forEach(x => x.remove());
    document.querySelectorAll("#al-canvas .al-page").forEach(x => x.classList.toggle("cur", +x.dataset.p === i));
    drawNav(); drawLayouts(); drawProps(); drawBg();
  }

  function drawNav() {
    const pg = page(), n = A.album.pages.length, spread = A.view === "spread";
    if (spread) {
      const s = spreadOf(A.cur), nums = spreadPages(s).filter(p => typeof p === "number").map(p => p + 1);
      $("al-pos").textContent = `Page${nums.length > 1 ? "s" : ""} ${nums.join(" – ")} / ${n}`;
      $("al-prev").disabled = s === 0; $("al-next").disabled = s >= spreadCount() - 1;
    } else {
      $("al-pos").textContent = `Page ${A.cur + 1} / ${n}`;
      $("al-prev").disabled = A.cur === 0; $("al-next").disabled = A.cur >= n - 1;
    }
    $("al-up").disabled = A.cur <= 1; $("al-down").disabled = A.cur === 0 || A.cur >= n - 1;
    $("al-del").disabled = pg.type === "cover";
    $("al-safe").classList.toggle("active", A.safe);
    document.querySelectorAll("#al-view button").forEach(x => x.classList.toggle("active", x.dataset.v === A.view));
    document.querySelectorAll("#al-pages .al-thumb").forEach((t, i) => t.classList.toggle("active", i === A.cur));
  }

  function newPage(kind) {
    const pg = { id: uid(), type: kind, items: [] };
    if (kind === "photos") { pg.layout = "2t"; pg.items = [null, null]; pg.notes = [{ h: "Note", t: "Écrivez ici un souvenir de ce moment." }]; }
    else { pg.title = kind === "chapter" ? "Nouveau chapitre" : "Titre"; pg.subtitle = kind === "chapter" ? "Date ou lieu" : ""; pg.text = kind === "text" ? "Votre texte ici." : "Quelques mots sur cette étape."; }
    return pg;
  }
  function addPage(kind, at) {
    A.album.pages.splice(at, 0, newPage(kind));
    A.cur = at; A.sel = null; commit();
  }

  function drawStrip() {
    const host = $("al-pages");
    const top = host.scrollTop;
    host.innerHTML = "";
    host.classList.toggle("spread", A.view === "spread");
    A.album.pages.forEach((pg, i) => {
      const t = document.createElement("div");
      t.className = "al-thumb" + (i === A.cur ? " active" : "");
      t.innerHTML = `<span class="n">${i + 1}</span>`;
      const el = pageEl(pg, { res: "thumb" });
      el.style.width = "100%";
      t.appendChild(el);
      t.addEventListener("click", () => { A.cur = i; A.sel = null; drawPage(); });
      if (i > 0) {                                        // the cover stays first
        t.draggable = true;
        t.addEventListener("dragstart", e => startDrag(e, { move: i }, t));
        t.addEventListener("dragend", endDrag);
      }
      // between two pages: a line with a + to add a page right there
      const ins = document.createElement("div");
      ins.className = "al-ins";
      ins.title = "Ajouter une page ici";
      ins.innerHTML = "<b>+</b>";
      ins.addEventListener("click", e => { e.stopPropagation(); addPage("photos", i + 1); });
      t.appendChild(ins);
      host.appendChild(t);
      if (i === 0 && A.view === "spread") {              // the blank inside of the cover, left of page 2
        const g = document.createElement("div");
        g.className = "al-thumb-in"; g.title = "Intérieur de la couverture : non imprimable";
        host.appendChild(g);
      }
    });
    host.scrollTop = top;
  }

  function drawLayouts() {
    const pg = page();
    $("al-layout-panel").style.display = pg.type === "photos" ? "" : "none";
    $("al-layouts").innerHTML = ""; $("al-layouts-text").innerHTML = "";
    if (pg.type !== "photos") return;
    for (const [name, lay] of Object.entries(A.meta.layouts)) {
      const b = document.createElement("button");
      b.className = "al-lay" + (pg.layout === name && !pg.geom ? " active" : "");
      const nt = (lay.texts || []).length;
      b.title = lay.bleed ? "Pleine page" : `${lay.slots.length} photo${lay.slots.length > 1 ? "s" : ""}` + (nt ? ` + ${nt} texte${nt > 1 ? "s" : ""}` : "");
      const pad = lay.bleed ? 0 : 10;
      const box = (s, cls) => {
        const i = document.createElement("i");
        if (cls) i.className = cls;
        Object.assign(i.style, { left: `calc(${pad + s[0] * (100 - 2 * pad)}% + 1px)`, top: `calc(${pad + s[1] * (100 - 2 * pad)}% + 1px)`,
                                 width: `calc(${s[2] * (100 - 2 * pad)}% - 2px)`, height: `calc(${s[3] * (100 - 2 * pad)}% - 2px)` });
        b.appendChild(i);
      };
      lay.slots.forEach(s => box(s));
      (lay.texts || []).forEach(s => box(s, "txt"));
      b.addEventListener("click", () => {
        const n = lay.slots.length, items = (pg.items || []).filter(it => it && it.pid).slice(0, n);
        while (items.length < n) items.push(null);
        pg.layout = name; pg.items = items; pg.geom = null; A.sel = null;
        (lay.texts || []).forEach((_, k) => { const nte = noteOf(pg, k); if (!nte.h && !nte.t) { nte.h = "Note"; nte.t = "Écrivez ici un souvenir de ce moment."; } });
        commit();
      });
      (nt ? $("al-layouts-text") : $("al-layouts")).appendChild(b);
    }
  }

  // ── properties of the selected element ────────────────
  function selected() {
    const pg = page(), s = A.sel;
    if (!s) return null;
    if (s.k === "slot") { const it = (pg.items || [])[s.i]; return it ? { kind: "slot", it } : { kind: "slot", it: null }; }
    if (s.k === "note") return { kind: "note" };
    const x = s.k === "over" ? A.album.overlays[s.i] : (pg.extras || [])[s.i];
    return x ? { kind: x.kind, x } : null;
  }

  function drawProps() {
    const box = $("al-props"), cur = selected();
    box.style.display = cur ? "" : "none";
    box.innerHTML = "";
    if (!cur) return;
    const pg = page();
    const head = t => { const d = document.createElement("div"); d.className = "section-label"; d.textContent = t; box.appendChild(d); };
    const btns = list => {
      const row = document.createElement("div"); row.className = "al-btnrow";
      for (const [label, fn, cls] of list) { const b = document.createElement("button"); b.className = "btn " + (cls || "btn-outline"); b.textContent = label; b.addEventListener("click", fn); row.appendChild(b); }
      box.appendChild(row);
    };
    const wrap = document.createElement("div"); wrap.className = "al-custom";
    // live: restyle the page (not the panel, so a slider keeps being dragged), commit on release
    const ctl = (label, kind, get, set, o = {}) => {
      const row = document.createElement("label");
      row.textContent = label;
      let inp;
      if (kind === "select") {
        inp = document.createElement("select"); inp.className = "filter-input";
        inp.innerHTML = o.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
        inp.value = get();
      } else {
        inp = document.createElement("input"); inp.type = kind === "check" ? "checkbox" : kind;
        if (kind === "range") { inp.min = o.min; inp.max = o.max; inp.step = o.step; }
        if (kind === "check") inp.checked = !!get(); else inp.value = get();
      }
      const read = () => kind === "check" ? inp.checked : kind === "range" ? parseFloat(inp.value) : inp.value;
      // o.once: an action (moves the element to another list) – must run a single time, on release
      if (!o.once) inp.addEventListener("input", () => { set(read()); drawCanvas(); scheduleSave(); });
      inp.addEventListener("change", () => { set(read()); pushHistory(); scheduleSave(); drawCanvas(); drawStrip(); if (o.once) drawProps(); });
      row.appendChild(inp); wrap.appendChild(row);
    };

    if (cur.kind === "slot") {
      const i = A.sel.i, it = cur.it;
      head("Photo");
      btns([[it && it.pid ? "Changer…" : "Choisir…", () => openPicker(i)], ["Vider", () => { pg.items[i] = null; commit(); }]]);
      if (it && it.pid) {
        ctl("Zoom", "range", () => it.zoom || 1, v => { it.zoom = v; }, { min: 1, max: 4, step: 0.02 });
        ctl("Effet", "select", () => it.fx || "none", v => { it.fx = v; }, { options: Object.entries(EFFECTS).map(([k, e]) => [k, e[0]]) });
        ctl("Arrondi", "range", () => it.round || 0, v => { it.round = v; }, { min: 0, max: 50, step: 1 });
        const lab = document.createElement("div"); lab.className = "al-sublabel"; lab.textContent = "Forme du cadre";
        const grid = document.createElement("div"); grid.className = "al-shapes";
        for (const [k, [label, clip]] of Object.entries(SHAPES)) {
          const b = document.createElement("button");
          b.className = "al-shape" + ((it.shape || "rect") === k ? " active" : ""); b.title = label;
          b.innerHTML = "<i></i>"; b.firstChild.style.clipPath = clip;
          b.addEventListener("click", () => { it.shape = k === "rect" ? undefined : k; commit(); });
          grid.appendChild(b);
        }
        wrap.appendChild(lab); wrap.appendChild(grid);
        ctl("Rotation", "range", () => it.rot || 0, v => { it.rot = v; }, { min: -20, max: 20, step: 0.5 });
      }
      box.appendChild(wrap);
      if (it && it.pid) btns([["Recentrer", () => { Object.assign(it, { x: 50, y: 50, zoom: 1, rot: 0 }); commit(); }, "btn-ghost"]]);
      if (pg.type === "photos") btns([["Supprimer ce cadre", () => {
        const g = ensureGeom(pg); g.slots.splice(i, 1); (pg.items || []).splice(i, 1); A.sel = null; commit();
      }, "btn-danger"]]);
    } else if (cur.kind === "note") {
      head("Bloc de texte");
      const p = document.createElement("p"); p.className = "al-hint";
      p.textContent = "Polices, couleurs et taille se règlent dans l'onglet Style. Déplacez ou redimensionnez le bloc avec ses poignées.";
      box.appendChild(p);
      btns([["Supprimer ce bloc", () => {
        const g = ensureGeom(pg); g.texts.splice(A.sel.i, 1); (pg.notes || []).splice(A.sel.i, 1); A.sel = null; commit();
      }, "btn-danger"]]);
    } else {
      const x = cur.x, over = A.sel.k === "over";
      head(x.kind === "image" ? "Logo / image" : x.kind === "icon" ? "Pictogramme" : "Texte libre");
      if (x.kind === "text") {
        ctl("Taille", "range", () => x.size || 3, v => { x.size = v; }, { min: 1, max: 16, step: 0.1 });
        ctl("Couleur", "color", () => x.color || look().fg, v => { x.color = v; });
        ctl("Alignement", "select", () => x.align || "center", v => { x.align = v; }, { options: [["left", "Gauche"], ["center", "Centré"], ["right", "Droite"]] });
        ctl("Police", "select", () => x.font || "text", v => { x.font = v; }, { options: [["text", "Celle du texte"], ["title", "Celle des titres"]] });
        ctl("Gras", "check", () => x.bold, v => { x.bold = v; });
      } else {
        if (x.kind === "icon" && x.svg.includes("currentColor")) ctl("Couleur", "color", () => x.color || "#222222", v => { x.color = v; });
        ctl("Opacité", "range", () => x.opacity ?? 1, v => { x.opacity = v; }, { min: 0.05, max: 1, step: 0.01 });
      }
      ctl("Rotation", "range", () => x.rot || 0, v => { x.rot = v; }, { min: -45, max: 45, step: 0.5 });
      ctl("Sur toutes les pages", "check", () => over, v => {
        const from = over ? A.album.overlays : pg.extras, [el] = from.splice(A.sel.i, 1);
        const to = v ? A.album.overlays : (pg.extras = pg.extras || []);
        to.push(el); A.sel = { k: v ? "over" : "extra", i: to.length - 1 };
      }, { once: true });
      if (over) ctl("Aussi sur la couverture", "check", () => x.cover, v => { x.cover = v; });
      box.appendChild(wrap);
      btns([["Supprimer", () => { (over ? A.album.overlays : pg.extras).splice(A.sel.i, 1); A.sel = null; commit(); }, "btn-danger"]]);
    }
  }

  // ── tray ──────────────────────────────────────────────
  function filtered(mode) {
    const used = usedSet();
    return A.order.filter(pid => {
      const p = A.photos[pid];
      return mode === "all" ? true : mode === "liked" ? p.liked : (p.liked && !used.has(pid));
    });
  }
  function drawTray() {
    const used = usedSet(), host = $("al-tray-list"), list = filtered(A.tray);
    host.innerHTML = "";
    for (const pid of list) {
      const img = document.createElement("img");
      img.src = thumb(pid); img.loading = "lazy"; img.draggable = true; img.title = A.photos[pid].filename;
      img.className = used.has(pid) ? "used" : "";
      img.dataset.pid = pid;
      img.addEventListener("dragstart", e => startDrag(e, { pid }, img));
      img.addEventListener("dragend", endDrag);
      img.addEventListener("click", () => putPhoto(pid));
      host.appendChild(img);
    }
    const liked = A.order.filter(pid => A.photos[pid].liked).length;
    $("al-tray-info").textContent = `${used.size} photo(s) dans l'album · ${liked} likée(s) dans le projet` + (list.length ? " · cliquez ou glissez une photo pour la placer" : " · rien à afficher ici");
    document.querySelectorAll("#al-tray-seg button").forEach(b => b.classList.toggle("active", b.dataset.v === A.tray));
  }
  /** Put a photo in a frame: the given one, the selected one, else the first empty one */
  function putPhoto(pid, slotIndex) {
    const pg = page(), n = pg.type === "text" ? 0 : geomOf(pg).slots.length;
    pg.items = pg.items || [];
    let i = slotIndex ?? (A.sel && A.sel.k === "slot" ? A.sel.i : [...Array(n).keys()].find(k => !(pg.items[k] && pg.items[k].pid)));
    if (i == null) { toast("Aucun cadre libre sur cette page : cliquez d'abord sur la photo à remplacer, ou ajoutez un cadre", "info", 4000); return; }
    const old = pg.items[i] || {};
    pg.items[i] = { pid, x: 50, y: 50, zoom: 1, fx: old.fx, round: old.round, rot: old.rot, shape: old.shape };
    commit();
  }

  // ── photo picker: big thumbnails, grouped by day ──────
  const DAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  function openPicker(slotIndex, cb) {
    A.pick = { filter: filtered("unused").length ? "unused" : "liked", slot: slotIndex, cb };
    $("al-picker").style.display = "flex";
    drawPicker();
  }
  function drawPicker() {
    const used = usedSet(), grid = $("al-pick-grid"), list = filtered(A.pick.filter), H = A.pickSize;
    document.querySelectorAll("#al-pick-seg button").forEach(b => b.classList.toggle("active", b.dataset.v === A.pick.filter));
    document.querySelectorAll("#al-pick-size button").forEach(b => b.classList.toggle("active", +b.dataset.v === H));
    grid.innerHTML = list.length ? "" : `<p class="al-hint" style="padding:40px;text-align:center">Aucune photo ici. Essayez « Toutes les likées » ou « Tout le projet ».</p>`;
    const groups = new Map();
    for (const pid of list) {
      const day = (A.photos[pid].date || "").slice(0, 10) || "Sans date";
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(pid);
    }
    for (const [day, pids] of groups) {
      const h = document.createElement("div");
      h.className = "al-pick-day";
      const d = new Date(day);
      h.innerHTML = isNaN(d) ? day : `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} <span>${pids.length} photo${pids.length > 1 ? "s" : ""}</span>`;
      grid.appendChild(h);
      const row = document.createElement("div");
      row.className = "al-pick-row";
      row.style.gridTemplateColumns = `repeat(auto-fill, minmax(${H}px, 1fr))`;      // regular grid, size chosen by the user
      for (const pid of pids) {
        const p = A.photos[pid];
        const t = document.createElement("div");
        t.className = "al-pick" + (used.has(pid) ? " used" : "");
        t.innerHTML = `<img loading="lazy" src="${H > 300 ? render(pid, 1000) : thumb(pid)}" alt=""/><span class="t">${(p.date || "").slice(11, 16)}</span>`;
        t.title = p.filename;
        t.addEventListener("click", () => { const P = A.pick; closePicker(); if (P.cb) P.cb(pid); else putPhoto(pid, P.slot); });
        row.appendChild(t);
      }
      grid.appendChild(row);
    }
  }
  const closePicker = () => { $("al-picker").style.display = "none"; A.pick = null; };

  // ── drag and drop (tray → page, frame ↔ frame) ────────
  let drag = null;
  function startDrag(e, payload, el) {
    drag = payload;
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("text/plain", "");        // nothing a browser could open as a URL
    document.body.classList.add("al-dragging");
    if (el) el.classList.add("dragging");
  }
  function endDrag() {
    drag = null;
    document.body.classList.remove("al-dragging");
    document.querySelectorAll(".dragging, .al-slot.over, .drop-b, .drop-a").forEach(x => x.classList.remove("dragging", "over", "drop-b", "drop-a"));
  }
  /** Where a dragged page would land: before or after the thumbnail under the pointer (never before the cover) */
  function dropPlace(e) {
    const th = drag && drag.move != null && e.target.closest && e.target.closest("#al-pages .al-thumb");
    if (!th) return null;
    const i = [...document.querySelectorAll("#al-pages .al-thumb")].indexOf(th), r = th.getBoundingClientRect();
    const before = A.view === "spread" ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
    return { th, before: before && i > 0, pos: Math.max(1, before ? i : i + 1) };
  }
  function nearestSlot(x, y, root) {
    let best = null, bd = Infinity;
    (root || $("al-canvas")).querySelectorAll(".al-page.editable .al-slot").forEach(s => {
      const r = s.getBoundingClientRect();
      const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      if (d < bd) { bd = d; best = s; }
    });
    return best;
  }
  window.addEventListener("dragover", e => {
    if (window.Shell.current !== "album") return;
    e.preventDefault();                               // never let the browser navigate to a dropped image
    document.querySelectorAll("#al-pages .drop-b, #al-pages .drop-a").forEach(x => x.classList.remove("drop-b", "drop-a"));
    const place = dropPlace(e);
    if (place) { e.dataTransfer.dropEffect = "move"; place.th.classList.add(place.before ? "drop-b" : "drop-a"); return; }
    const inPage = drag && drag.move == null && e.target.closest && e.target.closest("#al-stage");
    e.dataTransfer.dropEffect = inPage ? "copy" : "none";
    document.querySelectorAll("#al-canvas .al-slot.over").forEach(x => x.classList.remove("over"));
    if (inPage) { const s = nearestSlot(e.clientX, e.clientY); if (s) s.classList.add("over"); }
  });
  window.addEventListener("drop", e => {
    if (window.Shell.current !== "album") return;
    e.preventDefault();
    const d = drag, inPage = e.target.closest && e.target.closest("#al-stage"), place = dropPlace(e);
    endDrag();
    if (d && place && A.album) {
      const to = place.pos > d.move ? place.pos - 1 : place.pos;
      if (to !== d.move) { const [pg] = A.album.pages.splice(d.move, 1); A.album.pages.splice(to, 0, pg); A.cur = to; A.sel = null; commit(); }
      return;
    }
    if (!d || d.move != null || !inPage || !A.album) return;
    const s = nearestSlot(e.clientX, e.clientY);
    if (!s) return;
    const tp = +s.closest(".al-page").dataset.p, i = +s.dataset.i;
    if (d.pid) { A.cur = tp; A.sel = null; putPhoto(d.pid, i); return; }
    if (d.slot != null) moveItem(d.page, d.slot, tp, i);
  });
  /** Move a photo to another frame, on the same page or the other one (swaps if the frame is taken) */
  function moveItem(sp, si, tp, ti) {
    if (sp === tp && si === ti) return;
    const a = A.album.pages[sp], b = A.album.pages[tp];
    a.items = a.items || []; b.items = b.items || [];
    const moved = a.items[si] || null;
    a.items[si] = b.items[ti] || null;
    b.items[ti] = moved;
    A.cur = tp; A.sel = null;
    commit();
  }

  // ── move / resize handles ─────────────────────────────
  /** rect: [x, y, w, h] in fractions of `box`; others: rects to snap to */
  function addHandles(node, rect, box, others, done, cross) {
    const h = document.createElement("div");
    h.className = "al-h";
    h.innerHTML = `<b class="grip" title="Déplacer">✥</b>` + ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map(d => `<i data-h="${d}"></i>`).join("");
    node.appendChild(h);
    const snapTo = [0, 0.5, 1];
    const xs = [...snapTo], ys = [...snapTo];
    for (const o of others) { xs.push(o[0], o[0] + o[2]); ys.push(o[1], o[1] + o[3]); }
    const snap = (v, list) => { for (const s of list) if (Math.abs(v - s) < 0.012) return s; return v; };
    let d = null;
    h.addEventListener("pointerdown", e => {
      const t = e.target;
      if (!(t.dataset.h || t.classList.contains("grip"))) return;
      e.preventDefault(); e.stopPropagation();
      d = { h: t.dataset.h || "move", x: e.clientX, y: e.clientY, r: [...rect], b: box.getBoundingClientRect(), moved: false };
      t.setPointerCapture(e.pointerId);
    });
    h.addEventListener("pointermove", e => {
      if (!d) return;
      d.moved = true;
      const dx = (e.clientX - d.x) / d.b.width, dy = (e.clientY - d.y) / d.b.height, MIN = 0.05;
      let [x, y, w, hh] = d.r, R = x + w, B = y + hh;
      if (d.h === "move") {
        x = snap(x + dx, xs); if (x === d.r[0] + dx) { const r2 = snap(x + w, xs); x = r2 - w; }
        y = snap(y + dy, ys); if (y === d.r[1] + dy) { const b2 = snap(y + hh, ys); y = b2 - hh; }
      } else {
        if (d.h.includes("w")) x = Math.min(R - MIN, snap(x + dx, xs));
        if (d.h.includes("e")) R = Math.max(x + MIN, snap(R + dx, xs));
        if (d.h.includes("n")) y = Math.min(B - MIN, snap(y + dy, ys));
        if (d.h.includes("s")) B = Math.max(y + MIN, snap(B + dy, ys));
        w = R - x; hh = B - y;
      }
      rect[0] = x; rect[1] = y; rect[2] = w; rect[3] = hh;
      place(node, rect);
      if (cross && d.h === "move") cross(e, false);
    });
    const end = e => {
      if (!d) return;
      const dd = d; d = null;
      if (!dd.moved) return;
      if (cross && dd.h === "move") {
        const now = [...rect];
        rect.splice(0, 4, ...dd.r);                    // if the photo leaves for the other page, the frame stays put
        if (cross(e, true)) return;
        rect.splice(0, 4, ...now);
      }
      done();
    };
    h.addEventListener("pointerup", end);
    h.addEventListener("pointercancel", end);
    h.addEventListener("click", e => e.stopPropagation());
  }

  function select(k, i) {
    if (isSel(k, i)) return;
    A.sel = { k, i };
    drawCanvas(); drawProps();
  }

  function bindPage(el, pg) {
    const photos = el.querySelector(".al-photos"), inn = el.querySelector(".al-in");
    const idx = A.album.pages.indexOf(pg), mine = pg === page();
    el.addEventListener("pointerdown", () => focusPage(idx), true);
    el.addEventListener("focusin", () => focusPage(idx));
    el.addEventListener("click", e => { if (e.target === el || e.target === inn || e.target === photos) { if (A.sel) { A.sel = null; drawCanvas(); drawProps(); } } });
    // text
    el.querySelectorAll("[contenteditable]").forEach(d => {
      d.addEventListener("input", () => { d._bind(d.textContent); scheduleSave(); });
      d.addEventListener("blur", () => { pushHistory(); drawStrip(); });
      d.addEventListener("keydown", e => {
        if (e.key === "Enter" && !d.dataset.multi) { e.preventDefault(); d.blur(); }
        if (e.key === "Escape") d.blur();
        e.stopPropagation();
      });
    });
    const finish = () => { pushHistory(); scheduleSave(); drawStrip(); drawLayouts(); };

    // photo frames
    el.querySelectorAll(".al-slot").forEach(slot => {
      const i = +slot.dataset.i, it = (pg.items || [])[i], filled = !!(it && it.pid), sel = mine && isSel("slot", i);
      slot.addEventListener("click", e => {
        e.stopPropagation();
        if (!filled && !sel) { A.sel = { k: "slot", i }; drawCanvas(); drawProps(); openPicker(i); return; }
        select("slot", i);
      });
      slot.addEventListener("dblclick", e => { e.stopPropagation(); openPicker(i); });
      slot.draggable = filled && !sel;
      slot.addEventListener("dragstart", e => startDrag(e, { slot: i, page: idx }, slot));
      slot.addEventListener("dragend", endDrag);
      if (!sel) return;
      if (pg.type === "photos") {
        const g = ensureGeom(pg);
        addHandles(slot, g.slots[i], photos, g.slots.filter((_, k) => k !== i).concat(g.texts), finish, (e, final) => {
          document.querySelectorAll("#al-canvas .al-slot.over").forEach(x => x.classList.remove("over"));
          if (!filled || e.clientX == null) return false;
          const other = [...document.querySelectorAll("#al-canvas .al-page.editable")].find(p => {
            const r = p.getBoundingClientRect();
            return p !== el && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          });
          const t = other && nearestSlot(e.clientX, e.clientY, other);
          if (!t) return false;
          if (!final) { t.classList.add("over"); return false; }
          moveItem(idx, i, +other.dataset.p, +t.dataset.i);
          return true;
        });
      }
      const img = slot.querySelector("img");
      if (!img) return;
      // inside a selected photo: drag = crop (re-centre), wheel = zoom
      let d = null;
      img.addEventListener("pointerdown", e => {
        e.preventDefault(); e.stopPropagation();
        d = { x: e.clientX, y: e.clientY, ix: it.x ?? 50, iy: it.y ?? 50, moved: false };
        img.setPointerCapture(e.pointerId);
      });
      img.addEventListener("pointermove", e => {
        if (!d) return;
        const r = slot.getBoundingClientRect();
        d.moved = true;
        it.x = Math.min(100, Math.max(0, d.ix - (e.clientX - d.x) / r.width * 120 / (it.zoom || 1)));
        it.y = Math.min(100, Math.max(0, d.iy - (e.clientY - d.y) / r.height * 120 / (it.zoom || 1)));
        styleItem(slot, null, img, it);
      });
      img.addEventListener("pointerup", () => { if (d && d.moved) finish(); d = null; });
      slot.addEventListener("wheel", e => {
        e.preventDefault();
        it.zoom = Math.min(4, Math.max(1, (it.zoom || 1) * Math.exp(-e.deltaY * 0.0015)));
        styleItem(slot, null, img, it);
        clearTimeout(slot._wz); slot._wz = setTimeout(() => { finish(); drawProps(); }, 350);
      }, { passive: false });
    });

    // note blocks
    el.querySelectorAll(".al-note").forEach(note => {
      const k = +note.dataset.k;
      note.addEventListener("click", e => { e.stopPropagation(); select("note", k); });
      if (mine && isSel("note", k)) { const g = ensureGeom(pg); addHandles(note, g.texts[k], photos, g.slots.concat(g.texts.filter((_, j) => j !== k)), finish); }
    });

    // free elements
    el.querySelectorAll(".al-extra").forEach(d => {
      const k = d.dataset.k, i = +d.dataset.i;
      d.addEventListener("click", e => { e.stopPropagation(); select(k, i); });
      if (mine && isSel(k, i)) { const x = k === "over" ? A.album.overlays[i] : pg.extras[i]; addHandles(d, x.r, inn, [], finish); }
    });
  }

  // ── adding elements ───────────────────────────────────
  function addElement(kind) {
    const pg = page();
    if (kind === "frame") {
      if (pg.type !== "photos") { toast("Ajoutez un cadre sur une page de photos", "info"); return; }
      const g = ensureGeom(pg);
      g.slots.push([0.3, 0.3, 0.4, 0.4]); pg.items = pg.items || [];
      while (pg.items.length < g.slots.length) pg.items.push(null);
      A.sel = { k: "slot", i: g.slots.length - 1 };
      commit();
    } else if (kind === "text") {
      pg.extras = pg.extras || [];
      pg.extras.push({ id: uid(), kind: "text", r: [0.25, 0.44, 0.5, 0.12], text: "Votre texte", size: 3.2, align: "center", font: "text" });
      A.sel = { k: "extra", i: pg.extras.length - 1 };
      commit();
    } else if (kind === "icon") openIcons();
    else { A.fileFor = "extra"; $("al-file").click(); }
  }
  async function uploadAsset(file) {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`/api/albums/${A.album.id}/assets`, { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  async function addImage(file) {
    try {
      const j = await uploadAsset(file);
      if (A.fileFor === "bg") { bgEdit(B => { B.src = j.name; delete B.pid; B.opacity = B.opacity ?? 0.35; }); commit(); return; }
      const im = new Image();
      im.onload = () => {
        const f = fmt(), w = 0.22, h = w * (im.naturalHeight / im.naturalWidth) * f.w / f.h;
        const pg = page();
        pg.extras = pg.extras || [];
        pg.extras.push({ id: uid(), kind: "image", r: [0.5 - w / 2, 0.5 - h / 2, w, h], src: j.name, opacity: 1 });
        A.sel = { k: "extra", i: pg.extras.length - 1 };
        commit();
        toast("Image ajoutée. Cochez « Sur toutes les pages » pour en faire un logo répété.", "success", 4500);
      };
      im.src = asset(j.name);
    } catch (e) { toast("Erreur : " + e.message, "error"); }
  }

  // ── pictograms and logos: free libraries through the public Iconify API ──
  const SUGG = [["Voyage", "travel"], ["Montagne", "mountain"], ["Plage", "beach"], ["Soleil", "sun"], ["Avion", "airplane"],
                ["Randonnée", "hiking"], ["Appareil photo", "camera"], ["Carte", "map"], ["Boussole", "compass"], ["Lieu", "map-marker"],
                ["Cœur", "heart"], ["Étoile", "star"], ["Vélo", "bicycle"], ["Bateau", "sailboat"], ["Voiture", "car"], ["Maison", "home"],
                ["Fête", "party"], ["Fleur", "flower"], ["Arbre", "tree"], ["Flèche", "arrow"]];
  const IC = { kind: "icons", q: "", color: "#222222", seq: 0 };
  const ICON_API = "https://api.iconify.design";
  function openIcons() {
    IC.color = look().fg;
    $("al-ic-color").value = IC.color;
    $("al-ic-sugg").innerHTML = "";
    for (const [label, q] of SUGG) {
      const b = document.createElement("button");
      b.className = "chip-btn"; b.textContent = label;
      b.addEventListener("click", () => { $("al-ic-q").value = q; IC.q = q; searchIcons(); });
      $("al-ic-sugg").appendChild(b);
    }
    $("al-icons").style.display = "flex";
    if (!IC.q) { IC.q = "travel"; $("al-ic-q").value = IC.q; }
    if ((IC.items || []).length) drawIcons(); else searchIcons();
    $("al-ic-q").focus();
  }
  const closeIcons = () => { $("al-icons").style.display = "none"; };
  /** One request for the search, then one per icon library for the drawings (never one per icon:
      the service limits the number of requests). Results are kept, so recolouring costs nothing. */
  async function searchIcons() {
    const my = ++IC.seq;
    document.querySelectorAll("#al-ic-kind button").forEach(b => b.classList.toggle("active", b.dataset.v === IC.kind));
    if (!IC.q.trim()) { iconMsg("Tapez un mot (en anglais) ou choisissez une suggestion."); return; }
    iconMsg("Recherche…");
    try {
      const url = `${ICON_API}/search?query=${encodeURIComponent(IC.q.trim())}&limit=64` + (IC.kind === "brands" ? "&prefixes=simple-icons,logos,cib" : "");
      const j = await (await fetch(url)).json();
      const byPrefix = new Map();
      for (const id of j.icons || []) {
        if (!/^[a-z0-9-]+:[a-z0-9-]+$/.test(id)) continue;
        const [prefix, name] = id.split(":");
        if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
        byPrefix.get(prefix).push(name);
      }
      const sets = await Promise.all([...byPrefix].map(([prefix, names]) =>
        fetch(`${ICON_API}/${prefix}.json?icons=${names.join(",")}`).then(r => r.ok ? r.json() : null).catch(() => null)));
      if (my !== IC.seq) return;
      IC.items = [];
      [...byPrefix].forEach(([prefix, names], k) => {
        const set = sets[k];
        if (!set || !set.icons) return;
        for (const name of names) {
          const ic = set.icons[name] || set.icons[(set.aliases && set.aliases[name] || {}).parent];
          if (!ic || !ic.body || /<script|<foreignObject|\son\w+\s*=/i.test(ic.body)) continue;
          const w = ic.width || set.width || 16, h = ic.height || set.height || 16;
          IC.items.push({ id: `${prefix}:${name}`, label: name.replace(/-/g, " ") + " — " + (((j.collections || {})[prefix] || {}).name || prefix),
                          svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ic.left || 0} ${ic.top || 0} ${w} ${h}">${ic.body}</svg>` });
        }
      });
      drawIcons();
    } catch { if (my === IC.seq) iconMsg("Recherche indisponible : une connexion Internet est nécessaire."); }
  }
  const iconMsg = t => { $("al-ic-grid").innerHTML = `<p class="al-hint" style="padding:30px;text-align:center;grid-column:1/-1">${t}</p>`; };
  function drawIcons() {
    const grid = $("al-ic-grid");
    if (!(IC.items || []).length) { iconMsg("Aucun résultat. Essayez un autre mot, en anglais (« lighthouse », « tent », « wave »…)."); return; }
    grid.innerHTML = "";
    for (const it of IC.items) {
      const b = document.createElement("button");
      b.className = "al-ic"; b.title = it.label;
      const im = document.createElement("img");          // through <img>: a drawing, never live markup
      im.alt = ""; im.src = iconSrc({ svg: it.svg, color: IC.color });
      b.appendChild(im);
      b.addEventListener("click", () => addIcon(it));
      grid.appendChild(b);
    }
  }
  function addIcon(it) {
    const f = fmt(), w = 0.14, h = w * f.w / f.h, pg = page();
    pg.extras = pg.extras || [];
    pg.extras.push({ id: uid(), kind: "icon", r: [0.5 - w / 2, 0.5 - h / 2, w, h], svg: it.svg, color: IC.color, name: it.id, opacity: 1 });
    A.sel = { k: "extra", i: pg.extras.length - 1 };
    closeIcons();
    commit();
  }

  // ── background panel ──────────────────────────────────
  const BG_SCOPES = [["all", "Toutes les pages"], ["left", "Pages de gauche"], ["right", "Pages de droite"], ["page", "Cette page seulement"]];
  const bgGet = () => A.bgScope === "page" ? page().bg : (A.album.bg || {})[A.bgScope];
  function bgEdit(fn) {
    let B;
    if (A.bgScope === "page") B = page().bg = page().bg || {};
    else { A.album.bg = A.album.bg || {}; B = A.album.bg[A.bgScope] = A.album.bg[A.bgScope] || {}; }
    fn(B);
  }
  function bgClear() {
    if (A.bgScope === "page") delete page().bg; else if (A.album.bg) delete A.album.bg[A.bgScope];
  }
  function drawBg() {
    const box = $("al-bg");
    if (!box || !A.album || !page()) return;
    box.innerHTML = "";
    const B = bgGet() || {}, L = look();
    const sel = document.createElement("select");
    sel.className = "filter-input"; sel.style.width = "100%"; sel.style.marginBottom = "10px";
    sel.innerHTML = BG_SCOPES.map(([v, l]) => `<option value="${v}">${l}${v !== "page" && (A.album.bg || {})[v] ? " ●" : v === "page" && page().bg ? " ●" : ""}</option>`).join("");
    sel.value = A.bgScope;
    sel.addEventListener("change", () => { A.bgScope = sel.value; drawBg(); });
    box.appendChild(sel);
    const wrap = document.createElement("div"); wrap.className = "al-custom";
    const ctl = (label, kind, value, set, o = {}) => {
      const row = document.createElement("label");
      row.textContent = label;
      const inp = document.createElement("input"); inp.type = kind; inp.value = value;
      if (kind === "range") { inp.min = o.min; inp.max = o.max; inp.step = o.step; }
      const read = () => kind === "range" ? parseFloat(inp.value) : inp.value;
      inp.addEventListener("input", () => { bgEdit(b => set(b, read())); drawCanvas(); scheduleSave(); });
      inp.addEventListener("change", () => { bgEdit(b => set(b, read())); pushHistory(); scheduleSave(); drawCanvas(); drawStrip(); drawBg(); });
      row.appendChild(inp); wrap.appendChild(row);
    };
    ctl("Couleur", "color", B.color || L.bg, (b, v) => { b.color = v; });
    if (B.pid || B.src) ctl("Opacité image", "range", B.opacity ?? 0.35, (b, v) => { b.opacity = v; }, { min: 0.03, max: 1, step: 0.01 });
    ctl("Couleur du texte", "color", B.fg || L.fg, (b, v) => { b.fg = v; });
    box.appendChild(wrap);
    const row = (list) => {
      const r = document.createElement("div"); r.className = "al-btnrow";
      for (const [label, fn, cls] of list) { const b = document.createElement("button"); b.className = "btn " + (cls || "btn-outline"); b.textContent = label; b.addEventListener("click", fn); r.appendChild(b); }
      box.appendChild(r);
    };
    row([["Photo du projet…", () => openPicker(null, pid => { bgEdit(b => { b.pid = pid; delete b.src; b.opacity = b.opacity ?? 0.35; }); commit(); })],
         ["Image…", () => { A.fileFor = "bg"; $("al-file").click(); }]]);
    const rm = [];
    if (B.pid || B.src) rm.push(["Retirer l'image", () => { bgEdit(b => { delete b.pid; delete b.src; }); commit(); }, "btn-ghost"]);
    if (bgGet()) rm.push(["Retirer ce fond", () => { bgClear(); commit(); }, "btn-ghost"]);
    if (rm.length) row(rm);
    const eff = page().bg ? "son propre fond" : A.cur > 0 && (A.album.bg || {})[A.cur % 2 ? "right" : "left"] ? `le fond des pages de ${A.cur % 2 ? "droite" : "gauche"}`
              : (A.album.bg || {}).all ? "le fond de toutes les pages" : "le fond du thème";
    const p = document.createElement("p"); p.className = "al-hint";
    p.textContent = `La page ${A.cur + 1} utilise ${eff}. Le plus précis l'emporte : cette page, puis gauche / droite, puis toutes.`;
    box.appendChild(p);
  }

  // ── style panel ───────────────────────────────────────
  const CUSTOM = [
    ["bg", "Fond de page", "color"], ["fg", "Texte", "color"], ["muted", "Texte discret", "color"], ["accent", "Couleur d'accent", "color"],
    ["title", "Police des titres", "font"], ["text", "Police du texte", "font"],
    ["fs", "Taille du texte", "range", 0.6, 1.8, 0.05], ["upper", "Titres en majuscules", "check"],
    ["margin", "Marge de la page", "range", 0, 12, 0.2], ["gap", "Espace entre photos", "range", 0, 6, 0.1],
    ["radius", "Coins arrondis", "range", 0, 5, 0.1],
    ["bw", "Bordure des photos", "range", 0, 3, 0.1], ["bc", "Couleur de bordure", "color"],
    ["shadow", "Ombre", "check"], ["tilt", "Inclinaison", "range", 0, 5, 0.1],
  ];
  function drawStyle() {
    const L = look(), themes = $("al-themes"), box = $("al-custom");
    themes.innerHTML = "";
    for (const [k, t] of Object.entries(THEMES)) {
      const b = document.createElement("div");
      b.className = "al-theme" + (A.album.theme === k ? " active" : "");
      Object.assign(b.style, { background: (t.bgimg ? t.bgimg.replace(/(\d*\.?\d+)em/g, (_, n) => n * 1.1 + "px") + ", " : "") + t.bg, color: t.fg, fontFamily: FALLBACK(t.title) });
      b.innerHTML = `<b>Aa</b>${t.label}`;
      b.addEventListener("click", () => { A.album.theme = k; A.album.style = {}; commit(); });
      themes.appendChild(b);
    }
    box.innerHTML = "";
    for (const [key, label, kind, min, max, step] of CUSTOM) {
      const row = document.createElement("label");
      row.textContent = label;
      let inp;
      if (kind === "font") {
        inp = document.createElement("select");
        inp.className = "filter-input";
        inp.innerHTML = FONTS.map(f => `<option style="font-family:${FALLBACK(f).replace(/"/g, "'")}">${f}</option>`).join("");
        inp.value = L[key];
      } else {
        inp = document.createElement("input");
        inp.type = kind === "check" ? "checkbox" : kind;
        if (kind === "range") { inp.min = min; inp.max = max; inp.step = step; }
        if (kind === "check") inp.checked = !!L[key]; else inp.value = L[key] ?? (key === "accent" ? L.muted : "");
      }
      const read = () => kind === "check" ? inp.checked : kind === "range" ? parseFloat(inp.value) : inp.value;
      const live = () => {
        A.album.style = { ...(A.album.style || {}), [key]: read() };
        document.querySelectorAll("#al-canvas .al-page, #al-pages .al-page").forEach(applyLook);
        scheduleSave();
      };
      inp.addEventListener("input", live);
      inp.addEventListener("change", () => { live(); pushHistory(); });
      row.appendChild(inp);
      box.appendChild(row);
    }
    drawBg();
    document.querySelectorAll(".al-side-body").forEach(b => { b.style.display = b.dataset.tab === A.side ? "" : "none"; });
    document.querySelectorAll("#al-side-tabs button").forEach(b => b.classList.toggle("active", b.dataset.v === A.side));
  }

  // ── history / saving ──────────────────────────────────
  const snap = () => JSON.stringify({ pages: A.album.pages, theme: A.album.theme, format: A.album.format,
                                      style: A.album.style || {}, overlays: A.album.overlays || [], bg: A.album.bg || {} });
  function pushHistory() {
    const s = snap();
    if (A.history[A.hIndex] === s) return;
    A.history = A.history.slice(0, A.hIndex + 1);
    A.history.push(s);
    if (A.history.length > 80) A.history.shift();
    A.hIndex = A.history.length - 1;
  }
  function commit() { pushHistory(); scheduleSave(); drawAll(); }
  function restore(i) {
    if (i < 0 || i >= A.history.length) return;
    A.hIndex = i;
    Object.assign(A.album, JSON.parse(A.history[i]));
    A.cur = Math.min(A.cur, A.album.pages.length - 1); A.sel = null;
    $("al-format").value = A.album.format;
    scheduleSave(); drawAll();
  }
  function setSaved(t) { $("al-save").textContent = t; }
  function scheduleSave() { setSaved("Enregistrement…"); clearTimeout(A.saveTimer); A.saveTimer = setTimeout(saveNow, 700); }
  async function saveNow() {
    clearTimeout(A.saveTimer); A.saveTimer = null;
    if (!A.album) return;
    try {
      await api("PUT", `/api/albums/${A.album.id}`, { name: A.album.name, theme: A.album.theme, format: A.album.format,
                                                      pages: A.album.pages, style: A.album.style || {}, overlays: A.album.overlays || [],
                                                      bg: A.album.bg || {} });
      setSaved("Enregistré automatiquement");
    } catch (e) { setSaved("⚠ Non enregistré"); toast("Erreur d'enregistrement : " + e.message, "error"); }
  }
  async function flushSave() { if (A.saveTimer) await saveNow(); }

  // ── preview ───────────────────────────────────────────
  function showPreview(i) {
    const spread = A.view === "spread", n = A.album.pages.length;
    A.pv = Math.min(Math.max(i, 0), (spread ? spreadCount() : n) - 1);
    const host = $("al-pv-stage");
    $("al-previewer").style.display = "flex";
    host.innerHTML = "";
    const list = spread ? spreadPages(A.pv) : [A.pv];
    const f = fmt(), r = host.getBoundingClientRect();
    const w = Math.max(60, Math.min(r.width / list.length, r.height * f.w / f.h));
    for (const p of list) {
      const el = typeof p === "number" ? pageEl(A.album.pages[p], { res: 1800 / list.length }) : ghostEl(p);
      el.style.width = w + "px";
      host.appendChild(el);
    }
    const nums = list.filter(p => typeof p === "number").map(p => p + 1);
    $("al-pv-pos").textContent = `${nums.join(" – ")} / ${n}`;
  }
  const closePreview = () => { $("al-previewer").style.display = "none"; $("al-pv-stage").innerHTML = ""; };

  // ── export : print files ──────────────────────────────
  /** Pages as a print service wants them: cover first, back cover last, even count, minimum */
  function printPages(fix, book) {
    const pages = [...A.album.pages];
    if (!fix) return pages;
    const B = A.meta.books[book];
    const back = { id: "back", type: "blank" };
    let n = pages.length + 1;
    while (n < B.min || n % 2) { pages.push({ id: "blank" + n, type: "blank" }); n++; }
    pages.push(back);
    return pages;
  }
  function drawChecks() {
    const B = A.meta.books[$("al-ex-book").value], f = fmt(), n = A.album.pages.length, fix = $("al-ex-fix").checked;
    const total = printPages(fix, $("al-ex-book").value).length;
    const px = Math.round(f.w / 25.4 * A.meta.dpi), py = Math.round(f.h / 25.4 * A.meta.dpi);
    const rows = [
      [true, `Format des pages : ${f.label} — ${f.w} × ${f.h} mm, soit ${px} × ${py} px à ${A.meta.dpi} dpi`],
      [true, `Couverture en première page`],
      [fix, fix ? `4ᵉ de couverture ajoutée en dernière page` : `Pas de 4ᵉ de couverture : la dernière page de l'album servira de dos`],
      [total % 2 === 0, `${total} pages au total` + (total % 2 ? " — il faut un nombre pair" : "") + (fix && total !== n + 1 ? ` (${total - n - 1} page(s) blanche(s) ajoutée(s))` : "")],
      [total >= B.min, total >= B.min ? `Minimum de ${B.min} pages atteint` : `Minimum ${B.min} pages pour ce type de livre`],
      [total <= B.max, total <= B.max ? `Maximum de ${B.max} pages respecté` : `Trop de pages : maximum ${B.max} pour ce type de livre`],
      [null, `Gardez textes et logos à plus de ${A.meta.safe_mm} mm du bord : bouton « ▢ Zone sûre » sous la page`],
    ];
    $("al-ex-checks").innerHTML = rows.map(([ok, t]) => `<div class="${ok === null ? "info" : ok ? "ok" : "bad"}">${ok === null ? "ℹ" : ok ? "✓" : "✕"} ${t}</div>`).join("");
  }
  function openExport() {
    $("al-ex-book").innerHTML = Object.entries(A.meta.books).map(([k, b]) => `<option value="${k}">${b.label} (${b.min} à ${b.max} pages)</option>`).join("");
    $("al-ex-form").style.display = ""; $("al-ex-progress").style.display = "none";
    $("al-export-dlg").style.display = "flex";
    drawChecks();
  }

  let cssText = null;
  const dataCache = new Map();
  async function dataUrl(url) {
    if (dataCache.has(url)) return dataCache.get(url);
    const blob = await (await fetch(url)).blob();
    const d = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    dataCache.set(url, d);
    return d;
  }
  /** Draw one page at W × H pixels: the real DOM page, serialised into an SVG image */
  async function rasterPage(pg, W, H) {
    if (!cssText) cssText = await (await fetch("/static/css/album.css")).text();
    const el = pageEl(pg, { res: W, print: true });
    Object.assign(el.style, { width: W + "px", height: H + "px", aspectRatio: "auto" });
    for (const img of el.querySelectorAll("img")) img.setAttribute("src", await dataUrl(img.src));
    const xml = new XMLSerializer().serializeToString(el);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;height:${H}px"><style><![CDATA[${cssText}]]></style>${xml}</div></foreignObject></svg>`;
    // a data: URL (not blob:) – otherwise Chrome marks the canvas as tainted and refuses to export it
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("rendu de page impossible")); i.src = url; });
      const cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      const ctx = cv.getContext("2d");
      ctx.fillStyle = look().bg; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(im, 0, 0, W, H);
      return await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("export de page impossible")), "image/jpeg", 0.92));
    } finally { dataCache.clear(); }
  }

  async function exportFiles() {
    await flushSave();
    const f = fmt(), pages = printPages($("al-ex-fix").checked, $("al-ex-book").value);
    const W = Math.round(f.w / 25.4 * A.meta.dpi), H = Math.round(f.h / 25.4 * A.meta.dpi);
    $("al-ex-form").style.display = "none"; $("al-ex-progress").style.display = "";
    const base = `/api/albums/${A.album.id}/export`;
    try {
      await api("POST", `${base}/start`);
      for (let i = 0; i < pages.length; i++) {
        $("al-ex-text").textContent = `Création des pages… ${i + 1} / ${pages.length}`;
        $("al-ex-bar").value = i / pages.length * 100;
        const blob = await rasterPage(pages[i], W, H);
        const r = await fetch(`${base}/page/${i + 1}`, { method: "POST", body: blob });
        if (!r.ok) throw new Error("envoi de la page " + (i + 1));
      }
      $("al-ex-text").textContent = "Assemblage du PDF…"; $("al-ex-bar").value = 100;
      const res = await api("POST", `${base}/finish`);
      $("al-ex-text").innerHTML = `✓ <b>${res.pages} pages</b> créées.<br>PDF : ${res.size_mb} Mo, plus une image JPEG par page.<br><span class="al-hint">${res.dir}</span>`;
      const b = document.createElement("button");
      b.className = "btn btn-primary"; b.textContent = "📂 Ouvrir le dossier"; b.style.marginTop = "12px";
      b.addEventListener("click", () => api("POST", `${base}/open`).catch(e => toast(e.message, "error")));
      $("al-ex-text").appendChild(document.createElement("br")); $("al-ex-text").appendChild(b);
    } catch (e) {
      $("al-ex-text").textContent = "Erreur : " + e.message;
    }
  }

  /** Quick PDF through the browser's print dialog (vector text, lighter file) */
  async function exportQuick() {
    await flushSave();
    $("al-export-dlg").style.display = "none";
    const f = fmt();
    let rootEl = $("al-print-root");
    if (!rootEl) { rootEl = document.createElement("div"); rootEl.id = "al-print-root"; document.body.appendChild(rootEl); }
    rootEl.innerHTML = `<style>@page { size: ${f.w}mm ${f.h}mm; margin: 0; }</style>`;
    for (const pg of printPages($("al-ex-fix").checked, $("al-ex-book").value)) {
      const el = pageEl(pg, { res: 2400, print: true });
      el.style.width = f.w + "mm"; el.style.height = f.h + "mm";
      rootEl.appendChild(el);
    }
    const imgs = [...rootEl.querySelectorAll("img")];
    let done = 0;
    toast(`Préparation du PDF… 0 / ${imgs.length} photos`, "info", 600000);
    await Promise.all(imgs.map(img => new Promise(res => {
      const ok = () => { done++; if (done % 5 === 0 || done === imgs.length) toast(`Préparation du PDF… ${done} / ${imgs.length} photos`, "info", 600000); res(); };
      if (img.complete) ok(); else { img.onload = ok; img.onerror = ok; }
    })));
    toast("Dans la fenêtre qui s'ouvre, choisissez « Enregistrer au format PDF »", "success", 9000);
    const prev = document.title;
    document.title = A.album.name.replace(/_/g, " ");
    const cleanup = () => { document.title = prev; rootEl.innerHTML = ""; window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
    setTimeout(() => window.print(), 300);
  }

  // ── events ────────────────────────────────────────────
  $("al-new").addEventListener("click", () => openDialog("new"));
  $("al-new2").addEventListener("click", () => openDialog("new"));
  $("al-dlg-cancel").addEventListener("click", () => { $("al-dialog").style.display = "none"; });
  $("al-dlg-ok").addEventListener("click", runDialog);
  $("al-f-project").addEventListener("change", () => { if (dlgMode === "new") $("al-f-name").value = $("al-f-project").value.replace(/_/g, " "); });
  $("al-back").addEventListener("click", async () => { await flushSave(); showHome(); });
  $("al-name").addEventListener("change", () => { A.album.name = $("al-name").value.trim() || A.album.name; scheduleSave(); });
  $("al-format").addEventListener("change", e => { A.album.format = e.target.value; commit(); });
  $("al-undo").addEventListener("click", () => restore(A.hIndex - 1));
  $("al-redo").addEventListener("click", () => restore(A.hIndex + 1));
  $("al-regen").addEventListener("click", () => openDialog("regen"));
  $("al-preview").addEventListener("click", () => showPreview(A.view === "spread" ? spreadOf(A.cur) : A.cur));
  $("al-export").addEventListener("click", openExport);
  $("al-ex-close").addEventListener("click", () => { $("al-export-dlg").style.display = "none"; });
  $("al-ex-book").addEventListener("change", drawChecks);
  $("al-ex-fix").addEventListener("change", drawChecks);
  $("al-ex-go").addEventListener("click", exportFiles);
  $("al-ex-quick").addEventListener("click", exportQuick);
  $("al-prev").addEventListener("click", () => go(-1));
  $("al-next").addEventListener("click", () => go(1));
  function go(d) {
    let i = A.cur + d;
    if (A.view === "spread") {                        // one whole spread at a time
      const s = spreadOf(A.cur) + d;
      if (s < 0 || s >= spreadCount()) return;
      i = s === 0 ? 0 : s === 1 ? 1 : 2 * (s - 1);
    }
    if (i < 0 || i >= A.album.pages.length) return;
    A.cur = i; A.sel = null; drawPage();
  }
  $("al-view").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    A.view = b.dataset.v;
    try { localStorage.setItem("ps-album-view", A.view); } catch { /* private mode */ }
    drawStrip(); drawPage();
  });
  $("al-ic-close").addEventListener("click", closeIcons);
  $("al-icons").addEventListener("click", e => { if (e.target === $("al-icons")) closeIcons(); });
  let icTimer = null;
  $("al-ic-q").addEventListener("input", e => { IC.q = e.target.value; clearTimeout(icTimer); icTimer = setTimeout(searchIcons, 350); });
  $("al-ic-q").addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") closeIcons(); });
  $("al-ic-kind").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { IC.kind = b.dataset.v; searchIcons(); } });
  $("al-ic-color").addEventListener("input", e => { IC.color = e.target.value; drawIcons(); });
  function move(d) {
    const i = A.cur, j = i + d, p = A.album.pages;
    if (i === 0 || j < 1 || j >= p.length) return;
    [p[i], p[j]] = [p[j], p[i]]; A.cur = j; commit();
  }
  $("al-up").addEventListener("click", () => move(-1));
  $("al-down").addEventListener("click", () => move(1));
  $("al-del").addEventListener("click", () => {
    if (page().type === "cover") return;
    A.album.pages.splice(A.cur, 1); A.cur = Math.min(A.cur, A.album.pages.length - 1); A.sel = null; commit();
  });
  for (const id of ["al-add", "al-el-add"]) $(id).addEventListener("click", e => {
    e.stopPropagation();
    const m = $(id).parentElement, open = m.classList.contains("open");
    document.querySelectorAll("#app-album .menu").forEach(x => x.classList.remove("open"));
    m.classList.toggle("open", !open);
  });
  document.addEventListener("click", () => document.querySelectorAll("#app-album .menu").forEach(x => x.classList.remove("open")));
  $("al-add-menu").addEventListener("click", e => {
    const kind = e.target.dataset.add; if (!kind) return;
    addPage(kind, A.cur + 1);
  });
  $("al-el-menu").addEventListener("click", e => { const k = e.target.dataset.el; if (k) addElement(k); });
  $("al-file").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) addImage(f); });
  $("al-safe").addEventListener("click", () => { A.safe = !A.safe; drawCanvas(); drawNav(); });
  $("al-tray-seg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { A.tray = b.dataset.v; drawTray(); } });
  $("al-side-tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { A.side = b.dataset.v; drawStyle(); } });
  $("al-style-reset").addEventListener("click", () => { A.album.style = {}; commit(); });
  $("al-pick-seg").addEventListener("click", e => { const b = e.target.closest("button"); if (b && A.pick) { A.pick.filter = b.dataset.v; drawPicker(); } });
  $("al-pick-size").addEventListener("click", e => { const b = e.target.closest("button"); if (b && A.pick) { A.pickSize = +b.dataset.v; drawPicker(); } });
  $("al-pick-close").addEventListener("click", closePicker);
  $("al-picker").addEventListener("click", e => { if (e.target === $("al-picker")) closePicker(); });
  $("al-pv-close").addEventListener("click", closePreview);
  $("al-pv-prev").addEventListener("click", () => showPreview(A.pv - 1));
  $("al-pv-next").addEventListener("click", () => showPreview(A.pv + 1));
  new ResizeObserver(() => { if (A.album && window.Shell.current === "album") drawCanvas(); }).observe($("al-stage"));

  function deleteSelected() {
    const pg = page(), s = A.sel;
    if (!s) return;
    if (s.k === "slot") { if ((pg.items || [])[s.i]) pg.items[s.i] = null; else return; }
    else if (s.k === "extra") pg.extras.splice(s.i, 1);
    else if (s.k === "over") A.album.overlays.splice(s.i, 1);
    else return;
    A.sel = null; commit();
  }
  document.addEventListener("keydown", e => {
    if (window.Shell.current !== "album" || !A.album) return;
    if (A.pick) { if (e.key === "Escape") closePicker(); return; }
    if ($("al-icons").style.display !== "none") { if (e.key === "Escape") closeIcons(); return; }
    if ($("al-export-dlg").style.display !== "none") { if (e.key === "Escape") $("al-export-dlg").style.display = "none"; return; }
    if ($("al-previewer").style.display !== "none") {
      if (e.key === "Escape") closePreview();
      else if (e.key === "ArrowLeft") showPreview(A.pv - 1);
      else if (e.key === "ArrowRight" || e.key === " ") showPreview(A.pv + 1);
      return;
    }
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); restore(A.hIndex - 1); }
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); restore(A.hIndex + 1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
    else if (e.key === "ArrowRight" || e.key === "PageDown") go(1);
    else if (e.key === "Escape") { A.sel = null; drawCanvas(); drawProps(); }
    else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
  });
  window.addEventListener("beforeunload", () => { if (A.saveTimer) saveNow(); });

  window.Shell.register("album", {
    onShow(arg) {
      if (arg && arg.project) { showHome().then(() => openDialog("new", arg.project)); return; }
      if (!A.album) showHome(); else drawAll();
    },
    onHide() { flushSave(); },
  });
  window.Album = { state: A, rasterPage };
})();
