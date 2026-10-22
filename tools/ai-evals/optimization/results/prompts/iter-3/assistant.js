import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { badRequest, ok } from "../../../lib/http";
import { getAuth } from "../../../lib/server-auth";
import { readDb, scopedItems, writeDb } from "../../../lib/db";
import { parseAiJson } from "../../../lib/ai-json";
import { parsePhoto } from "../../../lib/ai-photo";
import { TOOLS, PAGES, TOPIC_SUGGESTIONS, resolveByHint, resolveOuvrageForLabel, resolveSupplyForLabel } from "../../../lib/koji-assistant-tools";
import { startConfirmTypeFlow, advanceConfirmTypeFlow } from "../../../lib/koji-assistant-photo-confirm";
import { RENOVATION_METIERS } from "../../../lib/renovation-question-bank";
import { logAlgoStat } from "../../../lib/assistant-algo-stats";
import { adminInstructionBlock, requesterIsAdmin, setAssistantInstruction } from "../../../lib/ai-assistant-instructions";

// Assistant koji v2 (15 septembre) : pipeline a deux phases.
// Phase 1 (IA, 1 appel) : classe le message parmi les 13 outils de
// lib/koji-assistant-tools.js + une action create/delete, et extrait les
// champs — toute reference a une AUTRE entite (un chantier, un devis, un
// fournisseur...) ressort comme un indice texte (ex: chantierHint), pas un
// id, puisque l'IA n'a vu aucune liste a ce stade.
// Phase 2 (code, deterministe, 0 appel IA) : une fois le type connu, on va
// chercher UNIQUEMENT la liste pertinente pour ce type et on resout l'indice
// par recherche sous-chaine (resolveByHint) — jamais d'id invente par l'IA.
// La creation elle-meme appelle directement le POST existant du type
// (callInternal) ; la suppression ne s'execute JAMAIS depuis cette route —
// elle propose une confirmation, executee par un clic cote client (comme le
// bouton "Annuler" d'une creation).

const TYPE_KEYS = Object.keys(TOOLS);

