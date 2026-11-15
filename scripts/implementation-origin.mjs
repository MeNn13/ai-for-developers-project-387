const repository = 'MeNn13/ai-for-developers-project-387'
const sha = /^[a-f0-9]{40}$/

// Inline runs carry the PR merge revision despite checking out main in every job.
// Verify workflow bytes at that revision, never artifact assertions or branch names alone.
export async function trustedOrigin(run, api, trustedRef = 'main') {
  if (run.repository?.full_name !== repository || !sha.test(run.head_sha)) return false
  if (run.event !== 'pull_request_review_comment') return run.head_branch === 'main'
  if (run.path !== '.github/workflows/opencode.yml' || !/^spec\/[1-9]\d*$/.test(run.head_branch))
    return false
  const commit = await api(`/git/commits/${run.head_sha}`)
  if (commit.parents?.length !== 2 || !sha.test(commit.parents[0].sha)) return false
  const baseline = commit.parents[0].sha
  const comparison = await api(`/compare/${baseline}...${trustedRef}`)
  if (!['ahead', 'identical'].includes(comparison.status)) return false
  const expected = await api(`/contents/${run.path}?ref=${baseline}`)
  const actual = await api(`/contents/${run.path}?ref=${run.head_sha}`)
  return sha.test(expected.sha) && actual.sha === expected.sha
}
