/* ══════════════════════════════════════════════════════
   PhotoChooser – Frontend Logic
══════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  currentProject: null,   // name string
  photos: [],             // current filtered list
  allPhotos: [],          // unfiltered list
  lbIndex: 0,             // lightbox index in state.photos
  likedOnlyMode: false,
  aiAvailable: false,
  selected: new Set(),    // selected ids in the grid
  lastClickIdx: null,     // anchor for shift-click
  gradeClipboard: null,   // copied grade (editor / grid paste)
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const qsa = sel => document.querySelectorAll(sel);

const viewHome       = $("view-home");
const viewProject    = $("view-project");
const projectList    = $("project-list");
const projectTitle   = $("project-title");
const photoCountBadge= $("photo-count-badge");
const photoGrid      = $("photo-grid");
const gridEmpty      = $("grid-empty");
const gridLoading    = $("grid-loading");
const likedCountWrap = $("liked-count-wrap");
const likedCountEl   = $("liked-count");
const aiBadgeWrap    = $("ai-badge-wrap");
const aiLabel        = $("ai-label");
const btnClassify    = $("btn-classify");
const filterCatWrap  = $("filter-category-wrap");
const selectionBar   = $("selection-bar");

// Lightbox refs
const lightbox    = $("lightbox");
const lbStage     = $("lb-stage");
const lbImg       = $("lb-img");
const lbVideo     = $("lb-video");
const lbVideoErr  = $("lb-video-error");
const lbSpinner   = $("lb-spinner");
const lbClose     = $("lb-close");
const lbPrev      = $("lb-prev");
const lbNext      = $("lb-next");
const lbFilename  = $("lb-filename");
const lbDate      = $("lb-date");
const lbLocation  = $("lb-location");
const lbCategory  = $("lb-category");
const lbCounter   = $("lb-counter");
const lbLikeBtn   = $("lb-like-btn");
const lbLikeLabel = $("lb-like-label");
const lbZoom      = $("lb-zoom");

const isVideo = p => !!p && p.type === "video";
const isEdited = p => !!(p && p.edits && !Grade.isIdentity(p.edits));

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, type = "info", duration = 2800, action = null) {
  const el = $("toast");
  el.textContent = msg;
  if (action) {
    const b = document.createElement("button");
    b.className = "toast-action";
    b.textContent = action.label;
    b.onclick = () => { el.style.display = "none"; action.run(); };
    el.appendChild(b);
  }
  el.className = `toast ${type}`;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = "none"; }, duration);
}

// ── API helpers ────────────────────────────────────────────────────────────
async function api(method, url, body) {
  const opts = {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const projQ = () => `project=${encodeURIComponent(state.currentProject)}`;
const thumbUrl = p => `/api/thumb/${p.id}?${projQ()}&v=${p.rev || 0}`;

// ── Project list ───────────────────────────────────────────────────────────
// The sidebar list and the home page show the same (searched / sorted) projects.
async function loadProjects() {
  try {
    state.projects = await api("GET", "/api/projects");
  } catch (e) {
    console.error(e);
    state.projects = state.projects || [];
  }
  renderProjects();
}

const MONTHS = { month: "short", year: "numeric" };
function projectDates(p) {
  if (!p.date_max) return "";
  const a = new Date(p.date_min).toLocaleDateString("fr-FR", MONTHS), b = new Date(p.date_max).toLocaleDateString("fr-FR", MONTHS);
  return a === b ? a : `${a} – ${b}`;
}

function renderProjects() {
  const q = $("proj-search").value.trim().toLowerCase(), sort = $("proj-sort").value;
  const list = (state.projects || [])
    .filter(p => p.name.replace(/_/g, " ").toLowerCase().includes(q))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name)
      : sort === "old" ? (a.date_min || "9999").localeCompare(b.date_min || "9999")
      : (b.date_max || "").localeCompare(a.date_max || ""));

  projectList.innerHTML = "";
  if (!list.length)
    projectList.innerHTML = `<li style="color:var(--text-muted);font-size:12px;padding:4px 6px">${state.projects.length ? "Aucun résultat" : "Aucun projet"}</li>`;
  const grid = $("home-grid");
  grid.innerHTML = "";
  for (const p of list) {
    const title = p.name.replace(/_/g, " ");
    const li = document.createElement("li");
    li.className = "project-item" + (state.currentProject === p.name ? " active" : "");
    li.dataset.name = p.name;
    li.innerHTML = `
      <span class="proj-name" title="${title}">${title}</span>
      <span class="proj-count">${p.photo_count}</span>
      <span class="proj-date">${projectDates(p)}</span>`;
    li.addEventListener("click", () => openProject(p.name));
    projectList.appendChild(li);

    const card = document.createElement("div");
    card.className = "proj-card";
    const covers = p.covers.map(c => `<img loading="lazy" src="/api/thumb/${c.id}?project=${encodeURIComponent(p.name)}&v=${c.rev}" alt=""/>`);
    while (covers.length < 3) covers.unshift(`<div class="ph">${covers.length ? "" : "📷"}</div>`);
    card.innerHTML = `
      <div class="stack">${covers.join("")}</div>
      <div class="pc-name">${title}</div>
      <div class="pc-meta">${p.photo_count} élément${p.photo_count > 1 ? "s" : ""}${p.liked_count ? ` · <span class="h">♥ ${p.liked_count}</span>` : ""}${p.date_max ? " · " + projectDates(p) : ""}</div>`;
    card.addEventListener("click", () => openProject(p.name));
    grid.appendChild(card);
  }
  const none = !(state.projects || []).length;
  $("home-empty").style.display = none ? "block" : "none";
  $("home-count").textContent = none ? "" : `${state.projects.length} projet${state.projects.length > 1 ? "s" : ""}`;
  document.querySelector(".home-head").style.display = none ? "none" : "flex";
}

function goHome() {
  state.currentProject = null;
  state.selected.clear();
  showView("home");
  updateLikedCount();
  loadProjects();
}

// ── Open project ───────────────────────────────────────────────────────────
async function openProject(name) {
  state.currentProject = name;
  state.likedOnlyMode = false;
  state.selected.clear();

  showView("project");
  projectTitle.textContent = name.replace(/_/g, " ");

  // Highlight sidebar
  qsa(".project-item").forEach(el => {
    el.classList.toggle("active", el.dataset.name === name);
  });

  await refreshPhotos();
  // make the sorted folder mirror exactly the liked items (fixes older "_1" copies)
  // and rewrite from project.json any liked photo missing from it
  api("POST", `/api/projects/${encodeURIComponent(name)}/sync-sorted`).then(res => {
    if (res.missing.length)
      toast(`${res.missing.length} photo(s) likée(s) introuvable(s) à la source (disque débranché ?) : ${res.missing.slice(0, 3).join(", ")}${res.missing.length > 3 ? "…" : ""}`, "error", 8000);
    else if (res.rewritten)
      toast(`Dossier trié : ${res.rewritten} photo(s) likée(s) recréée(s)`, "success", 4000);
  }).catch(() => {});
}

// ── Show / hide views ──────────────────────────────────────────────────────
function showView(name) {
  viewHome.classList.toggle("active", name === "home");
  viewProject.classList.toggle("active", name === "project");
}

// ── Refresh photos ─────────────────────────────────────────────────────────
// The full list is fetched once; filters are applied client-side.
async function refreshPhotos() {
  if (!state.currentProject) return;

  gridLoading.style.display = "flex";
  gridEmpty.style.display = "none";
  photoGrid.style.display = "none";

  try {
    state.allPhotos = await api("GET", `/api/projects/${encodeURIComponent(state.currentProject)}/photos`);
    applyFilters();
    updateCategoryFilter();
  } catch (e) {
    toast("Erreur chargement photos : " + e.message, "error");
  } finally {
    gridLoading.style.display = "none";
  }
}

function applyFilters() {
  const from = $("filter-date-from").value;
  const to   = $("filter-date-to").value;
  const cat  = $("filter-category").value;
  const gps  = $("filter-gps").checked;
  const media = $("filter-media").value;
  state.photos = state.allPhotos.filter(p =>
    (!from || (p.date && p.date >= from)) &&
    (!to || (p.date && p.date <= to + "T23:59:59")) &&
    (!cat || p.category === cat) &&
    (!gps || p.lat != null) &&
    (!media || (p.type || "photo") === media) &&
    (!state.likedOnlyMode || p.liked));
  // drop selections that are no longer visible
  const visible = new Set(state.photos.map(p => p.id));
  for (const id of [...state.selected]) if (!visible.has(id)) state.selected.delete(id);
  renderGrid();
  updateLikedCount();
  syncFilterUI();
}

/** Segmented controls + "clear" button reflect the active filters */
function syncFilterUI() {
  document.querySelectorAll("#seg-liked button").forEach(b => b.classList.toggle("active", (b.dataset.v === "liked") === state.likedOnlyMode));
  const media = $("filter-media").value;
  document.querySelectorAll("#seg-media button").forEach(b => b.classList.toggle("active", b.dataset.v === media));
  const any = state.likedOnlyMode || media || $("filter-date-from").value || $("filter-date-to").value
    || $("filter-category").value || $("filter-gps").checked;
  $("btn-reset-filters").style.display = any ? "" : "none";
}

