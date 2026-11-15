import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { publishImplementation } from './implementation-publish.mjs'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const sha = 'a'.repeat(40)
const next = 'b'.repeat(40)
const context = {
  version: 1,
  runId: 7,
  commitDate: '2026-11-15T00:00:00Z',
  trustedSha: sha,
  base: sha,
  expectedHead: sha,
  source: 12,
  spec: 38,
  tickets: [40],
  approval: 99,
  approvalBody: 'Согласовано #38 #40',
  snapshots: [
    { number: 12, body: 'request' },
    { number: 38, body: 'spec' },
    { number: 40, body: 'ticket' },
  ],
}
const result = {
  version: 1,
  candidateSha: next,
  contextDigest: createHash('sha256').update(JSON.stringify(context)).digest('hex'),
  ready: false,
  message: 'feat(web): add booking confirmation (#40)',
  files: [
    {
      path: 'frontend/src/confirmation.ts',
      mode: '100644',
      content: 'export const confirmed = true\n',
    },
  ],
  risk: 'Изменяется подтверждение записи.',
  rollback: 'Отменить коммит.',
}

function trust() {
  return {
    trustedSha: sha,
    runId: 7,
    appId: 123,
    verification: {
      version: 1,
      runId: 7,
      resultDigest: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
      command: 'mise run check',
      conclusion: 'success',
      ready: false,
      sha: next,
    },
  }
}

function fixture() {
  const calls = []
  let head = null
  let pr = null
  const api = async (method, path, data) => {
    calls.push({ method, path, data })
    if (/^\/issues\/\d+$/.test(path))
      return { body: context.snapshots.find((s) => path === `/issues/${s.number}`).body }
    if (path === '/actions/runs/7')
      return {
        id: 7,
        path: '.github/workflows/opencode-implement.yml',
        head_sha: sha,
        head_branch: 'main',
        repository: { full_name: 'MeNn13/ai-for-developers-project-387' },
        conclusion: 'success',
        run_attempt: 1,
      }
    if (path === '/actions/runs/7/jobs?per_page=100')
      return {
        total_count: 2,
        jobs: [
          { name: 'implementation-context', conclusion: 'success' },
          { name: 'implementation-check', conclusion: 'success' },
        ],
      }
    if (path === '/issues/comments/99')
      return {
        user: { login: 'MeNn13', type: 'User' },
        author_association: 'OWNER',
        body: 'Согласовано #38 #40',
        issue_url: 'https://api.github.com/repos/MeNn13/ai-for-developers-project-387/issues/12',
      }
    if (path.startsWith('/git/ref/heads/')) return head ? { object: { sha: head } } : null
    if (path.startsWith('/pulls?')) return pr ? [pr] : []
    if (path === `/git/commits/${sha}`) return { tree: { sha } }
    if (path === '/git/trees') return { sha }
    if (path === '/git/commits') return { sha: next }
    if (path === '/git/refs') {
      head = data.sha
      return {}
    }
    if (path.startsWith('/git/refs/heads/')) {
      head = data.sha
      return {}
    }
    if (path === '/pulls' && method === 'POST') {
      pr = {
        ...data,
        number: 50,
        node_id: 'PR_50',
        draft: true,
        user: { id: 123 },
        head: { ref: 'spec/38', sha: head },
        base: { ref: 'main' },
      }
      return pr
    }
    if (path === '/pulls/50') {
      if (method === 'PATCH') Object.assign(pr, data)
      return pr
    }
    if (path.startsWith('/commits/'))
      return { commit: { message: result.message }, parents: [{ sha }], author: { id: 123 } }
    throw new Error(`Unexpected ${method} ${path}`)
  }
  return {
    api,
    calls,
    setHead(value) {
      head = value
    },
  }
}

test('prepared implementation creates an App draft PR without executing result code', async () => {
  const f = fixture()
  const receipt = await publishImplementation(result, context, f.api, trust())
  assert.equal(receipt.head, next)
  assert.equal(receipt.pr, 50)
  assert.equal(f.calls.find((c) => c.path === '/git/refs').data.ref, 'refs/heads/spec/38')
  assert.match(
    f.calls.find((c) => c.path === '/pulls' && c.method === 'POST').data.body,
    /Closes #40/,
  )
})

