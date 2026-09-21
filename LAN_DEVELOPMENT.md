# Réseau de jeu privé avant publication

Tant que PokeMaster n’est pas public, le parcours de référence est un vrai
serveur persistant sur la machine de développement et des clients jouables sur
tout le réseau local. Un seul lancement prépare TLS, démarre les trois processus
et leur donne la même identité canonique pour le coffre chiffré.

## Lancer le réseau

Prérequis : Node/npm installés dans `web/` et `server/`, OpenSSL disponible, et
la machine hôte connectée au même Wi-Fi ou Ethernet que les appareils de jeu.

```bash
cd web
npm run dev:lan
```

Le lanceur détecte l’IPv4 privée de la route par défaut et préfère le
`LocalHostName` Bonjour/mDNS stable de la machine, par exemple
`macbook-air-de-exhibition.local`. Il crée dans `web/.lan/` :

- une CA locale publique à installer sur les appareils ;
- la clé privée de cette CA, qui ne doit jamais quitter la machine ;
- un certificat serveur couvrant le nom mDNS, l’IPv4 privée, `localhost` et
  `127.0.0.1`.

Ces fichiers sont ignorés par Git. La CA est réutilisée ; seul le certificat
serveur est renouvelé lorsque l’adresse ou les SAN changent.

Le terminal affiche ensuite les chemins et URL exacts. L’architecture active
est la suivante :

| Service | Adresse | Rôle |
|---|---|---|
| Serveur privé | `127.0.0.1:8787` | Comptes, amis, matchmaking, sessions partagées autoritaires et coffre dans `server/data/` |
| Client principal | `http://localhost:5173` | Conserve l’origine et le stockage navigateur déjà utilisés sur la machine hôte ; proxy `/v1` sans certificat local à approuver |
| Client réseau | `https://<machine>.local:5174` | Façade TLS jouable depuis les autres appareils ; proxy `/v1` et WebSocket vers le serveur |
| Installation | `http://<IPv4>:5175` | Sert uniquement la CA publique, son empreinte et un lien vers le jeu HTTPS ; aucune API, ressource du jeu ou WebSocket |

Chaque client utilise l’origine qu’il a réellement ouverte comme transport :
`localhost` sur la machine hôte, le nom mDNS sur les appareils qui le résolvent,
ou l’IPv4 HTTPS de secours. Aucun tunnel côté client ni accès direct au port
`8787` n’est nécessaire. Une identité logique HTTPS, distincte du transport,
reste identique partout pour les sessions, les caches et la dérivation des clés
du coffre. La machine hôte garde ainsi sa sauvegarde navigateur historique sur
`localhost:5173` tout en partageant le même compte et le même coffre que les
téléphones, tablettes ou autres ordinateurs.

`Ctrl+C` arrête ensemble le portail d’installation, le serveur et les deux
clients. Les comptes, relations et objets chiffrés restent dans `server/data/`
au prochain lancement.

### Lancer depuis VS Code sur macOS ou Windows

Dans **Run and Debug**, sélectionner **Start complet debug (LAN)** puis lancer
avec `F5`. Cette configuration versionnée :

1. construit séquentiellement le serveur puis le client statique ;
2. démarre l’unique serveur persistant et les façades locale et réseau ;
3. affiche dans le terminal intégré les URL cliquables pour cette machine, les
  autres appareils et le portail d’installation ;
4. attache le débogueur Node aux processus enfants ;
5. arrête toute la pile avec le bouton **Stop** de VS Code.

Il ne faut lancer cette configuration qu’une fois sur la machine hôte. Autant
de consoles, téléphones, ordinateurs ou fenêtres de navigateur que nécessaire
peuvent ensuite ouvrir l’URL **Tous les autres appareils** affichée dans ce même
terminal. Chaque appareil doit être sur le même réseau privé et avoir approuvé
la CA comme indiqué ci-dessous.

Les mêmes prérequis s’appliquent sur macOS et Windows : versions Node/npm du
projet, dépendances installées dans `web/` et `server/`, OpenSSL disponible dans
le `PATH`, et autorisation du pare-feu pour Node sur le réseau privé. Si un
ancien backend occupe déjà le port `8787`, l’arrêter avant `F5` ; le lanceur
refuse volontairement de remplacer une instance existante.

### Relance automatique macOS après redémarrage

Sur la machine serveur macOS, un LaunchAgent utilisateur peut maintenir cette
même pile disponible après un redémarrage, dès l’ouverture de la session. Sa
définition emploie les chemins absolus du dépôt et de l’exécutable Node courant,
ne contient aucune variable d’environnement, clé TLS, credential ou secret, et
écrit ses journaux dans `web/.lan/logs/`.

Arrêter d’abord toute instance `npm run dev:lan` ouverte dans un terminal. Puis :

```bash
cd web
npm run lan:service:install
npm run lan:service:start
```

`install` écrit atomiquement
`Library/LaunchAgents/com.pokemaster.private-lan.plist` sous le dossier retourné
par macOS pour l’utilisateur courant, mais ne le charge jamais. Seule la commande
`start` appelle `launchctl`. Les autres opérations explicites sont :

```bash
npm run lan:service:status
npm run lan:service:stop
npm run lan:service:uninstall
```

