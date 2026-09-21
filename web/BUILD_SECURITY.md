> Publication alpha : voir [PUBLICATION.md](../PUBLICATION.md). Le workflow Pages actuel publie le client solo sans backend ni signature Ed25519 obligatoire. Les anciennes procédures de release ci-dessous décrivent une cible plus complète.

# Sécurité du build

## Ce que protège le build

`npm run build` produit puis vérifie `dist/` avec les protections suivantes :

- minification et renommage des identifiants JavaScript par Oxc ;
- noms neutres et empreintes longues pour les fichiers générés ;
- contrôles contre les fuites accidentelles courantes : sources TypeScript, source maps, archives, extensions de ROM/sauvegarde/clé, en-têtes de clés privées, ROM NDS probable et quelques formats de jetons connus ;
- refus du JavaScript public brut qui contournerait les bundles minifiés et versionnés ;
- refus, dans JavaScript, CSS et HTML, des marqueurs du démarrage carte debug, du bot, des rapports locaux et des batteries temps réel (`godmode`, `instant-kill`, `suicide`, runner TXT) ;
- refus des variables publiques dont le nom ressemble à un secret ;
- analyse stricte du HTML, refus des scripts inline, politique CSP placée avant les ressources et attributs SRI sur le script, les préchargements et la feuille de style ;
- manifeste SHA-384 couvrant tous les fichiers distribués ;
- manifeste PWA vérifié avec chemins relatifs, afin de rester dans le
  sous-chemin GitHub Pages ;
- liste des licences des dépendances dans `THIRD_PARTY_LICENSES.md`.

Après une copie ou un déploiement, le manifeste peut être contrôlé avec :

```sh
npm run verify:build
```

Cette vérification s'exécute dans l'environnement de build, avec les dépendances de développement installées (`npm ci`). L'hébergement statique ne doit recevoir que `dist/` et n'a pas besoin de `node_modules`.

Une empreinte non signée détecte une corruption accidentelle, mais un attaquant capable de remplacer les fichiers peut aussi recalculer le manifeste. Pour authentifier une release, il faut le signer.

Ces contrôles ne remplacent pas un scanner de secrets dans la CI : un secret dans un format inconnu, chiffré ou volontairement renommé peut échapper à une détection locale.

## Signature Ed25519 optionnelle

La clé privée doit rester hors du dépôt et hors de `dist/` :

```sh
npm run generate:build-key -- /chemin/securise
POKEMASTER_BUILD_SIGNING_KEY_FILE=/chemin/securise/pokemaster-build-private.pem npm run build
```

Le build ajoute alors `integrity-manifest.sig.json`. Pour vérifier une release signée :

```sh
POKEMASTER_BUILD_VERIFY_KEY_FILE=/chemin/securise/pokemaster-build-public.pem npm run verify:build
```

Le script de génération refuse d'écrire dans le dépôt et de remplacer une clé existante. La clé publique peut être copiée puis distribuée séparément. La clé privée ne doit jamais porter le préfixe `POKEMASTER_PUBLIC_`, être placée sous `public/` ou être ajoutée à Git. En CI de release, `POKEMASTER_REQUIRE_BUILD_SIGNATURE=1` permet de faire échouer le build ou sa vérification lorsque la signature ou la clé de vérification manque. Une clé privée chiffrée peut recevoir sa phrase secrète via `POKEMASTER_BUILD_SIGNING_KEY_PASSPHRASE`.

Fournir `POKEMASTER_BUILD_VERIFY_KEY_FILE` rend également la signature obligatoire : une release dont la signature aurait été supprimée est refusée.

Le workflow Pages alpha se lance sur un push de `main` ou manuellement. Il
publie le client solo sans exiger de secrets ni de signature Ed25519.
Les contrôles CSP, SRI, SHA-384 et les scans restent appliqués.

