# Composants tiers / Third-party notices

Le code de Personal Photo Toolkit est sous licence PolyForm Noncommercial 1.0.0 (`LICENSE.md`).
Les composants ci-dessous appartiennent à leurs auteurs et restent sous **leur propre licence**.
Les textes des licences sont dans `LICENSES/` ou à l'adresse indiquée.

## Android — Photo Finder (`android/`)

Bibliothèques incluses dans l'APK :

| Composant | Version | Auteur | Licence |
|---|---|---|---|
| AndroidX Core KTX, Activity Compose, Lifecycle (ViewModel / Runtime Compose), ExifInterface, DocumentFile | 1.16.0 / 1.10.1 / 2.9.1 / 1.4.1 / 1.1.0 | The Android Open Source Project | Apache-2.0 |
| Jetpack Compose (UI, Foundation, Material 3, Material Icons Extended) | BOM 2025.06.00 | The Android Open Source Project / Google | Apache-2.0 |
| Kotlin Standard Library | 2.1.21 | JetBrains s.r.o. | Apache-2.0 |
| kotlinx.coroutines | 1.10.2 | JetBrains s.r.o. | Apache-2.0 |
| Coil (coil-compose, coil-video) | 3.2.0 | Coil Contributors | Apache-2.0 |
| Gradle Wrapper (outil de compilation, non inclus dans l'APK) | 8.13 | Gradle Inc. | Apache-2.0 |

Texte de la licence : `LICENSES/Apache-2.0.txt` (aussi consultable dans l'app : menu ⋮ › À propos et licences).

Services utilisés : le nom des villes vient du service de géocodage d'Android (`android.location.Geocoder`,
fourni par le téléphone). Aucune donnée n'est envoyée ailleurs, sauf au PC choisi par l'utilisateur sur le réseau local.

## PC — Photo Studio / Photo Chooser (`photo_chooser/`)

Bibliothèques Python (installées par `pip`, incluses dans l'exe par PyInstaller) :

| Composant | Auteur | Licence |
|---|---|---|
| Flask, Werkzeug, Jinja2, MarkupSafe, ItsDangerous, Click | Pallets | BSD-3-Clause |
| Blinker | Jason Kirtland / Pallets | MIT |
| Pillow | Jeffrey A. Clark et contributeurs (PIL : Fredrik Lundh) | MIT-CMU (HPND) |
| NumPy | NumPy Developers | BSD-3-Clause (+ composants 0BSD, MIT, Zlib, CC0) |
| ONNX Runtime | Microsoft | MIT |
| requests | Kenneth Reitz / Python Software Foundation | Apache-2.0 |
| pillow-heif | Alexander Piskun | BSD-3-Clause ; **la roue binaire inclut** libheif (LGPL-3.0), libde265 (LGPL-3.0), x265 (**GPL-2.0**), libaom (BSD) |
| PyInstaller (outil de compilation) | PyInstaller Development Team | GPL-2.0-or-later avec exception pour les programmes produits |
| Inno Setup (outil d'installation) | Jordan Russell / Martijn Laan | Inno Setup License |

Logiciel externe, **non fourni** : FFmpeg (utilisé s'il est installé sur l'ordinateur, pour les montages vidéo) — LGPL/GPL, https://ffmpeg.org.

### Modèles d'IA et données

| Élément | Utilisation | Origine | Licence / conditions |
|---|---|---|---|
| Image-Adaptive 3D LUT (`assets/ai_color.npz`) | « Couleur IA » | Zeng et al., *Learning Image-adaptive 3D Lookup Tables*, TPAMI 2020 — https://github.com/HuiZeng/Image-Adaptive-3DLUT | Apache-2.0. Poids entraînés sur le jeu de données MIT-Adobe FiveK (conditions d'utilisation pour la recherche) |
| SegFormer-B2 fine-tuned ADE20K (ONNX, version Xenova) | Masques (ciel, personnes…) — **téléchargé à la demande, non redistribué** | NVIDIA — https://github.com/NVlabs/SegFormer, https://huggingface.co/Xenova/segformer-b2-finetuned-ade-512-512 | NVIDIA Source Code License for SegFormer : **usage non commercial uniquement**. Jeu de données ADE20K (MIT CSAIL) |
| Depth Anything V2 Small (ONNX) | Profondeur — **téléchargé à la demande** | Yang et al. — https://github.com/DepthAnything/Depth-Anything-V2, https://huggingface.co/onnx-community/depth-anything-v2-small | Apache-2.0 |

### Services en ligne

- **Iconify** (https://iconify.design) : recherche d'icônes dans les albums. Chaque jeu d'icônes a sa propre licence (indiquée par Iconify) ; les logos de marques restent des marques déposées.
- **Google Maps** : simple lien ouvert dans le navigateur pour afficher l'emplacement d'une photo.
