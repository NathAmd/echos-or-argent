# Serveur privé : comptes, cloud et sessions autoritaires

Ce projet est un service Node.js autonome destiné à un VPS. Il fournit uniquement :

- des comptes par nom d’utilisateur et mot de passe ;
- les demandes et la liste d’amis ;
- la présence en mémoire ;
- une mise en relation aléatoire et éphémère historique pour `trade`, `pvp` et `coop` ;
- un rendez-vous Coop persistant, avec invitation ami ou file aléatoire et rôles décidés par le serveur ;
- la signalisation WebRTC pour `trade`, `pvp` et la migration des anciens clients ;
- une autorité de session partagée, volontairement étroite, pour présence et déplacements révisés ;
- un coffre d’objets génériques chiffrés côté client.

Le service ne fournit aucun relais de message applicatif libre. Les échanges qui
ne correspondent pas au contrat strict de session partagée de Coop peuvent
encore passer par les canaux WebRTC de `trade` et `pvp`.
Le coffre ne reçoit ni structure métier, ni nom libre, ni métadonnée : il accepte
seulement une enveloppe cryptographique stricte. La clé et le sens du contenu
restent locaux au client ; le serveur ne peut pas déchiffrer l’objet.

## Prérequis et séparation

- Node.js 20.11 ou plus récent, ou Docker ;
- un domaine HTTPS devant le service ;
- un reverse proxy ou un tunnel côté serveur prenant en charge WebSocket ;
- un volume persistant pour `data/accounts.json`, `data/friends.json`,
  `data/coop-rendezvous.json`, `data/shared-sessions.json`, ses sidecars
  `data/shared-sessions.json.journal*` et `data/objects/`.

Ce dossier est un projet indépendant : il possède son propre manifeste, ses dépendances, sa compilation et ses tests. Aucun secret durable ne doit être intégré au dépôt ou au build d’un client statique. L’utilisateur saisit son compte ; le serveur renvoie une session opaque que le client emploie en interne et ne demande jamais de copier-coller.

Le test `test/project-boundary.test.ts` vérifie que les sources du service restent
génériques, que leurs imports relatifs ne sortent pas de `server/src` et qu’aucun
binaire de ROM/sauvegarde, média, patch binaire, archive distribuable ou clé
privée n’entre dans le projet serveur. Il verrouille également l’allowlist des
entrées copiées par le Dockerfile : manifestes npm, configuration TypeScript et
`src/` uniquement. Les fichiers source `.patch` et `.diff` ne sont pas interdits
: le contrôle porte sur des formats binaires/secret précis afin de ne pas
confondre une contribution source avec un contenu local à exclure.

## Configuration obligatoire

Copier `.env.example` vers un fichier `.env` non versionné, puis remplacer toutes les valeurs d’exemple.

| Variable | Rôle |
|---|---|
| `ALLOWED_ORIGINS` | Origines exactes des pages clientes, séparées par des virgules. Requise sauf si `ALLOW_LOOPBACK_ORIGINS=true` ou `LAN_DEVELOPMENT_MODE=true` ; `*` est refusé. |
| `ALLOW_LOOPBACK_ORIGINS` | `true` autorise explicitement les pages servies depuis `localhost`, `127.0.0.1` ou `[::1]`, en HTTP ou HTTPS et sur tout port. Défaut : `false`. |
| `LAN_DEVELOPMENT_MODE` | `true` autorise temporairement les origines canoniques sur IP privée/locale et utilise `0.0.0.0` comme `HOST` par défaut. Réservé au réseau de développement ; défaut : `false`. |
| `ACCOUNT_STORE_PATH` | Fichier atomique des comptes, empreintes scrypt et sessions hachées. Défaut : `./data/accounts.json`. |
| `ACCOUNT_SESSION_TTL_MS` | Durée d’une session, de 5 minutes à 90 jours. Défaut : 30 jours. |
| `ACCOUNT_ENTITLEMENT_POLICY` | `open` pendant la phase de test, ou `patreon` quand le fournisseur sera branché. Défaut : `open`. |
| `AUTH_TOKENS_JSON` | Compatibilité optionnelle d’automatisation/migration `userId -> SHA-256(token)`. Ne fait pas partie du parcours produit. |
| `HOST` | Interface d’écoute. Défaut : `127.0.0.1`. Utiliser `0.0.0.0` dans Docker. |
| `PORT` | Port d’écoute. Défaut : `8787`. |
| `FRIEND_STORE_PATH` | Fichier social persistant. Défaut : `./data/friends.json`. |
| `OBJECT_STORE_PATH` | Dossier distinct des objets opaques. Défaut : `./data/objects`. |
| `WS_TICKET_TTL_MS` | Durée du ticket WebSocket à usage unique, de 5 à 60 secondes. Défaut : 30 secondes. |
| `MATCHMAKING_QUEUE_TTL_MS` | Durée d’une recherche, de 10 secondes à 10 minutes. Défaut : 2 minutes. |
| `MATCHMAKING_AUTHORIZATION_TTL_MS` | Durée de l’autorisation de signalisation d’un match, de 15 secondes à 5 minutes. Défaut : 2 minutes. |
| `COOP_RENDEZVOUS_TTL_MS` | Durée durable d’une file, offre ou acceptation Coop avant démarrage, de 15 secondes à 10 minutes. Défaut : 2 minutes. |
| `COOP_RENDEZVOUS_STORE_PATH` | Fichier atomique des files et rendez-vous Coop `offered`, `ready` et `active`. Défaut : `./data/coop-rendezvous.json`. |
| `ALLOW_LEGACY_COOP_BOOTSTRAP` | Migration temporaire : autorise explicitement l’ancien bootstrap par amitié ou match Coop si aucun rendez-vous serveur ne porte le `sessionId`. Défaut : `false`, y compris en LAN. |
| `SHARED_SESSION_IDLE_TTL_MS` | Durée de reconnexion d’une session partagée abandonnée, de 1 minute à 7 jours. Défaut : 24 heures. Une session avec au moins une socket attachée n’expire pas. |
| `SHARED_SESSION_STORE_PATH` | Checkpoint atomique des descripteurs, membres, positions, révisions et identifiants de commandes déjà appliqués. Le serveur maintient à côté un WAL `.journal` borné et, pendant un compactage, `.journal.checkpoint`. Défaut : `./data/shared-sessions.json`. |

