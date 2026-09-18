import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPOSITORY = "Shosetzel69/job-search-command-center";
const RELEASE_TITLE_RE = /^\[Release\s+(\d+)\s+Wave\s+(\d+)\]/i;
const ISSUE_REF_RE = /#(\d+)/g;
const SHA_RE = /^[0-9a-f]{40}$/i;

export function parseReleaseTitle(title) {
  const match = String(title || "").match(RELEASE_TITLE_RE);
  if (!match) return null;
  return {
    release: Number(match[1]),
    wave: Number(match[2]),
    label: `Release ${match[1]} Wave ${match[2]}`,
  };
}

export function extractIssueNumbers(text) {
  const numbers = [];
  for (const match of String(text || "").matchAll(ISSUE_REF_RE)) {
    const value = Number(match[1]);
    if (Number.isSafeInteger(value) && value > 0) numbers.push(value);
  }
  return [...new Set(numbers)];
}

export function classifyRelatedIssues(issues) {
  const normalized = issues.filter((issue) => issue && !issue.pull_request);
  const blockers = normalized.filter((issue) =>
    issue.state === "open" && /(\[BUG\]|\[BLOCKER\]|\[P[0-3]\])/i.test(issue.title || ""),
  );
  const qa = normalized.filter((issue) =>
    issue.state === "open" && /(\[QA\]|\[TEST\])/i.test(issue.title || ""),
  );
  return {
    blockers: blockers.map(normalizeIssueSummary),
    qa: qa.map(normalizeIssueSummary),
  };
}

function normalizeIssueSummary(issue) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    url: issue.html_url,
  };
}

function evidenceSummary(record, run) {
  if (!record) return null;
  return {
    stage: record.stage || null,
    candidate_sha: record.candidate_sha || null,
    created_at: record.created_at || run?.created_at || null,
    run_id: Number(
      record.dev_pass?.run_id ||
      record.test_deploy?.run_id ||
      record.test_pass?.attestation_run_id ||
      record.prod_deploy_evidence?.run_id ||
      run?.id ||
      0
    ) || null,
    run_url:
      record.dev_pass?.run_url ||
      record.test_deploy?.run_url ||
      record.test_pass?.attestation_run_url ||
      record.prod_deploy_evidence?.run_url ||
      run?.html_url ||
      null,
  };
}

export function deriveLifecycle(candidateSha, evidence) {
  const prod = evidence.prod?.candidate_sha?.toLowerCase() === candidateSha ? evidence.prod : null;
  const testPass = evidence.testPass?.candidate_sha?.toLowerCase() === candidateSha ? evidence.testPass : null;
  const testDeploy = evidence.testDeploy?.candidate_sha?.toLowerCase() === candidateSha ? evidence.testDeploy : null;
  const dev = evidence.dev?.candidate_sha?.toLowerCase() === candidateSha ? evidence.dev : null;

  if (prod) {
    return {
      dev: "DEPLOYED",
      test: "PASS",
      prod: "PASS",
      next_gate: "PROD_SMOKE_CLOSEOUT",
    };
  }
  if (testPass) {
    return {
      dev: "DEPLOYED",
      test: "PASS",
      prod: "NOT_DEPLOYED",
      next_gate: "PROD_GO_AND_ROLLBACK_CHECK",
    };
  }
  if (testDeploy) {
    return {
      dev: "DEPLOYED",
      test: "DEPLOYED",
      prod: "NOT_DEPLOYED",
      next_gate: "TEST_INDEPENDENT_QA",
    };
  }
  if (dev) {
    return {
      dev: "DEPLOYED",
      test: "NOT_DEPLOYED",
      prod: "NOT_DEPLOYED",
      next_gate: "DEV_FUNCTIONAL_VERIFICATION",
    };
  }
  return {
    dev: "NOT_DEPLOYED",
    test: "NOT_DEPLOYED",
    prod: "NOT_DEPLOYED",
    next_gate: "DEV_DEPLOY",
  };
}

function githubHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "jscc-project-sanity",
  };
}

