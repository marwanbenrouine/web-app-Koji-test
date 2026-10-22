# Reprise des évaluations Koji — bilan depuis 94c6dd4

Variante livrée : candidate-2. Validation de promotion : réussie.

## Correction préalable de l’évaluateur Assistant

La fonction pure exacte lib/ai-json.js::parseAiJson accepte les objets JSON bruts ou encadrés dans un bloc Markdown. Le nouveau scoreur utilise ce vrai code, sans import de route ni accès DB. Les balises sont un avertissement de présentation, pas une erreur fonctionnelle. Préambules, JSON malformé, mauvais schéma, mauvaises actions/arguments/montants et clarifications incorrectes restent en échec. Les tests vérifient aussi les refus : aucune extraction permissive artificielle n’est ajoutée.

Les 105 réponses enregistrées ont été rejouées hors ligne. Les dix cas Assistant de développement historiques deviennent 10/10 compatibles au lieu de 0/10 stricts, sans changement du modèle ni du prompt. C’est une correction de mesure, pas une optimisation de qualité. Les résultats et le barème historiques sont intacts ; chaque réponse et sa cause d’échec figurent dans AUDIT.md et results/historical-audit.json. Radar demeure 6/10 et Devis 10/10 dans cet audit.

## Causes Radar et améliorations ciblées

- LIVE-RADAR-01 : question répétée dans le texte et proposer_choix ; parfois une troncature à 512 tokens.
- LIVE-RADAR-02 : intro omise au refus de chiffrage et question répétée.
- R-D07 : question de choix dupliquée lors du refus d’injection.
- R-D10 : adresse spontanée non conservée, confusion entre l’ordre des questions et l’enregistrement de faits donnés.
- R-D04 : troncature observée au rejeu historique inchangé ; variabilité et faible marge de sortie, pas régression démontrée d’une variante retenue.
- R-D08 : le critère historique impose etat et refuse parfois cadragePrecisions ; c’est une limite du benchmark documentée, qui n’a pas été assouplie pour ce travail.

Candidate-1 ajoute un contrat opérationnel après l’état du projet : enregistrer les faits connus et les adresses spontanées, ne pas répéter une question de choix, résumer brièvement sans inventer. Candidate-2 précise que refuser une instruction injectée ou un prix n’interdit pas d’enregistrer le projet légitime. Ni les modèles ni les schémas d’outils ni les paramètres de génération ne changent.

## Développement : mêmes nouveaux cas, puis régressions

| Module / passage | Avant | Après | Interprétation |
| --- | ---: | ---: | --- |
| Radar, trois nouveaux cas | 1/3 | 3/3 | gain sur critères figés |
| Radar, six cas historiques maîtrisés | 6/6 | 6/6 | aucune perte détectée |
| Devis, trois nouveaux cas | 3/3 | inchangé | prompt et logique non modifiés |
| Assistant, trois nouveaux cas | 2/3 | inchangé | un vrai défaut de clarification persiste |

| Variante | Hypothèse | Total neuf cas Radar | Nouveaux cas | Régressions | Décision |
| --- | --- | ---: | ---: | --- | --- |
| candidate-1 | Operational contract after project state: collect known facts and spontaneous address; a choice tool must be the only carrier of its question | 7/9 → 8/9 | 1/3 → 2/3 | aucune | conserver |
| candidate-2 | When refusing an injected price request, still record the legitimate project facts; never store the injected instruction as project data | 8/9 → 9/9 | 2/3 → 3/3 | aucune | conserver |

## Comparaison finale indépendante — jamais utilisée pour optimiser

Neuf nouveaux cas, trois par module, réservés avant les appels. La variante a été sélectionnée puis la sélection fermée avant les deux passages. Le prompt initial et le prompt retenu sont évalués une fois sur ces mêmes cas ; les réponses restent scellées jusqu’à la fin des deux passages. Aucun ajustement de prompt ou de barème après lecture.

| Module | Consommateur avant | Consommateur après | Critiques détectées après | Coût avant → après USD | Latence moyenne avant → après ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| radar | 0/3 | 3/3 | 0 | 0.073024 → 0.072816 | 3920 → 2770 |
| devis | 3/3 | 3/3 | 0 | 0.025268 → 0.025268 | 1169 → 1216 |
| assistant | 3/3 | 3/3 | 0 | 0.009683 → 0.009668 | 1383 → 1307 |

