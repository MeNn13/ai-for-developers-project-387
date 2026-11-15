import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

const directory = 'artifacts/e2e'
mkdirSync(directory, { recursive: true })
const actualSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const expectedSha = process.env.EXPECTED_SHA
let report
try {
  report = JSON.parse(readFileSync(`${directory}/report.json`, 'utf8'))
} catch {
  // Installation, build and browser startup failures may leave no report.
}
const scenarios = []
function visit(suite, parents = []) {
  const names = [...parents, suite.title].filter(Boolean)
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      scenarios.push({
        title: [...names, spec.title].join(' > '),
        project: test.projectName,
        status: test.status,
        results: (test.results ?? []).map((result) => ({
          status: result.status,
          traces: (result.attachments ?? [])
            .filter((attachment) => attachment.name === 'trace')
            .map((attachment) => attachment.path),
        })),
      })
    }
  }
  for (const child of suite.suites ?? []) visit(child, names)
}
if (report) visit(report)
const success =
  /^\d+$/.test(process.env.PR_NUMBER ?? '') &&
  /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') &&
  /^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT ?? '') &&
  Boolean(process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY) &&
  /^[a-f0-9]{40}$/.test(expectedSha ?? '') &&
  actualSha === expectedSha &&
  process.env.SCENARIO_OUTCOME === 'success' &&
  !report?.errors?.length &&
  scenarios.length > 0 &&
  scenarios.every(
    (scenario) =>
      scenario.status === 'expected' &&
      scenario.results.length > 0 &&
      scenario.results.every(
        (result) =>
          result.status === 'passed' &&
          result.traces.length > 0 &&
          result.traces.every((path) => existsSync(path)),
      ),
  )
writeFileSync(
  `${directory}/evidence.json`,
  JSON.stringify(
    {
      result: success ? 'success' : 'failure',
      pullRequest: process.env.PR_NUMBER,
      expectedSha,
      actualSha,
      runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`,
      scenarios,
    },
    null,
    2,
  ) + '\n',
)
if (!success) process.exitCode = 1
