import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { protocolExamples } from './opencode-protocol.mjs'
import { fileURLToPath } from 'node:url'

test('reply config adds only its plugin and narrow permissions without changing implementation config', async () => {
  const base = JSON.parse(await readFile('.github/opencode/opencode.json', 'utf8'))
  const result = spawnSync(process.execPath, ['scripts/opencode-config.mjs'], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  const config = JSON.parse(result.stdout)
  assert.equal(base.plugins, undefined)
  assert.deepEqual(config.plugins, [
    fileURLToPath(new URL('../.github/opencode/submit-reply/', import.meta.url)),
  ])
  assert.deepEqual(config.permissions, [
    ...base.permissions,
    { action: 'submit_reply', resource: '*', effect: 'allow' },
  ])
  assert.deepEqual(config.policies, [
    ...base.policies,
    { action: 'tool.use', resource: 'submit_reply:reply', effect: 'allow' },
  ])
  assert.equal(config.update, 'disable')
  const review = spawnSync(process.execPath, ['scripts/opencode-config.mjs', '--review'], {
    encoding: 'utf8',
  })
  assert.equal(review.status, 0)
  assert.deepEqual(JSON.parse(review.stdout), {
    ...config,
    providers: { 'cloudflare-workers-ai': { settings: { apiKey: '{env:CLOUDFLARE_API_KEY}' } } },
    policies: [
      ...config.policies,
      { action: 'provider.use', resource: 'cloudflare-workers-ai', effect: 'allow' },
    ],
  })
  for (const path of ['.github/workflows/opencode.yml', '.github/workflows/opencode-review.yml']) {
    const workflow = await readFile(path, 'utf8')
    assert.match(workflow, /node scripts\/opencode-config.mjs/)
    assert.match(workflow, /\| sudo tee \/etc\/opencode\/opencode.json/)
  }
})

const reply = { version: 1, comment: '## Answer\n\n```js\n"quoted"\n```', publication: null }
const submission = (input = reply, id = 'call-1', status = 'completed') => ({
  type: 'tool_use',
  sessionID: 'session-1',
  part: { id, messageID: 'message-1', tool: 'submit_reply', state: { status, input } },
})
const stop = { type: 'step_finish', sessionID: 'session-1', part: { reason: 'stop' } }

async function invoke(events, { status = 0, stale = false, mode, rawStream, review } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'opencode-submit-'))
  try {
    await writeFile(join(directory, 'context.json'), JSON.stringify({ mode }))
    if (stale) await writeFile(join(directory, 'reply.json'), JSON.stringify(reply))
    await writeFile(
      join(directory, 'stream.jsonl'),
      rawStream ?? events.map(JSON.stringify).join('\n'),
    )
    const loader = join(directory, 'fake.mjs')
    await writeFile(
      loader,
      `
      import { appendFileSync, readFileSync } from 'node:fs';
      if (process.argv[1]?.endsWith('run')) {
        const model = process.argv[process.argv.indexOf('--model') + 1];
        const backup = model.startsWith('cloudflare-workers-ai/');
        appendFileSync(new URL('./attempts.jsonl', import.meta.url), JSON.stringify({
          model,
          primaryKey: process.env.OPENCODE_API_KEY === 'fake-private-key',
          cloudflareKey: process.env.CLOUDFLARE_API_KEY === 'fake-backup-key',
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID === 'fake-account',
          geminiKey: Boolean(process.env.GEMINI_API_KEY),
        }) + '\\n');
        process.stderr.write('fake-private-key fake-backup-key raw-model-output');
        process.stdin.resume();
        await new Promise(() => process.stdin.on('end', () => {
          const stream = backup ? ${JSON.stringify((review?.backup ?? [submission(), stop]).map(JSON.stringify).join('\n'))}
            : readFileSync(new URL('./stream.jsonl', import.meta.url));
          process.stdout.write(stream, () => process.exit(backup ? ${review?.backupStatus ?? 0} : ${status}));
        }));
      }
    `,
    )
    const workflow = review && (await readFile('.github/workflows/opencode-review.yml', 'utf8'))
    const script = workflow?.match(/<<'NODE'\r?\n([\s\S]*?)\r?\n          NODE/)?.[1]
    const args = review
      ? ['--input-type=module', '--eval', script]
      : ['scripts/opencode.mjs', 'run']
    const result = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${pathToFileURL(loader).href}`,
        OPENCODE_BIN: process.execPath,
        OPENCODE_IO: directory,
        OPENCODE_API_KEY: 'fake-private-key',
        ...(review && {
          CLOUDFLARE_API_KEY: review.key ?? 'fake-backup-key',
          CLOUDFLARE_ACCOUNT_ID: review.account ?? 'fake-account',
          GEMINI_API_KEY: 'fake-gemini-key',
        }),
      },
    })
    const read = async (name) => {
      try {
        return JSON.parse(await readFile(join(directory, name), 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    }
    const output = result.stdout + result.stderr
    assert.doesNotMatch(output, /fake-private-key|fake-backup-key|raw-model-output/)
    if (review) {
      const published = await read('publication/reply.json')
      const diagnostic = await read('publication/diagnostic.json')
      assert.doesNotMatch(
        JSON.stringify({ published, diagnostic }),
        /fake-private-key|fake-backup-key|raw-model-output/,
      )
      const attempts = (await readFile(join(directory, 'attempts.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map(JSON.parse)
      return { status: result.status, reply: published, diagnostic, attempts, output }
    }
    return {
      status: result.status,
      reply: await read('reply.json'),
      diagnostic: await read('diagnostic.json'),
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const primaryAttempt = {
  model: 'opencode/deepseek-v4.1-flash-free',
  primaryKey: true,
  cloudflareKey: false,
  accountId: false,
  geminiKey: false,
}
const backupAttempt = {
  model: 'cloudflare-workers-ai/@cf/openai/gpt-oss-20b',
  primaryKey: false,
  cloudflareKey: true,
  accountId: true,
  geminiKey: false,
}
const providerError = (error) => ({
  type: 'error',
  error: { message: 'raw-model-output fake-private-key fake-backup-key', ...error },
})

test('review publishes a primary success with only the primary provider key', async () => {
  const result = await invoke([submission(), stop], { mode: 'review', review: {} })
  assert.equal(result.status, 0)
  assert.deepEqual(result.reply, reply)
  assert.deepEqual(result.attempts, [primaryAttempt])
  assert.equal(result.output, '')
})

test('review retries recognized provider failures once with only Cloudflare credentials', async () => {
  for (const error of [
    { type: 'api', status: 429 },
    { type: 'api', status: 408 },
    { name: 'APIError', data: { statusCode: 503 } },
    ...['no-route', 'free-limit', 'rate-limit', 'quota', 'internal', 'transport', 'timeout'].map(
      (type) => ({ type: `provider.${type}` }),
    ),
  ]) {
    const result = await invoke([providerError(error)], { status: 1, mode: 'review', review: {} })
    assert.equal(result.status, 0)
    assert.deepEqual(result.reply, reply)
    assert.deepEqual(result.attempts, [primaryAttempt, backupAttempt])
    assert.match(
      result.output,
      /^Independent review is retrying once with Cloudflare Workers AI\.\r?\n$/,
    )
  }
  const limit = providerError({ type: 'api', status: 429 })
  const failed = await invoke([limit], {
    mode: 'review',
    review: { backup: [limit] },
  })
  assert.equal(failed.status, 1)
  assert.equal(failed.diagnostic.code, 'provider_error')
  assert.deepEqual(failed.attempts, [primaryAttempt, backupAttempt])
  assert.equal(failed.reply, null)
})

test('review preserves the primary error when either Cloudflare setting is missing', async () => {
  for (const review of [{ key: '' }, { account: '' }]) {
    const result = await invoke([providerError({ type: 'api', status: 429 })], {
      status: 1,
      mode: 'review',
      review,
    })
    assert.equal(result.status, 1)
    assert.deepEqual(result.diagnostic, { version: 5, code: 'cli_exit', stage: 'cli', exitCode: 1 })
    assert.deepEqual(result.attempts, [primaryAttempt])
    assert.equal(result.reply, null)
  }
})

test('review rejects invalid and sensitive replies and terminal failures without fallback', async () => {
  const rate = providerError({ type: 'api', status: 429 })
  for (const [events, status, code] of [
    [[submission({ ...reply, comment: '' }), rate], 1, 'reply_schema'],
    [[submission({ ...reply, comment: 'fake-backup-key' }), rate], 1, 'reply_sensitive'],
    [[submission({ ...reply, comment: 'fake-private-key' }), stop], 0, 'reply_sensitive'],
    [[providerError({ type: 'provider.auth', status: 503 })], 1, 'cli_exit'],
    [[providerError({ type: 'permission.rejected', status: 429 })], 1, 'cli_exit'],
    [[providerError({ type: 'provider.invalid-request', status: 429 })], 1, 'cli_exit'],
    [[providerError({ message: 'HTTP 429 raw-model-output' })], 1, 'cli_exit'],
    [[], 1, 'cli_exit'],
  ]) {
    const result = await invoke(events, { status, mode: 'review', review: {} })
    assert.equal(result.status, 1)
    assert.equal(result.diagnostic.code, code)
    assert.deepEqual(result.attempts, [primaryAttempt])
    assert.equal(result.reply, null)
  }
})

test('CLI preserves only the category and exit code when a model is unavailable', async () => {
  const event = {
    type: 'error',
    error: { type: 'provider.no-route', message: 'Model unavailable: fake-private-key' },
  }
  const result = await invoke([event, { type: 'step_start' }], { status: 1 })
  assert.equal(result.reply, null)
  assert.deepEqual(result.diagnostic, {
    version: 5,
    code: 'model_unavailable',
    stage: 'provider',
    exitCode: 1,
  })
})

test('manual CLI accepts a submitted Markdown reply without final text', async () => {
  const result = await invoke([submission(), stop])
  assert.equal(result.status, 0, JSON.stringify(result))
  assert.deepEqual(result.reply, reply)
})

test('submission tool validates fields and requires its narrow permission before accepting', async () => {
  const { default: plugin } = await import('../.github/opencode/submit-reply/index.mjs')
  let tool
  const permissions = []
  await plugin.setup({
    tool: {
      transform: async (edit) =>
        edit({
          add: (value) => {
            tool = value
          },
        }),
    },
    permission: { assert: async (value) => permissions.push(value) },
  })
  assert.equal(tool.name, 'submit_reply')
  const context = { sessionID: 'session-1', agent: 'discussion' }
  for (const input of protocolExamples) {
    assert.deepEqual(await tool.execute(input, context), { content: 'Reply accepted' })
  }
  assert.deepEqual(permissions[0], {
    sessionID: 'session-1',
    agent: 'discussion',
    action: 'submit_reply',
    resources: ['reply'],
  })
  const invalid = structuredClone(protocolExamples[1])
  delete invalid.publication.items[0].blockedBy
  await assert.rejects(tool.execute(invalid, context), /blockedBy.*missing/)
  await plugin.setup({
    tool: {
      transform: async (edit) =>
        edit({
          add: (value) => {
            tool = value
          },
        }),
    },
    permission: {
      assert: async () => {
        throw new Error('denied')
      },
    },
  })
  await assert.rejects(tool.execute(reply, context), /denied/)
})

test('all manual reply kinds retain their Markdown through tool events', async () => {
  for (const input of protocolExamples) {
    const result = await invoke([
      submission(input),
      { type: 'text', part: { messageID: 'last', text: 'Ignored prose ```json {}' } },
      stop,
    ])
    assert.equal(result.status, 0, JSON.stringify(result))
    assert.deepEqual(result.reply, input)
  }
})

