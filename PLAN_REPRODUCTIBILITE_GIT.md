> Publication alpha : voir [PUBLICATION.md](PUBLICATION.md). Le workflow Pages actuel publie le client solo sans backend ni signature Ed25519 obligatoire. Les anciennes procédures de release ci-dessous décrivent une cible plus complète.

# Plan de reproductibilité Git

Date de référence : 8 septembre 2026.

## Résultat

Le commit publié `c45e35e` ne représente pas le produit présent dans l’espace
de travail. Il contient 442 fichiers, aucun fichier `server/`, aucun workflow
`.github/` et seulement 398 fichiers sous `web/src`.

Un snapshot de `HEAD` créé avec `git archive` a confirmé les limites suivantes :

- `npm ci` et le lint client réussissent ;
- `npm test` échoue : le probe temporaire
  `web/src/rom/battle/.tmp-secret-table.test.ts`, suivi par erreur, exige une ROM
  absente d’un clone normal ;
- 898 tests passent, 56 sont ignorés et un échoue ;
- le build client historique réussit, mais sans manifeste d’intégrité, sans
  vérification séparée et sans serveur ;
- aucun test, build ou conteneur serveur n’est possible depuis `HEAD`.

À l’inverse, un snapshot candidat constitué uniquement des fichiers suivis ou
non ignorés présents dans l’espace de travail contient le client complet et les
30 sources serveur. La première preuve, désormais historique, portait sur
1 539 fichiers suivis, dont 1 372 sous `web/src`, et ne contenait aucune ROM,
sauvegarde, rapport local ni donnée serveur.

Ce snapshot historique a été transformé en dépôt Git jetable propre, puis testé
avec deux installations `npm ci` neuves. Le gate y passe avec 1 539 fichiers
suivis. Côté client, le lint et les frontières contrôlent 1 344 sources, 611 fichiers et
4 304 tests passent, puis le build protégé signé et sa vérification par clé
publique séparée réussissent. Côté serveur, le typecheck, les 156 tests et le
build réussissent. Les deux audits npm signalent zéro vulnérabilité. Le build
avec le sous-chemin `/PokeMaster/` réécrit aussi correctement les huit URL de
textures de thème.

Le snapshot candidat présent compte maintenant 1 560 fichiers non ignorés,
dont 1 391 sous `web/src` et 70 sous `server`. Il a été transformé en dépôt Git
jetable propre, puis reconstruit avec deux `npm ci` neufs. Le gate y confirme
les 1 560 fichiers suivis et reste vert après l’ensemble des tests.

Côté client, 620 fichiers et 4 388 tests passent, 56 fichiers et 111 tests
conditionnels sont ignorés par la passe sans ROM, et TypeScript, lint ainsi que
les frontières de 1 363 sources réussissent. Le build de 28 fichiers réussit,
puis une construction `/PokeMaster/` avec signature Ed25519 obligatoire est
vérifiée séparément par la clé publique. Côté serveur, typecheck, 156 tests et
build réussissent. Les deux audits npm signalent zéro vulnérabilité. Enfin, les
59 gates ROM, dont 48 probes standards et quatre parcours, réussissent sur ce
même dépôt : 3 657 entrées, 10 971 chemins, 519 cartes et toutes les
certifications du rapport de révision 9 sont verts.

L’espace de travail brut affiche 621 fichiers, 4 389 tests et 1 364 sources à
cause du scratch ignoré `web/src/rom/battle/.tmp-secret-table.test.ts`. Ce test
local dépend de la ROM, n’a aucune assertion et est déjà supprimé de l’index ;
il ne fait pas partie du candidat reproductible. La preuve courante correcte
est donc celle du dépôt jetable à 620 fichiers, 4 388 tests et 1 363 sources.

## Inventaire à préserver

L’audit initial a trouvé 1 328 chemins divergents. Après les corrections et
preuves ajoutées pendant l’audit, l’état courant en compte 1 353 : 211
modifiés, 12 supprimés et 1 130 non suivis.

### Client

Le client compte désormais 1 263 chemins divergents. La ventilation initiale
ci-dessous reste utile pour organiser les lots, mais doit être régénérée juste
avant leur mise en index :

- 626 concernent l’application, ses styles et `index.html` ;
- 570 sont des tests ou bandes de test ;
- 13 sont des scripts non-test ;
- 12 sont des configurations ou documents ;
- 11 sont des assets statiques ;
- 7 sont des rapports ou artefacts déjà supprimés de l’index.

Les 998 nouveaux fichiers sous `web/src` — 510 sources non-test et 488 tests —
ne sont pas indépendants : l’analyse de dépendances historique montrait déjà
que 495 des 501 nouvelles sources applicatives étaient atteignables depuis
`main.ts`, et 63 fichiers suivis modifiés importent 308 modules non suivis. Le `package.json`
référence également 17 scripts non suivis. Le client fonctionnel doit donc être
livré comme un snapshot cohérent, pas par sélection arbitraire de quelques
fichiers.

### Serveur

Les 70 fichiers visibles de `server/` sont tous non suivis :

- 30 sources TypeScript ;
- 25 tests ;
- 15 manifestes, configurations, fichiers Docker/Compose et documents.

Les 342 dépendances, 30 sorties `dist` et 4 fichiers `data` observés sont
ignorés. Les données runtime contiennent notamment des identités, condensats et
objets utilisateur ; elles ne doivent jamais être versionnées, même lorsque
leur charge utile est chiffrée.

