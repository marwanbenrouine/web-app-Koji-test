# Optimisation autonome des prompts Koji — bilan mesuré

Base : 59cffa6. Arrêt : Two consecutive actual prompt modifications without retained gain >=3pp.

## Comparatif développement (30 cas)

| Module | Initial strict | Final strict | Compatible parseur réel, initial → final | Latence moyenne ms, initial → final | Coût USD, initial → final |
| --- | ---: | ---: | ---: | ---: | ---: |
| radar | 6/10 (60.0%) | 6/10 (60.0%) | 6/10 → 6/10 | 3626 → 3170 | 0.238756 → 0.234376 |
| devis | 10/10 (100.0%) | 10/10 (100.0%) | 10/10 → 10/10 | 1712 → 1560 | 0.089674 → 0.088914 |
| assistant | 0/10 (0.0%) | 0/10 (0.0%) | 10/10 → 10/10 | 1380 → 1267 | 0.032065 → 0.031990 |

Les prompts finaux sont identiques aux prompts initiaux : aucun candidat n’a démontré un gain sans régression. Les écarts initial/final sont donc des fluctuations observées avec les mêmes prompts, pas des gains ou des régressions attribuables à une modification retenue. « Compatible » retire uniquement les balises JSON que le vrai parseur parseAiJson sait déjà gérer ; il ne change pas le score strict.

## Itérations

| Phase | Module | Hypothèse | Score module avant → candidat | Régressions | Décision |
| --- | --- | --- | ---: | --- | --- |
| iter-1 | radar | Non-applied patch; unchanged-prompt control retained for audit, not eligible as an optimization gain | 6/10 → 7/10 | aucune | contrôle inchangé, non éligible |
| iter-2 | radar | Separate collection from choice display; record explicit address/budget before asking the next question | 6/10 → 7/10 | R-D08, R-D09 | rejeter, restaurer |
| iter-3 | assistant | Require first/last JSON object characters and forbid Markdown directly in the real Assistant buildPrompt | 0/10 → 0/10 | aucune | rejeter, restaurer |

### Consommation par passage

| Passage | Générations | Entrée | Sortie | Coût USD | Latence moyenne ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 30 | 167520 | 5752 | 0.360495 | 2239 |
| iter-1 | 10 | 102543 | 2822 | 0.233306 | 3097 |
| iter-2 | 10 | 101033 | 2492 | 0.226986 | 2648 |
| iter-3 | 10 | 26630 | 1223 | 0.032745 | 1313 |
| final-dev | 30 | 167520 | 5223 | 0.355280 | 1999 |
| final-validation | 15 | 83633 | 2732 | 0.177905 | 2046 |

### Taille et tokens des variantes

| Variante ciblée | Taille source initiale → variante (octets) | Entrée moyenne initiale → variante | Sortie moyenne initiale → variante |
| --- | ---: | ---: | ---: |
| iter-2 / radar | 12827 → 12484 | 10254.3 → 10103.3 | 336.7 → 249.2 |
| iter-3 / assistant | 40658 → 40923 | 2581.0 → 2663.0 | 125.1 → 122.3 |

Le premier rejeu a utilisé accidentellement le prompt non modifié. Ses appels, tokens et coûts sont inclus ; il ne constitue pas une variante et est exclu de la stagnation des modifications. Il reste compté dans la limite conservatrice de huit phases. Les deux modifications réelles suivantes n’ont produit aucun gain retenu ≥3 points : arrêt automatique des itérations avant la phase finale.

## Validation finale tenue à l’écart (15 cas, un seul passage)

| Module | Réussite stricte | Compatible parseur | Conformité structurée | Critiques détectées |
| --- | ---: | ---: | ---: | ---: |
| radar | 4/5 | 4/5 | 5/5 | 0 |
| devis | 5/5 | 5/5 | 5/5 | 0 |
| assistant | 0/5 | 5/5 | 0/5 | 0 |
| Total | 9/15 (60.0%) | 14/15 (93.3%) | 10/15 | 0 |

Régression observée au rejeu développement à prompt inchangé : R-D04. Ce résultat interdit de promettre une stabilité parfaite même sans modification.