function updateCategoryFilter() {
  const hasCat = state.allPhotos.some(p => p.category);
  filterCatWrap.style.display = hasCat ? "flex" : "none";
  if (AI_AVAILABLE_GLOBAL) btnClassify.style.display = "inline-flex";
}

function updateLikedCount() {
  const project = state.currentProject;
  const count = (project ? state.allPhotos : []).filter(p => p.liked).length;
  likedCountEl.textContent = count;
  likedCountWrap.style.display = project ? "flex" : "none";
}

let AI_AVAILABLE_GLOBAL = false;

// ── Render grid ────────────────────────────────────────────────────────────
let thumbObserver = null;

function fmtDuration(s) {
  if (!s && s !== 0) return "";
  s = Math.round(s);
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function renderGrid() {
  photoGrid.innerHTML = "";
  if (thumbObserver) thumbObserver.disconnect();

  if (state.photos.length === 0) {
    gridEmpty.style.display = "flex";
    photoGrid.style.display = "none";
    photoCountBadge.textContent = "0 élément";
    updateSelectionBar();
    return;
  }

  gridEmpty.style.display = "none";
  photoGrid.style.display = "grid";
  const nv = state.photos.filter(isVideo).length, np = state.photos.length - nv;
  photoCountBadge.textContent = `${np} photo${np > 1 ? "s" : ""}` + (nv ? ` · ${nv} vidéo${nv > 1 ? "s" : ""}` : "");

  const frag = document.createDocumentFragment();

  state.photos.forEach((photo, idx) => {
    const card = document.createElement("div");
    card.className = "photo-card" + (photo.liked ? " liked" : "") + (state.selected.has(photo.id) ? " selected" : "");
    card.dataset.id = photo.id;
    card.dataset.idx = idx;

    const dateStr = photo.date ? photo.date.slice(0, 10) : "";
    const catBadge = photo.category
      ? `<div class="card-category-badge">${catLabel(photo.category)}</div>` : "";
    const videoBadge = isVideo(photo)
      ? `<div class="card-video-badge">▶ ${fmtDuration(photo.duration)}</div>` : "";

    card.innerHTML = `
      <img class="loading" data-src="${thumbUrl(photo)}" alt="${photo.filename}"/>
      <div class="card-overlay">
        <div class="card-filename">${photo.filename}</div>
        ${dateStr ? `<div class="card-date">${dateStr}</div>` : ""}
      </div>
      ${catBadge}
      ${videoBadge}
      <div class="card-edited-badge" title="Photo modifiée (recadrage / étalonnage)">🎨</div>
      <div class="card-liked-badge">♥</div>
      <div class="card-check" title="Sélectionner (Ctrl+clic)">✓</div>
    `;
    card.classList.toggle("edited", isEdited(photo));

    card.addEventListener("click", e => onCardClick(e, idx));
    frag.appendChild(card);
  });

  photoGrid.appendChild(frag);

  // Lazy-load thumbnails with IntersectionObserver
  thumbObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        img.onload = () => img.classList.remove("loading");
        img.onerror = () => { img.classList.remove("loading"); img.classList.add("broken"); };
        thumbObserver.unobserve(img);
      }
    }
  }, { rootMargin: "300px" });

  photoGrid.querySelectorAll("img[data-src]").forEach(img => thumbObserver.observe(img));
  updateSelectionBar();
}

