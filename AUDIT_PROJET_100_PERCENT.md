# Audit de finition du projet

Date de référence : 9 septembre 2026.

## Verdict

PokeMaster possède déjà un socle technique très avancé, mais le produit n’est
pas terminé à 100 %. Les tests unitaires et les audits de scripts prouvent de
nombreux composants isolés ; ils ne prouvent pas encore qu’un joueur peut
parcourir sans blocage toute la campagne, l’après-jeu et chaque activité
annoncée avec les entrées réelles du navigateur.

La mesure honnête n’est donc pas un pourcentage arbitraire. Le projet sera
« fini » lorsque tous les critères d’acceptation ci-dessous seront verts et
reproductibles sur un build de production.

## Définition de « fini à 100 % »

1. Une partie neuve peut aller jusqu’au Panthéon, parcourir Kanto, vaincre Red
   et reprendre l’après-jeu, sans commande DEV ni modification manuelle de la
   sauvegarde.
2. Chaque système accessible dans la ROM supportée est soit jouable et testé,
   soit explicitement exclu du périmètre produit. Aucun écran ne promet une
   activité seulement simulée par des données ou un placeholder.
3. Les règles de combat, de capture, de progression, de monde et de scripts
   utilisées par ces parcours sont vérifiées contre la ROM locale.
4. Sauvegarde, restauration, export/import, mode hors ligne et synchronisation
   cloud résistent aux coupures, corruptions, conflits et changements de compte.
5. Le périmètre multijoueur annoncé fonctionne de bout en bout sur deux vrais
   navigateurs et après redémarrage du serveur.
6. Le client et le serveur passent leurs gates statiques, tests, builds,
   contrôles de dépendances et tests de déploiement depuis un clone propre.
7. Accessibilité, compatibilité navigateur, performances et exploitation sont
   vérifiées sur les matrices cibles documentées.
8. La licence du code, l’usage des marques et la politique sur les données
   dérivées de la ROM ont reçu une décision juridique explicite avant toute
   publication publique.

## État vérifié

| Domaine | État | Preuve ou limite principale |
| --- | --- | --- |
| Lecture ROM et frontière data-only | Avancé | Décodage local, garde-fous de dépôt et séparation serveur/client automatisés. |
| Scripts de terrain | Avancé | 3 657 entrées et 10 971 chemins abstraits audités sans opcode bloquant dans le rapport courant ; cette simulation ne remplace pas un parcours joueur complet. |
| Parcours joueur automatisé | Partiel | Le parcours continu certifié s’arrête au Badge Brume : 4 badges, avec une exécution headless ROM et une campagne Chrome réelle depuis une nouvelle partie. |
| Monde et rendu | Avancé mais incomplet | 519 cartes et leurs audits de géométrie/warps sont certifiés ; les parcours complets et appareils réels restent à certifier. |
| Combats | Avancé mais incomplet | Moteurs simple/double, effets, capture, progression et nombreuses animations existent ; la parité complète reste listée dans `AUDIT_COMBATS_100_PERCENT.md`. |
| Sauvegardes | Avancé | Trois slots, migrations data-only, autosave, cloud chiffré et désormais backup JSON local strict ; tests de panne navigateur réels encore nécessaires. |
| Multijoueur | Partiel | Social, échange et première tranche Coop existent ; PvP est encore masqué et les combats/événements combinés Coop ne sont pas raccordés. |
| Serveur | Avancé pour une instance | Authentification, amis, rendez-vous, coffre et sessions WSS ; exploitation publique et montée en charge restent incomplètes. |
| UI et contrôles | Avancé | Clavier, manette, tactile et réduction des animations sont largement traités ; audit lecteur d’écran/contraste/appareils à terminer. |
| Navigateur réel | Partiel | Le scénario Chrome continu sur ROM réelle atteint désormais Mortimer et le Badge Brume après le Carapuce à O, Simularbre, le rival et les fauves de la Tour Cendrée ; rien après le quatrième badge ni la matrice multinavigateur n’est encore certifié. |
| Livraison | Bloquée en l’état | Le dernier snapshot candidat propre est reproductible et intégralement vert, mais `HEAD` ne le contient toujours pas : l’arbre réel compte 1 359 chemins modifiés/supprimés/non suivis, dont 1 032 sources client/serveur non suivies. |

