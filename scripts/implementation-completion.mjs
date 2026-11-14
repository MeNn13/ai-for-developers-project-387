const repository = 'MeNn13/ai-for-developers-project-387'
export async function completion(run, api, appId) {
  if (
    run.path !== '.github/workflows/opencode.yml' ||
    run.head_branch !== 'main' ||
    run.repository?.full_name !== repository ||
    !['issue_comment', 'pull_request_review_comment'].includes(run.event) ||
    run.status !== 'completed' ||
    !Number.isSafeInteger(run.id) ||
    !Number.isSafeInteger(run.run_attempt)
  )
    return null
  const jobs = await api(
    'GET',
    `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
  )
  if (jobs.total_count !== jobs.jobs.length) throw new Error('completion_history')
  const repairs = jobs.jobs.filter(
    (j) =>
      /^implementation-(context|model|check|publish)-pr-[1-9]\d*$/.test(j.name) &&
      j.conclusion !== 'skipped',
  )
  if (!repairs.length) return null
  const numbers = [...new Set(repairs.map((j) => Number(j.name.split('-').at(-1))))]
  if (numbers.length !== 1) throw new Error('completion_history')
  const number = numbers[0]
  const pr = await api('GET', `/pulls/${number}`)
  if (
    pr.user?.id !== appId ||
    pr.head?.repo?.full_name !== repository ||
    !/^spec\/[1-9]\d*$/.test(pr.head.ref)
  )
    return null
  const steps = repairs.flatMap((j) => j.steps ?? [])
  const marker = (name) => steps.some((s) => s.name === name && s.conclusion === 'success')
  let reason = 'unknown'
  if (marker('implementation-limit_exhausted')) reason = 'limit_exhausted'
  else if (marker('implementation-busy')) reason = 'busy'
  else if (run.conclusion === 'cancelled') reason = 'cancelled'
  else if (repairs.some((j) => j.conclusion === 'timed_out')) reason = 'timeout'
  else if (marker('Publish checked repair with fixed App operations')) reason = 'success'
  else if (
    steps.some(
      (s) =>
        s.name === 'Prepare file data without GitHub token or App key' &&
        s.conclusion === 'failure',
    )
  )
    reason = 'agent_failed'
  else if (run.conclusion === 'failure') reason = 'infra'
  const body = `Исправление PR: ${reason}. ${reason === 'limit_exhausted' ? 'Нужен человек.' : reason === 'busy' ? 'Дождитесь завершения активной работы.' : ''}\nПоследний известный SHA: ${pr.head.sha}.\nhttps://github.com/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}\n<!-- implementation-completion:${run.id}:${run.run_attempt} -->`
  let complete = false
  for (let page = 1; page <= 100; page++) {
    const comments = await api('GET', `/issues/${number}/comments?per_page=100&page=${page}`)
    if (
      comments.some(
        (c) =>
          c.user?.login === 'github-actions[bot]' &&
          c.body?.endsWith(`<!-- implementation-completion:${run.id}:${run.run_attempt} -->`),
      )
    )
      return { number, reason }
    if (comments.length < 100) {
      complete = true
      break
    }
  }
  if (!complete) throw new Error('completion_history')
  await api('POST', `/issues/${number}/comments`, { body })
  return { number, reason }
}
