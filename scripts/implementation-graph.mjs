import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import config from '../.github/opencode/opencode.json' with { type: 'json' }
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { decodeModel, ImplementationFailure } from './implementation-model-output.mjs'
import {
  InvalidResult,
  resultInstructions,
  validateChanges,
  validateExistingDocuments,
  validateReview,
} from './implementation-result.mjs'

const phase = ['first', 'final'].includes(process.argv[2]) ? process.argv[2] : 'unknown'
let activeTicket = 'none'
let reviewAxis
let operation = 'preflight'
let checkedSha
const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const requireValue = (ok) => {
  if (!ok) throw new Error('initial_graph_failed')
}
const trustedRoot = resolve(import.meta.dirname, '..')
const root = process.env.INITIAL_CANDIDATE_ROOT
const directory = process.env.INITIAL_IO
const read = async (name) => JSON.parse(await readFile(`${directory}/${name}.json`, 'utf8'))
const write = (name, value) => writeFile(`${directory}/${name}.json`, JSON.stringify(value))
function command(bin, args, options = {}, modelCall = false, onFailure) {
  const timeout = options.timeout
  // GNU timeout controls the process group, including model/check descendants.
  const bounded = process.platform === 'linux' && Number.isFinite(timeout)
  const child = spawnSync(
    bounded ? 'timeout' : bin,
    bounded
      ? [
          '--signal=TERM',
          '--kill-after=10s',
          `${Math.max(1, Math.floor(timeout / 1000))}s`,
          bin,
          ...args,
        ]
      : args,
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 2_000_000,
      ...options,
      ...(bounded ? { timeout: timeout + 15000 } : {}),
    },
  )
  if ((bounded && [124, 137].includes(child.status)) || child.error?.code === 'ETIMEDOUT')
    throw new ImplementationFailure('timeout')
  if (modelCall) return decodeModel(child, bounded)
  if (child.status !== 0 && onFailure) throw onFailure(child)
  requireValue(child.status === 0)
  return child.stdout?.trim()
}
const git = (args, options) => command('git', args, options)
function remaining(context) {
  const ms = context.deadline - Date.now()
  if (ms <= 0) throw new ImplementationFailure('timeout')
  return ms
}
function clean() {
  requireValue(git(['status', '--porcelain', '--untracked-files=no']) === '')
}
function checked(context) {
  operation = 'check'
  checkedSha = git(['rev-parse', 'HEAD'])
  requireValue(/^[a-f0-9]{40}$/.test(checkedSha))
  command(
    process.execPath,
    [resolve(trustedRoot, 'scripts/implementation-sandbox.mjs')],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: remaining(context),
      env: { ...process.env, REPAIR_CANDIDATE_ROOT: root, OPENCODE_API_KEY: '', GH_TOKEN: '' },
    },
    false,
    (child) => {
      if (child.status === 124) return new ImplementationFailure('timeout')
      const detail = child.stdout?.trim()
      return new ImplementationFailure(
        detail === 'check_definition' || /^task_failed task=[a-z][a-z0-9:-]*$/.test(detail)
          ? detail
          : 'sandbox_launch',
      )
    },
  )
  const status = command(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    {},
    false,
    () => new ImplementationFailure('checkout_status_failed'),
  )
  if (status) throw new ImplementationFailure('checkout_dirty')
  checkedSha = undefined
}
function model(context, instruction) {
  if (!process.env.OPENCODE_API_KEY) throw new ImplementationFailure('model_launch')
  // Every ticket/review is a fresh CLI session, with read-only repository tools.
  return command(
    process.env.OPENCODE_BIN ?? 'opencode',
    ['run', '--standalone', '--format', 'json', '--agent', 'discussion', '--model', config.model],
    {
      input:
        instruction +
        '\nThe final assistant message must contain one complete JSON object, with no Markdown fences or surrounding prose.' +
        '\n' +
        resultInstructions(context.activeTicket?.number ?? context.tickets.at(-1)) +
        '\nUNTRUSTED APPROVED CONTEXT:\n' +
        JSON.stringify(context),
      timeout: remaining(context),
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/TOKEN|PRIVATE_KEY/.test(key)),
      ),
    },
    true,
  )
}
async function integrate(context, reply, label) {
  operation = 'apply'
  const base = git(['rev-parse', 'HEAD'])
  clean()
  const stepContext = { ...context, expectedHead: base }
  const step = `${directory}/step`
  await mkdir(step, { recursive: true })
  await writeFile(`${step}/context.json`, JSON.stringify(stepContext))
  operation = 'validate'
  const field = reviewAxis ? 'review.repair' : 'result'
  validateChanges(reply, stepContext.tickets, field)
  validateExistingDocuments(
    reply.files,
    (path) => git(['ls-tree', base, '--', path]).startsWith('100644 blob '),
    field,
  )
  operation = 'apply'
  await writeFile(`${step}/reply.json`, JSON.stringify(reply))
  command(
    process.execPath,
    [resolve(trustedRoot, 'scripts/implementation-repair.mjs'), 'candidate'],
    {
      env: {
        ...process.env,
        REPAIR_IO: step,
        REPAIR_CANDIDATE_ROOT: root,
        OPENCODE_API_KEY: '',
        GH_TOKEN: '',
      },
      timeout: remaining(context),
    },
  )
  checked(context)
  return {
    label,
    base,
    sha: git(['rev-parse', 'HEAD']),
    command: 'mise run check',
    conclusion: 'success',
    clean: true,
  }
}
async function runGraph(context, completed, execute, first = false) {
  const records = [...completed]
  const done = new Set(records.filter((r) => r.ticket).map((r) => r.ticket))
  while (done.size < context.graph.length) {
    const ticket = context.graph.find(
      (t) => !done.has(t.number) && t.blockedBy.every((n) => done.has(n)),
    )
    requireValue(ticket)
    const record = await execute(ticket, records)
    requireValue(
      record.clean && record.conclusion === 'success' && /^[a-f0-9]{40}$/.test(record.sha),
    )
    records.push({ ...record, ticket: ticket.number })
    done.add(ticket.number)
    if (first) break
  }
  return records
}
async function main() {
  const context = await read('context')
  requireValue(phase !== 'unknown')
  const first = phase === 'first'
  requireValue(!process.env.GITHUB_RUN_ATTEMPT || process.env.GITHUB_RUN_ATTEMPT === '1')
  requireValue(context.phase === (first ? 'first' : 'final'))
  remaining(context)
  requireValue(git(['rev-parse', 'HEAD']) === context.expectedHead)
  clean()
  const completed = first ? [] : await read('integrations')
  let summary
  const records = await runGraph(
    context,
    completed,
    async (ticket, history) => {
      activeTicket =
        Number.isSafeInteger(ticket.number) && ticket.number > 0 ? ticket.number : 'none'
      operation = 'model'
      const reply = model(
        { ...context, activeTicket: ticket, integrations: history },
        'Apply implement-spec and tdd at approved seams. Implement ONLY activeTicket. Read AGENTS and applicable docs. Shell, writes, network and delegated tools are prohibited. Return the change object below with the active ticket number. Explain risk by consequences and data rollback sufficiency. No repeated attempts.',
      )
      const record = await integrate(
        { ...context, tickets: [ticket.number] },
        reply,
        `ticket-${ticket.number}`,
      )
      activeTicket = 'none'
      operation = 'graph'
      return record
    },
    first,
  )
  await write('integrations', records)
  if (!first) {
    for (const axis of ['Standards', 'Spec']) {
      reviewAxis = axis
      // The read-only CLI cannot run Git. Supply the actual base-to-head change
      // as data, refreshing it after any repair by the preceding review session.
      operation = axis === 'Standards' ? 'review_standards' : 'review_spec'
      const reviewContext = {
        base: context.base,
        head: git(['rev-parse', 'HEAD']),
        diff: git([
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--no-renames',
          '--unified=80',
          context.base,
          'HEAD',
        ]),
      }
      const review = model(
        { ...context, integrations: records, review: reviewContext },
        `Perform independent ${axis} review of entire integrated graph against base ${context.base}. Read changes and approved context. Return exactly {findings:[{path,line,conditions,consequences}],risk,rollback,repair}. Use those exact finding keys, a positive integer line, and nonblank strings. If findings is nonempty, repair must be a change object as described below for a ticket in scope. Otherwise use repair:null. Summarize consequences and risk of ENTIRE change; explain whether reverting code suffices for data. Provide only confirmed defects. No writes or shell. Review is separate from external GitHub author review.`,
      )
      operation = 'validate'
      validateReview(review)
      summary = review
      if (review.findings.length) {
        records.push(await integrate(context, review.repair, `review-${axis}`))
      }
      operation = 'record'
      await write(`review-${axis}`, review)
    }
    reviewAxis = undefined
  }
  // Preserve the per-ticket commits locally; publish one deterministic phase commit.
  operation = 'assemble'
  const files = []
  for (const path of git(['diff', '--no-renames', '--name-only', context.expectedHead, 'HEAD'])
    .split('\n')
    .filter(Boolean)) {
    const entry = git(['ls-tree', 'HEAD', '--', path])
    requireValue(entry === '' || entry.startsWith('100644 blob '))
    files.push({
      path,
      mode: '100644',
      content: entry ? await readFile(resolve(root, path), 'utf8') : null,
    })
  }
  const identity = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Implementation Publisher',
    GIT_AUTHOR_EMAIL: 'implementation-publisher@users.noreply.github.com',
    GIT_AUTHOR_DATE: context.commitDate,
    GIT_COMMITTER_NAME: 'Implementation Publisher',
    GIT_COMMITTER_EMAIL: 'implementation-publisher@users.noreply.github.com',
    GIT_COMMITTER_DATE: context.commitDate,
  }
  const last = context.tickets.at(-1)
  const message = `feat: implement approved calendar changes (#${first ? records[0].ticket : last})`
  const candidateSha = git(['commit-tree', git(['write-tree']), '-p', context.expectedHead], {
    input: message + '\n',
    env: identity,
  })
  git(['checkout', '--detach', candidateSha])
  const lastReply =
    summary ??
    (records.length > completed.length
      ? JSON.parse(await readFile(`${directory}/step/reply.json`, 'utf8'))
      : await read('result'))
  const result = {
    version: 1,
    contextDigest: digest(context),
    candidateSha,
    ready: !first,
    message,
    files,
    risk: lastReply.risk,
    rollback: lastReply.rollback,
  }
  await write('result', result)
  checked(context)
  operation = 'record'
  await write('verification', {
    version: 1,
    runId: context.runId,
    resultDigest: digest(result),
    command: 'mise run check',
    conclusion: 'success',
    ready: !first,
    sha: candidateSha,
  })
  await write('integrations', records)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(async (error) => {
    const categories = { validate: 'invalid_result', apply: 'apply_failed', check: 'check_failed' }
    const category =
      error instanceof ImplementationFailure ? error.message : (categories[operation] ?? 'unknown')
    const prefix = category === 'timeout' ? 'initial_timeout' : 'initial_graph_failed'
    const status =
      error instanceof ImplementationFailure && error.status !== undefined
        ? ` status=${error.status}`
        : ''
    const target = reviewAxis ? `axis=${reviewAxis}` : `ticket=${activeTicket}`
    const violation = error instanceof InvalidResult ? ` ${error.message}` : ''
    const sha =
      operation === 'check' && /^[a-f0-9]{40}$/.test(checkedSha) ? ` sha=${checkedSha}` : ''
    const diagnostic = `${prefix} phase=${phase} ${target} operation=${operation} category=${category}${status}${violation}${sha}`
    console.error(diagnostic)
    if (process.env.GITHUB_OUTPUT)
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `reason=${category === 'timeout' ? 'timeout' : 'unknown'}\ndiagnostic=${diagnostic}\n`,
      ).catch(() => console.error('graph_output_unavailable'))
    process.exitCode = 1
  })
