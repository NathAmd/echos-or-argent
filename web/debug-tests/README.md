# Batteries de test temps réel

Les commandes de touche de ces fichiers pilotent le vrai routeur clavier/manette du jeu. Les commandes `BOT` délèguent aux agents d’audit temps réel ; aucun scénario ne réécrit directement l’état du terrain, des menus ou des scripts de campagne. `BOT PLAIN` utilise toutefois l’opération normale d’apprentissage CT/CS du domaine pour apprendre la CS01 au Pokémon compatible choisi.

## Lancer une batterie

1. Depuis `web`, lancer `npm run test:live`.
2. Charger la ROM locale.
3. Dans le panneau « Batterie temps réel », choisir un fichier `.txt` de ce dossier.
4. Cliquer sur « Lancer ». Une entrée manuelle, un changement d’onglet ou le bouton « Arrêter » interrompt proprement le scénario et relâche la touche tenue.
5. Télécharger « Rapport TXT » après réussite ou échec.

Le paramètre `?test=1` crée une session jetable : sauvegarde manuelle, autosauvegarde, options, droits NG+ et effacement de slot sont redirigés vers une surcouche mémoire. Ils continuent donc à fonctionner pendant une campagne de test, sans modifier le stockage réel. Le remplacement du cache ROM reste bloqué. Un rechargement rend la partie normale intacte. Les outils ne sont pas publiés dans le build de production.

Les presets NG+ de `BOT ZEPHYR` fabriquent une source Ligue uniquement en mémoire, créent le profil avec le registre intégré, puis passent par la transaction réelle d’activation, de `pendingStart` et de sauvegarde du profil. Ils ne lisent aucune partie personnelle. La source contient volontairement un Pokédex et 424 242 ₽ reconnaissables afin que les deux modules de transfert suivent aussi leur vrai chemin.

Les huit parcours de campagne peuvent aussi être rejoués sans toucher au serveur déjà lancé, dans un Chrome headless et un profil temporaire isolé :

```sh
npm run test:live:headless -- --rom ../Pokemon\ -\ Version\ Or\ HeartGold\ \(France\).nds
```

Sans fichier TXT explicite, le lanceur exécute exactement ces huit parcours, dans cet ordre :

1. `campagne-premier-badge.txt` : partie normale jusqu’au Badge Zéphyr ;
2. `campagne-oeuf-togepi.txt` : partie normale jusqu’à l’Œuf de Togepi et au retour sur la carte 73 ;
3. `campagne-badge-essaim.txt` : partie normale jusqu’au Badge Essaim et au retour sur la carte 180 ;
4. `campagne-badge-plaine.txt` : partie normale jusqu’au Badge Plaine et au retour sur la carte 137 ;
5. `campagne-badge-brume.txt` : partie normale jusqu’au Badge Brume et au retour sur la carte 80 ;
6. `campagne-premier-badge-ngp-monotype-complet.txt` : NG+ simple, transferts et règles indépendantes ;
7. `campagne-premier-badge-ngp-duo-eevee.txt` : NG+ duo avec six Évoli ;
8. `campagne-premier-badge-ngp-duo-solo-monotype.txt` : NG+ duo 1 contre 2, Solo et Monotype Plante.

Le lanceur recharge une page fraîche entre les scénarios, n’écrit aucune sauvegarde personnelle et supprime son profil Chrome temporaire à la fin. Un ou plusieurs fichiers TXT peuvent être ajoutés après les options pour ne jouer qu’une sélection.

## Syntaxe v1

Chaque fichier commence par :

```text
pokemaster-debug-tape-v1 nom-du-test
```

Commandes disponibles :

