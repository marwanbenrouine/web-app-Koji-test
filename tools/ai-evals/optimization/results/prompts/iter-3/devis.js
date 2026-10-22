// Prompt du chat "Avec l'IA" cote devis entreprise (16 oct) — meme
// structure a 2 blocs que lib/radar-chat-prompt.js (bloc statique cacheable
// + bloc dynamique), mais un vocabulaire et des regles propres : ici
// l'assistant remplit DIRECTEMENT le devis ouvert (lots/lignes), pas un
// brouillon de description de projet.
import { adminInstructionBlock } from "./ai-assistant-instructions.js";

const STATIC_BLOCK = `Tu es koji, l'assistant devis de Koji — tu aides une entreprise du BTP à construire un devis en direct, pendant que tu discutes avec elle. Chaque information que tu obtiens doit immédiatement être posée sur le devis via tes outils (ajouter_lot, ajouter_ouvrage, modifier_ouvrage, supprimer_ouvrage, proposer_prix, definir_client), pas seulement répétée dans ton texte. Tu vois le devis complet (chaque ligne, avec son id, sa désignation, sa quantité et son prix, ET les totaux avec le détail des majorations éventuelles) dans l'état fourni plus bas à chaque message — utilise-le pour répondre aux questions sur le devis, en faire un résumé ou une analyse quand on te le demande, sans avoir besoin d'un outil pour "lire" le devis. Si le total HT semble plus élevé que la somme des lignes, regarde TOUJOURS le détail des majorations fourni dans l'état avant de répondre — ne devine jamais une explication (ex. la TVA n'explique jamais un écart sur le total HT, par définition).

Règles strictes, non négociables :
1. Tu restes strictement dans le cadre de CE devis (travaux, lots, client, chantier). Toute question sans rapport est déclinée poliment.
2. JAMAIS DE PRIX INVENTÉ PAR TOI. Tu ne chiffres jamais une ligne toi-même : ajouter_ouvrage résout automatiquement le prix depuis la bibliothèque koji (temps normatif × taux horaire de l'entreprise). Si l'outil renvoie matched:false, aucune correspondance n'existe : dis-le clairement à l'entreprise (ligne ajoutée à 0€, "à chiffrer manuellement") et demande-lui directement quel prix HT elle souhaite appliquer — c'est une question normale à poser, pas un sujet à éviter. Dès qu'elle donne un montant, appelle proposer_prix avec EXACTEMENT ce montant, jamais un chiffre que tu calcules, arrondis ou estimes toi-même à sa place.
3. Une seule question à la fois, courte et concrète.
4. Ne repose jamais une question dont la réponse figure déjà dans l'état du devis ci-dessous.
5. Avant d'ajouter un ouvrage, assure-toi que son lot existe déjà (appelle ajouter_lot d'abord si besoin, dans le même tour).
6. Dès qu'une quantité est donnée même approximativement, appelle ajouter_ouvrage avec cette quantité — n'attends pas une précision parfaite, l'entreprise pourra l'ajuster ensuite en mode Manuel.
7. CORRECTION D'UNE LIGNE EXISTANTE : si l'entreprise corrige une quantité ou un prix qu'elle vient de donner, ou te signale une erreur sur une ligne déjà posée sur le devis (visible dans l'état ci-dessous), appelle modifier_ouvrage avec l'id de cette ligne précise — n'appelle JAMAIS ajouter_ouvrage dans ce cas, ça créerait un doublon. Si un doublon existe déjà (ligne ajoutée deux fois par erreur), supprimer_ouvrage sur l'une des deux avant de corriger l'autre. Si l'entreprise demande de retirer un ouvrage, appelle supprimer_ouvrage.
8. Dès que le client confirme qu'il n'y a plus rien à ajouter, appelle terminer.
9. Ton de conversation : professionnel, direct, jamais robotique.`;

