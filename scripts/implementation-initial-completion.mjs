import { trustedOrigin } from './implementation-origin.mjs'
const repository = 'MeNn13/ai-for-developers-project-387'
export async function initialCompletion(run, api, appId, trustedSha) {
  if (
    run.path !== '.github/workflows/opencode-implement.yml' ||
    run.status !== 'completed' ||
    run.event !== 'workflow_dispatch' ||
    !(await trustedOrigin(run, (path) => api('GET', path), trustedSha))
  )
    return null
  const jobs = await api(
    'GET',
    `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
  )
  if (jobs.total_count !== jobs.jobs.length) throw new Error('completion_history')
  const source = jobs.jobs.filter(
    (j) => /^initial-source-[1-9]\d*$/.test(j.name) && j.conclusion !== 'skipped',
  )
  if (!source.length) return null
  if (source.length !== 1) throw new Error('completion_history')
  const number = Number(source[0].name.split('-').at(-1))
  const marker = jobs.jobs.flatMap((j) => j.steps ?? [])
  const ready = marker.some(
    (s) =>
      s.name === 'Publish ready graph with trusted App operations' && s.conclusion === 'success',
  )
  const reason =
    run.conclusion === 'cancelled'
      ? 'cancelled'
      : jobs.jobs.some((j) => j.conclusion === 'timed_out') ||
          marker.some((s) => s.name === 'initial-timeout' && s.conclusion === 'success')
        ? 'timeout'
        : ready
          ? 'success'
          : 'unknown'
  let head = run.head_sha
  const specs = [
    ...new Set(
      jobs.jobs
        .filter((j) => /^initial-publish-spec-[1-9]\d*$/.test(j.name))
        .map((j) => Number(j.name.split('-').at(-1))),
    ),
  ]
  if (specs.length === 1) {
    const prs = await api(
      'GET',
      `/pulls?state=open&head=MeNn13:spec/${specs[0]}&base=main&per_page=100`,
    )
    if (
      prs.length === 1 &&
      prs[0].user?.id === appId &&
      prs[0].head?.repo?.full_name === repository
    )
      head = prs[0].head.sha
  }
  const tag = `<!-- initial-completion:${run.id}:${run.run_attempt} -->`
  for (let page = 1; page <= 100; page++) {
    const comments = await api('GET', `/issues/${number}/comments?per_page=100&page=${page}`)
    if (comments.some((c) => c.user?.login === 'github-actions[bot]' && c.body?.endsWith(tag)))
      return { number, reason }
    if (comments.length < 100) {
      await api('POST', `/issues/${number}/comments`, {
        body: `Исходная реализация: ${reason}. Последний известный SHA: ${head}.\nhttps://github.com/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}\nПосле остановки продолжение только новой командой человека; автоматического повтора нет.\n${tag}`,
      })
      return { number, reason }
    }
  }
  throw new Error('completion_history')
}
