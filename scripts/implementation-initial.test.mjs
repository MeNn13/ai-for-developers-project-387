import assert from 'node:assert/strict'
import test from 'node:test'
import { initialContext, initialAdmission } from './implementation-initial.mjs'
import { prepare } from './opencode.mjs'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { initialCompletion } from './implementation-initial-completion.mjs'

const repo = 'MeNn13/ai-for-developers-project-387'
const human = { login: 'MeNn13', type: 'User' }
const event = {
  action: 'created',
  repository: { full_name: repo },
  issue: { number: 1 },
  comment: {
    id: 10,
    body: '/oc implement-spec spec=#2 tickets=#3,#4 approve',
    user: human,
    author_association: 'OWNER',
    issue_url: `https://api.github.com/repos/${repo}/issues/1`,
  },
}
const trust = { runId: 7, trustedSha: 'a'.repeat(40) }
function api(path) {
  const number = Number(path.match(/^\/issues\/(\d+)/)?.[1])
  if (path === '/issues/comments/10') return structuredClone(event.comment)
  if (path === '/issues/2/sub_issues?per_page=100') return [{ number: 3 }, { number: 4 }]
  if (path === '/issues/3/dependencies/blocked_by?per_page=100') return []
  if (path === '/issues/4/dependencies/blocked_by?per_page=100')
    return [{ number: 3, state: 'OPEN' }]
  if (/^\/issues\/\d+\/comments/.test(path)) return []
  if (number)
    return {
      number,
      id: number,
      title: `Issue ${number}`,
      body: 'Approved requirements',
      state: 'OPEN',
    }
  throw new Error('unavailable')
}
test('explicit current consent binds the native ticket graph and immutable snapshots', async () => {
  const result = await initialContext(event, api, trust)
  assert.equal(result.approval, 10)
  assert.equal(result.source, 1)
  assert.deepEqual(result.graph, [
    { number: 3, blockedBy: [] },
    { number: 4, blockedBy: [3] },
  ])
  assert.deepEqual(
    result.snapshots.map((s) => s.number),
    [1, 2, 3, 4],
  )
})

test('missing consent, unavailable requirements and cyclic or incomplete native graphs stop before execution', async () => {
  await assert.rejects(
    initialContext(
      { ...event, comment: { ...event.comment, body: '/oc implement-spec spec=#2 tickets=#3,#4' } },
      api,
      trust,
    ),
    /initial_command/,
  )
  await assert.rejects(
    initialContext(
      event,
      (path) => (path === '/issues/2' ? Promise.reject(new Error('unavailable')) : api(path)),
      trust,
    ),
    /unavailable/,
  )
  await assert.rejects(
    initialContext(
      event,
      (path) =>
        path === '/issues/3/dependencies/blocked_by?per_page=100'
          ? [{ number: 4, state: 'OPEN' }]
          : api(path),
      trust,
    ),
    /initial_cycle/,
  )
  await assert.rejects(
    initialContext(
      event,
      (path) => (path.includes('/sub_issues') ? [{ number: 3 }] : api(path)),
      trust,
    ),
    /initial_ticket_graph/,
  )
  const old = {
    ...event,
    comment: {
      ...event.comment,
      body: '/oc implement-spec spec=#2 tickets=#3,#4 approval=https://github.com/MeNn13/ai-for-developers-project-387/issues/1#issuecomment-10',
    },
  }
  assert.equal((await initialContext(old, api, trust)).approval, 10)
  await assert.rejects(
    initialContext(
      old,
      (path) =>
        path === '/issues/comments/10'
          ? { ...api(path), body: 'approve ticket publication' }
          : api(path),
      trust,
    ),
    /initial_approval/,
  )
})

test('queued request arriving during initial execution is refused without PR budget admission', async () => {
  const queued = { ...event, comment: { ...event.comment, created_at: '2026-11-15T00:01:00Z' } }
  const history = async (path) =>
    path.includes('/jobs?')
      ? { total_count: 1, jobs: [{ name: 'initial-source-1' }] }
      : {
          total_count: 1,
          workflow_runs: [
            {
              id: 8,
              repository: { full_name: repo },
              head_branch: 'main',
              status: 'completed',
              updated_at: '2026-11-15T00:02:00Z',
            },
          ],
        }
  await assert.rejects(initialAdmission(queued, history, 7), /initial_busy/)
  await initialAdmission(queued, async () => ({ total_count: 0, workflow_runs: [] }), 7)
})

test('initial implementation leaves discussion and repair routing intact', async () => {
  assert.equal(
    await prepare('issue_comment', event, () => {
      throw new Error('must not load discussion')
    }),
    null,
  )
  assert.equal(
    await prepare(
      'issue_comment',
      {
        ...event,
        issue: { number: 1, pull_request: {} },
        comment: { ...event.comment, body: '/oc fix 8 repair' },
      },
      () => {
        throw new Error('must not load discussion')
      },
    ),
    null,
  )
  const discussion = await prepare(
    'issue_comment',
    { ...event, comment: { ...event.comment, body: '/oc explain' } },
    api,
  )
  assert.equal(discussion.number, 1)
})

