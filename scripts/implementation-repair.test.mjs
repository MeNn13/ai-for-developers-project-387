import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { validateRepair, recoveryArtifact } from './implementation-repair.mjs'
import { completion } from './implementation-completion.mjs'

const reply = {
  version: 1,
  files: [{ path: 'frontend/src/booking.ts', mode: '100644', content: 'export const x = 1' }],
  message: 'fix(web): correct slot selection (#41)',
  risk: 'UI behavior',
  rollback: 'Revert commit',
}

test('full and publisher-only reruns replace run-scoped artifacts without wildcard downloads', () => {
  for (const workflow of ['opencode.yml', 'implementation-publish.yml']) {
    const source = readFileSync(
      new URL(`../.github/workflows/${workflow}`, import.meta.url),
      'utf8',
    )
    const steps = source.split(/\n      - /)
    const uploaded = new Set()
    for (const publisherOnly of [false, false, true]) {
      for (const step of steps.filter((s) => s.includes('uses: actions/upload-artifact@'))) {
        const name = step.match(/name: ([^\r\n]+)/)[1]
        if (publisherOnly && name !== 'implementation-publication') continue
        assert.match(step, /overwrite: true/, `rerun artifact ${name} would return 409`)
        uploaded.add(name)
      }
    }
    assert.ok(uploaded.has('implementation-publication'))
    for (const step of steps.filter((s) => s.includes('uses: actions/download-artifact@'))) {
      assert.match(step, /\n          (name|artifact-ids): /)
      assert.doesNotMatch(step, /pattern:/)
      if (step.includes('merge-multiple:'))
        assert.match(step, /artifact-ids: \$\{\{ steps.recovery.outputs.artifact \}\}/)
    }
  }
})

test('publisher recovery downloads only one exact checkpoint from the current run', async () => {
  const artifact = {
    id: 901,
    name: 'implementation-publication',
    expired: false,
    workflow_run: { id: 7 },
  }
  const api = async (path) => {
    assert.equal(path, '/actions/runs/7/artifacts?name=implementation-publication&per_page=100')
    return { total_count: 1, artifacts: [artifact] }
  }
  assert.equal(await recoveryArtifact(api, 7), 901)
  assert.equal(await recoveryArtifact(async () => ({ total_count: 0, artifacts: [] }), 7), null)
  for (const response of [
    { total_count: 2, artifacts: [artifact] },
    { total_count: 2, artifacts: [artifact, artifact] },
    { total_count: 1, artifacts: [{ ...artifact, expired: true }] },
    { total_count: 1, artifacts: [{ ...artifact, workflow_run: { id: 8 } }] },
    { total_count: 1, artifacts: [{ ...artifact, name: 'forged' }] },
  ])
    await assert.rejects(
      recoveryArtifact(async () => response, 7),
      /repair_input/,
    )
  const workflow = readFileSync(
    new URL('../.github/workflows/opencode.yml', import.meta.url),
    'utf8',
  )
  const publisher = workflow.slice(workflow.indexOf('\n  implementation-publish:'))
  assert.match(publisher, /run: node scripts\/implementation-repair.mjs recovery/)
  assert.match(publisher, /artifact-ids: \$\{\{ steps.recovery.outputs.artifact \}\}/)
  assert.match(publisher, /RECOVERY_ARTIFACT_ID: \$\{\{ steps.recovery.outputs.artifact \}\}/)
  assert.ok(publisher.indexOf('Locate current run') < publisher.indexOf('Mint repository-scoped'))
})
test('repair model has no write token and emits bounded file data with draft readiness', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'repair-model-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const cli = join(dir, 'fake.mjs')
  writeFileSync(join(dir, 'prompt.json'), '{}')
  writeFileSync(join(dir, 'context.json'), JSON.stringify({ tickets: [41] }))
  writeFileSync(
    cli,
    `import assert from 'node:assert/strict'
    assert.equal(process.env.GH_TOKEN, undefined)
    assert.equal(process.env.PUBLISH_APP_PRIVATE_KEY, undefined)
    const emit = (type, messageID, part) => console.log(JSON.stringify({
      type, timestamp: 1, sessionID: 'ses_repair',
      part: { sessionID: 'ses_repair', messageID, ...part },
    }))
    emit('step_start', 'msg_read', { type: 'step-start' })
    emit('text', 'msg_read', { type: 'text', text: 'I will read the instructions.' })
    emit('tool_use', 'msg_read', { type: 'tool', tool: 'read', state: { status: 'completed' } })
    emit('step_finish', 'msg_read', { type: 'step-finish', reason: 'tool-calls' })
    emit('step_start', 'msg_final', { type: 'step-start' })
    const json = JSON.stringify(${JSON.stringify(reply)})
    emit('text', 'msg_final', { type: 'text', text: json.slice(0, 10) })
    emit('text', 'msg_final', { type: 'text', text: json.slice(10) })
    emit('step_finish', 'msg_final', { type: 'step-finish', reason: 'stop' })
    `,
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
  const decoded = JSON.parse(readFileSync(join(dir, 'reply.json')))
  assert.equal(decoded.ready, false)
  assert.deepEqual(decoded.files, reply.files)
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
      head_sha: 'a'.repeat(40),
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
      if (path.startsWith('/git/commits/'))
        return { parents: [{ sha: 'b'.repeat(40) }, { sha: 'd'.repeat(40) }] }
      if (path.startsWith('/compare/')) return { status: 'ahead' }
      if (path.startsWith('/contents/')) return { sha: 'c'.repeat(40) }
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
    run.event = 'pull_request_review_comment'
    run.head_branch = 'spec/38'
    assert.equal((await completion(run, api, 123)).reason, reason)
    assert.equal(writes.length, 2)
    const forged = (method, path, data) =>
      path.startsWith('/contents/') && path.endsWith(run.head_sha)
        ? { sha: 'd'.repeat(40) }
        : api(method, path, data)
    assert.equal(await completion(run, forged, 123), null)
    assert.equal(writes.length, 2)
    assert.match(writes[0], /attempts\/2/)
    run.head_branch = 'untrusted'
    assert.equal(await completion(run, api, 123), null)
    assert.equal(writes.length, 2)
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

test('contract repair runs the trusted project generator and includes its output in the candidate', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'repair-generation-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '--quiet')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.test')
  git('config', 'core.autocrlf', 'false')
  mkdirSync(join(dir, 'contract'), { recursive: true })
  mkdirSync(join(dir, 'scripts'))
  writeFileSync(join(dir, 'contract/main.tsp'), 'original')
  writeFileSync(
    join(dir, 'scripts/generate.mjs'),
    `import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'; import assert from 'node:assert/strict'; assert.equal(readFileSync('contract/main.tsp','utf8'),'changed contract'); mkdirSync('frontend/src/api/generated',{recursive:true}); writeFileSync('frontend/src/api/generated/model.ts','export const generated = true\\n');`,
  )
  git('add', '.')
  git('commit', '--quiet', '-m', 'test: prepare generator fixture')
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
      files: [{ path: 'contract/main.tsp', mode: '100644', content: 'changed contract' }],
    }),
  )
  const candidate = spawnSync(
    process.execPath,
    [join(import.meta.dirname, 'implementation-repair.mjs'), 'candidate'],
    { cwd: dir, env: { ...process.env, REPAIR_IO: io }, encoding: 'utf8' },
  )
  assert.equal(candidate.status, 0, candidate.stderr)
  const result = JSON.parse(readFileSync(join(io, 'result.json')))
  assert.equal(
    result.files.find((f) => f.path === 'frontend/src/api/generated/model.ts').content,
    'export const generated = true\n',
  )
  assert.equal(
    git('show', 'HEAD:frontend/src/api/generated/model.ts'),
    'export const generated = true',
  )
  assert.equal(git('rev-parse', 'HEAD'), result.candidateSha)
})