Le runner ROM révisé a exécuté 59/59 gates : 48/48 probes
standard, 4/4 parcours, les gates follower/arènes/objets/UI, l’audit du monde,
l’inventaire des capacités et 8/8 shards de scripts. Le rapport de révision 9
ne contient aucun gate rouge, aucun opcode non pris en charge dans les chemins
visités et certifie les 10 971 chemins. Cette preuve est forte sur le décodage
et les simulations couvertes ; elle ne change pas la limite du parcours joueur
continu indiquée ci-dessus.

Le dernier snapshot candidat matérialisé avant l’extension Badge Plaine l’a été
dans un dépôt Git jetable propre
de 1 560 fichiers suivis, sans ROM ni donnée runtime, puis reconstruit avec deux
`npm ci` neufs. Côté client, 620 fichiers et 4 388 tests réussissent, avec 56
fichiers et 111 tests conditionnels ignorés ; TypeScript, lint, les frontières
de 1 363 sources, le build et sa vérification séparée sont verts. Côté serveur,
les 156 tests, le typecheck et le build réussissent. Les deux audits npm
signalent zéro vulnérabilité. Le runner ROM complet a ensuite réussi ses 59
gates sur ce même dépôt, et le gate de reproductibilité est resté vert après
les tests.

Après l’extension Badge Brume, la passe directe dans l’espace de travail
réussit 623 fichiers et 4 408 tests, avec 56 fichiers et 111 tests conditionnels
ignorés ; TypeScript, lint, les frontières de 1 368 sources et le build sont
verts. Le parcours ROM headless ciblé passe en 18,80 secondes et la campagne
Chrome réelle en 1 284,688 secondes. Ces résultats actualisent la preuve
fonctionnelle, mais une nouvelle matérialisation propre reste nécessaire avant
release à cause de l’état Git décrit plus haut.

Le build courant produit 28 fichiers contrôlés par SHA-384. Une seconde
construction sous le chemin public `/PokeMaster/`, avec signature Ed25519
obligatoire, a été signée par une clé privée éphémère hors dépôt puis vérifiée
séparément par sa clé publique ; les deux clés de test ont ensuite été
détruites. Le dernier build local porte le chunk applicatif à 1 360,24 ko avant
gzip (389,91 ko gzip),
toujours au-dessus du seuil de 550 ko. Les secrets de production et le canal de
distribution de la vraie clé publique restent à configurer.

La passe directe dans l’espace de travail compte toujours un fichier de test et
une source de plus parce que Vitest et le contrôle de frontières y découvrent
`src/rom/battle/.tmp-secret-table.test.ts`. Ce scratch ignoré, dépendant de la
ROM, ne contient aucune assertion et est déjà supprimé de l’index ; il est
correctement absent du snapshot livrable. Les compteurs de l’espace de travail
ci-dessus incluent donc ce fichier local, sans lui attribuer de test réussi.

Les 111 tests ignorés par la passe sans ROM sont les probes conditionnels qui
exigent la ROM locale et une variable `RUN_*`; ils ne constituent pas des tests
fonctionnels silencieusement désactivés. Ils sont réactivés par le runner ROM
ci-dessus. En revanche, ce mécanisme ne couvre pas les recettes navigateur,
multinavigateur, appareils ou déploiement énumérées plus loin.