test('failed tool arguments can be corrected within the same session', async () => {
  const result = await invoke([submission({}, 'bad', 'error'), submission(), stop])
  assert.equal(result.status, 0)
  assert.deepEqual(result.reply, reply)
})

test('review diagnostics distinguish missing, unfinished and rejected submissions', async () => {
  for (const [events, diagnostic] of [
    [
      [{ type: 'text', part: { messageID: 'last', text: 'fake-private-key' } }, stop],
      { version: 6, code: 'submission_missing', stage: 'reply', details: { toolEvents: 0 } },
    ],
    [
      [
        submission({ comment: 'fake-private-key' }, 'pending', 'running'),
        submission({ comment: 'fake-private-key' }, 'failed', 'error'),
        stop,
      ],
      { version: 6, code: 'submission_unfinished', stage: 'reply', details: { toolEvents: 2 } },
    ],
    [
      [submission({ version: 1, comment: 'fake-private-key' }), stop],
      {
        version: 3,
        code: 'reply_schema',
        stage: 'reply',
        details: { rule: 'publication_kind', field: 'publication', reason: 'missing' },
      },
    ],
    [
      [submission({ ...protocolExamples[1], comment: 'fake-private-key' }), stop],
      {
        version: 3,
        code: 'reply_schema',
        stage: 'reply',
        details: { rule: 'publication_kind', field: 'publication', reason: 'invalid' },
      },
    ],
  ]) {
    const result = await invoke(events, { mode: 'review', stale: true })
    assert.equal(result.status, 1)
    assert.equal(result.reply, null)
    assert.deepEqual(result.diagnostic, diagnostic)
  }
})

