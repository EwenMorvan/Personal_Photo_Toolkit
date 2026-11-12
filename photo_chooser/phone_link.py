"""Phone link: receive photos/videos from the « Photo Finder » Android app over the local network.

Flow
  1. The page calls POST /api/projects/<name>/phone/start.
  2. A small LAN server (separate from the main app, which stays on 127.0.0.1) starts on
     0.0.0.0:LAN_PORT and a UDP beacon is broadcast every few seconds on DISCOVERY_PORT.
  3. Every phone running the app hears the beacon and answers with POST /hello (with its own id).
  4. On any of those phones the user picks photos; that phone uploads them (POST /begin, /upload…, /done).
  5. Files land in projects/<name>/Depuis_telephone/ and that folder is scanned into the project.

Several phones can be on the same Wi-Fi: each one is tracked separately (its own progress), they can
send one after the other or at the same time, and the session stays open until it is closed on the PC.

Nothing is ever deleted or overwritten: a file already present (same name + size) is skipped,
a different file with a taken name gets a « (1) » suffix.
Every LAN request must carry the token of the current session (sent in the beacon).
"""
import json
import os
import re
import secrets
import socket
import threading
import time

DISCOVERY_PORT = 47321
LAN_PORT = int(os.environ.get("PHOTOCHOOSER_PHONE_PORT", 5056))
FOLDER_NAME = "Depuis_telephone"
SESSION_TIMEOUT = 20 * 60          # seconds without any activity
MAX_PHONES = 12


def _local_ips() -> list[str]:
    ips = []
    try:  # the interface used to reach the outside world (no packet is actually sent)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except OSError:
        pass
    return ips


def _broadcast_targets(ips: list[str]) -> list[str]:
    targets = ["255.255.255.255"]
    for ip in ips:
        parts = ip.split(".")
        if len(parts) == 4:
            targets.append(".".join(parts[:3] + ["255"]))   # /24, the usual home network
    return list(dict.fromkeys(targets))


_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _safe_name(name: str) -> str:
    name = _BAD.sub("_", os.path.basename(name or "")).strip().strip(".")
    return name or f"photo_{int(time.time())}.jpg"


