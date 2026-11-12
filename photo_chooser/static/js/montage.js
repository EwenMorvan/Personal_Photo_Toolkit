/* ══════════════════════════════════════════════════════
   Photo Studio – Montage module (photo / video slideshow editor)

   A montage = clips in order. A clip is a photo, a video or a title card, with a
   length, a movement (photos), a transition from the previous clip, an effect and a
   caption. drawFrame() paints any instant of the film on a canvas: the preview plays
   it in real time, the export calls it once per frame and sends the images to ffmpeg.
══════════════════════════════════════════════════════ */
(function () {
  const $ = id => document.getElementById(id);
  const { api, toast } = window.App;

  const MOTIONS = { in: "Zoom avant", out: "Zoom arrière", left: "Glisse vers la gauche", right: "Glisse vers la droite",
                    up: "Monte", down: "Descend", none: "Immobile" };
  const TRANS = { cut: "Coupe franche", dissolve: "Fondu enchaîné", fade: "Fondu au noir", slide: "Glissement", wipe: "Volet", zoom: "Zoom" };
  const OVERLAP = new Set(["dissolve", "slide", "wipe", "zoom"]);        // the two clips are on screen together
  const EFFECTS = { none: ["Aucun", "none"], bw: ["Noir & blanc", "grayscale(1) contrast(1.06)"], sepia: ["Sépia", "sepia(.8) saturate(1.1)"],
                    warm: ["Chaud", "sepia(.28) saturate(1.2)"], cool: ["Froid", "hue-rotate(-10deg) saturate(.92) brightness(1.03)"],
                    fade: ["Délavé", "contrast(.84) brightness(1.08) saturate(.78)"], punch: ["Éclatant", "contrast(1.18) saturate(1.3)"] };
  const STYLES = {
    voyage:    { photo: 3.4, video: 6, trans: ["dissolve", "slide", "dissolve", "zoom"], tdur: 0.8, motions: ["in", "left", "out", "right"], days: true },
    doux:      { photo: 4.0, video: 7, trans: ["dissolve"], tdur: 1.1, motions: ["in", "out"], days: false },
    dynamique: { photo: 1.7, video: 3.5, trans: ["cut", "cut", "zoom", "cut", "slide"], tdur: 0.3, motions: ["in", "in", "out"], days: false },
    cinema:    { photo: 5.0, video: 8, trans: ["fade", "dissolve", "dissolve"], tdur: 1.3, motions: ["left", "right", "in"], days: true, bars: true },
  };
  const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

  const M = {
    meta: null, mo: null, media: {}, order: [],
    sel: null, t: 0, playing: false, clock: 0,
    lay: [], total: 0, pps: 46, tray: "unused",
    history: [], hIndex: -1, saveTimer: null, exporting: false,
  };
  const imgs = new Map(), vids = new Map();
  const music = new Audio();
  music.preload = "auto";

  // ── helpers ───────────────────────────────────────────
  const uid = () => Math.random().toString(36).slice(2, 10);
  const projQ = () => `project=${encodeURIComponent(M.mo.project)}`;
  const thumb = pid => `/api/thumb/${pid}?${projQ()}&v=${(M.media[pid] || {}).rev || 0}`;
  const fmt = () => M.meta.formats[M.mo.format] || M.meta.formats["16:9"];
  const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const selClip = () => M.mo.clips.find(c => c.id === M.sel) || null;

  /** Where each clip sits in time (overlapping transitions shorten the film) */
  function layout() {
    let t = 0;
    M.lay = M.mo.clips.map((c, i) => {
      const tr = c.trans || {}, prev = M.mo.clips[i - 1];
      const ov = prev && OVERLAP.has(tr.type) ? Math.max(0, Math.min(tr.dur || 0, c.dur * 0.8, prev.dur * 0.8)) : 0;
      const start = Math.max(0, t - ov);
      t = start + c.dur;
      return { c, start, end: t, ov };
    });
    M.total = t;
  }
  const at = t => { let i = -1; for (let k = 0; k < M.lay.length; k++) if (M.lay[k].start <= t + 1e-6) i = k; return i; };

  // ── media ─────────────────────────────────────────────
  function image(pid, big) {
    const key = pid + (big ? "#b" : "");
    let im = imgs.get(key);
    if (!im) {
      im = new Image();
      im.src = `/api/render/${pid}?${projQ()}&max=${big ? 2560 : 1600}&v=${(M.media[pid] || {}).rev || 0}`;
      im.onload = () => { if (!M.playing && !M.exporting) paint(); };
      imgs.set(key, im);
    }
    return im;
  }
  function video(c) {
    let v = vids.get(c.id);
    if (!v) {
      v = document.createElement("video");
      v.src = `/api/video/${c.pid}?${projQ()}`;
      v.preload = "auto"; v.playsInline = true;
      v.addEventListener("loadeddata", () => { if (!M.playing && !M.exporting) paint(); });
      v.addEventListener("seeked", () => { if (!M.playing && !M.exporting) paint(); });
      vids.set(c.id, v);
    }
    return v;
  }
  const ready = el => el instanceof HTMLVideoElement ? el.readyState >= 2 : el.complete && el.naturalWidth > 0;

  // ── drawing ───────────────────────────────────────────
  /** Picture of a clip filling the frame, with its movement at progress u (0 → 1) */
  function drawMedia(ctx, el, c, u, W, H) {
    const iw = el.videoWidth || el.naturalWidth, ih = el.videoHeight || el.naturalHeight;
    const m = c.kind === "photo" ? (c.motion || "none") : "none";
    const z = m === "in" ? 1 + 0.14 * u : m === "out" ? 1.14 - 0.14 * u : m === "none" ? 1 : 1.12;
    const px = m === "left" ? 1 - u : m === "right" ? u : 0.5, py = m === "up" ? 1 - u : m === "down" ? u : 0.5;
    ctx.filter = (EFFECTS[c.fx] || EFFECTS.none)[1];
    if (c.fit === "contain") {                               // whole picture, over a blurred copy of itself
      const s0 = Math.max(W / iw, H / ih) * 1.1;
      ctx.filter = `blur(${Math.round(H / 40)}px) brightness(.45)`;
      ctx.drawImage(el, (W - iw * s0) / 2, (H - ih * s0) / 2, iw * s0, ih * s0);
      ctx.filter = (EFFECTS[c.fx] || EFFECTS.none)[1];
      const s = Math.min(W / iw, H / ih) * (0.94 + 0.06 * (z - 1) / 0.14);
      ctx.drawImage(el, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
    } else {
      const s = Math.max(W / iw, H / ih) * z, dw = iw * s, dh = ih * s;
      ctx.drawImage(el, -(dw - W) * px, -(dh - H) * py, dw, dh);
    }
    ctx.filter = "none";
  }
  function wrapText(ctx, text, maxW) {
    const out = [];
    for (const para of String(text).split("\n")) {
      let line = "";
      for (const word of para.split(" ")) {
        const test = line ? line + " " + word : word;
        if (line && ctx.measureText(test).width > maxW) { out.push(line); line = word; } else line = test;
      }
      out.push(line);
    }
    return out;
  }
  function drawClip(ctx, L, t, W, H, big) {
    const c = L.c, local = t - L.start, u = Math.min(1, Math.max(0, local / c.dur));
    if (c.kind === "title") {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, c.bg || "#141a2e"); g.addColorStop(1, c.bg2 || c.bg || "#0a0d18");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const a = ease(local / 0.7), dy = (1 - a) * H * 0.02;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = c.fg || "#ffffff";
      ctx.globalAlpha *= a;
      ctx.font = `700 ${Math.round(H * 0.105)}px "Segoe UI", sans-serif`;
      const lines = wrapText(ctx, c.title || "", W * 0.84), lh = H * 0.125;
      const y0 = H * (c.sub ? 0.46 : 0.5) - (lines.length - 1) * lh / 2;
      lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lh + dy));
      if (c.sub) {
        ctx.globalAlpha *= ease((local - 0.35) / 0.7) / Math.max(a, 0.001);
        ctx.font = `400 ${Math.round(H * 0.042)}px "Segoe UI", sans-serif`;
        ctx.fillText(c.sub, W / 2, y0 + (lines.length - 1) * lh + H * 0.115);
      }
      return;
    }
    const el = c.kind === "video" ? video(c) : image(c.pid, big);
    if (!ready(el)) {
      ctx.fillStyle = "#0d0f16"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#7b84a0"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `${Math.round(H * 0.03)}px "Segoe UI", sans-serif`;
      ctx.fillText(el.error ? "Cette vidéo ne peut pas être lue ici" : "Chargement…", W / 2, H / 2);
      return;
    }
    drawMedia(ctx, el, c, u, W, H);
    if (c.text) {
      const a = Math.min(ease(local / 0.5), ease((c.dur - local) / 0.5)), size = H * (c.tsize || 0.05);
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.font = `600 ${Math.round(size)}px "Segoe UI", sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const lines = wrapText(ctx, c.text, W * 0.86), lh = size * 1.3;
      const y0 = (c.tpos === "top" ? H * 0.12 : c.tpos === "center" ? H * 0.5 : H * 0.88) - (lines.length - 1) * lh * (c.tpos === "top" ? 0 : c.tpos === "center" ? 0.5 : 1);
      ctx.shadowColor = "#000c"; ctx.shadowBlur = size * 0.5; ctx.shadowOffsetY = size * 0.06;
      ctx.fillStyle = "#fff";
      lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lh));
      ctx.restore();
    }
  }
  /** The film at time t */
  function drawFrame(ctx, t, W, H, big) {
    ctx.globalAlpha = 1; ctx.filter = "none";
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    const i = at(t);
    if (i < 0) return;
    const cur = M.lay[i], prev = M.lay[i - 1], next = M.lay[i + 1], tr = cur.c.trans || {};
    const black = a => { if (a > 0) { ctx.globalAlpha = Math.min(1, a); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; } };
    if (prev && cur.ov > 0 && t < cur.start + cur.ov) {
      const p = ease((t - cur.start) / cur.ov);
      ctx.save();
      if (tr.type === "slide") ctx.translate(-p * W, 0);
      drawClip(ctx, prev, t, W, H, big);
      ctx.restore();
      ctx.save();
      if (tr.type === "dissolve") ctx.globalAlpha = p;
      else if (tr.type === "slide") ctx.translate((1 - p) * W, 0);
      else if (tr.type === "wipe") { ctx.beginPath(); ctx.rect(0, 0, W * p, H); ctx.clip(); }
      else if (tr.type === "zoom") { ctx.globalAlpha = p; const s = 1.35 - 0.35 * p; ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2); }
      drawClip(ctx, cur, t, W, H, big);
      ctx.restore();
    } else if (t < cur.end) {
      ctx.save();
      drawClip(ctx, cur, t, W, H, big);
      ctx.restore();
      if (prev && tr.type === "fade") black(1 - (t - cur.start) / ((tr.dur || 1) / 2));
      if (next && (next.c.trans || {}).type === "fade") black(1 - (cur.end - t) / ((next.c.trans.dur || 1) / 2));
    }
    black(1 - t / 0.6);                                       // the film opens from black and closes to black
    black(1 - (M.total - t) / 0.9);
    if (M.mo.bars) { const b = Math.round((H - W / 2.39) / 2); if (b > 0) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, b); ctx.fillRect(0, H - b, W, b); } }
  }

  // ── preview ───────────────────────────────────────────
  function paint() {
    const cv = $("mo-canvas");
    drawFrame(cv.getContext("2d"), M.t, cv.width, cv.height, false);
    $("mo-time").textContent = `${clock(M.t)} / ${clock(M.total)}`;
    $("mo-head").style.left = M.t * M.pps + "px";
  }
  function sizeCanvas() {
    const f = fmt(), cv = $("mo-canvas"), host = $("mo-stage").getBoundingClientRect();
    cv.width = Math.round(f.w / 2); cv.height = Math.round(f.h / 2);            // half size: fluid playback
    const s = Math.min((host.width - 28) / f.w, (host.height - 28) / f.h);
    if (!document.fullscreenElement) { cv.style.width = Math.max(80, f.w * s) + "px"; cv.style.height = Math.max(45, f.h * s) + "px"; }
    else { cv.style.width = ""; cv.style.height = ""; }
  }
  /** Keep the video elements and the music on the playhead */
  function syncMedia() {
    for (const L of M.lay) {
      if (L.c.kind !== "video") continue;
      const v = video(L.c), on = M.t >= L.start && M.t < L.end, sp = L.c.speed || 1;
      if (!on) { if (!v.paused) v.pause(); continue; }
      const want = (L.c.in || 0) + (M.t - L.start) * sp;
      if (Math.abs(v.currentTime - want) > (M.playing ? 0.35 : 0.04)) { try { v.currentTime = want; } catch { /* not loaded yet */ } }
      v.playbackRate = sp; v.volume = Math.min(1, L.c.volume ?? 1); v.muted = (L.c.volume ?? 1) === 0;
      if (M.playing && v.paused) v.play().catch(() => {});
      if (!M.playing && !v.paused) v.pause();
    }
    const mu = M.mo.music;
    if (mu && mu.src) {
      const url = `/api/montages/${M.mo.id}/assets/${mu.src}`;
      if (!music.src.endsWith(url)) music.src = url;
      music.volume = Math.min(1, mu.volume ?? 0.8);
      const want = music.duration ? M.t % music.duration : M.t;
      if (Math.abs(music.currentTime - want) > 0.4) { try { music.currentTime = want; } catch { /* not loaded yet */ } }
      if (M.playing && music.paused) music.play().catch(() => {});
      if (!M.playing && !music.paused) music.pause();
    } else if (!music.paused) music.pause();
  }
  function tick(now) {
    if (!M.playing) return;
    M.t += (now - M.clock) / 1000; M.clock = now;
    if (M.t >= M.total) { M.t = M.total; setPlaying(false); paint(); return; }
    syncMedia(); paint();
    const x = M.t * M.pps, sc = $("mo-tl-scroll");
    if (x > sc.scrollLeft + sc.clientWidth - 60) sc.scrollLeft = x - 80;
    requestAnimationFrame(tick);
  }
  function setPlaying(on) {
    if (on && !M.mo.clips.length) return;
    if (on && M.t >= M.total - 0.05) M.t = 0;
    M.playing = on;
    $("mo-play").textContent = on ? "⏸" : "▶";
    syncMedia();
    if (on) { M.clock = performance.now(); requestAnimationFrame(tick); }
  }
  function seek(t, keepPlaying) {
    if (!keepPlaying && M.playing) setPlaying(false);
    M.t = Math.min(Math.max(0, t), M.total);
    syncMedia(); paint();
  }

  // ── home ──────────────────────────────────────────────
  async function meta() { if (!M.meta) M.meta = await api("GET", "/api/montages/meta"); return M.meta; }
  async function showHome() {
    setPlayingSafe(false);
    $("mo-editor").classList.remove("active"); $("mo-home").classList.add("active");
    M.mo = null;
    await meta();
    const list = await api("GET", "/api/montages"), grid = $("mo-grid");
    grid.innerHTML = "";
    $("mo-empty").style.display = list.length ? "none" : "block";
    $("mo-count").textContent = list.length ? `${list.length} montage${list.length > 1 ? "s" : ""}` : "";
    for (const a of list) {
      const card = document.createElement("div");
      card.className = "proj-card al-card";
      const cover = a.cover ? `<img src="/api/thumb/${a.cover}?project=${encodeURIComponent(a.project)}" alt=""/>` : `<div class="ph">🎬</div>`;
      card.innerHTML = `<div class="stack"><div class="ph"></div><div class="ph"></div>${cover}</div>
        <div class="pc-name">${a.name.replace(/_/g, " ")}</div>
        <div class="pc-meta">${a.clips} plans · ${clock(a.seconds)} · ${a.format} · ${a.project.replace(/_/g, " ")}</div>
        <button class="al-card-del">Supprimer</button>`;
      card.addEventListener("click", async e => {
        if (e.target.classList.contains("al-card-del")) {
          if (!confirm(`Supprimer le montage « ${a.name} » ? (les photos et vidéos ne sont pas touchées)`)) return;
          await api("DELETE", `/api/montages/${a.id}`);
          showHome();
          return;
        }
        openMontage(a.id);
      });
      grid.appendChild(card);
    }
  }
  const setPlayingSafe = on => { if (M.mo) setPlaying(on); else { M.playing = false; music.pause(); } };

  // ── new / automatic ───────────────────────────────────
  let dlgMode = "new";
  async function openDialog(mode, project) {
    dlgMode = mode;
    await meta();
    const projects = await api("GET", "/api/projects");
    if (!projects.length) { toast("Créez d'abord un projet dans PhotoChooser", "info", 4000); return; }
    const fill = (id, opts, val) => { $(id).innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join(""); if (val) $(id).value = val; };
    fill("mo-f-project", projects.map(p => [p.name, `${p.name.replace(/_/g, " ")} (♥ ${p.liked_count} / ${p.photo_count})`]), project || (M.mo && M.mo.project));
    fill("mo-f-format", Object.entries(M.meta.formats).map(([k, f]) => [k, f.label]), M.mo ? M.mo.format : "16:9");
    const regen = mode === "regen";
    $("mo-dlg-title").textContent = regen ? "Refaire le montage automatiquement" : "Nouveau montage";
    $("mo-dlg-ok").textContent = regen ? "✦ Refaire" : "✦ Créer";
    $("mo-f-project").disabled = regen;
    $("mo-f-name").parentElement.style.display = regen ? "none" : "";
    $("mo-f-name").value = regen ? M.mo.name : $("mo-f-project").value.replace(/_/g, " ");
    if (regen && $("mo-f-style").value === "vide") $("mo-f-style").value = "voyage";
    $("mo-dialog").style.display = "flex";
  }
  async function runDialog() {
    const style = $("mo-f-style").value, target = +$("mo-f-length").value, source = $("mo-f-source").value;
    try {
      let mid;
      if (dlgMode === "regen") { mid = M.mo.id; M.mo.format = $("mo-f-format").value; }
      else {
        const m = await api("POST", "/api/montages", { project: $("mo-f-project").value, name: $("mo-f-name").value.trim() || $("mo-f-project").value,
                                                       format: $("mo-f-format").value });
        mid = m.id;
        await openMontage(mid, true);
      }
      $("mo-dialog").style.display = "none";
      if (style !== "vide") {
        autoBuild(style, target, source);
        commit();
        toast(`✦ Montage créé : ${M.mo.clips.length} plans, ${clock(M.total)}. Appuyez sur ▶ pour le regarder.`, "success", 6000);
      } else { drawAll(); if (dlgMode === "new") toast("Montage vide : cliquez sur les photos du bas pour les ajouter.", "info", 5000); }
    } catch (e) {
      $("mo-dialog").style.display = "none";
      toast("Erreur : " + e.message, "error", 5000);
    }
  }
  /** Automatic montage: chronological, a title, one card per day, lengths and transitions from the style */
  function autoBuild(styleName, target, source) {
    const S = STYLES[styleName] || STYLES.voyage;
    let list = M.order.filter(pid => source === "all" || M.media[pid].liked);
    if (!list.length) list = [...M.order];
    const perPhoto = S.photo - (OVERLAP.has(S.trans[0]) ? S.tdur : 0);
    if (target > 0) {                                        // keep an even sample of the trip when there is too much
      const max = Math.max(4, Math.floor((target - 6) / perPhoto));
      if (list.length > max) list = Array.from({ length: max }, (_, i) => list[Math.round(i * (list.length - 1) / (max - 1))]);
    }
    const dates = list.map(pid => M.media[pid].date).filter(Boolean).sort();
    const d0 = dates.length ? new Date(dates[0]) : null, d1 = dates.length ? new Date(dates[dates.length - 1]) : null;
    const range = !d0 ? "" : d0.toDateString() === d1.toDateString() ? `${d0.getDate()} ${MONTHS[d0.getMonth()]} ${d0.getFullYear()}`
      : d0.getMonth() === d1.getMonth() ? `${d0.getDate()} – ${d1.getDate()} ${MONTHS[d1.getMonth()]} ${d1.getFullYear()}`
      : `${d0.getDate()} ${MONTHS[d0.getMonth()]} – ${d1.getDate()} ${MONTHS[d1.getMonth()]} ${d1.getFullYear()}`;
    const clips = [{ id: uid(), kind: "title", dur: 3, title: M.mo.name.replace(/_/g, " "), sub: range, trans: { type: "cut", dur: 0 } }];
    const days = new Set(list.map(pid => (M.media[pid].date || "").slice(0, 10)));
    const dayCards = S.days && days.size > 1 && list.length / days.size >= 3;      // not one card every other photo
    let day = null, n = 0, k = 0;
    for (const pid of list) {
      const p = M.media[pid], d = (p.date || "").slice(0, 10);
      if (dayCards && d && d !== day) {
        day = d; n++;
        const dd = new Date(d);
        clips.push({ id: uid(), kind: "title", dur: 2.2, title: `Jour ${n}`, sub: `${dd.getDate()} ${MONTHS[dd.getMonth()]}`, trans: { type: "fade", dur: 0.8 } });
      }
      const tr = { type: S.trans[k % S.trans.length], dur: S.tdur };
      if (p.video) {
        const src = p.duration || S.video, dur = Math.min(src, S.video);
        clips.push({ id: uid(), kind: "video", pid, dur: Math.max(1, +dur.toFixed(2)), in: +Math.max(0, (src - dur) / 2).toFixed(2), speed: 1, volume: 1, trans: tr });
      } else clips.push({ id: uid(), kind: "photo", pid, dur: S.photo, motion: S.motions[k % S.motions.length], trans: tr });
      k++;
    }
    clips.push({ id: uid(), kind: "title", dur: 2.6, title: "Fin", sub: "", trans: { type: "fade", dur: 1 } });
    M.mo.clips = clips; M.mo.bars = !!S.bars; M.sel = null; M.t = 0;
  }

  // ── editor ────────────────────────────────────────────
  async function openMontage(mid, quiet) {
    await meta();
    M.mo = await api("GET", `/api/montages/${mid}`);
    const list = await api("GET", `/api/montages/${mid}/media`);
    M.media = {}; M.order = [];
    for (const p of list) { M.media[p.id] = p; M.order.push(p.id); }
    imgs.clear(); vids.forEach(v => { v.pause(); v.removeAttribute("src"); }); vids.clear();
    M.sel = null; M.t = 0; M.playing = false;
    M.history = [snap()]; M.hIndex = 0;
    $("mo-home").classList.remove("active"); $("mo-editor").classList.add("active");
    $("mo-name").value = M.mo.name.replace(/_/g, " ");
    $("mo-format").innerHTML = Object.entries(M.meta.formats).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join("");
    $("mo-format").value = M.mo.format;
    setSaved("");
    if (!quiet) drawAll();
  }
  function drawAll() { layout(); M.t = Math.min(M.t, M.total); sizeCanvas(); drawTimeline(); drawProps(); drawTray(); syncMedia(); paint(); }

  function drawTimeline() {
    const track = $("mo-track"), W = Math.max(M.total * M.pps + 200, 300);
    $("mo-tl").style.width = W + "px";
    track.innerHTML = "";
    M.lay.forEach((L, i) => {
      const c = L.c, d = document.createElement("div");
      d.className = `mo-clip ${c.kind}` + (c.id === M.sel ? " sel" : "");
      d.style.left = L.start * M.pps + "px"; d.style.width = Math.max(10, c.dur * M.pps - 2) + "px";
      d.dataset.i = i;
      if (c.pid) d.style.backgroundImage = `url("${thumb(c.pid)}")`;
      const label = c.kind === "title" ? (c.title || "Titre") : c.text || (M.media[c.pid] || {}).filename || "";
      d.innerHTML = (L.ov > 0 ? `<div class="tr" style="width:${L.ov * M.pps}px" title="${TRANS[c.trans.type]}"></div>` : "") +
        `<span class="ico">${c.kind === "video" ? "▶ " : c.kind === "title" ? "T " : ""}${c.dur.toFixed(1)} s</span><span class="lab">${label.replace(/</g, "&lt;")}</span><div class="grip" title="Tirer pour changer la durée"></div>`;
      d.title = `${TRANS[(c.trans || {}).type || "cut"]} · ${c.dur.toFixed(1)} s`;
      d.draggable = true;
      d.addEventListener("click", () => { M.sel = c.id; if (M.t < L.start || M.t >= L.end) seek(L.start + Math.min(L.ov + 0.05, c.dur / 2)); drawTimeline(); drawProps(); });
      d.addEventListener("dragstart", e => { drag = { move: i }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); d.classList.add("dragging"); });
      d.addEventListener("dragend", endDrag);
      // right edge: length
      const grip = d.querySelector(".grip");
      let g = null;
      grip.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); g = { x: e.clientX, dur: c.dur }; grip.setPointerCapture(e.pointerId); d.draggable = false; });
      grip.addEventListener("pointermove", e => {
        if (!g) return;
        const max = c.kind === "video" ? Math.max(0.5, (((M.media[c.pid] || {}).duration || 600) - (c.in || 0)) / (c.speed || 1)) : 60;
        c.dur = +Math.min(max, Math.max(0.5, g.dur + (e.clientX - g.x) / M.pps)).toFixed(2);
        d.style.width = Math.max(10, c.dur * M.pps - 2) + "px";
        d.querySelector(".ico").textContent = `${c.dur.toFixed(1)} s`;
      });
      grip.addEventListener("pointerup", () => { if (g) { g = null; commit(); } });
      grip.addEventListener("click", e => e.stopPropagation());
      track.appendChild(d);
    });
    // ruler
    const ruler = $("mo-ruler"), step = M.pps > 90 ? 1 : M.pps > 40 ? 2 : M.pps > 20 ? 5 : 10;
    ruler.innerHTML = "";
    for (let s = 0; s <= M.total + step; s += step) { const sp = document.createElement("span"); sp.style.left = s * M.pps + "px"; sp.textContent = clock(s); ruler.appendChild(sp); }
    // music
    const au = $("mo-audio"), mu = M.mo.music;
    au.innerHTML = mu && mu.src ? `<div class="bar" style="width:${Math.max(60, M.total * M.pps)}px" title="Cliquer pour régler la musique">🎵 ${String(mu.name || "Musique").replace(/</g, "&lt;")}</div>`
                                : `<div class="none">Pas de musique : bouton « 🎵 Musique… » pour ajouter un fichier audio.</div>`;
    const bar = au.querySelector(".bar");
    if (bar) bar.addEventListener("click", () => { M.sel = null; drawTimeline(); drawProps(); });
    const photos = M.mo.clips.filter(c => c.kind === "photo").length, videos = M.mo.clips.filter(c => c.kind === "video").length;
    $("mo-tl-info").textContent = `${photos} photo(s) · ${videos} vidéo(s) · ${clock(M.total)}`;
    $("mo-head").style.left = M.t * M.pps + "px";
    for (const id of ["mo-split", "mo-dup", "mo-del"]) $(id).disabled = !selClip();
  }

  // drag: reorder clips, or drop a photo from the tray at a place
  let drag = null;
  function endDrag() { drag = null; document.querySelectorAll("#app-montage .dragging, #app-montage .drop-b, #app-montage .drop-a").forEach(x => x.classList.remove("dragging", "drop-b", "drop-a")); }
  function dropPlace(e) {
    if (!drag || !e.target.closest || !e.target.closest("#mo-tl")) return null;
    const el = e.target.closest(".mo-clip");
    if (!el) return { pos: M.mo.clips.length };
    const i = +el.dataset.i, r = el.getBoundingClientRect(), before = e.clientX < r.left + r.width / 2;
    return { el, before, pos: before ? i : i + 1 };
  }
  window.addEventListener("dragover", e => {
    if (window.Shell.current !== "montage") return;
    e.preventDefault();
    document.querySelectorAll("#mo-track .drop-b, #mo-track .drop-a").forEach(x => x.classList.remove("drop-b", "drop-a"));
    const p = dropPlace(e);
    e.dataTransfer.dropEffect = p ? "move" : "none";
    if (p && p.el) p.el.classList.add(p.before ? "drop-b" : "drop-a");
  });
  window.addEventListener("drop", e => {
    if (window.Shell.current !== "montage") return;
    e.preventDefault();
    const d = drag, p = dropPlace(e);
    endDrag();
    if (!d || !p || !M.mo) return;
    if (d.pid) { addMedia(d.pid, p.pos); return; }
    const to = p.pos > d.move ? p.pos - 1 : p.pos;
    if (to === d.move) return;
    const [c] = M.mo.clips.splice(d.move, 1);
    M.mo.clips.splice(to, 0, c);
    M.sel = c.id;
    commit();
  });

  function addMedia(pid, pos) {
    const p = M.media[pid], S = STYLES.voyage;
    const c = p.video ? { id: uid(), kind: "video", pid, dur: +Math.min(p.duration || 6, 8).toFixed(2), in: 0, speed: 1, volume: 1, trans: { type: "dissolve", dur: 0.6 } }
                      : { id: uid(), kind: "photo", pid, dur: S.photo, motion: ["in", "out", "left", "right"][M.mo.clips.length % 4], trans: { type: "dissolve", dur: 0.8 } };
    const i = pos ?? (selClip() ? M.mo.clips.indexOf(selClip()) + 1 : M.mo.clips.length);
    M.mo.clips.splice(i, 0, c);
    M.sel = c.id;
    commit();
    seek(M.lay[i].start + Math.min(M.lay[i].ov + 0.05, c.dur / 2));
  }

  // ── properties ────────────────────────────────────────
  function drawProps() {
    const box = $("mo-props"), c = selClip();
    box.innerHTML = "";
    const panel = title => { const p = document.createElement("div"); p.className = "al-panel"; p.innerHTML = `<div class="section-label">${title}</div>`; const w = document.createElement("div"); w.className = "al-custom"; p.appendChild(w); box.appendChild(p); return w; };
    const live = () => { layout(); paint(); scheduleSave(); };
    const done = () => { pushHistory(); layout(); drawTimeline(); syncMedia(); paint(); scheduleSave(); };
    const ctl = (wrap, label, kind, get, set, o = {}) => {
      const row = document.createElement("label");
      if (kind === "area" || kind === "text") row.className = "col";
      const cap = document.createElement("span"); cap.textContent = label; row.appendChild(cap);
      let inp;
      if (kind === "select") { inp = document.createElement("select"); inp.className = "filter-input"; inp.innerHTML = o.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join(""); inp.value = get(); }
      else if (kind === "area") { inp = document.createElement("textarea"); inp.value = get() || ""; inp.placeholder = o.ph || ""; }
      else { inp = document.createElement("input"); inp.type = kind === "check" ? "checkbox" : kind; if (kind === "range") { inp.min = o.min; inp.max = o.max; inp.step = o.step; } if (kind === "check") inp.checked = !!get(); else inp.value = get() ?? ""; }
      const read = () => kind === "check" ? inp.checked : kind === "range" ? parseFloat(inp.value) : inp.value;
      const show = () => { if (kind === "range") cap.innerHTML = `${label} <b class="val">${o.fmt ? o.fmt(read()) : read()}</b>`; };
      show();
      inp.addEventListener("input", () => { set(read()); show(); live(); });
      inp.addEventListener("change", () => { set(read()); done(); if (o.redraw) drawProps(); });
      inp.addEventListener("keydown", e => e.stopPropagation());
      row.appendChild(inp); wrap.appendChild(row);
    };
    const sec = v => v.toFixed(1) + " s";

    if (!c) {                                               // nothing selected: the film itself
      const w = panel("Le film");
      ctl(w, "Bandes cinéma", "check", () => M.mo.bars, v => { M.mo.bars = v; });
      const mu = M.mo.music;
      const wm = panel("Musique");
      if (mu && mu.src) {
        ctl(wm, "Volume", "range", () => mu.volume ?? 0.8, v => { mu.volume = v; }, { min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + " %" });
        const b = document.createElement("button"); b.className = "btn btn-ghost"; b.textContent = "Retirer la musique";
        b.addEventListener("click", () => { M.mo.music = null; music.pause(); commit(); });
        wm.appendChild(b);
        const p = document.createElement("p"); p.className = "al-hint"; p.textContent = "La musique reprend au début si le film est plus long, et s'éteint en fondu à la fin.";
        wm.appendChild(p);
      } else { const p = document.createElement("p"); p.className = "al-hint"; p.textContent = "Aucune musique. Ajoutez un fichier audio (mp3, m4a, wav…) avec le bouton « 🎵 Musique… »."; wm.appendChild(p); }
      const wa = panel("Appliquer à tous les plans");
      const st = { dur: 3.4, trans: "dissolve", motion: "auto" };
      ctl(wa, "Durée des photos", "range", () => st.dur, v => { st.dur = v; }, { min: 1, max: 8, step: 0.1, fmt: sec });
      ctl(wa, "Transition", "select", () => st.trans, v => { st.trans = v; }, { options: Object.entries(TRANS) });
      const b = document.createElement("button"); b.className = "btn btn-outline"; b.textContent = "Appliquer";
      b.addEventListener("click", () => {
        M.mo.clips.forEach((x, i) => { if (x.kind === "photo") x.dur = st.dur; if (i > 0) x.trans = { type: st.trans, dur: (x.trans || {}).dur || 0.8 }; });
        commit();
      });
      wa.appendChild(b);
      const h = document.createElement("p"); h.className = "al-hint";
      h.textContent = "Cliquez sur un plan de la timeline pour le régler. Glissez-le pour le déplacer, tirez son bord droit pour changer sa durée. Espace : lecture.";
      box.appendChild(h);
      return;
    }
    const i = M.mo.clips.indexOf(c);
    if (c.kind === "title") {
      const w = panel("Carton de titre");
      ctl(w, "Titre", "area", () => c.title, v => { c.title = v; }, { ph: "Titre" });
      ctl(w, "Sous-titre", "text", () => c.sub, v => { c.sub = v; });
      ctl(w, "Fond", "color", () => c.bg || "#141a2e", v => { c.bg = v; c.bg2 = v; });
      ctl(w, "Texte", "color", () => c.fg || "#ffffff", v => { c.fg = v; });
      ctl(w, "Durée", "range", () => c.dur, v => { c.dur = v; }, { min: 0.8, max: 10, step: 0.1, fmt: sec });
    } else {
      const p = M.media[c.pid] || {};
      const w = panel(c.kind === "video" ? "Vidéo" : "Photo");
      if (c.kind === "video") {
        const src = p.duration || 600;
        ctl(w, "Début dans la vidéo", "range", () => c.in || 0, v => { c.in = Math.min(v, Math.max(0, src - 0.5)); c.dur = +Math.min(c.dur, (src - c.in) / (c.speed || 1)).toFixed(2); }, { min: 0, max: Math.max(0.1, +(src - 0.5).toFixed(1)), step: 0.1, fmt: sec });
        ctl(w, "Durée", "range", () => c.dur, v => { c.dur = +Math.min(v, (src - (c.in || 0)) / (c.speed || 1)).toFixed(2); }, { min: 0.5, max: Math.max(1, +Math.min(60, src).toFixed(1)), step: 0.1, fmt: sec });
        ctl(w, "Vitesse", "select", () => String(c.speed || 1), v => { c.speed = +v; c.dur = +Math.min(c.dur, (src - (c.in || 0)) / c.speed).toFixed(2); }, { options: [["0.5", "Ralenti ×0,5"], ["1", "Normale"], ["1.5", "Rapide ×1,5"], ["2", "Rapide ×2"]], redraw: true });
        ctl(w, "Son de la vidéo", "range", () => c.volume ?? 1, v => { c.volume = v; }, { min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + " %" });
      } else {
        ctl(w, "Durée", "range", () => c.dur, v => { c.dur = v; }, { min: 0.5, max: 12, step: 0.1, fmt: sec });
        ctl(w, "Mouvement", "select", () => c.motion || "none", v => { c.motion = v; }, { options: Object.entries(MOTIONS) });
      }
      ctl(w, "Cadrage", "select", () => c.fit || "cover", v => { c.fit = v; }, { options: [["cover", "Remplir l'écran"], ["contain", "Image entière (fond flou)"]] });
      ctl(w, "Effet", "select", () => c.fx || "none", v => { c.fx = v; }, { options: Object.entries(EFFECTS).map(([k, e]) => [k, e[0]]) });
      const wt = panel("Texte sur l'image");
      ctl(wt, "Texte", "area", () => c.text, v => { c.text = v; }, { ph: "Un lieu, une date, quelques mots…" });
      ctl(wt, "Position", "select", () => c.tpos || "bottom", v => { c.tpos = v; }, { options: [["bottom", "En bas"], ["center", "Au centre"], ["top", "En haut"]] });
      ctl(wt, "Taille", "range", () => c.tsize || 0.05, v => { c.tsize = v; }, { min: 0.025, max: 0.14, step: 0.005, fmt: v => Math.round(v * 1000) / 10 + " %" });
    }
    if (i > 0) {
      const wt = panel("Transition depuis le plan précédent");
      c.trans = c.trans || { type: "cut", dur: 0 };
      ctl(wt, "Type", "select", () => c.trans.type, v => { c.trans.type = v; if (v !== "cut" && !c.trans.dur) c.trans.dur = 0.8; }, { options: Object.entries(TRANS), redraw: true });
      if (c.trans.type !== "cut") ctl(wt, "Durée", "range", () => c.trans.dur || 0.8, v => { c.trans.dur = v; }, { min: 0.2, max: 2.5, step: 0.1, fmt: sec });
    }
  }

  // ── tray ──────────────────────────────────────────────
  function drawTray() {
    const used = new Set(M.mo.clips.map(c => c.pid).filter(Boolean)), host = $("mo-tray-list");
    const list = M.order.filter(pid => { const p = M.media[pid]; return M.tray === "all" ? true : M.tray === "liked" ? p.liked : p.liked && !used.has(pid); });
    host.innerHTML = "";
    for (const pid of list) {
      const p = M.media[pid], wrap = document.createElement("div");
      wrap.className = p.video ? "mo-vid" : "";
      const img = document.createElement("img");
      img.src = thumb(pid); img.loading = "lazy"; img.draggable = true; img.title = p.filename + (p.video && p.duration ? ` · ${clock(p.duration)}` : "");
      if (used.has(pid)) img.className = "used";
      img.addEventListener("dragstart", e => { drag = { pid }; e.dataTransfer.effectAllowed = "copyMove"; e.dataTransfer.setData("text/plain", ""); });
      img.addEventListener("dragend", endDrag);
      img.addEventListener("click", () => addMedia(pid));
      wrap.appendChild(img); host.appendChild(wrap);
    }
    const liked = M.order.filter(pid => M.media[pid].liked).length;
    $("mo-tray-info").textContent = `${used.size} utilisée(s) · ${liked} likée(s)` + (list.length ? " · cliquez pour ajouter après le plan sélectionné, ou glissez dans la timeline" : " · rien à afficher ici");
    document.querySelectorAll("#mo-tray-seg button").forEach(b => b.classList.toggle("active", b.dataset.v === M.tray));
  }

  // ── history / saving ──────────────────────────────────
  const snap = () => JSON.stringify({ clips: M.mo.clips, music: M.mo.music, bars: M.mo.bars, format: M.mo.format });
  function pushHistory() {
    const s = snap();
    if (M.history[M.hIndex] === s) return;
    M.history = M.history.slice(0, M.hIndex + 1); M.history.push(s);
    if (M.history.length > 80) M.history.shift();
    M.hIndex = M.history.length - 1;
  }
  function commit() { pushHistory(); scheduleSave(); drawAll(); }
  function restore(i) {
    if (i < 0 || i >= M.history.length) return;
    M.hIndex = i;
    Object.assign(M.mo, JSON.parse(M.history[i]));
    if (!selClip()) M.sel = null;
    $("mo-format").value = M.mo.format;
    scheduleSave(); drawAll();
  }
  function setSaved(t) { $("mo-save").textContent = t; }
  function scheduleSave() { setSaved("Enregistrement…"); clearTimeout(M.saveTimer); M.saveTimer = setTimeout(saveNow, 700); }
  async function saveNow() {
    clearTimeout(M.saveTimer); M.saveTimer = null;
    if (!M.mo) return;
    try {
      await api("PUT", `/api/montages/${M.mo.id}`, { name: M.mo.name, format: M.mo.format, clips: M.mo.clips, music: M.mo.music, bars: M.mo.bars });
      setSaved("Enregistré automatiquement");
    } catch (e) { setSaved("⚠ Non enregistré"); toast("Erreur d'enregistrement : " + e.message, "error"); }
  }
  async function flushSave() { if (M.saveTimer) await saveNow(); }

  // ── clip actions ──────────────────────────────────────
  function delClip() { const c = selClip(); if (!c) return; M.mo.clips.splice(M.mo.clips.indexOf(c), 1); M.sel = null; commit(); }
  function dupClip() { const c = selClip(); if (!c) return; const d = { ...JSON.parse(JSON.stringify(c)), id: uid() }; M.mo.clips.splice(M.mo.clips.indexOf(c) + 1, 0, d); M.sel = d.id; commit(); }
  function splitClip() {
    const c = selClip(), L = M.lay.find(l => l.c === c);
    if (!c || !L) return;
    const cut = M.t - L.start;
    if (cut < 0.3 || cut > c.dur - 0.3) { toast("Placez la tête de lecture à l'intérieur du plan sélectionné", "info"); return; }
    const b = { ...JSON.parse(JSON.stringify(c)), id: uid(), dur: +(c.dur - cut).toFixed(2), trans: { type: "cut", dur: 0 } };
    if (c.kind === "video") b.in = +((c.in || 0) + cut * (c.speed || 1)).toFixed(2);
    c.dur = +cut.toFixed(2);
    M.mo.clips.splice(M.mo.clips.indexOf(c) + 1, 0, b);
    M.sel = b.id;
    commit();
  }
  function step(d) {
    const i = at(M.t);
    if (d < 0) seek(i > 0 && M.t - M.lay[i].start < 0.3 ? M.lay[i - 1].start : i >= 0 ? M.lay[i].start : 0);
    else seek(i + 1 < M.lay.length ? M.lay[i + 1].start + 0.001 : M.total);
  }

  // ── export ────────────────────────────────────────────
  function openExport() {
    if (!M.mo.clips.length) { toast("Le montage est vide", "info"); return; }
    setPlaying(false);
    const frames = Math.ceil(M.total * M.mo.fps);
    $("mo-ex-info").textContent = M.meta.ffmpeg
      ? `${clock(M.total)} de film, ${frames} images à créer. Comptez environ ${Math.max(1, Math.round(frames / 12 / 60))} à ${Math.max(2, Math.round(frames / 5 / 60))} minute(s) en Full HD : laissez cette fenêtre ouverte et visible pendant ce temps.`
      : "ffmpeg est introuvable sur cet ordinateur : il est nécessaire pour créer le fichier vidéo. Installez-le (ffmpeg.org) puis relancez l'application.";
    $("mo-ex-go").disabled = !M.meta.ffmpeg;
    $("mo-ex-form").style.display = ""; $("mo-ex-progress").style.display = "none";
    $("mo-export-dlg").style.display = "flex";
  }
  const seekVideo = (v, want) => new Promise(res => {
    if (v.readyState >= 2 && Math.abs(v.currentTime - want) < 0.004) { res(); return; }
    const done = () => { v.removeEventListener("seeked", done); clearTimeout(to); res(); };
    const to = setTimeout(done, 4000);
    v.addEventListener("seeked", done);
    try { v.currentTime = want; } catch { done(); }
  });
  const waitReady = (el, ms) => new Promise(res => {
    if (ready(el) || el.error) { res(); return; }
    const t0 = Date.now(), iv = setInterval(() => { if (ready(el) || el.error || Date.now() - t0 > ms) { clearInterval(iv); res(); } }, 60);
  });
  async function exportVideo() {
    await flushSave();
    const f = fmt(), q = parseFloat($("mo-ex-quality").value), fps = M.mo.fps || 30;
    const W = Math.round(f.w * q / 2) * 2, H = Math.round(f.h * q / 2) * 2, N = Math.ceil(M.total * fps);
    const base = `/api/montages/${M.mo.id}/export`;
    $("mo-ex-form").style.display = "none"; $("mo-ex-progress").style.display = "";
    $("mo-ex-cancel").style.display = "";
    M.exporting = true;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d"), t0 = Date.now();
    try {
      await api("POST", `${base}/start`, { w: W, h: H, fps });
      for (let n = 0; n < N && M.exporting; n++) {
        const t = n / fps;
        for (const L of M.lay) {                           // everything on screen at t must be loaded, videos on the exact frame
          if (t < L.start - 0.05 || t >= L.end + 0.05 || L.c.kind === "title") continue;
          if (L.c.kind === "video") {
            const v = video(L.c);
            v.pause(); v.muted = true;
            await waitReady(v, 8000);
            await seekVideo(v, Math.max(0, (L.c.in || 0) + (t - L.start) * (L.c.speed || 1)));
          } else await waitReady(image(L.c.pid, W > 1700), 20000);
        }
        drawFrame(ctx, t, W, H, W > 1700);
        const blob = await new Promise(res => cv.toBlob(res, "image/jpeg", 0.93));
        const r = await fetch(`${base}/frame`, { method: "POST", body: blob });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "envoi d'une image");
        if (n % 5 === 0) {
          const left = (Date.now() - t0) / (n + 1) * (N - n - 1) / 1000;
          $("mo-ex-text").textContent = `Création des images… ${n + 1} / ${N}` + (n > 20 ? ` — encore ${left > 90 ? Math.round(left / 60) + " min" : Math.round(left) + " s"}` : "");
          $("mo-ex-bar").value = n / N * 96;
        }
      }
      if (!M.exporting) { await api("POST", `${base}/cancel`); $("mo-export-dlg").style.display = "none"; return; }
      $("mo-ex-text").textContent = "Assemblage de la vidéo et du son…"; $("mo-ex-bar").value = 98; $("mo-ex-cancel").style.display = "none";
      const audio = M.lay.filter(L => L.c.kind === "video" && (L.c.volume ?? 1) > 0)
        .map(L => ({ pid: L.c.pid, t0: L.start, in: L.c.in || 0, dur: L.c.dur, speed: L.c.speed || 1, volume: L.c.volume ?? 1 }));
      const res = await api("POST", `${base}/finish`, { total: N / fps, audio, music: M.mo.music });
      $("mo-ex-bar").value = 100;
      $("mo-ex-text").innerHTML = `✓ Vidéo créée : <b>${res.size_mb} Mo</b>${res.warning ? "<br>⚠ " + res.warning : ""}<br><span class="al-hint">${res.path}</span><br>`;
      const b = document.createElement("button");
      b.className = "btn btn-primary"; b.textContent = "📂 Ouvrir le dossier"; b.style.marginTop = "12px";
      b.addEventListener("click", () => api("POST", `${base}/open`).catch(e => toast(e.message, "error")));
      $("mo-ex-text").appendChild(b);
      $("mo-ex-cancel").style.display = ""; $("mo-ex-cancel").textContent = "Fermer";
    } catch (e) {
      api("POST", `${base}/cancel`).catch(() => {});
      $("mo-ex-text").textContent = "Erreur : " + e.message;
      $("mo-ex-cancel").style.display = ""; $("mo-ex-cancel").textContent = "Fermer";
    } finally {
      M.exporting = false;
      syncMedia(); paint();
    }
  }

  // ── events ────────────────────────────────────────────
  $("mo-new").addEventListener("click", () => openDialog("new"));
  $("mo-new2").addEventListener("click", () => openDialog("new"));
  $("mo-dlg-cancel").addEventListener("click", () => { $("mo-dialog").style.display = "none"; });
  $("mo-dlg-ok").addEventListener("click", runDialog);
  $("mo-f-project").addEventListener("change", () => { if (dlgMode === "new") $("mo-f-name").value = $("mo-f-project").value.replace(/_/g, " "); });
  $("mo-back").addEventListener("click", async () => { setPlaying(false); await flushSave(); showHome(); });
  $("mo-name").addEventListener("change", () => { M.mo.name = $("mo-name").value.trim() || M.mo.name; scheduleSave(); });
  $("mo-name").addEventListener("keydown", e => e.stopPropagation());
  $("mo-format").addEventListener("change", e => { M.mo.format = e.target.value; commit(); });
  $("mo-undo").addEventListener("click", () => restore(M.hIndex - 1));
  $("mo-redo").addEventListener("click", () => restore(M.hIndex + 1));
  $("mo-regen").addEventListener("click", () => openDialog("regen"));
  $("mo-export").addEventListener("click", openExport);
  $("mo-ex-close").addEventListener("click", () => { $("mo-export-dlg").style.display = "none"; });
  $("mo-ex-go").addEventListener("click", exportVideo);
  $("mo-ex-cancel").addEventListener("click", () => { if (M.exporting) M.exporting = false; else { $("mo-export-dlg").style.display = "none"; $("mo-ex-cancel").textContent = "Annuler"; } });
  $("mo-play").addEventListener("click", () => setPlaying(!M.playing));
  $("mo-canvas").addEventListener("click", () => setPlaying(!M.playing));
  $("mo-first").addEventListener("click", () => seek(0));
  $("mo-prev").addEventListener("click", () => step(-1));
  $("mo-next").addEventListener("click", () => step(1));
  $("mo-full").addEventListener("click", () => { if (document.fullscreenElement) document.exitFullscreen(); else $("mo-stage").requestFullscreen().catch(() => {}); });
  document.addEventListener("fullscreenchange", () => { if (M.mo && window.Shell.current === "montage") { sizeCanvas(); paint(); } });
  $("mo-add-title").addEventListener("click", () => {
    const c = { id: uid(), kind: "title", dur: 2.5, title: "Titre", sub: "", trans: { type: "fade", dur: 0.8 } };
    const i = selClip() ? M.mo.clips.indexOf(selClip()) + 1 : M.mo.clips.length;
    M.mo.clips.splice(i, 0, c); M.sel = c.id; commit(); seek(M.lay[i].start + 0.8);
  });
  $("mo-split").addEventListener("click", splitClip);
  $("mo-dup").addEventListener("click", dupClip);
  $("mo-del").addEventListener("click", delClip);
  $("mo-music-btn").addEventListener("click", () => $("mo-music-file").click());
  $("mo-music-file").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    try {
      const r = await fetch(`/api/montages/${M.mo.id}/music`, { method: "POST", body: fd }), j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      M.mo.music = { src: j.src, name: j.name, volume: 0.8 };
      M.sel = null; commit();
      toast("Musique ajoutée. Réglez son volume dans le panneau de droite.", "success", 4000);
    } catch (err) { toast("Erreur : " + err.message, "error"); }
  });
  $("mo-zoom").addEventListener("input", e => { M.pps = +e.target.value; drawTimeline(); });
  $("mo-tray-seg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { M.tray = b.dataset.v; drawTray(); } });
  // click / drag on the ruler or an empty part of the timeline: move the playhead
  let scrub = false;
  const scrubTo = e => { const r = $("mo-tl").getBoundingClientRect(); seek((e.clientX - r.left) / M.pps); };
  $("mo-ruler").addEventListener("pointerdown", e => { scrub = true; $("mo-ruler").setPointerCapture(e.pointerId); scrubTo(e); });
  $("mo-ruler").addEventListener("pointermove", e => { if (scrub) scrubTo(e); });
  $("mo-ruler").addEventListener("pointerup", () => { scrub = false; });
  $("mo-track").addEventListener("click", e => { if (e.target === $("mo-track")) { M.sel = null; scrubTo(e); drawTimeline(); drawProps(); } });
  new ResizeObserver(() => { if (M.mo && window.Shell.current === "montage") { sizeCanvas(); paint(); } }).observe($("mo-stage"));

  document.addEventListener("keydown", e => {
    if (window.Shell.current !== "montage" || !M.mo) return;
    if ($("mo-dialog").style.display !== "none" || $("mo-export-dlg").style.display !== "none") return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); restore(M.hIndex - 1); }
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); restore(M.hIndex + 1); }
    else if (mod && k === "d") { e.preventDefault(); dupClip(); }
    else if (e.key === " ") { e.preventDefault(); setPlaying(!M.playing); }
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "Home") seek(0);
    else if (k === "s") splitClip();
    else if (k === "f") $("mo-full").click();
    else if (e.key === "Delete" || e.key === "Backspace") delClip();
    else if (e.key === "Escape") { M.sel = null; drawTimeline(); drawProps(); }
  });
  window.addEventListener("beforeunload", () => { if (M.saveTimer) saveNow(); });

  window.Shell.register("montage", {
    onShow(arg) {
      if (arg && arg.project) { showHome().then(() => openDialog("new", arg.project)); return; }
      if (!M.mo) showHome(); else drawAll();
    },
    onHide() { if (M.mo) setPlaying(false); flushSave(); },
  });
  window.Montage = { state: M, drawFrame, layout, seek, exportVideo };
})();