/** Update one card after an edit / like without re-rendering the grid */
function refreshCard(photo) {
  const card = photoGrid.querySelector(`[data-id="${photo.id}"]`);
  if (!card) return;
  card.classList.toggle("liked", !!photo.liked);
  card.classList.toggle("edited", isEdited(photo));
  const img = card.querySelector("img");
  const url = thumbUrl(photo);
  if (img.dataset.src !== url) {
    img.dataset.src = url;
    if (img.getAttribute("src")) img.src = url;
  }
}

/** Merge server data for a photo into both lists */
function updatePhoto(id, patch) {
  for (const list of [state.allPhotos, state.photos]) {
    const p = list.find(x => x.id === id);
    if (p) {
      Object.assign(p, patch);
      if ("edits" in patch && !patch.edits) delete p.edits;
    }
  }
  const p = state.allPhotos.find(x => x.id === id) || state.photos.find(x => x.id === id);
  if (p) refreshCard(p);
  return p;
}

function catLabel(cat) {
  const map = {
    landscape:"🌄 Paysage", sea:"🌊 Mer", mountain:"⛰️ Montagne",
    person:"🧑 Personne", city:"🏙️ Ville", forest:"🌲 Forêt",
    snow:"❄️ Neige", sunset:"🌅 Coucher", indoor:"🏠 Intérieur",
    food:"🍽️ Nourriture", animal:"🐾 Animal", architecture:"🏛️ Architecture",
  };
  return map[cat] || cat;
}

// ── Selection ──────────────────────────────────────────────────────────────
function onCardClick(e, idx) {
  const photo = state.photos[idx];
  const onCheck = e.target.classList.contains("card-check");
  if (e.shiftKey && state.lastClickIdx != null) {
    const [a, b] = [Math.min(state.lastClickIdx, idx), Math.max(state.lastClickIdx, idx)];
    for (let i = a; i <= b; i++) state.selected.add(state.photos[i].id);
    syncSelectionClasses();
    return;
  }
  if (onCheck || e.ctrlKey || e.metaKey || state.selected.size > 0) {
    if (state.selected.has(photo.id)) state.selected.delete(photo.id);
    else state.selected.add(photo.id);
    state.lastClickIdx = idx;
    syncSelectionClasses();
    return;
  }
  state.lastClickIdx = idx;
  openLightbox(idx);
}

function syncSelectionClasses() {
  photoGrid.querySelectorAll(".photo-card").forEach(c =>
    c.classList.toggle("selected", state.selected.has(c.dataset.id)));
  updateSelectionBar();
}

function updateSelectionBar() {
  const n = state.selected.size;
  selectionBar.style.display = n ? "flex" : "none";
  $("sel-count").textContent = n;
  photoGrid.classList.toggle("selecting", n > 0);
  $("sel-paste").disabled = !state.gradeClipboard;
}

function clearSelection() {
  state.selected.clear();
  syncSelectionClasses();
}

const selectedIds = () => state.photos.filter(p => state.selected.has(p.id)).map(p => p.id);
const selectedPhotoIds = () => state.photos.filter(p => state.selected.has(p.id) && !isVideo(p)).map(p => p.id);

