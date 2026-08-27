# Cartes

Flashcards CapECL : [capecl.fr/cartes](https://capecl.fr/cartes) · [miroir GitHub](https://bbphysique.github.io/Cartes/)

## Installation

1. Installer Node.js 20.19 ou plus récent.
2. Exécuter `npm ci`.

Pour régénérer les cartes, installer aussi Python 3.11+ puis exécuter `pip install -r requirements.txt`.

## Développement

- `npm run dev` : serveur Vite local sur `http://localhost:3000`.
- `npm run build` : production dans `dist/`.
- `npm run preview` : aperçu local du build.
- `npm run lint` : contrôle ESLint de `src/`.
- `npm run format:check` : contrôle Prettier de `src/`.

## Mettre à jour les cartes

Méthode automatique : ajouter le PDF dans `flashcards/`, puis push sur `main`. GitHub Actions régénère et déploie les cartes.

Sinon, la méthode recommandée : regénérer et vérifier localement

1. Exécuter `python cartes.py` depuis la racine.
2. Vérifier `flashcards/<nom-du-pdf>/` et son `manifest.json`.
3. Exécuter `npm run build`, puis `npm run preview`.
4. Valider et push les fichiers générés.

Le profil `web` est utilisé par défaut (environ 1min20 pour traiter tous les chapitres). `--profile lossless` conserve les images sans perte et `--profile fast` produit rapidement un aperçu léger.

## Déploiement

Le workflow **Deploy Dist** construit `dist/` et le publie sur la branche `deploy`.

## Licences

- Code hors `flashcards/` : [licence MIT](./LICENSE).
- Contenu de `flashcards/` : [GNU Free Documentation License 1.3](./LICENSE-FLASHCARDS).

/!\ Toute redistribution ou modification des cartes doit respecter la GNU FDL 1.3.
