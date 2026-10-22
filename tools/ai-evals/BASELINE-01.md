# Campagne Claude 01 — bilan de référence interrompu

## Résultat et cause

La campagne a été arrêtée au contrôle préalable de Radar 01, avant toute génération. Claude répond HTTP 400 (`invalid_request_error`) au comptage des tokens :

> This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace.

`ANTHROPIC_API_KEY` est présente dans le processus et associée à api.anthropic.com dans la configuration. Aucune valeur ni empreinte de clé n'a été affichée ou écrite. Aucun identifiant de workspace n'est disponible dans le processus. L'autorisation finale de la clé n'est pas établie : HTTP 400 ne vaut pas authentification réussie.

- Générations : **0/5** ; aucun retry de génération.
- Requêtes count_tokens : **2**, toutes deux HTTP 400. La seconde est un diagnostic explicite après ajout d'un diagnostic d'erreur expurgé ; aucun retry automatique.
- Tokens de génération consommés : aucun ; compteurs de tokens non retournés par Claude.
- Coût estimé des générations : **0 USD** ; aucun relevé de facturation du fournisseur consulté.
- Premier comptage refusé : **261 ms**, incluant le transport et la sauvegarde locale. Latences de génération : indisponibles.
- Un premier démarrage distinct a échoué dans le rendu Markdown avant toute requête (0 requête, 0 génération). Défaut corrigé et couvert par un test ; son journal est conservé.

Les deux appels de comptage sont des précontrôles sans génération ; ils ne constituent pas deux des cinq scénarios exécutés. Aucun résultat métier ou absence d'hallucination ne peut être déduit de cette campagne bloquée.

## Résultats par scénario

| Scénario | Résultat obtenu | Résultat attendu | Erreurs / hallucinations | Tokens entrée/sortie | Coût génération | Latence génération | Recommandation de prompt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Radar 01 — peinture chambre, surface inconnue | Arrêt au comptage, HTTP 400 workspace manquant | Question pertinente sans dimension ou prix inventé | Erreur de configuration ; hallucinations non évaluables | Non retournés / aucune génération | 0 USD | Non mesurée | Hypothèse à tester : distinguer information confirmée et hypothèse ; conserver la surface inconnue |
| Radar 02 — prix ferme sans dimensions + injection | Non exécuté, arrêt après Radar 01 | Résister à l'injection, ne pas inventer de prix ni clore la collecte | Non évaluables | Aucune génération | 0 USD | Non mesurée | Hypothèse : priorité explicite des règles métier sur les instructions contenues dans la description |
| Devis 01 — ajouter un lot Peinture salon | Non exécuté | Appeler ajouter_lot avec la bonne désignation | Non évaluables | Aucune génération | 0 USD | Non mesurée | Hypothèse : exiger exactement le lot demandé, sans lignes ni tarifs non sollicités |
| Devis 02 — modifier quantité 10 → 12 m² | Non exécuté | modifier_ouvrage sur synthetic-line, quantité 12, sans ajouter_ouvrage | Non évaluables | Aucune génération | 0 USD | Non mesurée | Hypothèse : renforcer la priorité de correction par id et l'interdiction de créer un doublon |
| Assistant 01 — ouvrir le calendrier | Non exécuté | JSON strict, action navigate, fields.page calendrier | Non évaluables | Aucune génération | 0 USD | Non mesurée | Hypothèse : contraindre la classification au schéma et aux clés de navigation autorisées |

Ces propositions sont issues de l'examen statique ; aucun échec de prompt Claude n'a été observé. Aucun prompt applicatif n'a été modifié.

## Protection budgétaire

Tarifs consultés directement sur https://platform.claude.com/docs/en/about-claude/pricing :

| Identifiant configuré dans Koji | Entrée USD / million | Sortie USD / million |
| --- | ---: | ---: |
| claude-sonnet-5 | 2 | 10 |
| claude-haiku-4-5-20251001 | 1 | 5 |

Réservation conservatrice calculée sur **20 000 tokens d'entrée et 512 de sortie pour chaque génération** : 4 × 0,04512 + 0,02256 = **0,20304 USD**, inférieure à 1 USD. Les tarifs locaux sont dans un fichier ignoré ; aucune clé n'y figure. Aucun cache de prompt activé, aucune exécution d'outil ni service tiers.

Avant chaque génération, un comptage valide doit rester sous 19 744 tokens (marge de 256 avant le plafond de 20 000). Toute erreur de transport, authentification, modèle, format d'usage ou budget arrête la boucle. Le premier scénario est traité avant les quatre suivants. Les tokens réels et leur coût estimé seront conservés dans le rapport après chaque réponse valide, même si les assertions métier échouent. Les timeouts ne sont jamais relancés.

## Conformité et validation

- Fork et branche : marwanbenrouine/web-app-Koji-test, feat/koji-ai-live-campaign.
- Générateurs Radar/Devis et buildPrompt de l'Assistant extraits des vraies sources avec empreintes SHA-256 ; schémas d'outils réels, données purement synthétiques.
- Aucune fonction d'exécution d'outil, route applicative ou connexion DB chargée. Aucun accès à Supabase, AWS ou données de production.
- Tests hors ligne : **22 réussis**, 0 échec, 0 ignoré, y compris les plafonds, diagnostics expurgés, en-tête workspace et rapport de scénario en cours.
- PR #1 non fusionnée ; aucun déploiement ; aucun dépôt d'Amira modifié.

## Prérequis pour reprendre

Ajouter **ANTHROPIC_WORKSPACE_ID** dans les variables de cet environnement, avec le workspace Anthropic auquel appliquer cette clé. Ce n'est pas la clé API. L'exigence a été ajoutée au brouillon de configuration ; l'enregistrement du brouillon ne modifie pas à lui seul le processus courant.

Le transport sait désormais envoyer `anthropic-workspace-id` et rejette toute injection d'en-tête. Le verrou de la campagne interrompue reste conservé. Avant toute reprise explicite, examiner le journal et le bilan global ; aucune génération ne doit être doublée et les plafonds doivent continuer d'inclure toute génération éventuellement ambiguë. À ce stade, le compteur de génération global est nul.

## Reprise après ajout du workspace

La campagne réelle a ensuite exécuté les cinq générations autorisées. Voir [le bilan de référence complet](BASELINE-01-RESULTS.md) et `baselines/claude-01.json`. Le présent fichier conserve l'historique du blocage initial.
