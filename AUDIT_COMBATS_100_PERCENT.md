# Audit de complétude des combats HGSS

Date : 4 septembre 2026

## Verdict

Le moteur est jouable et sa couverture est déjà large, mais il n'est pas encore possible de certifier une reproduction à 100 % des combats de Pokémon Or HeartGold.

La logique de toutes les capacités nommées de la ROM est déclarée comme implémentée. Cette déclaration n'est toutefois pas une preuve comportementale : le probe actuel vérifie qu'un identifiant d'effet appartient à une liste, pas que son résultat correspond à l'overlay de la ROM pour toutes les entrées et interactions.

La principale dette fonctionnelle confirmée est l'IA des Dresseurs. La principale dette visible est l'interpréteur des animations de combat, qui conserve encore plusieurs fallbacks temporels ou approximatifs.

## Base vérifiée

- ROM française exacte : SHA-256 `ee540ea4eff5268e8b7a85bc63db654c627dd82c25ebe921211870646b25356a`.
- 738 Dresseurs et 142 tables de rencontres sauvages décodés.
- 467 capacités nommées, utilisant 257 identifiants d'effet distincts.
- 406 capacités distinctes utilisées par les Dresseurs.
- 448 capacités distinctes présentes dans les listes d'apprentissage par niveau.
- 87 capacités distinctes utilisées par les Dresseurs en combat double.
- 501 scripts d'animation de capacité décodés.
- 486 ressources de particules SPL lisibles sans exception.
- 606 tests de combat et de données ROM réussis, 4 probes conditionnels ignorés lors de l'exécution standard.
- Tous les probes ROM spécifiques au combat ont réussi lorsqu'ils ont été exécutés avec la ROM.

## Compteur de capacités corrigé

`moveEffectsInventoryProbe.test.ts` annonçait 470 capacités implémentées. Le catalogue contient en réalité :

- les 467 capacités nommées, IDs 1 à 467 ;
- trois slots sentinelles 468, 469 et 470, sans nom, que le probe compte comme des capacités de puissance 100 et d'effet 0.

Le probe filtre désormais les slots sans nom, verrouille les totaux attendus et produit un rapport de révision 3 avec un dénominateur de 467.

## Manques bloquants côté logique

### 1. Le classement des effets est déclaratif

`simpleBattleEffectSupport.ts` contient deux ensembles d'identifiants marqués comme implémentés. Le rapport ROM applique ensuite le classificateur à chaque capacité.

Cela prouve que les 257 effets sont déclarés, mais pas que chacun :

- produit les bons dégâts, statuts et événements ;
- consomme le RNG dans l'ordre HGSS ;
- respecte les immunités, talents et objets ;
- fonctionne en simple et en double ;
- se réinitialise ou se transmet correctement au changement ;
- gère les PV pleins, les limites de crans, les clones et les K.O. simultanés.

Il manque une matrice comportementale pilotée par la ROM : au moins un scénario nominal et les interactions critiques pour chacun des 257 effets.

### 2. Il n'existe pas de matrice exhaustive des 123 talents

Les talents sont répartis entre les règles de dégâts, entrée, fin de tour, après-impact, ciblage, changement, fuite et post-combat. De nombreux talents sont testés, mais aucun inventaire ne garantit que chaque talent HGSS est :

- sans effet en combat par conception, ou
- implémenté dans toutes ses phases, et
- testé dans les moteurs simple et double pertinents.

La couverture doit être rendue explicite dans une table `talent -> phases -> tests -> statut`. Les interactions prioritaires sont Brise Moule, Garde Magik, Annule Garde, Calque, Simple, Inconscient, Corps Sain, les absorptions élémentaires, les talents météo et les talents après contact.

### 3. L'IA de l'overlay 10 n'est pas reproduite complètement

Les moteurs acceptent les `aiFlags` ROM sur 32 bits, mais les sélecteurs n'interprètent directement que les bits `1` et `2` :

- efficacité des types ;
- quelques statuts et soins ;
- pénalité simplifiée pour toucher un allié en double.

Les autres bits sont ignorés et le score est une heuristique Web. Il manque :

- le décodage des routines de score de l'overlay 10 ;
- les profils complets des Champions, Champions d'Arène et combats scénarisés ;
- les décisions natives de changement et d'utilisation d'objet ;
- un comparateur de décisions ROM/Web à état et graine identiques.

Cette lacune modifie directement le comportement des adversaires, même si les règles de dégâts sont correctes.

### 4. La fidélité du flux RNG n'est pas certifiée

Le moteur utilise bien le LCRNG HGSS et les tests sont déterministes. Il manque cependant des traces différentielles contre la ROM pour vérifier le nombre et l'ordre exacts des tirages lors de :

- précision, critique et plage de dégâts ;
- multi-coups et effets secondaires ;
- confusion, paralysie, gel et attirance ;
- objets probabilistes et talents après contact ;
- égalités de Vitesse et choix IA ;
- capture et fuite.

Un résultat statistiquement plausible ne suffit pas pour une fidélité native : une consommation supplémentaire décale tous les résultats suivants.

