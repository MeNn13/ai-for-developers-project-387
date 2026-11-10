import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const allowedUsers = ['MeNn13']
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
    event.comment?.user?.type !== 'User' ||
    !allowedUsers.includes(event.comment.user.login) ||
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
    checkout: process.env.CHECKOUT_SHA,
    title: issue.title,
    body: issue.body,
    comments: earlier,
  }
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

async function github(path, accept = 'application/vnd.github+json') {
  const response = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`,
    {
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: accept },
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!response.ok) throw new WorkflowError(`GitHub returned ${response.status}.`)
  return accept === 'application/vnd.github.diff' ? response.text() : response.json()
}

export function resultComments(stream, runUrl) {
  let message
  let text = ''
  let finished = false
  for (const line of stream.split(/\r?\n/).filter(Boolean)) {
    const event = JSON.parse(line)
    if (event.type === 'error')
      throw new WorkflowError(
        'Model returned an error. Check provider key, availability and limits.',
      )
    if (event.type === 'text') {
      if (event.part.messageID !== message) {
        message = event.part.messageID
        text = ''
      }
      text += event.part.text
      finished = false
    }
    if (event.type === 'step_finish') finished = event.part.reason === 'stop'
  }
  if (!finished || !text.trim()) throw new WorkflowError('No completed model answer.')
  const comments = []
  // Leave room for the attribution and run URL below GitHub's comment limit.
  for (let start = 0; start < text.length; start += 50_000) {
    comments.push(
      `OpenCode · ${model}\n\n${text.slice(start, start + 50_000)}\n\n[Actions](${runUrl})`,
    )
  }
  return comments
}

async function run(directory) {
  if (!process.env.OPENCODE_API_KEY) throw new WorkflowError('OPENCODE_API_KEY is missing.')
  const context = await readFile(join(directory, 'context.json'), 'utf8')
  const prompt = await readFile('.github/opencode/prompt.txt', 'utf8')
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
    child.once('error', reject)
    child.once('close', resolveExit)
  })
  if (status !== 0 || bytes > 2_000_000)
    throw new WorkflowError('OpenCode CLI failed. Check provider key, availability and limits.')
  const runUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  const comments = resultComments(stream, runUrl)
  await writeFile(join(directory, 'reply.json'), JSON.stringify(comments))
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
  main().catch((error) => {
    console.error(
      error instanceof WorkflowError
        ? error.message
        : 'OpenCode workflow failed. Check configuration, model availability and provider limits.',
    )
    process.exitCode = 1
  })
}
