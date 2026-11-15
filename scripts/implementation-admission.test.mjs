import assert from 'node:assert/strict'
import test from 'node:test'
import { admit } from './implementation-admission.mjs'

const repo = 'MeNn13/ai-for-developers-project-387'
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
test('both comment surfaces share three admissions; the fourth never calls execution', async () => {
  for (const surface of ['issue_comment', 'pull_request_review_comment']) {
    for (let count = 0; count <= 3; count++) {
      const f = fixture(
        Array.from({ length: count }, (_, i) => ({ id: i + 1 })),
        surface,
      )
      let executions = 0
      const result = await admit(surface, f.event, f.api, f.trust)
      if (result.allowed) executions++
      assert.equal(executions, count < 3 ? 1 : 0)
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
  const f = fixture([inline, { ...inline, id: 2 }, { id: 3 }], 'pull_request_review_comment')
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
  await assert.rejects(admit('pull_request_review_comment', f.event, forged, f.trust), /history/)
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