Le scénario navigateur réel `campagne-premier-badge.txt` est maintenant vert en
403,5 secondes. Il valide le chargement de la ROM, le mode local,
l’introduction, le choix du starter, le numéro d’Orme, Ville Griotte,
M. Pokémon, les combats réels accélérés, le retour de l’Œuf, la traversée des
Routes 30 et 31, la victoire observée contre Albert, le Badge Zéphyr, la fin du
script et une sauvegarde prête. Le blocage précédent a été reproduit puis
isolé : sur la case `(9,4)` de la Route 30, l’appel ROM de Maman ouvrait son
choix Oui/Non global, mais le bot ne pilotait que les choix de script
classiques. Le bot ferme désormais ce choix Pokématos et le diagnostic publie
explicitement `phoneChoiceOpen`, les attentes de script, les mouvements, les
jalons de badge et la victoire contre Albert. Ce vert certifie le premier badge,
pas les huit badges, Kanto, Red ni l’après-jeu.

Le scénario étendu `campagne-oeuf-togepi.txt` est également vert en 462,7
secondes dans Chrome headless réel. Depuis une nouvelle partie, il reprend
toutes les preuves du premier badge, entre dans la Boutique de Mauville,
interagit avec l’assistant d’Orme, vérifie un véritable Œuf de Togepi dans
l’équipe ainsi que le flag et la variable ROM de livraison, revient sur la
carte 73 sans combat ni script actif, puis obtient une sauvegarde prête. La
première exécution avait révélé une course réelle : le bot lisait la carte
d’arrivée entre son chargement et le premier cycle `ON_FRAME`. Le pilotage
attend désormais la fin de la transition ; le script d’arrivée finalise la
variable avant toute nouvelle décision du bot. Cette preuve prolonge la
certification navigateur au jalon post-Zéphyr, sans prétendre certifier le
deuxième badge ni la suite de la campagne.

Le scénario continu `campagne-badge-essaim.txt` est maintenant vert en 725,751
secondes dans un vrai Chrome headless depuis une nouvelle partie. Il conserve
les preuves Zéphyr et Togepi, traverse les Routes 32 et 33 et les Caves
Jumelles, termine la chaîne de Fargas et du Puits Ramoloss, entre dans l’Arène
d’Écorcia, vainc Hector et constate le Badge Essaim. L’arrêt contrôlé se fait
sur la carte 180, sans combat ni script actif, au checkpoint
`hive-badge-complete`, avec une sauvegarde prête. Cette preuve porte donc la
frontière navigateur réelle à deux badges ; elle ne certifie toujours ni la
suite de Johto, ni Kanto, ni Red, ni un autre navigateur.

Le scénario `campagne-badge-plaine.txt` prolonge ce même parcours depuis une
nouvelle partie et passe dans Chrome headless réel en 895,353 secondes. Il
réutilise le mécanisme de l’Arène d’Écorcia pour en sortir, résout les deux
Canarticho à partir des brindilles et scripts de coordonnées ROM, reçoit la
CS01, apprend Coupe à Kaiminus puis coupe l’arbre réel. Il déclenche ensuite la
visite obligatoire de la Pension, répond aux six questions de la Radio, atteint
l’Arène de Doublonville, vainc Blanche, laisse sa scène de pleurs se terminer et
lui reparle pour recevoir le Badge Plaine. L’arrêt contrôlé se fait sur la
carte 137 au checkpoint `plain-badge-complete`, avec les preuves indépendantes
du bois, de Coupe, de la Radio, de Blanche et du badge, sans combat ni script
actif et avec une sauvegarde prête. Le même segment est également vert dans le
simulateur headless alimenté par la ROM. La frontière certifiée passe ainsi à
trois badges ; la suite de Johto, Kanto, Red et les autres navigateurs restent
hors de cette preuve.

Le scénario `campagne-badge-brume.txt` poursuit encore la même partie neuve et
passe dans Chrome headless réel en 1 284,688 secondes. Il reçoit le Carapuce à
O après Blanche, traverse les Routes 35 à 37, vainc le Simularbre réel, rejoint
Rosalia, rencontre Eusine, bat le rival dans la Tour Cendrée puis libère Raikou,
Entei et Suicune au sous-sol. Dans l’Arène de Rosalia, son plan évite les cases
de chute, vainc les Dresseurs intermédiaires puis Mortimer (Dresseur ROM 31) et
reçoit le Badge Brume. L’arrêt contrôlé se fait sur la carte 80 au checkpoint
`fog-badge-complete`, avec les quatre badges et six preuves propres au segment,
sans combat ni script actif et avec une sauvegarde prête. Le parcours ROM
headless correspondant passe en 18,80 secondes. La frontière certifiée atteint
donc quatre badges ; le reste de Johto, Kanto, Red et les autres navigateurs
restent hors de cette preuve.