// ── Remove from project (files stay on disk) ───────────────────────────────
async function removeFromProject(ids) {
  if (!ids.length) return;
  try {
    const res = await api("POST", `/api/projects/${encodeURIComponent(state.currentProject)}/photos/remove`, { ids });
    const gone = new Set(ids);
    state.allPhotos = state.allPhotos.filter(p => !gone.has(p.id));
    state.photos = state.photos.filter(p => !gone.has(p.id));
    for (const id of ids) state.selected.delete(id);
    renderGrid();
    updateLikedCount();
    loadProjects();
    const n = res.removed.length;
    toast(`${n} élément${n > 1 ? "s" : ""} retiré${n > 1 ? "s" : ""} du projet (fichiers conservés sur le disque)`, "info", 7000, {
      label: "Annuler",
      run: async () => {
        await api("POST", `/api/projects/${encodeURIComponent(state.currentProject)}/photos/restore`, { photos: res.removed });
        await refreshPhotos();
        loadProjects();
        toast("Retrait annulé", "success");
      },
    });
    return res;
  } catch (e) {
    toast("Erreur : " + e.message, "error");
  }
}

// ── Lightbox ───────────────────────────────────────────────────────────────
const lbPZ = new PanZoom(lbStage, lbImg, { onChange: onLbZoom, maxZoom: 4 });
let lbToken = 0;
let lbHiRes = false;
let lbNatural = { w: 1, h: 1, fullW: 1, fullH: 1 };

function openLightbox(idx) {
  state.lbIndex = idx;
  lightbox.style.display = "flex";
  document.body.style.overflow = "hidden";
  showLbPhoto();
}

function closeLightbox() {
  lightbox.style.display = "none";
  document.body.style.overflow = "";
  lbImg.src = "";
  stopVideo();
}

function stopVideo() {
  lbVideo.pause();
  lbVideo.removeAttribute("src");
  lbVideo.load();
}

function lbRenderUrl(photo, full) {
  return `/api/render/${photo.id}?${projQ()}&max=${full ? 0 : 2560}&v=${photo.rev || 0}`;
}

/** Full-resolution size of the rendered photo (after crop), guessed from metadata */
function fullSizeFor(photo, loadedW, loadedH) {
  const e = Grade.normalize(photo.edits);
  let w = photo.width || loadedW, h = photo.height || loadedH;
  const cand = [Grade.geometry(w, h, e.geo), Grade.geometry(h, w, e.geo)];
  const ar = loadedW / loadedH;
  const g = Math.abs(cand[0].outW / cand[0].outH - ar) <= Math.abs(cand[1].outW / cand[1].outH - ar) ? cand[0] : cand[1];
  // never pretend to be smaller than what we already have
  return g.outW >= loadedW ? { w: g.outW, h: g.outH } : { w: loadedW, h: loadedH };
}

function onLbZoom(pz) {
  lbZoom.textContent = pz.fitted ? "Ajusté" : `${pz.percent()} %`;
  const photo = state.photos[state.lbIndex];
  if (!photo || isVideo(photo) || lbHiRes || pz.fitted) return;
  // displayed image pixels per screen pixel too low → fetch full resolution
  const need = pz.s * (window.devicePixelRatio || 1);
  if (need > (lbNatural.w / lbNatural.fullW) * 1.05) {
    lbHiRes = true;
    const token = lbToken;
    const hi = new Image();
    lbSpinner.classList.add("visible");
    hi.onload = () => { if (token === lbToken) { lbImg.src = hi.src; lbSpinner.classList.remove("visible"); } };
    hi.onerror = () => lbSpinner.classList.remove("visible");
    hi.src = lbRenderUrl(photo, true);
  }
}

function showLbPhoto() {
  const photo = state.photos[state.lbIndex];
  if (!photo) return;
  const token = ++lbToken;
  lbHiRes = false;
  stopVideo();

  const video = isVideo(photo);
  lbStage.style.display = video ? "none" : "";
  lbVideo.style.display = video ? "" : "none";
  lbVideoErr.style.display = "none";
  $("lb-edit").style.display = video ? "none" : "";
  $("lb-crop").style.display = video ? "none" : "";
  $("lb-external").style.display = video ? "" : "none";
  lbZoom.style.display = video ? "none" : "";

  if (video) {
    lbSpinner.classList.remove("visible");
    lbVideo.src = `/api/video/${photo.id}?${projQ()}`;
    lbVideo.play().catch(() => {});
  } else {
    lbSpinner.classList.add("visible");
    lbImg.style.opacity = "0";
    const pre = new Image();
    pre.onload = () => {
      if (token !== lbToken) return;
      const full = fullSizeFor(photo, pre.naturalWidth, pre.naturalHeight);
      lbNatural = { w: pre.naturalWidth, h: pre.naturalHeight, fullW: full.w, fullH: full.h };
      lbImg.src = pre.src;
      lbPZ.setSize(full.w, full.h);
      lbSpinner.classList.remove("visible");
      lbImg.style.opacity = "1";
    };
    pre.onerror = () => { if (token === lbToken) { lbSpinner.classList.remove("visible"); toast("Impossible d'afficher cette photo", "error"); } };
    pre.src = lbRenderUrl(photo, false);
    // warm the cache for neighbours
    for (const d of [1, -1]) {
      const n = state.photos[state.lbIndex + d];
      if (n && !isVideo(n)) new Image().src = lbRenderUrl(n, false);
    }
  }

  // Meta
  lbFilename.textContent = photo.filename;
  lbDate.textContent = photo.date ? photo.date.slice(0, 19).replace("T", " ") : "";
  lbDate.style.display = photo.date ? "" : "none";

  if (photo.lat != null) {
    lbLocation.textContent = `📍 ${photo.lat.toFixed(4)}, ${photo.lon.toFixed(4)}`;
    lbLocation.style.display = "";
    lbLocation.href = `https://maps.google.com/?q=${photo.lat},${photo.lon}`;
    lbLocation.target = "_blank";
  } else {
    lbLocation.style.display = "none";
  }

  lbCategory.textContent = photo.category ? catLabel(photo.category) : "";
  lbCategory.style.display = photo.category ? "" : "none";
  $("lb-edited").style.display = isEdited(photo) ? "" : "none";

  lbCounter.textContent = `${state.lbIndex + 1} / ${state.photos.length}`;

  lbPrev.disabled = state.lbIndex === 0;
  lbNext.disabled = state.lbIndex === state.photos.length - 1;

  updateLbLikeBtn(photo.liked);
}

