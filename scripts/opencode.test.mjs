import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { prepare, resultReply } from './opencode.mjs'
import { failureNotice, diagnosticFor, DiagnosticError } from './opencode-diagnostic.mjs'

test('workflow failure notice posts only a safe comment for missing, invalid and known diagnostics', async () => {
  const workflow = await readFile('.github/workflows/opencode.yml', 'utf8')
  const source = workflow
    .split('          script: |\n')[1]
    .split('\n  publish-triage:')[0]
    .split('\n')
    .map((line) => line.slice(12))
    .join('\n')
  const directory = await mkdtemp(join(tmpdir(), 'opencode-workflow-'))
  const previousTemp = process.env.RUNNER_TEMP
  const previousResult = process.env.ANSWER_RESULT
  try {
    process.env.RUNNER_TEMP = directory
    process.env.ANSWER_RESULT = 'failure'
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(directory, 'opencode-diagnostic'))
    for (const value of [
      null,
      'not JSON fake-secret',
      JSON.stringify({
        version: 3,
        code: 'publication',
        stage: 'publish',
        details: { reason: ['github_write'], state: 'possible' },
      }),
      JSON.stringify({ version: 1, code: 'reply_json', stage: 'reply' }),
      JSON.stringify({
        version: 2,
        code: 'reply_schema',
        stage: 'reply',
        details: { rule: 'item_key' },
      }),
      JSON.stringify({
        version: 3,
        code: 'reply_schema',
        stage: 'reply',
        details: { rule: 'item_blockers', field: 'blockedBy', reason: 'missing' },
      }),
      JSON.stringify({
        version: 3,
        code: 'reply_schema',
        stage: 'reply',
        details: { rule: 'item_blockers', field: 'blockedBy', reason: 'fake-secret' },
      }),
    ]) {
      const file = join(directory, 'opencode-diagnostic', 'diagnostic.json')
      if (value === null) await rm(file, { force: true })
      else await writeFile(file, value)
      const comments = []
      const failures = []
      const execute = new (Object.getPrototypeOf(async function () {}).constructor)(
        'require',
        'context',
        'github',
        'core',
        source,
      )
      await execute(
        createRequire(import.meta.url),
        { repo: { owner: 'example', repo: 'repo' }, runId: 1, payload: { issue: { number: 12 } } },
        {
          rest: { issues: { createComment: async (comment) => comments.push(comment) } },
          request: () => assert.fail('publication started'),
        },
        { setFailed: (message) => failures.push(message) },
      )
      assert.equal(comments.length, 1)
      assert.equal(failures.length, 1)
      assert.doesNotMatch(comments[0].body, /fake-secret/)
      assert.match(comments[0].body, /Состояние публикации неизвестно/)
    }
  } finally {
    if (previousTemp === undefined) delete process.env.RUNNER_TEMP
    else process.env.RUNNER_TEMP = previousTemp
    if (previousResult === undefined) delete process.env.ANSWER_RESULT
    else process.env.ANSWER_RESULT = previousResult
    await rm(directory, { recursive: true, force: true })
  }
})

test('unknown preparation diagnostics preserve independently verified publication state', () => {
  for (const diagnostic of [
    undefined,
    { version: 1, code: 'unknown', stage: 'unknown' },
    { version: 4, code: 'reply_json', stage: 'reply', details: { secret: 'fake-secret' } },
  ]) {
    assert.match(failureNotice(diagnostic, 'run', 'none'), /не начиналась \(none\)/)
    assert.match(
      failureNotice(diagnostic, 'run', 'possible'),
      /восстановите издателя с исходным корректным артефактом/,
    )
    assert.match(failureNotice(diagnostic, 'run'), /Состояние публикации неизвестно/)
    assert.doesNotMatch(failureNotice(diagnostic, 'run', 'possible'), /fake-secret|\(unknown\)/)
  }
})

function event(body = '/oc explain this issue') {
  return {
    action: 'created',
    repository: { full_name: 'MeNn13/ai-for-developers-project-387' },
    issue: { number: 12 },
    comment: { id: 40, body, user: { login: 'MeNn13', type: 'User' } },
  }
}

