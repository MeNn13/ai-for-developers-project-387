const repository = 'MeNn13/ai-for-developers-project-387'
const repositoryUrl = `https://api.github.com/repos/${repository}`
const sha = /^[a-f0-9]{40}$/

// GitHub can record either the merge revision or the PR head for an inline run.
// Both must carry the workflow from a trusted revision on main.
export async function trustedOrigin(run, api, trustedRef = 'main') {
  if (run.repository?.full_name !== repository || !sha.test(run.head_sha)) return false
  if (run.event !== 'pull_request_review_comment') return run.head_branch === 'main'
  if (run.path !== '.github/workflows/opencode.yml' || !/^spec\/[1-9]\d*$/.test(run.head_branch))
    return false
  const commit = await api(`/git/commits/${run.head_sha}`)
  let baseline
  if (commit.parents?.length === 2) baseline = commit.parents[0].sha
  else if (commit.parents?.length === 1 && Array.isArray(run.pull_requests)) {
    const associations = run.pull_requests.filter(
      ({ number, head, base }) =>
        Number.isSafeInteger(number) &&
        number > 0 &&
        head?.sha === run.head_sha &&
        head.ref === run.head_branch &&
        head.repo?.url === repositoryUrl &&
        base?.ref === 'main' &&
        base.repo?.url === repositoryUrl,
    )
    if (associations.length !== 1) return false
    baseline = associations[0].base.sha
    if (!sha.test(baseline)) return false
    const branch = await api(`/compare/${baseline}...${run.head_sha}`)
    if (branch.status !== 'ahead') return false
  }
  if (!sha.test(baseline)) return false
  const comparison = await api(`/compare/${baseline}...${trustedRef}`)
  if (!['ahead', 'identical'].includes(comparison.status)) return false
  const expected = await api(`/contents/${run.path}?ref=${baseline}`)
  const actual = await api(`/contents/${run.path}?ref=${run.head_sha}`)
  return sha.test(expected.sha) && actual.sha === expected.sha
}