async function callInternal(handler, path, body, token, method = "POST") {
  const request = new Request(`http://internal${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, accessToken: token })
  });
  const response = await handler(request);
  let data = {};
  try { data = await response.json(); } catch { /* pas de corps */ }
  return { ok: response.status >= 200 && response.status < 300, data };
}

// Description des champs a extraire par type, utilisee par le prompt de
// classification complet (14 types) — un seul texte source par type.
const TYPE_FIELD_SPECS = {
  rdv: `"rdv" : rendez-vous/évènement futur daté. Champs : title, eventType, clientName, address, startAt (ISO 8601, résous les dates relatives comme "jeudi"/"mardi matin" par rapport à la date du jour), endAt, notes.`,
  visite: `"visite" : COMPTE-RENDU d'une visite déjà effectuée/en cours (constat/état des lieux, PAS un rendez-vous futur). Champs : client, site, date (YYYY-MM-DD), constat, analyse, preconisations, chantierHint (nom/adresse du chantier si mentionné).`,
  depense: `"depense" : ACHAT réel dépensé sur un chantier précis (toujours lié à un chantier). Champs : chantierHint (nom/adresse du chantier — OBLIGATOIRE), amount (nombre), label, category, notes.`,
  facture: `"facture" : transformer un devis SIGNÉ existant en facture. Champs : quoteHint (nom du client ou numéro de devis mentionné).`,
  fourniture: `"fourniture" : référence d'article ajoutée au catalogue de l'entreprise, JAMAIS liée à un chantier (sert pour les futurs devis). Champs : name, category, purchasePriceHt, salePriceHt, quantity, unit, supplierHint (nom du fournisseur si mentionné).`,
  alerte: `"alerte" : incident urgent sur un chantier (fuite, dégât, urgence, incendie). Champs : message, type (degat/fuite/urgence/incendie/autre), chantierHint (OBLIGATOIRE).`,
  devis: `"devis" : créer un nouveau devis. Champs : client (nom du client mentionné), address (adresse du chantier mentionnée), description (résumé clair en français des travaux décrits UNIQUEMENT — jamais de prix, de TVA ou de nom de lot dans ce texte, ils ont leurs propres champs ci-dessous), metier (un seul, le plus proche parmi ${RENOVATION_METIERS.join(", ")} — SEULEMENT s'il ressort clairement de la description, ex: "fuite d'eau" → "Plombier", "tableau électrique" → "Electricien" ; sinon laisse vide, ne devine jamais), surface (surface ou pièce concernée si mentionnée), finition (niveau de finition si mentionné : Standard/Milieu de gamme/Haut de gamme), lotName (nom du lot/de la pièce/zone concernée SEULEMENT s'il est identifiable dans le message, ex: "Peinture F2", "Salon" — sinon laisse vide), vatRate (nombre : taux de TVA en % SEULEMENT s'il est explicitement mentionné, ex "TVA 20%" → 20 — sinon laisse vide), forfaitAmount (nombre : montant HT global SEULEMENT si l'utilisatrice le donne elle-même explicitement pour l'ensemble des travaux décrits, ex "5000€ fournitures et main d'oeuvre" → 5000 — ne JAMAIS estimer/deviner ce montant toi-même, uniquement le retranscrire s'il est donné tel quel), forfaitLabel (désignation courte du forfait si forfaitAmount est rempli, ex: "Peinture complète — forfait"). Si le message donne à la fois un client et une description des travaux, l'IA génère directement un devis chiffré depuis la bibliothèque de prix de l'entreprise (comme /devis-ia/new) — pas de question inutile sur ces deux champs s'ils sont déjà donnés. Si aucune information n'est donnée (juste "crée un devis"), laisse tous ces champs vides.`,
  tache: `"tache" : une tâche/to-do sur un chantier. Champs : label, chantierHint, dueDate, assignedTo.`,
  equipe: `"equipe" : ajouter un membre d'équipe/ouvrier. Champs : name, profession, phone, email, hourlyRate.`,
  contact: `"contact" : ajouter un contact/client. Champs : type ("particulier" ou "societe"), firstName, lastName, companyName, phone, email, address.`,
  chantier: `"chantier" : créer un nouveau chantier/projet. Champs : title (synthétise un titre court et clair à partir du message), address, clientEmail.`,
  fournisseur: `"fournisseur" : ajouter un fournisseur. Champs : name.`,
  ouvrage: `"ouvrage" : ajouter une prestation à la bibliothèque de prix de l'entreprise. Champs : label, unit, normativeTime (en heures), hourlyRate, family.`,
  avenant: `"avenant" : créer un AVENANT (modification/complément) sur un devis déjà SIGNÉ — reconnais aussi le mot seul "avenant" comme cette intention (toujours "create", jamais "ambiguous" pour ce mot). Champs : quoteHint (nom du client ou numéro de devis mentionné, SEULEMENT s'il est donné dans le message — sinon laisse vide, on demandera lequel).`
};

// Pre-controle isole pour les comptes admin (17 oct) — un petit appel IA a
// part, totalement separe du pipeline de classification a 14 types
// ci-dessous : jamais touche a ce pipeline deja finement regle, jamais de
// cout/latence pour un compte non-admin (jamais appele dans ce cas).
async function detectAdminInstruction(message) {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      // 300 -> 4096 (17 oct, bug remonte par Amira) : la reponse doit
      // reprendre le texte COMPLET de la consigne quand isInstructionUpdate
      // est vrai — avec 300 tokens, une consigne un peu longue (plusieurs
      // paragraphes) coupait la reponse en plein JSON, parseAiJson levait
      // une erreur, le catch ci-dessous renvoyait silencieusement false, et
      // le message tombait a tort dans la classification normale a 14
      // types (d'ou le "Je n'ai pas ce service" en test). setAssistantInstruction
      // plafonne de toute facon la consigne enregistree a 4000 caracteres.
      max_tokens: 4096,
      thinking: { type: "disabled" },
      system: "Tu determines si un message d'un administrateur demande de changer DURABLEMENT le comportement/les regles d'un assistant IA (ex: \"a partir de maintenant, fais...\", \"retiens que...\", \"ne demande plus jamais...\", \"nouvelle regle : ...\") — par opposition a une tache normale (creer un devis, un RDV, une depense, naviguer vers une page...). Reponds UNIQUEMENT en JSON strict : {\"isInstructionUpdate\": boolean, \"instruction\": string (le texte complet de la nouvelle consigne si isInstructionUpdate est true, sinon chaine vide)}.",
      messages: [{ role: "user", content: message }]
    });
    const textBlock = response.content.find((b) => b.type === "text");
    const parsed = parseAiJson(textBlock?.text || "{}");
    return {
      isInstructionUpdate: Boolean(parsed?.isInstructionUpdate),
      instruction: String(parsed?.instruction || "").trim()
    };
  } catch {
    // Jamais bloquant : un echec de ce pre-controle isole laisse
    // simplement passer le message au pipeline normal, comme avant.
    return { isInstructionUpdate: false, instruction: "" };
  }
}

