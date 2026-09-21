> Publication alpha : voir [PUBLICATION.md](../PUBLICATION.md). Le workflow Pages actuel publie le client solo sans backend ni signature Ed25519 obligatoire. Les anciennes procédures de release ci-dessous décrivent une cible plus complète.

# Client statique PokeMaster

`web/` est un projet Vite autonome destiné à GitHub Pages. Il contient le
runtime navigateur, le lecteur local de ROM, l’interface, les sauvegardes
locales, le chiffrement du coffre, le client Coop REST/WSS et les transports
WebRTC de Trade/PvP. Il n’importe rien depuis `server/`.

## Développement et validation

Node `22.13.0+` est recommandé.

```bash
npm ci
npm run lint
npm test
npm run build
npm run verify:build
```

Depuis un checkout destiné à une release, exécuter aussi
`npm run check:reproducibility`. Ce gate doit rester séparé du lint quotidien :
il exige volontairement un arbre Git parfaitement propre et une base d'ancres
client, serveur, documentation de release et CI suivies. Cette liste n'est pas
un manifeste exhaustif du produit ; les gates fonctionnels restent nécessaires.

Tous les gates ROM conditionnés par une variable `RUN_*` sont découverts et
lancés séquentiellement par le runner d'audit, à l'exception des audits shardés
ou certifiés séparément par ce même runner. Le chemin peut rester hors du dépôt ;
le runner expose alors temporairement le même fichier sous son ancien nom
canonique au moyen d'un lien, sans copier la ROM :

```bash
ROM_AUDIT_PATH=/chemin/vers/heartgold.nds npm run test:rom-audit
```

`npm run test:rom-audit -- --list-probes` affiche le périmètre découvert sans
exécuter les probes et sans exiger la présence d'une ROM.

Le jeu hors ligne fonctionne sans configuration réseau. Pour un build Pages
avec les fonctions sociales, copier `.env.example` vers `.env.local` ou fournir
les variables requises au processus de build :

```text
POKEMASTER_PUBLIC_BASE_PATH=/PokeMaster/
POKEMASTER_PUBLIC_ONLINE_SERVER_URL=https://online.example.com
# Optionnel, sur une seule ligne JSON :
POKEMASTER_PUBLIC_RTC_ICE_SERVERS=[{"urls":["stun:stun.example.com:3478"]},{"urls":["turns:turn.example.com:5349?transport=tcp"],"username":"scoped-user","credential":"scoped-credential"}]
```

Cette URL désigne toujours le **serveur**, qu’il soit derrière un reverse proxy
ou un tunnel HTTPS/WSS. Le client peut rester servi localement sur `localhost`,
`127.0.0.1` ou `[::1]` : il n’a pas besoin de son propre tunnel. Par exemple,
une page sur `http://localhost:5173` avec la valeur ci-dessus utilise
`https://online.example.com` pour HTTP et dérive `wss://online.example.com` pour
la signalisation et les sessions Coop autoritaires.

En développement local, l’absence de cette variable utilise automatiquement
`http://<hôte-local>:8787`. Ce fallback n’existe pas dans le build Pages et
n’autorise aucun hôte HTTP distant. Côté serveur, l’origine de la page locale
doit être acceptée avec `ALLOW_LOOPBACK_ORIGINS=true` ; `ALLOWED_ORIGINS` ne doit
pas contenir l’adresse du tunnel, mais les origines des pages clientes distantes.

### Jeu sur le réseau local avant publication

Une page HTTP chargée depuis une IP privée n’est pas un contexte sécurisé pour
les navigateurs : WebCrypto, indispensable au coffre de sauvegarde chiffré, peut
y être absent. Le mode LAN complet sert donc le jeu en HTTPS et relaie REST/WSS
vers le serveur réel sur `8787`. La procédure unique — lanceur, autorité locale,
URL console et garde-fous publics — se trouve dans
[`LAN_DEVELOPMENT.md`](../LAN_DEVELOPMENT.md).

Ce service est déjà le vrai serveur privé jouable avant publication : tous les
appareils du LAN utilisent la même autorité persistante de comptes, rendez-vous
Coop, sessions WSS et coffre. Aucun client ni serveur n’a besoin d’un tunnel sur
le réseau local. Un tunnel du serveur ne devient utile que pour rendre ce même
service joignable depuis Internet.

