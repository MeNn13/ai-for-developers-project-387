import { trustedHuman } from './opencode-publish.mjs'

import { trustedOrigin } from './implementation-origin.mjs'

const repository = 'MeNn13/ai-for-developers-project-387'
const workflows = ['.github/workflows/opencode.yml', '.github/workflows/implementation-publish.yml']
const sha = /^[a-f0-9]{40}$/
export async function admit(surface, event, api, trust) {
  const denied = (reason) => ({ allowed: false, reason })
  if (
    !['issue_comment', 'pull_request_review_comment'].includes(surface) ||
    event.action !== 'created' ||
    !trustedHuman(event.comment ?? {}) ||
    !/^\s*\/(?:oc|opencode)\s+fix(?:\s|$)/i.test(event.comment.body ?? '')
  )
    return denied('ignored')
  if (event.repository?.full_name !== repository) return denied('ignored')
  const number = event.issue?.pull_request ? event.issue.number : event.pull_request?.number
  if (!Number.isSafeInteger(number)) return denied('ignored')
  const pr = await api(`/pulls/${number}`)
  if (
    pr.user?.id !== trust.appId ||
    pr.head?.repo?.full_name !== repository ||
    !/^spec\/[1-9]\d*$/.test(pr.head.ref) ||
    pr.base?.ref !== 'main' ||
    !sha.test(pr.head.sha)
  )
    return denied('ownership')
  const current = await api(`/actions/runs/${trust.runId}`)
  if (
    !workflows.includes(current.path) ||
    current.event !== surface ||
    !(await trustedOrigin(current, api, trust.trustedSha)) ||
    (surface !== 'pull_request_review_comment' && current.head_sha !== trust.trustedSha) ||
    current.repository?.full_name !== repository ||
    current.run_attempt !== trust.attempt
  )
    throw new Error('history')
  const runs = []
  let complete = false
  for (let page = 1; page <= 100; page++) {
    const batch = await api(`/actions/runs?per_page=100&page=${page}`)
    if (!Array.isArray(batch.workflow_runs) || !Number.isSafeInteger(batch.total_count))
      throw new Error('history')
    runs.push(...batch.workflow_runs)
    if (runs.length === batch.total_count) {
      complete = true
      break
    }
    if (batch.workflow_runs.length < 100) throw new Error('history')
  }
  if (!complete) throw new Error('history')
  let count = 0
  let already = false
  for (const run of runs) {
    if (!workflows.includes(run.path)) continue
    if (
      !(await trustedOrigin(run, api, trust.trustedSha)) ||
      run.repository?.full_name !== repository ||
      !sha.test(run.head_sha) ||
      !Number.isSafeInteger(run.run_attempt) ||
      run.run_attempt < 1
    )
      throw new Error('history')
    for (let attempt = 1; attempt <= run.run_attempt; attempt++) {
      const jobs = await api(`/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`)
      if (!Array.isArray(jobs.jobs) || jobs.total_count !== jobs.jobs.length)
        throw new Error('history')
      const admitted = jobs.jobs.some(
        (j) =>
          /^implementation-/.test(j.name) &&
          j.name.endsWith(`-pr-${number}`) &&
          j.steps?.some((s) => s.name === 'implementation-admitted' && s.conclusion === 'success'),
      )
      if (!admitted) continue
      if (
        ![run.created_at, run.updated_at, event.comment.created_at].every((s) =>
          Number.isFinite(Date.parse(s)),
        )
      )
        throw new Error('history')
      const same = run.id === trust.runId && attempt === trust.attempt
      if (same) {
        already = true
        continue
      }
      count++
      // Arrival time is checked even when a queued event is processed much later.
      if (
        run.id !== trust.runId &&
        (run.status !== 'completed' ||
          (Date.parse(run.created_at) <= Date.parse(event.comment.created_at) &&
            Date.parse(run.updated_at) >= Date.parse(event.comment.created_at)))
      )
        return { ...denied('busy'), number, head: pr.head.sha }
    }
  }
  return {
    allowed: already || count < 3,
    reason: already || count < 3 ? 'admitted' : 'limit_exhausted',
    number,
    head: pr.head.sha,
    spec: Number(pr.head.ref.slice(5)),
  }
}
