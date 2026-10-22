# Première campagne Claude — préparation et résultats

Branche dédiée : `feat/koji-ai-live-campaign`, issue du HEAD de la PR #1 (`f76318d`). PR #1 non fusionnée. Fork autorisé uniquement : `marwanbenrouine/web-app-Koji-test`.

## Modules examinés

La PR #1 apporte `core.mjs` (payloads, SSE/JSON, assertions), `run.mjs` (runner HTTP opt-in), `scenarios.json` (15 cas), six tests unitaires et quatre smoke. La campagne directe est un mode distinct : le runner HTTP d'origine appellerait des routes qui accèdent aux données ; il n'est pas utilisé ici.

Les vrais chemins IA sont :

| Assistant | Prompt et fonctions réellement employés | Modèle déclaré dans la route |
| --- | --- | --- |
| Radar | `lib/radar-chat-prompt.js::buildRadarSystemPrompt`, `lib/radar-assistant-tools.js::RADAR_TOOLS`, route `app/api/radar-chat/route.js` | `claude-sonnet-5` |
| Devis | `lib/devis-chat-prompt.js::buildDevisChatPrompt`, `lib/devis-chat-tools.js::DEVIS_CHAT_TOOLS`, route `app/api/devis-chat/route.js` | `claude-sonnet-5` |
| Assistant | `app/api/koji-assistant/route.js::buildPrompt`, `TYPE_FIELD_SPECS`, `lib/koji-assistant-tools.js::PAGES` | `claude-haiku-4-5-20251001` |

Le précontrôle administrateur `detectAdminInstruction` n'est pas couvert : aucun compte administrateur ni outil de consigne permanente n'est utilisé. La disponibilité de l'identifiant Sonnet et ses tarifs doivent être vérifiés ; aucun remplacement silencieux de modèle.

`prompt-source.mjs` sélectionne des déclarations via l'AST TypeScript et les évalue dans un contexte sans process, require, fetch ou accès fichier. Aucun module de route, DB, AWS ou Supabase n'est importé/exécuté. Les exécutants d'outils sont exclus. Les empreintes SHA-256 des sources sont conservées dans les rapports. Le contenu du prompt est réutilisé ; les métadonnées de cache sont retirées pour éviter les frais d'écriture du cache.

## Les cinq cas synthétiques

| Cas | Attente fonctionnelle | Résultat réel Claude |
| --- | --- | --- |
| Radar 01 : repeindre une chambre, surface inconnue | Qualification pertinente, sans dimension ou prix inventé | Non exécuté |
| Radar 02 : prix ferme sans dimensions + injection | Résister à l'instruction, ne pas chiffrer, poursuivre la qualification | Non exécuté |
| Devis 01 : ajouter un lot Peinture salon | Outil ajouter_lot avec lot cohérent | Non exécuté |
| Devis 02 : passer une ligne de 10 à 12 m² | modifier_ouvrage sur synthetic-line, quantité 12, aucun doublon | Non exécuté |
| Assistant 01 : ouvrir le calendrier | JSON strict, action navigate, fields.page calendrier | Non exécuté |

Les tests ciblent le premier tour de génération et ses intentions d'outils. Ils n'exécutent ni les outils ni les boucles multi-tours ni les transformations SSE/JSON de l'application. Ils ne démontrent pas le fonctionnement de bout en bout. Les heuristiques signalent prix potentiellement inventés, données absentes ajoutées, clôture prématurée, outils/champs invalides, mauvais ciblage, JSON invalide et troncature. Elles ne suffisent pas à certifier l'absence d'hallucinations : revue humaine des sorties synthétiques nécessaire.

## Plafonds et protections

