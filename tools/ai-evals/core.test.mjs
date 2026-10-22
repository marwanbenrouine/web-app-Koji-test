import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildRequestPayload, grade, normalizeResponse, parseSse, validateTarget } from "./core.mjs";

test("les adresses de production sont bloquees", () => {
  assert.throws(() => validateTarget("https://kojibuild.com"), /production/);
  assert.throws(() => validateTarget("https://www.kojibuild.com"), /production/);
  assert.throws(() => validateTarget("https://staging.kojibuild.com"), /production/);
  assert.throws(() => validateTarget("https://web-app-koji.vercel.app"), /production/);
  assert.equal(validateTarget("http://localhost:3000"), "http://localhost:3000");
  assert.equal(validateTarget("https://koji-staging.example.com"), "https://koji-staging.example.com");
});

test("le constructeur respecte les trois protocoles", () => {
  const radar = buildRequestPayload({ assistant: "radar", input: { message: "Bonjour" } }, "conv1");
  assert.deepEqual(radar.turns, [{ role: "user", text: "Bonjour" }]);
  assert.equal(radar.conversationId, "conv1");
  const devis = buildRequestPayload({ assistant: "devisChat", input: { message: "Ajoute un lot" } }, "conv2");
  assert.ok(devis.quoteSnapshot.totaux);
  assert.equal(devis.turns[0].role, "user");
  const general = buildRequestPayload({ assistant: "kojiAssistant", input: { message: "Calendrier", pageContext: { page: "devis" } } }, "conv3");
  assert.deepEqual(general.pageContext, { page: "devis" });
  assert.equal(general.message, "Calendrier");
});

test("SSE : segments multiples et evenements avec trait d'union", () => {
  const body = 'event: delta\r\ndata: {"text":"Bonjour"}\r\n\r\nevent: photo-request\r\ndata: {"sujet":"cuisine"}\r\n\r\nevent: done\r\ndata: {"finished":false}\r\n\r\n';
  const events = parseSse(body);
  assert.deepEqual(events.map((item) => item.event), ["delta", "photo-request", "done"]);
  assert.equal(events[0].data.text, "Bonjour");
});

test("echec si une action obligatoire manque", () => {
  const t = { assistant: "devisChat", expect: { eventsInclude: ["done"], actionsInclude: ["updateOuvrage"], actionsExclude: ["addOuvrage"] } };
  const res = normalizeResponse(t, 200, 'event: action\ndata: {"subAction":"addOuvrage"}\n\nevent: done\ndata: {"finished":false}\n\n');
  const result = grade(t, res);
  assert.equal(result.passed, false);
  assert.equal(result.issues.length, 2);
});

test("classification navigation : reussite si resultat exact", () => {
  const t = { assistant: "kojiAssistant", expect: { outcome: "navigate", path: "/calendrier" } };
  const res = normalizeResponse(t, 200, '{"outcome":"navigate","path":"/calendrier"}');
  assert.equal(grade(t, res).passed, true);
});

test("les scenarios ont un identifiant unique et une route reconnue", async () => {
  const cases = JSON.parse(await readFile(new URL("./scenarios.json", import.meta.url), "utf8"));
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  for (const c of cases) {
    assert.ok(["radar", "devisChat", "kojiAssistant"].includes(c.assistant));
    assert.ok(["portal", "pro", "proB"].includes(c.authRole));
    assert.ok(c.input?.message || c.input?.turns);
    assert.ok(c.expect);
  }
});