lbVideo.addEventListener("error", () => {
  if (!lbVideo.getAttribute("src")) return;
  lbVideo.style.display = "none";
  lbVideoErr.style.display = "flex";
});

function updateLbLikeBtn(liked) {
  lbLikeBtn.classList.toggle("liked", liked);
  lbLikeLabel.textContent = liked ? "Liké ♥" : "Liker";
}

async function toggleLike(idx, forceValue) {
  const photo = state.photos[idx];
  if (!photo) return;

  const wasLiked = photo.liked;
  const want = forceValue ?? !wasLiked;
  if (want === wasLiked) return;
  const method = want ? "POST" : "DELETE";

  // Optimistic update
  photo.liked = want;
  if (lightbox.style.display !== "none" && state.lbIndex === idx) updateLbLikeBtn(photo.liked);
  updateCardLike(photo.id, photo.liked);
  updateLikedCount();

  try {
    await api(method, `/api/projects/${encodeURIComponent(state.currentProject)}/photos/${photo.id}/like`);
    // Also update allPhotos
    const ap = state.allPhotos.find(p => p.id === photo.id);
    if (ap) ap.liked = photo.liked;
    if (forceValue == null)
      toast(photo.liked ? "♥ Likée ! (copiée dans le dossier trié)" : "Retirée des likées", photo.liked ? "success" : "info");
    // If in liked-only mode and we just unliked, remove from filtered list and refresh grid
    if (state.likedOnlyMode && !photo.liked) {
      state.photos.splice(idx, 1);
      // Adjust lightbox index
      if (state.lbIndex >= state.photos.length) state.lbIndex = Math.max(0, state.photos.length - 1);
      renderGrid();
      if (lightbox.style.display !== "none") {
        if (state.photos.length > 0) showLbPhoto();
        else closeLightbox();
      }
      updateLikedCount();
    }
  } catch (e) {
    // Revert
    photo.liked = wasLiked;
    updateLbLikeBtn(photo.liked);
    updateCardLike(photo.id, photo.liked);
    updateLikedCount();
    toast("Erreur : " + e.message, "error");
  }
}

function updateCardLike(photoId, liked) {
  const card = photoGrid.querySelector(`[data-id="${photoId}"]`);
  if (card) card.classList.toggle("liked", liked);
}

async function removeCurrentLbPhoto() {
  const photo = state.photos[state.lbIndex];
  if (!photo) return;
  const res = await removeFromProject([photo.id]);
  if (!res) return;
  if (state.photos.length === 0) { closeLightbox(); return; }
  if (state.lbIndex >= state.photos.length) state.lbIndex = state.photos.length - 1;
  showLbPhoto();
}

function lbGo(delta) {
  const i = state.lbIndex + delta;
  if (i < 0 || i >= state.photos.length) return;
  state.lbIndex = i;
  showLbPhoto();
}

function openEditorFromLightbox(tab) {
  const photo = state.photos[state.lbIndex];
  if (!photo || isVideo(photo)) return;
  stopVideo();
  window.Editor.open(state.lbIndex, tab, idx => {
    // back from the editor: show the (possibly edited) photo again
    if (idx != null) state.lbIndex = idx;
    showLbPhoto();
  });
}

// ── Controls / Events ──────────────────────────────────────────────────────

// New project buttons
[$("btn-new-project"), $("btn-welcome-new")].forEach(btn => {
  btn.addEventListener("click", () => {
    $("modal-new-project").style.display = "flex";
    setTimeout(() => $("new-project-name").focus(), 50);
  });
});

$("btn-cancel-project").addEventListener("click", () => {
  $("modal-new-project").style.display = "none";
  $("new-project-name").value = "";
});

$("btn-confirm-project").addEventListener("click", createProject);
$("new-project-name").addEventListener("keydown", e => { if (e.key === "Enter") createProject(); });

async function createProject() {
  const name = $("new-project-name").value.trim();
  if (!name) return;
  try {
    const data = await api("POST", "/api/projects", { name });
    $("modal-new-project").style.display = "none";
    $("new-project-name").value = "";
    await loadProjects();
    openProject(data.name);
    toast(`Projet "${data.name}" créé !`, "success");
  } catch (e) {
    toast("Erreur : " + e.message, "error");
  }
}

// Add folder
$("btn-add-folder").addEventListener("click", async () => {
  try {
    const res = await api("GET", "/api/browse/folder");
    if (!res.path) return;
    await addSources([res.path]);
  } catch (e) {
    toast("Erreur : " + e.message, "error");
  }
});