Sur l’hôte macOS, les commandes `lan:service:install`, `start`, `stop`, `status`
et `uninstall` gèrent un LaunchAgent utilisateur à chemins absolus. Son watchdog
attend trois contrôles exacts consécutifs en échec avant de rendre un code non nul
à `launchd`. Le plist n’embarque ni environnement, ni clé, ni secret ; les détails
et précautions sont centralisés dans
[`LAN_DEVELOPMENT.md`](../LAN_DEVELOPMENT.md).

Le base path vaut `/nom-du-depot/` sur une Page de projet et `/` avec un domaine
personnalisé. L’URL du service est publique ; elle ne doit contenir aucun jeton,
secret, paramètre ou identifiant.

### Comptes et session d’onglet

Après l’écran titre, le sas « Dossier Dresseur » restaure la session puis
propose « Connexion », « Créer » ou « Mode local ». Le catalogue des
sauvegardes reste inaccessible tant que ce choix n’est pas terminé. Le menu
multijoueur réutilise ensuite ce compte et ne présente aucun formulaire de
connexion pendant une partie. Le nom de compte est aussi l’identifiant lisible
utilisé pour les demandes d’amis. Aucun code d’appareil, lien secret ou
credential à copier-coller n’est présenté.

Après authentification, une session révocable est mémorisée dans le
`sessionStorage` de l’onglet et restaurée après un rechargement ou un nouveau
passage par le sas titre dans ce même onglet. Fermer l’onglet supprime cette
copie et impose une nouvelle connexion. Le mot de passe n’est jamais enregistré
par le client. La valeur de session reste interne à la couche réseau : elle
n’entre ni dans le DOM, ni dans un snapshot de jeu, ni dans `localStorage`, une
URL ou une variable Vite. Une réponse `401`, l’expiration ou la déconnexion
supprime immédiatement la copie de session. Au démarrage, le client purge aussi
les anciennes sessions et l’ancien enrôlement A/B autrefois conservés dans
`localStorage`.

Pour un compte possédant le droit `cloud-storage`, le mot de passe saisi dans ce
même sas dérive localement une clé AES-GCM de 256 bits avec PBKDF2-SHA-256
(600 000 itérations). La dérivation est liée à l’URL canonique du serveur et à
l’identité du compte. Seule la clé dérivée exportée peut être conservée dans le
stockage du navigateur, sous un nom lui-même dérivé ; le mot de passe et le
couple serveur/compte ne sont pas inscrits en clair dans l’entrée du trousseau.
Le mot de passe n’est envoyé au VPS que comme credential de l’authentification
HTTPS habituelle ; la clé dérivée et les résultats du trousseau ne lui sont
jamais transmis.

### Backups portables de sauvegarde

Chaque slot lisible du catalogue titre propose « Exporter un backup ». Un slot
vide propose « Importer un backup ». Le fichier produit est un JSON PokeMaster
strict et versionné, limité à 1 Mio, qui contient l’identité de la ROM, le slot
d’origine, le type et les dates de sauvegarde, puis le document HGSS data-only.
L’import revalide toute sa structure avec les catalogues de la ROM chargée et
n’écrit que dans un slot encore vide. Un slot lisible, corrompu, en staging ou
rempli pendant le sélecteur de fichier n’est jamais remplacé implicitement.

Ce backup ne contient ni binaire ROM ni ressource extraite, mais il contient la
sauvegarde joueur en clair : profil, progression et équipe. Il n’est pas chiffré
comme le coffre cloud. Il faut donc le conserver comme une donnée personnelle,
ne pas le joindre à une issue publique et ne jamais l’ajouter au dépôt.

Le workflow racine `.github/workflows/deploy-client-pages.yml` se lance sur un
push de `main` ou manuellement et publie seulement `dist/`. L'alpha est solo,
sans backend configuré ni secret de signature obligatoire. Le service social
reste un déploiement séparé, absent de l'artefact Pages. Pour l'activer plus
tard, adapter le workflow et les notices de confidentialité ; l'origine du
serveur devra aussi figurer dans la CSP générée. Voir `../PUBLICATION.md`.

### Traversée NAT avec STUN/TURN — Trade/PvP seulement

La Coop n’utilise ni `RTCPeerConnection`, ni SDP/ICE, ni DataChannel : cette
section ne concerne que Trade, le PvP et la compatibilité de migration.

`POKEMASTER_PUBLIC_RTC_ICE_SERVERS` est facultative. Lorsqu’elle est absente,
`RTCPeerConnection` utilise la configuration ICE native du navigateur sans
serveur STUN/TURN ajouté par PokeMaster. Lorsqu’elle est présente, elle doit être
un tableau JSON de 1 à 8 entrées ; chaque entrée accepte uniquement `urls`, puis
`username` et `credential` pour TURN. Les schémas admis sont `stun:`, `stuns:`,
`turn:` et `turns:`. Les ports, hôtes, paramètres `transport`, tailles et nombres
d’URL sont bornés avant l’appel à `RTCPeerConnection`.