function buildPrompt({ today, message, isSecondRound, previousQuestion, previousMessage, hasPhotos, onDevisPage, db }) {
  const conversationBlock = isSecondRound
    ? `\nTu as déjà posé cette question à l'utilisatrice : "${previousQuestion}" (à propos du message original : "${previousMessage}"). Voici sa réponse : "${message}". Combine le message original et cette réponse pour finaliser. Tu NE PEUX PLUS reposer de question : needsClarification doit être false, complète avec les meilleures valeurs disponibles.`
    : "";
  const photoBlock = hasPhotos
    ? `\nUne ou plusieurs photos sont jointes au message — regarde-les avant de classer. Si une photo ressemble à un ticket de caisse, une facture reçue ou un reçu de paiement (donc une DÉPENSE que l'entreprise a payée, pas un devis à créer), mets type="depense", extrais fields.amount (montant total TTC lu sur le document, nombre), fields.label (nom du commerce/fournisseur visible), fields.category (catégorie plausible), et mets "detectedFromPhoto": true — dans ce cas ne mets JAMAIS needsClarification/clarifyingQuestion, la confirmation est gérée séparément. Si le texte du message explique déjà clairement de quoi il s'agit, fais confiance au texte plutôt qu'à une supposition sur l'image.`
    : "";
  // L'utilisatrice est actuellement sur la page de creation/edition d'un
  // devis (app/devis/DevisEditor.jsx). Le code de dispatch (pas ce prompt)
  // se charge de rediriger automatiquement les actions "create" de type
  // devis/ouvrage/fourniture vers CE devis affiche a l'ecran plutot que
  // vers la bibliotheque/le catalogue — la seule chose que le modele doit
  // savoir en plus, c'est reconnaitre une demande de creer un LOT (concept
  // qui n'existe pas parmi les 13 types), et ne jamais reposer de question
  // dans ce contexte (20 septembre, suite a un echec de classification ou
  // le modele choisissait "create"+type=devis SANS extraire les champs).
  const devisPageBlock = onDevisPage
    ? `\nL'utilisatrice est actuellement sur la page de création d'un devis, dans son navigateur — ne pose JAMAIS de question de clarification pour une demande de création dans ce contexte (needsClarification reste false, complète avec le mieux disponible). Cas particulier : si le message demande de créer un LOT/une pièce dans ce devis (ex: "crée un lot Cuisine", "ajoute un lot Salon"), classe action="devisPageAction" avec fields.subAction="addLot" et fields.label (nom du lot).`
    : "";

  const pagesList = Object.entries(PAGES).map(([key, p]) => `${key} (${p.label})`).join(", ");

  return `Tu es l'assistant koji du dashboard d'une entreprise du BTP. Un message libre doit être classé avec une action parmi : "create" (créer une entrée), "update" (modifier un champ d'une entrée EXISTANTE, ou ajouter une ligne à un devis existant), "delete" (supprimer une entrée existante), "navigate" (ouvrir/afficher une page de l'application — ex: "ouvre le calendrier", "va sur les devis", "montre-moi les contacts"), "ambiguous" (le message nomme juste un type parmi les 13 ci-dessous, sans verbe clair — ex: juste "devis", juste "facture" — sans dire s'il faut créer, modifier ou autre chose)${onDevisPage ? `, "devisPageAction" (voir consigne dédiée plus bas)` : ""} ou "autre" si rien ne correspond.${devisPageBlock}

Pour l'action "navigate", mets uniquement fields.page = une des clés suivantes (choisis la plus proche, ne réponds jamais avec une clé qui n'est pas dans cette liste) : ${pagesList}.

Pour l'action "ambiguous", mets uniquement fields.topic = la clé du type concerné (rdv/visite/depense/facture/fourniture/alerte/devis/tache/equipe/contact/chantier/fournisseur/ouvrage/avenant).

Pour l'action "update", mets fields.searchHint (les mots-clés qui identifient l'entrée à modifier — nom, lieu, sujet, comme pour une suppression) et fields.changes (objet des champs à modifier, avec les MÊMES noms de champs que ceux listés pour la création de ce type ci-dessous, plus "status" quand pertinent). Cas particulier du type "devis" : pour ajouter une ligne à un devis existant (ex: "ajoute une ligne carrelage 20m² au devis de Dupont"), mets fields.changes.lineLabel (désignation de la ligne), fields.changes.quantity (nombre), fields.changes.unit, fields.changes.room (pièce/lot concerné si mentionné) — jamais de prix, il est calculé automatiquement depuis la bibliothèque de prix de l'entreprise.

Date du jour : ${today}

Les 14 types (pour l'action "create", champs à extraire) :
${Object.values(TYPE_FIELD_SPECS).map((spec) => `- ${spec}`).join("\n")}

Pour une SUPPRESSION (action "delete"), quel que soit le type identifié ci-dessus, n'extrais que : searchHint (les mots-clés qui identifient l'entrée à supprimer — nom, lieu, sujet) et, si une date est mentionnée et pertinente pour ce type (rdv/tache/visite), dateHint (date ISO résolue). Ne mets aucun autre champ pour une suppression.
${conversationBlock}${photoBlock}
${db ? adminInstructionBlock(db, "kojiAssistant") : ""}

Message de l'utilisatrice : "${message}"

Quelle que soit la consigne administrateur ci-dessus (s'il y en a une), réponds TOUJOURS uniquement avec ce JSON strict, sans texte ni balise markdown autour — ce format n'est jamais négociable :
CONTRAT DE SORTIE : le tout premier caractère de ta réponse doit être { et le tout dernier }. Ne produis AUCUN caractère de balisage Markdown, aucun bloc de code et aucun texte avant ou après l’objet JSON. Vérifie cette contrainte juste avant de répondre.
{
  "action": "create" | "update" | "delete" | "navigate" | "ambiguous" | "devisPageAction" | "autre",
  "type": "rdv" | "visite" | "depense" | "facture" | "fourniture" | "alerte" | "devis" | "tache" | "equipe" | "contact" | "chantier" | "fournisseur" | "ouvrage" | "avenant" | "autre",
  "fields": { ... },
  "detectedFromPhoto": boolean,
  "needsClarification": boolean,
  "clarifyingQuestion": string | null,
  "quickReplies": string[]
}

Si une information essentielle manque pour CRÉER (ex: pas de date pour un RDV, chantier non identifiable pour une dépense/alerte, nom manquant), ou si tu ne peux pas identifier clairement CE QUI doit être supprimé ou modifié, mets needsClarification à true et pose UNE seule question claire — ne devine jamais une valeur essentielle.`;
}

