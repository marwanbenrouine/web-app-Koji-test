# Reprise ciblée : parseur Assistant et prompt Radar

Base `94c6dd4`, fork exclusif marwanbenrouine/web-app-Koji-test. Les résultats et barèmes historiques ne sont pas écrasés.

## Évaluation du consommateur

`evaluator.mjs` exécute la fonction pure exacte de `lib/ai-json.js`, sans importer de route, authentification ou base. JSON brut et bloc Markdown accepté par ce parseur ont le même statut fonctionnel. La préférence de présentation est enregistrée séparément dans `presentation` ; elle n'influence pas le succès du consommateur. Aucun nettoyage plus permissif que le vrai parseur : préambule, JSON malformé, tableau au lieu d'objet ou schéma incorrect restent en échec. Les mauvaises actions, arguments, quantités, prix, clarifications et champs inventés gardent les contrôles précédents.

`AUDIT.md` et `results/historical-audit.json` recalculent hors ligne les 105 réponses historiques sans frais. Le passage Assistant 0/10 → 10/10 historique est une correction de mesure, jamais présenté comme un gain de prompt. Les cas Radar 6/10 et Devis 10/10 restent identiques sous ce scoreur. Les critères historiques trop spécifiques, dont etat au lieu de cadragePrecisions pour R-D08, ne sont pas modifiés et sont documentés.

## Nouveaux cas et validation indépendante

18 scénarios nouveaux, figés avant le premier appel : 9 de développement (3 par assistant), 9 de validation indépendante (3 par assistant). Six cas Radar historiquement réussis s'ajoutent à chaque essai de variante pour surveiller les régressions. Les attentes, le parseur, le scoreur, les tarifs/paramètres et la référence historique sont verrouillés par SHA-256 dans manifest.json.

Les résultats de validation-before et validation-after sont tenus à l'écart jusqu'à la fin des deux phases. La variante est sélectionnée avant tout appel sur ces cas. Aucune variante supplémentaire n'est optimisée ensuite. Règle de promotion fixée avant validation : aucune critique détectée, pas de baisse Radar sur les cas indépendants, pas de perte des cas Devis indépendants. En cas d'échec, les prompts initiaux sont restaurés sans nouvelle optimisation sur les résultats de validation.

## Budget cumulatif et reprise

Plafonds de cette reprise : 3,61 USD ; au plus 45 nouvelles générations (105 + 45 = 150), 851 121 tokens d'entrée et 59 756 de sortie restant sous les plafonds précédents. Chaque génération reste à 20 000 tokens d'entrée maximum avec marge préalable et 512 de sortie. Aucun retry payant, aucun évaluateur LLM. Dix-huit générations finales sont réservées dès le départ avec leurs tokens/coût conservateurs ; deux variantes Radar de neuf générations au plus sont donc possibles après les neuf références nouvelles.

Le journal `results/state.json` est écrit atomiquement et synchronisé avant chaque appel. Tout appel ambigu reste facturé dans le compteur au maximum de sa réservation jusqu'à audit, sans relance automatique. Les générations terminées sont sautées à la reprise. Les secrets et le workspace sont transmis via stdin de curl et ne sont jamais dans les résultats. Un verrou interdit les exécutions concurrentes. Les outils réellement exécutés, les boucles sur base, la production, AWS et Supabase sont exclus. Les schémas sont réels ; les seules données fournies à Claude sont synthétiques.

Commandes depuis la racine :

```bash
npm run test:ai-evals
npm run eval:ai:revision -- baseline
# Après modification ciblée de lib/radar-chat-prompt.js :
npm run eval:ai:revision -- candidate-1
node tools/ai-evals/revision/decide.mjs candidate-1 'Hypothèse de modification'
# Une seconde modification facultative au maximum : candidate-2.
node tools/ai-evals/revision/decide.mjs close
# Conserver le snapshot sélectionné.
# Restaurer le prompt initial pour validation-before, puis le sélectionné pour validation-after.
npm run eval:ai:revision -- validation-before
npm run eval:ai:revision -- validation-after
```

Une variante doit améliorer les nouveaux cas ET le total incluant les six régressions, sans aucune critique détectée. Les régressions non critiques restent exposées, jamais masquées. Deux variantes sans gain entraînent l'arrêt ; la limite cumulative d'appels empêche tout essai supplémentaire. Devis et Assistant ne sont pas modifiés pendant cette reprise.

## Limites

Un seul échantillon par cas et par version, petit jeu indépendant : des fluctuations stochastiques subsistent. Une différence ne suffit pas à établir une supériorité générale. Le scoreur mesure les assertions déclarées et la compatibilité de format, pas toute la qualité métier. L'absence de critique détectée n'est pas une preuve d'absence d'hallucination. La correction du parseur ne doit jamais masquer une question de clarification inutile : REV-A-D3 contrôle précisément ce problème persistant.
