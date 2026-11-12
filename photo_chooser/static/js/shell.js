/* ══════════════════════════════════════════════════════
   Photo Studio – shell: one page, one tab per module.
   A module is a <div id="app-NAME" class="app">; it may register
   hooks with Shell.register(name, { onShow, onHide }).
══════════════════════════════════════════════════════ */
(function () {
  const hooks = {};
  const Shell = {
    current: null,
    register(name, h) { hooks[name] = h; },
    show(name, arg) {
      if (!document.getElementById("app-" + name)) return;
      const prev = Shell.current;
      if (prev && prev !== name && hooks[prev] && hooks[prev].onHide) hooks[prev].onHide();
      Shell.current = name;
      document.querySelectorAll(".app").forEach(el => el.classList.toggle("active", el.id === "app-" + name));
      document.querySelectorAll("#ab-tabs button").forEach(b => b.classList.toggle("active", b.dataset.app === name));
      try { localStorage.setItem("ps-app", name); } catch { /* private mode */ }
      if (hooks[name] && hooks[name].onShow) hooks[name].onShow(arg);
    },
  };
  window.Shell = Shell;

  document.addEventListener("click", e => {
    const el = e.target.closest("[data-app]");
    if (el && !el.disabled && (el.closest("#appbar") || el.closest("#app-hub"))) Shell.show(el.dataset.app);
  });

  Shell.register("hub", {
    async onShow() {
      try {
        const [projects, albums, montages] = await Promise.all([
          fetch("/api/projects").then(r => r.json()), fetch("/api/albums").then(r => r.json()), fetch("/api/montages").then(r => r.json())]);
        document.getElementById("hub-montage-meta").textContent = montages.length ? `${montages.length} montage${montages.length > 1 ? "s" : ""}` : "";
        const liked = projects.reduce((n, p) => n + p.liked_count, 0);
        document.getElementById("hub-chooser-meta").textContent =
          projects.length ? `${projects.length} projet${projects.length > 1 ? "s" : ""} · ♥ ${liked} photo${liked > 1 ? "s" : ""} gardée${liked > 1 ? "s" : ""}` : "Aucun projet pour l'instant";
        document.getElementById("hub-album-meta").textContent =
          albums.length ? `${albums.length} album${albums.length > 1 ? "s" : ""}` : (liked ? "Prêt : vous avez des photos likées" : "Likez d'abord quelques photos");
      } catch { /* server not ready */ }
    },
  });

  // Lifetime: tell the server the page is open (the .exe has no window to close and
  // stops by itself once the page is gone), and let the user quit explicitly.
  const ping = () => fetch("/api/alive", { method: "POST" }).catch(() => {});
  ping();
  setInterval(ping, 5000);
  // in its own window (?window=1) no other tab exists: closing it stops the app within seconds
  const ownWindow = new URLSearchParams(location.search).has("window");
  window.addEventListener("pagehide", () => navigator.sendBeacon("/api/bye" + (ownWindow ? "?now=1" : "")));
  window.addEventListener("pageshow", ping);
  document.getElementById("ab-quit").addEventListener("click", async () => {
    if (!confirm("Arrêter Photo Studio ? Tout est déjà enregistré.")) return;
    try { await fetch("/api/quit", { method: "POST" }); } catch { /* already gone */ }
    if (ownWindow) window.close();          // the browser may refuse: the message below stays then
    document.body.innerHTML = `<div style="margin:auto;text-align:center;color:#7b84a0;font:16px 'Segoe UI',sans-serif">
      <img src="/static/img/logo.svg" alt="" style="width:72px;margin-bottom:14px"><br>Photo Studio est arrêté.<br>Vous pouvez fermer cet onglet.</div>`;
  });

  // modules register themselves while their scripts load; show the first screen afterwards
  window.addEventListener("DOMContentLoaded", () => Shell.show("hub"));
})();