export async function handleCreate({ ctx, tool, type, parsed, isSecondRound, message, rawPhotos, contextChantierId }) {
  const fields = parsed.fields && typeof parsed.fields === "object" ? { ...parsed.fields } : {};
  if (type === "devis" && Array.isArray(rawPhotos)) fields.photos = rawPhotos;

  if (tool.reference) {
    const hint = fields[tool.reference.hintField];
    // Contexte du chantier ouvert (8 oct) : sur la fiche d'un chantier
    // (app/chantiers/page.jsx), un "ajoute une dépense"/"une tâche"/"une
    // alerte"/"une visite" SANS chantier nomme explicitement se rattache
    // directement a CE chantier — jamais invente, c'est l'id reellement
    // ouvert a l'ecran (components/Shell.jsx le transmet via pageContext).
    // Un chantier nomme explicitement dans le message reste toujours
    // prioritaire sur le contexte (hint non vide -> ignore contextChantierId).
    if (!hint && contextChantierId && tool.reference.hintField === "chantierHint") {
      fields[tool.reference.resolvedField] = contextChantierId;
    } else if (hint || tool.reference.required) {
      const candidates = await tool.reference.fetchCandidates(ctx);
      const { match, matches } = resolveByHint(candidates, hint);
      if (match) {
        fields[tool.reference.resolvedField] = match.id;
      } else if (tool.reference.required || hint) {
        if (isSecondRound) {
          return { outcome: "failed", message: "Je n'ai pas assez d'informations pour créer cette entrée. Réessayez avec un message plus précis." };
        }
        return {
          outcome: "clarify",
          question: matches.length ? "Plusieurs correspondances possibles — laquelle ?" : "Je ne trouve pas de correspondance — pouvez-vous préciser ?",
          quickReplies: matches.map((m) => m.label),
          originalMessage: message
        };
      }
    }
  }

  const missingReason = tool.requiredCheck(fields);
  if (missingReason) {
    if (isSecondRound) {
      return { outcome: "failed", message: `Je n'ai pas assez d'informations pour créer cette entrée (${missingReason}). Réessayez avec un message plus précis.` };
    }
    const question = parsed.needsClarification && parsed.clarifyingQuestion ? parsed.clarifyingQuestion : `Pouvez-vous préciser : ${missingReason} ?`;
    const quickReplies = Array.isArray(parsed.quickReplies) ? parsed.quickReplies : [];
    return { outcome: "clarify", question, quickReplies, originalMessage: message };
  }

  const mappedBody = tool.mapCreateBody(fields);
  const created = await callInternal(tool.createHandler, tool.createPath, mappedBody, ctx.auth.token);
  if (!created.ok) {
    return { outcome: "failed", message: created.data?.error || "La création a échoué." };
  }
  const entity = created.data[Object.keys(created.data)[0]];

  return {
    outcome: "created",
    type,
    typeLabel: tool.label,
    id: entity.id,
    deleteRoute: tool.deleteRoute,
    deleteMethod: tool.deleteMethod,
    correctUrl: tool.correctUrl(entity),
    summary: tool.summary(entity)
  };
}

async function handleDelete({ ctx, tool, type, parsed, isSecondRound, message }) {
  const fields = parsed.fields && typeof parsed.fields === "object" ? parsed.fields : {};
  const candidates = await tool.ownCandidates(ctx);
  let pool = candidates;
  if (fields.dateHint) {
    const day = String(fields.dateHint).slice(0, 10);
    const filtered = pool.filter((c) => String(c.date || "").slice(0, 10) === day);
    if (filtered.length) pool = filtered;
  }
  const { match, matches } = resolveByHint(pool, fields.searchHint);

  if (!match) {
    if (isSecondRound) {
      return { outcome: "failed", message: "Je n'arrive pas à identifier précisément l'entrée à supprimer. Réessayez avec un message plus précis." };
    }
    return {
      outcome: "clarify",
      question: matches.length ? "Laquelle voulez-vous supprimer ?" : "Je ne trouve rien correspondant — pouvez-vous préciser ?",
      quickReplies: matches.map((m) => m.label),
      originalMessage: message
    };
  }

  return {
    outcome: "confirmDelete",
    type,
    typeLabel: tool.label,
    id: match.id,
    deleteRoute: tool.deleteRoute,
    deleteMethod: tool.deleteMethod,
    summary: match.summary
  };
}