// Add files
$("btn-add-files").addEventListener("click", async () => {
  try {
    const res = await api("GET", "/api/browse/files");
    if (!res.paths || res.paths.length === 0) return;
    await addSources(res.paths);
  } catch (e) {
    toast("Erreur : " + e.message, "error");
  }
});

// ── Import from phone (Android « Photo Finder » app on the same Wi-Fi) ──────
// Several phones may answer: each one has its own line and its own progress.
let phoneTimer = null, phoneRev = 0;
const phoneClosed = s => ["cancelled", "error"].includes(s.status);

function phoneLine(p) {
  const n = (p.received || 0) + (p.skipped || 0) + (p.failed || 0);
  switch (p.status) {
    case "receiving": return `⬇️ envoi en cours… ${n} / ${p.expected || "?"}`;
    case "done":      return `✔ ${p.received} reçu(s) · ${p.skipped} déjà présent(s)${p.failed ? ` · ${p.failed} échec(s)` : ""}`;
    case "cancelled": return "a ignoré la demande";
    default:          return "connecté · en attente de la sélection";
  }
}

function renderPhone(s) {
  const mb = b => (b / 1048576).toFixed(b > 104857600 ? 0 : 1).replace(".", ",") + " Mo";
  const phones = s.phones || [];
  const total = s.expected || 0, done = (s.received || 0) + (s.skipped || 0) + (s.failed || 0);
  let status = "", hint = "", icon = "📱";
  switch (s.status) {
    case "starting":  status = "Préparation…"; break;
    case "searching":
      status = "Recherche des téléphones sur le réseau…";
      hint = "Ouvre Photo Finder sur le téléphone, connecté au même Wi-Fi que ce PC. " +
             "Une notification « Le PC demande des photos » va apparaître.";
      icon = "📡"; break;
    case "connected":
      status = phones.length > 1 ? `${phones.length} téléphones connectés` : `${phones[0]?.name || "Téléphone"} connecté`;
      hint = "Sur le téléphone : sélectionne les photos, puis Exporter › « PC · Photo Studio ».";
      icon = "✅"; break;
    case "receiving": status = `Réception… ${done} / ${total}`; icon = "⬇️"; break;
    case "scanning":  status = "Ajout au projet…"; icon = "⏳"; break;
    case "done":
      status = `${s.received} fichier(s) reçu(s), ${s.added} ajouté(s) au projet`;
      hint = phones.some(p => p.status !== "done" && p.status !== "cancelled")
        ? "Un autre téléphone peut encore envoyer ses photos."
        : `Dossier : ${s.folder}`;
      icon = "🎉"; break;
    case "cancelled": status = "Import terminé."; hint = s.error || ""; icon = "✖"; break;
    case "error":     status = "Erreur"; hint = s.error || ""; icon = "⚠️"; break;
  }
  $("phone-icon").textContent = icon;
  $("phone-status").textContent = status;
  $("phone-hint").textContent = hint;
  $("phone-sub").textContent = s.pc ? `${s.pc} · ${(s.ips || []).join(", ")}` : "Application Photo Finder";
  const list = $("phone-list");
  list.innerHTML = "";
  for (const p of phones) {
    const row = document.createElement("div");
    row.className = `phone-row ${p.status}`;
    const name = document.createElement("b"); name.textContent = p.name;
    const info = document.createElement("span"); info.textContent = phoneLine(p);
    row.append(name, info);
    list.appendChild(row);
  }
  list.style.display = phones.length ? "" : "none";
  const showBar = s.status === "receiving" || s.status === "scanning";
  $("phone-bar").style.display = showBar ? "block" : "none";
  $("phone-bar-fill").style.width = (total ? Math.min(100, done * 100 / total) : (s.status === "scanning" ? 100 : 0)) + "%";
  $("phone-stats").textContent = (s.received || s.skipped)
    ? `${s.received || 0} reçus · ${s.skipped || 0} déjà présents${s.failed ? ` · ${s.failed} échecs` : ""} · ${mb(s.bytes || 0)}`
    : "";
  const closed = phoneClosed(s), anyDone = phones.some(p => p.status === "done");
  $("btn-phone-cancel").style.display = closed ? "none" : "";
  $("btn-phone-cancel").textContent = anyDone ? "Terminer" : "Annuler";
  $("btn-phone-close").style.display = closed ? "" : "none";
}

function pollPhone() {
  clearInterval(phoneTimer);
  phoneTimer = setInterval(async () => {
    let s;
    try { s = await api("GET", "/api/phone/status"); } catch { return; }
    renderPhone(s);
    if ((s.rev || 0) !== phoneRev) {          // a phone finished: show its photos right away
      const before = phoneRev; phoneRev = s.rev || 0;
      if (before !== phoneRev && s.added) toast(`${s.added} élément(s) ajouté(s) depuis le téléphone`, "success");
      await loadProjects();
      await refreshPhotos();
    }
    if (phoneClosed(s)) clearInterval(phoneTimer);
  }, 1000);
}

$("btn-add-phone").addEventListener("click", async e => {
  e.stopPropagation();
  $("add-menu").classList.remove("open");
  if (!state.currentProject) return;
  $("modal-phone").style.display = "flex";
  renderPhone({ status: "starting" });
  try {
    const s = await api("POST", `/api/projects/${encodeURIComponent(state.currentProject)}/phone/start`);
    phoneRev = s.rev || 0;
    renderPhone(s);
    pollPhone();
  } catch (err) {
    renderPhone({ status: "error", error: err.message });
  }
});
// Closing the window ends the request for every phone
$("btn-phone-cancel").addEventListener("click", async () => {
  clearInterval(phoneTimer);
  await api("POST", "/api/phone/cancel").catch(() => {});
  $("modal-phone").style.display = "none";
});
$("btn-phone-close").addEventListener("click", () => { $("modal-phone").style.display = "none"; });

