"""
Photo Studio – Montage module (photo / video slideshow editor).

A montage references the photos and videos of a PhotoChooser project and stores only its
timeline: clips (photo, video, title card), their length, movement, transition, caption,
and a music track. The picture is drawn in the browser (static/js/montage.js): the same
code plays the preview and renders the export, frame by frame. This module stores the
montages, receives the rendered frames and has ffmpeg encode them and mix the sound.
"""
import json
import os
import subprocess
import threading
import uuid
from datetime import datetime
from pathlib import Path

from flask import jsonify, request, abort, send_file

FORMATS = {
    "16:9": {"label": "Paysage 16:9 (TV, YouTube)", "w": 1920, "h": 1080},
    "9:16": {"label": "Vertical 9:16 (téléphone, stories)", "w": 1080, "h": 1920},
    "1:1":  {"label": "Carré 1:1", "w": 1080, "h": 1080},
    "4:3":  {"label": "Classique 4:3", "w": 1440, "h": 1080},
}
AUDIO_EXT = (".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac")
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)       # no console flashing from the windowed .exe

_lock = threading.RLock()
_exports: dict = {}


def register(app, core):
    DIR = core._RUNTIME_DIR / "montages"
    DIR.mkdir(parents=True, exist_ok=True)
    OUT = DIR / "exports"

    def mfile(mid):
        return DIR / ("".join(c for c in mid if c.isalnum()) + ".json")

    def load(mid):
        f = mfile(mid)
        try:
            return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None
        except Exception:
            return None

    def save(m):
        m["updated"] = datetime.now().isoformat()
        tmp = mfile(m["id"]).with_suffix(".tmp")
        tmp.write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, mfile(m["id"]))

    def assets_dir(mid):
        d = DIR / ("".join(c for c in mid if c.isalnum()) + "_assets")
        d.mkdir(parents=True, exist_ok=True)
        return d

    @app.route("/api/montages/meta")
    def montage_meta():
        return jsonify({"formats": FORMATS, "ffmpeg": bool(core.FFMPEG)})

    @app.route("/api/montages", methods=["GET"])
    def montage_list():
        out = []
        for f in DIR.glob("*.json"):
            try:
                m = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            cover = next((c["pid"] for c in m.get("clips", []) if c.get("pid")), None)
            out.append({"id": m["id"], "name": m["name"], "project": m["project"], "format": m.get("format"),
                        "clips": len(m.get("clips", [])), "updated": m.get("updated"), "cover": cover,
                        "seconds": round(sum(c.get("dur", 0) for c in m.get("clips", [])))})
        out.sort(key=lambda m: m.get("updated") or "", reverse=True)
        return jsonify(out)

    @app.route("/api/montages", methods=["POST"])
    def montage_create():
        b = request.json or {}
        if not core.load_project(b.get("project", "")):
            return jsonify({"error": "Projet introuvable"}), 404
        m = {"id": uuid.uuid4().hex[:12], "name": (b.get("name") or b["project"]).strip(), "project": b["project"],
             "created": datetime.now().isoformat(), "format": b.get("format") if b.get("format") in FORMATS else "16:9",
             "fps": 30, "clips": [], "music": None, "bars": False}
        with _lock:
            save(m)
        return jsonify(m), 201

    @app.route("/api/montages/<mid>", methods=["GET", "PUT", "DELETE"])
    def montage_one(mid):
        m = load(mid)
        if not m:
            abort(404)
        if request.method == "DELETE":
            mfile(mid).unlink(missing_ok=True)
            return jsonify({"ok": True})
        if request.method == "PUT":
            b = request.json or {}
            for k in ("name", "format", "clips", "music", "bars"):
                if k in b:
                    m[k] = b[k]
            with _lock:
                save(m)
        return jsonify(m)

    @app.route("/api/montages/<mid>/media")
    def montage_media(mid):
        """The photos and videos of the project (the montage picks among them)."""
        m = load(mid)
        data = core.load_project(m["project"]) if m else None
        if not data:
            abort(404)
        out = [{"id": p["id"], "filename": p["filename"], "date": p.get("date"), "liked": bool(p.get("liked")),
                "video": core.is_video(p), "duration": p.get("duration"), "w": p.get("width"), "h": p.get("height"),
                "rev": p.get("rev", 0)} for p in data["photos"]]
        out.sort(key=lambda p: p["date"] or "")
        return jsonify(out)

    # ── music ─────────────────────────────────────────────────────────────
    @app.route("/api/montages/<mid>/music", methods=["POST"])
    def montage_music(mid):
        if not load(mid):
            abort(404)
        f = request.files.get("file")
        ext = Path(f.filename or "").suffix.lower() if f else ""
        if ext not in AUDIO_EXT:
            return jsonify({"error": "Fichier audio attendu (mp3, m4a, wav, ogg, flac)"}), 400
        name = uuid.uuid4().hex[:10] + ext
        f.save(assets_dir(mid) / name)
        return jsonify({"src": name, "name": Path(f.filename).stem})

    @app.route("/api/montages/<mid>/assets/<name>")
    def montage_asset(mid, name):
        f = assets_dir(mid) / Path(name).name
        if not f.exists():
            abort(404)
        return send_file(str(f), conditional=True)

    # ── export: frames come from the browser, ffmpeg encodes and mixes ────
    def has_audio(path):
        if not core.FFPROBE:
            return False
        try:
            r = subprocess.run([core.FFPROBE, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                                "-of", "csv=p=0", path], capture_output=True, text=True, timeout=20, creationflags=NO_WINDOW)
            return bool(r.stdout.strip())
        except Exception:
            return False

    def stop_export(mid):
        e = _exports.pop(mid, None)
        if e and e["proc"].poll() is None:
            try:
                e["proc"].stdin.close()
            except Exception:
                pass
            e["proc"].kill()
        return e

    @app.route("/api/montages/<mid>/export/start", methods=["POST"])
    def montage_export_start(mid):
        m = load(mid)
        if not m:
            abort(404)
        if not core.FFMPEG:
            return jsonify({"error": "ffmpeg est introuvable sur cet ordinateur : il est nécessaire pour créer la vidéo."}), 503
        b = request.json or {}
        w, h, fps = int(b.get("w", 1920)) // 2 * 2, int(b.get("h", 1080)) // 2 * 2, int(b.get("fps", 30))
        OUT.mkdir(parents=True, exist_ok=True)
        with _lock:
            stop_export(mid)
            tmp = OUT / f"{mid}_image.mp4"
            log = open(OUT / f"{mid}.log", "wb")
            proc = subprocess.Popen(
                [core.FFMPEG, "-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", str(fps), "-i", "-",
                 "-vf", f"scale={w}:{h}", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", str(tmp)],
                stdin=subprocess.PIPE, stdout=log, stderr=log, creationflags=NO_WINDOW)
            _exports[mid] = {"proc": proc, "tmp": tmp, "log": log, "fps": fps, "frames": 0}
        return jsonify({"ok": True})

    @app.route("/api/montages/<mid>/export/frame", methods=["POST"])
    def montage_export_frame(mid):
        e = _exports.get(mid)
        if not e or e["proc"].poll() is not None:
            return jsonify({"error": "L'encodage s'est arrêté"}), 409
        try:
            e["proc"].stdin.write(request.get_data())
        except Exception as ex:
            return jsonify({"error": str(ex)}), 500
        e["frames"] += 1
        return ("", 204)

    @app.route("/api/montages/<mid>/export/cancel", methods=["POST"])
    def montage_export_cancel(mid):
        with _lock:
            e = stop_export(mid)
        if e:
            e["log"].close()
            e["tmp"].unlink(missing_ok=True)
        return jsonify({"ok": True})

    @app.route("/api/montages/<mid>/export/finish", methods=["POST"])
    def montage_export_finish(mid):
        """body: {total, audio: [{pid, t0, in, dur, speed, volume}], music: {src, volume}}"""
        m = load(mid)
        e = _exports.pop(mid, None)
        if not m or not e:
            abort(404)
        try:
            e["proc"].stdin.close()
            e["proc"].wait(timeout=900)
        finally:
            e["log"].close()
        if e["proc"].returncode != 0 or not e["tmp"].exists():
            return jsonify({"error": "L'encodage de l'image a échoué (voir le fichier .log du dossier d'export)"}), 500
        b = request.json or {}
        total = float(b.get("total") or e["frames"] / e["fps"])
        safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in m["name"]).strip() or "montage"
        out = OUT / f"{safe}.mp4"
        data = core.load_project(m["project"]) or {"photos": []}
        cmd, filters, labels, k = [core.FFMPEG, "-y", "-loglevel", "error", "-i", str(e["tmp"])], [], [], 1
        mu = b.get("music") or {}
        mpath = assets_dir(mid) / Path(mu.get("src") or "x").name
        if mu.get("src") and mpath.exists() and float(mu.get("volume", 1)) > 0:
            cmd += ["-stream_loop", "-1", "-i", str(mpath)]
            filters.append(f"[{k}:a]atrim=end={total:.3f},asetpts=PTS-STARTPTS,volume={float(mu.get('volume', 1)):.3f},"
                           f"afade=t=in:d=0.8,afade=t=out:st={max(0, total - 1.6):.3f}:d=1.6[m]")
            labels.append("[m]")
            k += 1
        for a in b.get("audio") or []:
            p = core.find_photo(data, a.get("pid"))
            vol, speed = float(a.get("volume", 1)), min(2.0, max(0.5, float(a.get("speed", 1))))
            if not p or vol <= 0 or not os.path.exists(p["path"]) or not has_audio(p["path"]):
                continue
            cmd += ["-i", p["path"]]
            start, length = float(a.get("in", 0)), float(a["dur"]) * speed
            chain = f"[{k}:a]atrim=start={start:.3f}:end={start + length:.3f},asetpts=PTS-STARTPTS,"
            if abs(speed - 1) > 0.01:
                chain += f"atempo={speed:.3f},"
            chain += f"volume={vol:.3f},afade=t=in:d=0.15,adelay={int(float(a['t0']) * 1000)}:all=1[a{k}]"
            filters.append(chain)
            labels.append(f"[a{k}]")
            k += 1
        if labels:
            filters.append(f"{''.join(labels)}amix=inputs={len(labels)}:duration=longest:normalize=0,atrim=end={total:.3f}[out]")
            cmd += ["-filter_complex", ";".join(filters), "-map", "0:v", "-map", "[out]", "-c:v", "copy", "-c:a", "aac",
                    "-b:a", "192k", "-t", f"{total:.3f}", "-movflags", "+faststart", str(out)]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=900, creationflags=NO_WINDOW)
            if r.returncode != 0:
                print(f"[montage] audio: {r.stderr[-800:]}")
                os.replace(e["tmp"], out)                  # keep the picture rather than lose everything
                return jsonify({"path": str(out), "dir": str(OUT), "size_mb": round(out.stat().st_size / 1e6, 1),
                                "warning": "Le son n'a pas pu être mixé : la vidéo est muette."})
            e["tmp"].unlink(missing_ok=True)
        else:
            os.replace(e["tmp"], out)
        return jsonify({"path": str(out), "dir": str(OUT), "size_mb": round(out.stat().st_size / 1e6, 1)})

    @app.route("/api/montages/<mid>/export/open", methods=["POST"])
    def montage_export_open(mid):
        OUT.mkdir(parents=True, exist_ok=True)
        try:
            os.startfile(str(OUT))
        except Exception as ex:
            return jsonify({"error": str(ex)}), 500
        return jsonify({"ok": True})
