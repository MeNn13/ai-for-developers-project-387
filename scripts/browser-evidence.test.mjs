import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
function run({ expectedSha = sha, outcome = 'success', trace = true, report = true } = {}) {
  mkdirSync('artifacts', { recursive: true })
  const cwd = mkdtempSync(resolve('artifacts/browser-fixture-'))
  mkdirSync(`${cwd}/artifacts/e2e`, { recursive: true })
  const tracePath = `${cwd}/artifacts/e2e/trace.zip`
  if (trace) writeFileSync(tracePath, 'trace fixture')
  if (report) {
    writeFileSync(
      `${cwd}/artifacts/e2e/report.json`,
      JSON.stringify({
        suites: [
          {
            title: 'booking.spec.ts',
            specs: [
              {
                title: 'existing booking flow',
                tests: [
                  {
                    projectName: 'chromium',
                    status: 'expected',
                    results: [
                      { status: 'passed', attachments: [{ name: 'trace', path: tracePath }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    )
  }
  const result = spawnSync(process.execPath, [resolve('scripts/browser-evidence.mjs')], {
    cwd,
    env: {
      ...process.env,
      EXPECTED_SHA: expectedSha,
      SCENARIO_OUTCOME: outcome,
      PR_NUMBER: '123',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_RUN_ID: '456',
      GITHUB_RUN_ATTEMPT: '2',
    },
    encoding: 'utf8',
  })
  return {
    code: result.status,
    evidence: JSON.parse(readFileSync(`${cwd}/artifacts/e2e/evidence.json`, 'utf8')),
  }
}

test('records exact SHA, PR, run and executed scenarios with a successful trace', () => {
  const { code, evidence } = run()
  assert.equal(code, 0)
  assert.equal(evidence.result, 'success')
  assert.equal(evidence.expectedSha, sha)
  assert.equal(evidence.actualSha, sha)
  assert.equal(evidence.pullRequest, '123')
  assert.equal(evidence.runUrl, 'https://github.com/owner/repo/actions/runs/456/attempts/2')
  assert.equal(evidence.scenarios[0].title, 'booking.spec.ts > existing booking flow')
})

for (const [name, options] of [
  ['SHA mismatch', { expectedSha: '0'.repeat(40) }],
  ['failed browser step', { outcome: 'failure' }],
  ['missing successful trace', { trace: false }],
  ['missing report', { report: false }],
]) {
  test(`${name} leaves failure evidence and fails the check`, () => {
    const { code, evidence } = run(options)
    assert.equal(code, 1)
    assert.equal(evidence.result, 'failure')
  })
}
