import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { admit } from './implementation-admission.mjs'

const repo = 'MeNn13/ai-for-developers-project-387'
const repair = fileURLToPath(new URL('./implementation-repair.mjs', import.meta.url))
function fixture(prior = [], surface = 'issue_comment') {
  const event = {
    action: 'created',
    repository: { full_name: repo },
    issue: { number: 50, pull_request: {} },
    comment: {
      id: 99,
      body: '/oc fix repair the slot',
      created_at: '2026-11-15T03:00:00Z',
      user: { login: 'MeNn13', type: 'User' },
      author_association: 'OWNER',
    },
  }
  if (surface === 'pull_request_review_comment') {
    delete event.issue
    event.pull_request = { number: 50 }
  }
  const run = (id, attempt = 1) => ({
    id,
    run_attempt: attempt,
    path: '.github/workflows/opencode.yml',
    event: surface,
    head_branch: surface === 'issue_comment' ? 'main' : 'spec/38',
    head_sha: (surface === 'issue_comment' ? 'a' : 'b').repeat(40),
    repository: { full_name: repo },
    status: 'completed',
    created_at: '2026-11-15T01:00:00Z',
    updated_at: '2026-11-15T02:00:00Z',
  })
  const calls = []
  const trust = { runId: 100, attempt: 1, appId: 123, trustedSha: 'a'.repeat(40) }
  const api = async (path) => {
    calls.push(path)
    if (path.startsWith('/git/commits/'))
      return { parents: [{ sha: 'a'.repeat(40) }, { sha: 'd'.repeat(40) }] }
    if (path.startsWith('/compare/')) return { status: 'ahead' }
    if (path.startsWith('/contents/')) return { sha: 'c'.repeat(40) }
    if (path === '/pulls/50')
      return {
        number: 50,
        user: { id: 123 },
        head: { repo: { full_name: repo }, ref: 'spec/38', sha: 'b'.repeat(40) },
        base: { ref: 'main' },
      }
    if (path === '/actions/runs/100') return run(100, trust.attempt)
    if (path.startsWith('/actions/runs?'))
      return {
        total_count: prior.length,
        workflow_runs: prior.map((r) => ({ ...run(r.id), ...r })),
      }
    const match = path.match(/runs\/(\d+)\/attempts\/(\d+)\/jobs/)
    if (match)
      return {
        total_count: 1,
        jobs: [
          {
            name: 'implementation-admission-pr-50',
            steps: [{ name: 'implementation-admitted', conclusion: 'success' }],
          },
        ],
      }
    throw new Error(path)
  }
  return { api, event, calls, trust }
}

test('gate reports safe pre-admission failures without emitting permission to run', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'repair-gate-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const eventPath = join(dir, 'event.json')
  const output = join(dir, 'output')
  const summary = join(dir, 'summary')
  const preload = join(dir, 'fetch.mjs')
  const f = fixture()
  const current = await f.api('/actions/runs/100')
  const payload = 'private comment and API details'
  f.event.comment.body = `/oc fix 123 ${payload}`
  writeFileSync(eventPath, JSON.stringify(f.event))

  for (const [category, run, history] of [
    ['untrusted_origin', { ...current, head_branch: payload }, null],
    ['invalid_history', current, { total_count: 2, workflow_runs: [] }],
  ]) {
    const responses = {
      '/pulls/50': await f.api('/pulls/50'),
      '/actions/runs/100': run,
      '/actions/runs?per_page=100&page=1': history,
    }
    writeFileSync(
      preload,
      `globalThis.fetch = async (url) => {
        const path = url.split(${JSON.stringify(repo)})[1]
        return Response.json(${JSON.stringify(responses)}[path])
      }`,
    )
    writeFileSync(output, '')
    writeFileSync(summary, '')
    const result = spawnSync(
      process.execPath,
      ['--import', pathToFileURL(preload).href, repair, 'gate'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          REPAIR_IO: dir,
          GITHUB_ACTIONS: 'true',
          GITHUB_EVENT_NAME: 'issue_comment',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: summary,
          GITHUB_RUN_ID: '100',
          GITHUB_RUN_ATTEMPT: '1',
          GITHUB_SHA: current.head_sha,
          TRUSTED_SHA: f.trust.trustedSha,
          PUBLISH_APP_BOT_ID: '123',
        },
      },
    )
    const diagnostic = `repair_failed phase=gate operation=admit category=${category} attempt=1 sha=${current.head_sha}`
    assert.equal(result.status, 1, result.error?.message ?? result.stderr)
    assert.equal(result.stderr, `::error::${diagnostic}\n`)
    assert.equal(result.stdout, '')
    assert.equal(readFileSync(summary, 'utf8'), `${diagnostic}\n`)
    assert.equal(readFileSync(output, 'utf8'), '')
  }
})
test('each comment surface admits the first three attempts and denies the fourth', async () => {
  for (const surface of ['issue_comment', 'pull_request_review_comment']) {
    for (let count = 0; count <= 3; count++) {
      const f = fixture(
        Array.from({ length: count }, (_, i) => ({ id: i + 1 })),
        surface,
      )
      const result = await admit(surface, f.event, f.api, f.trust)
      assert.equal(result.allowed, count < 3)
      assert.equal(result.reason, count < 3 ? 'admitted' : 'limit_exhausted')
    }
  }
})