async function handleUpdate({ ctx, tool, type, parsed, isSecondRound, message }) {
  if (!tool.updateHandler) {
    return { outcome: "failed", message: `"${tool.label}" ne peut pas encore être modifié depuis l'assistant.` };
  }
  const fields = parsed.fields && typeof parsed.fields === "object" ? parsed.fields : {};
  const changes = fields.changes && typeof fields.changes === "object" ? fields.changes : {};

  const candidates = await tool.ownCandidates(ctx);
  const { match, matches } = resolveByHint(candidates, fields.searchHint);
  if (!match) {
    if (isSecondRound) {
      return { outcome: "failed", message: "Je n'arrive pas à identifier précisément l'entrée à modifier. Réessayez avec un message plus précis." };
    }
    return {
      outcome: "clarify",
      question: matches.length ? "Laquelle voulez-vous modifier ?" : "Je ne trouve rien correspondant — pouvez-vous préciser ?",
      quickReplies: matches.map((m) => m.label),
      originalMessage: message
    };
  }

  const mappedBody = await tool.mapUpdateBody(ctx, match.id, changes);
  if (!mappedBody) {
    return { outcome: "failed", message: "Modification impossible." };
  }
  const updated = await callInternal(tool.updateHandler, tool.updateRoute, mappedBody, ctx.auth.token, "PATCH");
  if (!updated.ok) {
    return { outcome: "failed", message: updated.data?.error || "La modification a échoué." };
  }
  const entity = updated.data[Object.keys(updated.data)[0]];

  return {
    outcome: "updated",
    type,
    typeLabel: tool.label,
    id: entity.id || match.id,
    correctUrl: tool.correctUrl(entity),
    summary: tool.summary ? tool.summary(entity) : match.summary
  };
}

// "avenant" se compose ligne par ligne sur sa propre page (app/avenant/), pas
// via un create() classique — cette fonction se contente de resoudre QUEL
// devis signe est vise (meme resolution generique que le reste de l'app :
// indice texte -> resolveByHint -> clarify si ambigu, jamais d'id invente),
// puis navigue vers /avenant?quoteId=... une fois le devis identifie.
async function handleAvenantNavigate({ ctx, tool, parsed, isSecondRound, message }) {
  const fields = parsed.fields && typeof parsed.fields === "object" ? parsed.fields : {};
  const hint = fields[tool.reference.hintField];
  const candidates = await tool.reference.fetchCandidates(ctx);
  if (!candidates.length) {
    return { outcome: "failed", message: "Aucun devis signé pour l'instant — un avenant ne peut être créé que sur un devis déjà signé." };
  }
  const { match, matches } = resolveByHint(candidates, hint);
  if (!match) {
    if (isSecondRound) {
      return { outcome: "failed", message: "Je n'ai pas trouvé le devis concerné. Réessayez avec le nom du client ou le numéro de devis." };
    }
    return {
      outcome: "clarify",
      question: "Pour quel devis signé souhaitez-vous créer cet avenant ?",
      quickReplies: matches.map((m) => m.label),
      originalMessage: message
    };
  }
  return { outcome: "navigate", path: `/avenant?quoteId=${match.id}`, label: `Nouvel avenant — ${match.label}` };
}

function handleAmbiguous(parsed) {
  const topic = parsed.fields?.topic;
  const suggestions = topic && TOPIC_SUGGESTIONS[topic] ? TOPIC_SUGGESTIONS[topic] : null;
  if (!suggestions) return null;
  return {
    outcome: "clarify",
    question: "Que voulez-vous faire ?",
    quickReplies: suggestions,
    originalMessage: ""
  };
}

function handleNavigate(parsed) {
  const key = parsed.fields?.page;
  const page = key && PAGES[key] ? PAGES[key] : null;
  if (!page) {
    return {
      outcome: "clarify",
      question: "Quelle page voulez-vous ouvrir ?",
      quickReplies: Object.values(PAGES).slice(0, 6).map((p) => p.label),
      originalMessage: ""
    };
  }
  return { outcome: "navigate", path: page.path, label: page.label };
}

function describeOutcome(result) {
  if (result.outcome === "created") return `✓ ${result.typeLabel} créé.`;
  if (result.outcome === "updated") return `✓ ${result.typeLabel} modifié.`;
  if (result.outcome === "confirmDelete") return `Confirmer la suppression : ${result.typeLabel} ?`;
  if (result.outcome === "navigate") return `→ Ouverture de ${result.label}.`;
  if (result.outcome === "clarify") return result.question;
  if (result.outcome === "failed") return result.message;
  if (result.outcome === "unsupported") return result.message || "Je n'ai pas ce service.";
  if (result.outcome === "devisPageAction") return `✓ Ajouté sur le devis ouvert : ${result.label}.`;
  return "Je n'ai pas compris votre demande.";
}

