import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { trustedHuman } from './opencode-publish.mjs'

const repository = 'MeNn13/ai-for-developers-project-387'
const check = (ok, reason) => {
  if (!ok) throw new Error(reason)
}
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
export async function initialContext(event, api, trust) {
  check(
    event.action === 'created' &&
      event.repository?.full_name === repository &&
      !event.issue?.pull_request &&
      trustedHuman(event.comment ?? {}),
    'initial_author',
  )
  const command = event.comment.body.match(
    /^\s*\/(?:oc|opencode)\s+implement-spec\s+spec=#([1-9]\d*)\s+tickets=(#[1-9]\d*(?:,#[1-9]\d*)*)\s+(approve|approval=https:\/\/github\.com\/MeNn13\/ai-for-developers-project-387\/issues\/([1-9]\d*)#issuecomment-([1-9]\d*))\s*$/i,
  )
  check(
    command,
    'initial_command: use /oc implement-spec spec=#N tickets=#N,#N approve or approval=<comment URL>',
  )
  const source = event.issue.number
  const spec = Number(command[1])
  const tickets = command[2].split(',').map((n) => Number(n.slice(1)))
  check(
    [source, spec, ...tickets, trust.runId].every((n) => Number.isSafeInteger(n) && n > 0) &&
      /^[a-f0-9]{40}$/.test(trust.trustedSha),
    'initial_context',
  )
  check(
    tickets.length <= 30 && new Set([source, spec, ...tickets]).size === tickets.length + 2,
    'initial_ambiguity',
  )
  check(command[3] === 'approve' || Number(command[4]) === source, 'initial_approval')
  const approval = await api(
    `/issues/comments/${command[3] === 'approve' ? event.comment.id : command[5]}`,
  )
  check(
    trustedHuman(approval) &&
      approval.issue_url === `https://api.github.com/repos/${repository}/issues/${source}`,
    'initial_approval',
  )
  const consent = `implement-spec spec=#${spec} tickets=${tickets.map((n) => `#${n}`).join(',')} approve`
  check(
    approval.body
      .trim()
      .replace(/^\/(?:oc|opencode)\s+/i, '')
      .toLowerCase() === consent.toLowerCase(),
    'initial_approval: approval must explicitly approve this specification and ticket list',
  )
  if (command[3] === 'approve')
    check(approval.body === event.comment.body, 'initial_changed_comment')
  const snapshots = []
  for (const number of [source, spec, ...tickets]) {
    const issue = await api(`/issues/${number}`)
    check(
      issue.number === number &&
        !issue.pull_request &&
        issue.state === 'open' &&
        typeof issue.body === 'string' &&
        issue.body.length > 0,
      'initial_context',
    )
    snapshots.push({
      number,
      id: issue.id,
      title: issue.title,
      body: issue.body,
      comments: await api(`/issues/${number}/comments?per_page=100`),
    })
    check(snapshots.at(-1).comments.length < 100, 'initial_context_incomplete')
  }
  const children = await api(`/issues/${spec}/sub_issues?per_page=100`)
  check(
    children.length < 100 &&
      children.length === tickets.length &&
      tickets.every((n) => children.some((c) => c.number === n)),
    'initial_ticket_graph',
  )
  const graph = []
  for (const number of tickets) {
    const blockers = await api(`/issues/${number}/dependencies/blocked_by?per_page=100`)
    check(
      blockers.length < 100 &&
        blockers.every((b) => tickets.includes(b.number) || b.state === 'closed'),
      'initial_blockers',
    )
    graph.push({
      number,
      blockedBy: blockers.filter((b) => tickets.includes(b.number)).map((b) => b.number),
    })
  }
  const remaining = [...graph],
    done = new Set()
  while (remaining.length) {
    const index = remaining.findIndex((t) => t.blockedBy.every((n) => done.has(n)))
    check(index >= 0, 'initial_cycle')
    done.add(remaining.splice(index, 1)[0].number)
  }
  const result = {
    version: 1,
    runId: trust.runId,
    trustedSha: trust.trustedSha,
    base: trust.trustedSha,
    expectedHead: trust.trustedSha,
    commitDate: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source,
    spec,
    tickets,
    approval: approval.id,
    approvalBody: approval.body,
    snapshots,
    graph,
    initial: true,
    phase: 'single',
    order: [...done],
    deadline: Date.now() + 60 * 60 * 1000,
  }
  check(Buffer.byteLength(JSON.stringify(result)) < 300_000, 'initial_context_size')
  return result
}

