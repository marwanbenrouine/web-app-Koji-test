#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ASSISTANT_ROUTES, buildRequestPayload, grade, normalizeResponse, summarize, validateTarget } from "./core.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const position = argv.indexOf(name);
  return position < 0 ? fallback : argv[position + 1];
};

function config() {
  const repeat = Number(option("--repeat", "1"));
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) throw new Error("--repeat doit etre compris entre 1 et 5.");
  const maxCalls = Number(option("--max-calls", "100"));
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 100) throw new Error("--max-calls doit etre compris entre 1 et 100.");
  return {
    live: flag("--live"),
    allowWrites: flag("--allow-writes") && process.env.KOJI_EVAL_ALLOW_WRITES === "yes",
    suite: option("--suite", "all"),
    repeat,
    baseline: option("--baseline", ""),
    reportDir: option("--report-dir", "tmp/koji-ai-evals"),
    maxCalls
  };
}

function getToken(testCase) {
  const key = testCase.authRole === "portal" ? "KOJI_EVAL_PORTAL_TOKEN"
    : testCase.authRole === "proB" ? "KOJI_EVAL_PRO_B_TOKEN"
      : "KOJI_EVAL_PRO_TOKEN";
  const token = process.env[key];
  if (!token) throw new Error(`Variable d'authentification manquante : ${key}`);
  return token;
}

async function perform(baseUrl, testCase, repetition) {
  const token = getToken(testCase);
  const url = `${baseUrl}${ASSISTANT_ROUTES[testCase.assistant]}`;
  const body = buildRequestPayload(testCase, `eval-${testCase.id}-${repetition}-${randomUUID()}`);
  const started = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
    redirect: "error"
  });
  const content = await response.text();
  const normalized = normalizeResponse(testCase, response.status, content);
  const result = grade(testCase, normalized);
  return summarize(testCase, normalized, result, Math.round(performance.now() - started), repetition);
}

function markdownReport(report, baseline) {
  const successful = report.results.filter((x) => x.passed).length;
  const rows = report.results.map((x) =>
    `| ${x.id} | ${x.assistant} | ${x.passed ? "OK" : "ECHEC"} | ${x.durationMs ?? "-"} | ${x.issues.join("; ").replaceAll("|", "/")} |`
  );
  const regressions = baseline?.results?.filter((previous) => {
    const current = report.results.find((x) => x.id === previous.id && x.repetition === previous.repetition);
    return previous.passed && current && !current.passed;
  }) || [];
  return [
    "# KOJI — Rapport des evaluations IA",
    "",
    `- Version : ${report.version}`,
    `- URL cible : ${report.target}`,
    `- Tests reussis : ${successful}/${report.results.length}`,
    `- Regressions face a la reference : ${regressions.length}`,
    "",
    "| Test | Assistant | Resultat | Duree (ms) | Anomalies |",
    "| --- | --- | --- | ---: | --- |",
    ...rows,
    "",
    "Les tests de contenu libre necessitent une evaluation metier distincte. Aucun appel modele-evaluateur n'est effectue par ce runner.",
    ""
  ].join("\n");
}

async function main() {
  const settings = config();
  const cases = JSON.parse(await readFile(new URL("./scenarios.json", import.meta.url), "utf8"));
  const selected = cases.filter((testCase) => settings.suite === "all" || testCase.suite === settings.suite);
  if (!selected.length) throw new Error(`Suite inconnue ou vide : ${settings.suite}`);
  if (!settings.live) {
    process.stdout.write(`Mode preparation : ${selected.length} scenarios. Aucun appel API effectue.\n`);
    for (const c of selected) process.stdout.write(`- ${c.id} [${c.assistant}] ${c.title}\n`);
    process.stdout.write("Pour executer : --live avec KOJI_EVAL_BASE_URL et des tokens de test.\n");
    return;
  }

  const target = validateTarget(process.env.KOJI_EVAL_BASE_URL || "");
  const hostname = new URL(target).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname) && process.env.KOJI_EVAL_ALLOWED_HOST !== hostname) {
    throw new Error("Renseigner KOJI_EVAL_ALLOWED_HOST avec le nom d'hote exact de la preproduction.");
  }
  const executable = selected.filter((testCase) => !testCase.sideEffect || testCase.sideEffect === "none" || settings.allowWrites);
  const skipped = selected.length - executable.length;
  if (executable.length * settings.repeat > settings.maxCalls) throw new Error("Plafond d'appels depasse : reduire la suite ou les repetitions.");
  const results = [];
  for (const testCase of executable) {
    for (let repetition = 1; repetition <= settings.repeat; repetition += 1) {
      try {
        const result = await perform(target, testCase, repetition);
        results.push(result);
        process.stdout.write(`${result.passed ? "OK" : "ECHEC"} ${testCase.id} #${repetition}\n`);
      } catch (error) {
        results.push({ id: testCase.id, assistant: testCase.assistant, category: testCase.category, repetition, passed: false, issues: [error.message], status: null, durationMs: null });
        process.stderr.write(`ECHEC ${testCase.id} #${repetition} : ${error.message}\n`);
      }
      // Cadence prudente pour les appels API payants ; aucun parallellisme.
      await new Promise((done) => setTimeout(done, 1200));
    }
  }
  const report = {
    version: process.env.KOJI_EVAL_VERSION || "non-renseignee",
    target,
    timestamp: new Date().toISOString(),
    skipped,
    results
  };
  const baseline = settings.baseline ? JSON.parse(await readFile(resolve(settings.baseline), "utf8")) : null;
  const dir = resolve(settings.reportDir);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(resolve(dir, "report.md"), markdownReport(report, baseline));
  process.stdout.write(`Rapport : ${dir} (${skipped} scenarios non executes pour risque d'ecriture).\n`);
  if (results.some((item) => !item.passed)) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`Evaluation interrompue : ${error.message}\n`);
  process.exitCode = 1;
});