// Ajoute un ouvrage/une fourniture/un lot directement sur le devis
// actuellement ouvert dans le navigateur (app/devis/DevisEditor.jsx) —
// aucune ecriture en base ici : la page applique elle-meme le resultat a
// son etat local (voir l'evenement "koji-devis-page-action" cote client),
// exactement comme un clic sur "Ajouter" depuis l'onglet Bibliotheque/
// Fournitures. Le devis se sauvegarde ensuite via l'autosave deja en place.
async function handleDevisPageAction({ ctx, parsed }) {
  const fields = parsed.fields && typeof parsed.fields === "object" ? parsed.fields : {};
  const subAction = fields.subAction;
  const label = String(fields.label || "").trim();
  const room = fields.room ? String(fields.room).trim() : null;
  const quantity = Math.max(0, Number(fields.quantity) || 1);
  const unit = fields.unit ? String(fields.unit).trim() : null;

  if (subAction === "addLot") {
    if (!label) return { outcome: "failed", message: "Indiquez le nom du lot à créer." };
    return { outcome: "devisPageAction", subAction, label, lotName: label };
  }

  if (subAction === "addOuvrage") {
    if (!label) return { outcome: "failed", message: "Indiquez l'ouvrage à ajouter." };
    const ouvrage = await resolveOuvrageForLabel(ctx, label, { unit });
    return { outcome: "devisPageAction", subAction, label: ouvrage.label, room, quantity, ouvrage };
  }

  if (subAction === "addFourniture") {
    if (!label) return { outcome: "failed", message: "Indiquez la fourniture à ajouter." };
    const supply = await resolveSupplyForLabel(ctx, label);
    if (!supply) {
      return { outcome: "failed", message: `Aucune fourniture correspondant à "${label}" dans votre catalogue.` };
    }
    return { outcome: "devisPageAction", subAction, label: supply.name, room, quantity, supply };
  }

  if (subAction === "setClientInfo") {
    const client = fields.client ? String(fields.client).trim() : "";
    const clientAddress = fields.clientAddress ? String(fields.clientAddress).trim() : "";
    const description = fields.description ? String(fields.description).trim() : "";
    const lotName = fields.lotName ? String(fields.lotName).trim() : "";
    const vatRate = fields.vatRate ? Number(fields.vatRate) : null;
    const forfaitAmount = fields.forfaitAmount ? Number(fields.forfaitAmount) : null;
    const forfaitLabel = fields.forfaitLabel ? String(fields.forfaitLabel).trim() : "";
    if (!client && !clientAddress && !description && !lotName && !vatRate && !forfaitAmount) {
      return { outcome: "failed", message: "Je n'ai pas trouvé d'informations à renseigner." };
    }
    return {
      outcome: "devisPageAction",
      subAction,
      label: client || lotName || "Informations client",
      client,
      clientAddress,
      description,
      lotName,
      vatRate,
      forfaitAmount,
      forfaitLabel
    };
  }

  return { outcome: "failed", message: "Je n'ai pas compris ce qu'il faut ajouter au devis." };
}

// Relit le blob a la toute fin, apres l'eventuel appel interne de creation
// (qui a pu ecrire sa propre version fraiche du blob) — jamais reutiliser le
// `db` lu en debut de requete pour ecrire ici, sous peine d'ecraser ce que la
// route cible vient d'enregistrer (tout writeDb() remplace le blob entier).
async function logTurn(userId, userMessage, result, conversationId, resolvedBy) {
  const db = await readDb();
  const now = new Date().toISOString();
  db.kojiAssistantMessages.push({
    id: `kojimsg-${Date.now()}-u`, userId, conversationId, role: "user", message: userMessage, outcome: null, meta: {}, createdAt: now
  });
  db.kojiAssistantMessages.push({
    id: `kojimsg-${Date.now()}-a`, userId, conversationId, role: "assistant", message: describeOutcome(result), outcome: result.outcome, meta: result, createdAt: now
  });
  // Mesure "algorithme vs IA" (9 oct, demande d'Amira) — voir
  // lib/assistant-algo-stats.js, consultable sur /admin/algo-stats.
  if (resolvedBy) logAlgoStat(db, { assistant: "koji", step: result.outcome || "autre", category: resolvedBy });
  await writeDb(db);
}

