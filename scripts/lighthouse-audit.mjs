import { createHash } from 'node:crypto'
import { decodeModel } from './implementation-model-output.mjs'

const cloudflareModel = 'cloudflare-workers-ai/@cf/openai/gpt-oss-20b'
const geminiModel = 'google/gemini-3.1-flash-lite'
const fallbackModels = [
  'opencode/hy4-flash-free',
  'opencode/mimo-v2.6-flash-free',
  'opencode/nemotron-3.5-lightning-free',
]
const retryableProviderErrors = new Set([
  'provider.no-route',
  'provider.free-limit',
  'provider.rate-limit',
  'provider.internal',
  'provider.transport',
  'provider.timeout',
])
const otherProviderErrors = new Set([
  'provider.auth',
  'provider.quota',
  'provider.invalid-request',
  'provider.invalid-output',
  'provider.unsupported-operation',
  'permission.rejected',
  'tool.execution',
])

function providerFailure(stdout) {
  for (const line of (stdout ?? '').split(/\r?\n/)) {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event?.type !== 'error') continue
    const { type, name, status, data } = event.error ?? {}
    const category =
      retryableProviderErrors.has(type) || otherProviderErrors.has(type)
        ? type
        : ['AgentNotFoundError', 'StepFailedError', 'APIError', 'ProviderAuthError'].includes(name)
          ? name
          : undefined
    const responseStatus = status ?? data?.statusCode
    return {
      category,
      status:
        Number.isInteger(responseStatus) && responseStatus >= 100 && responseStatus <= 599
          ? responseStatus
          : undefined,
    }
  }
  return {}
}

export function analyzeAuditWithModel(
  primary,
  invoke,
  { cloudflareAvailable = false, geminiAvailable = false, reportFallback = () => {} } = {},
) {
  const models = [
    ...new Set([
      primary,
      ...(cloudflareAvailable ? [cloudflareModel] : []),
      ...(geminiAvailable ? [geminiModel] : []),
      ...fallbackModels,
    ]),
  ]
  for (const model of models) {
    const child = invoke(model)
    try {
      return { model, verdict: decodeModel(child) }
    } catch (error) {
      const { category, status } =
        child.error?.code === 'ETIMEDOUT'
          ? { category: 'provider.timeout' }
          : providerFailure(child.stdout)
      const reason = `${model}: ${category ?? error.message}${status ? ` (HTTP ${status})` : ''}`
      if (
        model === models.at(-1) ||
        !(retryableProviderErrors.has(category) || status === 429 || status >= 500)
      ) {
        throw new Error(reason)
      }
      reportFallback(reason)
    }
  }
}

function parseUrl(value) {
  return typeof value === 'string' && URL.canParse(value) ? new URL(value) : null
}

export function auditUrl(value) {
  const url = parseUrl(value)
  if (
    !url ||
    url.protocol !== 'https:' ||
    url.pathname !== '/book' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error('APP_URL должен быть публичным HTTPS-адресом /book без параметров.')
  return url.href
}

export function trainingReport(url) {
  const id = 'render-blocking-insight'
  return {
    training: true,
    description: 'Учебный отчёт с синтетическим измерением Lighthouse.',
    requestedUrl: url,
    finalDisplayedUrl: url,
    categories: { performance: { score: 0.62, auditRefs: [{ id }] } },
    audits: { [id]: { title: 'Render blocking requests', score: 0, metricSavings: { LCP: 420 } } },
  }
}

export function readAuditReport(report, mode, url) {
  if (!['live', 'training'].includes(mode) || (report?.training === true) !== (mode === 'training'))
    throw new Error('Отчёт не соответствует выбранному режиму аудита.')
  const performance = report?.categories?.performance
  if (
    report?.runtimeError ||
    !Number.isFinite(performance?.score) ||
    performance.score < 0 ||
    performance.score > 1 ||
    !Array.isArray(performance.auditRefs) ||
    !report.audits ||
    parseUrl(report.requestedUrl)?.href !== url ||
    parseUrl(report.finalDisplayedUrl)?.href !== url
  )
    throw new Error('Lighthouse не предоставил отчёт производительности для указанной страницы.')

  const candidates = []
  for (const reference of performance.auditRefs) {
    const id = reference?.id
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) continue
    const audit = report.audits[id]
    if (!Number.isFinite(audit?.score) || audit.score >= 1 || typeof audit.title !== 'string')
      continue
    const measurements = {
      LCP: audit.metricSavings?.LCP,
      FCP: audit.metricSavings?.FCP,
      TBT: audit.metricSavings?.TBT,
      INP: audit.metricSavings?.INP,
      CLS: audit.metricSavings?.CLS,
      ms: audit.details?.overallSavingsMs,
      bytes: audit.details?.overallSavingsBytes ?? audit.details?.debugData?.wastedBytes,
    }
    const savings = Object.fromEntries(
      Object.entries(measurements).filter(([, value]) => Number.isFinite(value) && value > 0),
    )
    if (Object.keys(savings).length) {
      candidates.push({
        id,
        title: audit.title,
        savings,
        ...(typeof audit.description === 'string' && {
          description: audit.description.slice(0, 600),
        }),
      })
    }
  }
  return { mode, url, score: Math.round(performance.score * 100), candidates }
}