test('separate candidate accepts upstream protected updates but rejects branch control changes before execution', (t) => {
  const control = mkdtempSync(join(tmpdir(), 'repair-control-'))
  const candidate = join(control, 'candidate')
  t.after(() => rmSync(control, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: control, encoding: 'utf8' }).trim()
  git('init', '--quiet')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.test')
  mkdirSync(join(control, 'scripts'))
  writeFileSync(
    join(control, 'scripts/implementation-repair.mjs'),
    'throw new Error("stale control executed")',
  )
  git('add', '.')
  git('commit', '--quiet', '-m', 'test: trusted baseline')
  const baseline = git('rev-parse', 'HEAD')
  writeFileSync(join(control, 'scripts/implementation-repair.mjs'), '// updated trusted control')
  git('add', '.')
  git('commit', '--quiet', '-m', 'test: upstream control update')
  const trustedSha = git('rev-parse', 'HEAD')
  git('worktree', 'add', '--quiet', '--detach', candidate, baseline)
  const io = join(control, 'io')
  mkdirSync(io)
  const context = {
    tickets: [41],
    expectedHead: baseline,
    trustedSha,
    commitDate: '2026-11-15T00:00:00Z',
  }
  writeFileSync(join(io, 'context.json'), JSON.stringify(context))
  writeFileSync(join(io, 'reply.json'), JSON.stringify(reply))
  const run = (command) =>
    spawnSync(process.execPath, [join(import.meta.dirname, 'implementation-repair.mjs'), command], {
      cwd: control,
      env: { ...process.env, REPAIR_IO: io, REPAIR_CANDIDATE_ROOT: candidate },
      encoding: 'utf8',
    })
  assert.equal(run('baseline').status, 0)
  const built = run('candidate')
  assert.equal(built.status, 0, built.stderr)
  assert.equal(git('rev-parse', 'HEAD'), trustedSha)
  assert.equal(readFileSync(join(candidate, reply.files[0].path), 'utf8'), reply.files[0].content)
  execFileSync('git', ['checkout', '--detach', baseline], { cwd: candidate, stdio: 'ignore' })
  writeFileSync(
    join(candidate, 'scripts/implementation-repair.mjs'),
    'throw new Error("branch control")',
  )
  execFileSync('git', ['add', '.'], { cwd: candidate })
  execFileSync('git', ['commit', '--quiet', '-m', 'test: branch control modification'], {
    cwd: candidate,
  })
  context.expectedHead = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: candidate,
    encoding: 'utf8',
  }).trim()
  writeFileSync(join(io, 'context.json'), JSON.stringify(context))
  assert.notEqual(run('baseline').status, 0)
})