```text
PRESS confirm                 # appui de 70 ms
PRESS right 120ms             # durée explicite
HOLD up 2s                    # touche maintenue
REPEAT 5 PRESS confirm        # expansion contrôlée
WAIT 500ms                    # temps réel
WAIT battle=simple 1m         # attend un état, avec délai maximal
PRESS-UNTIL confirm battle=none 180ms 1m
EXPECT flow=bedroom           # assertion immédiate
EXPECT-ERROR Safari DEBUG GODMODE ON
DEBUG GODMODE ON
DEBUG GODMODE OFF
DEBUG INSTANT-KILL
DEBUG SUICIDE
BOT OPENING                   # parcours ROM d’ouverture existant
BOT ZEPHYR [preset]           # nouvelle partie jusqu’au premier badge
BOT TOGEPI [preset]           # premier badge puis Œuf de Togepi à Mauville
BOT HIVE [preset]             # Œuf, Puits Ramoloss puis Badge Essaim à Écorcia
BOT PLAIN [preset]            # Bois aux Chênes, Coupe, Radio puis Badge Plaine
BOT FOG [preset]              # Carapuce à O, Simularbre, Tour Cendrée puis Badge Brume
REPORT nom-du-checkpoint
STOP
```

Alias français : `TOUCHE`, `MAINTIEN`, `ATTENDRE`, `VERIFIER`, `ERREUR-ATTENDUE`, `COMMANDE`, `RAPPORT`, `REPETER`; touches `valider`, `annuler`, `haut`, `bas`, `gauche`, `droite`, `secondaire`, `tertiaire`, `page-precedente`, `page-suivante`.

Les durées acceptent `ms`, `s` ou `m`. Limites : 512 Kio de texte, 10 000 étapes après répétition, attente maximale de 25 minutes et maintien maximal de 30 secondes. Le fichier entier est validé avant le premier appui.

Le godmode garantit la survie en réconciliant les PV et les événements avant les observateurs de résultat. Il ne rembobine pas le tour déjà calculé : PP, RNG, objets et effets non létaux restent consommés comme lors d’un vrai tour. `INSTANT-KILL` sert à accélérer administrativement une victoire une fois `debugReady=true`.

## États observables

- `loaded=true|false`
- `flow=boot|title|intro|bedroom|...`
- `combat=true|false`
- `battle=none|simple|double|safari`
- `battlePhase=command|replacement|ended|...`
- `battleUi=message|command|moves|...`
- `debugReady=true|false` : aucun message ni choix double partiel, donc victoire/défaite de test admissible
- `map=<id ROM>`, `x=<tuile>`, `z=<tuile>`
- `dialog=true|false`, `phoneChoiceOpen=true|false`
- `script=true|false`, `scriptWait=<raison>`, `scriptMovementTasks=<n>`, `scriptMoving=true|false`, `followerMoving=true|false`
- `menu=true|false`, `menuScreen=<écran>`
- `bot=running|stopped`, `botStatus=<jalon>`, `botError=<message>`, `godmode=true|false`
- `journey=idle|running|paused-for-battle|finalizing|passed|failed|stopped`
- `journeyCheckpoint=<jalon>`, `journeySeed=<entier>`, `journeyError=<message>`
- `zephyrBadge=true|false`, `falknerDefeated=true|false`
- `togepiEggReceived=true|false`, `togepiReturnComplete=true|false`
- `slowpokeWellCleared=true|false`, `hiveBadge=true|false`, `bugsyDefeated=true|false`, `hiveGymComplete=true|false`
- `ilexForestCleared=true|false`, `cutLearned=true|false`, `radioQuizComplete=true|false`
- `plainBadge=true|false`, `whitneyDefeated=true|false`, `plainGymComplete=true|false`
- `saveReady=true|false`, `runtimeStatus=<état du moteur>`
- `campaignPreset=normal|ngp-simple-full-monotype|ngp-duo-eevee|ngp-duo-solo-monotype`
- `campaignMode=normal|new-game-plus`, `campaignModules=<ids séparés par des virgules>`
- `initialPartySize=<n>`, `initialPartySpecies=<ids>`, `simpleBattleSeen=true|false`, `doubleBattleSeen=true|false`, `minDoublePlayerParticipants=<n>`