`ALLOWED_ORIGINS` décrit l’origine de la **page cliente**, jamais le domaine public
du serveur ou du tunnel. L’origine d’un site publié sous un sous-chemin reste
seulement `https://compte.github.io` : le chemin du projet ne doit pas y figurer.
Pour accepter cette Page ainsi que les clients locaux sur un port de développement
quelconque :

```text
ALLOWED_ORIGINS=https://compte.github.io
ALLOW_LOOPBACK_ORIGINS=true
```

L’option locale reste bornée aux trois noms de boucle locale littéraux. Elle
n’autorise ni `file://`/l’origine `null`, ni les sous-domaines de `localhost`, ni
les adresses IP du LAN. HTTP, les preflights CORS et les upgrades WebSocket
emploient exactement la même politique.
Les réponses CORS exposent explicitement `ETag`, `Opaque-Mutation`,
`Engagement-Lease` et `Shared-Attachment` au code de la page cliente.

Pour le serveur jouable du réseau de développement, `npm run dev:lan` active le
mode LAN sans liste d’IP fragile. Seules les boucles locales, les plages IPv4
privées/link-local, les plages IPv6 ULA/link-local et un nom mDNS canonique
`https://<machine>.local` sont alors reconnus. HTTP reste interdit pour mDNS,
comme pour tout domaine ou IP publique. Le mode désactivé conserve la politique
publique HTTPS stricte. Le client recommandé passe par le proxy HTTPS Vite décrit
dans [`LAN_DEVELOPMENT.md`](../LAN_DEVELOPMENT.md), tandis que ce serveur reste
un service HTTP sur le port `8787`.

### Comptes et sessions

Le nom d’utilisateur est canonique, immuable, sans distinction de casse, et
contient 3 à 32 caractères ASCII parmi lettres, chiffres, `.`, `_` et `-`.
Le mot de passe contient au moins 10 caractères et au plus 256 octets UTF-8. Il est dérivé avec scrypt
asynchrone (`N=2^17`, `r=8`, `p=1`), un sel aléatoire propre au compte et une
comparaison constante. Le texte clair n’est jamais persisté.

La capacité globale est de 10 000 comptes par instance fichier. Une inscription
valide lorsque cette limite est atteinte échoue uniformément avec
`503 UNAVAILABLE`, avant toute dérivation scrypt ; la limite est revérifiée dans
la section de mutation sérialisée pour fermer la course sur la dernière place.
Le domaine borne aussi atomiquement les sessions d’authentification à 100 000
au total et à 20 actives par compte. Après purge des sessions expirées ou
révoquées, une nouvelle session sans place disponible échoue avec
`503 UNAVAILABLE` au lieu de laisser l’adaptateur fichier produire une erreur tardive.
Cette atomicité repose sur l’instance serveur unique documentée plus bas ; un
déploiement multiprocessus exige un store transactionnel partagé.

Chaque inscription ou connexion crée une session aléatoire de 256 bits. Seule
son empreinte SHA-256 est écrite dans `accounts.json`; une déconnexion la révoque
et les sessions expirées sont refusées. Les réponses d’authentification portent
toujours `Cache-Control: no-store`. Les échecs de connexion ne permettent pas de
distinguer un compte absent d’un mauvais mot de passe.

Chaque nouveau compte reçoit aussi un `vaultKeyId` aléatoire de 256 bits,
immuable et non secret. Il est renvoyé dans le compte public afin que le client
dérive sa clé de coffre indépendamment du domaine, du port et de l’appareil.
Les comptes antérieurs qui n’en possèdent pas restent volontairement sur le
protocole hérité jusqu’à une migration explicite depuis un coffre déverrouillé.
Le serveur ne reçoit jamais la clé AES-GCM dérivée.

La politique `open` accorde temporairement les capacités génériques
`online`, `premium-client`, `cloud-storage` et `development`. La politique
`patreon` délèguera ces droits au fournisseur prévu mais encore inactif. Un rôle
`admin` contourne toujours cette politique sans dépendre de Patreon. Le client
traduit `online` en accès multijoueur et `premium-client` en accès aux fonctions
premium ; le VPS ne conserve aucun vocabulaire ni contenu propre au jeu.

Pour promouvoir un compte existant, arrêter d’abord l’unique instance du serveur,
puis exécuter la commande locale suivante sur le VPS. Le rôle n’est jamais
choisi par le client et aucun nom d’administrateur public n’est préréservé :

```bash
npm run build
ACCOUNT_STORE_PATH=./data/accounts.json npm run account:admin -- promote alice --confirm-server-stopped
```

## Développement

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Dans un second terminal, le serveur LAN persistant se lance avec :

```bash
npm run dev:lan
```

Pour démarrer avec Node.js 22 et un fichier d’environnement :

```bash
node --env-file=.env dist/index.js
```

Le point de santé public est `GET /healthz`.

## API HTTP

L’inscription et la connexion sont publiques. Toutes les autres routes `/v1/*`
exigent la session renvoyée par le serveur dans l’en-tête suivant. Ce Bearer est
un détail interne au client, jamais une valeur à faire saisir ou copier :

```http
Authorization: Bearer <session-opaque>
```

