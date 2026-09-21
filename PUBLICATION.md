# Publier l'alpha Échos d’Or & d’Argent

Nom public : **Échos d’Or & d’Argent**. Adresse du site :
**https://styloxis.be/echos-or-argent/**. Dépôt :
**NathAmd/echos-or-argent** ; client :
**https://nathamd.github.io/echos-or-argent/**.
Le statut de publication est visible dans les Actions du dépôt GitHub.

## Avant la première publication

Lire [LEGAL_REVIEW.md](LEGAL_REVIEW.md) et [RIGHTS.md](RIGHTS.md).
Confirmer l'identité de l'éditeur et les droits sur le code et les assets.
La mention « alpha », le nom neutre et l'absence de ROM ne constituent pas
une autorisation juridique. Ne pas ajouter de captures du jeu à la page publique.

Le code conserve ses identifiants `pokemaster-*`, ses formats et clés de
sauvegarde pour éviter de casser les données existantes. Le nom affiché,
le manifeste et le favicon utilisent la nouvelle identité.

## Dépôt neuf

L'ancien `.git` et une archive des fichiers de travail avant préparation sont
conservés **hors dépôt**, dans `../PokeMaster-private-backups/`.
Ne pas téléverser ce répertoire : il peut contenir les anciens artefacts privés.
La ROM locale et les références restent sur le disque, ignorées par Git.
Ne jamais utiliser `git add -f` pour les ajouter.

Pour recréer cette installation : créer sur GitHub un dépôt vide `NathAmd/echos-or-argent`, sans README généré.
Ne pas utiliser l'ancien dépôt comme destination et ne pas faire de force-push.
Depuis ce projet, après le commit initial :

```sh
git remote add origin https://github.com/NathAmd/echos-or-argent.git
git push -u origin main
```

Le dépôt neuf contient seulement l'état actuel, sans les anciens commits.
L'ancien dépôt GitHub n'est pas supprimé par cette opération. Si des contenus
interdits y ont été publiés, leur retrait distant reste une démarche séparée.
Un dépôt public expose le **code source** ; le build minifié n'y change rien.

## GitHub Pages

Dans **Settings → Pages → Build and deployment → Source**, choisir
**GitHub Actions**. Lancer ensuite **Deploy static client to GitHub Pages**
depuis l'onglet Actions. Les prochains pushes sur `main` relancent le workflow.
Voir la [documentation GitHub](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

Le workflow contrôle l'arbre Git, installe les dépendances avec `npm ci`,
audite, lance lint et tests, compile puis vérifie le build avant déploiement.
Il publie uniquement `web/dist`. Le serveur `server/` n'est pas déployé sur Pages.
Le mode alpha est solo : aucun compte/coffre/multijoueur distant configuré.
La météo reste une option indépendante soumise à l'autorisation de localisation.

Aucun secret de signature n'est requis pour cette alpha. Les protections
CSP, SRI, SHA-384 et les scans du build restent actives. La signature Ed25519
reste disponible via les scripts pour une release ultérieure. Le manifeste
SHA-384 non signé ne prouve pas l'identité de l'éditeur.

Le chemin de base est dérivé automatiquement du nom du dépôt. Si le dépôt
est renommé, adapter aussi les deux URL de l'iframe. Pour une page utilisateur
`NathAmd.github.io` ou un domaine personnalisé à la racine, définir la variable
Actions `POKEMASTER_PUBLIC_BASE_PATH=/`. Aucun CNAME pour styloxis.be ne doit
être ajouté à ce dépôt : le domaine reste attaché au site principal.

## Intégration au site

Copier le dossier `deployment/styloxis/echos-or-argent/` à la racine du dépôt du site.
Une copie est préparée dans le projet voisin `../MyWebSite/echos-or-argent/`.
Après mise en ligne du client Pages, publier ces deux fichiers sur le site :

```sh
git -C ../MyWebSite add echos-or-argent/index.html echos-or-argent/legal.html
git -C ../MyWebSite commit -m "Add Échos d’Or & d’Argent alpha embed"
git -C ../MyWebSite push
```

L'iframe autorise plein écran et géolocalisation facultative. Aucun accès au
réseau local n'est nécessaire. Un lien direct est prévu pour les navigateurs
qui limitent le stockage ou certaines API dans une iframe. Les sauvegardes
peuvent être isolées entre l'iframe et l'accès direct : exporter avant de changer
d'adresse. Le `noindex` n'est ni un contrôle d'accès ni une protection juridique.

## Vérification locale

```sh
cd web
npm ci
npm run lint
npm test
POKEMASTER_PUBLIC_BASE_PATH=/echos-or-argent/ npm run build
npm run verify:build
npm run check:reproducibility
POKEMASTER_PUBLIC_BASE_PATH=/echos-or-argent/ npm run preview -- --host 127.0.0.1
```

Ouvrir `/echos-or-argent/`, vérifier le chargement initial, les mentions, les
icônes et le chargement d'un fichier local autorisé. Vérifier ensuite l'iframe
sur styloxis.be, le plein écran et l'export/import des sauvegardes sur ordinateur
et mobile. Les tests sans ROM ne certifient pas que la campagne est terminable.

## Résultat de la préparation du 21 septembre 2026

- Nouvel historique : un seul commit racine, 1 557 fichiers suivis ; ancien
  historique et fichiers de travail conservés dans la sauvegarde privée externe.
- Installation `npm ci`, compilation, intégrité et tests rejoués dans un clone
  neuf sans ROM ni références privées : 4 412 tests passent, 111 sont ignorés.
- Lint et frontières du client validés ; serveur : types, build et 156 tests validés.
- Audits npm client et serveur : aucune vulnérabilité signalée au moment du contrôle.
  Vitest mis à jour vers 4.1.11 pour corriger l'avis
  [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).
- Accueil vérifié dans Chrome headless, avec WebGL logiciel et viewport mobile
  de 390 px ; notice, manifeste et favicon accessibles sous le préfixe Pages.
- Avertissement de taille du bundle Vite restant : l'entrée minifiée dépasse
  550 ko. La compilation réussit ; l'optimisation du chargement reste possible.
- La préparation initiale était locale ; la publication demandée ensuite utilise
  le dépôt neuf et le chemin indiqués en tête de ce document. L’ancien dépôt
  PokeMaster reste privé et conserve son historique.