`stop` décharge le job tout en conservant son plist. `uninstall` décharge le job
puis supprime seulement ce plist ; certificats, journaux et `server/data/`
restent intacts. Après un déplacement du dépôt ou un changement de version Node,
exécuter `stop`, puis `install` et `start` afin de renouveler les chemins absolus.

Le LaunchAgent utilise `RunAtLoad`, `KeepAlive` et un délai de relance de 30 s.
Une fois tous les services prêts, le lanceur vérifie toutes les cinq secondes le
contrat exact `200 {"status":"ok"}` du backend et de la façade, ainsi que le
statut `200` des deux clients et du portail. Trois rondes consécutives en échec
provoquent un arrêt groupé avec code d’erreur ; `launchd` peut alors redémarrer
proprement toute la pile. Une coupure brève causée par le watcher de développement
ne suffit pas à déclencher cette relance.

Pour préparer seulement la CA sans toucher aux processus déjà lancés :

```bash
npm run dev:lan -- --prepare-only
```

## Installer la CA publique

Depuis l’appareil à connecter, ouvrir d’abord le **portail d’installation HTTP**
affiché dans le terminal, par exemple `http://192.168.0.109:5175`. Il permet de
télécharger la CA puis d’ouvrir l’adresse HTTPS du jeu. Ce petit portail n’est
pas une version HTTP du jeu : il ne sert que deux ressources statiques, ne
proxifie jamais `/v1` et refuse les WebSockets.

Avant d’installer la CA, comparer son empreinte SHA-256 à celle affichée dans le
terminal de la machine hôte. Une page HTTP ne peut pas authentifier elle-même le
fichier téléchargé : si les empreintes diffèrent, ne pas l’installer. Un transfert
direct et déjà fiable du fichier reste possible comme ci-dessous.

Copier uniquement le fichier `web/.lan/pokemaster-lan-ca.crt` indiqué dans le
terminal. Ne jamais copier `pokemaster-lan-ca-key.pem` ni un autre fichier
`*-key.pem`.

Cette étape est manuelle sur **chaque appareil réseau** avant sa première
connexion. Le lanceur ne modifie jamais la confiance système. Elle n’est pas
requise pour `http://localhost:5173` sur la machine hôte.

- macOS : ouvrir le `.crt`, l’ajouter au trousseau puis lui accorder la
  confiance TLS.
- iPhone/iPad : installer le profil reçu, puis activer sa confiance dans
  **Réglages > Général > Informations > Réglages des certificats**.
- Android : installer le certificat CA depuis les réglages de sécurité. Le
  navigateur utilisé doit accepter les CA utilisateur.
- Windows : importer le `.crt` dans **Autorités de certification racines de
  confiance** pour l’utilisateur courant.
- Console ou WebView : l’appareil doit permettre l’installation et la confiance
  d’une CA utilisateur. Si son navigateur l’interdit, ce mode LAN privé ne peut
  pas offrir un accès sûr sur cet appareil. Il faudra un nom de domaine possédé
  et un certificat reconnu publiquement (par exemple ACME avec validation DNS)
  avant de revendiquer sa compatibilité ; un simple HTTP LAN n’est pas un repli.

Après installation, ouvrir l’URL mDNS HTTPS affichée, créer ou connecter le
compte, puis choisir la campagne depuis le sas de sauvegardes.

## Stabilité du coffre entre appareils

Le nom mDNS affiché est volontairement l’identité logique canonique :
contrairement à une adresse attribuée par DHCP, il reste normalement stable. Le
certificat contient aussi l’IPv4 et le terminal l’affiche comme secours réseau.
Ouvrir cette adresse de secours utilise bien le transport IP, mais conserve
l’identité mDNS en interne : cela ne crée donc plus un autre cache ni un autre
espace cryptographique local pour le coffre.

Si aucun nom mDNS stable n’est détecté au lancement, l’identité canonique
bascule explicitement sur l’IPv4. Il faut alors réserver cette adresse dans le
DHCP du routeur : un changement ultérieur d’identité canonique créerait un autre
espace local. Un nom mDNS fourni par le réseau peut être forcé ainsi :

```bash
POKEMASTER_LAN_HOSTNAME=pokemaster.local npm run dev:lan
```

Ce nom doit résoudre vers la machine hôte depuis tous les appareils.

## Dépannage

- Un port occupé (`5173`, `5174`, `5175` ou `8787`) arrête le lancement avant toute
  mutation de processus. Fermer l’ancien serveur volontairement puis relancer.
- Si le LaunchAgent boucle après son activation, vérifier avec
  `npm run lan:service:status` qu’une ancienne instance manuelle n’occupe pas déjà
  les ports, puis consulter `web/.lan/logs/launch-agent-error.log`.
- Si le navigateur signale encore un certificat invalide, vérifier que la CA
  publique — et non le certificat serveur — est installée et approuvée.
- Autoriser Node dans le pare-feu uniquement sur le réseau privé. Le backend
  brut reste lié à la boucle locale ; la façade de jeu HTTPS `5174` et le portail
  statique d’installation `5175` sont les seuls ports qui écoutent le LAN.
- Si le nom `.local` ne répond pas sur un appareil, vérifier que Bonjour/mDNS et
  l’isolation Wi-Fi entre clients ne sont pas bloqués par le routeur.

Ce mode est strictement réservé au développement privé. La publication gardera
une URL HTTPS publique et un certificat émis pour le domaine officiel.
