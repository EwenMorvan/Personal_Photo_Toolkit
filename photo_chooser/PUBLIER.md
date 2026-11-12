# Publier une nouvelle version de Photo Studio

## Comment ça marche

- **`main`** : là où tu développes.
- **Une version = une branche `release/photo-studio-vX.Y.Z`, un tag `photo-studio-vX.Y.Z` et une « Release » GitHub.**
  La branche et le tag figent le code de la version ; la Release porte les fichiers à télécharger et le texte des nouveautés.
  Le préfixe `photo-studio-v` (dans `version.json`) sépare ces versions de celles de l'app Android (`android-v…`) :
  l'application ne regarde que les siennes.
- L'application installée chez tes proches regarde au démarrage la dernière Release du dépôt
  indiqué dans `version.json` (`"repo"`). Si elle est plus récente, elle affiche les nouveautés
  et propose « Mettre à jour ». Sans Internet ou sans nouvelle version, elle démarre normalement.
- La plupart des mises à jour ne téléchargent que le code (quelques Mo). Si tu ajoutes ou changes
  une bibliothèque Python, augmente `RUNTIME` dans `launcher.py` **et** `"runtime"` dans
  `version.json` : l'application téléchargera alors l'installateur complet et le lancera toute seule.
- Si une mise à jour ne démarre pas, l'application revient automatiquement à la version précédente
  et ne repropose plus celle-là.

Le dépôt doit rester **public** pour que les applications puissent lire les Releases sans mot de passe.

## Une fois au début

- Inno Setup (pour l'installateur) : `winget install JRSoftware.InnoSetup`.
- La publication utilise les identifiants que git a déjà pour pousser sur GitHub (ou la variable `GITHUB_TOKEN`).

## À chaque version

1. En haut de `CHANGELOG.md`, ajouter `## X.Y.Z` et la liste des nouveautés, écrite pour tes proches.
2. Mettre le même numéro dans `version.json` (ou `python release.py --bump minor`).
3. Commiter.
4. `build.bat --publish` : construit l'installateur et le paquet de mise à jour, crée la branche et le tag, les pousse et publie la Release.

Sans `--publish`, tout est préparé dans `dist\release\X.Y.Z\` et tu peux créer la Release à la main
sur GitHub (tag `photo-studio-vX.Y.Z`, texte = `notes.md`, fichiers = les trois autres).

## Ce que reçoivent tes proches

- **Première fois** : `PhotoStudio-Setup-X.Y.Z.exe`. Il s'installe pour l'utilisateur, sans droits administrateur,
  dans `%LOCALAPPDATA%\Programs\Photo Studio`, avec menu Démarrer, icône Bureau et désinstallation
  depuis *Paramètres › Applications*.
- **Leurs projets** sont dans `Documents\Photo Studio` (modifiable dans ⚙ Réglages) : ni les mises à jour
  ni la désinstallation n'y touchent.
- Au premier lancement, si l'application trouve des projets de l'ancien `Photo_chooser.exe`
  (Documents, Bureau, Téléchargements), elle propose de les importer. Sinon : ⚙ Réglages › Importer.
