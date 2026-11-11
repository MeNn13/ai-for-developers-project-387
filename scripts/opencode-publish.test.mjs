import assert from 'node:assert/strict'
import test from 'node:test'
import { publish } from './opencode-publish.mjs'

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
  await assert.rejects(publish(ticketReply(), source, flaky, 'run'), /unavailable/)
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
    await assert.rejects(publish(result, context, fixture.api, 'run'), /Invalid/)
    assert.equal(fixture.calls.filter((call) => call.method !== 'GET').length, 0)
  }
  const fixture = githubFixture()
  await assert.rejects(
    publish(reply, { ...context, pr: {} }, fixture.api, 'run'),
    /only available in issues/,
  )
  await assert.rejects(
    publish(reply, { ...context, comments: [] }, fixture.api, 'run'),
    /trusted request/,
  )
})

test('changed payload on retry fails without creating more issues', async () => {
  const fixture = githubFixture()
  await publish(reply, context, fixture.api, 'run')
  const changed = structuredClone(reply)
  changed.publication.items[0].title = 'Changed'
  await assert.rejects(publish(changed, context, fixture.api, 'run'), /rerun changed/)
  changed.publication.items[0].key = 'replacement'
  await assert.rejects(publish(changed, context, fixture.api, 'run'), /rerun changed/)
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
      /trusted approval/,
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
    /Label missing/,
  )
  const comment = '> *This was generated by AI during triage.*\n\nУточните ширину экрана.'
  await publish({ version: 1, comment }, context, fixture.api, 'run')
  assert.equal(fixture.issues.length, 0)
  assert.ok(fixture.comments[0].body.startsWith(comment))
})
