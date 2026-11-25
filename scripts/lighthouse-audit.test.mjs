import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  analyzeAuditWithModel,
  auditUrl,
  publishAudit,
  readAuditReport,
  trainingReport,
  validateAuditResult,
} from './lighthouse-audit.mjs'

const url = 'https://calendar.example.com/book'

test('live audits require an HTTPS URL for the booking page', () => {
  assert.equal(auditUrl(url), url)
  for (const invalid of [
    undefined,
    'http://calendar.example.com/book',
    'https://calendar.example.com/',
    `${url}?preview=1`,
  ]) {
    assert.throws(() => auditUrl(invalid), /APP_URL/)
  }
})

test('retryable failures try the free models in order and return the first verdict', () => {
  const requested = []
  const verdict = { summary: 'Конкретных находок нет.', finding: null }
  const part = { sessionID: 'session', messageID: 'message' }
  const stream = [
    { type: 'text', sessionID: 'session', part: { ...part, text: JSON.stringify(verdict) } },
    { type: 'step_finish', sessionID: 'session', part: { ...part, reason: 'stop' } },
  ]
    .map(JSON.stringify)
    .join('\n')
  const result = analyzeAuditWithModel('opencode/deepseek-v4.1-flash-free', (model) => {
    requested.push(model)
    if (model === 'opencode/mimo-v2.6-flash-free') return { error: { code: 'ETIMEDOUT' } }
    if (model !== 'opencode/nemotron-3.5-lightning-free')
      return {
        status: 1,
        stdout: '{"type":"error","error":{"type":"provider.free-limit","status":429}}',
      }
    return { status: 0, stdout: stream }
  })
  assert.deepEqual(result, { model: 'opencode/nemotron-3.5-lightning-free', verdict })
  assert.deepEqual(requested, [
    'opencode/deepseek-v4.1-flash-free',
    'opencode/hy4-flash-free',
    'opencode/mimo-v2.6-flash-free',
    'opencode/nemotron-3.5-lightning-free',
  ])

  requested.length = 0
  const gemini = 'google/gemini-3.1-flash-lite'
  const withGemini = analyzeAuditWithModel(
    'opencode/deepseek-v4.1-flash-free',
    (model) => {
      requested.push(model)
      return model === gemini
        ? { status: 0, stdout: stream }
        : { status: 1, stdout: '{"type":"error","error":{"type":"provider.free-limit"}}' }
    },
    { geminiAvailable: true },
  )
  assert.deepEqual(withGemini, { model: gemini, verdict })
  assert.deepEqual(requested, ['opencode/deepseek-v4.1-flash-free', gemini])

  requested.length = 0
  const cloudflare = 'cloudflare-workers-ai/@cf/openai/gpt-oss-20b'
  const withCloudflare = analyzeAuditWithModel(
    'opencode/deepseek-v4.1-flash-free',
    (model) => {
      requested.push(model)
      return model === cloudflare
        ? { status: 0, stdout: stream }
        : { status: 1, stdout: '{"type":"error","error":{"type":"provider.free-limit"}}' }
    },
    { cloudflareAvailable: true, geminiAvailable: true },
  )
  assert.deepEqual(withCloudflare, { model: cloudflare, verdict })
  assert.deepEqual(requested, ['opencode/deepseek-v4.1-flash-free', cloudflare])
})

test('the repeatable training report identifies its source and provides one measured candidate', () => {
  const report = trainingReport(url)
  assert.equal(report.training, true)
  assert.deepEqual(readAuditReport(report, 'training', url), {
    mode: 'training',
    url,
    score: 62,
    candidates: [
      { id: 'render-blocking-insight', title: 'Render blocking requests', savings: { LCP: 420 } },
    ],
  })
  assert.throws(() => readAuditReport(report, 'live', url), /режим/)
})