### 5. Aucune campagne automatique ne joue les 738 Dresseurs

Les données et unités sont testées, mais il n'existe pas de matrice automatique qui prépare puis termine chaque combat de Dresseur avec son vrai format, son équipe, ses objets, ses drapeaux IA et ses capacités ROM.

Il faut au minimum vérifier pour chaque Dresseur :

- préparation sans fallback ni exception ;
- sélection d'une action légale à chaque tour ;
- remplacement après K.O. ;
- terminaison victoire/défaite sans blocage ;
- projection correcte de l'EXP, de l'argent, des objets et de l'équipe persistante.

## Manques confirmés côté présentation

Ces points n'altèrent généralement pas les PV ou l'issue du combat, mais empêchent une reproduction visuelle et sonore à 100 %.

L'inventaire automatisé compte désormais 260 appels natifs et 141 instructions explicitement approximées. Les 272 fondus du décor de base, les 270 fondus de sprites, les 51 appels `HideBattler`, les 5 appels `BlinkAttacker`, les 87 appels `MoveBattlerX`/`MoveBattlerX2`, les 46 trajectoires linéaires d'émetteur, les 73 trajectoires paraboliques, les 105 révolutions d'émetteur, les 7 appels `PlayfulHops` et les 113 commandes de panoramique mobile précédemment classés en fallback sont maintenant pris en charge. Deux fondus visant le fond d'effet restent volontairement classés en fallback tant que ce fond n'est pas rendu par `SwitchBg`.

### 1. La majorité des fonctions natives `CallFunc` n'a pas de rendu dédié

La table contient 85 familles de fonctions natives. Le décodeur de mouvement possède actuellement un rendu confirmé pour dix-sept IDs :

- 4 : rotation/balancement du combattant dans un layout confirmé ;
- 25 : quatre bonds inclinés avec pivots, pas verticaux et alternance natifs ;
- 33 : fondu de palette du décor de base, avec pas et délais HGSS ;
- 34 : fondu de palette des sprites Pokémon ciblés ;
- 36 : secousse ;
- 40 : masquage/réaffichage de l'attaquant, du défenseur ou du partenaire du défenseur ;
- 42 : mise à l'échelle du combattant en arithmétique fixe, y compris le hold limité au premier cycle natif ;
- 50 : clignotement de l'attaquant avec compte et intervalle natifs ;
- 51 et 52 : déplacement horizontal du combattant avec ciblage strict et miroir par côté ;
- 57 : déplacement du combattant ;
- 60 : révolution elliptique du combattant avec angles DS quantifiés et retour final ;
- 65 : trajectoire linéaire d'émetteur, avec délai, courbe, pré-avance et comportement `maxFrames` natifs ;
- 66 : trajectoire parabolique d'émetteur en arithmétique fixe ;
- 72 : révolution d'émetteur adressée par système et poignée ;
- 74 : activation synchrone du filtre monochrome sur le décor de base ;
- 78 : rafraîchissement des sprites Pokémon.

L'inventaire statique de la ROM compte 18 605 instructions et 2 292 appels `CallFunc`. Parmi eux, 1 999 correspondent à un comportement actuellement rendu, 33 sont des no-op natifs confirmés et 260 utilisent encore `native-function-fallback`. Ces trois catégories sont séparées dans la révision 4 du rapport et leur somme est contrôlée. Les mouvements d'émetteur ne sont comptés comme rendus que si leur système et leur poignée ont été résolus à partir d'un `CreateEmitter` ou `CreateEmitterEx` antérieur. Pour les fallbacks restants, le timing peut préserver le déroulement, mais leur mouvement ou effet visuel est absent.

### 2. Les transitions de fond sont uniquement temporisées

`SwitchBg`, `SwitchBgEx` et `RestoreBg` attendent entre 8 et 24 frames, sans appliquer la texture de fond native. L'inventaire contient 60 `SwitchBg` et 69 `RestoreBg`, soit 129 occurrences explicites. Les changements de décor intégrés aux animations sont donc absents.

### 3. Certaines commandes de sprites ne sont pas portées

Les commandes connues qui ne correspondent ni à un handler ni à une instruction déclarative silencieuse produisent `instruction-fallback` avec zéro frame. Les familles à inventorier en priorité comprennent :

- création d'émetteur dépendant de la capacité ou du tir allié ;
- chargement/retrait d'un sprite Pokémon dans un fond ;
- glissements natifs d'entrée/sortie, actuellement ramenés à 8 frames ;
- tâches HGSS 85 et 86, uniquement temporisées.

### 4. Le panoramique sonore mobile est porté

Le corpus contient 113 occurrences de `PlayMovingSoundEffectAtkDef` ; les deux autres variantes ne sont pas présentes dans les 501 scripts de cette ROM. Le runtime Web Audio programme désormais une rampe stéréo entre les panoramiques de départ et d'arrivée, avec le pas et l'intervalle en VBlanks lus dans le script. Le fallback au panoramique initial reste uniquement disponible pour les hôtes externes qui n'exposent pas la primitive mobile.

### 5. Le callback de particules générique 17 n'est que partiellement décodé

