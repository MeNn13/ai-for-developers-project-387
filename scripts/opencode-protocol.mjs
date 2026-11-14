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

export class ReplyValidationError extends Error {
  constructor(rule, field, reason) {
    super('Invalid OpenCode reply schema')
    this.rule = rule
    this.field = field
    this.reason = reason
  }
}
function requireReply(condition, rule, field, reason = 'invalid') {
  if (!condition) throw new ReplyValidationError(rule, field, reason)
}
function typed(value, type, rule, field) {
  requireReply(value !== undefined, rule, field, 'missing')
  requireReply(
    type === 'array'
      ? Array.isArray(value)
      : type === 'object'
        ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : typeof value === type,
    rule,
    field,
    'type',
  )
}
function text(value, limit, rule, field) {
  typed(value, 'string', rule, field)
  requireReply(value.trim().length > 0, rule, field, 'empty')
  requireReply(value.length <= limit, rule, field, 'too_long')
}
export function validateReply(reply) {
  typed(reply, 'object', 'version_comment', 'reply')
  typed(reply.version, 'number', 'version_comment', 'version')
  requireReply(reply.version === 1, 'version_comment', 'version')
  text(reply.comment, limits.comment, 'version_comment', 'comment')
  const publication = reply.publication
  if (publication == null) return
  typed(publication, 'object', 'publication_kind', 'publication')
  typed(publication.kind, 'string', 'publication_kind', 'kind')
  requireReply(['spec', 'tickets'].includes(publication.kind), 'publication_kind', 'kind')
  typed(publication.items, 'array', 'publication_items', 'items')
  requireReply(publication.items.length > 0, 'publication_items', 'items', 'empty')
  requireReply(publication.items.length <= limits.items, 'publication_items', 'items', 'too_long')
  if (publication.kind === 'spec')
    requireReply(publication.items.length === 1, 'spec_item_count', 'items')
  else
    for (const field of ['spec', 'approvalComment']) {
      typed(publication[field], 'number', 'ticket_references', field)
      requireReply(positive(publication[field]), 'ticket_references', field)
    }
  const keys = new Set()
  for (const item of publication.items) {
    typed(item, 'object', 'item_key', 'item')
    typed(item.key, 'string', 'item_key', 'key')
    requireReply(item.key.length > 0, 'item_key', 'key', 'empty')
    requireReply(item.key.length <= 40, 'item_key', 'key', 'too_long')
    requireReply(keyPattern.test(item.key), 'item_key', 'key')
    requireReply(!keys.has(item.key), 'item_key', 'key', 'duplicate_key')
    text(item.title, limits.title, 'item_text', 'title')
    text(item.body, limits.body, 'item_text', 'body')
    typed(item.blockedBy, 'array', 'item_blockers', 'blockedBy')
    requireReply(
      new Set(item.blockedBy).size === item.blockedBy.length,
      'item_blockers',
      'blockedBy',
      'duplicate_dependency',
    )
    for (const key of item.blockedBy) {
      typed(key, 'string', 'blocker_order', 'blockedBy')
      requireReply(keys.has(key), 'blocker_order', 'blockedBy', 'reference')
    }
    if (publication.kind === 'spec')
      requireReply(item.blockedBy.length === 0, 'spec_blockers', 'blockedBy')
    keys.add(item.key)
  }
}
