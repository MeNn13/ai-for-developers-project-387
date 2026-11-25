import assert from 'node:assert/strict'
import test from 'node:test'
import { initialContext, initialAdmission } from './implementation-initial.mjs'
import { prepare } from './opencode.mjs'
import {
  existsSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
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
    return [{ number: 3, state: 'open' }]
  if (/^\/issues\/\d+\/comments/.test(path)) return []
  if (number)
    return {
      number,
      id: number,
      title: `Issue ${number}`,
      body: 'Approved requirements',
      state: 'open',
    }
  throw new Error('unavailable')
}
test('initial worktrees use local objects and keep fetch credentials out of preparation', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/opencode-implement.yml', import.meta.url),
    'utf8',
  )
  const steps = workflow.split(/\n      - /)
  const preparations = steps.filter((step) =>
    step.startsWith('name: Prepare isolated candidate worktree'),
  )
  assert.equal(preparations.length, 1)
  for (const step of preparations) {
    assert.match(step, /git worktree add --detach/)
    assert.doesNotMatch(step, /git fetch|GH_TOKEN/)
  }
  assert.equal(steps.filter((step) => step.includes('implementation-graph.mjs')).length, 1)
  assert.equal(steps.filter((step) => step.includes('implementation-publish.mjs')).length, 1)
})