test('independent initial completion reports cancellation and timeout without artifacts or model', async () => {
  for (const reason of ['cancelled', 'timeout']) {
    const writes = []
    const run = {
      id: 7,
      run_attempt: 1,
      path: '.github/workflows/opencode-implement.yml',
      head_branch: 'main',
      head_sha: trust.trustedSha,
      repository: { full_name: repo },
      status: 'completed',
      event: 'workflow_dispatch',
      conclusion: reason === 'cancelled' ? reason : 'failure',
    }
    const github = async (method, path, data) => {
      if (method === 'POST') {
        writes.push(data.body)
        return {}
      }
      if (path.includes('/jobs?'))
        return {
          total_count: 2,
          jobs: [
            { name: 'initial-source-1', conclusion: 'success' },
            {
              name: 'implementation-check',
              conclusion: reason === 'timeout' ? 'timed_out' : 'cancelled',
            },
          ],
        }
      if (path.startsWith('/issues/1/comments')) return []
      throw new Error('must not access artifacts or model')
    }
    assert.equal((await initialCompletion(run, github, 123, trust.trustedSha)).reason, reason)
    assert.match(writes[0], new RegExp(reason))
  }
})

test('expired initial deadline reports timeout before any model or candidate command', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'initial-timeout-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(join(directory, 'context.json'), JSON.stringify({ phase: 'first', deadline: 0 }))
  const output = join(directory, 'output')
  writeFileSync(output, '')
  const child = spawnSync(
    process.execPath,
    [join(import.meta.dirname, 'implementation-graph.mjs'), 'first'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        INITIAL_IO: directory,
        INITIAL_CANDIDATE_ROOT: directory,
        GITHUB_OUTPUT: output,
        GITHUB_RUN_ATTEMPT: '1',
        OPENCODE_BIN: 'must-never-be-invoked',
      },
    },
  )
  assert.equal(child.status, 1)
  assert.match(child.stderr, /initial_timeout/)
  assert.equal(readFileSync(output, 'utf8'), 'reason=timeout\n')
})

test('CLI integrates real Git ticket commits in dependency order and emits draft then checked ready data', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'initial-graph-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const candidate = join(dir, 'candidate'),
    io = join(dir, 'io')
  mkdirSync(candidate)
  mkdirSync(io)
  const git = (...args) => execFileSync('git', args, { cwd: candidate, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.com')
  writeFileSync(join(candidate, 'README.md'), 'fixture')
  git('add', '.')
  git('commit', '-qm', 'chore: initialize fixture')
  const base = git('rev-parse', 'HEAD')
  const context = {
    version: 1,
    runId: 7,
    trustedSha: base,
    base,
    expectedHead: base,
    tickets: [3, 4],
    graph: [
      { number: 3, blockedBy: [] },
      { number: 4, blockedBy: [3] },
    ],
    deadline: Date.now() + 60000,
    commitDate: '2026-11-15T00:00:00Z',
  }
  const fake = join(dir, 'model.mjs')
  writeFileSync(
    fake,
    `import assert from 'node:assert/strict'; let input=''; for await (const c of process.stdin) input+=c; assert.equal(process.env.GH_TOKEN, undefined); assert.equal(process.env.PUBLISH_APP_PRIVATE_KEY,undefined); const context=JSON.parse(input.split('UNTRUSTED APPROVED CONTEXT:\\n')[1]); const n=context.activeTicket?.number; const reply=n?{version:1,message:'feat: implement ticket (#'+n+')',files:[{path:'frontend/src/ticket'+n+'.ts',mode:'100644',content:'export const ticket'+n+' = true\\n'}],risk:'UI consequences',rollback:'Revert; no persistent data'}:{findings:[],risk:'Entire UI change',rollback:'Revert; no persistent data',repair:null}; console.log(JSON.stringify({type:'text',part:{text:JSON.stringify(reply)}}));console.log(JSON.stringify({type:'step_finish',part:{reason:'stop'}}));`,
  )
  const preload = join(dir, 'adapter.mjs')
  // Only the external model and Linux check adapter are fake; Git and candidate construction run.
  writeFileSync(
    preload,
    `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const spawn=cp.spawnSync;cp.spawnSync=(bin,args,opts)=>args?.some(a=>a.endsWith?.('implementation-sandbox.mjs'))?{status:0}:(bin==='opencode'||(bin==='timeout'&&args.includes('opencode')))?spawn(process.execPath,[${JSON.stringify(fake)}],opts):spawn(bin,args,opts);syncBuiltinESMExports();`,
  )
  const execute = (phase) => {
    context.phase = phase === 'first' ? 'first' : 'final'
    writeFileSync(join(io, 'context.json'), JSON.stringify(context))
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dirname, 'implementation-graph.mjs'), phase],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: '--import ' + pathToFileURL(preload).href,
          INITIAL_IO: io,
          INITIAL_CANDIDATE_ROOT: candidate,
          OPENCODE_API_KEY: 'fake',
          GH_TOKEN: 'do-not-pass',
          PUBLISH_APP_PRIVATE_KEY: 'do-not-pass',
        },
      },
    )
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(readFileSync(join(io, 'result.json')))
  }
  const first = execute('first')
  assert.equal(first.ready, false)
  assert.equal(git('rev-parse', first.candidateSha + '^'), base)
  context.expectedHead = first.candidateSha
  const final = execute('final')
  assert.equal(final.ready, true)
  assert.equal(git('rev-parse', final.candidateSha + '^'), first.candidateSha)
  assert.deepEqual(
    JSON.parse(readFileSync(join(io, 'integrations.json'))).map((r) => r.ticket),
    [3, 4],
  )
  assert.equal(
    git('show', final.candidateSha + ':frontend/src/ticket4.ts'),
    'export const ticket4 = true',
  )
  assert.equal(JSON.parse(readFileSync(join(io, 'verification.json'))).sha, final.candidateSha)
  assert.equal(git('status', '--porcelain'), '')
})