Un layout confirmé est décodé exactement. Les autres formes utilisent un ancrage conservateur sur l'attaquant et émettent `approximate-callback`.

### 6. Des émetteurs SPL peuvent être rejetés

Un diagnostic `unsupported-emitter` est produit pour un type d'émission/dessin inconnu, une durée externe non finie, un callback hors 0..22 ou une position irrésolue. Il manque un audit qui exécute les 501 scripts et exige zéro rejet pour toutes les ressources réellement référencées.

### 7. La capture possède encore une animation DOM de secours

La trajectoire principale est fondée sur les valeurs FX32 de la ROM, mais les secousses, sorties et fondus possèdent encore des timings de secours lorsque les ressources natives ne sont pas disponibles.

## Manques de preuve et d'intégration

- Les probes ROM sont désactivés par défaut et ne protègent pas une CI sans ROM.
- Les probes lourds décodent chacun toute la ROM. Lancés en parallèle, le probe des sprites a dépassé 90 s ; relancé seul, il a réussi en 28,5 s.
- Il manque un runner séquentiel de probes de combat avec cache d'inventaire ROM.
- Il manque un test navigateur automatisé d'un combat simple complet et d'un combat double complet.
- Il manque une assertion navigateur sur l'absence de diagnostics `battle-animation-fallback` pendant un corpus de capacités.
- Il manque une comparaison visuelle de référence pour les positions, fonds, particules, HUD, captures et envois de Pokémon.
- Il manque un test de longue durée couvrant plusieurs changements, statuts, météo, pièges, objets et K.O. sans fuite mémoire ni état volatil résiduel.

## Points déjà corrigés et à ne plus compter comme manquants

- Boucles musicales natives et fallback des thèmes finis.
- Absorb Volt, Absorb Eau, Peau Sèche, Motorisé et Torche en simple/double.
- Contournement des absorptions par Brise Moule.
- Absorptions à PV pleins et sous Anti-Soin sans faux soin.
- Télécharge avec Défenses effectives.
- Table Anti-Soin alignée entre simple et double.
- Transmission de Regard Noir par Relais en génération IV.
- Objets tenus, dégâts résiduels et principales interactions Garde Magik/Maladresse/Embargo partagés entre moteurs.

## Plan pour atteindre 100 %

### P0 - Rendre la complétude mesurable

1. Corriger le dénominateur du probe de capacités à 467. **Terminé.**
2. Remplacer les ensembles déclaratifs par un registre d'effets liant chaque ID à son handler et à ses tests.
3. Ajouter un registre analogue pour les 123 talents et les effets d'objets tenus.
4. Faire échouer l'audit si un effet est marqué implémenté sans test comportemental associé.

Critère de sortie : 467/467 capacités nommées, 257/257 effets et 123/123 talents classés avec preuve, sans slot sentinelle.

### P1 - Certifier la logique native

1. Porter tous les profils IA de l'overlay 10 et leurs bits `aiFlags`.
2. Construire des traces différentielles RNG ROM/Web.
3. Simuler les 738 Dresseurs et tous les formats de combat.
4. Ajouter les matrices croisées effet/talent/objet/statut/météo.
5. Ajouter des scénarios de longue durée et de K.O. simultanés.

Critère de sortie : aucune divergence d'état, de choix IA ou de graine sur le corpus de référence.

### P2 - Supprimer les fallbacks d'animation atteignables

1. Inventorier les instructions réellement utilisées dans les 501 scripts.
2. Porter les fonctions `CallFunc` par fréquence d'utilisation.
3. Implémenter les transitions de fond et les sprites dans le fond ; les panoramiques mobiles sont terminés.
4. Décoder tous les layouts du callback 17.
5. Exiger zéro `instruction-fallback`, `native-function-fallback`, `particle-fallback`, `approximate-callback` et `unsupported-emitter` sur le corpus.

Critère de sortie : zéro diagnostic de fallback pendant l'exécution de chaque script atteignable.

### P3 - Certifier le runtime navigateur

1. Automatiser un combat sauvage, un combat de Dresseur, un double et une capture.
2. Vérifier captures d'écran et pixels du canvas sur desktop et mobile.
3. Vérifier sons, cris, musique, annulation et enchaînement des animations.
4. Exécuter les probes lourds séquentiellement avec un inventaire ROM partagé.

Critère de sortie : scénarios E2E stables, aucune erreur console, aucun fallback et aucune fuite d'état ou de ressource.

## Définition recommandée du 100 %

Le combat peut être déclaré terminé à 100 % uniquement lorsque les quatre conditions suivantes sont simultanément vraies :

1. **Logique** : chaque effet, talent, objet, statut et format possède une preuve comportementale.
2. **Fidélité** : les décisions IA et la consommation RNG correspondent aux traces HGSS.
3. **Présentation** : tous les scripts atteignables s'exécutent sans fallback ni approximation.
4. **Intégration** : tous les Dresseurs et scénarios navigateur de référence se terminent sans blocage, erreur ou divergence persistante.

L'état actuel satisfait largement la jouabilité et la couverture de données, mais pas encore ces quatre critères de certification.
