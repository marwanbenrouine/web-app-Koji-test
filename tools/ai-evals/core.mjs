export const ASSISTANT_ROUTES = Object.freeze({
  radar: "/api/radar-chat",
  devisChat: "/api/devis-chat",
  kojiAssistant: "/api/koji-assistant"
});

const PRODUCTION_HOSTS = new Set(["web-app-koji.vercel.app"]);

export function validateTarget(value) {
  const target = new URL(value);
  if (!new Set(["http:", "https:"]).has(target.protocol)) {
    throw new Error("Seules les URL HTTP(S) sont autorisees.");
  }
  const hostname = target.hostname.toLowerCase();
  if (hostname === "kojibuild.com" || hostname.endsWith(".kojibuild.com") || PRODUCTION_HOSTS.has(hostname)) {
    throw new Error("L'evaluation sur l'URL de production Koji est interdite.");
  }
  if (target.username || target.password || target.search || target.hash) {
    throw new Error("L'URL de test ne doit contenir ni identifiants ni parametres.");
  }
  return target.origin;
}

export function buildRequestPayload(testCase, conversationId) {
  const input = testCase.input || {};
  if (testCase.assistant === "kojiAssistant") {
    return {
      message: String(input.message || ""),
      conversationId,
      ...(input.pageContext ? { pageContext: input.pageContext } : {})
    };
  }
  if (testCase.assistant === "radar") {
    return {
      turns: input.turns || [{ role: "user", text: String(input.message || "") }],
      conversationId,
      ...(input.prenom ? { prenom: input.prenom } : {}),
      ...(input.draftId ? { draftId: input.draftId } : {})
    };
  }
  if (testCase.assistant === "devisChat") {
    return {
      turns: input.turns || [{ role: "user", text: String(input.message || "") }],
      quoteSnapshot: input.quoteSnapshot || { lots: [], client: {}, totaux: { sousTotalLignes: 0, majorations: [] } }
    };
  }
  throw new Error(`Assistant inconnu : ${testCase.assistant}`);
}

// Parse le protocole SSE reel de Radar et Devis : delta, action, choice,
// photo-request, done, error. La separation accepte LF et CRLF.
export function parseSse(text) {
  const frames = String(text || "").replace(/\r\n/g, "\n").split(/\n\n+/);
  const events = [];
  for (const frame of frames) {
    if (!frame.trim()) continue;
    let event = "message";
    const data = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) continue;
    let payload;
    try { payload = JSON.parse(data.join("\n")); }
    catch { payload = { text: data.join("\n") }; }
    events.push({ event, data: payload });
  }
  return events;
}

export function normalizeResponse(testCase, status, responseText) {
  if (testCase.assistant === "kojiAssistant") {
    let body;
    try { body = JSON.parse(responseText); }
    catch { body = { parseError: true }; }
    return { status, body, events: [], text: String(body?.message || "") };
  }
  const events = parseSse(responseText);
  return {
    status,
    events,
    text: events.filter((entry) => entry.event === "delta").map((entry) => entry.data?.text || "").join(""),
    body: events.findLast((entry) => entry.event === "done")?.data || {}
  };
}

export function grade(testCase, result) {
  const expected = testCase.expect || {};
  const issues = [];
  if (result.status !== (expected.httpStatus ?? 200)) {
    issues.push(`HTTP ${result.status}, attendu ${expected.httpStatus ?? 200}`);
  }
  const eventNames = result.events.map((entry) => entry.event);
  for (const name of expected.eventsInclude || []) {
    if (!eventNames.includes(name)) issues.push(`Evenement absent : ${name}`);
  }
  for (const name of expected.eventsExclude || []) {
    if (eventNames.includes(name)) issues.push(`Evenement interdit : ${name}`);
  }
  if (expected.outcome && result.body?.outcome !== expected.outcome) {
    issues.push(`Outcome ${result.body?.outcome || "absent"}, attendu ${expected.outcome}`);
  }
  if (expected.path && result.body?.path !== expected.path) {
    issues.push(`Navigation ${result.body?.path || "absente"}, attendue ${expected.path}`);
  }
  if (expected.finished !== undefined && result.body?.finished !== expected.finished) {
    issues.push(`finished=${String(result.body?.finished)}, attendu ${expected.finished}`);
  }
  const actions = result.events.filter((entry) => entry.event === "action").map((entry) => entry.data);
  for (const required of expected.actionsInclude || []) {
    if (!actions.some((action) => action?.subAction === required)) {
      issues.push(`Action absente : ${required}`);
    }
  }
  for (const forbidden of expected.actionsExclude || []) {
    if (actions.some((action) => action?.subAction === forbidden)) {
      issues.push(`Action interdite : ${forbidden}`);
    }
  }
  for (const fragment of expected.textIncludes || []) {
    if (!result.text.toLocaleLowerCase("fr").includes(fragment.toLocaleLowerCase("fr"))) {
      issues.push(`Texte attendu absent : ${fragment}`);
    }
  }
  if (eventNames.includes("error")) issues.push("Erreur SSE emise par Koji");
  if (result.body?.parseError) issues.push("JSON applicatif illisible");
  return { passed: issues.length === 0, issues };
}

export function summarize(testCase, normalized, scored, durationMs, repetition) {
  return {
    id: testCase.id,
    assistant: testCase.assistant,
    category: testCase.category,
    repetition,
    passed: scored.passed,
    issues: scored.issues,
    status: normalized.status,
    durationMs,
    outcome: normalized.body?.outcome || null,
    events: normalized.events.map((entry) => entry.event),
    actions: normalized.events.filter((entry) => entry.event === "action").map((entry) => entry.data?.subAction || "unknown")
  };
}
