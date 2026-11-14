import assert from 'node:assert/strict'
import test from 'node:test'
import { publish } from './opencode-publish.mjs'
import { diagnosticFor, failureNotice } from './opencode-diagnostic.mjs'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

test('publication diagnostic parsing rejects unknown data and bounds safe output', () => {
  const diagnostic = {
    version: 3,
    code: 'publication',
    stage: 'publish',
    details: { reason: 'github_write', state: 'possible' },
  }
  assert.ok(Buffer.byteLength(JSON.stringify(diagnostic)) <= 1024)
  for (const bad of [
    { ...diagnostic, version: 1 },
    { ...diagnostic, extra: 'fake-secret' },
    { ...diagnostic, details: { ...diagnostic.details, status: 'fake-secret' } },
    { ...diagnostic, details: { ...diagnostic.details, reason: 'fake-secret' } },
    { ...diagnostic, details: { ...diagnostic.details, state: 'fake-secret' } },
  ]) {
    assert.match(failureNotice(bad, 'run'), /При частичной публикации/)
    assert.doesNotMatch(failureNotice(bad, 'run'), /fake-secret|Публикация не начиналась/)
  }
})

test('recovery preflight never hides previous publication when new writes are blocked', async () => {
  const fixture = githubFixture()
  await publish(reply, context, fixture.api, 'run')
  const count = fixture.calls.filter((call) => call.method === 'POST').length
  const changed = structuredClone(reply)
  changed.publication.items[0].body = 'Changed'
  for (const [input, source, api, reason, state] of [
    [changed, context, fixture.api, 'changed_payload', 'possible'],
    [
      ticketReply(),
      {
        ...context,
        related: [{ number: 8 }],
        comments: [{ ...context.comments[0], user: { login: 'MeNn13', type: 'User' } }],
      },
      fixture.api,
      'changed_payload',
      'possible',
    ],
    [reply, { ...context, comments: [] }, fixture.api, 'trusted_request', 'unknown'],
    [
      reply,
      context,
      async () => {
        throw new Error('fake-secret')
      },
      'configuration',
      'unknown',
    ],
  ]) {
    await assert.rejects(publish(input, source, api, 'run'), (error) => {
      const diagnostic = diagnosticFor(error)
      assert.deepEqual(diagnostic.details, { reason, state })
      assert.match(failureNotice(diagnostic, 'run'), /могла начаться/)
      assert.doesNotMatch(failureNotice(diagnostic, 'run'), /Публикация не начиналась|fake-secret/)
      return true
    })
  }
  assert.equal(fixture.calls.filter((call) => call.method === 'POST').length, count)
})

test('workflow reports publication failures safely and keeps the run failed', async () => {
  const workflow = await readFile('.github/workflows/opencode.yml', 'utf8')
  const source = workflow
    .split('          script: |\n')[1]
    .split('\n  publish-triage:')[0]
    .split('\n')
    .map((line) => line.slice(12))
    .join('\n')
  const directory = await mkdtemp(join(tmpdir(), 'opencode-publish-workflow-'))
  const before = { temp: process.env.RUNNER_TEMP, result: process.env.ANSWER_RESULT }
  try {
    process.env.RUNNER_TEMP = directory
    process.env.ANSWER_RESULT = 'success'
    await mkdir(join(directory, 'opencode-context'))
    await mkdir(join(directory, 'opencode-reply'))
    await writeFile(join(directory, 'opencode-context/context.json'), JSON.stringify(context))
    await writeFile(join(directory, 'opencode-reply/reply.json'), JSON.stringify(reply))
    const fixture = githubFixture()
    const comments = [],
      failures = []
    const execute = new (Object.getPrototypeOf(async function () {}).constructor)(
      'require',
      'context',
      'github',
      'core',
      source,
    )
    await execute(
      createRequire(import.meta.url),
      {
        repo: { owner: 'MeNn13', repo: 'ai-for-developers-project-387' },
        runId: 1,
        eventName: 'issue_comment',
        payload: { issue: { number: 9 }, comment: { id: 40 } },
      },
      {
        request: async (route, data) => {
          const [method, path] = route.split(' /repos/{owner}/{repo}')
          const result = await fixture.api(method, path, data)
          if (method === 'POST') throw new Error('fake-secret GitHub body')
          return { data: result }
        },
        rest: { issues: { createComment: async (comment) => comments.push(comment) } },
      },
      { setFailed: (message) => failures.push(message) },
    )
    assert.equal(failures.length, 1)
    assert.equal(comments.length, 1)
    assert.match(comments[0].body, /GitHub не подтвердил операцию записи.*могла начаться/)
    assert.doesNotMatch(JSON.stringify(comments) + JSON.stringify(failures), /fake-secret/)
    assert.equal(fixture.issues.length, 1)
  } finally {
    if (before.temp === undefined) delete process.env.RUNNER_TEMP
    else process.env.RUNNER_TEMP = before.temp
    if (before.result === undefined) delete process.env.ANSWER_RESULT
    else process.env.ANSWER_RESULT = before.result
    await rm(directory, { recursive: true, force: true })
  }
})