| Méthode et route | Entrée | Réponse réussie |
|---|---|---|
| `POST /v1/accounts/register` | Sans Bearer, JSON exact `{"username":"alice","password":"…"}` | `201 {"account":{…},"session":{"accessToken":"…","expiresAt":…}}` |
| `POST /v1/accounts/login` | Sans Bearer, même JSON exact | `200` avec le même contrat compte/session |
| `GET /v1/account` | — | `200 {"account":{"id":"alice","username":"alice","role":"user","entitlements":[…]}}` |
| `POST /v1/accounts/logout` | corps vide | `204`, révoque la session courante |
| `GET /v1/me` | — | `200 {"userId":"alice"}` |
| `GET /v1/social` | — | `200 {"friends":[{"userId":"bob","online":true}],"incoming":[],"outgoing":[]}` |
| `GET /v1/matchmaking` | — | snapshot strict `idle`, `queued` ou `matched` |
| `POST /v1/matchmaking` | JSON exact `{"activity":"trade"}` | `202` avec le snapshot de file ; `200` si déjà apparié |
| `DELETE /v1/matchmaking` | corps vide | `204`, annulation idempotente pour les deux membres d’un match |
| `GET /v1/coop-rendezvous` | — | `200`, snapshot strict du rendez-vous courant et des invitations reçues |
| `POST /v1/coop-rendezvous/random` | corps vide | `200`, entre dans la file durable ou retourne le rendez-vous apparié |
| `POST /v1/coop-rendezvous/invitations` | JSON exact `{"peerUserId":"bob"}` | `200`, crée ou rejoue l’offre ami courante |
| `POST /v1/coop-rendezvous/invitations/:sessionId/accept` | corps vide | `200`, accepte idempotemment l’offre reçue |
| `DELETE /v1/coop-rendezvous/invitations/:sessionId` | corps vide | `200`, refuse/annule idempotemment une offre en attente |
| `DELETE /v1/coop-rendezvous/current` | corps vide | `200`, libère le rendez-vous courant pour les deux participants |
| `POST /v1/friend-requests` | JSON exact `{"userId":"bob"}` | `201 {"ok":true}` |
| `POST /v1/friend-requests/:userId/accept` | corps vide | `200 {"ok":true}` |
| `POST /v1/friend-requests/:userId/decline` | corps vide | `200 {"ok":true}` |
| `DELETE /v1/friend-requests/:userId` | corps vide ; annule une demande sortante | `200 {"ok":true}` |
| `DELETE /v1/friends/:userId` | corps vide | `200 {"ok":true}` |
| `POST /v1/realtime-ticket` | corps vide | `201 {"ticket":"…","expiresInMs":30000}` |
| `GET /v1/objects/:objectId` | — | enveloppe opaque, `ETag`, `Opaque-Mutation` et `200` ; `404` si absente |
| `PUT /v1/objects/:objectId` | enveloppe opaque et précondition | corps vide, nouveaux `ETag` et `Opaque-Mutation`, `201` à la création ou `204` à la mise à jour |
| `DELETE /v1/objects/:objectId` | corps vide et `If-Match` | `204` |

Les erreurs HTTP suivent ce format sans exposer de trace interne :

```json
{
  "error": { "code": "BAD_REQUEST", "message": "…" },
  "requestId": "…"
}
```

Un identifiant ou mot de passe erroné renvoie toujours le même
`401 INVALID_CREDENTIALS`. Les tentatives de connexion/inscription sont limitées
globalement, par nom canonique et en concurrence afin de borner le coût mémoire
de scrypt. Les codes `403 ENTITLEMENT_REQUIRED` sont décidés par le serveur :
`online` protège le social, la mise en relation et les tickets temps réel ;
`cloud-storage` protège le coffre opaque. La lecture de `/v1/account` et la
déconnexion restent accessibles même sans droit premium.

Les corps sociaux JSON sont limités à 4 Kio. Le corps d’un objet opaque est
limité à 1,5 Mio. Les champs inconnus sont refusés. Un `objectId` est
obligatoirement une valeur base64url canonique de 128 bits, soit 22 caractères.

## Mise en relation aléatoire

`POST /v1/matchmaking` accepte exclusivement l’une des activités `trade`, `pvp`
ou `coop`, sans préférence, rang, score ou autre métadonnée libre. Une connexion
WebSocket active est obligatoire ; elle permet ensuite la négociation WebRTC,
mais les snapshots de file sont lus par HTTP. Une identité ne peut avoir qu’une
recherche ou qu’un match actif à la fois. Répéter le même `POST` est idempotent ;
changer d’activité sans annuler renvoie `409 CONFLICT`.

Les réponses exactes sont :

```json
{"status":"idle"}
```

```json
{"activity":"trade","expiresAt":1780000120000,"joinedAt":1780000000000,"status":"queued"}
```

```json
{"activity":"trade","expiresAt":1780000120250,"matchId":"AQEBAQEBAQEBAQEBAQEBAQ","negotiationId":"AgICAgICAgICAgICAgICAg","peerUserId":"bob","role":"offerer","status":"matched"}
```

Les files sont brassées toutes les 250 ms avec l’aléa cryptographique du
processus, puis appariées deux par deux. Le premier identifiant utilisateur dans
l’ordre lexical reçoit toujours le rôle `offerer`, l’autre `answerer`, ce qui
évite deux offres concurrentes. Les limites sont de 1 000 recherches et 500
matches actifs au total ; la limite HTTP de mutations s’applique aussi aux
entrées et annulations.

Le serveur génère `matchId` et `negotiationId` comme deux valeurs opaques et
distinctes de 128 bits. Pour deux inconnus, la passerelle n’accepte la
signalisation que si l’émetteur, le destinataire et ce `negotiationId`
correspondent encore au même match. L’autorisation disparaît pour les deux
participants à l’expiration, à l’annulation, au redémarrage ou quand la dernière
socket de l’un d’eux se déconnecte. Un remplacement atomique de la socket d’une
même identité conserve en revanche le match. Un ancien `negotiationId` n’est
plus accepté après suppression de son enregistrement ; chaque nouveau match en
reçoit un nouveau, et toute collision avec un identifiant encore actif est
refusée.

Le client peut sonder `GET /v1/matchmaking` toutes les 250 à 500 ms pendant la
recherche, puis arrêter dès `matched` ou `idle`. `DELETE /v1/matchmaking` est
idempotent et ramène immédiatement les deux participants à `idle`. Cette
suppression retire seulement l’autorisation de rendez-vous : un DataChannel déjà
établi reste une connexion directe gérée par les navigateurs.

### Pourquoi il n’y a pas encore de classement

Le serveur ne possède aucune donnée lui permettant de vérifier un résultat. Il
refuse donc volontairement tout score ou résultat envoyé par un client et
n’expose aucun classement. Deux déclarations concordantes ne suffiraient pas :
deux clients modifiés pourraient colluder. Un classement fiable nécessiterait
plus tard soit un arbitre serveur déterministe recevant un protocole générique
minimal et vérifiable, soit des preuves cryptographiques fondées sur une
exécution attestée. Tant qu’un tel contrat n’existe pas, seul l’appariement
aléatoire non classé est honnête.

## Coffre d’objets opaques

Le contrat du coffre est volontairement sans domaine métier. Une écriture exige
le type exact `application/vnd.opaque-vault.v1+json` et ce JSON exact, sans champ
supplémentaire :

```json
{
  "version": 1,
  "algorithm": "A256GCM",
  "iv": "<12-octets-base64url-sans-padding>",
  "ciphertext": "<chiffre-et-tag-base64url-sans-padding>"
}
```

Le navigateur doit chiffrer avant l’envoi et conserver la clé hors du serveur.
Il lui appartient aussi de produire un IV unique pour chaque chiffrement avec
la même clé. Le codec client exige en plus un contexte AES-GCM local et canonique
qui lie le protocole, l’identité générique et l’`objectId`; ce contexte n’est pas
envoyé au VPS. Le serveur vérifie seulement la forme canonique, la taille et les
préconditions ; il ne reçoit aucun nom de type, emplacement ou autre métadonnée
libre. Le contrat client peut placer dans le texte clair local la sauvegarde
complète, mais seulement après sa canonisation data-only : état fonctionnel,
références numériques et textes joueur attestés. Les ressources protégées et
les tables permettant de l’interpréter restent locales ; seul le ciphertext
atteint ce serveur.

