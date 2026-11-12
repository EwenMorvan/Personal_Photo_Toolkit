# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the INSTALLED app: "Photo Studio.exe" = launcher.py + Python + all libraries
# + one copy of the app's code (app_code/). The code itself is NOT compiled into the exe: the
# launcher runs app.py from app_code/ or from a newer downloaded version (see launcher.py).
# Build with build.bat; the installer (installer/PhotoStudio.iss) packs dist/Photo Studio/.
import sys
sys.path.insert(0, SPECPATH)
from release import code_files, APP_MODULES

# Standard modules the app's code may use one day: an update can only rely on what the launcher has.
STDLIB = """argparse array ast asyncio base64 binascii bisect bz2 calendar cmath codecs collections colorsys
concurrent.futures configparser contextlib copy csv ctypes ctypes.wintypes dataclasses datetime decimal difflib
email email.mime.text enum fnmatch fractions functools gettext glob graphlib gzip hashlib heapq hmac html html.parser
http.client http.server imaplib importlib importlib.metadata importlib.resources importlib.util inspect io ipaddress
itertools json locale logging logging.handlers lzma math mimetypes multiprocessing numbers operator pathlib pickle
pkgutil platform plistlib pprint queue random re runpy sched secrets selectors shlex shutil signal smtplib socket
socketserver sqlite3 ssl statistics string struct subprocess tarfile tempfile textwrap threading time timeit tkinter
tkinter.filedialog tkinter.messagebox tkinter.simpledialog tomllib traceback typing unicodedata urllib.error
urllib.parse urllib.request uuid wave weakref webbrowser winreg xml.dom.minidom xml.etree.ElementTree zipfile
zlib zoneinfo""".split()

a = Analysis(
    ['launcher.py'],
    pathex=[SPECPATH],
    binaries=[],
    datas=[(src, ('app_code/' + dst.rpartition('/')[0]).rstrip('/')) for src, dst in code_files()],
    # the app modules are listed so PyInstaller collects every library they import…
    hiddenimports=APP_MODULES + STDLIB + [
        'flask', 'flask.templating', 'jinja2', 'jinja2.ext', 'werkzeug', 'werkzeug.serving', 'werkzeug.debug',
        'PIL', 'PIL.Image', 'PIL.ImageOps', 'PIL.ExifTags', 'PIL.ImageCms', 'PIL.ImageDraw', 'PIL.ImageFilter',
        'PIL.ImageFont', 'PIL.ImageEnhance', 'numpy', 'onnxruntime', 'pillow_heif', 'requests',
    ],
    excludes=['torch', 'torchvision', 'torchaudio', 'transformers', 'tokenizers', 'huggingface_hub',
              'scipy', 'sklearn', 'matplotlib', 'pandas'],
    hookspath=[], hooksconfig={}, runtime_hooks=[], noarchive=False,
)
# …but their own code must not be frozen in: it would hide the updated files in app_code / versions.
a.pure = [m for m in a.pure if m[0].split('.')[0] not in APP_MODULES]

pyz = PYZ(a.pure, a.zipped_data)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='Photo Studio', debug=False,
          bootloader_ignore_signals=False, strip=False, upx=False, console=False, icon='assets/app.ico')
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='Photo Studio')