test('a lost first write result reports possible publication and resumes without duplication', async () => {
  const fixture = githubFixture()
  let fail = true
  const uncertain = async (method, path, data) => {
    const result = await fixture.api(method, path, data)
    if (method === 'POST' && fail) {
      fail = false
      throw new Error('fake-secret response body')
    }
    return result
  }
  await assert.rejects(publish(reply, context, uncertain, 'run'), (error) => {
    assert.deepEqual(diagnosticFor(error), {
      version: 3,
      code: 'publication',
      stage: 'publish',
      details: { reason: 'github_write', state: 'possible' },
    })
    assert.match(failureNotice(diagnosticFor(error), 'run'), /могла начаться/)
    assert.doesNotMatch(JSON.stringify(error), /fake-secret/)
    return true
  })
  await publish(reply, context, fixture.api, 'run')
  assert.equal(fixture.issues.length, 1)
  assert.equal(fixture.comments.length, 1)
})

const hasReason = (reason) => (error) => {
  assert.equal(diagnosticFor(error).details.reason, reason)
  assert.doesNotMatch(JSON.stringify(error), /fake-secret|GitHub unavailable|Label missing/)
  return true
}

const context = {
  number: 9,
  requestId: 40,
  repository: 'MeNn13/ai-for-developers-project-387',
  comments: [{ id: 40, user: { login: 'MeNn13', type: 'User' }, body: '/oc apply to-spec' }],
  related: [],
}
const reply = {
  version: 1,
  comment: 'Спецификация подготовлена.',
  publication: {
    kind: 'spec',
    items: [
      {
        key: 'spec',
        title: 'Мобильное бронирование',
        body: 'Сценарии и тестирование.',
        blockedBy: [],
      },
    ],
  },
}

function githubFixture() {
  const issues = []
  const comments = []
  const children = new Map()
  const blockers = new Map()
  const calls = []
  const api = async (method, path, data) => {
    calls.push({ method, path, data })
    if (method === 'GET') {
      if (path.startsWith('/issues?')) return issues
      if (path.includes('/comments?'))
        return comments.filter((comment) => comment.issue === Number(path.split('/')[2]))
      if (path.includes('/sub_issues?')) return children.get(Number(path.split('/')[2])) ?? []
      if (path.includes('/dependencies/blocked_by?'))
        return blockers.get(Number(path.split('/')[2])) ?? []
      if (path.startsWith('/labels/')) return { name: 'ready-for-agent' }
      if (path === '/issues/9') return { number: 9, body: '', user: { login: 'MeNn13' } }
      return issues.find((issue) => issue.number === Number(path.split('/')[2]))
    }
    if (path === '/issues') {
      const number = issues.length + 10
      const issue = {
        ...data,
        id: number + 100,
        number,
        user: { login: 'github-actions[bot]', type: 'Bot' },
      }
      issues.push(issue)
      return issue
    }
    if (path.endsWith('/comments')) {
      const comment = {
        ...data,
        issue: Number(path.split('/')[2]),
        id: comments.length + 100,
        user: { login: 'github-actions[bot]', type: 'Bot' },
      }
      comments.push(comment)
      return comment
    }
    if (path.endsWith('/sub_issues') || path.endsWith('/dependencies/blocked_by')) {
      const map = path.endsWith('/sub_issues') ? children : blockers
      const number = Number(path.split('/')[2])
      map.set(number, [
        ...(map.get(number) ?? []),
        issues.find((issue) => issue.id === (data.sub_issue_id ?? data.issue_id)),
      ])
      return {}
    }
    assert.fail(`Unexpected ${method} ${path}`)
  }
  return { api, issues, comments, children, blockers, calls }
}