Chaque `objectId` doit être généré aléatoirement par le client et reste isolé par
l’identité authentifiée. Un label lisible comme `primary` est donc refusé, et une
identité ne peut ni lire ni écraser l’objet homonyme d’une autre identité. La
limite fixe est de 64 objets et 8 Mio de chiffre par identité. Ce plafond couvre
les petits objets de plusieurs variantes clientes sans desserrer la borne en
octets. Un objet contient
au plus 1 Mio de charge utile chiffrée plus le tag GCM de 16 octets. L’enveloppe
ne déclare ni taille en clair, ni schéma, et le serveur applique uniquement sa
limite aux octets chiffrés.

La création exige `If-None-Match: *`. Une lecture renvoie un ETag fort opaque,
par exemple `"r-0123456789abcdef0123456789abcdef"`. Toute mise à jour et toute
suppression exigent ensuite cet ETag exact dans `If-Match`. Une révision périmée
renvoie `412 PRECONDITION_FAILED`, et l’absence de précondition renvoie
`428 PRECONDITION_REQUIRED`. Une suppression puis recréation produit une nouvelle
révision aléatoire, ce qui évite qu’un ancien ETag redevienne valide.

Chaque GET et PUT expose aussi `Opaque-Mutation: m-<32 chiffres hexadécimaux>`.
Cette valeur est une horloge hybride logique globale au stockage : elle est
persistée avant l'objet, avance même si l'horloge murale recule et survit à un
redémarrage. Les anciens enregistrements `storageVersion: 1` restent lisibles
avec la mutation zéro et migrent atomiquement au prochain PUT conditionnel.
L'horloge ne contient aucun type d'objet et demeure hors du ciphertext ; elle
sert uniquement à établir l'ordre causal avec l'ETag.

L’adaptateur fichier écrit dans un dossier par identité avec fichiers temporaires,
`fsync` et renommage atomique. Ses mutations sont sérialisées et ses quotas sont
recalculés sous le même verrou. Comme l’adaptateur social, il est destiné à une
seule instance ; un déploiement multi-instance devra fournir un nouvel
adaptateur implémentant le port `OpaqueObjectStore`.

Le service accepte au plus 16 requêtes d’objet simultanées, dont 4 pour une même
identité. Un dépassement échoue avec `429 RATE_LIMITED`; la capacité est toujours
libérée à la fin de la requête, y compris après une erreur.

## Rendez-vous Coop persistant

Coop n’utilise ni `RTCPeerConnection`, ni DataChannel. Le serveur est l’unique
point de rendez-vous et l’autorité de session. Les six routes dédiées renvoient
toutes `200` avec le même contrat :

```json
{"protocolVersion":1,"current":{"status":"idle"},"invitations":[]}
```

Une recherche expose `queued`. Une invitation ami expose `offered` uniquement
chez son hôte ; l’invité conserve `current:{"status":"idle"}` et reçoit une
entrée `{"sessionId":"…","fromUserId":"alice","intent":"coop","expiresAt":…}`
dans `invitations`. Après acceptation ou appariement aléatoire, les deux comptes
voient `ready` avec le même `sessionId`, le même `expiresAt`, leur `peerUserId`
et un rôle immuable `host`/`guest`. L’inviteur est l’hôte d’une invitation ; en
aléatoire, le plus petit identifiant canonique est l’hôte. Après création de la
session partagée, le rendez-vous devient `active`.

Un compte ne peut appartenir qu’à une file, offre ou session à la fois, y
compris comme destinataire d’une offre. La file et les états `offered`, `ready`
et `active` sont écrits atomiquement avant la réponse et restaurés après
redémarrage. Les POST sont idempotents pour une intention déjà courante ; les
DELETE le sont après disparition de leur cible. Une offre concurrente vers un
compte réservé reçoit `409 CONFLICT`.

## Sessions partagées autoritaires

Ce canal est indépendant de la signalisation P2P. Il conserve au plus deux
identités dans une session et produit un snapshot immuable avec `sessionId`,
`revision`, `players`, `sharedProgression` et `pendingEvents`. Chaque événement
en attente expose exactement `eventId`, sa `eventRevision` et les
`pendingPlayerIds` qui doivent encore l’acquitter. Le snapshot et toutes les
commandes emploient `protocolVersion: 2`. L’identité `playerId` vient toujours du Bearer
ou du ticket WebSocket ; un client ne peut jamais en fournir une autre.

Le créateur emploie le `sessionId` opaque attribué par le rendez-vous Coop et
nomme exactement l’autre identité :

```http
POST /v1/shared-sessions
Content-Type: application/json
Authorization: Bearer …

{"sessionId":"AgICAgICAgICAgICAgICAg","peerUserId":"bob","compatibility":{"applicationId":"IPKE","release":7,"locale":3},"player":{"displayName":"ALICE","gender":"female","position":{"mapId":1,"x":1,"z":1,"direction":"south"},"spriteId":97},"sharedProgression":{"milestoneIds":["field.schema.v1","field.branch.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],"counters":[{"id":"field.progression-revision","value":0}]}}
```

`sharedProgression` est optionnel et permet au propriétaire d’amorcer à la
révision zéro les jalons et compteurs issus de sa campagne existante. L’invité
ne peut jamais fournir ni remplacer ce seed lors de `join`.

La création exige un rendez-vous `ready` ou `active` dont l’identité appelante
est exactement le `host` et dont le pair est exactement l’invité. Une simple
amitié ou autorisation de match ne suffit plus en configuration publique. Le
commutateur `ALLOW_LEGACY_COOP_BOOTSTRAP`, désactivé par défaut même en LAN,
conserve temporairement cet ancien comportement uniquement pour un `sessionId`
absent du store de rendez-vous. Un identifiant de match Trade/PvP n’est jamais
accepté pour ce bootstrap. La
création renvoie `201 {"snapshot":…}`. Seule l’identité invitée peut ensuite appeler :

```http
POST /v1/shared-sessions/AgICAgICAgICAgICAgICAg/join
Content-Type: application/json
Authorization: Bearer …

{"compatibility":{"applicationId":"IPKE","release":7,"locale":3},"player":{"displayName":"BOB","gender":"male","position":{"mapId":1,"x":4,"z":1,"direction":"west"},"spriteId":0}}
```

