import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { prepare, resultReply } from './opencode.mjs'

function event(body = '/oc explain this issue') {
  return {
    action: 'created',
    repository: { full_name: 'MeNn13/ai-for-developers-project-387' },
    issue: { number: 12 },
    comment: { id: 40, body, user: { login: 'MeNn13', type: 'User' } },
  }
}

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

test('JSON stream returns only the final assistant message', () => {
  const stream = [
    { type: 'text', part: { messageID: 'first', text: 'Reading files' } },
    { type: 'step_finish', part: { reason: 'tool-calls' } },
    {
      type: 'text',
      part: { messageID: 'last', text: JSON.stringify({ version: 1, comment: 'Answer' }) },
    },
    { type: 'step_finish', part: { reason: 'stop' } },
  ]
    .map(JSON.stringify)
    .join('\n')
  assert.deepEqual(resultReply(stream), { version: 1, comment: 'Answer' })
})

test('errors, invalid JSON, missing completion and empty answers are not published as success', () => {
  for (const stream of [
    '',
    'not json',
    '{"type":"error","error":{"message":"401"}}',
    '{"type":"text","part":{"text":"unfinished"}}',
  ]) {
    assert.throws(() => resultReply(stream))
  }
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
  assert.match(result.stderr, /OPENCODE_API_KEY is missing/)
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

test('final structured result is validated, while tool text and unfinished JSON cannot authorize publication', () => {
  const stream = (text, reason = 'stop') =>
    [
      { type: 'text', part: { messageID: 'last', text } },
      { type: 'step_finish', part: { reason } },
    ]
      .map(JSON.stringify)
      .join('\n')
  const reply = { version: 1, comment: 'Вопросы', publication: null }
  assert.deepEqual(resultReply(stream(JSON.stringify(reply))), reply)
  assert.throws(() => resultReply(stream('not json')))
  assert.throws(() => resultReply(stream('{"version":1}')))
  assert.throws(() => resultReply(stream(JSON.stringify(reply), 'tool-calls')))
})

test('a deleted linked issue is reported in context without breaking ordinary discussion', async () => {
  const result = await prepare('issue_comment', event('/oc explain #999'), async (path) => {
    if (path === '/issues/12') return { title: 'Source' }
    if (path.startsWith('/issues/12/comments?')) return [event('/oc explain #999').comment]
    throw Object.assign(new Error('GitHub returned 404.'), { status: 404 })
  })
  assert.deepEqual(JSON.parse(result.context).related, [{ number: 999, unavailable: true }])
})
