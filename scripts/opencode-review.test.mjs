import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { eligible, prepareReview, publishReview } from './opencode-review.mjs'

test('workflow preserves a safe failed-review diagnostic without executing PR code', async () => {
  const workflow = await readFile('.github/workflows/opencode-review.yml', 'utf8')
  const match = workflow.match(
    /node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n          NODE/,
  )
  assert.ok(match, 'review run must preserve the trusted runner diagnostic')
  const source = match[1]
    .split(/\r?\n/)
    .map((line) => line.slice(10))
    .join('\n')
  const directory = await mkdtemp(join(tmpdir(), 'review-diagnostic-'))
  try {
    await writeFile(join(directory, 'context.json'), JSON.stringify({ mode: 'review' }))
    const loader = join(directory, 'loader.mjs')
    await writeFile(
      loader,
      `
      if (process.argv[1]?.endsWith('run')) {
        for await (const part of process.stdin) { void part; }
        process.stderr.write('private-provider-context');
        await new Promise(() => process.stdout.write(JSON.stringify({ type: 'error', error: { data: { statusCode: 429 }, message: 'private-provider-context' } }), () => process.exit(0)));
      }
    `,
    )
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${pathToFileURL(loader).href}`,
        OPENCODE_BIN: process.execPath,
        OPENCODE_IO: directory,
        OPENCODE_API_KEY: 'private-provider-context',
      },
    })
    assert.equal(result.status, 1)
    assert.doesNotMatch(result.stdout + result.stderr, /private-provider-context/)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'diagnostic.json'), 'utf8')), {
      version: 1,
      code: 'provider_rate',
      stage: 'provider',
    })
    await assert.rejects(readFile(join(directory, 'reply.json')), { code: 'ENOENT' })
    assert.match(
      workflow,
      /if: always\(\) && !cancelled\(\) && steps.context.outputs.allowed == 'true'/,
    )
    assert.match(workflow, /ref: \$\{\{ github.event.pull_request.base.sha \}\}/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('review config installation supports old trusted bases without hiding helper failures', async () => {
  const workflow = await readFile('.github/workflows/opencode-review.yml', 'utf8')
  const match = workflow.match(
    /          (if \[ -f scripts\/opencode-config.mjs \]; then[\s\S]*?fi \| sudo tee \/etc\/opencode\/opencode.json > \/dev\/null)/,
  )
  assert.ok(match, 'review config must support trusted bases before the tool migration')
  const script = match[1]
    .replace(/^ {10}/gm, '')
    .replace('/etc/opencode/opencode.json', 'result.json')
  const gitExecPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim()
  const bash = process.platform === 'win32' ? resolve(gitExecPath, '../../../bin/bash.exe') : 'bash'
  const directory = await mkdtemp(join(tmpdir(), 'review-config-'))
  try {
    await mkdir(join(directory, '.github/opencode'), { recursive: true })
    await mkdir(join(directory, 'scripts'))
    const base = await readFile('.github/opencode/opencode.json', 'utf8')
    await writeFile(join(directory, '.github/opencode/opencode.json'), base)
    for (const mode of ['absent', 'present', 'broken']) {
      if (mode !== 'absent')
        await writeFile(
          join(directory, 'scripts/opencode-config.mjs'),
          mode === 'present'
            ? await readFile('scripts/opencode-config.mjs', 'utf8')
            : 'throw new Error("fixture failure")',
        )
      // Exercise the workflow shell branches; jq/sudo are external Ubuntu commands.
      const commands = `sudo() { "$@"; }
jq() {
  test "$1" = '.update = "disable"' && test "$2" = '.github/opencode/opencode.json' || return 9
  printf '%s' '{"update":"disable"}'
}
${script}`
      const result = spawnSync(bash, ['-e', '-o', 'pipefail', '-c', commands], {
        cwd: directory,
        encoding: 'utf8',
      })
      if (mode === 'broken') assert.notEqual(result.status, 0)
      else {
        assert.equal(result.status, 0, result.stderr)
        const config = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8'))
        assert.equal(config.update, 'disable')
        assert.equal(Boolean(config.plugins?.length), mode === 'present')
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const pr = {
  number: 9,
  user: { login: 'MeNn13', type: 'User' },
  author_association: 'OWNER',
  head: { sha: 'abc', repo: { full_name: 'o/r' } },
  body: 'Spec #38',
  title: 'Change',
}
test('review starts a fresh CLI session with independent instructions and no publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'independent-review-'))
  try {
    await writeFile(
      join(directory, 'context.json'),
      JSON.stringify({ mode: 'review', head: 'abc' }),
    )
    const loader = join(directory, 'loader.mjs')
    await writeFile(
      loader,
      `
      if (process.argv[1]?.endsWith('run')) {
        let input = ''; for await (const part of process.stdin) input += part;
        if (!input.includes('independent PR review') || !input.includes('publication strictly null') ||
            !process.argv.includes('--standalone') || process.argv.includes('--continue') ||
            process.env.GH_TOKEN) process.exit(3);
        console.log(JSON.stringify({ type: 'tool_use', sessionID: 'review', part: { id: 'reply', tool: 'submit_reply', state: { status: 'completed', input: { version: 1, comment: 'No confirmed defects', publication: null } }, messageID: 'r' } }));
        console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop' } }));
        process.exit(0);
      }
    `,
    )
    const env = {
      ...process.env,
      NODE_OPTIONS: `--import=${pathToFileURL(loader).href}`,
      OPENCODE_BIN: process.execPath,
      OPENCODE_IO: directory,
      OPENCODE_API_KEY: 'fake',
    }
    delete env.GH_TOKEN
    const result = spawnSync(process.execPath, ['scripts/opencode-review.mjs', 'run'], {
      env,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      JSON.parse(await readFile(join(directory, 'reply.json'), 'utf8')).publication,
      null,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('only trusted same-repository humans and explicitly configured apps enter review', () => {
  assert.equal(eligible(pr, 'o/r'), true)
  assert.equal(eligible({ ...pr, head: { repo: { full_name: 'fork/r' } } }, 'o/r'), false)
  assert.equal(eligible({ ...pr, user: { login: 'unknown[bot]', type: 'Bot' } }, 'o/r'), false)
  const bot = { ...pr, user: { login: 'implement[bot]', type: 'Bot', id: 123 } }
  assert.equal(eligible(bot, 'o/r', { login: 'implement[bot]', id: 123 }), true)
  assert.equal(eligible(bot, 'o/r', { login: 'implement[bot]', id: 124 }), false)
})
test('review context includes linked grounds, review discussions, CI and calendar criteria', async () => {
  const api = async (route, accept) => {
    if (route === '/pulls/9') return accept ? 'diff' : pr
    if (route === '/issues/38') return { number: 38, body: 'Approved scope' }
    if (route.includes('check-runs')) return { check_runs: [{ status: 'in_progress' }] }
    if (route.includes('/status')) return { state: 'pending' }
    return []
  }
  const context = await prepareReview(pr, 'o/r', api)
  assert.equal(context.related[0].body, 'Approved scope')
  assert.equal(context.diff, 'diff')
  assert.match(context.criteria, /Europe\/Moscow/)
  assert.match(context.criteria, /атомар/)
  assert.equal(context.checks.check_runs[0].status, 'in_progress')
})
test('publisher rejects publications and stale heads before any write', async () => {
  const writes = []
  const api = async (route) =>
    route === '/pulls/9' ? { ...pr, head: { ...pr.head, sha: 'new' } } : []
  await assert.rejects(
    publishReview(
      { version: 1, comment: 'No defects', publication: null },
      { mode: 'review', number: 9, head: 'abc', repository: 'o/r' },
      api,
      async (...args) => writes.push(args),
      'run',
    ),
  )
  assert.deepEqual(writes, [])
})

test('publisher posts one general review comment for the exact head without code mutations', async () => {
  const writes = []
  const context = { mode: 'review', number: 9, head: 'abc', repository: 'o/r' }
  const api = async (route) => (route === '/pulls/9' ? pr : [])
  const reply = {
    version: 1,
    comment: 'Подтверждённых дефектов нет. Проверки ещё выполняются.',
    publication: null,
  }
  await publishReview(
    reply,
    context,
    api,
    async (...args) => writes.push(args),
    'https://github.com/o/r/actions/runs/1',
  )
  assert.equal(writes.length, 1)
  assert.equal(writes[0][0], 9)
  assert.match(writes[0][1], /Подтверждённых дефектов нет/)
  assert.match(writes[0][1], /independent-review:abc/)
  await assert.rejects(
    publishReview(
      { ...reply, publication: { kind: 'spec' } },
      context,
      api,
      async () => assert.fail('write'),
      'run',
    ),
  )
})
