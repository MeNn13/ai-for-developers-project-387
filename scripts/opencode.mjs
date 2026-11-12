import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { trustedHuman, validateReply } from './opencode-publish.mjs'
import { DiagnosticError, diagnosticFor } from './opencode-diagnostic.mjs'

const model = 'opencode/glm-5.3-flash-free'

// Only deliberate internal diagnostics may be printed in public logs.
class WorkflowError extends Error {}

async function pages(api, path) {
  const items = []
  for (let page = 1; page <= 100; page++) {
    const batch = await api(`${path}?per_page=100&page=${page}`)
    items.push(...batch)
    if (batch.length < 100) return items
  }
  throw new WorkflowError('Discussion is too large to read completely.')
}

export async function prepare(eventName, event, api) {
  if (
    !['issue_comment', 'pull_request_review_comment'].includes(eventName) ||
    event.action !== 'created' ||
    !trustedHuman(event.comment ?? {}) ||
    !/^\s*\/(?:oc|opencode)(?=\s|$)/i.test(event.comment.body ?? '')
  )
    return null

  const number = event.issue?.number ?? event.pull_request?.number
  if (!Number.isSafeInteger(number) || number < 1) throw new WorkflowError('Invalid issue number.')
  const issue = await api(`/issues/${number}`)
  const isPr = Boolean(event.issue?.pull_request || event.pull_request)
  const pr = isPr ? await api(`/pulls/${number}`) : null
  if (pr && pr.head?.repo?.full_name !== event.repository.full_name) return null

  const comments = await pages(api, `/issues/${number}/comments`)
  const earlier = comments.filter((comment) =>
    eventName === 'issue_comment'
      ? comment.id <= event.comment.id
      : comment.created_at <= event.comment.created_at,
  )
  const context = {
    number,
    repository: event.repository.full_name,
    requestId: event.comment.id,
    checkout: process.env.CHECKOUT_SHA,
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
    comments: earlier,
  }
  if (!isPr) context.related = await relatedIssues(context, event.repository.full_name, api)
  if (pr) {
    context.pr = { base: pr.base.sha, head: pr.head.sha }
    context.diff = await api(`/pulls/${number}`, 'application/vnd.github.diff')
  }
  if (eventName === 'pull_request_review_comment') {
    const reviews = await pages(api, `/pulls/${number}/comments`)
    const root = event.comment.in_reply_to_id ?? event.comment.id
    context.thread = reviews.filter(
      (comment) =>
        (comment.id === root || comment.in_reply_to_id === root) && comment.id <= event.comment.id,
    )
    context.line = {
      path: event.comment.path,
      diff: event.comment.diff_hunk,
      commit: event.comment.commit_id,
    }
  }
  context.request = event.comment.body
  const serialized = JSON.stringify(context)
  if (Buffer.byteLength(serialized) > 300_000)
    throw new WorkflowError('Context exceeds 300 KB; narrow the request.')
  return { number, context: serialized }
}

async function relatedIssues(source, repository, api) {
  const seen = new Set([source.number])
  const related = []
  let frontier = [source]
  for (let depth = 0; depth < 2; depth++) {
    const next = []
    for (const issue of frontier) {
      const text = [issue.body, ...issue.comments.map((comment) => comment.body)].join('\n')
      // Remove foreign URLs before matching bare #number references.
      const local = text.replace(/https?:\/\/[^\s)<>]+/g, (url) => {
        const match = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/)
        return match?.[1] === repository ? ` #${match[2]} ` : ''
      })
      for (const match of local.matchAll(/(?:^|[^\w/])#([1-9]\d*)\b/g)) {
        const number = Number(match[1])
        if (!Number.isSafeInteger(number) || seen.has(number)) continue
        seen.add(number)
        if (seen.size > 31)
          throw new WorkflowError('Too many linked issues; narrow the discussion.')
        let linked
        let comments
        try {
          linked = await api(`/issues/${number}`)
          comments = await pages(api, `/issues/${number}/comments`)
        } catch (error) {
          if (![403, 404, 410].includes(error.status)) throw error
          related.push({ number, unavailable: true })
          continue
        }
        const entry = {
          number,
          title: linked.title,
          body: linked.body,
          labels: linked.labels,
          comments,
          pr: Boolean(linked.pull_request),
        }
        related.push(entry)
        next.push(entry)
      }
    }
    frontier = next
  }
  return related
}

