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
      JSON.stringify({ version: 1, code: 'reply_json', stage: 'reply' }),
      JSON.stringify({
        version: 2,
        code: 'reply_schema',
        stage: 'reply',
        details: { rule: 'item_key' },
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
      assert.match(
        comments[0].body,
        value?.startsWith('{') ? /Публикация не начиналась/ : /При частичной публикации/,
      )
    }
  } finally {
    if (previousTemp === undefined) delete process.env.RUNNER_TEMP
    else process.env.RUNNER_TEMP = previousTemp
    if (previousResult === undefined) delete process.env.ANSWER_RESULT
    else process.env.ANSWER_RESULT = previousResult
    await rm(directory, { recursive: true, force: true })
  }
})

test('accepts a single whole-answer JSON fence', () => {
  for (const label of ['json', '']) {
    const text = `\`\`\`${label}\n{"version":1,"comment":"Answer"}\n\`\`\``
    const stream = [
      { type: 'text', part: { messageID: 'last', text } },
      { type: 'step_finish', part: { reason: 'stop' } },
    ]
      .map(JSON.stringify)
      .join('\n')
    assert.deepEqual(resultReply(stream), { version: 1, comment: 'Answer' })
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

function answerStream(text, reason = 'stop') {
  return [
    { type: 'text', part: { messageID: 'last', text } },
    { type: 'step_finish', part: { reason } },
  ]
    .map(JSON.stringify)
    .join('\n')
}

test('schema failure reports a fixed rule without retaining model data', () => {
  assert.throws(
    () => resultReply(answerStream('{"comment":"fake-secret"}')),
    (error) => {
      assert.deepEqual(diagnosticFor(error), {
        version: 2,
        code: 'reply_schema',
        stage: 'reply',
        details: { rule: 'version_comment' },
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
    [spec([null]), 'schema_other'],
  ]
  for (const [reply, rule] of cases) {
    assert.throws(
      () => resultReply(answerStream(JSON.stringify(reply))),
      (error) => {
        assert.deepEqual(diagnosticFor(error), {
          version: 2,
          code: 'reply_schema',
          stage: 'reply',
          details: { rule },
        })
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
    assert.deepEqual(resultReply(answerStream(JSON.stringify(reply))), reply)
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
    assert.match(failureNotice(value, 'run'), /При частичной публикации/)
    assert.doesNotMatch(failureNotice(value, 'run'), /fake-secret/)
  }
})

test('JSON failure reports bounded v2 metadata and fixed parse categories', () => {
  for (const [text, kind, position] of [
    ['{"x":"unfinished', 'unexpected_end', 16],
    ['{} trailing', 'trailing_content', 3],
    ['"\\q"', 'invalid_escape', 2],
    ['"line\nfeed"', 'invalid_control', 5],
    ['{"x":}', 'syntax_other', null],
    ['position 0', 'syntax_other', null],
  ]) {
    assert.throws(
      () => resultReply(answerStream(text)),
      (error) => {
        assert.equal(error.diagnostic.version, 2)
        assert.equal(error.diagnostic.details.parseKind, kind)
        assert.equal(error.diagnostic.details.position, position)
        assert.equal(error.diagnostic.details.candidateChars, text.length)
        return true
      },
    )
  }
})

test('unsupported fences stay rejected and unknown parser wording stays safe', (t) => {
  assert.throws(
    () => resultReply(answerStream('```typescript\n{}\n```')),
    (error) => {
      assert.equal(error.diagnostic.details.wrapper, 'other_fence')
      return true
    },
  )
  const parse = JSON.parse
  const stream = answerStream('synthetic candidate')
  t.mock.method(JSON, 'parse', (text) => {
    if (text === 'synthetic candidate') throw new SyntaxError('Unknown future wording fake-secret')
    return parse(text)
  })
  assert.throws(
    () => resultReply(stream),
    (error) => {
      assert.equal(error.diagnostic.details.parseKind, 'syntax_other')
      assert.equal(error.diagnostic.details.position, null)
      assert.doesNotMatch(JSON.stringify(error), /fake-secret/)
      return true
    },
  )
})

test('v2 is strictly validated before notices and serialization', () => {
  let diagnostic
  try {
    resultReply(answerStream('{} trailing'))
  } catch (error) {
    diagnostic = error.diagnostic
  }
  assert.match(failureNotice(diagnostic, 'run'), /Публикация не начиналась/)
  const invalid = [
    null,
    [],
    { ...diagnostic, extra: 'fake-secret' },
    { ...diagnostic, stage: 'cli' },
    { ...diagnostic, details: null },
  ]
  for (const field of Object.keys(diagnostic.details)) {
    for (const value of [-1, 0.5, 2_000_001, 'fake-secret', null, [], {}]) {
      if (field === 'position' && value === null) continue
      invalid.push({ ...diagnostic, details: { ...diagnostic.details, [field]: value } })
    }
  }
  invalid.push({ ...diagnostic, details: { ...diagnostic.details, position: 1000 } })
  invalid.push({ ...diagnostic, details: { ...diagnostic.details, extra: 'fake-secret' } })
  for (const value of invalid) {
    assert.match(failureNotice(value, 'run'), /При частичной публикации/)
    const error = new DiagnosticError('reply_json')
    error.diagnostic = value
    assert.deepEqual(diagnosticFor(error), { version: 1, code: 'unknown', stage: 'unknown' })
  }
})

test('counts final message events and distinguishes UTF-8 bytes from UTF-16 offsets', () => {
  const stream = [
    { type: 'text', part: { messageID: 'first', text: 'Thinking' } },
    { type: 'text', part: { messageID: 'last', text: '```json\n{"я":"😀"}' } },
    { type: 'text', part: { messageID: 'last', text: ' x\n```' } },
    { type: 'step_finish', part: { reason: 'stop' } },
  ]
    .map(JSON.stringify)
    .join('\n')
  assert.throws(
    () => resultReply(stream),
    (error) => {
      assert.deepEqual(error.diagnostic.details, {
        streamBytes: 251,
        eventCount: 4,
        textEventCount: 3,
        messageCount: 2,
        finalTextEventCount: 2,
        answerBytes: 27,
        candidateChars: 12,
        wrapper: 'json_fence',
        root: 'object',
        parseKind: 'trailing_content',
        position: 11,
      })
      return true
    },
  )
})

test('distinguishes failures without exposing response or provider secrets', () => {
  const secret = 'fake-key-private-context'
  for (const [stream, code] of [
    [secret, 'stream_json'],
    ['null', 'stream_json'],
    [answerStream(secret), 'reply_json'],
    [answerStream('{}'), 'reply_schema'],
    [answerStream('```json\n{}\n```\n```json\n{}\n```'), 'reply_json'],
    [answerStream('prose\n```json\n{}\n```'), 'reply_json'],
    [answerStream('{}', 'length'), 'incomplete'],
    [JSON.stringify({ type: 'error', error: { message: `401 ${secret}` } }), 'provider_error'],
    [
      JSON.stringify({ type: 'error', error: { data: { statusCode: 429 }, message: secret } }),
      'provider_rate',
    ],
    [
      JSON.stringify({ type: 'error', error: { data: { statusCode: 401 }, message: secret } }),
      'provider_auth',
    ],
  ]) {
    assert.throws(
      () => resultReply(stream),
      (error) => {
        assert.equal(error.diagnostic.code, code)
        assert.doesNotMatch(JSON.stringify(error), /fake-key-private-context/)
        return true
      },
    )
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
  assert.match(failureNotice(diagnostic, run), /Публикация не начиналась/)
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

test('fake CLI covers completed answers, failures and safe artifacts end to end', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opencode-stream-'))
  try {
    const fake = join(directory, 'fake.mjs')
    await writeFile(
      fake,
      `
      if (process.argv[1]?.endsWith('run')) {
        let prompt = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => prompt += chunk);
        await new Promise(() => process.stdin.on('end', () => {
          if (process.env.EXPECT_PROTOCOL === 'yes' && !prompt.includes('500000 UTF-16')) process.exit(9);
          process.stderr.write('fake-key-private-context');
          process.stdout.write(process.env.FAKE_STREAM, () => process.exit(0));
        }));
      }
    `,
    )
    const markdown = '## Разбор\n\n```text\nПроверить отмену встречи\n```\n\nНужно уточнение.'
    for (const [stream, code, mode, comment = 'Answer'] of [
      [answerStream(markdown), null, 'triage', markdown],
      [answerStream(markdown), 'reply_json'],
      [answerStream('   '), 'incomplete', 'triage'],
      [answerStream(markdown, 'length'), 'incomplete', 'triage'],
      [answerStream('x'.repeat(50_001)), 'stream_limit', 'triage'],
      ['not JSONL', 'stream_json', 'triage'],
      [
        [
          JSON.stringify({ type: 'text', part: { messageID: 'earlier', text: 'Earlier answer' } }),
          answerStream(markdown),
        ].join('\n'),
        null,
        'triage',
        markdown,
      ],
      [answerStream('```json\n{"version":1,"comment":"Answer"}\n```'), null],
      ['fake-key-private-context', 'stream_json'],
      [answerStream('fake-key-private-context'), 'reply_json'],
      [answerStream('{"secret":"fake-key-private-context"}'), 'reply_schema'],
      [answerStream('{}', 'length'), 'incomplete'],
      [
        JSON.stringify({ type: 'error', error: { message: 'fake-key-private-context' } }),
        'provider_error',
      ],
      ['x'.repeat(2_000_001), 'stream_limit'],
    ]) {
      await writeFile(
        join(directory, 'context.json'),
        JSON.stringify({ body: 'fake-key-private-context', mode }),
      )
      await rm(join(directory, 'reply.json'), { force: true })
      await rm(join(directory, 'diagnostic.json'), { force: true })
      // A preload turns Node into a cross-platform fake OPENCODE_BIN.
      await writeFile(join(directory, 'stream.txt'), stream)
      // Keep large streams in a file to avoid OS environment-size limits.
      const loader = join(directory, 'loader.mjs')
      await writeFile(
        loader,
        `import { readFileSync } from 'node:fs';
        if (process.argv[1]?.endsWith('run')) process.env.FAKE_STREAM = readFileSync(new URL('./stream.txt', import.meta.url), 'utf8');
        await import('./fake.mjs');`,
      )
      const result = spawnSync(process.execPath, ['scripts/opencode.mjs', 'run'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: `--import=${pathToFileURL(loader).href}`,
          OPENCODE_BIN: process.execPath,
          OPENCODE_IO: directory,
          OPENCODE_API_KEY: 'fake-key-private-context',
          EXPECT_PROTOCOL: mode === 'triage' ? 'no' : 'yes',
        },
      })
      assert.equal(result.status, code ? 1 : 0, result.stderr)
      assert.doesNotMatch(result.stdout + result.stderr, /fake-key-private-context/)
      if (code) {
        const diagnostic = await readFile(join(directory, 'diagnostic.json'), 'utf8')
        assert.equal(JSON.parse(diagnostic).code, code)
        assert.ok(Buffer.byteLength(diagnostic) <= 1024)
        assert.equal(
          JSON.parse(diagnostic).version,
          ['reply_json', 'reply_schema'].includes(code) ? 2 : 1,
        )
        if (code === 'reply_schema')
          assert.equal(JSON.parse(diagnostic).details.rule, 'version_comment')
        assert.doesNotMatch(
          diagnostic + failureNotice(JSON.parse(diagnostic), 'run'),
          /fake-key-private-context/,
        )
        await assert.rejects(readFile(join(directory, 'reply.json')))
      } else {
        assert.deepEqual(JSON.parse(await readFile(join(directory, 'reply.json'), 'utf8')), {
          version: 1,
          comment,
          ...(mode === 'triage' ? { publication: null } : {}),
        })
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
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