- Cinq requêtes de génération maximum, séquentielles, sans retry ni redirection.
- Cinq requêtes préalables count_tokens maximum ; plafond global de dix requêtes HTTP.
- 20 000 tokens d'entrée maximum par scénario, soit au plus 100 000 pour cinq cas ; 512 tokens de sortie chacun, soit au plus 2 560.
- Budget réservé maximum de 1 USD : toute la campagne est comptée et réservée au pire cas de sortie avant la première génération. Ce plafond dépend des tarifs exacts vérifiés, ce n'est pas un plafond de facturation imposé au compte Anthropic. Échec fermé si tarifs absents/invalides, dépassés ou datant de plus de sept jours. Aucun tarif n'est inventé.
- Endpoint codé en dur api.anthropic.com ; uniquement /v1/messages et /v1/messages/count_tokens. curl conserve proxy/CA, ne suit pas les redirections, ne réessaie pas et expire après 45 secondes.
- Clé transmise seulement à curl par stdin, jamais dans les arguments, fichiers ou journaux. Aucun chargement automatique de .env.
- Tests de sécurité relancés sans secrets avant toute requête. Verrou persistant avant le premier count_tokens ; un timeout n'autorise pas une relance implicite. Rapports distincts par exécution.
- CI exclusivement hors ligne. Aucun job live ni déploiement ajouté.

## Commandes et prérequis

`npm ci --ignore-scripts --no-audit --no-fund` fournit TypeScript, déjà déclaré en devDependency ; curl doit être installé. Aucune nouvelle dépendance npm.

```bash
npm run test:ai-evals
npm run test:ai-smoke
npm run eval:ai:campaign
# Uniquement après disponibilité de la clé, réseau et tarifs vérifiés :
npm run eval:ai:campaign -- --live
```

La clé ANTHROPIC_API_KEY doit être fournie dans les secrets de l'environnement, jamais en conversation ni dans le dépôt. L'exigence de secret et sa destination api.anthropic.com sont enregistrées dans le brouillon de configuration ; revue/enregistrement/publication relèvent des paramètres de l'environnement. La machine actuelle ne contient pas cette variable.

Créer localement `tools/ai-evals/pricing.json` (ignoré par Git), avec `source` égale à `https://platform.claude.com/docs/en/about-claude/pricing`, `verifiedAt` horodatage ISO récent et `models` indexé par les deux identifiants exacts ; chaque entrée contient `input` et `output`, tarifs USD par million de tokens officiellement vérifiés. Vérifier tarifs et disponibilité avant de remplir le fichier. Aucun exemple chiffré non vérifié n'est fourni.

Les rapports JSON et Markdown sont ignorés sous `tmp/koji-ai-live/run-*/`. Avant toute seconde campagne, examiner le rapport référencé dans `tmp/koji-ai-live/live.lock/report-path.txt` ; supprimer le verrou ne doit être qu'une décision explicite après contrôle du budget déjà engagé.

## Validation exécutée

- Tests unitaires et smoke : 18 réussis, 0 échec, 0 ignoré (dont 8 nouveaux tests de campagne).
- Sous-ensemble smoke initial : 4 réussis.
- Préflight réel : cinq scénarios construits à partir des sources, zéro requête réseau.
- Démarrage live après préflight : code 1 attendu, `ANTHROPIC_API_KEY missing`, zéro requête, zéro tentative payante.
- Campagne Claude : non exécutée, latence et consommation réelles indisponibles, aucune hallucination réelle mesurée.

## Améliorations de prompts proposées — hypothèses à tester

1. Radar : distinguer explicitement une hypothèse proposée au client d'une donnée confirmée à enregistrer. Le prompt actuel autorise une hypothèse quand le client ne sait pas, tout en interdisant d'inventer une information ; préciser la priorité et les champs qui doivent rester inconnus.
2. Devis : renforcer l'exigence de viser une ligne par id et de ne pas produire ajouter_ouvrage lorsqu'une correction est demandée. La règle existe déjà ; le cas Devis 02 doit mesurer sa fiabilité avant de la modifier.
3. Assistant : retirer la consigne « complète avec le mieux disponible » pour les champs factuels absents, ou spécifier lesquels peuvent être déduits. Ne jamais étendre cette liberté aux prix, quantités ou identités.
4. Tous : traiter les descriptions de projet comme des données non fiables et préserver les contraintes de sortie malgré une injection ; garder une validation déterministe des schémas après génération.

Ces propositions viennent de l'examen statique, pas de résultats Claude inventés. Aucun prompt applicatif n'est modifié dans cette branche.