`falknerDefeated` est alimenté par une victoire réellement rendue au moteur
contre le Dresseur ROM 20. Ce n’est pas un `TrainerFlag` : le script original
d’Albert attribue le badge 0 et marque ses élèves 29/50, mais ne pose jamais le
drapeau 20.

`togepiReturnComplete` exige la remise persistante de l’Œuf et le retour effectif
sur la carte 73. `slowpokeWellCleared` reflète les événements ROM persistants du
Puits Ramoloss. `bugsyDefeated` est alimenté par la victoire réellement rendue au
moteur contre le Dresseur ROM 21, tandis que `hiveBadge` reflète le badge 1.
`hiveGymComplete` réunit la progression requise et le retour sur la carte 180 :
il ne devient donc pas vrai à la seule attribution du badge.

`ilexForestCleared` exige les deux Canarticho, la remise de la CS01 et l’arbre
réellement coupé. `whitneyDefeated` provient de la victoire contre le Dresseur
ROM 30. `plainGymComplete` exige en plus le quiz Radio, la scène de pleurs, le
badge 2 et la présence finale sur la carte 137.

`squirtBottleReceived` exige le Carapuce à O réel, `sudowoodoCleared` le
drapeau persistant du Simularbre et `legendaryBeastsReleased` les trois
drapeaux de Raikou, Entei et Suicune. `mortyDefeated` vient de la victoire
contre le Dresseur ROM 31 ; `fogGymComplete` exige aussi le badge 3 et la
présence finale sur la carte 80.

À la réussite, les jalons finaux sont `zephyr-badge`, `togepi-egg`,
`hive-badge-complete`, `plain-badge-complete` et `fog-badge-complete` selon le bot lancé. `saveReady=true` n’est publié qu’après
la fin du parcours, l’arrêt du bot terrain et la confirmation de la sauvegarde
jetable ; il correspond donc à `journey=passed`, pas simplement à l’obtention
d’un badge.

## Portée actuelle

`batterie-principale.txt` masque d’abord les trois emplacements réels dans la surcouche jetable, rejoue automatiquement l’ouverture déjà cartographiée, puis contrôle le retour terrain, le menu, le déplacement et l’interaction. Les quatre scénarios `campagne-premier-badge*.txt` couvrent le mode normal, le NG+ simple Monotype avec toutes les règles indépendantes et transferts, le duo Équipe Évoli et le duo à un seul Pokémon Solo+Monotype. `campagne-oeuf-togepi.txt` prolonge le mode normal jusqu’à la remise de l’Œuf et exige son drapeau, sa variable ROM et le retour sur la carte 73. `campagne-badge-essaim.txt` continue via les Routes 32/33, les Caves Jumelles, Fargas, le Puits Ramoloss et l’Arène d’Écorcia. `campagne-badge-plaine.txt` prolonge encore le parcours par le Bois aux Chênes, Coupe, la Pension, le quiz Radio et l’Arène de Blanche. `campagne-badge-brume.txt` ajoute le Carapuce à O, Simularbre, le rival, la libération des fauves de la Tour Cendrée et l’Arène de Mortimer, puis exige les quatre badges et la carte 80. Ils résolvent les combats via les commandes de diagnostic, prouvent le format réellement observé et exigent une sauvegarde de test propre. Les scénarios combat couvrent ensuite victoire, protection et défaite dans un vrai combat simple ou double. `safari-sortie.txt` couvre le chemin Safari sans inventer de PV : godmode, instant-kill et suicide y sont volontairement non applicables.

La campagne complète doit rester découpée par chapitre et enrichie à mesure que ses routes sont stabilisées. Le moteur TXT est prévu pour ces ajouts : checkpoints, attentes d’état et `PRESS-UNTIL` évitent les suites de délais fragiles.