function submissionStream(text, reason = 'stop') {
  return [
    {
      type: 'tool_use',
      sessionID: 's',
      part: {
        id: 'call',
        messageID: 'last',
        tool: 'submit_reply',
        state: { status: 'completed', input: JSON.parse(text) },
      },
    },
    { type: 'step_finish', part: { reason } },
  ]
    .map(JSON.stringify)
    .join('\n')
}

test('schema failure reports a fixed rule without retaining model data', () => {
  assert.throws(
    () => resultReply(submissionStream('{"comment":"fake-secret"}')),
    (error) => {
      assert.deepEqual(diagnosticFor(error), {
        version: 3,
        code: 'reply_schema',
        stage: 'reply',
        details: { rule: 'version_comment', field: 'version', reason: 'missing' },
      })
      assert.doesNotMatch(JSON.stringify(error), /fake-secret/)
      return true
    },
  )
})

test('schema rules identify the first failed validation and preserve valid replies', () => {
  const item = { key: 'task', title: 'Title', body: 'Body', blockedBy: [] }
  const spec = (items) => ({ version: 1, comment: 'Answer', publication: { kind: 'spec', items } })
  const cases = [
    [null, 'version_comment'],
    [{ version: 1, comment: 'Answer', publication: { kind: 'fake-secret' } }, 'publication_kind'],
    [spec([]), 'publication_items'],
    [spec([item, item]), 'spec_item_count'],
    [
      { version: 1, comment: 'Answer', publication: { kind: 'tickets', items: [item] } },
      'ticket_references',
    ],
    [spec([{ ...item, key: 'fake secret' }]), 'item_key'],
    [spec([{ ...item, title: '' }]), 'item_text'],
    [spec([{ ...item, blockedBy: null }]), 'item_blockers'],
    [spec([{ key: 'task', title: 'Title', body: 'Body' }]), 'item_blockers'],
    [spec([{ ...item, blockedBy: 'task' }]), 'item_blockers'],
    [spec([{ ...item, blockedBy: ['task', 'task'] }]), 'item_blockers'],
    [spec([{ ...item, blockedBy: ['fake-secret'] }]), 'blocker_order'],
    [spec([null]), 'item_key'],
  ]
  for (const [reply, rule] of cases) {
    assert.throws(
      () => resultReply(submissionStream(JSON.stringify(reply))),
      (error) => {
        assert.equal(diagnosticFor(error).version, 3)
        assert.equal(diagnosticFor(error).code, 'reply_schema')
        assert.equal(diagnosticFor(error).details.rule, rule)
        assert.doesNotMatch(JSON.stringify(error), /fake-secret/)
        return true
      },
    )
  }
  for (const reply of [
    spec([item]),
    { version: 1, comment: 'Answer' },
    {
      version: 1,
      comment: 'Answer',
      publication: { kind: 'tickets', spec: 12, approvalComment: 40, items: [item] },
    },
  ])
    assert.deepEqual(resultReply(submissionStream(JSON.stringify(reply))), reply)
})

test('schema diagnostic allowlist rejects arbitrary data and retains v1 compatibility', () => {
  const diagnostic = {
    version: 2,
    code: 'reply_schema',
    stage: 'reply',
    details: { rule: 'item_key' },
  }
  for (const value of [diagnostic, { version: 1, code: 'reply_schema', stage: 'reply' }]) {
    assert.match(failureNotice(value, 'run'), /opencode-diagnostic/)
    assert.doesNotMatch(failureNotice(value, 'run'), /item_key|частичной/)
  }
  for (const value of [
    { ...diagnostic, details: null },
    { ...diagnostic, details: [] },
    { ...diagnostic, details: { rule: 'fake-secret' } },
    { ...diagnostic, details: { rule: 3 } },
    { ...diagnostic, details: { rule: { toString: null } } },
    { ...diagnostic, details: { rule: 'item_key', extra: 'fake-secret' } },
    { ...diagnostic, extra: 'fake-secret' },
    { ...diagnostic, stage: 'stream' },
    { ...diagnostic, code: 'configuration' },
  ]) {
    const error = new DiagnosticError('reply_schema')
    error.diagnostic = value
    assert.deepEqual(diagnosticFor(error), { version: 1, code: 'unknown', stage: 'unknown' })
    assert.match(failureNotice(value, 'run'), /Состояние публикации неизвестно/)
    assert.doesNotMatch(failureNotice(value, 'run'), /fake-secret/)
  }
})