test('rejects protected files, deletion, rename targets, symlinks and path bypass before writes', async () => {
  for (const path of [
    '.github/workflows/ci.yml',
    'AGENTS.md',
    'scripts/agent-ready.mjs',
    'frontend/src/../evil.ts',
    'frontend/src/a\\b.ts',
    'frontend/src/config.ts',
    'frontend/src/%2e%2e/a.ts',
    'frontend/src/Review.tsx',
  ]) {
    for (const content of ['code', null]) {
      const f = fixture()
      await assert.rejects(
        publishImplementation(
          { ...result, files: [{ path, mode: '100644', content }] },
          context,
          f.api,
          trust(),
        ),
        /protected_path/,
      )
      assert.equal(
        f.calls.some((c) => c.method !== 'GET'),
        false,
      )
    }
  }
  const f = fixture()
  await assert.rejects(
    publishImplementation(
      { ...result, files: [{ ...result.files[0], mode: '120000' }] },
      context,
      f.api,
      trust(),
    ),
    /protected_path/,
  )
})

test('existing branch name alone never grants ownership', async () => {
  const f = fixture()
  f.setHead(sha)
  await assert.rejects(publishImplementation(result, context, f.api, trust()), /branch_ownership/)
  assert.equal(
    f.calls.some((c) => c.method !== 'GET'),
    false,
  )
})

test('ref recheck stops concurrent update without force or a PR', async () => {
  const f = fixture()
  let reads = 0
  const api = (method, path, data) => {
    if (path.startsWith('/git/ref/heads/') && ++reads === 2) f.setHead('c'.repeat(40))
    return f.api(method, path, data)
  }
  await assert.rejects(publishImplementation(result, context, api, trust()), /stale_head/)
  assert.equal(
    f.calls.some((c) => c.path === '/git/refs' || c.path === '/pulls'),
    false,
  )
})

test('partial publication records receipt and retry finishes PR without duplicate commit', async () => {
  const f = fixture()
  let receipt
  const trusted = { ...trust(), publisherRunId: 8 }
  await assert.rejects(
    publishImplementation(
      result,
      context,
      (method, path, data) => {
        if (path === '/pulls') throw new Error('sensitive-token')
        return f.api(method, path, data)
      },
      trusted,
      (value) => {
        receipt = value
      },
    ),
    (error) => error.message === 'github_api' && error.state === 'possible',
  )
  assert.equal(receipt.head, next)
  const api = (method, path, data) => {
    if (path === '/actions/runs/8')
      return {
        path: '.github/workflows/implementation-publish.yml',
        head_branch: 'main',
        head_sha: sha,
        repository: { full_name: 'MeNn13/ai-for-developers-project-387' },
      }
    return f.api(method, path, data)
  }
  const retry = { ...trusted, previous: receipt, previousRunId: 8 }
  const published = await publishImplementation(result, context, api, retry)
  assert.equal(published.pr, 50)
  const writeCount = f.calls.filter((c) => c.method !== 'GET').length
  await publishImplementation(result, context, api, retry)
  assert.equal(f.calls.filter((c) => c.method !== 'GET').length, writeCount)
  assert.equal(f.calls.filter((c) => c.path === '/git/commits').length, 1)
  assert.equal(f.calls.filter((c) => c.path === '/pulls' && c.method === 'POST').length, 1)
})

test('origin, checks, approval, payload and commit failures perform no writes', async () => {
  for (const reason of ['origin', 'checks', 'approval', 'result', 'commit_message']) {
    const f = fixture()
    const api = async (method, path, data) => {
      const value = await f.api(method, path, data)
      if (reason === 'origin' && path === '/actions/runs/7') value.head_branch = 'evil'
      if (reason === 'checks' && path.includes('/jobs?')) value.jobs = []
      if (reason === 'approval' && path === '/issues/comments/99') value.user.login = 'stranger'
      return value
    }
    await assert.rejects(
      publishImplementation(
        {
          ...result,
          ...(reason === 'result' ? { contextDigest: 'fake' } : {}),
          ...(reason === 'commit_message' ? { message: 'Исправить #40' } : {}),
        },
        context,
        api,
        trust(),
      ),
      new RegExp(reason),
    )
    assert.equal(
      f.calls.some((c) => c.method !== 'GET'),
      false,
    )
  }
})