Le serveur passe 156/156 tests, son typecheck, son build et l’audit npm avec
zéro vulnérabilité signalée. L’image Docker est construite par la CI de
pull request, mais n’a pas pu être reconstruite sur la machine d’audit, où le
moteur Docker n’est pas installé.

Une première preuve historique portait sur 1 539 fichiers ; elle est désormais
supplantée par la reconstruction courante de 1 560 fichiers décrite ci-dessus.
Cette preuve établit que le candidat peut être livré comme un ensemble cohérent,
mais elle ne modifie pas `HEAD`. Le gate reste volontairement rouge dans
l’espace de travail réel tant que ses 1 359 changements et ses 40 ancres de
base absentes de l’index n’ont pas été relus et versionnés.

## Bloquants produit — priorité P0

### 0. Rendre l’état audité reproductible

L’arbre de travail courant contient 211 chemins modifiés, 12 supprimés et
1 136 non suivis. Parmi ces derniers figurent 1 002 fichiers sous `web/src` et
les 30 fichiers de `server/src`; Git ne suit actuellement aucun fichier sous
`server`. Les tests prouvent donc cet espace de travail, pas le contenu qu’un
utilisateur obtiendrait depuis le dépôt.

Avant toute release, il faut inventorier ces changements, conserver seulement
les fichiers voulus, les faire relire et les versionner avec leur historique de
migration. Le dépôt jetable prouve déjà que le snapshot candidat est cohérent ;
il faudra néanmoins rejouer les mêmes gates depuis le vrai commit de release en
CI. Cette étape reste bloquante même si le candidat reconstruit est entièrement
vert.

### 1. Certifier la campagne entière avec les vraies entrées

Le probe abstrait des scripts couvre les branches décodées, mais le bot joueur
continu ne dépasse actuellement pas le quatrième badge. Il faut étendre un même
parcours déterministe jusqu’aux crédits, à Kanto puis à Red, avec checkpoints
de sauvegarde/reprise et échecs explicites sur tout écran ou opcode non raccordé.

Critère de sortie : un rapport versionné produit depuis le build navigateur
atteste chaque badge, le Panthéon, Kanto, Red, les transitions de cartes, les
combats et une reprise après fermeture.

### 2. Terminer ou exclure les activités HGSS encore partielles

- Voltorb Flip / `CasinoGame` n’a pas de runtime jouable.
- Le Pokéathlon expose surtout données, records et boutique ; les épreuves
  sportives complètes ne sont pas présentes.
- La Zone de Combat possède des règles, sélections et records, mais pas une
  certification jouable de toutes les installations et séries.
- Le Pokéwalker n’est représenté que par des graines de profil.
- Pal Park n’a pas de parcours de jeu raccordé.
- Le Concours de Capture possède un état et des commandes, sans recette
  navigateur complète de l’événement.
- Cadeau Mystère possède des garde-fous et une file locale, mais aucun service
  de distribution authentifié faisant partie du produit.

