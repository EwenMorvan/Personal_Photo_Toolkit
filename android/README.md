# Photo Finder (Android)

Retrouve **toutes** les photos et vidéos du téléphone, peu importe d'où elles viennent
(appareil photo, WhatsApp, téléchargements, Quick Share, Telegram, captures d'écran,
dossiers lointains…), les filtre, puis copie seulement celles qui t'intéressent dans un seul dossier.

## Installer
- Fichier prêt : `PhotoFinder.apk` → copie-le sur le téléphone et ouvre-le (autoriser « sources inconnues »),
- ou, téléphone branché avec le débogage USB : `adb install -r PhotoFinder.apk`.

## Utilisation
- **Grille par jour** (ou par mois, menu ⋮). Appui = aperçu (chemin complet, date, lieu) ; appui long = sélection.
  Le rond à droite d'un jour sélectionne tout le jour.
- **Filtres** (icône entonnoir) : période (aujourd'hui, 7 jours, ce mois-ci, mois dernier, cette année,
  plage personnalisée « du … au … »), photos/vidéos, provenance, dossier, ville (via GPS des photos),
  « autour d'un endroit » + rayon, avec/sans GPS, recherche par nom.
- **Scan approfondi** (toujours actif) : trouve aussi les fichiers que la galerie ignore (dossiers `.nomedia`,
  ex. WhatsApp « Sent »). Nécessite « Accès à tous les fichiers » (un bandeau le propose). Icône 👁 barrée sur ces fichiers.
- **Copier** (photos **et vidéos**) :
  - destination : un dossier au choix (clé USB, carte SD…), le dernier dossier utilisé, ou `Pictures/PhotoFinder/<nom>` dans le téléphone ;
  - organisation : tout dans le dossier tel quel, ou en sous-dossiers par mois (`Septembre`, `Octobre`…),
    `01 2026`, `Septembre 2026`, `2026 › 09 Septembre`, année, jour, provenance, provenance › mois, ville ;
    option « Vidéos » dans un sous-dossier ;
  - les dossiers déjà là sont réutilisés et les fichiers déjà présents sont ignorés (même nom et même taille,
    ou même contenu sous un autre nom) : on peut relancer la même copie sans créer de doublons ;
  - **rien n'est jamais supprimé ni remplacé** dans le dossier choisi ; si un nom est déjà pris par une autre photo,
    la nouvelle est enregistrée sous la forme `nom (1).jpg`.
  Sur le PC : téléphone en USB « Transfert de fichiers » → `Pictures/PhotoFinder`.
- **Envoyer vers Photo Studio (PC)** : dans Photo Studio, ouvre un projet › « + Ajouter des photos » › « 📱 Depuis le téléphone ».
  Le PC cherche le téléphone sur le Wi-Fi ; le téléphone affiche « Le PC demande des photos ». Sélectionne les photos,
  Exporter › « PC · Photo Studio » : elles arrivent dans `projects/<projet>/Depuis_telephone/` et sont ajoutées au projet
  (doublons ignorés). Même Wi-Fi requis ; au 1er lancement, Windows demande d'autoriser Photo Studio sur le réseau privé.
  Ports : UDP 47321 (découverte) et TCP 5056 (transfert).
- **Partager** (Quick Share, Drive…, max 500) et **export CSV** de la liste des chemins.

Les positions GPS et noms de villes sont mis en cache ; seul le nom des villes nécessite internet.

## Compiler
```
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
gradlew.bat assembleDebug
```