Une entrée TURN exige ses deux credentials ; une entrée STUN les refuse. Cette
variable est intégrée au JavaScript statique et est donc publique : ne jamais y
placer le secret maître d’un serveur TURN. N’utiliser que des credentials
clients limités, révocables et régulièrement renouvelés. Une distribution
publique durable devrait obtenir des credentials TURN à courte durée de vie
depuis un endpoint authentifié ; cet endpoint n’est pas encore fourni ici.

Dans GitHub Pages, la variable de dépôt optionnelle du même nom est transmise au
build. Elle configure uniquement ICE et n’élargit pas les origines HTTPS/WSS de
la CSP, qui restent dérivées de l’unique URL explicite du serveur en ligne.

Les appels HTTP du matchmaking expirent par défaut après 10 secondes, réponse
en flux comprise. Une intégration directe de `createOnlineMatchmakingClient`
peut régler `requestTimeoutMs` entre 250 et 120 000 ms ; l’annulation appelante
reste prioritaire et distincte d’une expiration interne.

La Coop utilise son propre client REST persistant : recherche aléatoire,
invitation d’ami, acceptation/refus et annulation renvoient tous un snapshot
strict. Le serveur attribue les rôles, le `sessionId` opaque et le TTL ; le
client sonde ensuite ce rendez-vous jusqu’à l’attachement WSS direct.

## Frontière locale

- La ROM et les sauvegardes en clair sont sélectionnées ou stockées localement.
- Aucun binaire ROM, dump de probe, ressource extraite, clé ou secret ne doit
  être ajouté au dépôt ni à `dist/`.
- La Coop passe directement du rendez-vous REST persistant à la session privée
  WSS autoritaire, sans WebRTC ni DataChannel. Le serveur arbitre les révisions
  et les déplacements des deux comptes. Avant de compléter le roster, l’hôte
  valide avec sa ROM la position initiale de l’invité ; une transition
  inter-carte exige ensuite son attestation ROM exacte.
- Sur le LAN, les appareils joignent directement le serveur privé et aucun
  tunnel n’est requis. Lors du passage public, un tunnel expose seulement REST
  et WSS du serveur. Ce tunnel ne remplace pas STUN/TURN pour les liens RTC :
  certains NAT stricts pourront encore exiger TURN pour le DataChannel
  Trade/PvP, sans affecter la Coop.
- Le client cloud générique ne transporte que des enveloppes AES-GCM exactes.
  La clé reste côté navigateur et chaque identifiant d’objet est une valeur
  opaque de 128 bits dérivée par HMAC de la version, de l’identité ROM locale et
  du slot. Le VPS ne peut en déduire aucun nom de jeu ou de slot.
- Le stockage de campagne sélectionné après le sas est distinct pour chaque
  couple serveur canonique/compte. Si le mode local contient un slot absent du
  compte ou plus récent, le sas propose une fois « Importer » ou « Garder
  séparée ». La proposition est liée au serveur, au compte, au code et à
  l’identité ROM ; les tokens source/cible sont revérifiés avant écriture et la
  source locale n’est jamais supprimée.
- La synchronisation conserve, pour chaque compte/ROM/slot, un ancrage entre
  l'ETag, l'horloge logique monotone du serveur et l'empreinte des octets locaux.
  Si seul le local a changé il est envoyé ; si seul le serveur a changé il est
  restauré ; si les deux ont changé hors ligne, le sas expose un conflit sans
  écrasement automatique. `savedAt` reste la date visible au joueur et ne
  départage jamais deux branches causales. Une suppression reste conservée sous
  forme de tombstone. « Hors ligne » ouvre le
  cache du compte sans arbitrer le cloud ; « Cette console » (ou « Réparer
  cloud » pour un objet distant illisible) et « Version cloud » sont des choix
  explicites liés à l’ETag distant et au token exact du slot local. Un slot local
  ou distant corrompu n’est jamais écrasé automatiquement.
- Après l’ouverture de la campagne, chaque écriture emporte le token local exact
  qui l'a produite. Un événement retardé ne peut donc pas être rattaché à une
  sauvegarde locale plus récente, même si l'horloge de l'appareil recule.