Le serveur inspecte d’abord l’invitation sans ajouter ni persister le joueur.
Pour une première entrée, le créateur doit être connecté et attaché à cette
session sur le canal temps réel. Il reçoit :

```json
{"type":"join-admission-request","admissionId":"…","sessionId":"…","playerId":"bob","compatibility":{"applicationId":"IPKE","release":7,"locale":3},"player":{"displayName":"BOB","gender":"male","position":{"mapId":1,"x":4,"z":1,"direction":"west"},"spriteId":0},"snapshot":{"revision":0}}
```

Il répond avec l'enveloppe stricte `admission-response` et une décision
`{"kind":"accept"}` ou `{"kind":"reject","code":"player-declined"}`. Une
acceptation de join ne contient jamais `arrival`. Le join est alors revalidé et
persisté avant la réponse HTTP. Une seule admission peut être ouverte par
session; les commandes de room sont refusées pendant cette fenêtre de cinq
secondes. L'absence ou la déconnexion du créateur, le timeout et la fin de la
session annulent la requête sans modifier le snapshot. Seul un rejoin dont le
profil complet et la compatibilité sont strictement identiques à l'état serveur
peut être servi idempotemment sans nouvelle admission.

Une entrée réussie renvoie `200 {"snapshot":…}`. Les descripteurs de
compatibilité doivent être identiques et les positions initiales distinctes.
`GET /v1/shared-sessions/:sessionId` renvoie le même wrapper uniquement à un
membre. `DELETE /v1/shared-sessions/:sessionId/members/me` renvoie `204` : le
départ de l’invité incrémente la révision et libère sa place ; celui du créateur
détruit la session.

Le temps réel réutilise un ticket à usage unique obtenu par
`POST /v1/realtime-ticket`, puis ouvre
`/v1/shared-sessions/realtime?ticket=…` avec le sous-protocole exact
`authoritative-session.v1`. Les trames clientes sont strictement :

- `{"type":"attach","requestId":"…","sessionId":"…"}` ;
- `{"type":"request-snapshot","requestId":"…"}` ;
- `{"type":"command","requestId":"…","command":{…}}` ;
- `{"type":"admission-response","admissionId":"…","decision":{…}}` ;
- `{"type":"detach","requestId":"…"}`.

Le serveur répond par `ready`, `attached`, `snapshot`, `snapshot-response`,
`command-accepted`, `detached`, `session-ended` ou `error`. Un acquittement de
commande contient `requestId`, `appliedRevision`, `replayed` et le snapshot
courant. Chaque `requestId` encode 128 bits et n’est accepté qu’une fois sur la
connexion. Un `commandId` est, lui, idempotent par identité : rejouer exactement
la même commande rend son ancienne révision appliquée et le snapshot courant ;
réutiliser cet identifiant avec un contenu différent est refusé.

Une commande de déplacement contient `protocolVersion: 2`, `commandId`,
`expectedRevision`, `sequence`, `from`, `to`, et `mode` (`walk` ou `run`). Le
serveur vérifie l’origine autoritaire, la séquence suivante, un seul pas cardinal
sur la carte source et l’absence d’un autre membre sur la destination. Une
révision future est refusée ; une révision ancienne est tolérée pour permettre
deux déplacements concurrents lorsque l’origine et la séquence restent valides.

Le champ strict optionnel `arrival` représente la position finale après une
transition : `from -> to` doit toujours être un pas cardinal valide, `arrival`
doit différer de `to`, respecter les bornes et ne pas être occupé. Le snapshot
applique alors `arrival`. Sans données de topologie, le noyau générique ne peut
pas prouver seul que cette transition existe réellement : il refuse donc toute
`arrival` non attestée avec `transition-unattested`.

Sur le canal WebSocket, une telle commande crée au plus une admission en attente
par session. Le serveur envoie uniquement à la socket authentifiée du créateur :

```json
{"type":"admission-request","admissionId":"…","sessionId":"…","playerId":"bob","command":{"kind":"movement"},"snapshot":{"revision":12}}
```

Le créateur recalcule la transition depuis ses données locales puis répond sans
texte libre :

```json
{"type":"admission-response","admissionId":"…","decision":{"kind":"accept","arrival":{"mapId":2,"x":10,"z":10,"direction":"south"}}}
```

ou `{"kind":"reject","code":"transition-invalid"}`. Seule cette socket peut
répondre. L’admission expire après cinq secondes et est annulée si le demandeur,
le vérificateur ou la session disparaît. Le serveur exige une `arrival`
strictement identique, puis revalide la révision, la séquence, l’origine et les
deux destinations avant de commettre. Le port synchrone `movementAdmission` de
`SharedSessionService` reste une autre source d’attestation explicite pour un
déploiement disposant d’un validateur générique local.

Cette délégation empêche un invité de s’accorder lui-même une téléportation,
mais elle ne rend pas un créateur modifié digne de confiance : sans topologie
installée sur le serveur, le créateur reste l’arbitre de référence des transitions.
Cette limite est explicite et les pas ordinaires restent vérifiés
structurellement par le serveur.

La progression partagée utilise une transaction one-shot :

```json
{"protocolVersion":2,"commandId":"field-event:alice:1","expectedRevision":12,"kind":"shared-event","eventId":"field-event.1.IPKE.7.3.1.o.7.2bf","milestoneIds":["field.flag.0010"],"counters":[{"id":"field.progression-revision","expectedValue":0,"value":1},{"id":"field.variable.1234","expectedValue":null,"value":27}]}
```

`expectedRevision` doit ici être exactement la révision courante. Le serveur
ajoute automatiquement `eventId` au grow-only set des jalons, applique au plus
32 ajouts de jalons et 32 compteurs compare-and-set, puis crée l’entrée
`pendingEvents` pour tous les membres présents au commit. Les valeurs de
compteur sont bornées à ±1 milliard ; `expectedValue: null` signifie que le
compteur doit être absent. Une divergence échoue sans mutation. Une fois le
reçu `eventId` commis, aucun autre `commandId` ne peut le réappliquer, même
après acquittement ou redémarrage.

