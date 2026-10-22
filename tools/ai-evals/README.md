# KOJI — Banc de tests des assistants IA

Ce dossier permet de lancer des requetes automatisees sur les **routes reelles** de KOJI et de comparer les comportements d'une version a l'autre. Il ne modifie pas les prompts, le modele ni les donnees de production.

La CI de cette intégration est exclusivement hors ligne : aucun job live, secret, accès base ou déploiement. `npm run test:ai-smoke` vérifie les trois protocoles sur des réponses synthétiques et contrôle que le runner sans `--live` ne peut pas utiliser fetch. Les commandes `eval:ai` sans `--live` listent les scénarios ; elles ne les exécutent pas contre les routes. Les exemples live ci-dessous documentent les capacités de v1 et ne sont pas une autorisation de les exécuter.

## Perimetre actuel

| Assistant | Route | Reponse | Effet possible |
| --- | --- | --- | --- |
| Radar conversationnel experimental | `/api/radar-chat` | Evenements SSE | Creation et modification d'un brouillon Radar |
| Devis « Avec l'IA » | `/api/devis-chat` | Evenements SSE | Instructions de modification d'un devis, appliquees par le frontend (pas d'ecriture de devis par cette route) |
| Assistant professionnel | `/api/koji-assistant` | JSON | Navigation, creations ou modifications en base selon la demande |

**Attention :** le parcours Radar actuellement branche sur l'ecran client historique emploie encore `/api/radar-assistant` et **n'est pas couvert** par ce banc de tests. Le banc couvre le nouveau chat Radar utilise par l'ecran experimental.

La liste des 15 premiers scenarios synthetiques se trouve dans `scenarios.json` (4 smoke, 11 regression). Ils controlent la disponibilite de l'API, des formats, quelques classifications, quelques actions et des regles metier simples. Leurs resultats doivent etre verifies et enrichis par des cas reels anonymises avant toute decision produit. Les reponses en langage naturel ne sont pas encore notees par une IA evaluatrice.

## Lancement sans frais ni donnees de test

Depuis la racine du depot :

```bash
npm run test:ai-evals
npm run eval:ai -- --suite smoke
npm run eval:ai -- --suite all
```

Sans `--live`, l'outil **affiche seulement** les scenarios selectionnes ; il ne contacte aucune API et ne facture aucun modele.

## Lancement en preproduction (hors du périmètre de cette PR)

Preparer une URL de preproduction distincte, des comptes **non administrateurs** et des donnees fictives (entreprise A, entreprise B, chantier `TEST-QA-KOJI`). Ne jamais utiliser de compte, document ou devis client reel.

Variables requises selon les scenarios :

| Variable | Fonction |
| --- | --- |
| `KOJI_EVAL_BASE_URL` | Adresse de preproduction ou de serveur local ; jamais la production |
| `KOJI_EVAL_ALLOWED_HOST` | Nom d'hote **exact** autorise pour une preproduction distante, sans `https://` |
| `KOJI_EVAL_PRO_TOKEN` | Jeton Supabase de la societe A de test |
| `KOJI_EVAL_PRO_B_TOKEN` | Jeton Supabase de la societe B de test (tests multi-tenant) |
| `KOJI_EVAL_PORTAL_TOKEN` | Jeton HMAC du portail particulier pour Radar (different des jetons Supabase) |
| `KOJI_EVAL_ALLOW_WRITES` | Valeur exacte `yes` pour autoriser les scenarios avec effets en base, en complement de `--allow-writes` |

Exemple apres avoir fourni les variables d'environnement dans votre terminal ou les secrets de votre CI :

```bash
npm run eval:ai -- --live --suite smoke --max-calls 4
npm run eval:ai -- --live --suite regression --max-calls 20
```

Par defaut, les cas susceptibles de creer ou modifier des donnees sont **ignores**. Cela comprend tous les scenarios Radar (creation de brouillon) ainsi que les creations de l'assistant professionnel. Pour les executer **uniquement dans une base de preproduction jetable** :

```bash
# Avec KOJI_EVAL_ALLOW_WRITES=yes deja configure dans l'environnement
npm run eval:ai -- --live --suite all --allow-writes --max-calls 30
```

Deux confirmations sont donc requises pour l'ecriture : l'argument CLI et la variable d'environnement. Les domaines `kojibuild.com`, tous leurs sous-domaines et `web-app-koji.vercel.app` sont bloques par le code. Une instance clonee qui pointe accidentellement vers la base de production reste toutefois dangereuse : **verifier les variables de connexion de la preproduction**.

Le runner execute les requetes de facon sequentielle avec une pause entre appels, un timeout de 60 secondes, un plafond de 100 appels et un maximum de cinq repetitions par scenario. Les appels aux API Claude de KOJI peuvent entrainer des frais. Le fait d'utiliser un site de preview n'isole pas automatiquement sa base de donnees.

## Resultats

Les rapports sont produits dans `tmp/koji-ai-evals/` :

- `report.json` : resultats structures, temps de reponse, erreurs et actions detectees ;
- `report.md` : tableau lisible par un responsable produit ;
- `--baseline path/to/report.json` : signale les tests auparavant reussis qui ont echoue lors du nouveau passage.

Les textes generes, tokens et corps complets des reponses ne sont pas conserves par defaut pour limiter l'exposition de donnees. Un echec rend le processus non nul pour bloquer une integration continue.

## Etape suivante : evaluation qualitative et amelioration

1. Faire valider les assertions de reference de chaque cas par l'equipe produit.
2. Ajouter des cas reels anonymises et des conversations multi-tours avec des attentes precises (pas d'invention de prix, respect des surfaces, accord avant mutation, protection inter-entreprises).
3. Ajouter un evaluateur IA distinct qui attribue des notes par critere avec justification et controles croises par des assertions deterministes.
4. Proposer une modification de prompt sur une branche distincte ; rejouer **les memes cas de reference** avant/apres, suivre le taux de reussite, les regressions, les couts et la latence.
5. Exiger une validation humaine pour les changements de prompt, l'execution de mutations et tout deploiement.

Ce dispositif evalue le comportement du systeme, il ne « reentraine » pas automatiquement Claude.