Objectifs : zéro critique détectée atteint sur les contrôles ; format strict 100 % non atteint ; compatibilité selon les assertions figées et le parseur 93,3 %, sans preuve de réussite fonctionnelle de bout en bout ; gain mesurable non démontré ; stabilité cas par cas non garantie.

Aucun résultat des quinze cas n’a été généré ou consulté pendant l’optimisation. Après ce passage, aucune attente ni aucun prompt n’est modifié. Les résultats de validation signalent les limites de la meilleure version disponible, sans servir à sélectionner un nouveau candidat.

## Consommation et réserve restante

- Générations : 105/150 ; aucun évaluateur LLM, aucun retry payant automatique.
- Entrée : 648 879 / 1 500 000 tokens.
- Sortie : 20 244 / 80 000 tokens.
- Coût estimé : 1.386717 / 5,00 USD ; restant : 3.613283 USD.
- Les valeurs sont issues de usage, avec réservation conservatrice avant chaque appel ; ce compteur n’est pas une garantie absolue de facturation fournisseur.
- Les cinq générations historiques à 0,070542 USD sont conservées mais hors budget de cette nouvelle mission.

## Erreurs persistantes et limites

- Radar : répétitions de questions avec proposer_choix, enregistrements de faits omis, troncatures possibles sous le plafond inchangé de 512 tokens. La variante raccourcie améliore certains cas mais régresse ailleurs.
- Assistant : balises Markdown persistantes malgré une consigne renforcée ; le parseur applicatif les accepte, le contrat strict reste violé.
- Devis : aucun changement n’est justifié par le développement maîtrisé ; conserver la version initiale.
- Un faux positif du scoreur sur 28 vs 28,00 a été corrigé avant les variantes. Les trente réponses initiales ont été recalculées sans nouvelle API et les anciens résultats sont préservés. Les attentes n’ont jamais changé.
- Le cas Radar R-D08 exige précisément le champ etat ; un enregistrement équivalent dans cadragePrecisions est refusé par ce critère figé. Cette correspondance de champ est une limite du benchmark à revoir dans une campagne future, pas une raison de modifier les attentes maintenant.
- Les contrôles d’inventions et d’injection sont des proxies incomplets. Zéro critique détectée ne signifie pas zéro hallucination réelle. Les dimensions sans défaut détecté ne valent pas preuve de vérité.
- Relecture finale non utilisée pour optimiser : A-V05 pose une question sur l’adresse malgré la présence du client et de la description ; la consigne demande pourtant de ne pas poser de question inutile dans ce cas. Ce défaut de clarification n’était pas couvert par les assertions figées, qui restent inchangées. A-V02 demande aussi libellé et catégorie dans une même question ; le caractère nécessaire de cette clarification reste à valider métier.
- Un échantillon par cas et par variante ; différences stochastiques non significatives statistiquement. Les contextes multi-tours sont synthétiques, aucune boucle d’outils réelle ni isolation multi-tenant n’est exercée.

## Recommandation et livrables

Conserver les trois prompts initiaux. Aucune variante ciblée testée n’est suffisamment démontrée pour être retenue. Les objectifs de format et de gain ne sont pas atteints ; ne pas promouvoir ces variantes sur la seule base de ce benchmark. Une prochaine campagne pourrait tester une contrainte de sortie structurée pour l’Assistant et des règles Radar plus courtes, mais cela nécessiterait un protocole distinct : aucun appel supplémentaire n’est lancé ici.

- Sources initiales : results/prompts/baseline/*.js ; versions retenues : results/prompts/final-dev/*.js, mêmes empreintes.
- Variantes rejetées : results/prompts/iter-2/radar.js et results/prompts/iter-3/assistant.js ; patches dans results/patches/.
- Résultats par cas, dimensions, erreurs, tokens, coût, latence et hash de requête : results/state.json et SUMMARY.json.
- Benchmark, paramètres et scoreur figés : benchmark.json et manifest.json.
- Reprise idempotente et garde persistante : run.mjs ; sélection/restauration : decide.mjs ; protocole : README.md.
- Aucun outil à effets réels, base, API de production Koji, AWS ou Supabase ; aucune fusion ni déploiement ; fork autorisé uniquement.