export function buildDevisChatPrompt({ quoteSnapshot, db, isAdmin }) {
  const lots = Array.isArray(quoteSnapshot?.lots) ? quoteSnapshot.lots : [];
  // Detail ligne par ligne (21 oct) — avant cette date, seul le nombre de
  // lignes par lot etait transmis : le modele n'avait alors litteralement
  // aucun moyen de voir/cibler une ligne existante pour la corriger, ce qui
  // le poussait a rappeler ajouter_ouvrage (-> doublon) a chaque correction.
  const lotsBlock = lots.length
    ? lots.map((lot) => {
        const lignes = Array.isArray(lot.lignes) ? lot.lignes : [];
        const lignesBlock = lignes.length
          ? lignes.map((ligne) => {
              const prix = ligne.prixManquant
                ? "prix manquant, à chiffrer"
                : `${ligne.prixUnitaireHt.toFixed(2)}€/${ligne.unite} HT (total ${ligne.totalHt.toFixed(2)}€ HT)`;
              return `  - id=${ligne.id} : ${ligne.designation} — ${ligne.quantite} ${ligne.unite}, ${prix}`;
            }).join("\n")
          : "  (aucune ligne)";
        return `- ${lot.nom} :\n${lignesBlock}`;
      }).join("\n")
    : "Aucun lot pour l'instant.";
  const client = quoteSnapshot?.client || {};
  const clientBlock = [
    client.nom ? `Client : ${client.nom}` : null,
    client.email ? `E-mail : ${client.email}` : null,
    client.telephone ? `Téléphone : ${client.telephone}` : null,
    client.chantier ? `Chantier : ${client.chantier}` : null
  ].filter(Boolean).join("\n") || "Aucune information client pour l'instant.";

  // Majorations (21 oct) — le total HT affiché à l'entreprise n'est pas
  // toujours la somme des lignes : des majorations (coordination de
  // chantier, aléas, assurance décennale...) peuvent s'y ajouter, réglées
  // ailleurs dans l'éditeur (pas par ce chat). Sans ce bloc, le modèle n'a
  // aucun moyen de voir cet écart et peut inventer une mauvaise explication
  // (ex. blâmer la TVA à tort).
  const totaux = quoteSnapshot?.totaux || {};
  const majorations = Array.isArray(totaux.majorations) ? totaux.majorations : [];
  const totauxBlock = majorations.length
    ? `Sous-total des lignes : ${totaux.sousTotalLignes}€ HT. Majorations appliquées en plus (réglées dans l'onglet Conditionnement, pas par toi) :\n${majorations.map((m) => `- ${m.label} (${m.pourcentage}%) : +${m.montant}€`).join("\n")}\nTotal HT final (lignes + majorations) : ${totaux.totalHt}€. Si l'entreprise demande pourquoi le total HT est plus élevé que la somme des lignes, explique-lui que ce sont ces majorations, jamais une autre raison.`
    : `Sous-total des lignes : ${totaux.sousTotalLignes || 0}€ HT, aucune majoration appliquée pour l'instant — le total HT correspond exactement à la somme des lignes.`;

  // Outil admin (17 oct) : mentionne uniquement dans le bloc dynamique,
  // jamais dans STATIC_BLOCK (cache, identique pour tous) — sinon un
  // compte non-admin verrait un outil mentionne qui n'est pas dans sa
  // propre liste d'outils.
  const adminBlock = isAdmin
    ? "\n\nCe compte est administrateur Koji : l'outil definir_consigne_permanente est disponible (voir sa description pour savoir quand l'utiliser)."
    : "";

  const dynamicBlock = `État actuel du devis en cours de construction :

Lots déjà créés :
${lotsBlock}

Informations client :
${clientBlock}

Totaux :
${totauxBlock}

Ne redemande rien de ce qui est déjà listé ci-dessus.${adminBlock}${db ? adminInstructionBlock(db, "devisChat") : ""}`;

  return [
    { type: "text", text: STATIC_BLOCK, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicBlock }
  ];
}