export function createGitHubApi({ token, repository, fetchImpl = fetch }) {
  if (!token) throw new Error("GH_TOKEN is required");
  if (repository !== DEFAULT_REPOSITORY) {
    throw new Error(`Repository must be ${DEFAULT_REPOSITORY}`);
  }
  const base = `https://api.github.com/repos/${repository}`;

  async function get(path) {
    const response = await fetchImpl(`${base}${path}`, { headers: githubHeaders(token) });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} for ${path}`);
    }
    return response.json();
  }

  return {
    listOpenPullRequests: () => get("/pulls?state=open&per_page=100&sort=updated&direction=desc"),
    getIssue: (number) => get(`/issues/${number}`),
    listWorkflowRuns: async (workflow) => {
      const payload = await get(`/actions/workflows/${workflow}/runs?event=workflow_dispatch&status=completed&per_page=50`);
      return payload.workflow_runs || [];
    },
    listRunArtifacts: async (runId) => {
      const payload = await get(`/actions/runs/${runId}/artifacts?per_page=100`);
      return payload.artifacts || [];
    },
  };
}

export function createArtifactReader({ repository, token, execFile = execFileSync }) {
  return async (runId, artifactName, fileName) => {
    const directory = mkdtempSync(join(tmpdir(), "jscc-sanity-"));
    try {
      execFile(
        "gh",
        ["run", "download", String(runId), "--repo", repository, "--name", artifactName, "--dir", directory],
        {
          env: { ...process.env, GH_TOKEN: token },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      return JSON.parse(readFileSync(join(directory, fileName), "utf8"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

async function findCandidateEvidence({ api, readArtifact, workflow, artifactName, fileName, candidateSha }) {
  const runs = await api.listWorkflowRuns(workflow);
  for (const run of runs) {
    if (run.conclusion !== "success") continue;
    const artifacts = await api.listRunArtifacts(run.id);
    if (!artifacts.some((artifact) => artifact.name === artifactName && !artifact.expired)) continue;
    try {
      const record = await readArtifact(run.id, artifactName, fileName);
      if (record?.candidate_sha?.toLowerCase() === candidateSha) {
        return { record, run };
      }
    } catch {
      // Historical evidence can expire. Missing evidence is reported conservatively instead of guessed.
    }
  }
  return null;
}

export async function buildProjectSnapshot({
  repository = DEFAULT_REPOSITORY,
  api,
  readArtifact,
  now = () => new Date().toISOString(),
}) {
  const warnings = [];
  const pullRequests = await api.listOpenPullRequests();
  const releases = pullRequests
    .map((pr) => ({ pr, release: parseReleaseTitle(pr.title) }))
    .filter((entry) => entry.release);

  if (releases.length > 1) {
    return {
      schema_version: "1.0",
      status: "WARNING",
      generated_at: now(),
      repository,
      warnings: ["Multiple active release PRs were found; candidate identity is ambiguous."],
      release_candidates: releases.map(({ pr, release }) => ({
        ...release,
        pr_number: pr.number,
        candidate_sha: pr.head?.sha || null,
        url: pr.html_url,
      })),
      legacy: { status: "UNTOUCHED", role: "OUTSIDE_PROMOTION" },
      chat_deletion: { verdict: "REQUIRES_CHAT_COMPARISON" },
    };
  }

  if (releases.length === 0) {
    return {
      schema_version: "1.0",
      status: "PASS",
      generated_at: now(),
      repository,
      release: null,
      environments: {
        dev: { status: "IDLE", evidence: null },
        test: { status: "IDLE", evidence: null },
        prod: { status: "CURRENT_PROD_UNCHANGED", evidence: null },
      },
      blockers: [],
      qa: [],
      next_gate: "NO_ACTIVE_RELEASE",
      legacy: { status: "UNTOUCHED", role: "OUTSIDE_PROMOTION" },
      warnings,
      chat_deletion: { verdict: "REQUIRES_CHAT_COMPARISON" },
    };
  }

  const { pr, release } = releases[0];
  const candidateSha = String(pr.head?.sha || "").toLowerCase();
  if (!SHA_RE.test(candidateSha)) {
    warnings.push("Active release PR does not expose a valid immutable head SHA.");
  }

  const refs = extractIssueNumbers(pr.body).filter((number) => number !== pr.number);
  const relatedIssues = [];
  for (const number of refs) {
    try {
      relatedIssues.push(await api.getIssue(number));
    } catch {
      warnings.push(`Related issue #${number} could not be read.`);
    }
  }
  const classified = classifyRelatedIssues(relatedIssues);

  const evidence = {
    dev: null,
    testDeploy: null,
    testPass: null,
    prod: null,
    devRun: null,
    testDeployRun: null,
    testPassRun: null,
    prodRun: null,
  };

  if (SHA_RE.test(candidateSha)) {
    const dev = await findCandidateEvidence({
      api,
      readArtifact,
      workflow: "deploy-environment.yml",
      artifactName: "promotion-dev-pass",
      fileName: "promotion-record.json",
      candidateSha,
    });
    const testDeploy = await findCandidateEvidence({
      api,
      readArtifact,
      workflow: "deploy-environment.yml",
      artifactName: "promotion-test-deployed",
      fileName: "promotion-record.json",
      candidateSha,
    });
    const testPass = await findCandidateEvidence({
      api,
      readArtifact,
      workflow: "record-test-pass.yml",
      artifactName: "promotion-test-pass",
      fileName: "promotion-record.json",
      candidateSha,
    });
    const prod = await findCandidateEvidence({
      api,
      readArtifact,
      workflow: "prod-cutover.yml",
      artifactName: "release-record",
      fileName: "release-record.json",
      candidateSha,
    });
    evidence.dev = dev?.record || null;
    evidence.testDeploy = testDeploy?.record || null;
    evidence.testPass = testPass?.record || null;
    evidence.prod = prod?.record || null;
    evidence.devRun = dev?.run || null;
    evidence.testDeployRun = testDeploy?.run || null;
    evidence.testPassRun = testPass?.run || null;
    evidence.prodRun = prod?.run || null;
  }

  const lifecycle = SHA_RE.test(candidateSha)
    ? deriveLifecycle(candidateSha, evidence)
    : { dev: "UNKNOWN", test: "UNKNOWN", prod: "UNKNOWN", next_gate: "RESOLVE_CANDIDATE_SHA" };

  return {
    schema_version: "1.0",
    status: warnings.length ? "WARNING" : "PASS",
    generated_at: now(),
    repository,
    release: {
      ...release,
      pr_number: pr.number,
      title: pr.title,
      candidate_sha: candidateSha || null,
      url: pr.html_url,
      updated_at: pr.updated_at || null,
    },
    environments: {
      dev: { status: lifecycle.dev, evidence: evidenceSummary(evidence.dev, evidence.devRun) },
      test: {
        status: lifecycle.test,
        deployment_evidence: evidenceSummary(evidence.testDeploy, evidence.testDeployRun),
        pass_evidence: evidenceSummary(evidence.testPass, evidence.testPassRun),
      },
      prod: { status: lifecycle.prod, evidence: evidenceSummary(evidence.prod, evidence.prodRun) },
    },
    blockers: classified.blockers,
    qa: classified.qa,
    next_gate: lifecycle.next_gate,
    legacy: {
      status: "UNTOUCHED",
      role: "OUTSIDE_PROMOTION",
      note: "Sanity is read-only and never mutates LEGACY.",
    },
    warnings,
    chat_deletion: {
      verdict: "REQUIRES_CHAT_COMPARISON",
      rule: "SAFE_TO_DELETE only after chat-only UNIQUE project information is persisted.",
    },
  };
}