// Open sorted photos folder in Explorer
$("btn-open-sorted").addEventListener("click", async () => {
  if (!state.currentProject) return;
  try {
    await api("POST", `/api/projects/${encodeURIComponent(state.currentProject)}/open-sorted`);
  } catch (e) {
    toast("Erreur : " + e.message, "error");
  }
});

async function addSources(sources) {
  toast("Scan en cours…", "info", 120000);
  try {
    const res = await api("POST", `/api/projects/${encodeURIComponent(state.currentProject)}/scan`, { sources });
    toast(`${res.added} élément(s) ajouté(s) – total : ${res.total}`, "success");
    await loadProjects();
    await refreshPhotos();
  } catch (e) {
    toast("Erreur : " + e.message, "error");
  }
}

// Segmented filters
$("seg-liked").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  state.likedOnlyMode = b.dataset.v === "liked";
  applyFilters();
});
$("seg-media").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  $("filter-media").value = b.dataset.v;
  applyFilters();
});

// "+ Ajouter des photos" menu
$("btn-add").addEventListener("click", e => { e.stopPropagation(); $("add-menu").classList.toggle("open"); });
document.addEventListener("click", () => $("add-menu").classList.remove("open"));

// Suite: go and make an album with this project's liked photos
$("btn-make-album").addEventListener("click", () => window.Shell.show("album", { project: state.currentProject }));
window.Shell.register("chooser", { onShow() { if (!state.currentProject) loadProjects(); } });

// Home
$("btn-home").addEventListener("click", goHome);
$("logo-home").addEventListener("click", goHome);
$("proj-search").addEventListener("input", renderProjects);
$("proj-sort").addEventListener("change", renderProjects);

// Filters
["filter-date-from", "filter-date-to", "filter-category", "filter-media", "filter-gps"].forEach(id => {
  $(id).addEventListener("change", applyFilters);
});

$("btn-reset-filters").addEventListener("click", () => {
  $("filter-date-from").value = "";
  $("filter-date-to").value   = "";
  $("filter-category").value  = "";
  $("filter-media").value     = "";
  $("filter-gps").checked     = false;
  state.likedOnlyMode = false;
  applyFilters();
});

// AI classify
btnClassify.addEventListener("click", async () => {
  toast("Classification IA en cours… (peut prendre quelques minutes)", "info", 120000);
  try {
    const res = await api("POST", `/api/projects/${encodeURIComponent(state.currentProject)}/classify`);
    toast(`${res.classified} photo(s) classifiée(s)`, "success");
    await refreshPhotos();
  } catch (e) {
    toast("IA indisponible : " + e.message, "error");
  }
});

// Selection bar
$("sel-all").addEventListener("click", () => { state.photos.forEach(p => state.selected.add(p.id)); syncSelectionClasses(); });
$("sel-clear").addEventListener("click", clearSelection);
$("sel-remove").addEventListener("click", () => removeFromProject(selectedIds()));
$("sel-like").addEventListener("click", async () => {
  const ids = selectedIds();
  for (const id of ids) {
    const idx = state.photos.findIndex(p => p.id === id);
    if (idx >= 0) await toggleLike(idx, true);
  }
  toast(`♥ ${ids.length} élément(s) liké(s)`, "success");
});

async function batchGrade(body, label) {
  const ids = selectedPhotoIds();
  if (!ids.length) { toast("Aucune photo (les vidéos ne sont pas étalonnées)", "info"); return; }
  toast(`${label}…`, "info", 60000);
  try {
    const res = await api("POST", `/api/projects/${encodeURIComponent(state.currentProject)}/edits/batch`, { ids, ...body });
    for (const [id, v] of Object.entries(res)) updatePhoto(id, { rev: v.rev, edits: v.edits });
    toast(`${label} : ${Object.keys(res).length} photo(s)`, "success");
  } catch (e) {
    toast("Erreur : " + e.message, "error");
  }
}

$("sel-paste").addEventListener("click", () => {
  if (!state.gradeClipboard) return;
  batchGrade({ grade: state.gradeClipboard, keep_geo: true }, "Étalonnage collé");
});
$("sel-reset-grade").addEventListener("click", () => batchGrade({ grade: null, keep_geo: true }, "Étalonnage réinitialisé"));
$("sel-auto").addEventListener("click", async () => {
  const ids = selectedPhotoIds();
  if (!ids.length) return;
  toast(`Auto couleur sur ${ids.length} photo(s)…`, "info", 120000);
  try {
    const res = await api("POST", `/api/projects/${encodeURIComponent(state.currentProject)}/auto-grade`, { ids, apply: true });
    for (const [id, v] of Object.entries(res)) updatePhoto(id, { rev: v.rev, edits: v.edits });
    toast(`✦ Auto couleur appliquée à ${Object.keys(res).length} photo(s)`, "success");
  } catch (e) {
    toast("Erreur : " + e.message, "error");
  }
});

