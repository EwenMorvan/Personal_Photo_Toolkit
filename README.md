# Personal Photo Toolkit

Suite photo personnelle : une app Android qui liste toutes les photos et vidéos du
téléphone avec des filtres (date, provenance, lieu) et les exporte, et une app PC
(Python/Flask) pour trier, retoucher et créer des albums, avec transfert entre les
deux par Wi-Fi. D'autres fonctions sont prévues.

## Contenu

| Dossier | Application | Technologie |
|---|---|---|
| [`android/`](android) | **Photo Finder** : retrouve toutes les photos et vidéos du téléphone (galerie, WhatsApp, Quick Share, téléchargements, dossiers cachés), filtres par date, provenance, dossier et lieu, export vers une clé USB, un dossier ou le PC | Kotlin, Jetpack Compose |
| [`photo_chooser/`](photo_chooser) | **Photo Studio** : tri, retouche, albums et montages sur PC | Python, Flask |

## Lien entre les deux applications

Dans Photo Studio : *+ Ajouter des photos › Depuis le téléphone*. Le PC envoie un
signal sur le réseau local, le téléphone affiche une notification, l'utilisateur
choisit les photos puis *Exporter › PC · Photo Studio*. Les fichiers sont copiés
dans le dossier du projet, sans doublons.

- Découverte : UDP, port `47321` (broadcast)
- Transfert : HTTP sur le réseau local, port `5056`, protégé par un jeton propre à chaque session
- Les deux appareils doivent être sur le même Wi-Fi.

## Compiler l'app Android

```
cd android
gradlew.bat assembleDebug
```

JDK 17+ (celui d'Android Studio convient). L'APK est produit dans
`android/app/build/outputs/apk/debug/`.

## Licence

Code sous **PolyForm Noncommercial 1.0.0** (`LICENSE.md`) : utilisation, modification et partage
autorisés **à des fins non commerciales uniquement**.

Required Notice: Copyright (c) 2026 Ewen Morvan (https://github.com/EwenMorvan)

Les bibliothèques, modèles et services tiers gardent leur propre licence : voir
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