async function github(path, accept = 'application/vnd.github+json') {
  const response = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`,
    {
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: accept },
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!response.ok)
    throw Object.assign(new WorkflowError(`GitHub returned ${response.status}.`), {
      status: response.status,
    })
  return accept === 'application/vnd.github.diff' ? response.text() : response.json()
}

function resultText(stream) {
  let eventCount = 0
  let textEventCount = 0
  let finalTextEventCount = 0
  const messages = new Set()
  let message
  let text = ''
  let finished = false
  for (const line of stream.split(/\r?\n/).filter(Boolean)) {
    let event
    try {
      event = JSON.parse(line)
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') throw new Error()
      if (
        event.type === 'text' &&
        (typeof event.part?.text !== 'string' || typeof event.part?.messageID !== 'string')
      )
        throw new Error()
      if (event.type === 'step_finish' && typeof event.part?.reason !== 'string') throw new Error()
    } catch {
      throw new DiagnosticError('stream_json')
    }
    eventCount++
    if (event.type === 'error')
      throw new DiagnosticError(
        [401, 403].includes(event.error?.data?.statusCode)
          ? 'provider_auth'
          : event.error?.data?.statusCode === 429
            ? 'provider_rate'
            : 'provider_error',
      )
    if (event.type === 'text') {
      textEventCount++
      messages.add(event.part.messageID)
      if (event.part.messageID !== message) {
        message = event.part.messageID
        text = ''
        finalTextEventCount = 0
      }
      text += event.part.text
      finalTextEventCount++
      finished = false
    }
    if (event.type === 'step_finish') finished = event.part.reason === 'stop'
  }
  if (!finished || !text.trim()) throw new DiagnosticError('incomplete')
  return {
    text,
    counters: {
      streamBytes: Buffer.byteLength(stream),
      eventCount,
      textEventCount,
      messageCount: messages.size,
      finalTextEventCount,
    },
  }
}

export function resultReply(stream) {
  const result = resultText(stream)
  const text = result.text.trim()
  const fence = text.match(/^```(?:json)?\r?\n([\s\S]*?)\r?\n```$/)
  const candidate = fence ? fence[1] : text
  let reply
  try {
    reply = JSON.parse(candidate)
  } catch (error) {
    const message = error.message
    const parseKind =
      /^(?:Unexpected end of JSON input|Unterminated string in JSON at position \d+)/.test(message)
        ? 'unexpected_end'
        : /^Unexpected non-whitespace character after JSON at position \d+/.test(message)
          ? 'trailing_content'
          : /^Bad (?:escaped character|Unicode escape) in JSON at position \d+/.test(message)
            ? 'invalid_escape'
            : /^Bad control character in string literal in JSON at position \d+/.test(message)
              ? 'invalid_control'
              : 'syntax_other'
    const position = Number(
      message.match(/ at position (\d+)(?: \(line \d+ column \d+\))?$/)?.[1] ?? NaN,
    )
    const first = candidate.trimStart()[0]
    throw new DiagnosticError('reply_json', {
      ...result.counters,
      answerBytes: Buffer.byteLength(text),
      candidateChars: candidate.length,
      wrapper: fence
        ? text.startsWith('```json')
          ? 'json_fence'
          : 'bare_fence'
        : text.startsWith('```')
          ? 'other_fence'
          : 'none',
      root: first === '{' ? 'object' : first === '[' ? 'array' : first ? 'other' : 'empty',
      parseKind,
      position:
        Number.isSafeInteger(position) && position >= 0 && position <= candidate.length
          ? position
          : null,
    })
  }
  try {
    validateReply(reply)
  } catch {
    throw new DiagnosticError('reply_schema')
  }
  return reply
}

async function run(directory) {
  if (!process.env.OPENCODE_API_KEY) throw new DiagnosticError('configuration')
  let context, prompt
  try {
    context = await readFile(join(directory, 'context.json'), 'utf8')
    prompt = await readFile('.github/opencode/prompt.txt', 'utf8')
  } catch {
    throw new DiagnosticError('file_read')
  }
  const child = spawn(
    process.env.OPENCODE_BIN ?? 'opencode',
    [
      'run',
      '--standalone',
      '--format',
      'json',
      '--agent',
      'discussion',
      '--model',
      model,
      '--title',
      'GitHub discussion',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  child.stdin.on('error', () => {})
  child.stdin.end(`${prompt}\n\nUntrusted GitHub context (JSON):\n${context}`)
  let stream = ''
  let bytes = 0
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (data) => {
    bytes += Buffer.byteLength(data)
    if (bytes > 2_000_000) child.kill()
    else stream += data.toString('utf8')
  })
  // Provider output can contain request context; do not copy it to public logs.
  child.stderr.resume()
  const status = await new Promise((resolveExit, reject) => {
    child.once('error', () => reject(new DiagnosticError('cli_start')))
    child.once('close', resolveExit)
  })
  if (bytes > 2_000_000) throw new DiagnosticError('stream_limit')
  if (status !== 0) throw new DiagnosticError('cli_exit')
  const reply = resultReply(stream)
  try {
    await writeFile(join(directory, 'reply.json'), JSON.stringify(reply))
  } catch {
    throw new DiagnosticError('file_write')
  }
}

async function main() {
  const directory = process.env.OPENCODE_IO
  if (!directory) throw new WorkflowError('OPENCODE_IO is required.')
  if (process.argv[2] === 'prepare') {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
    const prepared = await prepare(process.env.GITHUB_EVENT_NAME, event, github)
    await appendFile(process.env.GITHUB_OUTPUT, `allowed=${Boolean(prepared)}\n`)
    if (!prepared) return
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'context.json'), prepared.context)
  } else if (process.argv[2] === 'run') {
    await run(directory)
  } else {
    throw new WorkflowError('Unknown command.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(async (error) => {
    const diagnostic = diagnosticFor(error)
    console.error(JSON.stringify(diagnostic))
    if (process.env.OPENCODE_IO) {
      try {
        await writeFile(
          join(process.env.OPENCODE_IO, 'diagnostic.json'),
          JSON.stringify(diagnostic),
        )
      } catch {
        console.error(JSON.stringify(diagnosticFor(new DiagnosticError('file_write'))))
      }
    }
    process.exitCode = 1
  })
}