L’application de production branche en plus une policy terrain stricte sur le
port générique `sharedEventAdmission`. L’identifiant doit employer la forme
canonique
`field-event.1.<GAMECODE>.<version-base36>.<langue-base36>.<map-base36>.(o.<objet>|c.<x-zigzag>.<z-zigzag>).<script>`.
Le code, la version et la langue doivent être exactement ceux de la
compatibilité de session, et la carte doit être la carte courante de
l’émetteur. Une commande ne peut ajouter que des jalons `field.flag.XXXX` et
modifier que `field.progression-revision`, `field.flag.XXXX` ou
`field.variable.XXXX`; les variables temporaires `4000..400f` et `8000..800f`
sont refusées. La mutation de `field.progression-revision` est obligatoire,
compare exactement la valeur courante et l’incrémente de un. Cette policy ne
tente pas de prouver que la carte, l’objet, les coordonnées ou le script
existent dans le contenu du jeu. `SharedSessionService` reste indépendant de
cette policy et ses intégrateurs peuvent injecter une autre admission.

Chaque membre retire ensuite sa propre attente avec :

```json
{"protocolVersion":2,"commandId":"event-ack:bob:field:1","expectedRevision":13,"kind":"event-ack","eventId":"field-event.1.IPKE.7.3.1.o.7.2bf","eventRevision":13}
```

La révision d’événement doit correspondre à celle publiée dans
`pendingEvents`. L’entrée disparaît seulement après le dernier acquittement ;
un membre reconnecté sait donc sans déduction quel événement et quelle révision
il doit encore traiter. Un départ retire ce membre des audiences restantes.
Les limites sont de 128 événements simultanément en attente, 512 jalons et 256
compteurs par session.

Les sessions sont indexées en mémoire pendant l’exécution et leur état générique
minimal est commis dans `SHARED_SESSION_STORE_PATH` avant chaque réponse de
mutation ou acquittement WebSocket. Le fichier ne contient que compatibilité,
profils, positions, révision, membres, progression générique, audiences
d’événements, dernière activité et cache borné des commandes appliquées ; aucun
payload libre n’y est accepté. L’écriture
emploie un fichier temporaire, `fsync`, un renommage atomique puis `fsync` du
dossier. Une corruption, un champ inconnu, un fichier symbolique ou une forme
hors limites fait échouer le démarrage au lieu de restaurer un état partiel.

Une socket fermée marque son membre `away`; une nouvelle attache le réactive.
Après redémarrage, tous les membres sont restaurés `away`, sans prolonger leur
`lastActivityAt`, puis peuvent se rattacher et continuer avec les mêmes positions,
identifiants de commandes, progression et audiences non acquittées. L’arrêt du
processus ferme seulement le transport :
il n’émet pas de faux `session-ended`. Quand plus aucune socket n’est attachée,
la session expire après `SHARED_SESSION_IDLE_TTL_MS`; sa suppression est elle
aussi durable avant l’événement `idle-timeout`. Les limites sont de 1 024
   sessions au total et quatre appartenances par identité. Le store V3 conserve
   aussi des têtes de continuité génériques (`policyId`, identifiant, propriétaire,
   révision et empreinte canonique). Une tête ne peut louer qu’une salle active ;
   le départ du propriétaire ou l’expiration libère cette location sans supprimer
   la tête. Une reprise doit présenter exactement la même révision et la même
   empreinte, ce qui bloque durablement une branche obsolète, future ou divergente.
   La policy terrain qui extrait ces claims est injectée par l’application ; une
   session sans claim reste entièrement générique.

   La migration V1/V2 est effectuée avec cette même policy avant la première
   écriture V3. Une branche unique devient une tête louée. Des doublons identiques
   sont fermés et laissent une tête inactive afin de forcer une reprise propre ;
   des doublons divergents font échouer le démarrage. Un store V1 n’est migré que
   si sa liste d’événements héritée est vide ; un ancien événement sans
   révision/audience est rejeté plutôt que deviné.
Le coffre chiffré reste la sauvegarde complète du joueur ; ce fichier d’autorité
conserve le snapshot générique nécessaire à la reprise de la session en cours.
Ce journal ne contient aucune règle propre à une ROM et ne rend pas, à lui seul,
les scripts ou les combats partagés.

## WebSocket et WebRTC

Un navigateur ne peut pas ajouter un en-tête Bearer à l’ouverture d’un WebSocket. Le flux sûr est donc :

1. appeler `POST /v1/realtime-ticket` avec le Bearer ;
2. ouvrir immédiatement `wss://api.example/v1/realtime?ticket=<ticket>` ;
3. demander le sous-protocole exact `social-signaling.v1`.

Le ticket contient 32 octets aléatoires, expire rapidement, est stocké en mémoire sous forme d’empreinte et ne fonctionne qu’une fois. Il est lié à l’origine qui l’a demandé ; le serveur vérifie de nouveau cet en-tête `Origin` lors de l’upgrade.

Premier message serveur :

```json
{"type":"ready","version":1,"userId":"alice","onlineFriends":["bob"]}
```

Seul le message client suivant est accepté :

```json
{
  "type": "signal",
  "requestId": "AQEBAQEBAQEBAQEBAQEBAQ",
  "negotiationId": "AgICAgICAgICAgICAgICAg",
  "to": "bob",
  "payload": { "type": "offer", "sdp": "…" }
}
```

Variantes strictes de `payload` :

- `{"type":"offer","sdp":"…"}` ;
- `{"type":"answer","sdp":"…"}` ;
- `{"type":"ice","candidate":"…","sdpMid":"0","sdpMLineIndex":0,"usernameFragment":"…"}` ;
- `{"type":"hangup"}`.

`hangup` n'accepte aucun texte libre : le motif détaillé reste local au client,
afin que ce petit message de contrôle ne puisse pas devenir un relais de donnée
applicative vers le VPS.

Le serveur vérifie au moment de chaque message soit l’amitié, soit le match
éphémère exact lié au `negotiationId`. Il exige aussi que le destinataire soit
en ligne, ajoute lui-même le champ `from`, puis envoie :

```json
{"type":"signal","requestId":"AQEBAQEBAQEBAQEBAQEBAQ","negotiationId":"AgICAgICAgICAgICAgICAg","from":"alice","payload":{"type":"offer","sdp":"…"}}
```

L’émetteur reçoit `{"type":"signal-accepted","requestId":"AQEBAQEBAQEBAQEBAQEBAQ"}`. Les autres événements sont :

- `{"type":"presence","userId":"bob","online":true}` ;
- `{"type":"social-changed"}` : le client recharge alors `GET /v1/social` ;
- `{"type":"error","code":"FORBIDDEN","message":"…","requestId":"…"}`.

