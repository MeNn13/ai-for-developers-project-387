const positive = (value) => Number.isSafeInteger(value) && value > 0
const limits = { comment: 500_000, items: 20, title: 200, body: 50_000 }
const keyPattern = /^[a-z][a-z0-9-]{0,39}$/

export const protocolExamples = [
  { version: 1, comment: 'Russian response in Markdown', publication: null },
  {
    version: 1,
    comment: 'Specification',
    publication: {
      kind: 'spec',
      items: [
        {
          key: 'spec',
          title: 'Specification',
          body: 'Full specification following skill template',
          blockedBy: [],
        },
      ],
    },
  },
  {
    version: 1,
    comment: 'Approved tickets',
    publication: {
      kind: 'tickets',
      spec: 123,
      approvalComment: 456,
      items: [
        {
          key: 'first',
          title: 'First ticket',
          body: 'Full ticket following skill template',
          blockedBy: [],
        },
        {
          key: 'second',
          title: 'Second ticket',
          body: 'Full ticket following skill template',
          blockedBy: ['first'],
        },
      ],
    },
  },
]

export function protocolInstruction() {
  return [
    'OUTPUT PROTOCOL: Return one JSON object, without markdown fences.',
    'version must be 1. comment must be a nonempty string after JavaScript trim(), at most ' +
      limits.comment +
      ' UTF-16 code units.',
    'publication may be absent or null; additional fields are allowed.',
    'publication.kind must be spec or tickets. items must contain 1 to ' +
      limits.items +
      ' entries; spec has exactly one.',
    'tickets requires spec and approvalComment to be positive safe integers (at most ' +
      Number.MAX_SAFE_INTEGER +
      ').',
    'Every item requires a unique key matching ' +
      keyPattern.source +
      ', a title and body nonempty after JavaScript trim().',
    'title limit: ' +
      limits.title +
      '; body limit: ' +
      limits.body +
      ' UTF-16 code units, including outer whitespace.',
    'Every item requires blockedBy: an array of unique keys referring only to earlier items. For spec it must be empty.',
    'Examples:',
    ...protocolExamples.map((example) => JSON.stringify(example)),
  ].join('\n')
}

function text(value, limit) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit
}

export class ReplyValidationError extends Error {
  constructor(rule) {
    super('Invalid OpenCode reply schema')
    this.rule = rule
  }
}

function requireReply(condition, rule) {
  if (!condition) throw new ReplyValidationError(rule)
}

export function validateReply(reply) {
  requireReply(reply?.version === 1 && text(reply.comment, limits.comment), 'version_comment')
  const publication = reply.publication
  if (publication == null) return
  requireReply(['spec', 'tickets'].includes(publication.kind), 'publication_kind')
  requireReply(
    Array.isArray(publication.items) &&
      publication.items.length > 0 &&
      publication.items.length <= limits.items,
    'publication_items',
  )
  if (publication.kind === 'spec') requireReply(publication.items.length === 1, 'spec_item_count')
  else
    requireReply(
      positive(publication.spec) && positive(publication.approvalComment),
      'ticket_references',
    )
  const keys = new Set()
  for (const item of publication.items) {
    requireReply(
      typeof item.key === 'string' && keyPattern.test(item.key) && !keys.has(item.key),
      'item_key',
    )
    requireReply(text(item.title, limits.title) && text(item.body, limits.body), 'item_text')
    requireReply(
      Array.isArray(item.blockedBy) && new Set(item.blockedBy).size === item.blockedBy.length,
      'item_blockers',
    )
    requireReply(
      item.blockedBy.every((key) => keys.has(key)),
      'blocker_order',
    )
    if (publication.kind === 'spec') requireReply(item.blockedBy.length === 0, 'spec_blockers')
    keys.add(item.key)
  }
}
