import { createHash } from 'node:crypto'

const bot = (item) => item.user?.login === 'github-actions[bot]' && item.user?.type === 'Bot'
const allowedUsers = ['MeNn13']
export const trustedHuman = (item) =>
  allowedUsers.includes(item.user?.login) && item.user?.type === 'User'
const positive = (value) => Number.isSafeInteger(value) && value > 0

function requireValid(condition, message) {
  if (!condition) throw new Error(`Invalid OpenCode publication: ${message}`)
}

function text(value, limit) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit
}

export function validateReply(reply) {
  requireValid(reply?.version === 1 && text(reply.comment, 500_000), 'version or comment')
  const publication = reply.publication
  if (publication == null) return
  requireValid(['spec', 'tickets'].includes(publication.kind), 'kind')
  requireValid(
    Array.isArray(publication.items) &&
      publication.items.length > 0 &&
      publication.items.length <= 20,
    'items',
  )
  if (publication.kind === 'spec')
    requireValid(publication.items.length === 1, 'one specification required')
  else
    requireValid(
      positive(publication.spec) && positive(publication.approvalComment),
      'specification and approval required',
    )
  const keys = new Set()
  for (const item of publication.items) {
    requireValid(
      typeof item.key === 'string' &&
        /^[a-z][a-z0-9-]{0,39}$/.test(item.key) &&
        !keys.has(item.key),
      'unique item key',
    )
    requireValid(text(item.title, 200) && text(item.body, 50_000), 'title or body')
    requireValid(
      Array.isArray(item.blockedBy) && new Set(item.blockedBy).size === item.blockedBy.length,
      'blockers',
    )
    requireValid(
      item.blockedBy.every((key) => keys.has(key)),
      'blockers must precede the item',
    )
    if (publication.kind === 'spec')
      requireValid(item.blockedBy.length === 0, 'specification blockers')
    keys.add(item.key)
  }
}

async function list(api, path) {
  const results = []
  for (let page = 1; page <= 100; page++) {
    const batch = await api(
      'GET',
      `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
    )
    results.push(...batch)
    if (batch.length < 100) return results
  }
  throw new Error('GitHub result exceeds pagination limit.')
}

function stamped(body, runUrl) {
  // Keep a skill's required leading disclaimer at the start of its text.
  return `${body}\n\nOpenCode · [Actions](${runUrl})`
}

/** Only this boundary holds a write token. api accepts repo-relative paths, never model URLs. */
export async function publish(reply, context, api, runUrl) {
  validateReply(reply)
  requireValid(positive(context.number) && positive(context.requestId), 'source context')
  requireValid(
    trustedHuman(context.comments.find((comment) => comment.id === context.requestId) ?? {}),
    'trusted request',
  )
  const base = `https://github.com/${context.repository}/issues`
  const source = `${base}/${context.number}`
  const request = `${source}#issuecomment-${context.requestId}`
  const operation = `opencode:${context.number}:${context.requestId}`
  const publication = reply.publication
  let links = ''
  if (publication) {
    requireValid(!context.pr, 'publication is only available in issues')
    let spec
    if (publication.kind === 'tickets') {
      spec = [context, ...(context.related ?? [])].find(
        (issue) => issue.number === publication.spec,
      )
      requireValid(
        spec && !spec.pr && !spec.unavailable,
        'specification must be in supplied issue context',
      )
      const approval = context.comments.find(
        (comment) => comment.id === publication.approvalComment,
      )
      requireValid(
        approval && trustedHuman(approval) && approval.id <= context.requestId,
        'trusted approval in source discussion',
      )
    }
    // Preflight before creating any issue. Missing labels are a configuration error.
    await api('GET', '/labels/ready-for-agent')
    const existing = await list(api, '/issues?state=all')
    const created = new Map()
    const digest = createHash('sha256').update(JSON.stringify(publication)).digest('hex')
    for (const issue of existing.filter(
      (issue) => !issue.pull_request && bot(issue) && issue.body?.includes(`<!-- ${operation}:`),
    )) {
      requireValid(
        issue.body.includes(`<!-- payload:${digest} -->`),
        'rerun changed publication; use the original artifact',
      )
    }
    // Validate every recovered item before performing additional writes.
    for (const item of publication.items) {
      const marker = `<!-- ${operation}:${item.key} -->`
      const matches = existing.filter(
        (issue) => !issue.pull_request && bot(issue) && issue.body?.includes(marker),
      )
      requireValid(matches.length <= 1, 'duplicate publication markers')
      if (matches.length) {
        created.set(item.key, matches[0])
      }
    }
    for (const item of publication.items) {
      let issue = created.get(item.key)
      if (!issue) {
        const parent = spec
          ? `\n\nСпецификация: ${base}/${spec.number}\nСогласование разбиения: ${source}#issuecomment-${publication.approvalComment}`
          : ''
        const body = stamped(
          `${item.body}\n\nИсходное обращение: ${source}\nЗапрос публикации: ${request}${parent}\n\n<!-- ${operation}:${item.key} -->\n<!-- payload:${digest} -->`,
          runUrl,
        )
        issue = await api('POST', '/issues', {
          title: item.title,
          body,
          labels: ['ready-for-agent'],
        })
        created.set(item.key, issue)
      }
      if (spec) {
        const children = await list(api, `/issues/${spec.number}/sub_issues`)
        if (!children.some((child) => child.id === issue.id))
          await api('POST', `/issues/${spec.number}/sub_issues`, { sub_issue_id: issue.id })
        const blockers = await list(api, `/issues/${issue.number}/dependencies/blocked_by`)
        for (const key of item.blockedBy) {
          const blocker = created.get(key)
          if (!blockers.some((entry) => entry.id === blocker.id))
            await api('POST', `/issues/${issue.number}/dependencies/blocked_by`, {
              issue_id: blocker.id,
            })
        }
      }
    }
    links = '\n\n' + [...created.values()].map((issue) => `- ${base}/${issue.number}`).join('\n')
    if (spec && spec.number !== context.number) {
      await commentOnce(
        api,
        spec.number,
        `${operation}:index`,
        stamped(`Тикеты по обращению ${source}:${links}`, runUrl),
      )
    }
  }
  // Large ordinary answers remain supported, with stable per-comment retry markers.
  const answer = `${reply.comment}${links}`
  for (let start = 0; start < answer.length; start += 50_000) {
    await commentOnce(
      api,
      context.number,
      `${operation}:reply:${start}`,
      stamped(answer.slice(start, start + 50_000), runUrl),
    )
  }
}

async function commentOnce(api, number, key, body) {
  const marker = `<!-- ${key} -->`
  const comments = await list(api, `/issues/${number}/comments`)
  if (!comments.some((comment) => bot(comment) && comment.body?.includes(marker)))
    await api('POST', `/issues/${number}/comments`, { body: `${body}\n\n${marker}` })
}
