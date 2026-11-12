/* ══════════════════════════════════════════════════════
   PhotoChooser – Colour page (grading + crop editor)
   Non-destructive: edits are stored in project.json and
   rendered by the server on export / thumbnails.
══════════════════════════════════════════════════════ */
(function () {
  const { state, api, toast, updatePhoto, isVideo } = window.App;
  const G = window.Grade;
  const $ = id => document.getElementById(id);

  const root = $("editor");
  const canvas = $("ed-canvas");
  const stage = $("ed-stage");
  const content = $("ed-content");
  const cropBox = $("crop-box");
  const wipe = $("ed-wipe");

  let renderer = null, scopes = null, pz = null;

  const Ed = {
    open: false,
    idx: 0,
    photo: null,
    grade: G.defaultGrade(),
    geo: G.defaultGeo(),
    history: [], hIndex: -1,
    tab: "primaries",
    bypass: false,
    split: (() => { try { return localStorage.getItem("pc-editor-split") === "0" ? -1 : 0.5; } catch { return 0.5; } })(),   // < 0 : off
    loading: false,
    saveTimer: null,
    savePromise: null,
    dirty: false,
    onClose: null,
    luts: [],
    lutCache: {},
    curveCh: "y",
    fullW: 0, fullH: 0,   // full-res upright size of the source
    looksDirty: true,
    mode: (() => { try { return localStorage.getItem("pc-editor-mode") || "simple"; } catch { return "simple"; } })(),
  };
  const homeTab = () => (Ed.mode === "simple" ? "simple" : "primaries");

  // ── Rendering ──────────────────────────────────────────
  let rafPending = false;
  let lastScale = 0;
  function requestRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; doRender(); });
  }

  function currentLut() {
    const name = Ed.grade.lut;
    return name && Ed.lutCache[name] && Ed.lutCache[name] !== "loading" ? Ed.lutCache[name] : null;
  }

  function doRender() {
    if (!renderer || !renderer.srcW || Ed.loading) return;
    const cropMode = Ed.tab === "crop";
    renderer.setLut(currentLut());
    const opts = { grade: Ed.grade, geo: Ed.geo, ignoreCrop: cropMode, bypass: Ed.bypass,
                   split: wipeHidden() ? -1 : Ed.split };
    const view = { ...opts, overlay: overlayOpt() };
    // full-res geometry → natural content size (for zoom %)
    const k = Ed.fullW / renderer.srcW;
    const g = G.geometry(renderer.srcW, renderer.srcH, Ed.geo, cropMode);
    pz.setSize(g.outW * k, g.outH * k, true);
    lastScale = pz.s;
    // backing store = what is actually visible (sharp + fast)
    const dpr = window.devicePixelRatio || 1;
    const shown = Math.max(g.outW, g.outH) * k * pz.s * dpr;
    renderer.render({ ...view, maxDim: Math.min(4096, Math.max(256, Math.ceil(shown))) });
    updateOverlays();
    // scopes on a small off-screen render (ignore the wipe)
    if (Ed.mode !== "simple") scopes.update(renderer.renderPixels({ ...opts, split: -1 }, 640));
    renderWheelValues();
  }

  // ── History / saving ───────────────────────────────────
  const snapshot = () => JSON.stringify({ grade: Ed.grade, geo: Ed.geo });

  function resetHistory() {
    Ed.history = [snapshot()];
    Ed.hIndex = 0;
    updateUndoButtons();
  }

  function commit() {
    const s = snapshot();
    if (Ed.history[Ed.hIndex] === s) return;
    Ed.history = Ed.history.slice(0, Ed.hIndex + 1);
    Ed.history.push(s);
    if (!Ed.keepAuto && Ed.autoRef) { Ed.autoRef = null; renderSimple(); }   // manual change: "Intensité" no longer describes the grade
    if (Ed.history.length > 200) Ed.history.shift();
    Ed.hIndex = Ed.history.length - 1;
    updateUndoButtons();
    scheduleSave();
  }

  function restore(i) {
    if (i < 0 || i >= Ed.history.length) return;
    Ed.hIndex = i;
    const s = JSON.parse(Ed.history[i]);
    Ed.grade = s.grade; Ed.geo = s.geo;
    Ed.autoRef = null;
    reconcilePaint();
    refreshUI();
    requestRender();
    updateUndoButtons();
    scheduleSave();
  }

  function updateUndoButtons() {
    $("ed-undo").disabled = Ed.hIndex <= 0;
    $("ed-redo").disabled = Ed.hIndex >= Ed.history.length - 1;
  }

  function setSaveState(s) {
    const el = $("ed-save");
    el.className = "ed-save " + s;
    el.textContent = { dirty: "Enregistrement…", saving: "Enregistrement…", saved: "Enregistré automatiquement", error: "⚠ Erreur d'enregistrement", "": "" }[s] ?? "";
  }

  function scheduleSave() {
    Ed.dirty = true;
    setSaveState("dirty");
    clearTimeout(Ed.saveTimer);
    Ed.saveTimer = setTimeout(save, 600);
  }

  function currentEdits() {
    const e = { grade: G.clone(Ed.grade), geo: G.clone(Ed.geo) };
    return G.isIdentity(e) ? null : e;
  }

  async function save() {
    clearTimeout(Ed.saveTimer);
    if (!Ed.dirty || !Ed.photo) return Ed.savePromise;
    Ed.dirty = false;
    const photo = Ed.photo;
    setSaveState("saving");
    const p = (async () => {
      try {
        const edits = currentEdits();
        await uploadPaint(photo);
        const res = await api("PUT", `/api/projects/${encodeURIComponent(state.currentProject)}/photos/${photo.id}/edits`, { edits });
        updatePhoto(photo.id, { rev: res.rev, edits: res.edits });
        if (!Ed.dirty) setSaveState("saved");
      } catch (e) {
        Ed.dirty = true;
        setSaveState("error");
        toast("Erreur d'enregistrement : " + e.message, "error");
      }
    })();
    Ed.savePromise = p;
    return p;
  }

  async function flush() {
    if (Ed.dirty) await save();
    else if (Ed.savePromise) await Ed.savePromise;
  }

  // ── Open / close / navigate ────────────────────────────
  function photoList() { return state.photos; }

  async function open(idx, tab = "primaries", onClose) {
    if (!renderer) {
      try { init(); }
      catch (e) { toast("Éditeur indisponible : " + e.message, "error", 6000); return; }
    }
    Ed.onClose = onClose || null;
    Ed.open = true;
    root.style.display = "flex";
    Ed.task = tab === "crop" ? "crop" : "grade";
    root.classList.toggle("task-crop", Ed.task === "crop");
    $("ed-task").textContent = Ed.task === "crop" ? "Recadrage" : "Retouche";
    $("ed-reset").title = Ed.task === "crop" ? "Annuler le recadrage et la rotation" : "Revenir aux couleurs d'origine (le recadrage est conservé)";
    if (Ed.task === "grade" && Ed.tab === "crop") Ed.tab = "primaries";
    setMode(Ed.mode, Ed.task === "crop" ? "crop" : null);
    await loadPhoto(idx);
    loadLutList();
  }

  async function close() {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    await flush();
    Ed.open = false;
    root.style.display = "none";
    Ed.bypass = false;
    syncToggles();
    const cb = Ed.onClose; Ed.onClose = null;
    if (cb) cb(Ed.idx);
  }

  async function go(delta) {
    if (Ed.animating) return;
    const list = photoList();
    let i = Ed.idx + delta;
    while (i >= 0 && i < list.length && isVideo(list[i])) i += delta;
    if (i < 0 || i >= list.length) return;
    await flush();
    await loadPhoto(i);
  }

  async function loadPhoto(idx) {
    const photo = photoList()[idx];
    if (!photo) return;
    Ed.idx = idx;
    Ed.photo = photo;
    const e = G.normalize(photo.edits);
    Ed.grade = e.grade; Ed.geo = e.geo;
    Ed.dirty = false;
    setSaveState("");
    resetZones();
    Ed.autoRef = null;
    resetHistory();
    refreshUI();
    $("ed-filename").textContent = `${photo.filename}  ·  ${idx + 1} / ${photoList().length}`;
    $("ed-prev").disabled = !photoList().slice(0, idx).some(p => !isVideo(p));
    $("ed-next").disabled = !photoList().slice(idx + 1).some(p => !isVideo(p));

    Ed.loading = true;
    $("ed-loading").style.display = "flex";
    const maxTex = Math.min(4096, renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE));
    let img;
    try {
      img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i); i.onerror = rej;
        i.src = `/api/render/${photo.id}?${window.App.projQ()}&max=${maxTex}&raw=1`;
      });
    } catch {
      if (Ed.photo === photo) { toast("Impossible de charger la photo", "error"); $("ed-loading").style.display = "none"; }
      return;
    }
    if (Ed.photo !== photo) return;        // user navigated meanwhile
    renderer.setImage(img);
    // full-resolution upright size (metadata may be pre-rotation for legacy entries)
    let fw = photo.width || img.naturalWidth, fh = photo.height || img.naturalHeight;
    if ((fw > fh) !== (img.naturalWidth > img.naturalHeight)) [fw, fh] = [fh, fw];
    Ed.fullW = Math.max(fw, img.naturalWidth);
    Ed.fullH = Ed.fullW * img.naturalHeight / img.naturalWidth;
    Ed.loading = false;
    $("ed-loading").style.display = "none";
    Ed.looksDirty = true;
    ensureLut().then(requestRender);
    loadZoneData(photo);
    pz.fit();
    requestRender();
    if (Ed.tab === "looks") renderLookThumbs();
  }

  // ── LUTs ───────────────────────────────────────────────
  async function loadLutList() {
    try { Ed.luts = await api("GET", "/api/luts"); } catch { Ed.luts = []; }
    const sel = $("lut-select");
    sel.innerHTML = `<option value="">Aucune</option>` + Ed.luts.map(n => `<option value="${n}">${n.replace(/\.cube$/i, "")}</option>`).join("");
    sel.value = Ed.grade.lut || "";
  }

  async function ensureLut() {
    const name = Ed.grade.lut;
    if (!name || Ed.lutCache[name]) return;
    Ed.lutCache[name] = "loading";
    try {
      const txt = await (await fetch(`/api/luts/${encodeURIComponent(name)}`)).text();
      Ed.lutCache[name] = G.parseCube(txt);
    } catch (e) {
      delete Ed.lutCache[name];
      toast(`LUT « ${name} » illisible : ${e.message}`, "error");
    }
  }

  // ── Widgets ────────────────────────────────────────────
  const fields = [];   // {el, get, fmt} for refreshUI

  /** Resolve-style scrubbable numeric field: drag ←→, dbl-click resets, click to type */
  function scrub(parent, { label, get, set, min, max, step, def, sens, fmt = v => v.toFixed(2), cls = "" }) {
    const wrap = document.createElement("div");
    wrap.className = "scrub " + cls;
    wrap.innerHTML = `<label>${label}</label><input type="text" readonly spellcheck="false"/>`;
    const input = wrap.querySelector("input");
    parent.appendChild(wrap);
    let drag = null;
    const clampV = v => Math.min(max, Math.max(min, v));
    const show = () => { input.value = fmt(get()); wrap.classList.toggle("changed", Math.abs(get() - def) > 1e-6); };

    input.addEventListener("pointerdown", e => {
      if (!input.readOnly) return;
      e.preventDefault();
      drag = { x: e.clientX, v: get(), moved: false };
      input.setPointerCapture(e.pointerId);
    });
    input.addEventListener("pointermove", e => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 2) drag.moved = true;
      if (!drag.moved) return;
      const k = e.shiftKey ? 0.1 : e.ctrlKey ? 4 : 1;
      set(clampV(drag.v + dx * sens * k));
      show(); requestRender();
    });
    input.addEventListener("pointerup", () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (moved) commit();
      else { input.readOnly = false; input.select(); }
    });
    input.addEventListener("dblclick", () => { input.readOnly = true; set(def); show(); requestRender(); commit(); });
    const endEdit = () => {
      if (input.readOnly) return;
      input.readOnly = true;
      const v = parseFloat(input.value.replace(",", "."));
      if (!isNaN(v)) { set(clampV(v)); requestRender(); commit(); }
      show();
    };
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { endEdit(); input.blur(); }
      else if (e.key === "Escape") { input.readOnly = true; show(); input.blur(); }
      e.stopPropagation();
    });
    input.addEventListener("blur", endEdit);
    fields.push({ show });
    show();
    return wrap;
  }

  // ── Colour wheels ──────────────────────────────────────
  const wheels = {};
  let wheelDisc = null;

  function makeWheelDisc(size) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    const R = size / 2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - R) / R, dy = (R - y - 0.5) / R, d = Math.hypot(dx, dy);
      if (d > 1) continue;
      // same (Cb, Cr) layout as the wheels' effect and the vectorscope
      const Y = 0.5, cb = dx * 0.32, cr = dy * 0.32;
      let r = Y + 1.5748 * cr, b = Y + 1.8556 * cb, g = (Y - 0.2126 * r - 0.0722 * b) / 0.7152;
      const o = (y * size + x) * 4, fade = 0.55 + 0.45 * d;
      img.data[o] = Math.min(255, Math.max(0, (0.5 + (r - 0.5) * fade) * 235));
      img.data[o + 1] = Math.min(255, Math.max(0, (0.5 + (g - 0.5) * fade) * 235));
      img.data[o + 2] = Math.min(255, Math.max(0, (0.5 + (b - 0.5) * fade) * 235));
      img.data[o + 3] = d > 0.985 ? (1 - d) / 0.015 * 255 : 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  const WHEEL_DEFS = [
    { key: "lift",   label: "Lift",   sub: "Ombres",        mdef: 0, mmin: -0.5, mmax: 0.5, msens: 0.001 },
    { key: "gamma",  label: "Gamma",  sub: "Tons moyens",   mdef: 0, mmin: -0.5, mmax: 0.5, msens: 0.001 },
    { key: "gain",   label: "Gain",   sub: "Hautes lum.",   mdef: 1, mmin: 0,    mmax: 2.5, msens: 0.003 },
    { key: "offset", label: "Offset", sub: "Global",        mdef: 0, mmin: -0.5, mmax: 0.5, msens: 0.001 },
  ];

  function buildWheel(parent, def) {
    const box = document.createElement("div");
    box.className = "wheel";
    box.innerHTML = `
      <div class="wheel-head"><span class="wheel-title">${def.label}</span><span class="wheel-sub">${def.sub}</span>
        <button class="wheel-reset" title="Réinitialiser">↺</button></div>
      <canvas class="wheel-canvas"></canvas>
      <div class="wheel-vals"><span class="v-r"></span><span class="v-g"></span><span class="v-b"></span></div>`;
    parent.appendChild(box);
    const cv = box.querySelector("canvas");
    const size = 132, dpr = window.devicePixelRatio || 1;
    cv.width = cv.height = size * dpr;
    cv.style.width = cv.style.height = size + "px";
    const ctx = cv.getContext("2d");
    const w = { box, cv, ctx, size, dpr, def };
    wheels[def.key] = w;

    let drag = null;
    cv.addEventListener("pointerdown", e => {
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, wx: Ed.grade[def.key].x, wy: Ed.grade[def.key].y };
      cv.setPointerCapture(e.pointerId);
      box.classList.add("active");
    });
    cv.addEventListener("pointermove", e => {
      if (!drag) return;
      const k = (e.shiftKey ? 0.1 : 0.45) / (size / 2);
      let x = drag.wx + (e.clientX - drag.x) * k, y = drag.wy - (e.clientY - drag.y) * k;
      const d = Math.hypot(x, y);
      if (d > 1) { x /= d; y /= d; }
      Ed.grade[def.key].x = x; Ed.grade[def.key].y = y;
      drawWheel(def.key); requestRender();
    });
    const end = () => { if (drag) { drag = null; box.classList.remove("active"); commit(); } };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("dblclick", () => { Ed.grade[def.key].x = 0; Ed.grade[def.key].y = 0; drawWheel(def.key); requestRender(); commit(); });
    box.querySelector(".wheel-reset").addEventListener("click", () => {
      Ed.grade[def.key] = G.defaultGrade()[def.key];
      refreshUI(); requestRender(); commit();
    });
    scrub(box, {
      label: "Maître", cls: "wheel-master",
      get: () => Ed.grade[def.key].m, set: v => { Ed.grade[def.key].m = v; },
      min: def.mmin, max: def.mmax, step: 0.01, def: def.mdef, sens: def.msens,
      fmt: v => v.toFixed(3),
    });
  }

  function drawWheel(key) {
    const w = wheels[key], { ctx, size, dpr } = w;
    const S = size * dpr, R = S / 2;
    if (!wheelDisc) wheelDisc = makeWheelDisc(256);
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(wheelDisc, 6 * dpr, 6 * dpr, S - 12 * dpr, S - 12 * dpr);
    ctx.strokeStyle = "#00000055"; ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.arc(R, R, R - 6 * dpr, 0, Math.PI * 2); ctx.stroke();
    // cross-hair centre
    ctx.strokeStyle = "#ffffff40";
    ctx.beginPath(); ctx.moveTo(R - 6 * dpr, R); ctx.lineTo(R + 6 * dpr, R); ctx.moveTo(R, R - 6 * dpr); ctx.lineTo(R, R + 6 * dpr); ctx.stroke();
    const { x, y } = Ed.grade[key];
    const rr = R - 6 * dpr, px = R + x * rr, py = R - y * rr;
    if (Math.hypot(x, y) > 1e-4) {
      ctx.strokeStyle = "#ffffffaa"; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(R, R); ctx.lineTo(px, py); ctx.stroke();
    }
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(px, py, 5 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    w.box.classList.toggle("changed", Math.hypot(x, y) > 1e-4 || Math.abs(Ed.grade[key].m - w.def.mdef) > 1e-6);
  }

  function renderWheelValues() {
    const u = G.uniforms(Ed.grade);
    const vals = { lift: u.lift, gamma: G.wheelRGB(Ed.grade.gamma, G.K.gamma).map(v => v + Ed.grade.gamma.m),
                   gain: u.gain, offset: u.offset };
    for (const [k, v] of Object.entries(vals)) {
      const w = wheels[k]; if (!w) continue;
      const spans = w.box.querySelectorAll(".wheel-vals span");
      v.forEach((n, i) => { spans[i].textContent = n.toFixed(2); });
    }
  }

  // ── Primaries panel ────────────────────────────────────
  function buildPrimaries() {
    const top = $("prim-top"), bottom = $("prim-bottom"), wh = $("wheels");
    const f = (parent, key, label, o) => scrub(parent, {
      label, get: () => Ed.grade[key], set: v => { Ed.grade[key] = v; }, def: G.defaultGrade()[key], ...o });
    f(top, "ai", "Couleur IA", { min: 0, max: 100, sens: 0.3, fmt: v => v.toFixed(0) + " %" });
    f(top, "temp", "Temp.", { min: -100, max: 100, sens: 0.25, fmt: v => v.toFixed(1), cls: "temp" });
    f(top, "tint", "Teinte vert/mag.", { min: -100, max: 100, sens: 0.25, fmt: v => v.toFixed(1), cls: "tint" });
    f(top, "exposure", "Exposition", { min: -4, max: 4, sens: 0.01, fmt: v => (v > 0 ? "+" : "") + v.toFixed(2) + " IL" });
    f(top, "contrast", "Contraste", { min: 0, max: 2, sens: 0.003, fmt: v => v.toFixed(3) });
    f(top, "pivot", "Pivot", { min: 0.05, max: 0.95, sens: 0.002, fmt: v => v.toFixed(3) });
    for (const d of WHEEL_DEFS) buildWheel(wh, d);
    f(bottom, "clarity", "Clarté", { min: -100, max: 100, sens: 0.3, fmt: v => v.toFixed(1) });
    f(bottom, "sharpen", "Netteté", { min: 0, max: 100, sens: 0.3, fmt: v => v.toFixed(0) });
    f(bottom, "dehaze", "Anti-voile", { min: -100, max: 100, sens: 0.3, fmt: v => v.toFixed(1) });
    f(bottom, "boost", "Color boost", { min: -100, max: 100, sens: 0.3, fmt: v => v.toFixed(1) });
    f(bottom, "shadows", "Ombres", { min: -100, max: 100, sens: 0.3, fmt: v => v.toFixed(1) });
    f(bottom, "highlights", "Hautes lum.", { min: -100, max: 100, sens: 0.3, fmt: v => v.toFixed(1) });
    f(bottom, "sat", "Saturation", { min: 0, max: 100, sens: 0.15, fmt: v => v.toFixed(1) });
    f(bottom, "hue", "Rotation teinte", { min: 0, max: 100, sens: 0.1, fmt: v => v.toFixed(1) });
  }

  // ── Curves ─────────────────────────────────────────────
  const curveCanvas = $("curve-canvas");
  let curveDrag = null;
  const CH_COLORS = { y: "#e8e8e8", r: "#ff5a5a", g: "#5ad97a", b: "#5a8aff" };

  function curvePoints() { return Ed.grade.curves[Ed.curveCh]; }

  function curveGeom() {
    const r = curveCanvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (curveCanvas.width !== W) curveCanvas.width = W;
    if (curveCanvas.height !== H) curveCanvas.height = H;
    const pad = 10 * dpr;
    return { W, H, dpr, pad, cw: W - 2 * pad, ch: H - 2 * pad, rect: r };
  }

  function drawCurves() {
    if (Ed.tab !== "curves") return;
    const g = curveGeom(), ctx = curveCanvas.getContext("2d");
    const X = x => g.pad + x * g.cw, Y = y => g.pad + (1 - y) * g.ch;
    ctx.fillStyle = "#111419"; ctx.fillRect(0, 0, g.W, g.H);
    ctx.strokeStyle = "#ffffff12"; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(X(i / 4), Y(0)); ctx.lineTo(X(i / 4), Y(1)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(0), Y(i / 4)); ctx.lineTo(X(1), Y(i / 4)); ctx.stroke();
    }
    ctx.strokeStyle = "#ffffff22"; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(1), Y(1)); ctx.stroke(); ctx.setLineDash([]);
    // other channels faintly
    for (const ch of ["y", "r", "g", "b"]) {
      if (ch === Ed.curveCh) continue;
      const pts = Ed.grade.curves[ch];
      if (pts.length === 2 && pts[0][1] === 0 && pts[1][1] === 1) continue;
      drawSpline(ctx, pts, X, Y, CH_COLORS[ch] + "55", 1.5 * g.dpr, g);
    }
    const pts = curvePoints();
    drawSpline(ctx, pts, X, Y, CH_COLORS[Ed.curveCh], 2 * g.dpr, g);
    for (const [x, y] of pts) {
      ctx.fillStyle = "#111419"; ctx.strokeStyle = CH_COLORS[Ed.curveCh]; ctx.lineWidth = 2 * g.dpr;
      ctx.beginPath(); ctx.arc(X(x), Y(y), 4.5 * g.dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  function drawSpline(ctx, pts, X, Y, color, lw, g) {
    const f = G.makeSpline(pts);
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const x = i / 200;
      i ? ctx.lineTo(X(x), Y(f(x))) : ctx.moveTo(X(x), Y(f(x)));
    }
    ctx.stroke();
  }

  function curvePos(e) {
    const g = curveGeom();
    const x = ((e.clientX - g.rect.left) * g.dpr - g.pad) / g.cw;
    const y = 1 - ((e.clientY - g.rect.top) * g.dpr - g.pad) / g.ch;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), g };
  }

  function hitPoint(pos) {
    const pts = curvePoints(), g = pos.g;
    let best = -1, bd = 12 * g.dpr;
    pts.forEach(([x, y], i) => {
      const d = Math.hypot((x - pos.x) * g.cw, (y - pos.y) * g.ch);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  curveCanvas.addEventListener("pointerdown", e => {
    if (e.button === 2) return;
    const pos = curvePos(e);
    const pts = curvePoints();
    let i = hitPoint(pos);
    if (i < 0) {
      // new point on the curve's x, at the clicked y
      let k = pts.findIndex(p => p[0] > pos.x);
      if (k <= 0) return;
      if (pos.x - pts[k - 1][0] < 0.02 || pts[k][0] - pos.x < 0.02) return;
      pts.splice(k, 0, [pos.x, pos.y]);
      i = k;
    }
    curveDrag = { i };
    curveCanvas.setPointerCapture(e.pointerId);
    drawCurves(); requestRender();
  });
  curveCanvas.addEventListener("pointermove", e => {
    const pos = curvePos(e);
    curveCanvas.style.cursor = hitPoint(pos) >= 0 ? "grab" : "crosshair";
    if (!curveDrag) return;
    const pts = curvePoints(), i = curveDrag.i, n = pts.length;
    let x = pos.x;
    if (i === 0) x = 0;
    else if (i === n - 1) x = 1;
    else x = Math.min(pts[i + 1][0] - 0.01, Math.max(pts[i - 1][0] + 0.01, x));
    pts[i] = [x, pos.y];
    drawCurves(); requestRender();
  });
  const curveEnd = () => { if (curveDrag) { curveDrag = null; commit(); } };
  curveCanvas.addEventListener("pointerup", curveEnd);
  curveCanvas.addEventListener("pointercancel", curveEnd);
  const removePoint = e => {
    e.preventDefault();
    const pts = curvePoints(), i = hitPoint(curvePos(e));
    if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); drawCurves(); requestRender(); commit(); }
  };
  curveCanvas.addEventListener("dblclick", removePoint);
  curveCanvas.addEventListener("contextmenu", removePoint);

  $("curve-channels").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    Ed.curveCh = b.dataset.ch;
    document.querySelectorAll("#curve-channels button").forEach(x => x.classList.toggle("active", x === b));
    drawCurves();
  });
  $("curve-reset-ch").addEventListener("click", () => { Ed.grade.curves[Ed.curveCh] = [[0, 0], [1, 1]]; drawCurves(); requestRender(); commit(); });
  $("curve-reset-all").addEventListener("click", () => { Ed.grade.curves = G.defaultGrade().curves; drawCurves(); requestRender(); commit(); });

  // ── Looks & LUT ────────────────────────────────────────
  function buildLooks() {
    for (const grid of [$("looks-grid"), $("simple-looks")]) {
      grid.innerHTML = "";
      for (const look of G.LOOKS) {
        const b = document.createElement("button");
        b.className = "look";
        b.innerHTML = `<canvas></canvas><span>${look.name}</span>`;
        b.addEventListener("click", () => {
          Ed.grade = G.applyLook(Ed.grade, look);
          Ed.keepAuto = true; refreshUI(); requestRender(); commit(); Ed.keepAuto = false;
          renderLookThumbs();
        });
        b.dataset.look = look.id;
        grid.appendChild(b);
      }
    }
    scrub($("lut-mix"), {
      label: "Mélange LUT", get: () => Ed.grade.lut_mix * 100, set: v => { Ed.grade.lut_mix = v / 100; },
      min: 0, max: 100, def: 100, sens: 0.3, fmt: v => v.toFixed(0) + " %",
    });
  }

  function renderLookThumbs() {
    if (!renderer || !renderer.srcW || Ed.loading) return;
    Ed.looksDirty = false;
    renderer.setLut(currentLut());
    // previews always show the style *applied* (on top of the current corrections)
    const base = G.removeLook(G.clone(Ed.grade));
    for (const b of document.querySelectorAll(Ed.mode === "simple" ? "#simple-looks .look" : "#looks-grid .look")) {
      const look = G.LOOKS.find(l => l.id === b.dataset.look);
      const px = renderer.renderPixels({ grade: G.applyLook(base, look), geo: Ed.geo }, 180);
      const cv = b.querySelector("canvas");
      cv.width = px.width; cv.height = px.height;
      cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(px.pixels.buffer), px.width, px.height), 0, 0);
    }
  }

  $("lut-select").addEventListener("change", async e => {
    Ed.grade.lut = e.target.value || null;
    await ensureLut();
    refreshUI(); requestRender(); commit();
  });
  $("lut-import").addEventListener("click", async () => {
    try {
      const res = await api("POST", "/api/luts/import");
      if (res.imported.length) toast(`${res.imported.length} LUT importée(s)`, "success");
      if (res.errors.length) toast(res.errors.join(" · "), "error", 6000);
      await loadLutList();
      if (res.imported.length && !Ed.grade.lut) {
        Ed.grade.lut = res.imported[0];
        $("lut-select").value = Ed.grade.lut;
        await ensureLut();
        refreshUI(); requestRender(); commit();
      }
    } catch (e) { toast("Erreur : " + e.message, "error"); }
  });


  // ── Zones : local adjustments (AI masks + brush) ───────
  const Z = {
    sel: null,              // selected layer id
    masks: "none",          // none | loading | ready | missing
    ai: null,               // /api/ai/status
    coverage: {},
    paint: {},              // layer id → { data: Uint8Array(pw*ph*2), token }
    store: new Map(),       // paint token → Uint8Array (undo / redo)
    dirtyPaint: new Set(),  // layer ids to upload
    pw: 1, ph: 1,
    brush: { mode: null, size: 10, hard: 30, flow: 60 },
    show: false, stroke: null, space: false,
  };
  const PAINT_SIZE = 768;
  const selLayer = () => Ed.grade.locals.find(l => l.id === Z.sel) || null;
  const newId = () => Math.random().toString(36).slice(2, 10);
  const brushOn = () => Ed.tab === "masks" && !!Z.brush.mode && !!selLayer();
  const zoneFields = [];

  // the wipe gets out of the way while cropping, painting or during the auto animation
  const wipeHidden = () => Ed.tab === "crop" || brushOn() || Ed.animating;

  function overlayOpt() {
    if (Z.animOverlay) return Z.animOverlay;
    const l = selLayer();
    if (!l || Ed.tab !== "masks" || !(Z.show || Z.stroke)) return null;
    const i = Ed.grade.locals.indexOf(l);
    return { mask: G.MASK_NAMES.indexOf(l.mask), invert: l.invert ? 1 : 0, paint: l.paint && i < G.MAX_LOCALS ? i : -1 };
  }

  function resetZones() {
    Z.paint = {}; Z.store.clear(); Z.dirtyPaint.clear();
    Z.coverage = {}; Z.masks = "none"; Z.stroke = null;
    Z.sel = Ed.grade.locals.length ? Ed.grade.locals[0].id : null;
    if (renderer) renderer.clearMaps();
  }

  async function fetchMaps(photo, ai) {
    const r = await fetch(`/api/maps/${photo.id}?${window.App.projQ()}&ai=${ai ? 1 : 0}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await r.arrayBuffer(), n = new DataView(buf).getUint32(0, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
    let off = 4 + n;
    const take = len => { const a = new Uint8Array(buf, off, len); off += len; return a; };
    const out = { meta, aux: take(meta.aux[0] * meta.aux[1] * 2) };
    if (meta.masks) { const len = meta.masks[0] * meta.masks[1] * 4; out.a = take(len); out.b = take(len); }
    return out;
  }

  /** After the photo texture is ready: paint buffers, blur / haze maps, and AI masks if used */
  async function loadZoneData(photo) {
    const k = PAINT_SIZE / Math.max(renderer.srcW, renderer.srcH);
    Z.pw = Math.max(1, Math.round(renderer.srcW * k)); Z.ph = Math.max(1, Math.round(renderer.srcH * k));
    renderer.allocPaint(Z.pw, Z.ph);
    try {
      const m = await fetchMaps(photo, false);
      if (Ed.photo !== photo) return;
      renderer.setAux(m.meta.aux[0], m.meta.aux[1], m.aux, m.meta.air);
      requestRender();
    } catch (e) { console.warn("maps", e); }
    try {
      const r = await fetch(`/api/ailut/${photo.id}?${window.App.projQ()}`);
      if (r.ok && Ed.photo === photo) { renderer.setAiLut(new Float32Array(await r.arrayBuffer())); requestRender(); }
    } catch (e) { console.warn("ai lut", e); }
    await Promise.all(Ed.grade.locals.filter(l => l.paint).map(async l => {
      try {
        const r = await fetch(`/api/paint/${photo.id}/${l.id}`);
        if (!r.ok) return;
        const [w, h] = r.headers.get("X-Paint-Size").split(",").map(Number);
        let data = new Uint8Array(await r.arrayBuffer());
        if (w !== Z.pw || h !== Z.ph) data = resamplePaint(data, w, h, Z.pw, Z.ph);
        if (Ed.photo !== photo) return;
        Z.paint[l.id] = { data, token: l.paint };
        Z.store.set(l.paint, data.slice());
      } catch (e) { console.warn("paint", e); }
    }));
    if (Ed.photo !== photo) return;
    syncPaintGPU();
    if (Ed.tab === "masks" || Ed.grade.locals.some(l => l.mask !== "brush")) await loadMasks();
    renderZones();
    requestRender();
  }

  function resamplePaint(src, w, h, W, H) {
    const out = new Uint8Array(W * H * 2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (Math.min(h - 1, (y * h / H) | 0) * w + Math.min(w - 1, (x * w / W) | 0)) * 2;
      out[(y * W + x) * 2] = src[o]; out[(y * W + x) * 2 + 1] = src[o + 1];
    }
    return out;
  }

  async function loadMasks(force) {
    const photo = Ed.photo;
    if (!photo || Z.masks === "loading" || (Z.masks === "ready" && !force)) return;
    try { Z.ai = await api("GET", "/api/ai/status"); } catch { Z.ai = null; }
    if (!Z.ai || !Z.ai.ready) { Z.masks = "missing"; renderZones(); return; }
    Z.masks = "loading"; renderZones();
    try {
      const m = await fetchMaps(photo, true);
      if (Ed.photo !== photo) return;
      if (m.meta.masks) {
        renderer.setMasks(m.meta.masks[0], m.meta.masks[1], m.a, m.b);
        Z.coverage = m.meta.coverage; Z.masks = "ready";
      } else Z.masks = "missing";
    } catch (e) { Z.masks = "missing"; toast("Détection IA : " + e.message, "error"); }
    renderZones();
    requestRender();
  }

  function syncPaintGPU() {
    Ed.grade.locals.slice(0, G.MAX_LOCALS).forEach((l, i) =>
      renderer.setPaint(i, l.paint && Z.paint[l.id] ? Z.paint[l.id].data : null));
  }

  /** After undo / redo / paste: make the paint buffers match the tokens in the grade */
  function reconcilePaint() {
    for (const l of Ed.grade.locals) {
      if (!l.paint) continue;
      if (Z.paint[l.id] && Z.paint[l.id].token === l.paint) continue;
      const d = Z.store.get(l.paint);
      if (d) { Z.paint[l.id] = { data: d.slice(), token: l.paint }; Z.dirtyPaint.add(l.id); }
      else l.paint = null;
    }
    if (!selLayer()) Z.sel = Ed.grade.locals.length ? Ed.grade.locals[0].id : null;
    syncPaintGPU();
  }

  async function uploadPaint(photo) {
    const ids = [...Z.dirtyPaint];
    Z.dirtyPaint.clear();
    for (const id of ids) {
      const pnt = Z.paint[id];
      if (!pnt) continue;
      const r = await fetch(`/api/paint/${photo.id}/${id}?w=${Z.pw}&h=${Z.ph}`, { method: "PUT", body: pnt.data });
      if (!r.ok) { Z.dirtyPaint.add(id); throw new Error("pinceau non enregistré"); }
    }
  }

  // -- layers ---------------------------------------------------------------
  function addLayer(mask) {
    if (Ed.grade.locals.length >= G.MAX_LOCALS) { toast(`Maximum ${G.MAX_LOCALS} zones par photo`, "info"); return; }
    const l = G.defaultLocal();
    l.id = newId(); l.mask = mask; l.name = G.LOCAL_LABELS[mask];
    Ed.grade.locals.push(l);
    Z.sel = l.id;
    Z.show = true;
    if (mask === "brush") Z.brush.mode = "add";
    syncPaintGPU();
    refreshUI(); requestRender(); commit();
  }

  function removeLayer(id) {
    Ed.grade.locals = Ed.grade.locals.filter(l => l.id !== id);
    delete Z.paint[id];
    if (Z.sel === id) Z.sel = Ed.grade.locals.length ? Ed.grade.locals[0].id : null;
    syncPaintGPU();
    refreshUI(); requestRender(); commit();
  }

  function renderZones() {
    const list = $("layer-list");
    if (!list) return;
    list.innerHTML = "";
    if (!Ed.grade.locals.length) list.innerHTML = `<div class="layer-empty">Aucune zone. Cliquez sur ✦ Auto, ou ajoutez-en une ci-dessous.</div>`;
    for (const l of Ed.grade.locals) {
      const row = document.createElement("div");
      row.className = "layer" + (l.id === Z.sel ? " active" : "") + (l.on ? "" : " off");
      row.innerHTML = `<button class="l-eye" title="Activer / désactiver">${l.on ? "●" : "○"}</button>
        <span class="l-name">${l.name || G.LOCAL_LABELS[l.mask]}${l.paint ? " ✎" : ""}</span>
        ${l.auto ? '<span class="l-tag">auto</span>' : ""}
        <button class="l-del" title="Supprimer la zone">✕</button>`;
      row.addEventListener("click", e => {
        if (e.target.classList.contains("l-eye")) { l.on = !l.on; refreshUI(); requestRender(); commit(); return; }
        if (e.target.classList.contains("l-del")) { removeLayer(l.id); return; }
        Z.sel = l.id; refreshUI(); requestRender();
      });
      list.appendChild(row);
    }

    const sel = $("mask-add");
    let opts = `<option value="">+ Ajouter une zone…</option>`;
    if (Z.masks === "ready")
      for (const n of G.MASK_NAMES) {
        const c = Z.coverage[n] || 0;
        if (c >= 0.005) opts += `<option value="${n}">${G.LOCAL_LABELS[n]} (${Math.round(c * 100)} %)</option>`;
      }
    opts += `<option value="brush">Zone libre au pinceau</option>`;
    sel.innerHTML = opts;

    const box = $("ai-box"), ai = Z.ai;
    if (Z.masks === "loading") box.innerHTML = `Analyse IA de la photo…`;
    else if (Z.masks === "ready") box.innerHTML = `Détection IA active.`;
    else if (ai && !ai.runtime) box.innerHTML = `Détection IA indisponible (module <code>onnxruntime</code> non installé). Le pinceau reste utilisable.`;
    else if (ai && ai.download.active) {
      const pct = ai.download.total ? Math.round(ai.download.done / ai.download.total * 100) : 0;
      box.innerHTML = `Téléchargement des modèles IA… ${pct} %<progress max="100" value="${pct}"></progress>`;
    } else if (ai && !ai.ready) {
      box.innerHTML = `Détection IA (ciel, personnes, plans…) non installée.` +
        (ai.download.error ? `<br><span style="color:var(--danger)">${ai.download.error}</span>` : "") +
        `<br><button class="ed-btn ed-accent" id="ai-dl">Télécharger les modèles (${Math.round(ai.total_size / 1e6)} Mo)</button>`;
      $("ai-dl").addEventListener("click", startAiDownload);
    } else box.innerHTML = "";

    const l = selLayer();
    $("layer-name").textContent = l ? `– ${l.name || G.LOCAL_LABELS[l.mask]}` : "";
    document.querySelector(".masks-adj").classList.toggle("disabled", !l);
    $("layer-hint").style.display = l ? "none" : "";
    zoneFields.forEach(f => f());
    $("brush-add").classList.toggle("active", Z.brush.mode === "add");
    $("brush-erase").classList.toggle("active", Z.brush.mode === "erase");
    $("mask-show").classList.toggle("active", Z.show);
    $("mask-invert").classList.toggle("active", !!(l && l.invert));
    $("mask-invert").disabled = !l || l.mask === "brush";
    for (const id of ["brush-add", "brush-erase", "mask-show"]) $(id).disabled = !l;
    $("paint-clear").disabled = !l || !l.paint;
    root.classList.toggle("brush-mode", brushOn());
    renderSimple();
    if (!brushOn()) $("brush-cursor").style.display = "none";
  }

  async function startAiDownload() {
    try { Z.ai = await api("POST", "/api/ai/download"); } catch (e) { toast("Erreur : " + e.message, "error"); return; }
    const poll = async () => {
      try { Z.ai = await api("GET", "/api/ai/status"); } catch { return; }
      if (Z.ai.ready) { toast("Modèles IA installés", "success"); Z.masks = "none"; loadMasks(); return; }
      renderZones();
      if (Z.ai.download.active) setTimeout(poll, 1000);
    };
    poll();
  }

  function buildZones() {
    const adj = $("layer-adj");
    const d = G.defaultLocal();
    const f = (key, label, o) => {
      const before = fields.length;
      scrub(adj, { label, def: d[key], get: () => (selLayer() || d)[key],
                   set: v => { const l = selLayer(); if (l) l[key] = v; }, ...o });
      zoneFields.push(fields[before].show);
    };
    f("exposure", "Exposition", { min: -4, max: 4, sens: 0.01, fmt: v => (v > 0 ? "+" : "") + v.toFixed(2) + " IL" });
    f("contrast", "Contraste", { min: 0, max: 2, sens: 0.003, fmt: v => v.toFixed(3) });
    f("highlights", "Hautes lum.", { min: -100, max: 100, sens: 0.3, fmt: v => v.toFixed(1) });
    f("shadows", "Ombres", { min: -100, max: 100, sens: 0.3, fmt: v => v.toFixed(1) });
    f("temp", "Temp.", { min: -100, max: 100, sens: 0.25, fmt: v => v.toFixed(1), cls: "temp" });
    f("tint", "Teinte vert/mag.", { min: -100, max: 100, sens: 0.25, fmt: v => v.toFixed(1), cls: "tint" });
    f("sat", "Saturation", { min: 0, max: 100, sens: 0.15, fmt: v => v.toFixed(1) });
    f("clarity", "Clarté", { min: -100, max: 100, sens: 0.3, fmt: v => v.toFixed(1) });
    f("amount", "Intensité", { min: 0, max: 100, sens: 0.3, fmt: v => v.toFixed(0) + " %" });

    const bp = $("brush-params");
    const b = (key, label, min, max, def) => scrub(bp, {
      label, def, min, max, sens: 0.2, fmt: v => v.toFixed(0),
      get: () => Z.brush[key], set: v => { Z.brush[key] = v; } });
    b("size", "Taille", 1, 60, 10); b("hard", "Dureté", 0, 95, 30); b("flow", "Flux", 5, 100, 60);

    $("mask-add").addEventListener("change", e => { const v = e.target.value; e.target.value = ""; if (v) addLayer(v); });
    const mode = m => { Z.brush.mode = Z.brush.mode === m ? null : m; if (Z.brush.mode) Z.show = true; renderZones(); requestRender(); };
    $("brush-add").addEventListener("click", () => mode("add"));
    $("brush-erase").addEventListener("click", () => mode("erase"));
    $("mask-show").addEventListener("click", () => { Z.show = !Z.show; renderZones(); requestRender(); });
    $("mask-invert").addEventListener("click", () => {
      const l = selLayer(); if (!l) return;
      l.invert = !l.invert; refreshUI(); requestRender(); commit();
    });
    $("paint-clear").addEventListener("click", () => {
      const l = selLayer(); if (!l) return;
      l.paint = null; delete Z.paint[l.id];
      syncPaintGPU(); refreshUI(); requestRender(); commit();
    });

    // painting on the viewer
    const cursor = $("brush-cursor");
    const moveCursor = e => {
      if (!brushOn()) { cursor.style.display = "none"; return; }
      const d = Z.brush.size / 100 * Math.max(Ed.fullW, Ed.fullH) * pz.s;     // diameter on screen
      Object.assign(cursor.style, { display: "block", left: e.clientX + "px", top: e.clientY + "px", width: d + "px", height: d + "px" });
      cursor.classList.toggle("erase", Z.brush.mode === "erase");
    };
    const paintAt = e => {
      const l = selLayer(), r = content.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      const geom = G.geometry(renderer.srcW, renderer.srcH, Ed.geo);
      const [sx, sy] = G.outToSrc(u, v, geom, Ed.geo);
      const x = sx * Z.pw, y = sy * Z.ph, rad = Math.max(1, Z.brush.size / 100 * Math.max(Z.pw, Z.ph) / 2);
      const data = Z.paint[l.id].data, last = Z.stroke.last;
      if (!last) stamp(data, x, y, rad);
      else {
        const dist = Math.hypot(x - last[0], y - last[1]), step = Math.max(1, rad * 0.3);
        for (let t = step; t <= dist; t += step) stamp(data, last[0] + (x - last[0]) * t / dist, last[1] + (y - last[1]) * t / dist, rad);
        if (dist < step) return;
      }
      Z.stroke.last = [x, y];
      renderer.setPaint(Ed.grade.locals.indexOf(l), data);
      requestRender();
    };
    stage.addEventListener("pointerdown", e => {
      if (!brushOn() || e.button !== 0 || Z.space) return;
      const l = selLayer();
      if (Ed.grade.locals.indexOf(l) >= G.MAX_LOCALS) return;
      e.preventDefault();
      stage.setPointerCapture(e.pointerId);
      if (!Z.paint[l.id]) Z.paint[l.id] = { data: new Uint8Array(Z.pw * Z.ph * 2), token: null };
      if (!l.paint) l.paint = "pending";
      Z.stroke = { last: null };
      paintAt(e);
    });
    stage.addEventListener("pointermove", e => { moveCursor(e); if (Z.stroke) paintAt(e); });
    stage.addEventListener("pointerleave", () => { if (!Z.stroke) cursor.style.display = "none"; });
    const endStroke = () => {
      if (!Z.stroke) return;
      Z.stroke = null;
      const l = selLayer(); if (!l) return;
      const token = newId();
      l.paint = token; Z.paint[l.id].token = token;
      Z.store.set(token, Z.paint[l.id].data.slice());
      while (Z.store.size > 40) Z.store.delete(Z.store.keys().next().value);
      Z.dirtyPaint.add(l.id);
      renderZones(); requestRender(); commit();
    };
    stage.addEventListener("pointerup", endStroke);
    stage.addEventListener("pointercancel", endStroke);
  }

  function stamp(data, x, y, r) {
    const W = Z.pw, H = Z.ph, hard = Z.brush.hard / 100, flow = Z.brush.flow / 100 * 0.5, add = Z.brush.mode === "add";
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.ceil(y + r));
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y) / r;
      if (d >= 1) continue;
      let a = d <= hard ? 1 : (1 - d) / (1 - hard);
      a = a * a * (3 - 2 * a) * flow;
      const o = (yy * W + xx) * 2, up = add ? o : o + 1, down = add ? o + 1 : o;
      data[up] = Math.min(255, Math.ceil(data[up] + (255 - data[up]) * a));
      data[down] = Math.floor(data[down] * (1 - a));
    }
  }


  // ── Simple mode ────────────────────────────────────────
  const simpleSliders = [];

  function setMode(mode, tab) {
    Ed.mode = mode;
    try { localStorage.setItem("pc-editor-mode", mode); } catch { /* private mode */ }
    root.classList.toggle("mode-simple", mode === "simple");
    document.querySelectorAll("#mode-switch button").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
    switchTab(tab || (Ed.tab === "crop" ? "crop" : mode === "simple" ? "simple" : (Ed.tab === "simple" ? "primaries" : Ed.tab)), true);
    requestAnimationFrame(() => { if (pz.fitted) pz.fit(); requestRender(); });
  }

  /** One intuitive slider driving a zone (created on first use) */
  function zoneOf(masks) {
    for (const m of masks) { const l = Ed.grade.locals.find(x => x.mask === m); if (l) return l; }
    return null;
  }
  function zoneFor(masks) {
    let l = zoneOf(masks);
    if (l) return l;
    const mask = masks.find(m => (Z.coverage[m] || 0) > 0.01) || masks[0];
    if (Ed.grade.locals.length >= G.MAX_LOCALS) { toast(`Maximum ${G.MAX_LOCALS} zones par photo`, "info"); return null; }
    l = G.defaultLocal(); l.id = newId(); l.mask = mask; l.name = G.LOCAL_LABELS[mask];
    Ed.grade.locals.push(l);
    return l;
  }

  function buildSimple() {
    const box = $("s-sliders");
    const add = ({ label, min, max, step = 1, def = 0, get, set, fmt = v => Math.round(v), zone, visible }) => {
      const el = document.createElement("div");
      el.className = "s-slider" + (zone ? " zone" : "");
      el.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}"/><output></output>`;
      const input = el.querySelector("input"), out = el.querySelector("output");
      const show = () => {
        const v = get();
        input.value = v; out.textContent = fmt(v);
        el.classList.toggle("changed", Math.abs(v - def) > 1e-6);
        el.style.display = !visible || visible() ? "" : "none";
      };
      input.addEventListener("input", () => { set(parseFloat(input.value)); show(); requestRender(); });
      input.addEventListener("change", () => { refreshUI(); commit(); renderLookThumbs(); });
      input.addEventListener("dblclick", () => { set(def); refreshUI(); requestRender(); commit(); });
      box.appendChild(el);
      simpleSliders.push(show);
    };
    const g = (key, o) => add({ get: () => Ed.grade[key], set: v => { Ed.grade[key] = v; }, def: G.defaultGrade()[key], ...o });
    g("ai", { label: "Couleur IA", min: 0, max: 100, zone: true });
    g("exposure", { label: "Luminosité", min: -2, max: 2, step: 0.02, fmt: v => (v > 0 ? "+" : "") + v.toFixed(1) });
    g("contrast", { label: "Contraste", min: 0.6, max: 1.5, step: 0.01, fmt: v => Math.round((v - 1) * 100) });
    g("shadows", { label: "Ombres", min: -60, max: 60 });
    g("highlights", { label: "Hautes lumières", min: -60, max: 60 });
    g("boost", { label: "Couleurs", min: -100, max: 100 });
    g("temp", { label: "Chaleur", min: -60, max: 60 });
    g("clarity", { label: "Relief / détails", min: -50, max: 80 });
    g("dehaze", { label: "Anti-brume", min: 0, max: 70 });
    g("sharpen", { label: "Netteté", min: 0, max: 100 });

    const clampV = v => Math.max(-100, Math.min(100, Math.round(v)));
    add({ label: "Ciel", min: -100, max: 100, zone: true,
      visible: () => Z.masks === "ready" && (Z.coverage.sky || 0) > 0.03,
      get: () => { const l = zoneOf(["sky"]); return l ? clampV(-l.exposure / 0.005) : 0; },
      set: v => { const l = zoneFor(["sky"]); if (!l) return;
        Object.assign(l, { on: true, exposure: -0.005 * v, highlights: -0.25 * v, sat: 50 + 0.12 * v,
                           contrast: 1 + 0.0006 * v, clarity: 0.1 * Math.max(v, 0) }); } });
    const subj = () => ((Z.coverage.person || 0) > 0.01 ? ["person"] : ["foreground"]);
    add({ label: "Sujet / 1er plan", min: -100, max: 100, zone: true,
      visible: () => Z.masks === "ready" && ((Z.coverage.person || 0) > 0.01 || ((Z.coverage.foreground || 0) > 0.05 && Z.coverage.foreground < 0.8)),
      get: () => { const l = zoneOf(subj()); return l ? clampV(l.exposure / 0.007) : 0; },
      set: v => { const l = zoneFor(subj()); if (!l) return;
        Object.assign(l, { on: true, exposure: 0.007 * v, shadows: 0.15 * Math.max(v, 0) }); } });

    // one slider for the whole enhancement: original ← 0 … 100 (recommended) … 150
    const intR = $("s-int-range");
    const applyIntensity = () => {
      const ref = Ed.autoRef;
      if (!ref) return;
      ref.t = parseFloat(intR.value) / 100;
      const style = Ed.grade.look ? G.LOOKS.find(l => l.id === Ed.grade.look.id) : null;
      const g = ref.t === 0 ? G.clone(ref.base) : lerpGrade(ref.base, ref.full, ref.t);   // 0 % = truly untouched
      Ed.grade = style ? G.applyLook(g, style) : g;
      if (Object.keys(Z.paint).length) syncPaintGPU();
      $("s-int-out").textContent = Math.round(ref.t * 100) + " %";
      requestRender();
    };
    intR.addEventListener("input", applyIntensity);
    intR.addEventListener("change", () => {
      if (!Ed.autoRef) return;
      Ed.keepAuto = true; refreshUI(); commit(); Ed.keepAuto = false;
      renderLookThumbs();
    });
    intR.addEventListener("dblclick", () => { if (Ed.autoRef) { intR.value = 100; applyIntensity(); intR.dispatchEvent(new Event("change")); } });

    const setFine = open => {
      root.classList.toggle("fine-closed", !open);
      $("s-more").textContent = open ? "Réglages fins ▴" : "Réglages fins (facultatif) ▾";
      try { localStorage.setItem("pc-editor-fine", open ? "1" : "0"); } catch { /* private mode */ }
    };
    $("s-more").addEventListener("click", () => setFine(root.classList.contains("fine-closed")));
    setFine((() => { try { return localStorage.getItem("pc-editor-fine") === "1"; } catch { return false; } })());

    $("mode-switch").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setMode(b.dataset.mode); });
    $("s-auto").addEventListener("click", autoGrade);
    const before = on => { Ed.bypass = on; syncToggles(); requestRender(); };
    $("s-before").addEventListener("pointerdown", () => before(true));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) $("s-before").addEventListener(ev, () => { if (Ed.bypass && Ed.mode === "simple") before(false); });
  }

  let learnedCount = 0;
  async function refreshLearned() {
    try { learnedCount = (await api("GET", "/api/auto-prefs")).samples; } catch { /* offline */ }
    const el = $("s-learn");
    if (el) el.innerHTML = learnedCount
      ? `L'Auto s'adapte à votre goût : il a appris de <b>${learnedCount}</b> photo(s) que vous avez retouchées. <a href="#" id="s-forget">Oublier</a>`
      : "L'Auto apprend de vous : chaque photo que vous corrigez après lui affine les suivantes.";
    const f = $("s-forget");
    if (f) f.onclick = async e => {
      e.preventDefault();
      if (!confirm("Oublier tout ce que l'Auto a appris de vos retouches ?")) return;
      await api("DELETE", "/api/auto-prefs");
      refreshLearned();
    };
  }

  function renderSimple() {
    simpleSliders.forEach(f => f());
    const ref = Ed.autoRef, intR = $("s-int-range");
    $("s-int").classList.toggle("off", !ref);
    intR.disabled = !ref;
    if (ref) { intR.value = Math.round(ref.t * 100); $("s-int-out").textContent = Math.round(ref.t * 100) + " %"; }
    else $("s-int-out").textContent = "–";
    $("s-int").title = ref ? "Dose toute l'amélioration : 0 % = photo d'origine, 100 % = réglage conseillé"
                           : "Cliquez d'abord sur « Améliorer automatiquement »";
    const info = $("s-info");
    if (!info) return;
    const zones = Ed.grade.locals.filter(l => l.on && G.localEffective(l)).map(l => l.name || G.LOCAL_LABELS[l.mask]);
    if (Z.masks === "missing")
      info.innerHTML = `Détection IA non installée : passez en mode <b>Pro › Zones (IA)</b> pour la télécharger. L'amélioration automatique reste disponible (réglages globaux).`;
    else if (zones.length)
      info.textContent = `Zones retouchées séparément : ${zones.join(", ")}. Ajustez avec les curseurs, ou passez en mode Pro pour le détail.`;
    else
      info.textContent = "L'IA analyse la photo (ciel, personnes, relief…) et règle lumière, couleurs, courbes et zones. Ajustez ensuite avec les curseurs.";
  }

  // ── Crop ───────────────────────────────────────────────
  const ASPECTS = [
    ["free", "Libre"], ["original", "Original"], ["1:1", "1:1"], ["4:5", "4:5"], ["5:4", "5:4"],
    ["3:2", "3:2"], ["2:3", "2:3"], ["16:9", "16:9"], ["9:16", "9:16"],
  ];

  function aspectRatioPx() {
    const a = Ed.geo.aspect || "free";
    if (a === "free") return null;
    const g = G.geometry(renderer.srcW, renderer.srcH, Ed.geo, true);
    if (a === "original") return g.oriW / g.oriH;
    const [w, h] = a.split(":").map(Number);
    return w / h;
  }
  /** ratio expressed in normalised crop units (w_n / h_n) */
  function aspectNorm() {
    const r = aspectRatioPx();
    if (!r) return null;
    const g = G.geometry(renderer.srcW, renderer.srcH, Ed.geo, true);
    return r * g.baseH / g.baseW;
  }

  function buildCrop() {
    const box = $("aspect-btns");
    for (const [id, label] of ASPECTS) {
      const b = document.createElement("button");
      b.className = "ed-btn"; b.dataset.aspect = id; b.textContent = label;
      b.addEventListener("click", () => setAspect(id));
      box.appendChild(b);
    }
    $("rot-left").addEventListener("click", () => rotate(-90));
    $("rot-right").addEventListener("click", () => rotate(90));
    $("flip-h").addEventListener("click", () => {
      Ed.geo.flip = !Ed.geo.flip;
      if (Ed.geo.crop) Ed.geo.crop.x = 1 - Ed.geo.crop.x - Ed.geo.crop.w;
      refreshUI(); requestRender(); commit();
    });
    const range = $("angle-range");
    range.addEventListener("input", () => {
      Ed.geo.angle = parseFloat(range.value);
      stage.classList.add("straighten");
      refreshUI(); requestRender();
    });
    range.addEventListener("change", () => { stage.classList.remove("straighten"); commit(); });
    range.addEventListener("dblclick", () => { Ed.geo.angle = 0; refreshUI(); requestRender(); commit(); });
    $("crop-reset").addEventListener("click", () => {
      Ed.geo = G.defaultGeo();
      refreshUI(); requestRender(); commit();
    });
  }

  function setAspect(id) {
    Ed.geo.aspect = id;
    const rn = aspectNorm();
    if (rn) {
      // largest centred rectangle with that ratio
      let w = 1, h = 1 / rn;
      if (h > 1) { h = 1; w = rn; }
      Ed.geo.crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
    }
    refreshUI(); requestRender(); commit();
  }

  function rotate(deg) {
    Ed.geo.rot = ((Ed.geo.rot + deg) % 360 + 360) % 360;
    Ed.geo.crop = null;
    if (Ed.geo.aspect !== "free" && Ed.geo.aspect !== "original") {
      const [a, b] = Ed.geo.aspect.split(":");
      Ed.geo.aspect = `${b}:${a}`;
    }
    if (Ed.geo.aspect !== "free") { setAspect(Ed.geo.aspect); return; }
    refreshUI(); requestRender(); commit();
  }

  let cropDrag = null;
  cropBox.addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    const h = e.target.dataset.h || "move";
    cropDrag = { h, x: e.clientX, y: e.clientY, start: { ...(Ed.geo.crop || { x: 0, y: 0, w: 1, h: 1 }) } };
    cropBox.setPointerCapture(e.pointerId);
  });
  cropBox.addEventListener("pointermove", e => {
    if (!cropDrag) return;
    const r = pz.rect();
    const dx = (e.clientX - cropDrag.x) / r.w, dy = (e.clientY - cropDrag.y) / r.h;
    Ed.geo.crop = dragCrop(cropDrag.start, cropDrag.h, dx, dy, aspectNorm());
    updateOverlays();
  });
  const cropEnd = () => { if (cropDrag) { cropDrag = null; commit(); requestRender(); } };
  cropBox.addEventListener("pointerup", cropEnd);
  cropBox.addEventListener("pointercancel", cropEnd);

  function dragCrop(s, h, dx, dy, rn) {
    const MIN = 0.03;
    if (h === "move") {
      return { ...s, x: Math.min(1 - s.w, Math.max(0, s.x + dx)), y: Math.min(1 - s.h, Math.max(0, s.y + dy)) };
    }
    let L = s.x, T = s.y, R = s.x + s.w, B = s.y + s.h;
    if (h.includes("w")) L = Math.min(R - MIN, Math.max(0, L + dx));
    if (h.includes("e")) R = Math.max(L + MIN, Math.min(1, R + dx));
    if (h.includes("n")) T = Math.min(B - MIN, Math.max(0, T + dy));
    if (h.includes("s")) B = Math.max(T + MIN, Math.min(1, B + dy));
    let w = R - L, hh = B - T;
    if (!rn) return { x: L, y: T, w, h: hh };

    // keep the ratio: the dragged dimension drives, anchor = opposite side (or centre)
    if (h === "n" || h === "s") w = hh * rn; else hh = w / rn;
    const ax = h.includes("w") ? "r" : h.includes("e") ? "l" : "c";
    const ay = h.includes("n") ? "b" : h.includes("s") ? "t" : "c";
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2, sR = s.x + s.w, sB = s.y + s.h;
    const maxW = ax === "r" ? sR : ax === "l" ? 1 - s.x : 2 * Math.min(cx, 1 - cx);
    const maxH = ay === "b" ? sB : ay === "t" ? 1 - s.y : 2 * Math.min(cy, 1 - cy);
    const k = Math.min(1, maxW / w, maxH / hh);
    w *= k; hh *= k;
    const x = ax === "r" ? sR - w : ax === "l" ? s.x : cx - w / 2;
    const y = ay === "b" ? sB - hh : ay === "t" ? s.y : cy - hh / 2;
    return { x, y, w, h: hh };
  }

  // ── Overlays (crop box / wipe) ─────────────────────────
  function updateOverlays() {
    const r = pz.rect();
    const ov = $("ed-overlay");
    Object.assign(ov.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
    const cropMode = Ed.tab === "crop";
    cropBox.style.display = cropMode ? "block" : "none";
    if (cropMode) {
      const c = Ed.geo.crop || { x: 0, y: 0, w: 1, h: 1 };
      Object.assign(cropBox.style, { left: c.x * 100 + "%", top: c.y * 100 + "%", width: c.w * 100 + "%", height: c.h * 100 + "%" });
    }
    wipe.style.display = !wipeHidden() && Ed.split >= 0 ? "block" : "none";
    wipe.style.left = Ed.split * 100 + "%";
    $("ed-zoom").textContent = pz.fitted ? "Ajusté" : `${pz.percent()} %`;
  }

  let wipeDrag = false;
  wipe.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); wipeDrag = true; wipe.setPointerCapture(e.pointerId); });
  wipe.addEventListener("pointermove", e => {
    if (!wipeDrag) return;
    const r = $("ed-overlay").getBoundingClientRect();
    Ed.split = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    requestRender();
  });
  wipe.addEventListener("pointerup", () => { wipeDrag = false; });

  // ── Tabs / toggles ─────────────────────────────────────
  function switchTab(tab, silent) {
    Ed.tab = tab;
    document.querySelectorAll("#ed-tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".ed-section").forEach(s => s.classList.toggle("active", s.dataset.tab === tab));
    root.classList.toggle("crop-mode", tab === "crop");
    pz.enabled = tab !== "crop";
    if (tab === "crop") pz.fit();
    if (tab === "curves") requestAnimationFrame(drawCurves);
    if (tab === "looks") requestAnimationFrame(renderLookThumbs);
    if (tab === "masks" || tab === "simple") loadMasks();
    if (tab !== "masks") Z.brush.mode = null;
    if (tab === "simple") requestAnimationFrame(renderLookThumbs);
    renderZones();
    if (!silent) requestRender();
  }

  /** The photo alone on the whole screen – the wipe stays as it is set */
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else $("ed-viewer").requestFullscreen().catch(e => toast("Plein écran indisponible : " + e.message, "error"));
  }

  function syncToggles() {
    $("ed-bypass").classList.toggle("active", Ed.bypass);
    $("ed-split").classList.toggle("active", Ed.split >= 0);
  }
  const toggleBypass = () => { Ed.bypass = !Ed.bypass; syncToggles(); requestRender(); };
  const toggleSplit = () => {
    Ed.split = Ed.split >= 0 ? -1 : 0.5;
    try { localStorage.setItem("pc-editor-split", Ed.split >= 0 ? "1" : "0"); } catch { /* private mode */ }
    syncToggles(); requestRender();
  };

  function refreshUI() {
    fields.forEach(f => f.show());
    Object.keys(wheels).forEach(drawWheel);
    drawCurves();
    const a = Ed.geo.aspect || "free";
    document.querySelectorAll("#aspect-btns button").forEach(b => b.classList.toggle("active", b.dataset.aspect === a));
    $("angle-range").value = Ed.geo.angle || 0;
    $("angle-val").textContent = `${(Ed.geo.angle || 0).toFixed(1)}°`;
    $("lut-select").value = Ed.grade.lut || "";
    $("flip-h").classList.toggle("active", !!Ed.geo.flip);
    renderZones();
    const lk = Ed.grade.look ? Ed.grade.look.id : null;
    document.querySelectorAll(".look").forEach(b => b.classList.toggle("active", b.dataset.look === lk));
    Ed.looksDirty = true;
  }

  // ── Actions ────────────────────────────────────────────
  // ── Auto-enhance, animated ─────────────────────────────
  const ZONE_COLORS = { sky: [0.29, 0.66, 1], person: [1, 0.62, 0.26], vegetation: [0.3, 0.85, 0.39], water: [0.2, 0.84, 0.88],
    ground: [0.85, 0.63, 0.4], building: [0.75, 0.55, 1], foreground: [1, 0.83, 0.23], background: [0.54, 0.61, 0.71] };
  const SCENES = { landscape: "paysage", portrait: "portrait", night: "faible lumière", sunset: "lumière chaude", general: "générale" };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ease = t => t * t * (3 - 2 * t);

  /** Run fn(t) for t: 0 → 1 over ms (jumps to 1 when the user skips) */
  function tween(ms, fn) {
    return new Promise(res => {
      const t0 = performance.now();
      const step = now => {
        const t = Ed.animSkip ? 1 : Math.min(1, (now - t0) / ms);
        fn(t);
        if (t < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }

  function caption(text, done, total) {
    const el = $("ed-caption");
    if (!text) { el.style.display = "none"; return; }
    let dots = "";
    if (total) { dots = '<span class="dots">'; for (let i = 0; i < total; i++) dots += `<i class="${i < done ? "done" : ""}"></i>`; dots += "</span>"; }
    el.innerHTML = `<span>${text}</span>${dots}`;
    el.style.display = "flex";
  }

  /** Interpolate between two grades (curves are resampled, new zones fade in) */
  function lerpGrade(a, b, t) {
    const lerp = (x, y) => {
      if (typeof x === "number" && typeof y === "number") return x + (y - x) * t;
      if (y && typeof y === "object" && !Array.isArray(y) && x && typeof x === "object") {
        const o = {};
        for (const k of Object.keys(y)) o[k] = lerp(x[k], y[k]);
        return o;
      }
      return y;
    };
    const g = lerp(a, b);
    g.curves = {};
    for (const ch of ["y", "r", "g", "b"]) {
      const f = G.makeSpline(a.curves[ch]);
      g.curves[ch] = b.curves[ch].map(([x, y]) => [x, Math.min(1, Math.max(0, f(x) + (y - f(x)) * t))]);
    }
    g.locals = b.locals.map(lb => {
      const la = a.locals.find(l => l.id === lb.id);
      return la ? lerp(la, lb) : { ...lb, amount: Math.min(100, lb.amount * t) };
    });
    if (b.look) g.look = b.look; else delete g.look;
    if (b.auto_ref) g.auto_ref = b.auto_ref; else delete g.auto_ref;   // reference values: never interpolated
    return g;
  }

  function autoStages(start, final) {
    const pick = (from, paths) => {
      const g = G.clone(from);
      for (const p of paths) {
        const [k, sub] = p.split(".");
        if (sub) g[k][sub] = final[k][sub]; else g[k] = G.clone(final[k]);
      }
      return g;
    };
    const stages = [];
    let cur = G.clone(start);
    cur.locals = cur.locals.filter(l => !l.auto);          // previous auto zones are replaced
    const add = (label, to, zone) => {
      if (JSON.stringify(cur) !== JSON.stringify(to)) stages.push({ label, from: cur, to, zone });
      cur = to;
    };
    add("Couleur IA", pick(cur, ["ai"]));
    add("Balance des blancs et exposition", pick(cur, ["temp", "tint", "exposure", "lift.m", "gain.m", "gamma.m"]));
    add("Tons : courbe, ombres, hautes lumières", pick(cur, ["shadows", "highlights", "contrast", "curves", "lift.x", "lift.y", "gain.x", "gain.y", "gamma.x", "gamma.y"]));
    add("Couleurs, relief, netteté et anti-brume", pick(cur, ["boost", "clarity", "dehaze", "sharpen"]));
    for (const l of final.locals.filter(l => l.auto)) {
      const to = G.clone(cur);
      to.locals.push(G.clone(l));
      add(`Retouche de la zone : ${l.name}`, to, l.mask);
    }
    return stages;
  }

  async function autoGrade() {
    if (!Ed.photo || Ed.animating || Ed.loading) return;
    const photo = Ed.photo, btn = $("ed-auto");
    btn.disabled = true; $("s-auto").disabled = true;
    $("s-auto").textContent = "✦ Amélioration en cours… (clic sur la photo pour passer)";
    Ed.animating = true; Ed.animSkip = false; Ed.bypass = false;
    const skip = () => { Ed.animSkip = true; };
    stage.addEventListener("pointerdown", skip);
    let ok = false, zones = [];
    try {
      // 1 ─ analysis
      caption("Analyse de la photo par l'IA…");
      $("ed-scan").style.display = "block";
      requestRender();
      const [res] = await Promise.all([
        api("POST", `/api/projects/${encodeURIComponent(state.currentProject)}/auto-grade`, { ids: [photo.id] }),
        sleep(900)]);
      const a = res[photo.id];
      if (!a) throw new Error("analyse impossible");
      if (Z.masks !== "ready") { Z.masks = "none"; await loadMasks(); }
      if (Ed.photo !== photo) return;
      $("ed-scan").style.display = "none";

      // 2 ─ show what was detected
      if (Z.masks === "ready") {
        const found = G.MASK_NAMES.slice(0, 6).filter(n => (Z.coverage[n] || 0) >= 0.03).slice(0, 5);
        for (const [i, n] of found.entries()) {
          if (Ed.animSkip) break;
          caption(`Détection : ${G.LOCAL_LABELS[n]} <small>${Math.round(Z.coverage[n] * 100)} % de l'image</small>`, i + 1, found.length);
          await tween(650, t => {
            Z.animOverlay = { mask: G.MASK_NAMES.indexOf(n), invert: 0, paint: -1, color: ZONE_COLORS[n],
                              alpha: 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.6 };
            requestRender();
          });
        }
        Z.animOverlay = null;
      }

      // 3 ─ apply the enhancement step by step
      const style = Ed.grade.look ? G.LOOKS.find(l => l.id === Ed.grade.look.id) : null;
      const start = G.removeLook(G.clone(Ed.grade));
      const final = G.mergeAuto(G.clone(start), a);
      const stages = autoStages(start, final);
      const hasPaint = Object.keys(Z.paint).length > 0;
      for (const [i, st] of stages.entries()) {
        caption(st.label, i + 1, stages.length);
        await tween(Ed.animSkip ? 1 : 620, t => {
          Ed.grade = lerpGrade(st.from, st.to, ease(t));
          if (hasPaint) syncPaintGPU();
          Z.animOverlay = st.zone ? { mask: G.MASK_NAMES.indexOf(st.zone), invert: 0, paint: -1,
                                      color: ZONE_COLORS[st.zone], alpha: 0.4 * (1 - t) } : null;
          requestRender();
        });
        Ed.grade = G.clone(st.to);
        fields.forEach(f => f.show()); Object.keys(wheels).forEach(drawWheel); simpleSliders.forEach(f => f());
      }
      Z.animOverlay = null;
      Ed.grade = style ? G.applyLook(final, style) : final;
      zones = (a.locals || []).map(l => l.name);
      Ed.autoRef = { base: start, full: G.clone(final), t: 1, scene: a.scene };
      ok = true;
    } catch (e) {
      toast("Auto : " + e.message, "error");
    } finally {
      stage.removeEventListener("pointerdown", skip);
      $("ed-scan").style.display = "none";
      Z.animOverlay = null;
      Ed.animating = false; Ed.animSkip = false;
      btn.disabled = false; $("s-auto").disabled = false;
      $("s-auto").textContent = "✦ Améliorer automatiquement";
      if (Ed.photo === photo) {
        reconcilePaint();
        refreshUI(); requestRender();
        if (ok) { Ed.keepAuto = true; commit(); Ed.keepAuto = false; renderSimple(); }
        if (Ed.tab === "simple" || Ed.tab === "looks") renderLookThumbs();
      }
      if (ok) {
        let sc = Ed.autoRef && SCENES[Ed.autoRef.scene] ? ` · scène : ${SCENES[Ed.autoRef.scene]}` : "";
        if (Ed.grade.learned >= 0.5) sc += " · adapté à vos retouches";
        refreshLearned();
        caption(zones.length ? `✓ Terminé${sc} – zones retouchées : ${zones.join(", ")}`
                             : "✓ Terminé" + (Z.masks === "missing" ? " (détection IA non installée : voir Pro › Zones)" : ""));
        setTimeout(() => { if (!Ed.animating) caption(null); }, 2600);
      } else caption(null);
    }
  }

  function copyGrade() {
    state.gradeClipboard = G.portableGrade(Ed.grade);
    window.App.updateSelectionBar();
    toast("Étalonnage copié – collez-le sur d'autres photos (Ctrl+V ou sélection dans la grille)", "success", 4000);
  }
  function pasteGrade() {
    if (!state.gradeClipboard) { toast("Rien à coller", "info"); return; }
    Ed.grade = G.normalize({ grade: state.gradeClipboard }).grade;
    reconcilePaint();
    loadMasks();
    ensureLut().then(requestRender);
    refreshUI(); requestRender(); commit();
    toast("Étalonnage collé", "success");
  }
  function resetGrade() {
    if (Ed.task === "crop") {                  // in the crop screen the button resets the crop
      Ed.geo = G.defaultGeo();
      refreshUI(); requestRender(); commit();
      return;
    }
    Ed.grade = G.defaultGrade();
    reconcilePaint();
    refreshUI(); requestRender(); commit();
  }

  // ── Init ───────────────────────────────────────────────
  function init() {
    renderer = new GradeRenderer(canvas);
    scopes = new Scopes($("scope-canvas"));
    // re-render only when the scale changes (panning just moves the canvas)
    pz = new PanZoom(stage, content, { onChange: () => { updateOverlays(); if (pz && pz.s !== lastScale) requestRender(); }, maxZoom: 4 });
    pz.canPan = e => !brushOn() || e.button === 1 || Z.space;
    buildPrimaries();
    buildLooks();
    buildCrop();
    buildZones();
    buildSimple();
    refreshLearned();
    document.addEventListener("keyup", e => { if (e.key === " ") Z.space = false; });

    $("ed-close").addEventListener("click", close);
    $("ed-full").addEventListener("click", toggleFullscreen);
    document.addEventListener("fullscreenchange", () => {
      $("ed-full").classList.toggle("active", !!document.fullscreenElement);
      requestAnimationFrame(() => { if (pz.fitted) pz.fit(); requestRender(); });
    });
    $("ed-prev").addEventListener("click", () => go(-1));
    $("ed-next").addEventListener("click", () => go(1));
    $("ed-undo").addEventListener("click", () => restore(Ed.hIndex - 1));
    $("ed-redo").addEventListener("click", () => restore(Ed.hIndex + 1));
    $("ed-bypass").addEventListener("click", toggleBypass);
    $("ed-split").addEventListener("click", toggleSplit);
    $("ed-auto").addEventListener("click", autoGrade);
    $("ed-copy").addEventListener("click", copyGrade);
    $("ed-paste").addEventListener("click", pasteGrade);
    $("ed-reset").addEventListener("click", resetGrade);
    $("ed-tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) switchTab(b.dataset.tab); });
    $("scope-tabs").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      document.querySelectorAll("#scope-tabs button").forEach(x => x.classList.toggle("active", x === b));
      scopes.setMode(b.dataset.scope);
    });
    new ResizeObserver(() => { if (Ed.open) { scopes.update(scopes.last); drawCurves(); } }).observe($("scope-canvas"));

    document.addEventListener("keydown", e => {
      if (!Ed.open) return;
      if (Ed.animating) { if (e.key === "Escape" || e.key === " " || e.key === "Enter") { e.preventDefault(); Ed.animSkip = true; } return; }
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") && document.activeElement.type !== "range") return;
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") { if (document.fullscreenElement) return; e.preventDefault(); close(); }
      else if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); restore(Ed.hIndex - 1); }
      else if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); restore(Ed.hIndex + 1); }
      else if (mod && k === "c") { e.preventDefault(); copyGrade(); }
      else if (mod && k === "v") { e.preventDefault(); pasteGrade(); }
      else if (mod) return;
      else if (e.key === " " && Ed.tab === "masks") { e.preventDefault(); Z.space = true; }
      else if (k === "o" && Ed.tab === "masks") { Z.show = !Z.show; renderZones(); requestRender(); }
      else if ((e.key === "[" || e.key === "]") && Ed.tab === "masks") {
        Z.brush.size = Math.min(60, Math.max(1, Z.brush.size * (e.key === "]" ? 1.25 : 0.8)));
        fields.forEach(f => f.show());
      }
      else if (k === "b") toggleBypass();
      else if (k === "w") toggleSplit();
      else if (k === "a") autoGrade();
      else if (k === "f") toggleFullscreen();
      else if (e.key === "Enter" && Ed.task === "crop") close();
      else if (e.key === "ArrowLeft" && document.activeElement?.type !== "range") go(-1);
      else if (e.key === "ArrowRight" && document.activeElement?.type !== "range") go(1);
      else if (k === "0") pz.fit();
      else if (k === "1") pz.zoomAt(pz.oneToOne());
    });
    window.addEventListener("beforeunload", () => { if (Ed.dirty) save(); });
  }

  window.Editor = { open, close, isOpen: () => Ed.open, _state: Ed };
})();