## Ce qui doit rester local

Ne jamais ajouter, même avec `git add -f` :

- ROMs, sauvegardes, extractions, patches et archives ;
- `.env*` privés, clés, certificats et répertoire `.signing/` ;
- `node_modules/`, `dist/`, `coverage/`, caches et `*.tsbuildinfo` ;
- `server/data/` ;
- rapports `REPPORT/`, `.field-script-probe*.json`, dumps et fichiers
  `.tmp-*` issus de la ROM.

Les `.gitignore` racine, client et serveur couvrent désormais ces familles. Le
contrôle `npm run check:repository` inspecte en plus les fichiers suivis et non
ignorés, y compris leur contenu, pour détecter ROM ou clé privée masquée.
Les fichiers ignorés restent volontairement invisibles à ces deux gates : avant
d’ajouter une exception ou une fixture légitime, examiner aussi
`git status --short --ignored` et ne jamais forcer un secret dans l’index.

## Décisions humaines encore requises

- Vérifier l’origine et les droits des 13 références visuelles déjà dans
  l’historique et des huit textures de thème Pokémon nécessaires à l’UI.
- Décider de conserver ou retirer les trois SVG rétro non référencés :
  `retro-button.svg`, `retro-button-selected.svg` et `retro-frame.svg`.
- Décider si `.vscode/launch.json` et `.vscode/tasks.json` sont des réglages
  partagés ou locaux.
- Choisir la licence du code, créer la notice/provenance des assets et définir
  la politique de confidentialité. Ces décisions ne peuvent pas être inventées
  techniquement.
- Décider si les anciens rapports dérivés de la ROM doivent être purgés de
  l’historique avant publication. Une réécriture d’historique ne doit pas être
  lancée sans coordination explicite.

## Lots de commits proposés

Chaque lot doit être relu avec `git diff --cached --name-status` et
`git diff --cached --check`. Ne pas utiliser `git add .`, `git clean`,
`git reset --hard` ou `git add -f`.

### 1. Hygiène historique

Inclure les `.gitignore` racine/client, le scanner de dépôt et son test, ainsi
que les huit suppressions déjà présentes dans l’index : cache Vitest, rapports
de probes, dump terrain, probe temporaire et fichier `steps`. Vérifier ensuite :

```sh
cd web
node scripts/check-repository-artifacts.mjs
npx vitest run scripts/check-repository-artifacts.test.mjs
```

### 2. Serveur autonome

Versionner ensemble les 70 fichiers de `server/`. Le premier sous-lot minimal
testable regroupe manifestes, lockfile, pins Node, TypeScript, Dockerfile, les
30 sources et les 25 tests ; le second peut contenir README, `.env.example` et
les quatre variantes Compose.

Gates :

```sh
cd server
npm ci
npm audit --audit-level=high
npm run typecheck
npm test
npm run build
```

### 3. Snapshot client cohérent

Avant ce lot, trancher la provenance et la conservation des 13 références
visuelles historiques et des huit textures de thème utilisées par l’UI.
Versionner ensemble sources, tests, styles, assets utilisés, bandes E2E et
remplacements des quatre fichiers applicatifs supprimés. Les suppressions des
deux anciens CSS doivent accompagner les 21 modules CSS qui les remplacent ;
les suppressions du clavier de surnom doivent accompagner son nouveau flux.

### 4. Outillage et protection client

Livrer atomiquement `package.json`, lockfile, pins Node, TypeScript/Vite,
protecteur de build, runners ROM/navigateur, contrôles de frontières et gate de
reproductibilité. Le scanner de dépôt est déjà livré dans le lot d’hygiène afin
que sa gate puisse être exécutée dès ce lot.

Gates :

```sh
cd web
npm ci
npm audit --audit-level=high
npm run lint
npm test
npm run build
npm run verify:build
```

### 5. CI/CD et politiques

Ajouter les cinq fichiers `.github/`, `PLAN_REPRODUCTIBILITE_GIT.md`, puis README,
contribution, sécurité, frontières réseau, architecture et audits. La CI de pull
request s’exécute sur toute modification et appelle désormais le gate Git avant
l’installation.
Pages et GHCR restent manuels, limités à `main` protégée et placés dans les
environnements `release-pages` et `release-ghcr`. Configurer leurs reviewers,
règles de branche, variables et secrets de signature avant la première exécution.

### 6. Métadonnées de release

Aligner les versions client/serveur, tenir un changelog, ajouter la licence et
la provenance validées, puis créer une release candidate signée.

## Gate ajouté

`npm run check:reproducibility` échoue si l’arbre contient le moindre changement
ou si une ancre de base du client, du serveur, des tests, du build protégé, de la
documentation de release ou de la CI manque dans l’index. Il ne remplace ni un
manifeste exhaustif du snapshot ni les tests qui suivent : dans une CI issue
d’un checkout, il prouve seulement que la fermeture Git est propre et que ces
ancres sont bien suivies. Il est volontairement rouge dans l’espace de travail
actuel, avec 1 353 changements et 40 ancres absentes de l’index, et devient vert
dans le snapshot candidat propre.

Le candidat courant a maintenant passé depuis un dépôt jetable les `npm ci`,
tests, builds protégés et runner ROM local sans publication de la ROM. La
certification de release devra répéter cette preuve depuis le vrai commit,
ajouter le build Docker sur une machine équipée, puis obtenir un go/no-go
technique, produit, sécurité et juridique.