test('the agent must select evidence from the report', () => {
  const report = readAuditReport(trainingReport(url), 'training', url)
  const result = {
    summary: 'Есть измерение.',
    finding: {
      id: 'render-blocking-insight',
      problem: 'Блокировка отрисовки.',
      action: 'Отложить загрузку ресурса.',
    },
  }
  assert.throws(
    () =>
      validateAuditResult(report, { ...result, finding: { ...result.finding, id: 'invented' } }),
    /отчёте/,
  )
  assert.deepEqual(validateAuditResult(report, result).finding.savings, { LCP: 420 })
  assert.throws(() => validateAuditResult(report, { ...result, finding: null }), /учебную находку/)
})

test('a live image insight keeps its measured byte savings and matches a manually filed issue', async () => {
  const auditId = 'image-delivery-insight'
  const report = readAuditReport(
    {
      ...trainingReport(url),
      training: false,
      categories: { performance: { score: 0.62, auditRefs: [{ id: auditId }] } },
      audits: {
        [auditId]: {
          title: 'Improve image delivery',
          score: 0,
          details: { debugData: { wastedBytes: 4096 } },
        },
      },
    },
    'live',
    url,
  )
  const result = {
    summary: 'Есть измерение.',
    finding: {
      id: auditId,
      problem: 'Лишние байты изображений.',
      action: 'Уменьшить размер изображений.',
    },
  }
  const api = {
    listIssues: async () => [
      {
        title: 'Уменьшить изображения',
        body: 'Проверка image-delivery-insight на /book',
        number: 2,
        html_url: 'https://github.com/example/calendar/issues/2',
      },
    ],
  }
  const output = await publishAudit(report, result, api, {
    runUrl: 'https://github.com/example/calendar/actions/runs/1',
  })
  assert.match(output, /4096 байт/)
  assert.match(output, /уже есть.*issues\/2/)
})

test('publishing the same report twice links to the original issue even after closure', async () => {
  const report = readAuditReport(trainingReport(url), 'training', url)
  const result = {
    summary: 'Есть измерение.',
    finding: {
      id: 'render-blocking-insight',
      problem: 'Блокировка отрисовки.',
      action: 'Отложить загрузку ресурса.',
    },
  }
  const issues = []
  const api = {
    listIssues: async () => issues,
    createIssue: async (fields) => {
      const issue = {
        ...fields,
        number: 48,
        html_url: 'https://github.com/example/calendar/issues/48',
      }
      issues.push(issue)
      return issue
    },
  }
  const workflow = { runUrl: 'https://github.com/example/calendar/actions/runs/1', statusIssue: 12 }
  assert.match(await publishAudit(report, result, api, workflow), /Создана задача/)
  assert.match(issues[0].title, /Учебный/)
  assert.match(issues[0].body, /LCP: 420 мс/)
  assert.ok(issues[0].body.includes(workflow.runUrl))
  issues[0].state = 'closed'
  assert.match(
    await publishAudit(report, result, api, { ...workflow, runUrl: workflow.runUrl + '2' }),
    /уже есть.*issues\/48/,
  )
  assert.equal(issues.length, 1)
})

test('a failed collection publishes a distinct status without creating a finding or repeating a comment', async () => {
  const report = readAuditReport(
    {
      ...trainingReport(url),
      training: false,
      audits: {},
    },
    'live',
    url,
  )
  assert.deepEqual(report.candidates, [])
  assert.throws(
    () => readAuditReport({ runtimeError: { code: 'NO_FCP' } }, 'live', url),
    /не предоставил отчёт/,
  )

  const comments = []
  const api = {
    listStatusComments: async () => comments,
    createStatusComment: async (number, body) => {
      assert.equal(number, 12)
      comments.push({ body, user: { login: 'github-actions[bot]' } })
    },
  }
  const run = { runUrl: 'https://github.com/example/calendar/actions/runs/3', statusIssue: 12 }
  await publishAudit(report, { summary: 'Конкретных находок нет.', finding: null }, api, run)
  const failure = { mode: 'live', url, unavailable: 'Страница недоступна из GitHub Actions.' }
  await publishAudit(failure, null, api, run)
  await publishAudit(failure, null, api, run)
  assert.equal(comments.length, 2)
  assert.match(comments[0].body, /Конкретных находок нет/)
  assert.match(comments[1].body, /Страница недоступна/)
})
