# Politique de sécurité

## Signaler une vulnérabilité

Ne publiez pas de vulnérabilité exploitable, de jeton, de sauvegarde ou de
donnée personnelle dans une issue publique. Utilisez en priorité **Security →
Report a vulnerability** sur le dépôt GitHub. Si ce canal n’est pas disponible,
ouvrez une issue sans détail technique afin de demander un moyen de contact
privé.

Le rapport doit préciser la version ou le commit concerné, l’impact attendu,
les prérequis et une reproduction minimale dépourvue de ROM, de sauvegarde et
de secret réels. N’effectuez aucun test destructif sur une instance ou un compte
qui ne vous appartient pas.

## Versions couvertes

La branche `main` est la seule ligne corrigée. Les builds, images ou forks plus
anciens ne reçoivent pas de correctif garanti. Ce projet personnel ne fournit
pas de délai de réponse ni de programme de récompense.

## Périmètre

Sont notamment dans le périmètre : authentification, autorisations, coffre
opaque, sessions partagées, signalisation, isolation client/serveur, build et
chaîne de dépendances. Les écarts de fidélité de gameplay sans impact sur les
données, les comptes ou l’hôte relèvent du suivi fonctionnel habituel.

Une ROM reste strictement locale. N’en joignez jamais une à un rapport et ne
l’ajoutez jamais au dépôt.