test('verification must bind exact result, candidate SHA, command and readiness', async () => {
  for (const change of [
    { resultDigest: 'fake' },
    { sha },
    { conclusion: 'failure' },
    { command: 'true' },
    { ready: true },
    { runId: 99 },
  ]) {
    const f = fixture()
    const trusted = trust()
    Object.assign(trusted.verification, change)
    await assert.rejects(publishImplementation(result, context, f.api, trusted), /verification/)
    assert.equal(
      f.calls.some((c) => c.method !== 'GET'),
      false,
    )
  }
  const f = fixture()
  await assert.rejects(
    publishImplementation(
      result,
      context,
      (method, path, data) => (path === '/git/commits' ? { sha } : f.api(method, path, data)),
      trust(),
    ),
    /commit_sha/,
  )
  assert.equal(
    f.calls.some((c) => c.path === '/git/refs' || c.path === '/pulls'),
    false,
  )
})

test('existing App branch accepts a checked successor and marks confirmed PR ready', async () => {
  const f = fixture()
  let previous
  await publishImplementation(
    result,
    context,
    f.api,
    { ...trust(), publisherRunId: 8 },
    (value) => {
      previous = value
    },
  )
  const updatedContext = { ...context, expectedHead: next }
  const updated = {
    ...result,
    candidateSha: 'c'.repeat(40),
    ready: true,
    contextDigest: createHash('sha256').update(JSON.stringify(updatedContext)).digest('hex'),
    message: 'fix(web): improve booking confirmation (#40)',
  }
  const trusted = {
    ...trust(),
    previous,
    previousRunId: 8,
    publisherRunId: 9,
    verification: {
      ...trust().verification,
      ready: true,
      sha: updated.candidateSha,
      resultDigest: createHash('sha256').update(JSON.stringify(updated)).digest('hex'),
    },
  }
  let marked = false
  const api = (method, path, data) => {
    if (path === '/actions/runs/8')
      return {
        path: '.github/workflows/implementation-publish.yml',
        head_branch: 'main',
        head_sha: sha,
        repository: { full_name: 'MeNn13/ai-for-developers-project-387' },
      }
    if (path === `/git/commits/${next}`) return { tree: { sha } }
    if (path === '/git/commits') return { sha: updated.candidateSha }
    if (path === '/graphql') {
      marked = true
      return {}
    }
    return f.api(method, path, data)
  }
  const receipt = await publishImplementation(updated, updatedContext, api, trusted)
  assert.equal(receipt.head, updated.candidateSha)
  assert.equal(receipt.pr, 50)
  assert.ok(marked)
  assert.deepEqual(
    f.calls.find((c) => c.method === 'PATCH' && c.path.startsWith('/git/refs/')).data,
    { sha: updated.candidateSha, force: false },
  )
})

test('App authentication requests only the fixed repository and permissions; revocation has no key', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'publisher-app-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const preloadFile = join(directory, 'fetch.mjs')
  const preload = pathToFileURL(preloadFile).href
  writeFileSync(
    preloadFile,
    `import assert from 'node:assert/strict';
    globalThis.fetch = async (url, options) => {
      if (process.argv[2] === 'revoke') {
        assert.equal(url, 'https://api.github.com/installation/token');
        assert.equal(options.method, 'DELETE');
        assert.equal(options.headers.Authorization, 'Bearer fixture-token');
      } else {
        assert.equal(url, 'https://api.github.com/app/installations/20/access_tokens');
        assert.deepEqual(JSON.parse(options.body), { repositories: ['ai-for-developers-project-387'], permissions: { contents: 'write', pull_requests: 'write', issues: 'read', actions: 'read' } });
        assert.match(options.headers.Authorization, /^Bearer [^.]+\\.[^.]+\\.[^.]+$/);
      }
      return { ok: true, json: async () => ({ token: 'fixture-token' }) };
    };`,
  )
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const environment = join(directory, 'env')
  const script = join(import.meta.dirname, 'implementation-app.mjs')
  const output = execFileSync(process.execPath, ['--import', preload, script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PUBLISH_APP_ID: '10',
      PUBLISH_INSTALLATION_ID: '20',
      PUBLISH_APP_PRIVATE_KEY: privateKey,
      GITHUB_ENV: environment,
    },
  })
  assert.equal(readFileSync(environment, 'utf8'), 'GH_TOKEN=fixture-token\n')
  assert.equal(output.trim(), '::add-mask::fixture-token')
  execFileSync(process.execPath, ['--import', preload, script, 'revoke'], {
    env: { ...process.env, GH_TOKEN: 'fixture-token' },
  })
})