function auditText(value, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit)
    throw new Error('OpenCode вернул пустой или слишком длинный текст аудита.')
  return value.trim()
}

export function validateAuditResult(report, result) {
  const summary = auditText(result?.summary, 1000)
  if (result.finding === null) {
    if (report.mode === 'training') throw new Error('OpenCode пропустил учебную находку.')
    return { summary, finding: null }
  }
  const candidate = report.candidates.find(({ id }) => id === result.finding?.id)
  if (!candidate) throw new Error('Выбранная находка отсутствует в отчёте Lighthouse.')
  return {
    summary,
    finding: {
      ...candidate,
      problem: auditText(result.finding.problem, 1000),
      action: auditText(result.finding.action, 1000),
    },
  }
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function plainMarkdown(value) {
  return value
    .replace(/[&<>@]/g, (character) => `&#${character.codePointAt(0)};`)
    .replace(/[\\`*_\[\]#!|~]/g, '\\$&')
    .replace(/\s+/g, ' ')
}

export async function publishAudit(report, result, api, { runUrl, statusIssue }) {
  const { mode, url, score, unavailable } = report
  const training = mode === 'training'
  const { summary, finding } = unavailable
    ? { summary: unavailable, finding: null }
    : validateAuditResult(report, result)
  const introduction = [
    training ? '**Учебный аудит. Измерения синтетические.**' : '**Аудит производительности**',
    url ? `Страница приложения — <${url}>.` : 'Адрес страницы отсутствует или некорректен.',
    ...(unavailable ? [] : [`Lighthouse — ${score}/100.`]),
    ...(unavailable
      ? ['**Нет данных для анализа.**']
      : finding
        ? []
        : ['**Конкретных находок нет.**']),
    plainMarkdown(summary),
    `[Прогон и исходные данные](${runUrl}).`,
  ].join('\n\n')

  if (!finding) {
    if (!Number.isSafeInteger(statusIssue) || statusIssue < 1)
      throw new Error('AUDIT_STATUS_ISSUE должен содержать номер постоянного issue аудита.')
    const state = unavailable ? 'unavailable' : 'no-finding'
    const prefix = `<!-- lighthouse-audit-status:${mode}:`
    const marker = `${prefix}${digest([url, state, unavailable ?? null])} -->`
    const comments = await api.listStatusComments(statusIssue)
    const previous = comments.findLast(
      ({ body, user }) => user?.login === 'github-actions[bot]' && body?.startsWith(prefix),
    )
    if (!previous?.body.startsWith(marker)) {
      await api.createStatusComment(statusIssue, `${marker}\n${introduction}`)
    }
    return introduction
  }

  const marker = `<!-- lighthouse-audit:${digest([mode, url, finding.id])} -->`
  const title = `${training ? '[Учебный аудит]' : '[Lighthouse]'} ${finding.title}`
  const issues = await api.listIssues()
  const pagePath = new URL(url).pathname
  const duplicate = issues.find(({ body = '', title: existingTitle, pull_request }) => {
    if (pull_request) return false
    if (body?.includes(marker)) return true
    if (training || !body || /^\[Учебный аудит\]/iu.test(existingTitle)) return false
    const words = body.split(/[\s<>()\[\]\x60]+/)
    const mentionsPage = words.includes(url) || (pagePath !== '/' && words.includes(pagePath))
    return mentionsPage && (existingTitle === title || words.includes(finding.id))
  })
  const measurements = Object.entries(finding.savings)
    .map(([metric, value]) =>
      metric === 'bytes'
        ? `${value} байт`
        : metric === 'CLS'
          ? `CLS: ${value}`
          : `${metric === 'ms' ? 'Экономия' : metric}: ${value} мс`,
    )
    .join(', ')
  const details = [
    `Проверка Lighthouse — \`${finding.id}\`. Оценка потенциальной экономии — ${measurements}.`,
    `**Проблема**\n${plainMarkdown(finding.problem)}`,
    `**Предлагаемое действие**\n${plainMarkdown(finding.action)}`,
  ].join('\n\n')
  const issue =
    duplicate ??
    (await api.createIssue({
      title: title.slice(0, 250),
      body: `${marker}\n${introduction}\n\n${details}`,
    }))
  const outcome = duplicate ? 'Задача уже есть' : 'Создана задача'
  return `${introduction}\n\n${details}\n\n${outcome} [#${issue.number}](${issue.html_url}).`
}