test('explicit current consent binds the native ticket graph and immutable snapshots', async () => {
  const result = await initialContext(event, api, trust)
  assert.equal(result.approval, 10)
  assert.equal(result.source, 1)
  assert.match(result.commitDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  assert.deepEqual(result.graph, [
    { number: 3, blockedBy: [] },
    { number: 4, blockedBy: [3] },
  ])
  assert.equal(result.phase, 'single')
  assert.deepEqual(result.order, [3, 4])
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
          ? [{ number: 4, state: 'open' }]
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

test('REST open issues accept closed external blockers and reject open or unknown external states', async () => {
  const context = await initialContext(
    event,
    (path) =>
      path === '/issues/3/dependencies/blocked_by?per_page=100'
        ? [{ number: 9, state: 'closed' }]
        : api(path),
    trust,
  )
  assert.deepEqual(context.graph[0], { number: 3, blockedBy: [] })
  for (const state of ['open', 'CLOSED', undefined]) {
    await assert.rejects(
      initialContext(
        event,
        (path) =>
          path === '/issues/3/dependencies/blocked_by?per_page=100'
            ? [{ number: 9, state }]
            : api(path),
        trust,
      ),
      /initial_blockers/,
    )
  }
  await assert.rejects(
    initialContext(
      event,
      (path) => (path === '/issues/2' ? { ...api(path), state: 'closed' } : api(path)),
      trust,
    ),
    /initial_context/,
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

test('one CLI call edits both dependent tickets and exact-SHA verification gates the result', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'initial-single-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const root = join(directory, 'repo')
  mkdirSync(join(root, 'frontend', 'src'), { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.com')
  writeFileSync(join(root, 'README.md'), 'fixture\n')
  writeFileSync(join(root, 'frontend', 'src', 'old.ts'), 'export {}\n')
  git('add', '.')
  git('commit', '-qm', 'chore: initialize fixture')
  const base = git('rev-parse', 'HEAD')
  const context = await initialContext(event, api, { ...trust, trustedSha: base })
  const adapter = join(directory, 'adapter.mjs')
  writeFileSync(
    adapter,
    `
import assert from 'node:assert/strict'
import cp from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
import {appendFileSync, existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
const spawn = cp.spawnSync
cp.spawnSync = (bin, args, opts) => {
  if (bin === '/usr/bin/bwrap' || args.includes('/usr/bin/bwrap')) {
    assert.equal(opts.env.GH_TOKEN, undefined)
    assert.equal(opts.env.PUBLISH_APP_PRIVATE_KEY, undefined)
    assert.equal(opts.env.OPENCODE_API_KEY, 'fixture-key')
    assert.ok(!args.includes(process.env.INITIAL_IO))
    const workspace = args[args.indexOf('--bind') + 1]
    assert.equal(existsSync(join(workspace, '.git')), false)
    const context = JSON.parse(opts.input.split('UNTRUSTED APPROVED CONTEXT:\\n')[1])
    assert.deepEqual(context.order,[3,4])
    appendFileSync(join(process.env.INITIAL_IO,'calls'), 'run\\n')
    const scenario = process.env.SCENARIO
    if (scenario === 'provider') return {
      status: 0,
      stdout: JSON.stringify({type:'error',error:{type:'api',status:429,message:'SECRET_MARKER'}}),
    }
    if (scenario === 'empty') return finished()
    if (scenario === 'protected') writeFileSync(join(workspace, 'REVIEW.md'),'SECRET_MARKER')
    if (scenario === 'binary') writeFileSync(join(workspace, 'frontend/src/binary.ts'),Buffer.from([0,255]))
    if (scenario === 'symlink') {
      renameSync(join(workspace, 'frontend/src'), join(workspace, 'frontend/hidden'))
      symlinkSync(process.env.INITIAL_IO, join(workspace, 'frontend/src'), process.platform === 'win32' ? 'junction' : 'dir')
      return finished()
    }
    if (scenario === 'generated') {
      const path = join(workspace,'frontend/src/api/generated')
      mkdirSync(path, {recursive:true})
      writeFileSync(join(path,'test.ts'),'export {}\\n')
    }
    if (scenario === 'generation') {
      mkdirSync(join(workspace,'contract'))
      writeFileSync(join(workspace,'contract/main.tsp'),'broken')
    }
    writeFileSync(join(workspace,'frontend/src/first.ts'), 'export const first = true\\n')
    writeFileSync(join(workspace,'frontend/src/second.ts'), 'import { first } from "./first"\\n')
    rmSync(join(workspace,'frontend/src/old.ts'))
    return finished()
  }
  if (args.some(a => a.endsWith('implementation-sandbox.mjs'))) {
    assert.equal(opts.env.OPENCODE_API_KEY, undefined)
    assert.equal(opts.env.GH_TOKEN, undefined)
    const head = spawn('git',['rev-parse','HEAD'],opts).stdout.trim()
    writeFileSync(join(process.env.INITIAL_IO,'checked'), head)
    return process.env.SCENARIO === 'check'
      ? {status: 1, stdout: 'task_failed task=lint\\n', stderr: 'SECRET_MARKER'}
      : {status: 0}
  }
  return spawn(bin,args,opts)
}
function finished() {
  const sessionID = 'single'
  const output = (type, fields) => JSON.stringify({type, sessionID, part:{sessionID,messageID:'final',...fields}})
  return {status:0,stdout:[output('text',{text:'## Both tickets complete'}),output('step_finish',{reason:'stop'})].join('\\n')}
}
syncBuiltinESMExports()
`,
  )
  for (const [scenario, category] of [
    ['provider', 'provider_error'],
    ['empty', 'empty_diff'],
    ['protected', 'file_rules'],
    ['binary', 'file_rules'],
    ['symlink', 'file_rules'],
    ['generated', 'file_rules'],
    ['timeout', 'timeout'],
    ['check', 'check_failed'],
    ['valid', null],
    ['generation', 'generation_failed'],
  ]) {
    git('checkout', '-q', '--detach', base)
    const io = join(directory, scenario)
    mkdirSync(io)
    const path = (file) => join(io, file)
    const json = (name) => JSON.parse(readFileSync(path(name + '.json'), 'utf8'))
    writeFileSync(
      path('context.json'),
      JSON.stringify({
        ...context,
        deadline: scenario === 'timeout' ? 0 : Date.now() + 120000,
      }),
    )
    const child = spawnSync(
      process.execPath,
      [join(import.meta.dirname, 'implementation-graph.mjs')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          INITIAL_IO: io,
          INITIAL_CANDIDATE_ROOT: root,
          OPENCODE_BIN: 'fixture',
          OPENCODE_API_KEY: 'fixture-key',
          GH_TOKEN: 'SECRET_MARKER',
          PUBLISH_APP_PRIVATE_KEY: 'SECRET_MARKER',
          SCENARIO: scenario,
          GITHUB_STEP_SUMMARY: path('summary'),
          NODE_OPTIONS: '--import ' + pathToFileURL(adapter).href,
        },
      },
    )
    if (scenario !== 'timeout') assert.equal(readFileSync(path('calls'), 'utf8'), 'run\n')
    assert.equal(child.status, category ? 1 : 0, child.stderr)
    if (category) {
      assert.equal(json('diagnostic').category, category, child.stderr)
      if (scenario === 'check') assert.equal(json('diagnostic').task, 'lint')
      assert.match(readFileSync(path('summary'), 'utf8'), new RegExp(category))
      assert.doesNotMatch(child.stdout + child.stderr, /SECRET_MARKER/)
      assert.equal(existsSync(path('result.json')), false)
      assert.equal(existsSync(path('verification.json')), false)
    } else {
      const result = json('result')
      assert.equal(result.ready, true)
      assert.deepEqual(
        result.files.map(({ path }) => path),
        ['frontend/src/first.ts', 'frontend/src/old.ts', 'frontend/src/second.ts'],
      )
      assert.equal(result.files[1].content, null)
      assert.equal(result.candidateSha, git('rev-parse', 'HEAD'))
      assert.equal(git('rev-parse', 'HEAD^'), base)
      assert.equal(json('verification').sha, readFileSync(path('checked'), 'utf8'))
      assert.equal(json('verification').sha, result.candidateSha)
    }
  }
})