`requestId` et `negotiationId` encodent chacun 128 bits aléatoires en base64url
canonique, sans préfixe ni libellé applicatif. `negotiationId` est partagé par
les deux pairs pour une négociation : il permet au client d’ignorer sans
ambiguïté une réponse tardive provenant d’une ancienne connexion. Le serveur
les valide et les relaie sans leur attribuer de sens applicatif.

Après une transmission acceptée, le serveur conserve temporairement le
`requestId` dans une fenêtre de rejeu en mémoire. Une seconde utilisation par
la même identité reçoit une erreur `CONFLICT` et n'est pas retransmise, y compris après
le remplacement de sa connexion WebSocket. La fenêtre expire après cinq minutes
et reste bornée à 4 096 identifiants par identité et 65 536 au total ; elle ne
remplace donc pas la déduplication de bout en bout du protocole P2P.

Les SDP et candidats ICE transitent donc brièvement par le processus de
signalisation et peuvent contenir des métadonnées réseau. Ils ne sont ni écrits
dans le fichier social, ni inclus dans les logs applicatifs. Les commandes et
snapshots structurés utilisent exclusivement le canal de session dédié décrit
plus haut, jamais `social-signaling.v1`. Le coffre HTTP distinct ne transporte
que les enveloppes opaques décrites ci-dessus.

Une identité possède une seule connexion de signalisation active : une nouvelle connexion remplace proprement l’ancienne afin qu’une offre WebRTC n’atteigne jamais plusieurs onglets concurrents. Une session accepte au maximum 120 messages toutes les 10 secondes. Un message est limité à 32 Kio, un SDP à 24 Kio et un candidat ICE à 2 Kio. Les enveloppes SDP et ICE sont contrôlées avant transmission. Les messages binaires sont fermés avec le code WebSocket `1003`. Le serveur émet aussi un ping WebSocket périodique et ferme les connexions qui ne répondent plus.

## Publication de l’image serveur

Le workflow séparé `.github/workflows/publish-server-image.yml` se déclenche
uniquement manuellement. Il valide le projet puis construit avec le contexte
`server/` et publie dans GHCR :

- `ghcr.io/<compte>/<depot>-server:main` ;
- `ghcr.io/<compte>/<depot>-server:sha-<sha-git-complet>`.

Toutes les actions sont épinglées par SHA. Le job possède seulement
`contents: read` et `packages: write`, et l’image n’embarque ni `.env`, ni données,
ni tests, ni client. Le workflow ne contient aucune étape SSH ou Hostinger :
**publier une image ne la déploie donc jamais automatiquement sur le VPS.** Pour
une mise en production reproductible, préférer le tag `sha-…` ou, mieux, le
digest `@sha256:…` affiché par GHCR au tag mobile `main`.

Le job n’accepte que la branche `main` marquée protégée par GitHub et utilise
l’environnement `release-ghcr`. Cet environnement doit imposer les reviewers et
la branche autorisée avant la première exécution.

## Déploiement Docker sur VPS

Les fichiers Compose répondent à des usages distincts et peuvent recevoir un
overlay d’exposition :

| Fichier | Usage |
|---|---|
| `compose.yaml` | Construction locale depuis le seul dossier `server/`. |
| `compose.vps.yaml` | Téléchargement d’une image GHCR déjà construite ; aucun clone de `web/` n’est nécessaire. |
| `compose.tunnel.yaml` | Overlay facultatif Cloudflare Tunnel ; il ajoute uniquement `cloudflared` au serveur. |

Sur le VPS, copier seulement `compose.vps.yaml` et `.env.example`, renommer ce
dernier en `.env`, compléter les secrets puis ajouter l’image publiée :

```text
SERVER_IMAGE=ghcr.io/compte/depot-server:sha-<sha-git-complet>
```

Si le paquet GHCR est privé, exécuter une fois `docker login ghcr.io` avec un
jeton limité à `read:packages` (jamais dans `.env` ou dans Git). Lancer ensuite :

```bash
docker compose -f compose.vps.yaml pull
docker compose -f compose.vps.yaml up -d
```

Le Compose conserve les données dans un volume, retire toutes les capabilities,
rend le système de fichiers du conteneur immuable et publie uniquement sur la
boucle locale. `PORT` pilote à la fois l’écoute du processus et les deux côtés
du mapping Docker : sa valeur ne peut donc plus diverger du port publié. Le port
par défaut est `8787` ; si vous le changez, adaptez aussi la cible du proxy.

La construction depuis une copie autonome du dossier `server/` reste possible :

```bash
docker compose up -d --build
```

### Choisir exactement un mode d’exposition HTTPS/WSS