test('publishes a ready specification with backlinks and retries without duplicates', async () => {
  const fixture = githubFixture()
  await publish(reply, context, fixture.api, 'https://example.com/run')
  await publish(reply, context, fixture.api, 'https://example.com/run')
  assert.equal(fixture.issues.length, 1)
  assert.deepEqual(fixture.issues[0].labels, ['ready-for-agent'])
  assert.match(fixture.issues[0].body, /issues\/9#issuecomment-40/)
  assert.match(fixture.comments[0].body, /issues\/10/)
  assert.equal(fixture.comments.length, 1)
})

function ticketReply() {
  return {
    version: 1,
    comment: 'Тикеты опубликованы.',
    publication: {
      kind: 'tickets',
      spec: 8,
      approvalComment: 40,
      items: [
        {
          key: 'owner',
          title: 'Встречи владельца на телефоне',
          body: 'Критерии владельца.',
          blockedBy: [],
        },
        {
          key: 'guest',
          title: 'Бронирование на телефоне',
          body: 'Критерии гостя.',
          blockedBy: ['owner'],
        },
      ],
    },
  }
}

test('creates approved tickets as specification children with native blockers and a source index', async () => {
  const fixture = githubFixture()
  const source = { ...context, related: [{ number: 8, title: 'Specification' }] }
  await publish(ticketReply(), source, fixture.api, 'https://example.com/run')
  assert.equal(fixture.issues.length, 2)
  assert.deepEqual(
    fixture.children.get(8).map((issue) => issue.number),
    [10, 11],
  )
  assert.deepEqual(
    fixture.blockers.get(11).map((issue) => issue.number),
    [10],
  )
  assert.match(fixture.issues[1].body, /Спецификация: .*\/8/)
  assert.match(fixture.issues[1].body, /Согласование разбиения: .*\/9#issuecomment-40/)
  assert.equal(fixture.comments.length, 2)
  assert.ok(fixture.calls.every((call) => !['PATCH', 'DELETE'].includes(call.method)))
})

test('resumes after a dependency failure without duplicating issues, children or comments', async () => {
  const fixture = githubFixture()
  const source = { ...context, related: [{ number: 8 }] }
  const flaky = async (...args) => {
    if (args[0] === 'POST' && args[1].endsWith('/dependencies/blocked_by'))
      throw new Error('GitHub unavailable')
    return fixture.api(...args)
  }
  await assert.rejects(publish(ticketReply(), source, flaky, 'run'), hasReason('github_write'))
  assert.equal(fixture.issues.length, 2)
  assert.equal(fixture.comments.length, 0)
  await publish(ticketReply(), source, fixture.api, 'run')
  await publish(ticketReply(), source, fixture.api, 'run')
  assert.equal(fixture.issues.length, 2)
  assert.equal(fixture.children.get(8).length, 2)
  assert.equal(fixture.blockers.get(11).length, 1)
  assert.equal(fixture.comments.length, 2)
})

test('rejects malformed publications, cycles, unknown specifications and absent trusted approval before writes', async () => {
  const cyclic = ticketReply()
  cyclic.publication.items[0].blockedBy = ['guest']
  const badReplies = [
    { version: 1, comment: '' },
    { ...reply, publication: { kind: 'close', items: [] } },
    cyclic,
    { ...ticketReply(), publication: { ...ticketReply().publication, approvalComment: 999 } },
    ticketReply(),
  ]
  for (const result of badReplies) {
    const fixture = githubFixture()
    await assert.rejects(publish(result, context, fixture.api, 'run'), /publication/)
    assert.equal(fixture.calls.filter((call) => call.method !== 'GET').length, 0)
  }
  const fixture = githubFixture()
  await assert.rejects(
    publish(reply, { ...context, pr: {} }, fixture.api, 'run'),
    hasReason('issue_only'),
  )
  await assert.rejects(
    publish(reply, { ...context, comments: [] }, fixture.api, 'run'),
    hasReason('trusted_request'),
  )
})

test('changed payload on retry fails without creating more issues', async () => {
  const fixture = githubFixture()
  await publish(reply, context, fixture.api, 'run')
  const changed = structuredClone(reply)
  changed.publication.items[0].title = 'Changed'
  await assert.rejects(publish(changed, context, fixture.api, 'run'), hasReason('changed_payload'))
  changed.publication.items[0].key = 'replacement'
  await assert.rejects(publish(changed, context, fixture.api, 'run'), hasReason('changed_payload'))
  assert.equal(fixture.issues.length, 1)
})

test('approval must exist and belong to a trusted human even when the specification is known', async () => {
  for (const approval of [
    { id: 41, user: { login: 'MeNn13', type: 'User' } },
    { id: 39, user: { login: 'stranger', type: 'User' } },
    { id: 39, user: { login: 'github-actions[bot]', type: 'Bot' } },
  ]) {
    const fixture = githubFixture()
    const input = ticketReply()
    input.publication.approvalComment = approval.id
    await assert.rejects(
      publish(
        input,
        { ...context, related: [{ number: 8 }], comments: [...context.comments, approval] },
        fixture.api,
        'run',
      ),
      hasReason('approval'),
    )
    assert.equal(fixture.calls.length, 0)
  }
})

test('long answers are bounded and retry markers cannot be spoofed by a human comment', async () => {
  const fixture = githubFixture()
  fixture.comments.push({
    issue: 9,
    body: '<!-- opencode:9:40:reply:0 -->',
    user: { login: 'stranger', type: 'User' },
  })
  await publish({ version: 1, comment: 'Answer '.repeat(12_000) }, context, fixture.api, 'run')
  assert.equal(fixture.comments.length, 3)
  assert.ok(fixture.comments.slice(1).every((comment) => comment.body.length < 60_000))
})

test('missing label fails before creation; ordinary discussion preserves leading triage disclaimer', async () => {
  const fixture = githubFixture()
  await assert.rejects(
    publish(
      reply,
      context,
      async () => {
        throw new Error('Label missing')
      },
      'run',
    ),
    hasReason('configuration'),
  )
  const comment = '> *This was generated by AI during triage.*\n\nУточните ширину экрана.'
  await publish({ version: 1, comment }, context, fixture.api, 'run')
  assert.equal(fixture.issues.length, 0)
  assert.ok(fixture.comments[0].body.startsWith(comment))
})