- Chaque suppression est journalisée avant les octets supprimés, avec les
  empreintes SHA-256 de tous les états committed/staging possibles. Cette preuve
  est relue avant le catalogue, y compris en mode compte hors ligne et sur une
  WebView sans WebCrypto. Une migration mono-save interrompue possède en plus un
  claim durable à phases : ni crash ni second onglet ne peut faire réapparaître
  l’ancienne campagne.
- Une précondition cloud `412` interdit toute mutation locale, relit une fois
  les trois objets puis redemande un choix lié aux nouvelles versions. Le client
  n’adopte jamais un ETag pour écraser à l’aveugle un autre appareil.
- Le serveur joint `Opaque-Mutation` à chaque lecture et PUT. Cette HLC est
  persistée hors du ciphertext, reste monotone après redémarrage et après un
  recul de son horloge murale, sans révéler la nature de l'objet chiffré.
- La sauvegarde persistée complète est projetée dans un schéma data-only exact :
  état fonctionnel, références numériques et textes joueur attestés seulement.
  Une extension inconnue, une copie ou un document d'une autre autorité est
  refusé par la façade cloud avant toute requête.
- Les états de présentation issus de la carte (objets, décors, hauteur et
  mouvement d'avatar) restent locaux et sont reconstruits depuis la ROM, tandis
  que les états nécessaires au gameplay, dont Safari, NG+ et Frontier, sont
  conservés sous une forme numérique bornée.
- Les anciennes sauvegardes sont restaurées avec la ROM locale puis réécrites
  transactionnellement dans ce schéma ; une erreur ou une modification
  concurrente préserve les octets legacy et n'émet aucun nouveau slot brut.
- Les gros messages RTC de Trade/PvP et de la compatibilité de migration sont
  fragmentés, coalescés sous backpressure et repris sur `bufferedamountlow`,
  avec des files et délais bornés pour Safari.
- Le JavaScript envoyé à un navigateur reste téléchargeable. La minification,
  l’intégrité et la signature optionnelle contribuent à protéger une release contre les
  fuites accidentelles et l’altération ; elles ne rendent pas un client web
  secret ou inviolable.

Les détails du build durci figurent dans `BUILD_SECURITY.md`. La frontière des
données est décrite dans [`../FRONTIERE_DONNEES_RESEAU.md`](../FRONTIERE_DONNEES_RESEAU.md).
Le sas de compte est raccordé entre l’écran titre et le catalogue de
sauvegardes. Il sélectionne le cache serveur/compte et termine, le cas échéant,
la réconciliation cloud avant d’afficher les slots. Les amis, invitations,
sessions Coop autoritaires et échanges P2P transactionnels restent accessibles
depuis l’entrée « Multijoueur » du menu burger, avec la session déjà restaurée
avant la partie ; ce menu ne contient aucun second formulaire de compte. Le
runtime réseau de partie n’est créé que lors de cette ouverture. Le rendez-vous
Coop persistant attribue directement le rôle et la session serveur, sans
négociation RTC. La présence, la marche/course, les transitions de carte et une
première tranche atomique d’interactions scénario par objet ou coordonnée sont
raccordées ; les combats partagés restent à compléter. Les échanges
disposent d’un journal local
data-only et d’une réconciliation exactement-once après reconnexion ; une phase
incertaine reste verrouillée plutôt que de risquer une duplication ou une perte.
Un garde de fonctionnalités commun au multijoueur et au NG+ prépare une future
preuve d’abonnement vérifiée côté serveur, mais sa politique est ouverte tant
que ce service n’est pas raccordé.
Une campagne locale ou de compte détient un bail exclusif Web Locks depuis le
sas jusqu’au retour au titre. Un second onglet reçoit immédiatement l’écran
« campagne déjà ouverte » et peut choisir le mode local ; `pagehide` persiste
d’abord la partie puis libère le bail, et une restauration bfcache repasse par
le sas. Authentification, dérivation de clé et catalogue sont annulables et
bornés à huit secondes, sans publication tardive de session ou de clé.
La sauvegarde complète data-only, le trousseau local, les tombstones et la
réconciliation horodatée sont raccordés à ce parcours titre. Il n’existe pas de
fusion automatique : un conflit divergent ouvre des choix manette/tactile et
garde « Hors ligne » comme sortie sans mutation. Choisir la console ou le cloud
ne remplace le slot que si ses versions locale et distante sont encore celles
présentées.

Toutes les saisies joueur passent par l’unique `GameTextEntryOverlay` : compte,
mot de passe, surnom, texte multijoueur et diagnostic utilisent le même clavier
adaptatif et les mêmes actions clavier/manette/tactile. Les champs visibles ne
sont que des lanceurs `readonly`; aucun écran ne possède son propre clavier.