def register(app, core):
    from flask import Flask, jsonify, request
    from werkzeug.serving import make_server

    lock = threading.RLock()
    st = {"session": None, "server": None}
    COUNTERS = ("expected", "received", "skipped", "failed", "bytes", "added")

    # ------------------------------------------------------------------ session helpers
    def new_session(project: str) -> dict:
        return {
            "token": secrets.token_urlsafe(16),
            "project": project,
            "state": "open",              # open | closed | error
            "phones": {},                 # phone id → its own progress
            "scanning": 0,                # scans in progress
            "added": 0,                   # added to the project, all phones together
            "rev": 0,                     # +1 after each scan → the page refreshes the grid
            "error": None,
            "started": time.time(),
            "last": time.time(),
            "folder": str(core.project_path(project) / FOLDER_NAME),
            "pc": socket.gethostname(),
            "ips": _local_ips(),
        }

    def overall(s: dict) -> str:
        if s["state"] != "open":
            return "cancelled" if s["state"] == "closed" else "error"
        phones = s["phones"].values()
        if not phones:
            return "searching"
        if any(p["status"] == "receiving" for p in phones):
            return "receiving"
        if s["scanning"]:
            return "scanning"
        if any(p["status"] == "done" for p in phones):
            return "done"           # at least one phone finished; the others can still send
        return "connected"

    def public(s: dict | None) -> dict:
        if not s:
            return {"status": "idle"}
        phones = sorted(s["phones"].values(), key=lambda p: p["since"])
        out = {k: v for k, v in s.items() if k not in ("token", "phones")}
        out["status"] = overall(s)
        out["phones"] = [{k: v for k, v in p.items() if k not in ("since", "_paths")} for p in phones]
        for c in COUNTERS:
            if c != "added":
                out[c] = sum(p[c] for p in phones)
        names = [p["name"] for p in phones]
        out["phone"] = ", ".join(names) if names else None   # kept for older pages
        return out

    def current(token: str | None) -> dict | None:
        s = st["session"]
        if s and token and s["state"] == "open" and secrets.compare_digest(token, s["token"]):
            s["last"] = time.time()
            return s
        return None

    def phone_of(s: dict, create_name: str | None = None) -> dict | None:
        """The phone making this request (its id is sent by the app; the IP is a fallback)."""
        pid = (request.args.get("phone") or request.remote_addr or "?")[:64]
        p = s["phones"].get(pid)
        if p is None and create_name is not None:
            if len(s["phones"]) >= MAX_PHONES:
                return None
            p = {"id": pid, "name": create_name, "ip": request.remote_addr, "status": "connected",
                 "since": time.time(), "_paths": set(), **{c: 0 for c in COUNTERS}}
            s["phones"][pid] = p
        if p is not None:
            p["ip"] = request.remote_addr
        return p

    # ------------------------------------------------------------------ LAN server (phone side)
    lan = Flask("phone_link")

    def deny():
        return jsonify({"error": "session invalide ou terminée"}), 403

    def unknown_phone():
        return jsonify({"error": "téléphone inconnu de cette session"}), 409

    @lan.route("/hello", methods=["POST"])
    def hello():
        with lock:
            s = current(request.args.get("token"))
            if not s:
                return deny()
            body = request.get_json(silent=True) or {}
            name = str(body.get("device") or "Téléphone")[:60]
            p = phone_of(s, create_name=name)
            if p is None:
                return jsonify({"error": "trop de téléphones"}), 429
            p["name"] = name
            if p["status"] == "cancelled":
                p["status"] = "connected"
            return jsonify({"ok": True, "project": s["project"], "pc": s["pc"], "folder": FOLDER_NAME})

    @lan.route("/begin", methods=["POST"])
    def begin():
        with lock:
            s = current(request.args.get("token"))
            if not s:
                return deny()
            p = phone_of(s, create_name="Téléphone")
            if p is None:
                return unknown_phone()
            # a new batch from this phone only: the other phones keep their own progress
            for c in ("expected", "received", "skipped", "failed", "bytes"):
                p[c] = 0
            p["expected"] = int(request.args.get("total", 0) or 0)
            p["_paths"] = set()
            p["status"] = "receiving"
            os.makedirs(s["folder"], exist_ok=True)
            return jsonify({"ok": True})

    def existing_same(folder: str, name: str, size: int) -> str | None:
        """Path of a file with the same name + same size, also under a « name (n).ext » variant."""
        base, ext = os.path.splitext(name)
        pat = re.compile(re.escape(base) + r"( \(\d+\))?" + re.escape(ext) + r"$", re.IGNORECASE)
        try:
            for f in os.scandir(folder):
                if f.is_file() and pat.match(f.name) and f.stat().st_size == size:
                    return os.path.join(folder, f.name)
        except FileNotFoundError:
            pass
        return None

    def unique_path(folder: str, name: str) -> str:
        base, ext = os.path.splitext(name)
        path, n = os.path.join(folder, name), 1
        while os.path.exists(path):
            path = os.path.join(folder, f"{base} ({n}){ext}")
            n += 1
        return path

    @lan.route("/upload", methods=["POST"])
    def upload():
        with lock:
            s = current(request.args.get("token"))
            if not s:
                return deny()
            p = phone_of(s, create_name="Téléphone")
            if p is None:
                return unknown_phone()
            p["status"] = "receiving"
            folder = s["folder"]
        name = _safe_name(request.args.get("name"))
        size = int(request.args.get("size", -1) or -1)
        if os.path.splitext(name)[1].lower() not in core.SUPPORTED_EXT:
            with lock:
                p["failed"] += 1
            return jsonify({"status": "refused", "reason": "format non pris en charge"}), 415
        os.makedirs(folder, exist_ok=True)
        with lock:   # two phones may send the same photo at the same time
            dup = existing_same(folder, name, size) if size > 0 else None
        if dup:
            while request.stream.read(1 << 16):   # drain the body so the connection stays usable
                pass
            with lock:
                p["skipped"] += 1
                p["_paths"].add(dup)   # sent again on purpose → must be in the project again
            return jsonify({"status": "skipped"})

        tmp = os.path.join(folder, f".{name}.{secrets.token_hex(4)}.part")
        written = 0
        try:
            with open(tmp, "wb") as out:
                while True:
                    chunk = request.stream.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
                    written += len(chunk)
                    with lock:
                        p["bytes"] += len(chunk)
                        s["last"] = time.time()
            if size > 0 and written != size:
                raise IOError(f"transfert incomplet ({written}/{size} octets)")
            with lock:
                same = existing_same(folder, name, size) if size > 0 else None
                if same:   # arrived meanwhile from another phone
                    os.remove(tmp)    # our own temporary copy only
                    p["skipped"] += 1
                    p["_paths"].add(same)
                    return jsonify({"status": "skipped"})
                final = unique_path(folder, name)
                os.replace(tmp, final)
            date_ms = int(request.args.get("date", 0) or 0)
            if date_ms > 0:  # keep the phone's date (WhatsApp images have no EXIF date)
                try:
                    os.utime(final, (date_ms / 1000, date_ms / 1000))
                except OSError:
                    pass
            with lock:
                p["received"] += 1
                p["_paths"].add(final)
            return jsonify({"status": "saved", "name": os.path.basename(final)})
        except Exception as e:
            try:
                os.remove(tmp)    # our own incomplete temporary file only
            except OSError:
                pass
            with lock:
                p["failed"] += 1
            return jsonify({"status": "error", "reason": str(e)}), 500

    @lan.route("/done", methods=["POST"])
    def done():
        with lock:
            s = current(request.args.get("token"))
            if not s:
                return deny()
            p = phone_of(s)
            if p is None:
                return unknown_phone()
            p["status"] = "done"
            s["scanning"] += 1
        threading.Thread(target=scan_into_project, args=(s, p), daemon=True).start()
        return jsonify({"ok": True})

    @lan.route("/cancel", methods=["POST"])
    def phone_cancel():
        """« Ignorer » on one phone: only that phone leaves, the session stays open for the others."""
        with lock:
            s = current(request.args.get("token"))
            if s:
                p = phone_of(s)
                if p is not None and p["status"] != "done":
                    p["status"] = "cancelled"
        return jsonify({"ok": True})

    def scan_into_project(s: dict, p: dict):
        try:
            with lock:
                sent = set(p["_paths"])
            # Photos removed from the project are « excluded » so that a re-scan of the folder leaves
            # them out. A photo the user sends again from the phone is wanted back: un-exclude it.
            if sent:
                with core._proj_lock:
                    data = core.load_project(s["project"])
                    if data:
                        excluded = set(data.get("excluded", []))
                        back = excluded & sent
                        if back:
                            data["excluded"] = sorted(excluded - back)
                            core.save_project(data)
            if os.path.isdir(s["folder"]):
                with app.test_request_context(json={"sources": [s["folder"]]}):
                    res = core.scan_sources(s["project"])
                    if isinstance(res, tuple):
                        res = res[0]
                    added = (res.get_json() or {}).get("added", 0)
                with lock:
                    p["added"] += added
                    s["added"] += added
        except Exception as e:
            with lock:
                s["error"] = f"Scan impossible : {e}"
        finally:
            with lock:
                s["scanning"] -= 1
                s["rev"] += 1

    def ensure_server():
        if st["server"]:
            return
        srv = make_server("0.0.0.0", LAN_PORT, lan, threaded=True)
        st["server"] = srv
        threading.Thread(target=srv.serve_forever, daemon=True, name="phone-link-http").start()
        print(f"[phone] serveur LAN sur le port {LAN_PORT}")

    # ------------------------------------------------------------------ discovery beacon
    def beacon(token: str):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        try:
            while True:
                with lock:
                    s = st["session"]
                    if not s or s["token"] != token or s["state"] != "open":
                        return
                    if time.time() - s["last"] > SESSION_TIMEOUT:
                        s["state"], s["error"] = "error", "Délai dépassé"
                        return
                    payload = json.dumps({
                        "app": "photo-studio", "v": 2, "type": "request",
                        "token": token, "port": LAN_PORT, "pc": s["pc"],
                        "project": s["project"], "ips": s["ips"],
                    }).encode()
                    # dev/test only: PHOTOCHOOSER_PHONE_BEACON=127.0.0.1 keeps the beacon on this PC
                    targets = ([os.environ["PHOTOCHOOSER_PHONE_BEACON"]] if os.environ.get("PHOTOCHOOSER_PHONE_BEACON")
                               else _broadcast_targets(s["ips"]))
                    # keeps going while the session is open, so a phone joining later still sees it
                    delay = 2 if not s["phones"] else 4
                for t in targets:
                    try:
                        sock.sendto(payload, (t, DISCOVERY_PORT))
                    except OSError:
                        pass
                time.sleep(delay)
        finally:
            sock.close()

    # ------------------------------------------------------------------ routes for the page
    @app.route("/api/projects/<name>/phone/start", methods=["POST"])
    def phone_start(name):
        if not core.load_project(name):
            return jsonify({"error": "Projet introuvable"}), 404
        try:
            ensure_server()
        except OSError as e:
            return jsonify({"error": f"Port {LAN_PORT} indisponible : {e}"}), 500
        with lock:
            old = st["session"]
            if old and old["state"] == "open":
                old["state"] = "closed"
            s = new_session(name)
            st["session"] = s
        threading.Thread(target=beacon, args=(s["token"],), daemon=True, name="phone-link-beacon").start()
        return jsonify(public(s))

    @app.route("/api/phone/status")
    def phone_status():
        with lock:
            return jsonify(public(st["session"]))

    @app.route("/api/phone/cancel", methods=["POST"])
    def phone_stop():
        """Closing the window on the PC ends the session for every phone."""
        with lock:
            s = st["session"]
            if s and s["state"] == "open":
                s["state"] = "closed"
        return jsonify({"ok": True})
