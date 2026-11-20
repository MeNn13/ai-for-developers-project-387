#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const candidate = process.env.INITIAL_CANDIDATE_ROOT
const git = (...args) => execFileSync('git', args, { cwd: candidate, encoding: 'utf8' }).trim()
const read = (path) => readFileSync(join(candidate, path), 'utf8')
if (process.argv[2] === 'run') {
  // Stand in for the external CLI only. All candidate and verification code is real.
  process.stdin.resume()
  const invalid = process.env.CHECK_SCENARIO === 'invalid'
  const path = invalid ? 'README.md' : 'contract/main.tsp'
  const content = invalid
    ? read(path) + '\n#    Invalid   formatting\n'
    : read(path).replace('title: "Booking Calendar API"', 'title: "Booking Calendar CI"')
  const reply = {
    version: 1,
    message: 'test: exercise candidate verification (#57)',
    files: [{ path, mode: '100644', content }],
    risk: 'Documentation only',
    rollback: 'Revert the commit',
  }
  const sessionID = 'fixture'
  for (const [type, fields] of [
    ['text', { text: JSON.stringify(reply) }],
    ['step_finish', { reason: 'stop' }],
  ])
    console.log(
      JSON.stringify({ type, sessionID, part: { sessionID, messageID: 'reply', ...fields } }),
    )
} else {
  for (const scenario of ['valid', 'invalid']) {
    const head = git('rev-parse', 'HEAD')
    const io = join(process.env.RUNNER_TEMP, 'graph-' + scenario)
    mkdirSync(io)
    const json = (name) => JSON.parse(readFileSync(join(io, name + '.json'), 'utf8'))
    writeFileSync(
      join(io, 'context.json'),
      JSON.stringify({
        version: 1,
        runId: 1,
        phase: 'first',
        expectedHead: head,
        trustedSha: head,
        base: head,
        tickets: [57],
        graph: [{ number: 57, blockedBy: [] }],
        deadline: Date.now() + 60 * 60 * 1000,
        commitDate: '2026-11-15T00:00:00Z',
      }),
    )
    const result = spawnSync(
      process.execPath,
      [resolve(import.meta.dirname, 'implementation-graph.mjs'), 'first'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          INITIAL_IO: io,
          GITHUB_OUTPUT: join(io, 'outputs'),
          GITHUB_RUN_ATTEMPT: '1',
          OPENCODE_BIN: fileURLToPath(import.meta.url),
          OPENCODE_API_KEY: 'fixture',
          CHECK_SCENARIO: scenario,
        },
      },
    )
    if (scenario === 'valid') {
      assert.equal(result.status, 0, result.stderr)
      assert.equal(json('result').ready, false)
      assert.ok(
        json('result').files.some(
          (file) =>
            file.path === 'contract/openapi/openapi.yaml' &&
            file.content.includes('Booking Calendar CI'),
        ),
      )
      assert.equal(json('result').candidateSha, git('rev-parse', 'HEAD'))
      assert.equal(json('verification').sha, json('result').candidateSha)
      assert.equal(json('integrations')[0].ticket, 57)
    } else {
      assert.equal(result.status, 1, result.stderr)
      assert.ok(
        result.stderr.includes(
          'phase=first ticket=57 operation=check category=task_failed task=lint sha=' +
            git('rev-parse', 'HEAD'),
        ),
        result.stderr,
      )
      assert.equal(existsSync(join(io, 'verification.json')), false)
    }
  }
}