Plusieurs écarts concrets découverts pendant l’audit sont maintenant fermés :
le courrier tenu de Kenya suit le flux natif équipe/boîte aux lettres/sac ; les
quinze motifs de cris HGSS 0 à 14, les flux PCM8 particuliers, Pijako et la
banque 494 de Shaymin Céleste sont raccordés ; les appels de Maman et du
Professeur Chen et leurs choix sont contrôlés contre la ROM ; les cinq
classes de réaction du suiveur au Dôme Pokéathlon utilisent les vraies données
de performance ; l’opcode 238 teste désormais l’octet Pokérus PK4 de toute
l’équipe, y compris l’état guéri, le conserve dans les sauvegardes et applique
son expiration quotidienne via l’horloge terrain. Les sorties des combats
terrain solo et double, ainsi que la fin Safari après capture ou fuite, tentent
aussi l’acquisition native sur exactement trois valeurs parmi 65 536, puis sa
propagation adjacente avec une chance sur trois, y compris vers un Œuf et jamais
vers un slot immunisé ; Safari n’exécute pas Ramassage/Cherche Miel hors
victoire. Les destinations de warp possèdent désormais leur gate ROM. L’opcode 730 consulte maintenant le
MapObject vivant du Pokémon suiveur et distingue exactement objet absent,
masqué ou visible au lieu de réduire cette condition à son seul état actif. Les
sons de réaction suivent aussi le dispatch natif : effets SDAT jusqu’à 2 378,
cri normal pour 2 379 et cri de motif 11 au-delà ; le catalogue de la ROM
française ne contient effectivement que les valeurs 0, 2 379 et 2 380.
Ces corrections ne remplacent pas les scénarios navigateur requis pour les
activités complètes listées ci-dessus.

Pour chacun : implémentation générique pilotée par les données, tests du domaine,
probe ROM, puis scénario navigateur. Si une activité est hors périmètre, le
README et l’UI doivent le dire sans ambiguïté.

### 2 bis. Fermer les approximations fonctionnelles explicites

L’inspection statique a identifié les comportements suivants, qui passent les
tests actuels parce qu’ils sont assumés par le code plutôt que certifiés comme
fidèles :

- six des sept familles d’`objectEffect` terrain sont consommées sans effet
  jouable ; seuls un cas spécial et le statut de diagnostic sont traités. Cela
  touche notamment piège Rocket, statues, Lac Colère, Centre Pokémon et
  mouvements/cinématiques d’objets ;
- l’acquisition et la propagation après combat du Pokérus sont raccordées avec
  leurs tirages et leur ordre natifs, y compris après capture ou fuite Safari
  sans déclencher Ramassage/Cherche Miel ; le moteur navigateur partage encore
  un LCRNG entre terrain et combat là où le jeu DS distingue le générateur
  global de `BattleSystem_Random` ; la parité graine par graine n’est donc pas
  encore certifiée ;
- le courrier tenu générique ne peut toujours pas être donné, retiré ou
  remplacé dans tous les flux, malgré le parcours Kenya désormais exact ;
- le classement du Concours de Capture est provisoire : scores PNJ à zéro et
  joueur classé premier par défaut après une capture ;
- certains overlays restent représentés par un statut texte et plusieurs
  cinématiques par un filtre CSS générique ; en revanche `ScrCmd_560` n’est
  plus dans cette liste : ses six modes, modèles, animations, sons, caméra et
  complétion asynchrone reproduisent désormais la séquence terrain native ;
- Battle Recorder/blocs réseau DS, roster distant de la Tour Wi-Fi et options
  avancées de l’éditeur NG+ ne sont pas raccordés.

Chaque approximation doit être soit remplacée par son comportement piloté par
la ROM, soit inscrite comme exclusion produit visible et testée. L’absence de
`TODO`/`FIXME` dans les sources ne constitue pas une preuve de complétude.

### 3. Fermer l’audit combats

Traiter les écarts restants du document `AUDIT_COMBATS_100_PERCENT.md`, puis
ajouter des combats de référence représentatifs : simple, double, multi-cible,
switch, objets, capacités à effets particuliers, altérations, capture,
évolution et blackout. Un inventaire de capacités « décodé » n’est suffisant
que si leur sémantique est réellement exécutée par le moteur concerné.

Le rapport courant marque les 467 capacités complètes sémantiquement en simple
et double, mais inventorie encore 260 appels de fonction natifs en fallback et
141 instructions d’animation en fallback. Ces nombres ne prouvent pas 401
capacités incorrectes — plusieurs fallbacks peuvent appartenir à une même
animation — mais ils interdisent d’assimiler « sémantique verte » à « rendu DS
exact ». Il faut catégoriser ces fallbacks, poser un budget accepté ou les
ramener à zéro, puis ajouter des traces différentielles. Le runner consolidé
échoue désormais fermé si l’un de ses booléens de certification n’est pas
strictement vrai ; auparavant il pouvait écrire `false` dans le rapport tout en
quittant avec un code zéro.