// Entire run history is required: no silent reset and no queued command accepted as new work.
export async function initialAdmission(event, api, runId) {
  let complete = false
  let count = 0
  check(Number.isFinite(Date.parse(event.comment.created_at)), 'initial_history')
  for (let page = 1; page <= 100; page++) {
    const batch = await api(
      `/actions/workflows/opencode-implement.yml/runs?per_page=100&page=${page}`,
    )
    check(
      Array.isArray(batch.workflow_runs) && Number.isSafeInteger(batch.total_count),
      'initial_history',
    )
    count += batch.workflow_runs.length
    for (const run of batch.workflow_runs) {
      if (run.id === runId) continue
      check(Number.isFinite(Date.parse(run.updated_at)), 'initial_history')
      check(
        run.repository?.full_name === repository && run.head_branch === 'main',
        'initial_history',
      )
      const jobs = await api(`/actions/runs/${run.id}/jobs?per_page=100`)
      check(jobs.total_count === jobs.jobs.length, 'initial_history')
      if (
        jobs.jobs.some((j) => j.name === `initial-source-${event.issue.number}`) &&
        (run.status !== 'completed' ||
          Date.parse(run.updated_at) >= Date.parse(event.comment.created_at))
      )
        throw new Error('initial_busy: wait for the active implementation to finish')
    }
    if (count === batch.total_count) {
      complete = true
      break
    }
    check(batch.workflow_runs.length === 100, 'initial_history')
  }
  check(complete, 'initial_history')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const api = async (path, method = 'GET', data) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
      method,
      ...(data ? { body: JSON.stringify(data) } : {}),
      signal: AbortSignal.timeout(30000),
    })
    check(response.ok, 'initial_context_unavailable')
    return response.status === 204 ? null : response.json()
  }
  try {
    let event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
    if (process.argv[2] === 'dispatch') {
      check(
        process.env.GITHUB_EVENT_NAME === 'issue_comment' &&
          event.action === 'created' &&
          trustedHuman(event.comment ?? {}) &&
          !event.issue?.pull_request &&
          /^\s*\/(?:oc|opencode)\s+implement-spec(?:\s|$)/i.test(event.comment.body),
        'initial_author',
      )
      await api('/actions/workflows/opencode-implement.yml/dispatches', 'POST', {
        ref: 'main',
        inputs: {
          source: String(event.issue.number),
          comment: String(event.comment.id),
          approval_digest: hash(event.comment.body),
        },
      })
      process.exit(0)
    }
    check(
      process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
        process.env.GITHUB_RUN_ATTEMPT === '1' &&
        /^[1-9]\d*$/.test(event.inputs.source) &&
        /^[1-9]\d*$/.test(event.inputs.comment),
      'initial_origin',
    )
    const expectedApproval = event.inputs.approval_digest
    event = {
      action: 'created',
      repository: { full_name: repository },
      issue: await api(`/issues/${event.inputs.source}`),
      comment: await api(`/issues/comments/${event.inputs.comment}`),
    }
    check(hash(event.comment.body) === expectedApproval, 'initial_changed_comment')
    const context = await initialContext(event, api, {
      runId: Number(process.env.GITHUB_RUN_ID),
      trustedSha: process.env.TRUSTED_SHA,
    })
    await initialAdmission(event, api, Number(process.env.GITHUB_RUN_ID))
    await mkdir(process.env.INITIAL_IO, { recursive: true })
    await writeFile(`${process.env.INITIAL_IO}/context.json`, JSON.stringify(context))
    await appendFile(process.env.GITHUB_OUTPUT, `source=${context.source}\nspec=${context.spec}\n`)
  } catch (error) {
    console.error(
      error.message.startsWith('initial_') ? error.message : 'initial_context_unavailable',
    )
    process.exitCode = 1
  }
}
