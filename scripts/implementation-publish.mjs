import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { trustedOrigin } from './implementation-origin.mjs'

const repository = 'MeNn13/ai-for-developers-project-387'
const shaPattern = /^[a-f0-9]{40}$/
const positive = (n) => Number.isSafeInteger(n) && n > 0
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function requireValue(condition, reason) {
  if (!condition) throw new Error(reason)
}

// Deliberately narrow: new infrastructure and instructions require a human PR.
export function allowedFile(file) {
  const path = file.path
  return (
    typeof path === 'string' &&
    path.length < 240 &&
    !path.split('/').some((p) => !p || p.startsWith('.') || /[\\:%\x00-\x20]/.test(p)) &&
    !/(?:agents?|skills?|instructions?|prompts?|review|config)/i.test(path) &&
    (/^backend\/(?:BookingCalendar\.[A-Za-z.]+)\/[A-Za-z0-9_./-]+\.cs$/.test(path) ||
      /^frontend\/src\/[A-Za-z0-9_./-]+\.(?:ts|tsx|css)$/.test(path) ||
      /^e2e\/[A-Za-z0-9_-]+\.spec\.ts$/.test(path) ||
      path === 'contract/main.tsp' ||
      path === 'contract/openapi/openapi.yaml') &&
    file.mode === '100644' &&
    (file.content === null || typeof file.content === 'string')
  )
}

