## Résumé

Décrire le comportement modifié et la raison du changement.

## Validation

- [ ] Client : `npm run lint`, `npm test`, `npm run build` et `npm run verify:build`
- [ ] Serveur (si concerné) : `npm run typecheck`, `npm test` et `npm run build`
- [ ] Une régression corrigée possède un test automatisé
- [ ] Les changements liés aux données, scripts ou parcours ROM ont passé `npm run test:rom-audit`
- [ ] Les parcours visuels ou d’entrée concernés ont été vérifiés au clavier, à la manette et/ou au tactile selon leur portée

## Frontière de données

- [ ] Aucun binaire ROM, sauvegarde, média extrait, rapport brut, secret ou clé privée n’est ajouté
- [ ] Le serveur reste générique et n’importe aucun module du client
- [ ] Les ressources attendues de la ROM échouent explicitement au lieu d’utiliser un substitut arbitraire

## Risques et retour arrière

Indiquer les migrations, incompatibilités de sauvegarde, effets réseau et méthode de retour arrière, ou écrire « aucun ».