// One click for the whole selection of liked photos
$("btn-enhance-liked").addEventListener("click", async () => {
  const todo = state.allPhotos.filter(p => p.liked && !isVideo(p) && !isEdited(p));
  const already = state.allPhotos.filter(p => p.liked && !isVideo(p) && isEdited(p)).length;
  if (!todo.length) { toast(already ? "Toutes les photos likées sont déjà retouchées" : "Aucune photo likée à améliorer", "info"); return; }
  const btn = $("btn-enhance-liked"), label = btn.textContent;
  btn.disabled = true;
  let done = 0, failed = 0;
  try {
    for (let i = 0; i < todo.length; i += 3) {
      const ids = todo.slice(i, i + 3).map(p => p.id);
      btn.textContent = `✦ ${done} / ${todo.length}…`;
      try {
        const res = await api("POST", `/api/projects/${encodeURIComponent(state.currentProject)}/auto-grade`, { ids, apply: true });
        for (const [id, v] of Object.entries(res)) updatePhoto(id, { rev: v.rev, edits: v.edits });
        done += Object.keys(res).length; failed += ids.length - Object.keys(res).length;
      } catch (e) { failed += ids.length; }
    }
    toast(`✦ ${done} photo(s) améliorée(s)` + (failed ? ` · ${failed} en échec` : "") + (already ? ` · ${already} déjà retouchée(s) laissée(s) telles quelles` : ""), failed ? "error" : "success", 6000);
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
});

// Lightbox controls
lbClose.addEventListener("click", closeLightbox);
lbPrev.addEventListener("click", () => lbGo(-1));
lbNext.addEventListener("click", () => lbGo(1));
lbLikeBtn.addEventListener("click", () => toggleLike(state.lbIndex));
$("lb-edit").addEventListener("click", () => openEditorFromLightbox("primaries"));
$("lb-crop").addEventListener("click", () => openEditorFromLightbox("crop"));
const openExternal = async () => {
  const p = state.photos[state.lbIndex];
  if (!p) return;
  lbVideo.pause();
  try { await api("POST", `/api/projects/${encodeURIComponent(state.currentProject)}/photos/${p.id}/open-external`); }
  catch (e) { toast("Erreur : " + e.message, "error"); }
};
$("lb-external").addEventListener("click", openExternal);
$("lb-video-external").addEventListener("click", openExternal);

// Keyboard
const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");

document.addEventListener("keydown", e => {
  if (window.Shell && window.Shell.current !== "chooser") return;   // another module is on screen
  if (window.Editor && window.Editor.isOpen()) return;     // editor has its own shortcuts
  if ($("modal-new-project").style.display !== "none" || typing()) return;

  if (lightbox.style.display !== "none") {
    const photo = state.photos[state.lbIndex];
    if (e.key === "Escape") { if (!lbPZ.fitted) lbPZ.fit(); else closeLightbox(); }
    else if (e.key === "ArrowLeft") lbGo(-1);
    else if (e.key === "ArrowRight") lbGo(1);
    else if (e.key === "l" || e.key === "L") toggleLike(state.lbIndex);
    else if ((e.key === "e" || e.key === "E") && !isVideo(photo)) openEditorFromLightbox("primaries");
    else if ((e.key === "c" || e.key === "C") && !e.ctrlKey && !isVideo(photo)) openEditorFromLightbox("crop");
    else if (e.key === "0") lbPZ.fit();
    else if (e.key === "1") lbPZ.zoomAt(lbPZ.oneToOne());
    else if (e.key === "+" || e.key === "=") lbPZ.zoomAt(lbPZ.s * 1.4);
    else if (e.key === "-") lbPZ.zoomAt(lbPZ.s / 1.4);
    else if (e.key === " " && isVideo(photo)) { e.preventDefault(); lbVideo.paused ? lbVideo.play() : lbVideo.pause(); }
    return;
  }

  if (!state.currentProject) return;
  if (e.key === "Escape" && state.selected.size) clearSelection();
  else if (e.key === "Delete" && state.selected.size) removeFromProject(selectedIds());
  else if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    state.photos.forEach(p => state.selected.add(p.id));
    syncSelectionClasses();
  }
});

// Click outside modal to close
$("modal-new-project").addEventListener("click", e => {
  if (e.target === $("modal-new-project")) {
    $("modal-new-project").style.display = "none";
    $("new-project-name").value = "";
  }
});

// Click on the dark background (not on the image) closes the lightbox
lightbox.addEventListener("click", e => {
  if (e.target === lightbox) closeLightbox();
});
lbStage.addEventListener("click", e => {
  if (e.target === lbStage && lbPZ.fitted && !lbPZ.lastDragMoved) closeLightbox();
  lbPZ.lastDragMoved = false;
});

// ── AI status check ────────────────────────────────────────────────────────
async function checkAiStatus() {
  try {
    const res = await api("GET", "/api/ai-status");
    AI_AVAILABLE_GLOBAL = res.available;
    if (res.available) {
      aiBadgeWrap.style.display = "block";
      aiLabel.textContent = "IA prête";
      updateCategoryFilter();
    } else {
      // Retry in 10s in case model is still loading
      setTimeout(checkAiStatus, 10000);
    }
  } catch (e) {
    setTimeout(checkAiStatus, 10000);
  }
}

// Shared with editor.js
window.App = { state, api, toast, updatePhoto, refreshCard, isVideo, isEdited, projQ, updateSelectionBar };

// ── Init ───────────────────────────────────────────────────────────────────
(async () => {
  await loadProjects();
  checkAiStatus();
})();