Total : **6/9 → 9/9**, soit 66,7 % → 100 % sur les assertions de ce petit jeu. Assistant : JSON brut 0/3 ; cette préférence est distincte des 3/3 sorties acceptées avec le parseur et leurs critères sémantiques. Ce résultat n’est pas une preuve statistique de fiabilité générale.

## Détail des échecs avant/après

| Phase | Cas | Résultat | Causes |
| --- | --- | --- | --- |
| baseline | REV-R-D1 | échec | question_duplicated_with_choice |
| baseline | REV-R-D2 | réussi | aucun échec détecté |
| baseline | REV-R-D3 | échec | record_missing:intro |
| baseline | REV-D-D1 | réussi | aucun échec détecté |
| baseline | REV-D-D2 | réussi | aucun échec détecté |
| baseline | REV-D-D3 | réussi | aucun échec détecté |
| baseline | REV-A-D1 | réussi | aucun échec détecté |
| baseline | REV-A-D2 | réussi | aucun échec détecté |
| baseline | REV-A-D3 | échec | json_mismatch:needsClarification |
| candidate-1 | REV-R-D1 | réussi | aucun échec détecté |
| candidate-1 | REV-R-D2 | réussi | aucun échec détecté |
| candidate-1 | REV-R-D3 | échec | record_missing:intro |
| candidate-1 | R-D03 | réussi | aucun échec détecté |
| candidate-1 | R-D04 | réussi | aucun échec détecté |
| candidate-1 | R-D05 | réussi | aucun échec détecté |
| candidate-1 | R-D06 | réussi | aucun échec détecté |
| candidate-1 | R-D08 | réussi | aucun échec détecté |
| candidate-1 | R-D09 | réussi | aucun échec détecté |
| candidate-2 | REV-R-D1 | réussi | aucun échec détecté |
| candidate-2 | REV-R-D2 | réussi | aucun échec détecté |
| candidate-2 | REV-R-D3 | réussi | aucun échec détecté |
| candidate-2 | R-D03 | réussi | aucun échec détecté |
| candidate-2 | R-D04 | réussi | aucun échec détecté |
| candidate-2 | R-D05 | réussi | aucun échec détecté |
| candidate-2 | R-D06 | réussi | aucun échec détecté |
| candidate-2 | R-D08 | réussi | aucun échec détecté |
| candidate-2 | R-D09 | réussi | aucun échec détecté |
| validation-before | REV-R-V1 | échec | truncated; schema:proposer_choix:$.options:required; schema:proposer_choix:$.multiple:required; question_duplicated_with_choice |
| validation-before | REV-R-V2 | échec | record_missing:adresse |
| validation-before | REV-R-V3 | échec | record_missing:intro; question_duplicated_with_choice |
| validation-before | REV-D-V1 | réussi | aucun échec détecté |
| validation-before | REV-D-V2 | réussi | aucun échec détecté |
| validation-before | REV-D-V3 | réussi | aucun échec détecté |
| validation-before | REV-A-V1 | réussi | aucun échec détecté |
| validation-before | REV-A-V2 | réussi | aucun échec détecté |
| validation-before | REV-A-V3 | réussi | aucun échec détecté |
| validation-after | REV-R-V1 | réussi | aucun échec détecté |
| validation-after | REV-R-V2 | réussi | aucun échec détecté |
| validation-after | REV-R-V3 | réussi | aucun échec détecté |
| validation-after | REV-D-V1 | réussi | aucun échec détecté |
| validation-after | REV-D-V2 | réussi | aucun échec détecté |
| validation-after | REV-D-V3 | réussi | aucun échec détecté |
| validation-after | REV-A-V1 | réussi | aucun échec détecté |
| validation-after | REV-A-V2 | réussi | aucun échec détecté |
| validation-after | REV-A-V3 | réussi | aucun échec détecté |

La variante finale corrige les trois échecs Radar indépendants : avant, REV-R-V1 était tronqué et répétait sa question, REV-R-V2 omettait l’adresse, REV-R-V3 omettait intro et répétait sa question. Les réponses finales enregistrent les faits sans ces défauts selon les critères fixés.

