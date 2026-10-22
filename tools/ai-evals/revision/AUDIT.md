# Audit hors ligne des réponses historiques

Le parseur réel est appliqué sans changer les attentes ni les réponses. Les scores originaux restent intacts. Chaque réponse facturée est listée, y compris variantes rejetées et contrôles.

| Phase | Cas | Ancien | Consommateur | Cause / échecs persistants |
| --- | --- | --- | --- | --- |
| baseline | LIVE-RADAR-01 | échec | échec | question_duplicated_with_choice |
| baseline | LIVE-RADAR-02 | échec | échec | record_missing:intro; question_duplicated_with_choice |
| baseline | R-D03 | OK | OK | No detected failure |
| baseline | R-D04 | OK | OK | No detected failure |
| baseline | R-D05 | OK | OK | No detected failure |
| baseline | R-D06 | OK | OK | No detected failure |
| baseline | R-D07 | échec | échec | question_duplicated_with_choice |
| baseline | R-D08 | OK | OK | No detected failure |
| baseline | R-D09 | OK | OK | No detected failure |
| baseline | R-D10 | échec | échec | record_missing:adresse; question_duplicated_with_choice |
| baseline | LIVE-DEVIS-01 | OK | OK | No detected failure |
| baseline | LIVE-DEVIS-02 | OK | OK | No detected failure |
| baseline | D-D03 | OK | OK | No detected failure |
| baseline | D-D04 | OK | OK | No detected failure |
| baseline | D-D05 | OK | OK | No detected failure |
| baseline | D-D06 | OK | OK | No detected failure |
| baseline | D-D07 | OK | OK | No detected failure |
| baseline | D-D08 | OK | OK | No detected failure |
| baseline | D-D09 | OK | OK | No detected failure |
| baseline | D-D10 | OK | OK | No detected failure |
| baseline | LIVE-ASSISTANT-01 | échec | OK | Presentation preference, accepted by real parseAiJson |
| baseline | A-D02 | échec | OK | Presentation preference, accepted by real parseAiJson |
| baseline | A-D03 | échec | OK | Presentation preference, accepted by real parseAiJson |
| baseline | A-D04 | échec | OK | Presentation preference, accepted by real parseAiJson |
| baseline | A-D05 | échec | OK | Presentation preference, accepted by real parseAiJson |
| baseline | A-D06 | échec | OK | Presentation preference, accepted by real parseAiJson |
| baseline | A-D07 | échec | OK | Presentation preference, accepted by real parseAiJson |
| baseline | A-D08 | échec | OK | Presentation preference, accepted by real parseAiJson |
| baseline | A-D09 | échec | OK | Presentation preference, accepted by real parseAiJson |
| baseline | A-D10 | échec | OK | Presentation preference, accepted by real parseAiJson |
| iter-1 | LIVE-RADAR-01 | échec | échec | truncated; schema:proposer_choix:$.options:required; schema:proposer_choix:$.multiple:required |
| iter-1 | LIVE-RADAR-02 | échec | échec | truncated; record_missing:intro; question_duplicated_with_choice; multiple_questions |
| iter-1 | R-D03 | OK | OK | No detected failure |
| iter-1 | R-D04 | OK | OK | No detected failure |
| iter-1 | R-D05 | OK | OK | No detected failure |
| iter-1 | R-D06 | OK | OK | No detected failure |
| iter-1 | R-D07 | OK | OK | No detected failure |
| iter-1 | R-D08 | OK | OK | No detected failure |
| iter-1 | R-D09 | OK | OK | No detected failure |
| iter-1 | R-D10 | échec | échec | record_missing:adresse |
| iter-2 | LIVE-RADAR-01 | OK | OK | No detected failure |
| iter-2 | LIVE-RADAR-02 | échec | échec | record_missing:intro; question_duplicated_with_choice |
| iter-2 | R-D03 | OK | OK | No detected failure |
| iter-2 | R-D04 | OK | OK | No detected failure |
| iter-2 | R-D05 | OK | OK | No detected failure |
| iter-2 | R-D06 | OK | OK | No detected failure |
| iter-2 | R-D07 | OK | OK | No detected failure |
| iter-2 | R-D08 | échec | échec | record_missing:etat |
| iter-2 | R-D09 | échec | échec | question_duplicated_with_choice |
| iter-2 | R-D10 | OK | OK | No detected failure |
| iter-3 | LIVE-ASSISTANT-01 | échec | OK | Presentation preference, accepted by real parseAiJson |
| iter-3 | A-D02 | échec | OK | Presentation preference, accepted by real parseAiJson |
| iter-3 | A-D03 | échec | OK | Presentation preference, accepted by real parseAiJson |
| iter-3 | A-D04 | échec | OK | Presentation preference, accepted by real parseAiJson |
| iter-3 | A-D05 | échec | OK | Presentation preference, accepted by real parseAiJson |
| iter-3 | A-D06 | échec | OK | Presentation preference, accepted by real parseAiJson |
| iter-3 | A-D07 | échec | OK | Presentation preference, accepted by real parseAiJson |
| iter-3 | A-D08 | échec | OK | Presentation preference, accepted by real parseAiJson |
| iter-3 | A-D09 | échec | OK | Presentation preference, accepted by real parseAiJson |
| iter-3 | A-D10 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-dev | LIVE-RADAR-01 | échec | échec | truncated |
| final-dev | LIVE-RADAR-02 | échec | échec | record_missing:intro; question_duplicated_with_choice |
| final-dev | R-D03 | OK | OK | No detected failure |
| final-dev | R-D04 | échec | échec | truncated; schema:enregistrer_info:$.valeur:required |
| final-dev | R-D05 | OK | OK | No detected failure |
| final-dev | R-D06 | OK | OK | No detected failure |
| final-dev | R-D07 | OK | OK | No detected failure |
| final-dev | R-D08 | OK | OK | No detected failure |
| final-dev | R-D09 | OK | OK | No detected failure |
| final-dev | R-D10 | échec | échec | record_missing:adresse |
| final-dev | LIVE-DEVIS-01 | OK | OK | No detected failure |
| final-dev | LIVE-DEVIS-02 | OK | OK | No detected failure |
| final-dev | D-D03 | OK | OK | No detected failure |
| final-dev | D-D04 | OK | OK | No detected failure |
| final-dev | D-D05 | OK | OK | No detected failure |
| final-dev | D-D06 | OK | OK | No detected failure |
| final-dev | D-D07 | OK | OK | No detected failure |
| final-dev | D-D08 | OK | OK | No detected failure |
| final-dev | D-D09 | OK | OK | No detected failure |
| final-dev | D-D10 | OK | OK | No detected failure |
| final-dev | LIVE-ASSISTANT-01 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-dev | A-D02 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-dev | A-D03 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-dev | A-D04 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-dev | A-D05 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-dev | A-D06 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-dev | A-D07 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-dev | A-D08 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-dev | A-D09 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-dev | A-D10 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-validation | R-V01 | OK | OK | No detected failure |
| final-validation | R-V02 | échec | échec | question_duplicated_with_choice |
| final-validation | R-V03 | OK | OK | No detected failure |
| final-validation | R-V04 | OK | OK | No detected failure |
| final-validation | R-V05 | OK | OK | No detected failure |
| final-validation | D-V01 | OK | OK | No detected failure |
| final-validation | D-V02 | OK | OK | No detected failure |
| final-validation | D-V03 | OK | OK | No detected failure |
| final-validation | D-V04 | OK | OK | No detected failure |
| final-validation | D-V05 | OK | OK | No detected failure |
| final-validation | A-V01 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-validation | A-V02 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-validation | A-V03 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-validation | A-V04 | échec | OK | Presentation preference, accepted by real parseAiJson |
| final-validation | A-V05 | échec | OK | Presentation preference, accepted by real parseAiJson |

R-D08 : exiger précisément etat peut refuser cadragePrecisions, pourtant pertinent pour les fissures selon le prompt. Cette restriction reste inchangée dans le rejeu historique et est signalée comme limite du benchmark. Les nouveaux critères ne changent pas après les appels.

A-V05 historique : une clarification sur l’adresse est demandée alors que le client et la description suffisent selon le prompt ; cette erreur était absente du barème historique. Un nouveau cas de développement la contrôle désormais avant tout appel, sans réécrire le score historique.