Hostinger documente officiellement son [modèle VPS Docker](https://www.hostinger.com/support/8306612-how-to-use-the-docker-vps-template-at-hostinger/), la [mise en place de Nginx Proxy Manager](https://www.hostinger.com/support/how-to-set-up-nginx-proxy-manager-using-hostinger-docker-manager/) et le [pare-feu VPS](https://www.hostinger.com/support/4805502-how-to-set-up-a-firewall-at-vps/). Dans les deux topologies Nginx ci-dessous, ouvrir publiquement `80/tcp` et `443/tcp`, restreindre SSH, et garder `8787` (ou la valeur de `PORT`) fermé dans le pare-feu Hostinger. Le mode Cloudflare Tunnel établit au contraire une connexion sortante et ne demande pas d’ouvrir ces ports pour le service.

**Cloudflare Tunnel, serveur uniquement.** Créer un tunnel nommé géré à distance,
lui associer un nom public stable comme `online.example.com`, puis configurer son
service d’ingress vers `http://social-signaling:8787` (`PORT` doit remplacer
`8787` s’il a été modifié). Placer son jeton dans le `.env` privé du dossier
`server/` : il ne doit jamais entrer dans le client, Git ou une variable Vite.
Les paramètres Docker officiels sont décrits dans la
[documentation Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/setup/)
et Cloudflare confirme la [prise en charge de WebSocket](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/#does-cloudflare-tunnel-support-websockets).

Depuis une copie locale autonome de `server/` :

```bash
docker compose -f compose.yaml -f compose.tunnel.yaml up -d --build
```

Depuis le VPS avec l’image GHCR :

```bash
docker compose -f compose.vps.yaml -f compose.tunnel.yaml up -d
```

Cet overlay ne construit, ne sert et ne tunnelise aucun client : seuls
`social-signaling` et `cloudflared` partagent le réseau Docker. Le client peut
rester sur sa propre machine, par exemple sur `http://localhost:5173`, et pointer
vers le serveur public avec son `.env.local` :

```text
POKEMASTER_PUBLIC_ONLINE_SERVER_URL=https://online.example.com
```

Le client dérive alors `wss://online.example.com` pour la signalisation ; aucun
tunnel côté client n’est requis. Utiliser un nom de tunnel stable : l’origine du
serveur reste volontairement explicite dans le build et sa CSP. Un Quick Tunnel
à nom aléatoire obligerait donc à relancer le client de développement ou à
reconstruire la release à chaque changement.

Le tunnel transporte les requêtes REST et la signalisation WSS, pas le DataChannel
WebRTC établi entre les navigateurs. Il ne remplace ni STUN ni TURN ; sans relais
TURN, certains NAT ou pare-feux stricts peuvent encore empêcher la connexion P2P.
Le client accepte une liste ICE publique optionnelle via
`POKEMASTER_PUBLIC_RTC_ICE_SERVERS`, documentée dans [`web/README.md`](../web/README.md).

**Nginx installé sur l’hôte.** Nginx possède les ports `80/443` et relaie vers
`http://127.0.0.1:8787`. Utiliser `compose.vps.yaml` seul. Les directives
`map`/`limit_*_zone` suivantes vont une seule fois dans le contexte `http {}` ;
le bloc `location` va dans le serveur TLS du domaine :

```nginx
# À déclarer une fois dans le bloc http {} de Nginx.
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
limit_req_zone $binary_remote_addr zone=social_api:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=social_connections:10m;

location / {
    limit_req zone=social_api burst=20 nodelay;
    limit_conn social_connections 20;
    client_max_body_size 1536k;
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_connect_timeout 5s;
    proxy_send_timeout 20s;
    proxy_read_timeout 75s;
}
```

**Nginx Proxy Manager dans Docker.** Ne lancez pas en parallèle un Nginx hôte
sur `80/443`. Le `127.0.0.1` vu depuis le conteneur NPM désigne NPM lui-même :
il ne faut donc jamais utiliser cette adresse comme « Forward Hostname ». Relever
le réseau Docker existant de NPM, inscrire son nom dans `.env`, puis joindre le
service à ce réseau avec l’overlay fourni :

```text
NPM_NETWORK=nom_reel_du_reseau_npm
```

```bash
docker network ls
docker compose -f compose.vps.yaml -f compose.npm.yaml up -d
```

Dans l’interface NPM, créer un Proxy Host avec le domaine public, le schéma
`http`, le Forward Hostname `social-signaling`, le Forward Port `8787` (ou
`PORT`), activer Websockets, puis demander le certificat et forcer HTTPS. Ajouter
`client_max_body_size 1536k;` dans la configuration avancée de ce Proxy Host afin
que Nginx n’arrête pas les enveloppes avant la limite applicative. Les
zones `limit_req_zone` sont des directives de contexte `http` : ne pas coller le
bloc Nginx hôte tel quel dans le champ Advanced d’un Proxy Host. Si des limites
globales supplémentaires sont voulues dans NPM, les installer via ses includes
globaux persistants et revalider sa configuration ; les limites applicatives du
service restent actives dans tous les cas.

Les fichiers Compose ne modifient ni DNS, ni certificat, ni pare-feu, ni
configuration Hostinger/NPM. Ces actions restent des opérations explicites de
l’administrateur.

Conserver des sauvegardes du volume. Pour les sessions partagées, sauvegarder
ensemble `shared-sessions.json`, `shared-sessions.json.journal` et l’éventuel
`shared-sessions.json.journal.checkpoint`, ou arrêter proprement le service avant
la copie afin que `close()` compacte et synchronise le checkpoint. Restaurer un
fichier isolé d’un autre instant briserait volontairement la chaîne de condensats
et le démarrage échouerait plutôt que d’accepter un état incomplet. Chaque entrée
du WAL est ajoutée puis synchronisée sur disque avant acquittement ; les checkpoints
sont synchronisés puis renommés atomiquement. Les adaptateurs sont conçus pour
**une seule instance** du serveur. Plusieurs processus nécessiteront des
adaptateurs de base de données implémentant les ports `AccountStore`,
`FriendStore`, `CoopRendezvousStore`, `SharedSessionStore` et `OpaqueObjectStore`.

## Sécurité et limites actuelles

- HTTPS/WSS est obligatoire en production et doit être terminé par le reverse proxy ou le tunnel côté serveur.
- Les mots de passe et sessions ne doivent jamais apparaître dans Git, dans une URL, dans les logs ou dans un bundle statique.
- La session Bearer est générée par le serveur après connexion ; elle n’est jamais un parcours de saisie utilisateur.
- Les tickets et la présence sont volontairement en mémoire et disparaissent au redémarrage.
- Les sessions partagées actives sont restaurées depuis `SHARED_SESSION_STORE_PATH`; elles expirent durablement après leur TTL lorsqu’aucune socket n’est attachée.
- Les files, matches et autorisations de signalisation aléatoire sont uniquement en mémoire et disparaissent au redémarrage.
- Le serveur ne peut pas déchiffrer un objet si le joueur perd à la fois son mot
  de passe et toutes les copies locales de sa clé de chiffrement. Le
  `vaultKeyId` évite en revanche qu’un simple changement d’URL, de port ou
  d’appareil rende la clé impossible à redériver.
- Le chiffrement empêche le serveur de classifier le contenu ; la restriction sur ce qui peut être chiffré reste donc un contrat et un contrôle côté client.
- Les limites de débit sont locales au processus ; ajouter aussi des limites au reverse proxy.
- L’inscription est publique. La récupération de mot de passe, la modération et l’administration distante ne sont pas encore implémentées.
- La promotion admin est exclusivement une opération locale hors ligne sur le VPS ; arrêter le serveur évite toute écriture concurrente du fichier de comptes.
- Le fournisseur d’entitlements Patreon est volontairement inactif. Ne passer la politique à `patreon` qu’après avoir branché et testé sa source serveur authentifiée.
- Le service n’implémente pas lui-même de relais TURN. Le client peut employer un service STUN/TURN externe configuré explicitement ; sans relais, deux pairs derrière certains NAT stricts peuvent ne pas réussir à établir une connexion directe. TURN améliore la connectivité, mais fait transiter les paquets chiffrés par cette infrastructure intermédiaire.
- Le chiffrement WebRTC ne remplace pas l’authentification de pair : un code de vérification court ou une empreinte comparée hors bande devra être ajouté si un VPS de signalisation compromis fait partie du modèle de menace.
- La persistance fichier est adaptée à une petite communauté et à une instance unique, pas à un cluster.
