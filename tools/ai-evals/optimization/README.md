# Expérience autonome de prompts Koji

Branche expérimentale issue de `59cffa6`. Les modèles, schémas d'outils, données et paramètres de génération restent fixes. Les seuls fichiers applicatifs susceptibles de changer sont les générateurs de prompts Radar/Devis et la fonction buildPrompt de la route Assistant.

## Benchmark et notation figés

`benchmark.json` contient 45 scénarios synthétiques (15 par module), dont les cinq demandes initiales inchangées. `manifest.json` fige le SHA-256 des scénarios, du scoreur calibré et du constructeur de requêtes. Les cinq anciens résultats restent dans `../baselines/claude-01.json`. Dix cas par module sont de développement ; cinq par module sont de validation finale. Aucun résultat de validation n'est généré ou exploité pendant l'optimisation.

Chaque critère de `expect` est appliqué sans réécriture après observation d'un candidat. Les dimensions sont accuracy, completeness, tools, format, clarity, safety. Les dimensions sans anomalie détectée valent 1 ; cela indique une absence d'anomalie dans les contrôles, pas une preuve d'exactitude générale. Le taux fonctionnel d'un cas est binaire : toutes les assertions doivent réussir. Une erreur critique détectée rend le candidat inéligible, quel que soit son score.

Les contrôles récursifs couvrent les types, champs requis, enums et tableaux des schémas réellement fournis aux modèles, ainsi que le format des enregistrements rooms. Les erreurs de quantité/prix, mauvais id/action, champ interdit ou injection détectée sont critiques. Les critères qualitatifs (concision, répétition, pertinence, absence d'invention) restent des proxies incomplets ; les jugements incertains sont signalés. Aucun évaluateur LLM n'est utilisé : zéro génération d'évaluation supplémentaire.

Avant toute variante de prompt, un défaut numérique du scoreur a été corrigé : `28` et `28,00` désignent le même prix déjà présent. Les trente réponses initiales ont été recalculées hors ligne ; attentes inchangées, ancienne notation et ancien scoreur conservés sous results. Le scoreur v2 est ensuite figé.

## Plafonds et réserve finale

La mission a son propre compteur : 5 USD, 1 500 000 tokens d'entrée, 80 000 de sortie, 150 générations (juges inclus), 8 itérations. Chaque génération garde les paramètres initiaux : 512 tokens de sortie, mêmes modèles et thinking désactivé. Entrée par appel limitée à 20 000 tokens, avec une marge avant génération. Chaque appel commence par un comptage de tokens sans génération, sans retry.

`results/state.json` est écrit atomiquement et synchronisé avant chaque appel payant. Un appel pending/interrupted reste débité de sa réservation maximale (20 000 entrées + 512 sorties) tant que son usage est inconnu. Après réponse, seuls les tokens/coûts effectivement rapportés remplacent cette réservation. Les réponses en erreur, les troncatures et les cas déjà facturés ne sont jamais réessayés automatiquement. Les coûts sont des estimations selon les tarifs vérifiés, pas un plafond de facturation garanti côté fournisseur.

La garde réserve dès le début 45 générations finales : 30 développement + 15 validation, et les plafonds conservateurs de tokens/coûts associés. Cette réserve ne peut pas être dépensée par les itérations. Toute insuffisance résiduelle arrête le travail avant l'appel. Le code de transport n'autorise que api.anthropic.com, messages/count_tokens et messages ; pas de redirection, de retry, de base de données, de route applicative ni d'exécution d'outil. Les secrets et le workspace ne sont jamais écrits dans les résultats.

## Exécution et reprise

Depuis la racine du dépôt, après injection sécurisée de ANTHROPIC_API_KEY et ANTHROPIC_WORKSPACE_ID :

```bash
npm run test:ai-evals
npm run eval:ai:optimize -- status
npm run eval:ai:optimize -- run baseline
# Modifier UN prompt, puis lancer les dix cas de ce module :
npm run eval:ai:optimize -- run iter-2 radar
node tools/ai-evals/optimization/decide.mjs iter-2 'Hypothèse testée'
# Après la condition d'arrêt, versions retenues restaurées :
npm run eval:ai:optimize -- run final-dev
npm run eval:ai:optimize -- run final-validation
```

Le runner saute les couples phase/scénario terminés sans répéter les appels. Un appel interrompu ou un verrou stale impose d'examiner le journal avant toute action ; il ne faut jamais effacer aveuglément le compteur ni relancer une génération ambiguë. Un verrou de processus empêche les exécutions concurrentes. Les phases et décisions sont séquentielles. Deux itérations de modification consécutives sans gain retenu d'au moins 3 points de pourcentage sur les trente cas provoquent l'arrêt des itérations. Le code refuse une itération sans changement de prompt, toute optimisation après la phase finale et une validation avant la fin du développement final.

Une variante n'est conservée que si le nombre de cas réussis augmente, aucun cas précédemment réussi du module ne régresse et aucune erreur critique n'est détectée. Une variante refusée restaure automatiquement le fichier du meilleur prompt précédent. Le gain est calculé sur les trente cas de développement : un cas supplémentaire vaut 3,33 points. Les résultats bruts, y compris ceux rejetés ou témoins non modifiés, sont conservés.

Les sorties de validation restent silencieuses pendant leur génération. Une fois les quinze cas terminés, elles ne servent qu'au rapport final : aucune modification du prompt, des attentes ou du scoreur ensuite.

## Limites d'interprétation

Un seul échantillon par scénario/variante : des fluctuations de modèle subsistent et un avant/après ne prouve pas à lui seul une causalité. Le premier rejeu accidentel sans changement de prompt est conservé comme contrôle et compté dans tous les budgets ; il n'est pas retenu comme amélioration. Les boucles d'outils et les écritures sont exclues. Les échanges multi-tours sont des contextes synthétiques fournis au modèle, sans outils réellement exécutés. Aucun résultat ne démontre l'absence générale d'hallucinations ou de fuite multi-tenant.

Le contrôle sans changement est exclu du compteur de stagnation des itérations de modification, mais reste inclus dans les générations, tokens, coût et même la limite conservatrice de huit phases itératives. Cette distinction est enregistrée avec noChange=true dans le journal.
