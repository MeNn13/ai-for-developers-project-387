import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { validateRepair } from './implementation-repair.mjs'
import { completion } from './implementation-completion.mjs'

const reply = {
  version: 1,
  files: [{ path: 'frontend/src/booking.ts', mode: '100644', content: 'export const x = 1' }],
  message: 'fix(web): correct slot selection (#41)',
  risk: 'UI behavior',
  rollback: 'Revert commit',
}
test('repair model has no write token and emits bounded file data with draft readiness', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'repair-model-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const cli = join(dir, 'fake.mjs')
  writeFileSync(join(dir, 'prompt.json'), '{}')
  writeFileSync(join(dir, 'context.json'), JSON.stringify({ tickets: [41] }))
  writeFileSync(
    cli,
    `import assert from 'node:assert/strict'; assert.equal(process.env.GH_TOKEN, undefined); assert.equal(process.env.PUBLISH_APP_PRIVATE_KEY, undefined); console.log(JSON.stringify({type:'text',part:{text:JSON.stringify(${JSON.stringify(reply)})}})); console.log(JSON.stringify({type:'step_finish',part:{reason:'stop'}}));`,
  )
  // A preload implements the process CLI adapter without a platform-specific shell shim.
  const preload = join(dir, 'adapter.mjs')
  writeFileSync(
    preload,
    `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; const original=cp.spawnSync; cp.spawnSync=(bin,args,opts)=>original(process.execPath,[${JSON.stringify(cli)}],opts); syncBuiltinESMExports();`,
  )
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(preload).href,
      join(import.meta.dirname, 'implementation-repair.mjs'),
      'model',
    ],
    {
      env: {
        ...process.env,
        REPAIR_IO: dir,
        OPENCODE_API_KEY: 'fake',
        GH_TOKEN: 'write-token',
        PUBLISH_APP_PRIVATE_KEY: 'key',
      },
      encoding: 'utf8',
    },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(readFileSync(join(dir, 'reply.json'))).ready, false)
  assert.throws(
    () =>
      validateRepair(
        { ...reply, files: [{ path: 'scripts/agent.mjs', mode: '100644', content: 'code' }] },
        { tickets: [41] },
      ),
    /repair_input/,
  )
})
test('independent completion reports cancellation, timeout, infra and limit without model or artifacts', async () => {
  for (const reason of ['cancelled', 'timeout', 'infra', 'limit_exhausted', 'busy', 'success']) {
    const writes = []
    const run = {
      id: 7,
      run_attempt: 2,
      path: '.github/workflows/opencode.yml',
      head_branch: 'main',
      event: 'issue_comment',
      status: 'completed',
      conclusion: reason === 'cancelled' ? 'cancelled' : reason === 'infra' ? 'failure' : 'success',
      repository: { full_name: 'MeNn13/ai-for-developers-project-387' },
    }
    const steps = ['limit_exhausted', 'busy'].includes(reason)
      ? [{ name: `implementation-${reason}`, conclusion: 'success' }]
      : reason === 'success'
        ? [{ name: 'Publish checked repair with fixed App operations', conclusion: 'success' }]
        : []
    const api = async (method, path, data) => {
      if (method === 'POST') {
        writes.push(data.body)
        return {}
      }
      if (path.includes('/jobs?'))
        return {
          total_count: 1,
          jobs: [
            {
              name: 'implementation-context-pr-50',
              conclusion: reason === 'timeout' ? 'timed_out' : 'success',
              steps,
            },
          ],
        }
      if (path === '/pulls/50')
        return {
          user: { id: 123 },
          head: {
            ref: 'spec/38',
            repo: { full_name: run.repository.full_name },
            sha: 'a'.repeat(40),
          },
        }
      if (path.includes('/comments?')) return []
      throw new Error('No artifact or model access allowed')
    }
    assert.equal((await completion(run, api, 123)).reason, reason)
    assert.equal(writes.length, 1)
    assert.match(writes[0], /attempts\/2/)
    run.head_branch = 'untrusted'
    assert.equal(await completion(run, api, 123), null)
    assert.equal(writes.length, 1)
  }
})

test('model cannot hand-edit generated artifacts', () => {
  for (const path of [
    'frontend/src/api/generated/model.ts',
    'backend/BookingCalendar.Api/Generated/Model.cs',
    'contract/openapi/openapi.yaml',
  ])
    assert.throws(
      () => validateRepair({ ...reply, files: [{ ...reply.files[0], path }] }, { tickets: [41] }),
      /repair_input/,
    )
})

test('candidate materializes additions and deletions at the exact commit checked for publication', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'repair-candidate-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '--quiet')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.test')
  git('config', 'core.autocrlf', 'false')
  mkdirSync(join(dir, 'frontend/src'), { recursive: true })
  writeFileSync(join(dir, 'frontend/src/old.ts'), 'export const old = true\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'test: prepare fixture')
  const base = git('rev-parse', 'HEAD')
  const io = join(dir, 'io')
  mkdirSync(io)
  writeFileSync(
    join(io, 'context.json'),
    JSON.stringify({
      tickets: [41],
      expectedHead: base,
      trustedSha: base,
      commitDate: '2026-11-15T00:00:00Z',
    }),
  )
  writeFileSync(
    join(io, 'reply.json'),
    JSON.stringify({
      ...reply,
      files: [{ path: 'frontend/src/old.ts', mode: '100644', content: null }, ...reply.files],
    }),
  )
  const candidate = spawnSync(
    process.execPath,
    [join(import.meta.dirname, 'implementation-repair.mjs'), 'candidate'],
    { cwd: dir, env: { ...process.env, REPAIR_IO: io }, encoding: 'utf8' },
  )
  assert.equal(candidate.status, 0, candidate.stderr)
  const result = JSON.parse(readFileSync(join(io, 'result.json')))
  assert.equal(git('rev-parse', 'HEAD'), result.candidateSha)
  assert.equal(git('rev-parse', 'HEAD^'), base)
  assert.equal(existsSync(join(dir, 'frontend/src/old.ts')), false)
  assert.equal(readFileSync(join(dir, reply.files[0].path), 'utf8'), reply.files[0].content)
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '')
})