test('inline merge-ref runs are trusted by workflow identity, including shared historical budget', async () => {
  const inline = {
    id: 1,
    event: 'pull_request_review_comment',
    head_branch: 'spec/38',
    head_sha: 'b'.repeat(40),
  }
  const ordinary = { id: 3, event: 'issue_comment', head_branch: 'main', head_sha: 'a'.repeat(40) }
  const f = fixture([inline, { ...inline, id: 2 }, ordinary], 'pull_request_review_comment')
  const original = f.api
  const api = async (path) =>
    path === '/actions/runs/100'
      ? { ...(await original(path)), ...inline, id: 100 }
      : original(path)
  assert.equal(
    (await admit('pull_request_review_comment', f.event, api, f.trust)).reason,
    'limit_exhausted',
  )
  const forged = async (path) =>
    path.startsWith('/contents/') && path.endsWith('b'.repeat(40))
      ? { sha: 'd'.repeat(40) }
      : api(path)
  await assert.rejects(
    admit('pull_request_review_comment', f.event, forged, f.trust),
    /untrusted_origin/,
  )
})

test('inline PR head runs share the budget only with a trusted workflow and PR association', async () => {
  const surface = 'pull_request_review_comment'
  const head = 'b'.repeat(40)
  const base = 'e'.repeat(40)
  const repoUrl = `https://api.github.com/repos/${repo}`
  const association = {
    number: 50,
    head: { sha: head, ref: 'spec/38', repo: { url: repoUrl } },
    base: { sha: base, ref: 'main', repo: { url: repoUrl } },
  }
  const prior = { id: 1, event: 'issue_comment', head_branch: 'main', head_sha: base }
  const failed = { id: 4, pull_requests: [association], conclusion: 'failure' }
  const f = fixture([prior, { ...prior, id: 2 }, failed], surface)
  const api = async (path) => {
    if (path === `/git/commits/${head}`) return { parents: [{ sha: 'd'.repeat(40) }] }
    if (path === '/actions/runs/100')
      return { ...(await f.api(path)), pull_requests: [association] }
    if (path.includes('/runs/4/attempts/'))
      return {
        total_count: 1,
        jobs: [
          {
            name: 'implementation-context-pr-50',
            status: 'completed',
            steps: [
              {
                name: 'Fresh admission for this job and run attempt',
                conclusion: 'failure',
                number: 3,
              },
              { name: 'implementation-admitted', conclusion: 'skipped', number: 6 },
            ],
          },
        ],
      }
    return f.api(path)
  }
  assert.equal((await admit(surface, f.event, api, f.trust)).reason, 'admitted')

  const afterThird = async (path) => {
    if (!path.startsWith('/actions/runs?')) return api(path)
    const history = await f.api(path)
    const third = { ...(await api('/actions/runs/100')), id: 3 }
    return { total_count: 4, workflow_runs: [...history.workflow_runs, third] }
  }
  const fourth = await admit(surface, f.event, afterThird, f.trust)
  assert.equal(fourth.reason, 'limit_exhausted')
  assert.equal(fourth.allowed, false)

  for (const [path, response] of [
    ['/actions/runs/100', { ...(await api('/actions/runs/100')), pull_requests: [] }],
    [`/compare/${base}...${head}`, { status: 'diverged' }],
    [`/compare/${base}...${f.trust.trustedSha}`, { status: 'behind' }],
    [`/contents/.github/workflows/opencode.yml?ref=${head}`, { sha: 'f'.repeat(40) }],
  ]) {
    const invalid = (request) => (request === path ? response : api(request))
    await assert.rejects(admit(surface, f.event, invalid, f.trust), /untrusted_origin/)
  }
})
test('partial rerun counts old attempts, while multiple stages of current attempt cost once', async () => {
  const f = fixture([{ id: 100, run_attempt: 3 }])
  f.trust.attempt = 3
  assert.equal((await admit('issue_comment', f.event, f.api, f.trust)).allowed, true)
  f.trust.attempt = 4
  const original = f.api
  f.api = async (p) =>
    p.includes('/attempts/4/')
      ? { total_count: 0, jobs: [] }
      : p === '/actions/runs/100'
        ? { ...(await original(p)), run_attempt: 4 }
        : p.startsWith('/actions/runs?')
          ? {
              total_count: 1,
              workflow_runs: [{ ...(await original('/actions/runs/100')), run_attempt: 4 }],
            }
          : original(p)
  assert.equal((await admit('issue_comment', f.event, f.api, f.trust)).reason, 'limit_exhausted')
})
test('busy at comment arrival remains busy after work finishes; untrusted and ordinary comments spend nothing', async () => {
  const f = fixture([{ id: 1, updated_at: '2026-11-15T04:00:00Z' }])
  assert.equal((await admit('issue_comment', f.event, f.api, f.trust)).reason, 'busy')
  for (const body of ['/oc explain this', 'fix this']) {
    f.event.comment.body = body
    assert.equal((await admit('issue_comment', f.event, f.api, f.trust)).reason, 'ignored')
  }
  f.event.comment.body = '/oc fix this'
  f.event.comment.user.login = 'stranger'
  assert.equal((await admit('issue_comment', f.event, f.api, f.trust)).reason, 'ignored')
})
test('missing history and forged workflow metadata fail closed', async () => {
  for (const change of [
    { total_count: 2, workflow_runs: [] },
    {
      total_count: 1,
      workflow_runs: [{ id: 1, path: '.github/workflows/opencode.yml', head_branch: 'evil' }],
    },
  ]) {
    const f = fixture()
    const original = f.api
    f.api = (p) => (p.startsWith('/actions/runs?') ? change : original(p))
    await assert.rejects(admit('issue_comment', f.event, f.api, f.trust), /history/)
  }
})

