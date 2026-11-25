import { trustedHuman } from './opencode-publish.mjs'

import { trustedOrigin } from './implementation-origin.mjs'

const repository = 'MeNn13/ai-for-developers-project-387'
const workflows = ['.github/workflows/opencode.yml', '.github/workflows/implementation-publish.yml']
const sha = /^[a-f0-9]{40}$/

export class AdmissionFailure extends Error {
  constructor(reason) {
    super(reason === 'untrusted_origin' ? 'untrusted_origin' : 'invalid_history')
  }
}

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
  const historyApi = async (path) => {
    try {
      const response = await api(path)
      if (response && typeof response === 'object' && !Array.isArray(response)) return response
    } catch {
      // A failed request and an unreadable response both leave the history incomplete.
    }
    throw new AdmissionFailure('invalid_history')
  }
  const current = await historyApi(`/actions/runs/${trust.runId}`)
  if (current?.run_attempt !== trust.attempt) throw new AdmissionFailure('invalid_history')
  if (
    !workflows.includes(current.path) ||
    current.event !== surface ||
    !(await trustedOrigin(current, historyApi, trust.trustedSha)) ||
    (surface !== 'pull_request_review_comment' && current.head_sha !== trust.trustedSha) ||
    current.repository?.full_name !== repository
  )
    throw new AdmissionFailure('untrusted_origin')
  const runs = []
  let complete = false
  for (let page = 1; page <= 100; page++) {
    const batch = await historyApi(`/actions/runs?per_page=100&page=${page}`)
    if (!Array.isArray(batch?.workflow_runs) || !Number.isSafeInteger(batch.total_count))
      throw new AdmissionFailure('invalid_history')
    runs.push(...batch.workflow_runs)
    if (runs.length === batch.total_count) {
      complete = true
      break
    }
    if (batch.workflow_runs.length < 100) throw new AdmissionFailure('invalid_history')
  }
  if (!complete) throw new AdmissionFailure('invalid_history')
  let count = 0
  let already = false
  for (const run of runs) {
    if (typeof run?.path !== 'string') throw new AdmissionFailure('invalid_history')
    if (!workflows.includes(run.path)) continue
    if (
      run.repository?.full_name !== repository ||
      !sha.test(run.head_sha) ||
      !Number.isSafeInteger(run.run_attempt) ||
      run.run_attempt < 1
    )
      throw new AdmissionFailure('invalid_history')
    for (let attempt = 1; attempt <= run.run_attempt; attempt++) {
      const jobs = await historyApi(`/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`)
      if (!Array.isArray(jobs?.jobs) || jobs.total_count !== jobs.jobs.length)
        throw new AdmissionFailure('invalid_history')
      if (jobs.jobs.some((job) => typeof job?.name !== 'string'))
        throw new AdmissionFailure('invalid_history')
      const repairJobs = jobs.jobs.filter(
        ({ name }) => name.startsWith('implementation-') && name.endsWith(`-pr-${number}`),
      )
      for (const job of repairJobs) {
        const completed = run.status === 'completed' || job.status === 'completed'
        if (job.steps == null && !completed) continue
        if (!Array.isArray(job.steps) || job.steps.some((step) => typeof step?.name !== 'string'))
          throw new AdmissionFailure('invalid_history')
        if (
          completed &&
          job.steps.some(
            (step) =>
              step.name === 'implementation-admitted' && typeof step.conclusion !== 'string',
          )
        )
          throw new AdmissionFailure('invalid_history')
      }
      const admitted = repairJobs.some(({ steps }) =>
        steps?.some(
          (step) => step.name === 'implementation-admitted' && step.conclusion === 'success',
        ),
      )
      if (!admitted) continue
      if (!(await trustedOrigin(run, historyApi, trust.trustedSha)))
        throw new AdmissionFailure('untrusted_origin')
      if (
        ![run.created_at, run.updated_at, event.comment.created_at].every((s) =>
          Number.isFinite(Date.parse(s)),
        )
      )
        throw new AdmissionFailure('invalid_history')
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