// Aucune collection dediee aux discussions — regroupe simplement les
// messages deja stockes par conversationId (titre = premier message de
// l'utilisatrice, date = dernier message). Les messages anterieurs a cet
// ajout (sans conversationId) tombent dans un seul groupe "legacy", pour ne
// rien casser plutot que de les faire disparaitre.
function groupConversations(messages) {
  const byId = new Map();
  for (const entry of messages) {
    const id = entry.conversationId || "legacy";
    if (!byId.has(id)) byId.set(id, { id, updatedAt: entry.createdAt, messageCount: 0, firstUserMessage: "" });
    const conv = byId.get(id);
    conv.messageCount += 1;
    if (String(entry.createdAt) > String(conv.updatedAt)) conv.updatedAt = entry.createdAt;
    if (entry.role === "user" && !conv.firstUserMessage) conv.firstUserMessage = entry.message;
  }
  return Array.from(byId.values())
    .map((c) => ({ id: c.id, title: (c.firstUserMessage || "Discussion").slice(0, 60), updatedAt: c.updatedAt, messageCount: c.messageCount }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function GET(request) {
  const db = await readDb();
  const auth = getAuth(request);
  if (!auth) return ok({ messages: [], conversations: [] });
  const messages = scopedItems(db.kojiAssistantMessages, auth.userId);
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId") || "";
  if (conversationId) {
    return ok({ messages: messages.filter((m) => m.conversationId === conversationId) });
  }
  return ok({ conversations: groupConversations(messages) });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const message = String(body.message || "").trim();
  if (!message) return badRequest("Message vide.");

  const auth = getAuth(request, body);
  if (!auth) return badRequest("Session expirée. Reconnectez-vous.", 401);

  const db = await readDb();
  const ctx = { auth, db };

  // Une discussion = un fil de messages regroupes par cet id (voir
  // groupConversations/GET) — genere cote client au demarrage d'une
  // discussion ; secours si absent (ancien client, appel isole).
  const conversationId = String(body.conversationId || "") || `koji-conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Contexte du chantier actuellement ouvert (8 oct, voir handleCreate plus
  // haut) — calcule une seule fois ici car utilise aussi bien par la
  // poursuite de flow (confirmType, ci-dessous) que par le premier tour
  // d'un message. components/Shell.jsx le transmet des que l'utilisatrice
  // est sur la fiche d'un chantier (app/chantiers/page.jsx).
  const contextChantierId = body.pageContext?.page === "chantier" ? String(body.pageContext.chantierId || "").trim() : "";

  // L'ancien questionnaire devis pas-a-pas (lib/koji-assistant-devis-flow.js,
  // "devisVisite") est retire (17 oct, demande d'Amira : "100% IA", plus de
  // questions d'un algorithme deterministe) — deja orpheline avant ce
  // changement (startDevisFlow n'etait plus appele nulle part, seule la
  // poursuite d'une conversation DEJA en cours restait geree). Un message
  // qui porterait encore cet etat (session tres ancienne) tombe desormais
  // simplement dans la classification IA normale ci-dessous, comme un
  // message neuf.

  // Poursuite d'une confirmation "detectee depuis une photo" deja en cours
  // (voir lib/koji-assistant-photo-confirm.js) — meme principe que
  // devisVisite ci-dessus : pas de reclassification IA, juste l'etape
  // suivante (confirmer le type, puis la reference manquante comme le
  // chantier) via le meme handleCreate deja utilise pour toutes les
  // creations directes.
  if (body.conversation?.state?.flow === "confirmType") {
    const state = body.conversation.state;
    const tool = TOOLS[state.type];
    const result = tool
      ? await advanceConfirmTypeFlow(ctx, state, message, body.conversation.originalMessage || message, tool, handleCreate, contextChantierId)
      : { outcome: "failed", message: "Une erreur est survenue." };
    after(() => logTurn(auth.userId, message, result, conversationId, "algorithme"));
    return ok({ ...result, conversationId });
  }

  const isSecondRound = Boolean(body.conversation && body.conversation.question);
  const photos = Array.isArray(body.photos) ? body.photos.slice(0, 8) : [];
  const onDevisPage = body.pageContext?.page === "devis";

  // Consignes admin (17 oct) : seuls bouhouchimira@gmail.com et
  // ablexpertrenov@gmail.com (lib/auth.js::isAdminEmail) peuvent donner une
  // consigne permanente a cet assistant. Contrairement aux 2 autres chats
  // (tour d'outils Claude), celui-ci classe le message en UN SEUL appel
  // IA qui doit rester strictement JSON (voir plus bas) — on ne touche
  // donc jamais ce pipeline de classification a 14 types, deja finement
  // regle : la detection d'une consigne admin est un pre-controle isole,
  // avec son propre petit appel IA, qui s'arrete AVANT le pipeline normal
  // si (et seulement si) il reconnait une demande de changement durable de
  // comportement — jamais sur une poursuite de conversation en cours
  // (isSecondRound), pour ne jamais interrompre un flow deja entame.
  let requesterEmail = "";
  const { data: ownerProfile } = await auth.supabase.from("users").select("email").eq("id", auth.userId).maybeSingle();
  requesterEmail = ownerProfile?.email || "";
  const isAdmin = requesterIsAdmin(requesterEmail);

  if (isAdmin && !isSecondRound) {
    const adminCheck = await detectAdminInstruction(message);
    if (adminCheck?.isInstructionUpdate && adminCheck.instruction) {
      setAssistantInstruction(db, "kojiAssistant", adminCheck.instruction);
      await writeDb(db);
      const result = {
        outcome: "success",
        message: "Consigne enregistrée et appliquée immédiatement à tous les utilisateurs de l'assistant koji."
      };
      after(() => logTurn(auth.userId, message, result, conversationId, "admin-consigne"));
      return ok({ ...result, conversationId });
    }
  }

  // Retour au 100% IA (9 oct, demande d'Amira) : le dictionnaire de mots-cles
  // (lib/koji-assistant-keywords.js) et le prompt resserre associe, ajoutes
  // le 8 oct, sont retires — un seul appel IA, classification complete,
  // a chaque message, comme avant cette experimentation.
  const promptText = buildPrompt({
    today: new Date().toISOString().slice(0, 10),
    message,
    isSecondRound,
    previousQuestion: body.conversation?.question || "",
    previousMessage: body.conversation?.originalMessage || "",
    hasPhotos: photos.length > 0,
    onDevisPage,
    db
  });

  const content = [];
  for (const dataUrl of photos) {
    const photo = parsePhoto(dataUrl);
    if (photo) content.push({ type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.data } });
  }
  content.push({ type: "text", text: promptText });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let aiText;
  try {
    const response = await anthropic.messages.create({
      // Haiku 4.5 : classification structuree, reflexion desactivee — un
      // modele plus leger repond nettement plus vite qu'un modele de
      // raisonnement pour cette tache, sans perte de fiabilite sur un
      // prompt aussi explicite (20 septembre, temps de reponse ressenti
      // trop long).
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      thinking: { type: "disabled" },
      system: "Tu es l'assistant koji du dashboard entreprise. Tu réponds uniquement en JSON strict, sans aucun texte ni balise markdown autour.",
      messages: [{ role: "user", content }]
    });
    const textBlock = response.content.find((b) => b.type === "text");
    aiText = textBlock?.text || "";
  } catch {
    return badRequest("L'assistant n'a pas pu traiter ce message. Réessayez.", 502);
  }

  let parsed;
  try {
    parsed = parseAiJson(aiText);
  } catch {
    return badRequest("Réponse de l'assistant illisible. Réessayez.", 502);
  }

  const action = ["delete", "create", "update", "navigate", "ambiguous", "devisPageAction"].includes(parsed.action) ? parsed.action : "autre";
  const type = TYPE_KEYS.includes(parsed.type) ? parsed.type : null;
  const tool = type ? TOOLS[type] : null;

  let result;
  if (action === "ambiguous") {
    result = handleAmbiguous(parsed) || {
      outcome: "unsupported",
      message: "Je n'ai pas ce service. Je peux par exemple créer ou supprimer un RDV, un devis, une facture, une dépense, une tâche, un contact, un chantier, ou ouvrir une page (\"ouvre le calendrier\")...",
      quickReplies: ["Créer un devis", "Créer une facture", "Ajouter un RDV", "Ajouter une dépense"]
    };
  } else if (action === "navigate") {
    result = handleNavigate(parsed);
  } else if (action === "devisPageAction" && onDevisPage) {
    result = await handleDevisPageAction({ ctx, parsed });
  } else if (onDevisPage && action === "create" && (type === "devis" || type === "ouvrage" || type === "fourniture")) {
    // Sur la page devis, une creation de type devis/ouvrage/fourniture vise
    // TOUJOURS le devis actuellement ouvert a l'ecran, jamais la
    // bibliotheque/le catalogue partage — redirige vers le meme traitement
    // que action="devisPageAction", a partir des champs deja extraits par
    // le schema de creation habituel de ce type (plus fiable que de
    // compter sur le modele pour choisir un action="devisPageAction" qu'il
    // connait moins bien — 20 septembre, corrige un echec de
    // classification observe en test).
    const f = parsed.fields && typeof parsed.fields === "object" ? parsed.fields : {};
    const devisPageParsed = type === "devis"
      ? { fields: { subAction: "setClientInfo", client: f.client, clientAddress: f.address || f.clientAddress, description: f.description, lotName: f.lotName, vatRate: f.vatRate, forfaitAmount: f.forfaitAmount, forfaitLabel: f.forfaitLabel } }
      : type === "ouvrage"
        ? { fields: { subAction: "addOuvrage", label: f.label, unit: f.unit } }
        : { fields: { subAction: "addFourniture", label: f.name, quantity: f.quantity, unit: f.unit } };
    result = await handleDevisPageAction({ ctx, parsed: devisPageParsed });
  } else if (!tool || action === "autre") {
    result = {
      outcome: "unsupported",
      message: "Je n'ai pas ce service. Je peux par exemple créer ou supprimer un RDV, un devis, une facture, une dépense, une tâche, un contact, un chantier, ou ouvrir une page (\"ouvre le calendrier\")...",
      quickReplies: ["Créer un devis", "Créer une facture", "Ajouter un RDV", "Ajouter une dépense"]
    };
  } else if (action === "delete") {
    result = await handleDelete({ ctx, tool, type, parsed, isSecondRound, message });
  } else if (action === "update") {
    result = await handleUpdate({ ctx, tool, type, parsed, isSecondRound, message });
  } else if (type === "devis") {
    // Un message qui donne deja client + description ("cree un devis pour
    // Dupont, fuite d'eau salle de bain") genere directement un devis
    // chiffre depuis la bibliotheque de prix (meme moteur que
    // /devis-ia/new, voir TOOLS.devis dans lib/koji-assistant-tools.js) —
    // demande d'Amira (29 sept) : l'assistant koji doit comprendre et
    // chiffrer avec la meme base partout dans l'app. Un simple "cree un
    // devis" sans aucun detail ouvre toujours la page vierge (decision du
    // 19 septembre, conservee pour ce cas precis — plus simple qu'une
    // question de clarification par question).
    const devisFields = parsed.fields && typeof parsed.fields === "object" ? parsed.fields : {};
    const hasClientOrDescription = String(devisFields.client || "").trim() || String(devisFields.description || "").trim();
    result = hasClientOrDescription
      ? await handleCreate({ ctx, tool, type, parsed, isSecondRound, message, rawPhotos: body.photos, contextChantierId })
      : { outcome: "navigate", path: "/devis?new=1", label: "Créer un devis" };
  } else if (type === "avenant") {
    result = await handleAvenantNavigate({ ctx, tool, parsed, isSecondRound, message });
  } else if (parsed.detectedFromPhoto) {
    const fields = parsed.fields && typeof parsed.fields === "object" ? parsed.fields : {};
    result = startConfirmTypeFlow(type, fields, tool, message);
  } else {
    result = await handleCreate({ ctx, tool, type, parsed, isSecondRound, message, rawPhotos: body.photos, contextChantierId });
  }

  after(() => logTurn(auth.userId, message, result, conversationId, "ia"));

  return ok({ ...result, conversationId });
}
