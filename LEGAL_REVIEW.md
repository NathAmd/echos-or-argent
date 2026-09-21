# Préparation juridique — 21 septembre 2026

Cette préparation réduit certains risques ; elle ne certifie pas la légalité
du projet et ne remplace pas un examen par un juriste en propriété intellectuelle.

## Nom et contenu

Nom descriptif proposé : **Échos d’Or & d’Argent**, chemin **styloxis.be/echos-or-argent/**,
dépôt proposé **echos-or-argent**. Aucun résultat de recherche de marque
exhaustif n'est revendiqué. Vérifier les marques identiques et similaires,
leurs territoires et produits/services via le
[BOIP](https://www.boip.int/fr/registre-des-marques) et, si nécessaire, l'EUIPO.
Changer de nom ou afficher « non officiel » ne donne aucun droit sur un jeu.

Le dépôt et le build doivent exclure ROM, extractions, captures et références
privées. La ROM reste fournie localement par l'utilisateur ; ce choix technique
ne résout pas à lui seul les questions de reproduction, adaptation et marques.
Les exceptions logicielles, dont la sauvegarde et l'interopérabilité, ont des
conditions : ne pas présenter « posséder la cartouche » comme une autorisation
générale de téléchargement ou de contournement.
Voir le [SPF Économie](https://economie.fgov.be/fr/themes/propriete-intellectuelle/droits-de-propriete/droits-dauteur-et-droits/droits-dauteur/propriete-intellectuelle-des/utilisation-de-logiciels/quels-sont-mes-droits-legard)
et l'[arrêt Nintendo / PC Box](https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX%3A62012CJ0355).

## Vérifications restant à faire par l'éditeur

- Confirmer identité juridique, statut personnel/professionnel et coordonnées
  à publier. La notice reprend seulement le nom abrégé et l'email déjà publics
  sur styloxis.be. Si l'activité relève d'une entreprise, compléter notamment
  adresse, numéro BCE/TVA et contacts selon le
  [SPF Économie](https://economie.fgov.be/fr/themes/line/commerce-electronique/vente-par-internet/site-dentreprise-et-comptes).
- Examiner la provenance des implémentations qui citent des décompilations,
  et celle des textures/cadres. Voir [RIGHTS.md](RIGHTS.md). Aucun audit complet
  de titularité ou de licences du code existant n'a été effectué.
- Valider le nom et l'utilisation publique des références de compatibilité.
- Avant d'activer comptes, coffre, multijoueur, analytics ou monétisation,
  adapter la notice aux traitements réels : responsable, finalités, bases
  légales, destinataires, conservation, transferts et exercice des droits.
  Le workflow alpha est volontairement configuré en solo.

## Confidentialité et hébergement

La notice publique décrit IndexedDB, le stockage des sauvegardes, les exports
de diagnostic, GitHub Pages et la météo géolocalisée facultative. Elle ne promet
pas « aucune donnée collectée » : les hébergeurs reçoivent les requêtes réseau.
L'intégration en iframe délègue seulement plein écran et géolocalisation ;
la géolocalisation reste soumise à l'autorisation du navigateur.

Sources : [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement),
[Open-Meteo](https://open-meteo.com/en/terms).
L'API gratuite Open-Meteo impose des conditions, notamment pour l'usage
commercial ; les vérifier si le contexte d'exploitation change. Attribution
des données CC BY 4.0 ajoutée dans la notice.

## Historique Git

Un nouvel historique local empêche de republier automatiquement les anciens
commits. Il n'efface ni l'ancien dépôt GitHub, ni ses forks, caches, releases
ou clones. Si un secret a déjà été exposé, le révoquer : supprimer l'historique
ne suffit pas. Les scans automatiques de cette préparation ne prouvent pas
l'absence de tout secret ni de contenu protégé.
