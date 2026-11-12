# Photo Studio (PC)

Application de bureau pour trier, retoucher et mettre en valeur ses photos de vacances.
Elle peut recevoir des photos directement depuis l'app Android (voir [`../android`](../android)) par le Wi-Fi.

| Module | Ce qu'il fait |
|---|---|
| **PhotoChooser** | parcourir un dossier de photos et de vidéos, liker les meilleures (copiées dans un dossier trié), recadrer, retoucher : amélioration automatique par IA (ciel, personnes, relief…), mode Pro façon DaVinci Resolve (roues, courbes, scopes, zones, LUT) |
| **Album** | livre photo mis en page automatiquement (chapitres, dates, légendes), thèmes, formes de cadres, vue livre ouvert, export PDF prêt pour l'impression (Prodigi…) |
| **Montage** | film monté automatiquement avec les photos et vidéos likées : titres, mouvements, transitions, musique, export MP4 |

## Installer

Télécharger `PhotoStudio-Setup-X.Y.Z.exe` dans les [Releases](https://github.com/EwenMorvan/Personal_Photo_Toolkit/releases)
(celles nommées *Photo Studio*). L'installation se fait pour l'utilisateur, sans droits administrateur.
L'application se met ensuite à jour toute seule. Les projets sont rangés dans *Documents › Photo Studio*.

Les modèles d'IA (≈ 210 Mo) se téléchargent depuis l'application la première fois qu'on les utilise.
Le montage vidéo et la lecture des vidéos ont besoin de [ffmpeg](https://ffmpeg.org) installé sur l'ordinateur.

## Développer

```
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
launch.bat
```

Lancée ainsi, l'application garde ses données (projets, albums…) dans ce dossier, ignorées par git.

| Fichier | Rôle |
|---|---|
| `app.py` | serveur Flask, projets, photos, retouche |
| `grading.py`, `ai_masks.py`, `ai_color.py`, `auto_prefs.py` | pipeline de retouche, IA (ONNX Runtime), apprentissage des goûts |
| `album.py`, `montage.py`, `phone_link.py` | albums, montages, lien avec le téléphone |
| `paths.py`, `updater.py` | dossiers (code / données / cache), mises à jour automatiques |
| `launcher.py`, `PhotoStudio.spec`, `installer/` | l'application installée et son installateur |
| `release.py`, `build.bat`, `CHANGELOG.md` | construire et publier une version : voir [PUBLIER.md](PUBLIER.md) |