export async function publishImplementation(
  result,
  context,
  api,
  trust,
  checkpoint = async () => {},
) {
  let state = 'none'
  try {
    requireValue(
      shaPattern.test(trust.trustedSha) && positive(trust.runId) && positive(trust.appId),
      'trust',
    )
    const run = await api('GET', `/actions/runs/${trust.runId}`)
    if (context.initial && !context.repair)
      requireValue(
        Number.isFinite(context.deadline) && Date.now() < context.deadline && run.run_attempt === 1,
        'context',
      )
    requireValue(
      run.id === trust.runId &&
        ['.github/workflows/opencode-implement.yml', '.github/workflows/opencode.yml'].includes(
          run.path,
        ) &&
        (await trustedOrigin(run, (path) => api('GET', path), trust.trustedSha)) &&
        (context.repair || run.head_sha === trust.trustedSha) &&
        run.repository?.full_name === repository &&
        (run.conclusion === 'success' ||
          (['.github/workflows/opencode.yml', '.github/workflows/opencode-implement.yml'].includes(
            run.path,
          ) &&
            run.status === 'in_progress')),
      'origin',
    )
    const jobs = await api('GET', `/actions/runs/${trust.runId}/jobs?per_page=100`)
    if (context.repair) {
      requireValue(trust.publisherRunId === trust.runId && positive(trust.runAttempt), 'trust')
      const admission = await api(
        'GET',
        `/actions/runs/${trust.runId}/attempts/${trust.runAttempt}/jobs?per_page=100`,
      )
      requireValue(
        admission.total_count === admission.jobs.length &&
          admission.jobs.some(
            (j) =>
              j.name === `implementation-publish-pr-${context.repair.number}` &&
              j.steps?.some(
                (s) => s.name === 'implementation-admitted' && s.conclusion === 'success',
              ),
          ),
        'trust',
      )
    }
    requireValue(
      jobs.total_count === jobs.jobs.length &&
        [
          'implementation-context',
          context.initial && !context.repair && context.phase === 'final'
            ? 'implementation-final-check'
            : 'implementation-check',
        ].every(
          (name) =>
            jobs.jobs.filter(
              (j) =>
                (j.name === name || j.name.startsWith(`${name}-pr-`)) && j.conclusion === 'success',
            ).length === 1,
        ),
      'checks',
    )
    requireValue(
      context.version === 1 &&
        context.runId === run.id &&
        context.trustedSha === trust.trustedSha &&
        context.base === trust.trustedSha &&
        shaPattern.test(context.expectedHead) &&
        [context.source, context.spec, context.approval].every(positive) &&
        Array.isArray(context.tickets) &&
        context.tickets.length > 0 &&
        context.tickets.every(positive) &&
        new Set(context.tickets).size === context.tickets.length &&
        Array.isArray(context.snapshots) &&
        [context.source, context.spec, ...context.tickets].every((n) =>
          context.snapshots.some(
            (s) => s.number === n && typeof s.body === 'string' && s.body.length > 0,
          ),
        ),
      'context',
    )
    for (const number of new Set([context.source, context.spec, ...context.tickets])) {
      const issue = await api('GET', `/issues/${number}`)
      requireValue(
        !issue.pull_request &&
          issue.body === context.snapshots.find((s) => s.number === number).body,
        'context',
      )
    }
    if (context.initial && !context.repair) {
      const children = await api('GET', `/issues/${context.spec}/sub_issues?per_page=100`)
      requireValue(
        children.length === context.tickets.length &&
          children.length < 100 &&
          context.tickets.every((n) => children.some((c) => c.number === n)),
        'context',
      )
      for (const ticket of context.graph) {
        const blockers = await api(
          'GET',
          `/issues/${ticket.number}/dependencies/blocked_by?per_page=100`,
        )
        requireValue(
          blockers.length < 100 &&
            blockers.every((b) => context.tickets.includes(b.number) || b.state === 'closed') &&
            JSON.stringify(
              blockers
                .filter((b) => context.tickets.includes(b.number))
                .map((b) => b.number)
                .sort(),
            ) === JSON.stringify([...ticket.blockedBy].sort()),
          'context',
        )
      }
    }
    requireValue(
      result.version === 1 &&
        result.contextDigest === digest(context) &&
        typeof result.ready === 'boolean' &&
        typeof result.risk === 'string' &&
        result.risk.length > 0 &&
        typeof result.rollback === 'string' &&
        result.rollback.length > 0,
      'result',
    )
    const approval = await api('GET', `/issues/comments/${context.approval}`)
    requireValue(
      approval.user?.login === 'MeNn13' &&
        approval.user.type === 'User' &&
        ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(approval.author_association) &&
        approval.issue_url ===
          `https://api.github.com/repos/${repository}/issues/${context.source}` &&
        approval.body === context.approvalBody,
      'approval',
    )
    requireValue(
      typeof result.message === 'string' &&
        result.message.length <= 72 &&
        /^(feat|fix|chore|docs|test|refactor|ci|build|perf|revert|style)(\([a-z]+\))?!?: [a-z][\x20-\x7e]+ \(#\d+\)$/.test(
          result.message,
        ) &&
        context.tickets.some((n) => result.message.endsWith(`(#${n})`)) &&
        !result.message.endsWith('.'),
      'commit_message',
    )
    requireValue(
      Array.isArray(result.files) &&
        (result.files.length > 0 ||
          (context.initial && context.phase === 'final' && result.ready)) &&
        result.files.length <= 200 &&
        result.files.every(allowedFile) &&
        new Set(result.files.map((f) => f.path.toLowerCase())).size === result.files.length &&
        Buffer.byteLength(JSON.stringify(result)) <= 2_000_000,
      'protected_path',
    )
    requireValue(
      trust.verification?.version === 1 &&
        trust.verification.runId === run.id &&
        trust.verification.resultDigest === digest(result) &&
        trust.verification.command === 'mise run check' &&
        trust.verification.conclusion === 'success' &&
        trust.verification.ready === result.ready &&
        shaPattern.test(result.candidateSha) &&
        trust.verification.sha === result.candidateSha &&
        typeof context.commitDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(context.commitDate),
      'verification',
    )
    const branch = `spec/${context.spec}`
    const refPath = `/git/ref/heads/${branch}`
    const head = await api('GET', refPath)
    const prs = await api('GET', `/pulls?state=all&head=MeNn13:${branch}&base=main&per_page=100`)
    requireValue(prs.length <= 1, 'pr_ownership')
    const pr = prs[0]
    if (pr)
      requireValue(
        pr.user?.id === trust.appId &&
          pr.state !== 'closed' &&
          pr.head.ref === branch &&
          pr.base.ref === 'main',
        'pr_ownership',
      )
    const payload = digest({ result, context })
    const previous = trust.recovery ?? trust.previous
    if (trust.recovery)
      requireValue(
        context.repair &&
          previous.publisherRunId === trust.publisherRunId &&
          previous.sourceRunId === trust.runId,
        'branch_ownership',
      )
    if (head) {
      state = 'possible'
      requireValue(
        previous &&
          previous.publisherRunId ===
            (trust.recovery ? trust.publisherRunId : trust.previousRunId) &&
          previous.branch === branch &&
          previous.head === head.object.sha &&
          previous.appId === trust.appId,
        'branch_ownership',
      )
      const priorRun = await api('GET', `/actions/runs/${previous.publisherRunId}`)
      requireValue(
        [
          '.github/workflows/implementation-publish.yml',
          '.github/workflows/opencode.yml',
          '.github/workflows/opencode-implement.yml',
        ].includes(priorRun.path) &&
          (await trustedOrigin(priorRun, (path) => api('GET', path), trust.trustedSha)) &&
          priorRun.repository?.full_name === repository &&
          shaPattern.test(priorRun.head_sha),
        'publication_history',
      )
      if (
        priorRun.event !== 'pull_request_review_comment' &&
        priorRun.head_sha !== trust.trustedSha
      ) {
        const comparison = await api('GET', `/compare/${priorRun.head_sha}...${trust.trustedSha}`)
        requireValue(comparison.status === 'ahead', 'publication_history')
      }
      if (previous.payload === payload) {
        // Retry the missing PR operation after a successful branch write.
        return await finish(previous.head, pr)
      }
      requireValue(head.object.sha === context.expectedHead, 'stale_head')
    } else requireValue(!pr && context.expectedHead === context.base, 'stale_head')
    const parent = head?.object.sha ?? context.base
    const baseCommit = await api('GET', `/git/commits/${parent}`)
    const tree = await api('POST', '/git/trees', {
      base_tree: baseCommit.tree.sha,
      tree: result.files.map((f) => ({
        path: f.path,
        mode: '100644',
        type: 'blob',
        ...(f.content === null ? { sha: null } : { content: f.content }),
      })),
    })
    const identity = {
      name: 'Implementation Publisher',
      email: 'implementation-publisher@users.noreply.github.com',
      date: context.commitDate,
    }
    const commit = await api('POST', '/git/commits', {
      message: result.message,
      tree: tree.sha,
      parents: [parent],
      author: identity,
      committer: identity,
    })
    requireValue(commit.sha === result.candidateSha, 'commit_sha')
    const current = await api('GET', refPath)
    requireValue((current?.object.sha ?? null) === (head?.object.sha ?? null), 'stale_head')
    // GitHub fast-forward updates are the final concurrency guard. Never force.
    state = 'possible'
    if (head) await api('PATCH', `/git/refs/heads/${branch}`, { sha: commit.sha, force: false })
    else await api('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha })
    return await finish(commit.sha, pr)

    async function finish(commitSha, existing) {
      const receipt = {
        version: 1,
        publisherRunId: trust.publisherRunId,
        sourceRunId: trust.runId,
        appId: trust.appId,
        branch,
        head: commitSha,
        payload,
        pr: existing?.number ?? null,
      }
      await checkpoint(receipt)
      requireValue((await api('GET', refPath))?.object.sha === commitSha, 'stale_head')
      const body = [
        `Исходное обращение: #${context.source}; спецификация: #${context.spec}.`,
        `Согласование: https://github.com/${repository}/issues/${context.source}#issuecomment-${context.approval}`,
        context.tickets.map((n) => `Closes #${n}`).join('\n'),
        `Проверки: implementation-check, mise run check; подготовленный base/head: ${context.base} / ${context.expectedHead}.`,
        `Публикуемый SHA: ${commitSha}. Actions: https://github.com/${repository}/actions/runs/${run.id}`,
        `Риск: ${result.risk}`,
        `Откат: ${result.rollback}`,
      ].join('\n\n')
      const published =
        existing ??
        (await api('POST', '/pulls', {
          title: result.message,
          body,
          head: branch,
          base: 'main',
          draft: true,
        }))
      if (existing && (existing.title !== result.message || existing.body !== body))
        await api('PATCH', `/pulls/${existing.number}`, { title: result.message, body })
      receipt.pr = published.number
      await checkpoint(receipt)
      if (result.ready && published.draft)
        await api('POST', '/graphql', {
          query:
            'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{id}}}',
          variables: { id: published.node_id },
        })
      if (!result.ready && !published.draft)
        await api('POST', '/graphql', {
          query:
            'mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){pullRequest{id}}}',
          variables: { id: published.node_id },
        })
      return receipt
    }
  } catch (error) {
    // Never expose API bodies, tokens, file contents or arbitrary error text.
    const safe = new Set([
      'trust',
      'origin',
      'checks',
      'context',
      'result',
      'verification',
      'approval',
      'commit_message',
      'protected_path',
      'pr_ownership',
      'branch_ownership',
      'publication_history',
      'stale_head',
      'commit_sha',
    ])
    const failure = new Error(safe.has(error.message) ? error.message : 'github_api')
    failure.state = state
    throw failure
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.env.PUBLISH_IO
  const read = async (name, file = name) => {
    const text = await readFile(`${directory}/${name}/${file}.json`, 'utf8')
    requireValue(Buffer.byteLength(text) <= 2_000_000, 'result')
    return JSON.parse(text)
  }
  const token = process.env.GH_TOKEN
  const api = async (method, path, data) => {
    const url =
      path === '/graphql'
        ? 'https://api.github.com/graphql'
        : `https://api.github.com/repos/${repository}${path}`
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    })
    if (response.status === 404 && path.startsWith('/git/ref/heads/')) return null
    if (!response.ok) throw new Error('github_api')
    const value = await response.json()
    if (value.errors) throw new Error('github_api')
    return value
  }
  try {
    const trust = {
      trustedSha: process.env.TRUSTED_SHA,
      runId: Number(process.env.SOURCE_RUN_ID),
      publisherRunId: Number(process.env.GITHUB_RUN_ID),
      runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      appId: Number(process.env.PUBLISH_APP_BOT_ID),
      verification: await read('verification'),
    }
    if (process.env.PREVIOUS_RUN_ID) {
      trust.previous = await read('previous', 'publication')
      trust.previousRunId = Number(process.env.PREVIOUS_RUN_ID)
    }
    if (process.env.RECOVERY_ARTIFACT_ID) trust.recovery = await read('recovery', 'publication')
    await publishImplementation(
      await read('result'),
      await read('context'),
      api,
      trust,
      (receipt) => writeFile(`${directory}/publication.json`, JSON.stringify(receipt)),
    )
  } catch (error) {
    console.error(
      JSON.stringify({
        reason: error.state ? error.message : 'input',
        state: error.state ?? 'unknown',
      }),
    )
    process.exitCode = 1
  }
}