test('verified ready false converts an existing ready PR back to draft', async () => {
  const f = fixture()
  let receipt
  const trusted = { ...trust(), publisherRunId: 8 }
  await publishImplementation(result, context, f.api, trusted, (r) => {
    receipt = r
  })
  const mutations = []
  const api = async (method, path, data) => {
    if (path === '/actions/runs/8')
      return {
        path: '.github/workflows/implementation-publish.yml',
        head_branch: 'main',
        head_sha: sha,
        repository: { full_name: 'MeNn13/ai-for-developers-project-387' },
      }
    if (path === '/graphql') {
      mutations.push(data)
      return {}
    }
    const value = await f.api(method, path, data)
    if (path.startsWith('/pulls?')) value[0].draft = false
    return value
  }
  await publishImplementation(result, context, api, {
    ...trusted,
    previous: receipt,
    previousRunId: 8,
  })
  assert.equal(mutations.length, 1)
  assert.match(mutations[0].query, /convertPullRequestToDraft/)
  assert.deepEqual(mutations[0].variables, { id: 'PR_50' })
})

test('publisher accepts inline origin and prior inline receipt but rejects changed workflow bytes', async () => {
  const f = fixture()
  let previous
  await publishImplementation(result, context, f.api, { ...trust(), publisherRunId: 8 }, (r) => {
    previous = r
  })
  const repairedContext = { ...context, expectedHead: next, repair: { number: 50 } }
  const repaired = {
    ...result,
    candidateSha: 'c'.repeat(40),
    contextDigest: createHash('sha256').update(JSON.stringify(repairedContext)).digest('hex'),
  }
  const trusted = {
    ...trust(),
    runAttempt: 2,
    publisherRunId: 7,
    previousRunId: 8,
    previous,
    verification: {
      ...trust().verification,
      sha: repaired.candidateSha,
      resultDigest: createHash('sha256').update(JSON.stringify(repaired)).digest('hex'),
    },
  }
  let forged = true
  const api = async (method, path, data) => {
    if (path === '/actions/runs/7' || path === '/actions/runs/8')
      return {
        id: Number(path.split('/').at(-1)),
        path: '.github/workflows/opencode.yml',
        event: 'pull_request_review_comment',
        head_branch: 'spec/38',
        head_sha: 'd'.repeat(40),
        repository: { full_name: 'MeNn13/ai-for-developers-project-387' },
        status: 'in_progress',
      }
    if (path.startsWith('/git/commits/' + 'd'.repeat(40)))
      return { parents: [{ sha }, { sha: next }] }
    if (path.startsWith('/compare/')) return { status: 'ahead' }
    if (path.startsWith('/contents/'))
      return { sha: forged && path.endsWith('d'.repeat(40)) ? next : sha }
    if (path.includes('/attempts/2/jobs'))
      return {
        total_count: 1,
        jobs: [
          {
            name: 'implementation-publish-pr-50',
            steps: [{ name: 'implementation-admitted', conclusion: 'success' }],
          },
        ],
      }
    if (path === `/git/commits/${next}`) return { tree: { sha } }
    if (path === '/git/commits') return { sha: repaired.candidateSha }
    return f.api(method, path, data)
  }
  await assert.rejects(publishImplementation(repaired, repairedContext, api, trusted), /origin/)
  forged = false
  assert.equal(
    (await publishImplementation(repaired, repairedContext, api, trusted)).head,
    repaired.candidateSha,
  )
})