export function formatProjectSnapshot(snapshot) {
  if (!snapshot.release) {
    return [
      "# JSCC Current Project State",
      "",
      `Generated: ${snapshot.generated_at}`,
      `SANITY: ${snapshot.status}`,
      "",
      "No active release candidate.",
      "",
      `Next gate: ${snapshot.next_gate}`,
      `LEGACY: ${snapshot.legacy.status}`,
      "",
    ].join("\n");
  }

  const blockerLines = snapshot.blockers.length
    ? snapshot.blockers.map((issue) => `- #${issue.number} ${issue.title}`)
    : ["- none"];
  const qaLines = snapshot.qa.length
    ? snapshot.qa.map((issue) => `- #${issue.number} ${issue.title}`)
    : ["- none"];

  return [
    "# JSCC Current Project State",
    "",
    `Generated: ${snapshot.generated_at}`,
    `SANITY: ${snapshot.status}`,
    "",
    `Release: ${snapshot.release.label}`,
    `Candidate: PR #${snapshot.release.pr_number} / \`${snapshot.release.candidate_sha}\``,
    `DEV: ${snapshot.environments.dev.status}`,
    `TEST: ${snapshot.environments.test.status}`,
    `PROD: ${snapshot.environments.prod.status}`,
    `Next gate: ${snapshot.next_gate}`,
    `LEGACY: ${snapshot.legacy.status} / ${snapshot.legacy.role}`,
    "",
    "## Blockers",
    ...blockerLines,
    "",
    "## QA",
    ...qaLines,
    "",
    "## Warnings",
    ...(snapshot.warnings.length ? snapshot.warnings.map((warning) => `- ${warning}`) : ["- none"]),
    "",
    "## Chat deletion",
    `Verdict: ${snapshot.chat_deletion.verdict}`,
    snapshot.chat_deletion.rule ? `Rule: ${snapshot.chat_deletion.rule}` : "",
    "",
  ].filter((line, index, values) => !(line === "" && values[index - 1] === "")).join("\n") + "\n";
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replaceAll("-", "_");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    args[key] = value;
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const api = createGitHubApi({ token, repository });
  const readArtifact = createArtifactReader({ repository, token });
  const snapshot = await buildProjectSnapshot({ repository, api, readArtifact });

  if (args.output_json) {
    writeFileSync(resolve(args.output_json), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  } else {
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  }

  if (args.output_md) {
    writeFileSync(resolve(args.output_md), formatProjectSnapshot(snapshot), "utf8");
  }

  if (snapshot.status === "WARNING") process.exitCode = 2;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`PROJECT_SANITY_FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