test('CLI fake writes only safe diagnostic on failure and no reply', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opencode-'))
  try {
    await writeFile(
      join(directory, 'context.json'),
      JSON.stringify({ body: 'fake-key-private-context' }),
    )
    // Node is the fake binary: it rejects OpenCode arguments and exits nonzero.
    const result = spawnSync(process.execPath, ['scripts/opencode.mjs', 'run'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENCODE_IO: directory,
        OPENCODE_API_KEY: 'fake-key-private-context',
        OPENCODE_BIN: process.execPath,
      },
    })
    assert.equal(result.status, 1)
    const diagnostic = await readFile(join(directory, 'diagnostic.json'), 'utf8')
    assert.equal(JSON.parse(diagnostic).code, 'cli_exit')
    assert.doesNotMatch(
      result.stdout + result.stderr + diagnostic,
      /fake-key-private-context|bad option/,
    )
    await assert.rejects(readFile(join(directory, 'reply.json')))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('failure notice accepts only exact known diagnostics and otherwise uses fallback', () => {
  const run = 'https://github.com/example/repo/actions/runs/1'
  const diagnostic = { version: 1, code: 'reply_json', stage: 'reply' }
  assert.match(failureNotice(diagnostic, run), /Состояние публикации неизвестно/)
  assert.doesNotMatch(failureNotice(diagnostic, run), /частичной|исходным артефактом/)
  assert.doesNotMatch(failureNotice(diagnostic, run), /ключ|лимит/)
  for (const invalid of [
    undefined,
    {},
    { version: 1, code: { toString: null }, stage: 'reply' },
    { ...diagnostic, extra: 'fake-secret' },
    { ...diagnostic, stage: 'fake-secret' },
    { ...diagnostic, code: 'fake-secret' },
  ]) {
    const notice = failureNotice(invalid, run)
    assert.match(notice, /не завершил подготовку или публикацию/)
    assert.doesNotMatch(notice, /fake-secret/)
    assert.ok(notice.includes(run))
  }
})

test('trusted issue command receives discussion up to the requesting comment', async () => {
  const request = event()
  const api = async (path) => {
    if (path === '/issues/12') return { title: 'Booking issue', body: 'Describe booking' }
    if (path === '/issues/12/comments?per_page=100&page=1') {
      return [
        { id: 39, body: 'Earlier decision', user: { login: 'guest' } },
        request.comment,
        { id: 41, body: 'Later decision', user: { login: 'guest' } },
      ]
    }
    assert.fail(`Unexpected request: ${path}`)
  }
  const result = await prepare('issue_comment', request, api)
  assert.equal(result.number, 12)
  assert.match(result.context, /Earlier decision/)
  assert.doesNotMatch(result.context, /Later decision/)
})

test('rejects bots, untrusted users, edits and partial commands before API access', async () => {
  const requests = ['/octopus', 'please /oc explain', '/oc-extra'].map(event)
  const bot = event()
  bot.comment.user.type = 'Bot'
  const stranger = event()
  stranger.comment.user.login = 'stranger'
  const edit = event()
  edit.action = 'edited'
  for (const request of [...requests, bot, stranger, edit]) {
    assert.equal(await prepare('issue_comment', request, () => assert.fail('API called')), null)
  }
})

test('rejects fork pull requests before fetching comments or diff', async () => {
  const request = event()
  request.issue.pull_request = {}
  assert.equal(
    await prepare('issue_comment', request, async (path) => {
      if (path === '/issues/12') return { title: 'Fork' }
      if (path === '/pulls/12') return { head: { repo: { full_name: 'stranger/fork' } } }
      assert.fail(`Unexpected request: ${path}`)
    }),
    null,
  )
})

test('mixed-case long command and paginated discussion are supported', async () => {
  const request = event('  /OpenCode explain')
  request.comment.id = 200
  const result = await prepare('issue_comment', request, async (path) => {
    if (path === '/issues/12') return { title: 'Pages' }
    if (path.endsWith('page=1'))
      return Array.from({ length: 100 }, (_, id) => ({ id, body: 'Earlier' }))
    if (path.endsWith('page=2')) return [{ id: 101, body: 'Second page' }]
    assert.fail(path)
  })
  assert.match(result.context, /Second page/)
})

test('review comment includes PR diff and its own thread without later replies', async () => {
  const request = event()
  request.pull_request = { number: 12 }
  delete request.issue
  Object.assign(request.comment, {
    in_reply_to_id: 30,
    path: 'src/file.ts',
    diff_hunk: '@@ line @@',
    created_at: '2026-11-10T10:00:00Z',
  })
  const result = await prepare('pull_request_review_comment', request, async (path, accept) => {
    if (path === '/issues/12') return { title: 'Review' }
    if (accept) return 'diff --git a/src/file.ts b/src/file.ts'
    if (path === '/pulls/12')
      return {
        head: { repo: request.repository, sha: 'head' },
        base: { sha: 'base' },
      }
    if (path.startsWith('/issues/12/comments?')) return []
    if (path.startsWith('/pulls/12/comments?'))
      return [
        { id: 30, body: 'Thread root' },
        request.comment,
        { id: 41, in_reply_to_id: 30, body: 'Future reply' },
        { id: 31, body: 'Different thread' },
      ]
    assert.fail(path)
  })
  assert.match(result.context, /Thread root/)
  assert.match(result.context, /diff --git/)
  assert.match(result.context, /@@ line @@/)
  assert.doesNotMatch(result.context, /Future reply|Different thread/)
})

test('oversized contexts fail instead of silently omitting discussion', async () => {
  await assert.rejects(
    prepare('issue_comment', event(), async (path) => {
      if (path === '/issues/12') return { body: 'x'.repeat(300_001) }
      return []
    }),
    /300 KB/,
  )
})

test('CLI reports a missing provider key without invoking the model', () => {
  const result = spawnSync(process.execPath, ['scripts/opencode.mjs', 'run'], {
    encoding: 'utf8',
    env: { ...process.env, OPENCODE_IO: 'unused', OPENCODE_API_KEY: '' },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /configuration/)
  assert.equal(result.stdout, '')
})

test('linked specification and tickets include their discussions; foreign references are not fetched', async () => {
  const result = await prepare(
    'issue_comment',
    event('/oc apply to-tickets to #20'),
    async (path) => {
      if (path === '/issues/12')
        return { title: 'Source', body: 'https://github.com/other/repo/issues/99' }
      if (path.startsWith('/issues/12/comments?'))
        return [event('/oc apply to-tickets to #20').comment]
      if (path === '/issues/20') return { title: 'Spec', body: 'Ticket #21' }
      if (path.startsWith('/issues/20/comments?')) return [{ id: 30, body: 'Testing agreed' }]
      if (path === '/issues/21') return { title: 'Ticket', body: 'Acceptance criteria' }
      if (path.startsWith('/issues/21/comments?')) return []
      assert.fail(`Unexpected ${path}`)
    },
  )
  const context = JSON.parse(result.context)
  assert.equal(context.requestId, 40)
  assert.equal(context.repository, event().repository.full_name)
  assert.deepEqual(
    context.related.map((issue) => issue.number),
    [20, 21],
  )
  assert.match(result.context, /Testing agreed|Acceptance criteria/)
})

test('a deleted linked issue is reported in context without breaking ordinary discussion', async () => {
  const result = await prepare('issue_comment', event('/oc explain #999'), async (path) => {
    if (path === '/issues/12') return { title: 'Source' }
    if (path.startsWith('/issues/12/comments?')) return [event('/oc explain #999').comment]
    throw Object.assign(new Error('GitHub returned 404.'), { status: 404 })
  })
  assert.deepEqual(JSON.parse(result.context).related, [{ number: 999, unavailable: true }])
})
