"""
Photo Studio – make a release.

    python release.py                 build everything for the version in version.json
    python release.py --bump patch    1.2.3 → 1.2.4 (minor → 1.3.0, major → 2.0.0), then build
    python release.py --code-only     only the update package (no exe, no installer)
    python release.py --publish       also create the branch release/<tag> and the tag <tag_prefix>X.Y.Z,
                                      push them and publish the GitHub Release with its files

Steps before: write what's new under "## X.Y.Z" at the top of CHANGELOG.md (shown to users in
the update window), commit. Output in dist/release/X.Y.Z/:
    photo-studio-code-X.Y.Z.zip   the code (what most updates download, a few MB)
    update.json                   version, runtime, checksum
    PhotoStudio-Setup-X.Y.Z.exe   the installer (first install, or when the libraries changed)
    notes.md                      the release text

When a library is added or upgraded: raise RUNTIME in launcher.py AND "runtime" in version.json.
Users then get the installer instead of the small code update.
"""
import argparse
import os
import hashlib
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
# the app's own modules (the launcher must not freeze them – see PhotoStudio.spec)
APP_MODULES = sorted(p.stem for p in ROOT.glob("*.py") if p.stem not in ("launcher", "release"))
CODE_DIRS = ("templates", "static", "assets")


def code_files():
    """(source path, path inside the package) of everything the app's code is made of."""
    out = [p for p in sorted(ROOT.glob("*.py")) if p.stem not in ("launcher", "release")]
    out += [ROOT / "version.json", ROOT / "CHANGELOG.md"]
    for d in CODE_DIRS:
        out += [p for p in sorted((ROOT / d).rglob("*")) if p.is_file() and "__pycache__" not in p.parts]
    return [(str(p), p.relative_to(ROOT).as_posix()) for p in out]


def notes_for(version):
    text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    m = re.search(rf"^##\s*v?{re.escape(version)}\s*$(.*?)(?=^##\s|\Z)", text, re.M | re.S)
    return m.group(1).strip() if m else None


def run(cmd, **kw):
    print("  >", " ".join(map(str, cmd)))
    subprocess.run(cmd, check=True, cwd=ROOT, **kw)


def iscc():
    for base in (Path(r"C:\Program Files (x86)"), Path(r"C:\Program Files"), Path.home() / "AppData/Local/Programs"):
        p = base / "Inno Setup 6" / "ISCC.exe"
        if p.exists():
            return p
    return shutil.which("ISCC")


def github_token():
    """GITHUB_TOKEN / GH_TOKEN, else the credential git already uses to push to github.com."""
    t = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if t:
        return t
    r = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n",
                       capture_output=True, text=True, cwd=ROOT, timeout=120)
    for line in r.stdout.splitlines():
        if line.startswith("password="):
            return line[len("password="):]
    sys.exit("Pas d'accès à GitHub : définissez GITHUB_TOKEN ou faites un premier « git push » pour enregistrer vos identifiants.")


def gh_api(method, url, token, data=None, ctype="application/json"):
    import urllib.request
    body = json.dumps(data).encode() if isinstance(data, dict) else data
    req = urllib.request.Request(url, data=body, method=method, headers={
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "Content-Type": ctype,
        "User-Agent": "photo-studio-release"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read() or b"{}")


def publish(v, ver, out):
    repo, tag = v["repo"], v.get("tag_prefix", "v") + ver
    branch = f"release/{tag}"
    if subprocess.run(["git", "status", "--porcelain", "."], cwd=ROOT, capture_output=True, text=True).stdout.strip():
        sys.exit("Des fichiers ne sont pas commités : commitez avant de publier.")
    # one branch per version (the code exactly as released) and the tag the Release points to
    run(["git", "branch", "-f", branch, "HEAD"])
    run(["git", "tag", "-a", tag, "-m", f"Photo Studio {ver}"])
    run(["git", "push", "origin", branch, tag])
    token = github_token()
    rel = gh_api("POST", f"https://api.github.com/repos/{repo}/releases", token, {
        "tag_name": tag, "name": f"Photo Studio {ver}", "body": (out / "notes.md").read_text(encoding="utf-8"),
        "draft": False, "prerelease": False, "make_latest": "true"})
    for f in sorted(out.iterdir()):
        if f.name == "notes.md":
            continue
        ctype = "application/json" if f.suffix == ".json" else "application/zip" if f.suffix == ".zip" else "application/octet-stream"
        print(f"    envoi de {f.name} ({f.stat().st_size / 1e6:.1f} Mo)")
        gh_api("POST", f"https://uploads.github.com/repos/{repo}/releases/{rel['id']}/assets?name={f.name}", token, f.read_bytes(), ctype)
    print(f"    {rel['html_url']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bump", choices=["patch", "minor", "major"])
    ap.add_argument("--code-only", action="store_true")
    ap.add_argument("--publish", action="store_true")
    a = ap.parse_args()

    vf = ROOT / "version.json"
    v = json.loads(vf.read_text(encoding="utf-8"))
    if a.bump:
        x, y, z = (int(n) for n in v["version"].split("."))
        v["version"] = {"patch": f"{x}.{y}.{z + 1}", "minor": f"{x}.{y + 1}.0", "major": f"{x + 1}.0.0"}[a.bump]
        vf.write_text(json.dumps(v, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Version {v['version']}")
    ver = v["version"]
    import launcher
    if int(v.get("runtime", 1)) > launcher.RUNTIME:
        sys.exit(f"version.json demande runtime {v['runtime']} mais launcher.RUNTIME vaut {launcher.RUNTIME}")
    notes = notes_for(ver)
    if not notes:
        sys.exit(f"Ajoutez d'abord une section « ## {ver} » en haut de CHANGELOG.md : c'est le texte que verront les utilisateurs.")
    if a.publish and not v.get("repo"):
        sys.exit('Renseignez "repo" (ex. "pseudo/photo-studio") dans version.json.')

    out = ROOT / "dist" / "release" / ver
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    (out / "notes.md").write_text(notes + "\n", encoding="utf-8")

    print("[1] Paquet de code")
    z = out / f"photo-studio-code-{ver}.zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for src, dst in code_files():
            zf.write(src, dst)
    sha = hashlib.sha256(z.read_bytes()).hexdigest()
    (out / "update.json").write_text(json.dumps({"version": ver, "runtime": int(v.get("runtime", 1)), "sha256": sha},
                                                indent=1), encoding="utf-8")
    print(f"    {z.name} ({z.stat().st_size / 1e6:.1f} Mo)")

    if not a.code_only:
        print("[2] Lanceur (PyInstaller)")
        shutil.rmtree(ROOT / "build" / "PhotoStudio", ignore_errors=True)
        run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--workpath", "build/PhotoStudio", "PhotoStudio.spec"])
        print("[3] Installateur (Inno Setup)")
        tool = iscc()
        if tool:
            run([str(tool), f"/DAppVersion={ver}", f"/O{out}", "installer\\PhotoStudio.iss"])
        else:
            print("    Inno Setup introuvable : installateur non créé (https://jrsoftware.org/isdl.php)")

    if a.publish:
        print("[4] Publication")
        publish(v, ver, out)
    print(f"\nTerminé : {out}")


if __name__ == "__main__":
    main()
