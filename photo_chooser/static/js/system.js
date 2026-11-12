/* ══════════════════════════════════════════════════════
   Photo Studio – updates, settings, import from the old version
══════════════════════════════════════════════════════ */
(function () {
  const $ = id => document.getElementById(id);
  const get = u => fetch(u).then(r => r.json());
  const post = (u, b) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; });
  const toast = (m, t, d) => window.App && window.App.toast ? window.App.toast(m, t, d) : alert(m);
  let upd = null;

  // release notes are plain text with a little markdown: titles, bullets, **bold**
  function notesHtml(text) {
    const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/`(.+?)`/g, "<code>$1</code>");
    let html = "", list = false;
    for (const raw of text.split(/\r?\n/)) {
      const l = raw.trim();
      const item = /^[-*•]\s+(.*)/.exec(l);
      if (item) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(item[1])}</li>`; continue; }
      if (list) { html += "</ul>"; list = false; }
      if (!l) continue;
      const h = /^#{1,6}\s+(.*)/.exec(l);
      html += h ? `<h3>${inline(h[1])}</h3>` : `<p>${inline(l)}</p>`;
    }
    return html + (list ? "</ul>" : "");
  }

  function showUpdate(u) {
    upd = u;
    const auto = u.can_update && u.mode !== "page";
    $("up-title").textContent = `Photo Studio ${u.latest} est disponible`;
    $("up-sub").textContent = `Vous avez la version ${u.current}.` + (u.mode === "installer" ? " Cette version s'installe avec son installateur, téléchargé et lancé automatiquement." : "");
    if (!auto && u.page) {
      const a = document.createElement("a");
      a.href = u.page; a.target = "_blank"; a.textContent = " Ouvrir la page de téléchargement";
      $("up-sub").appendChild(a);
    }
    $("up-notes").innerHTML = u.notes.map(n => `<h3>Version ${n.version}${n.date ? " — " + n.date.split("-").reverse().join("/") : ""}</h3>` +
      notesHtml(n.text || "Améliorations et corrections.")).join("");
    $("up-progress").style.display = "none"; $("up-actions").style.display = "";
    $("up-go").style.display = auto ? "" : "none";
    $("up-later").textContent = auto ? "Plus tard" : "Fermer";
    $("up-dlg").style.display = "flex";
  }

  async function runUpdate() {
    $("up-actions").style.display = "none"; $("up-progress").style.display = "";
    try {
      let job = await post("/api/update/apply");
      while (!job.done) {
        $("up-step").textContent = job.step; $("up-bar").value = (job.progress || 0) * 100;
        await new Promise(r => setTimeout(r, 400));
        job = await get("/api/update/progress");
      }
      if (job.error) throw new Error(job.error);
      $("up-bar").value = 100;
      $("up-step").textContent = job.mode === "installer" ? "L'installateur va s'ouvrir, puis Photo Studio redémarrera." : "Redémarrage de Photo Studio…";
      await post("/api/update/restart");
      if (job.mode === "installer") return;
      // wait for the new version, then reload the page in place
      const t0 = Date.now();
      await new Promise(r => setTimeout(r, 1500));
      while (Date.now() - t0 < 60000) {
        try { const i = await get("/api/app/info"); if (i.version === job.version) { location.reload(); return; } } catch { /* restarting */ }
        await new Promise(r => setTimeout(r, 700));
      }
      $("up-step").textContent = "Le redémarrage prend du temps : fermez puis rouvrez Photo Studio.";
    } catch (e) {
      $("up-step").textContent = "La mise à jour n'a pas pu se faire : " + e.message + ". Votre version actuelle reste utilisable.";
      $("up-actions").style.display = "";
    }
  }

  async function checkUpdate(force, quiet) {
    const u = await get("/api/update/check" + (force ? "?force=1" : ""));
    $("ab-set").classList.toggle("dot", !!u.available);
    if (u.available && (force || !u.skipped)) showUpdate(u);
    else if (!quiet) $("set-check-res").textContent = u.available ? "" : u.error || `Vous avez la dernière version (${u.current}).`;
    return u;
  }

  async function openSettings() {
    const info = await get("/api/app/info");
    $("set-version").textContent = info.version + (info.launcher ? "" : " (lancée depuis les sources : pas de mise à jour automatique)");
    $("set-data").textContent = info.data_dir;
    $("set-move").style.display = info.launcher ? "" : "none";
    $("set-check-res").textContent = ""; $("set-import-res").textContent = "";
    $("set-dlg").style.display = "flex";
  }

  async function importOld(path) {
    if (!path) {
      const r = await get("/api/browse/folder");
      if (!r.path) return;
      path = r.path;
    }
    try {
      const j = await post("/api/migrate", { path });
      const msg = `✓ ${j.projects} projet(s) importé(s) : ${j.copied} fichier(s) copié(s)` + (j.skipped ? `, ${j.skipped} déjà présent(s)` : "") + ".";
      $("set-import-res").textContent = msg; toast(msg, "success", 6000);
      document.querySelector(".hub-import")?.remove();
      if (window.Shell.current === "hub") window.Shell.show("hub");
    } catch (e) { $("set-import-res").textContent = "⚠ " + e.message; toast(e.message, "error", 6000); }
  }

  // first start of the installed app with no project: offer the old version's projects
  async function offerImport() {
    const i = await get("/api/app/info");
    if (!i.installed || !i.empty) return;
    const found = await get("/api/migrate/detect");
    if (!found.length) return;
    const f = found[0], bar = document.createElement("div");
    bar.className = "hub-import";
    bar.innerHTML = `<span>📦 ${f.projects} projet(s) de l'ancienne version trouvés dans <b></b>. Les récupérer ?</span>
      <button class="btn btn-primary">Importer</button><button class="btn btn-ghost">Non merci</button>`;
    bar.querySelector("b").textContent = f.path;
    bar.querySelector(".btn-primary").addEventListener("click", () => importOld(f.path));
    bar.querySelector(".btn-ghost").addEventListener("click", () => bar.remove());
    document.querySelector("#app-hub .hub-sub")?.after(bar);
  }

  $("ab-set").addEventListener("click", openSettings);
  $("set-close").addEventListener("click", () => { $("set-dlg").style.display = "none"; });
  $("set-check").addEventListener("click", () => {
    $("set-check-res").textContent = "Recherche…";
    checkUpdate(true).then(u => { if (u.available) $("set-dlg").style.display = "none"; }).catch(e => { $("set-check-res").textContent = e.message; });
  });
  $("set-open").addEventListener("click", () => post("/api/settings/open-data").catch(e => toast(e.message, "error")));
  $("set-import").addEventListener("click", () => importOld());
  $("set-move").addEventListener("click", async () => {
    const r = await get("/api/browse/folder");
    if (!r.path) return;
    if (!confirm(`Utiliser « ${r.path} » pour vos projets ?\n\nCe qui est dans le dossier actuel y sera copié (rien n'est effacé), puis Photo Studio redémarrera.`)) return;
    try {
      await post("/api/settings/data-dir", { path: r.path });
      document.body.innerHTML = `<div style="margin:auto;text-align:center;color:#7b84a0;font:16px 'Segoe UI',sans-serif">Redémarrage…</div>`;
      setTimeout(() => location.reload(), 5000);
    } catch (e) { toast(e.message, "error", 6000); }
  });
  $("up-later").addEventListener("click", () => { $("up-dlg").style.display = "none"; });
  $("up-skip").addEventListener("click", () => { post("/api/update/skip", { version: upd && upd.latest }); $("up-dlg").style.display = "none"; });
  $("up-go").addEventListener("click", runUpdate);

  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => checkUpdate(false, true).catch(() => {}), 2500);
    offerImport().catch(() => {});
  });
})();