test('a completed repair job with incomplete step history cannot free an admission', async () => {
  const f = fixture([{ id: 1 }, { id: 2 }, { id: 3 }])
  for (const steps of [undefined, [{ name: 'implementation-admitted' }]]) {
    const api = (path) =>
      path.includes('/runs/3/attempts/')
        ? {
            total_count: 1,
            jobs: [{ name: 'implementation-context-pr-50', status: 'completed', steps }],
          }
        : f.api(path)
    await assert.rejects(admit('issue_comment', f.event, api, f.trust), /invalid_history/)
  }
})

test('ordinary inline discussion and other PR admissions cannot poison repair history', async () => {
  const f = fixture([{ id: 1, event: 'pull_request_review_comment', head_branch: 'feat/human' }])
  const original = f.api
  for (const jobs of [
    [],
    [
      {
        name: 'implementation-context-pr-99',
        steps: [{ name: 'implementation-admitted', conclusion: 'success' }],
      },
    ],
  ]) {
    const api = (path) =>
      path.includes('/runs/1/attempts/') ? { total_count: jobs.length, jobs } : original(path)
    assert.equal((await admit('issue_comment', f.event, api, f.trust)).reason, 'admitted')
  }
  // A relevant forged marker must still be rejected after filtering unrelated jobs.
  await assert.rejects(admit('issue_comment', f.event, f.api, f.trust), /untrusted_origin/)
})