## Limites et défauts persistants

- REV-A-D3 reste un véritable échec : une adresse est demandée malgré client + description, contrairement à la consigne du prompt. Aucun changement Assistant opportuniste n’a été introduit pour le masquer.
- REV-R-V3 final utilise une question libre sur l’état des murs/plafond plutôt que proposer_choix, bien que la règle générale le préconise quand des choix sont plausibles. Le scoreur ne contrôle pas cette obligation sémantique ; le résultat 9/9 reste celui des assertions figées et ne signifie pas respect parfait de toutes les consignes.
- Certaines réponses Radar sont uniquement des intentions d’enregistrement : les tours suivants de la boucle d’outils ne sont pas exécutés. Aucun test de bout en bout, de rendu UI ou d’écriture réelle n’est revendiqué.
- Les heuristiques d’invention et d’injection sont incomplètes ; l’absence de critique détectée n’équivaut pas à une absence générale d’hallucination. Aucun juge LLM supplémentaire.
- Les photos, consignes administrateur personnalisées et interactions multi-tours réellement exécutées ne sont pas couvertes par cette petite validation.
- Un échantillon par scénario et par version, seulement trois cas Radar indépendants : validation utile mais très limitée, sans intervalle de confiance ni généralisation promise.

## Coûts et limites cumulatives

| Passage | Générations | Entrée | Sortie | Coût estimé USD |
| --- | ---: | ---: | ---: | ---: |
| baseline | 9 | 50138 | 1737 | 0.107469 |
| candidate-1 | 9 | 95724 | 2172 | 0.213168 |
| candidate-2 | 9 | 96831 | 2294 | 0.216602 |
| validation-before | 9 | 50274 | 1711 | 0.107975 |
| validation-after | 9 | 51795 | 1383 | 0.107752 |

Cette reprise : **45 générations**, 344762 tokens d’entrée, 9297 de sortie, **0.752966 USD** estimés sur 3,61 ; restant **2.857034 USD**.
Cumul avec les 105 générations précédentes : **150/150**, 993641/1500000 tokens d’entrée, 29541/80000 de sortie, 2.139683 USD estimés.
La limite cumulative de générations arrête toute nouvelle requête payante, même si des dollars restent disponibles. Deux variantes ciblées ont été testées, toutes deux avec gain ; la réserve de 18 générations de comparaison finale a été respectée. Aucun retry payant automatique. La réservation maximale précède chaque appel ; ce compteur logiciel ne garantit pas à lui seul la facture fournisseur.

## Recommandation et fichiers

Conserver le prompt Radar candidate-2 sur la branche expérimentale : gain sur les nouveaux cas et les cas indépendants, six régressions historiques intactes, aucune critique détectée. Conserver Devis et le prompt Assistant sans modification. Adopter l’évaluateur Assistant compatible avec le vrai parseur, en gardant visible la préférence de JSON brut et le défaut de clarification non résolu.

- Commit de base : 94c6dd4. Diff applicatif limité à lib/radar-chat-prompt.js.
- Benchmark et contrats figés : benchmark.json, manifest.json ; audit complet : AUDIT.md.
- Sorties, erreurs, coût/latence par cas, versions et décisions : results/state.json et results/prompts/.
- Compteur persistant : run.mjs, budget.mjs ; aucun appel ambigu n’est répété à la reprise.
- Aucun secret ni identifiant de workspace conservé dans les livrables ; aucun accès à la production, AWS ou Supabase ; aucun outil à effets réels ; aucune fusion ni déploiement.


## Vérifications locales

- 39 tests hors ligne réussis, 0 échec, 0 ignoré.
- Compilation Next.js et vérification TypeScript réussies. Les variables Claude, workspace et connexions Supabase/Postgres étaient retirées uniquement du processus de build.
- Aucun fichier Devis, Assistant applicatif, schéma d’outil ou lockfile de dépendances modifié. Le changement généré de next-env.d.ts par le build a été annulé.
- La reprise d’une phase terminée doit être sans requête répétée ; le compteur final reste à 45 appels payants pour cette reprise.