### 4. Aligner la promesse multijoueur sur le produit

- Raccorder le PvP avant de le rendre visible.
- Terminer les combats partagés, événements de coordonnée et mutations d’objet
  transactionnelles en Coop.
- Tester échange et Coop entre deux navigateurs, avec perte réseau,
  reconnexion, rejeu de message, fermeture d’onglet et redémarrage serveur.
- Déployer un TURN pour Trade/PvP ou documenter officiellement les réseaux non
  supportés.
- Garder le classement désactivé tant qu’un résultat attesté n’existe pas.

### 5. Prendre la décision juridique de publication

Le dépôt n’a pas de fichier `LICENSE`. Il ne faut pas en inventer un : le
propriétaire doit choisir la licence du code et faire valider la marque, la
rétro-ingénierie et les tables éventuellement dérivées avant publication. Les
ROMs, sauvegardes, captures et ressources extraites doivent rester hors dépôt,
des releases et des rapports publics.

## Bloquants de production — priorité P1

### Qualité et compatibilité

- Étendre les huit parcours de campagne E2E lancés par défaut au-delà du
  quatrième badge — treize bandes `.txt` existent au total — et exécuter
  une matrice Chrome, Firefox et Safari/WebKit sur desktop et mobile.
- Ajouter une recette manuelle courte pour manette, tactile, plein écran,
  suspension mobile, perte WebGL, audio bloqué et quotas de stockage.
- Faire un audit lecteur d’écran et contraste sur titre, combat, équipe, sac,
  Pokématos, boîtes, dialogues et formulaires multijoueur.
- Mesurer démarrage, changement de carte, mémoire et stabilité sur appareil
  modeste ; le build signale encore plusieurs gros chunks et doit être profilé
  avant de fixer un budget de performance réaliste. Un test de pression audio
  a observé en cinq secondes environ 4 042 sources, 4 048 gains et 4 042
  panners WebAudio conservés jusqu’au `dispose` (12 132 nœuds au total) ; la
  coïncidence avec une coupure CDP ne suffit pas encore à prouver sa causalité.
- Unifier l’autorité de fin entre bot, parcours et panneau E2E, puis ajouter un
  watchdog de stagnation qui échoue avec l’état courant si aucun jalon, écran ou
  position n’évolue pendant une durée bornée.

### Exploitation serveur

- Définir une politique de création de comptes pour la production : le plafond
  global atomique existe désormais, mais invitation ou vérification,
  récupération, suppression et modération restent à décider.
- Remplacer le fournisseur d’entitlements inactif avant d’activer la politique
  Patreon.
- Automatiser sauvegardes chiffrées, restauration testée, rotation et rétention
  des stores persistants.
- Ajouter métriques, alertes, journaux centralisés et un probe de readiness qui
  vérifie réellement les dépendances d’écriture.
- Documenter les limites d’une instance et préparer un stockage coordonné avant
  toute réplication horizontale.
- Épingler et maintenir les images de déploiement, puis tester les fichiers
  Compose et la restauration sur un environnement jetable.
- Écrire la politique de confidentialité, la durée de rétention, la procédure
  d’export/suppression des données et la réponse aux incidents avant d’ouvrir
  l’inscription au public.

### Release

- Ramener l’arbre de travail à un ensemble relu et versionné : l’état courant
  compte actuellement 1 359 chemins sales et le serveur entier est non suivi.
- Choisir une version produit non nulle pour le client (`0.0.0` actuellement),
  aligner sa politique avec le serveur (`0.1.0`), tenir un changelog et définir
  les migrations compatibles de sauvegarde/protocole.
- Activer la signature Ed25519 obligatoire pour les artefacts de release et
  distribuer la clé publique par un canal distinct du build.