Pour une future release signée, adapter le workflow pour fournir les chemins
`POKEMASTER_BUILD_SIGNING_KEY_FILE` et `POKEMASTER_BUILD_VERIFY_KEY_FILE`, puis
activer `POKEMASTER_REQUIRE_BUILD_SIGNATURE=1`. Garder la clé privée hors du
dépôt et des artefacts, dans un environnement de release protégé. Distribuer
la clé publique par un canal indépendant pour authentifier la signature.

## Variables d'environnement

Seules les variables préfixées par `POKEMASTER_PUBLIC_` peuvent être exposées au code navigateur. Elles sont publiques par définition. Le build refuse notamment les noms contenant `SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE`, `CREDENTIAL` ou `API_KEY`.

Pour le déploiement statique, `POKEMASTER_PUBLIC_BASE_PATH` décrit le sous-chemin
GitHub Pages et `POKEMASTER_PUBLIC_ONLINE_SERVER_URL` l'origine HTTPS publique du
service social. Cette dernière ajoute uniquement les origines HTTPS/WSS exactes
nécessaires à `connect-src` dans la CSP ; ce n'est ni un secret ni un jeton.
`POKEMASTER_PUBLIC_RTC_ICE_SERVERS` peut ajouter une liste JSON publique de
serveurs STUN/TURN à `RTCPeerConnection`. Elle ne modifie pas `connect-src` et
ses éventuels credentials TURN sont récupérables dans le bundle : ne jamais y
placer un secret maître ou un credential durable non limité.
Le workflow accepte une variable GitHub `POKEMASTER_PUBLIC_BASE_PATH` pour un
domaine personnalisé ; sinon il utilise automatiquement `/nom-du-depot/`. Pour
éviter de publier par erreur un client multijoueur muet, le workflow Pages
refuse le déploiement si `POKEMASTER_PUBLIC_ONLINE_SERVER_URL` est absente. Cette
exigence concerne la publication ; le développement et le jeu local restent
utilisables sans service en ligne.

Le jeton opaque d'un utilisateur est fourni à l'exécution, après chargement du
client. Il reste en mémoire et dans le `sessionStorage` borné à l'onglet afin de
supporter un rechargement de page, mais n'est jamais placé dans une variable
Vite, `localStorage`, une URL, Git ou `dist/`. Fermer l'onglet supprime donc la
copie navigateur. Les empreintes de jetons et les autres secrets de service
appartiennent uniquement à la configuration privée du projet autonome `server/`
sur le VPS.

L'ancien enrôlement d'appareil par fragment n'est plus supporté. Le client purge
encore sa clé legacy lors de l'initialisation afin de supprimer les jetons qui
auraient été conservés par une version de test antérieure.

## Limite incontournable

Une application web envoie son JavaScript au navigateur : un utilisateur déterminé peut toujours le télécharger, le reformater et l'étudier. La minification augmente le coût de la copie opportuniste, mais ne rend jamais un secret confidentiel. Les credentials et les contrôles propres au service social restent sur le VPS ; cela ne transfère aucune logique de jeu vers ce serveur et ne remet pas en cause la règle selon laquelle la ROM demeure locale.

SRI protège les scripts et styles référencés directement par `index.html`. Les chunks chargés dynamiquement sont couverts par le manifeste de release, mais pas vérifiés automatiquement par SRI dans le navigateur. Un serveur capable de remplacer simultanément le HTML et les scripts peut aussi remplacer les empreintes ; la signature doit donc être vérifiée avec une clé publique obtenue séparément.

Publier uniquement `dist/` sur GitHub Pages, via HTTPS. `vite preview` sert à vérifier localement le résultat et ne doit pas devenir le serveur de production. Le service `server/` est un déploiement séparé sur le VPS et ne doit jamais être copié dans l'artefact Pages. Les en-têtes HTTP de l'hébergeur doivent compléter la CSP du document, notamment avec HSTS, `X-Content-Type-Options: nosniff` et `frame-ancestors 'none'`.
