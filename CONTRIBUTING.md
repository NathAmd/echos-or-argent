# Contribuer

Le dépôt contient deux projets Node indépendants : `web/` pour le client
statique et `server/` pour le service privé. Une modification qui touche les
deux doit préserver cette séparation ; le client ne doit jamais importer le
serveur et le serveur ne doit contenir aucune donnée propre à une ROM ou à une
sauvegarde.

## Contenu interdit

Ne committez jamais de ROM, extrait binaire, sauvegarde joueur, capture contenant
des données privées, clé, jeton, fichier `.env`, certificat ou artefact de build.
Utilisez uniquement des fixtures synthétiques minimales dans les tests.

## Validation locale

Client :

```bash
cd web
npm ci
npm run lint
npm test
npm run build
npm run verify:build
```

Serveur :

```bash
cd server
npm ci
npm run typecheck
npm test
npm run build
```

Ajoutez un test de régression pour toute correction observable. Une pull request
doit décrire son comportement, ses risques de migration et les validations
effectuées. Les tests nécessitant une ROM restent locaux et ne doivent ni
télécharger ni publier ce contenu.

Les vulnérabilités suivent [SECURITY.md](./SECURITY.md) et ne doivent pas être
détaillées dans une issue ou une pull request publique.
