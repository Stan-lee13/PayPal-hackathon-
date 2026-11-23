#!/usr/bin/env node
/**
 * Name what failed, where anyone can read it.
 *
 * Why this exists. A matrix job once failed at "Whole suite against real Postgres" and the only thing the run
 * page said was "Process completed with exit code 1". The vitest log that called it a flake was inside an
 * uploaded artifact, and artifacts require an authenticated download — so the failure could not be diagnosed
 * from the run itself, and the same commit passed on the next run. That is not a testing problem; it is a
 * reporting problem.
 *
 * What this does. It reads the JSON reports the workflow already writes, and prints every test that did not
 * pass — its file, its full name and the first of its error messages — in three places that need no
 * credentials:
 *
 *   • the step log, which is the job's own page;
 *   • a GitHub error annotation per failure, which is what the run summary and the annotations panel show;
 *   • the job's step summary, which renders as markdown on the run page.
 *
 * It exits 0 on purpose. This step reports; it never decides. The assertion steps next to it are what fail the
 * job, and a reporter that could also fail would be able to hide the failure it was describing.
 */
import fs from "node:fs";

const REPORTS = [
  { path: "/tmp/concurrency.json", label: "concurrency suite" },
  { path: "/tmp/suite.json", label: "whole suite" },
];

/** GitHub workflow commands need %-escapes for the characters that would end the command early. */
function escapeCommandValue(value) {
  return String(value)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

function firstLine(text) {
  const line = String(text ?? "")
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line ?? "";
}

function readReport(path) {
  if (!fs.existsSync(path)) return { state: "missing" };
  try {
    const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
    return { state: "ok", report: parsed };
  } catch (error) {
    return { state: "unreadable", error: error instanceof Error ? error.message : String(error) };
  }
}

function fileOf(result) {
  const name = result.name ?? result.testFilePath ?? "";
  return String(name).replace(`${process.cwd()}/`, "");
}

function describe(failure) {
  const where = failure.file ? `\`${failure.file}\`` : "an unnamed file";
  const what = failure.fullName || failure.title || "(unnamed test)";
  const why = failure.message ? ` — ${failure.message}` : "";
  return `${where} › ${what}${why}`;
}

const summary = [];
const annotations = [];
let sawAnyReport = false;

for (const { path, label } of REPORTS) {
  const { state, report, error } = readReport(path);
  if (state === "missing") {
    summary.push(`- **${label}**: no JSON report at \`${path}\` — the run stopped before the report was written.`);
    console.log(`${label}: no report at ${path}`);
    continue;
  }
  if (state === "unreadable") {
    summary.push(`- **${label}**: \`${path}\` exists but is not valid JSON (${error}).`);
    annotations.push(`::error title=${escapeCommandValue(label)}::${escapeCommandValue(`${path} is not valid JSON: ${error}`)}`);
    continue;
  }

  sawAnyReport = true;
  const files = report.testResults ?? [];
  const failed = [];
  const skipped = [];
  for (const result of files) {
    for (const assertion of result.assertionResults ?? []) {
      const entry = {
        file: fileOf(result),
        fullName: assertion.fullName,
        title: assertion.title,
        status: assertion.status,
        message: firstLine((assertion.failureMessages ?? [])[0]),
      };
      if (assertion.status === "failed") failed.push(entry);
      if (assertion.status === "pending" || assertion.status === "skipped" || assertion.status === "todo") skipped.push(entry);
    }
  }

  const passed = report.numPassedTests ?? 0;
  const failedCount = report.numFailedTests ?? 0;
  const skippedCount = report.numPendingTests ?? 0;
  console.log(
    `${label}: ${files.length} files, ${passed} passed, ${failedCount} failed, ${skippedCount} skipped, success=${report.success}`,
  );

  if (failed.length === 0 && skipped.length === 0) {
    summary.push(`- **${label}**: ${passed} passed, nothing failed, nothing skipped.`);
    continue;
  }

  summary.push(`- **${label}**: ${passed} passed, ${failedCount} failed, ${skippedCount} skipped.`);
  for (const failure of failed) {
    console.log(`  FAILED  ${describe(failure)}`);
    summary.push(`  - ${describe(failure)}`);
    annotations.push(
      `::error file=${escapeCommandValue(failure.file)},title=${escapeCommandValue(`${label}: ${failure.fullName || failure.title || "failed"}`)}::${escapeCommandValue(
        describe(failure),
      )}`,
    );
  }
  for (const entry of skipped) {
    // CI treats a skip as a failure of coverage, so a skip is reported exactly like a failure.
    console.log(`  SKIPPED ${describe(entry)}`);
    summary.push(`  - ${describe(entry)} *(skipped: the suite did not exercise it)*`);
    annotations.push(
      `::error file=${escapeCommandValue(entry.file)},title=${escapeCommandValue(`${label}: skipped`)}::${escapeCommandValue(
        describe(entry),
      )}`,
    );
  }
}

if (!sawAnyReport) {
  summary.push(
    "- No JSON report was readable. The step that writes it failed before it could, which is itself the finding: look at that step's log.",
  );
}

for (const annotation of annotations) console.log(annotation);

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  const body = ["## Failing tests, by name", "", ...summary, ""].join("\n");
  fs.appendFileSync(summaryPath, body);
  console.log(`wrote ${summary.length} line(s) to the step summary`);
}

console.log("\nThis step reports; the assertion steps decide. Exit status is 0 by design.");
process.exit(0);