- Exécuter la recette depuis un clone propre avec uniquement les fichiers suivis.
- Publier une release candidate, conserver les rapports de test sans contenu
  ROM, puis obtenir un go/no-go explicite produit, technique, sécurité et légal.

## Améliorations réalisées pendant cet audit

- Les erreurs JavaScript fatales, rejets non gérés et pertes WebGL deviennent
  visibles et annoncées par les technologies d’assistance.
- Les principaux écrans, dialogues, commandes de combat et jauges ont retrouvé
  des noms accessibles sans réintroduire de texte de scénario hors ROM.
- Le label de saisie de surnom manquant est restauré et l’automatisation ferme
  désormais la même modale de saisie que l’utilisateur, au lieu de laisser un
  dialogue invisible intercepter les combats suivants.
- Les Bearers de compte navigateur sont maintenant limités à la session
  d’onglet et les anciennes copies durables sont purgées.
- Le mode local reste réellement disponible et le banc E2E échoue désormais si
  son contrôle n’est pas actif, avec heartbeat et progression observables.
- Les accessoires trouvés par le Pokémon suiveur rejoignent l’inventaire
  Fashion.
- Un backup de sauvegarde strict, borné et versionné peut être exporté puis
  importé uniquement dans un slot vide, y compris dans le scope compte choisi.
- Le stockage d’amis serveur applique une capacité globale atomique et valide
  son état avant toute écriture.
- Les comptes et sessions serveur appliquent eux aussi leur capacité globale
  dans la section critique, y compris après redémarrage, sans calcul de mot de
  passe inutile lorsque le plafond est atteint.
- Les deltas de session partagée sont journalisés durablement avant acquittement
  et rejouables après redémarrage.
- Le runner ROM découvre les probes au lieu de maintenir une petite liste qui
  pouvait donner un faux vert ; ses probes spécialisées font partie du
  certificat.
- Le runner Chrome distingue maintenant les pannes de l’infrastructure des
  échecs du jeu, conserve le dernier état du panneau et les journaux bornés,
  puis nettoie de façon déterministe Chrome et son profil temporaire.
- Le diagnostic temps réel inclut désormais une photographie bornée et
  déterministe des attentes, mouvements, écrans de choix, jalons et preuves de
  combat ; une erreur de script terrain arrête immédiatement le bot au lieu de
  finir en timeout opaque.
- Le bot navigateur sait valider le choix Oui/Non de l’appel de Maman. La
  recette réelle du premier badge, précédemment bloquée sur la Route 30, passe
  maintenant jusqu’à Albert, au Badge Zéphyr et à la sauvegarde.
- Le même bot poursuit désormais la partie réelle jusqu’à la Boutique de
  Mauville, reçoit l’Œuf de Togepi, laisse le script `ON_FRAME` de retour
  finaliser sa variable native et certifie ce jalon avec une sauvegarde en
  462,7 secondes dans Chrome headless.
- Le parcours navigateur continu poursuit cette même nouvelle partie jusqu’au
  Puits Ramoloss, à Hector et au Badge Essaim en 725,751 secondes. Il termine
  sur la carte 180, sans combat ni script actif, avec une sauvegarde prête.
- Le parcours continu poursuit désormais la partie jusqu’aux deux Canarticho,
  à l’apprentissage et l’usage réels de Coupe, à la Pension, au quiz Radio et
  à Blanche. La campagne Chrome atteint le Badge Plaine en 895,353 secondes,
  termine sur la carte 137 sans combat ni script actif et produit une
  sauvegarde prête ; le parcours ROM headless correspondant est également vert.
- Le parcours continu atteint désormais le Carapuce à O, Simularbre, Rosalia,
  le rival et les trois fauves de la Tour Cendrée, puis Mortimer et le Badge
  Brume. La campagne Chrome termine sur la carte 80 en 1 284,688 secondes, sans
  combat ni script actif, avec une sauvegarde prête ; le parcours ROM headless
  correspondant est également vert.