test('review rejects a submitted comment containing the configured key', async () => {
  const result = await invoke([submission({ ...reply, comment: 'fake-private-key' }), stop], {
    mode: 'review',
    stale: true,
  })
  assert.equal(result.status, 1)
  assert.equal(result.reply, null)
  assert.deepEqual(result.diagnostic, { version: 1, code: 'reply_sensitive', stage: 'reply' })
})

test('duplicate events and identical submissions preserve the first result regardless of property order', async () => {
  const reordered = { publication: null, comment: reply.comment, version: 1 }
  const result = await invoke([submission(), submission(), submission(reordered, 'call-2'), stop])
  assert.equal(result.status, 0)
  assert.deepEqual(result.reply, reply)
})

test('conflicting, missing, malformed or incomplete submissions never leave a publishable reply', async () => {
  for (const [events, code, status = 0] of [
    [
      [{ type: 'text', part: { messageID: 'last', text: JSON.stringify(reply) } }, stop],
      'submission_missing',
    ],
    [[submission({}, 'bad', 'error'), stop], 'submission_unfinished'],
    [
      [submission(), submission({ ...reply, comment: 'different' }, 'call-2'), stop],
      'submission_conflict',
    ],
    [[submission(), submission({ ...reply, comment: 'different' }), stop], 'submission_conflict'],
    [[submission({ version: 1 }), stop], 'reply_schema'],
    [[submission(), { ...stop, sessionID: 'other-session' }], 'stream_json'],
    [[submission()], 'incomplete'],
    [[stop, { type: 'step_start', sessionID: 'session-1' }, submission()], 'incomplete'],
    [[submission(), { ...stop, part: { reason: 'length' } }], 'incomplete'],
    [
      [submission(), { type: 'error', error: { message: 'fake-private-key' } }, stop],
      'provider_error',
    ],
    [[submission(), stop], 'cli_exit', 1],
  ]) {
    const result = await invoke(events, { status, stale: true })
    assert.equal(result.status, 1)
    assert.equal(result.reply, null)
    assert.equal(result.diagnostic.code, code)
    assert.doesNotMatch(JSON.stringify(result.diagnostic), /fake-private-key|different/)
  }
})

test('automatic triage still accepts Markdown and rejects empty, oversized or incomplete text', async () => {
  const text = (value) => ({ type: 'text', part: { messageID: 'last', text: value } })
  const result = await invoke([text(reply.comment), stop], { mode: 'triage' })
  assert.equal(result.status, 0)
  assert.deepEqual(result.reply, reply)
  for (const [events, code] of [
    [[text('  '), stop], 'incomplete'],
    [[text('x'.repeat(50_001)), stop], 'stream_limit'],
    [[text(reply.comment)], 'incomplete'],
  ]) {
    const result = await invoke(events, { mode: 'triage', stale: true })
    assert.equal(result.status, 1)
    assert.equal(result.reply, null)
    assert.equal(result.diagnostic.code, code)
  }
})

test('invalid JSONL and oversized CLI output fail without leaking raw content', async () => {
  for (const [rawStream, code] of [
    ['fake-private-key invalid JSONL', 'stream_json'],
    ['x'.repeat(2_000_001), 'stream_limit'],
  ]) {
    const result = await invoke([], { rawStream, stale: true })
    assert.equal(result.status, 1)
    assert.equal(result.reply, null)
    assert.equal(result.diagnostic.code, code)
  }
})