- La priorité native des événements d’arène empêche maintenant le bot de
  préempter un script de mécanisme en cours. En cas de blackout, le navigateur
  soigne l’équipe, désactive le suiveur, vide `Save_Gymmick`, rejoint le point
  ROM puis exécute l’init de destination, le script 2012/2013 et la reprise
  interrompue ; l’agent sait repartir du Centre Pokémon et retenter l’arène.
- Le simulateur headless exécute désormais le même blackout au lieu de seulement
  le journaliser, avec un test d’ordre exact et de restauration PV/statut/PP.
- Le regard d’un Dresseur double respecte la garde HGSS : avec moins de deux
  Pokémon aptes, le Dresseur 10 de la carte 180 n’engage pas le joueur. Deux
  Dresseurs simples qui repèrent simultanément le joueur appliquent désormais
  la même garde, ce qui ferme le blocage réel du duo de la Route 37. La
  dérogation NG+ où tous les combats sont déjà doubles conserve son seuil d’un,
  sans affaiblir l’invariant du moteur de combat duo.
- Une erreur technique de lancement de combat pendant le bot est maintenant
  propagée immédiatement au diagnostic au lieu d’être convertie en fausse
  défaite puis en blackout, ce qui a rendu le défaut précédent observable.
- Les quinze motifs de cri 0 à 14, leurs données PCM8 particulières, le cri de
  Pijako et la banque 494 de Shaymin Céleste sont désormais raccordés et testés.
- Les sorties Safari appliquent acquisition puis propagation du Pokérus une
  seule fois, y compris après capture ou fuite, sans Ramassage/Cherche Miel.
- `ScrCmd_560` distribue désormais ses six effets terrain avec modèles,
  animations, sons, caméra et publication asynchrone de la variable de fin.
- Le certificat ROM consolidé échoue désormais avec un code non nul dès qu’un
  de ses invariants de certification vaut autre chose que `true`.
- Le snapshot candidat courant de 1 560 fichiers a été reconstruit avec deux
  installations fraîches puis a passé tests, audits npm, TypeScript, lint,
  architecture, builds client/serveur, signature Ed25519 et les 59 gates ROM,
  tout en conservant un arbre Git jetable propre.
- Un gate Git fail-closed contrôle désormais la propreté du checkout et la
  présence dans l’index des ancres client, serveur, documentation de release et
  CI. Il s’exécute sur toute pull request et avant les publications manuelles
  Pages et GHCR.
- Le courrier tenu de Kenya respecte le choix boîte aux lettres/sac, refuse
  atomiquement une boîte pleine et conserve l’identité du courrier.
- Les appels de Maman et du Professeur Chen, leurs choix interactifs et les
  destinations de warp sont vérifiés contre la ROM française. Les réactions du
  suiveur routent leurs identifiants 2 379/2 380 vers les motifs de cri 0/11
  conformément à `ov02_0224FDF8`.
- Les performances Pokéathlon du suiveur décodent les 554 fiches natives,
  appliquent forme, nature, date et Aprijuice, et persistent ces données à
  travers équipe, PC, Pension, échange et sauvegarde.
- La CI de pull request vérifie client, serveur et image Docker ; Dependabot,
  politique de sécurité, guide de contribution et checklist de PR ont été
  ajoutés.

## Ordre recommandé jusqu’au vrai 100 %

1. Trier et versionner l’état audité, puis reproduire en CI sur le vrai commit
   la preuve déjà obtenue dans le dépôt jetable propre.
2. Figer par écrit le périmètre des activités optionnelles et la matrice cible.
3. Étendre le parcours joueur continu jusqu’à Red ; corriger chaque bloqueur au
   fil de ce parcours sans contourner les données ROM.
4. Fermer l’audit combats et les activités retenues.
5. Terminer les scénarios multijoueur à deux navigateurs.
6. Exécuter compatibilité, accessibilité, performance et résilience stockage.
7. Durcir l’exploitation VPS et tester sauvegarde/restauration.
8. Prendre la décision juridique, versionner une RC et exécuter la checklist de
   release depuis un clone propre.

Le projet ne doit être annoncé « 100 % » qu’après ces huit sorties, pas après un
simple passage des tests unitaires.
