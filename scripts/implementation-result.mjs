import { allowedPath, existingDocument } from './implementation-publish.mjs'

const maxMessage = 72
const maxFiles = 200
const maxBytes = 2_000_000
const commitTypes = 'feat|fix|test|refactor|docs'
const commitPattern = new RegExp(
  `^(${commitTypes})(\\([a-z]+\\))?: [a-z][\\x20-\\x7e]* \\(#\\d+\\)$`,
)
export const generated = (path) =>
  /^(?:frontend\/src\/api\/generated|backend\/BookingCalendar\.Api\/Generated|contract\/openapi)\//i.test(
    path,
  )

export function resultInstructions(ticket) {
  const example = {
    version: 1,
    message: `fix: update calendar behavior (#${ticket})`,
    files: [{ path: 'frontend/src/calendar.ts', mode: '100644', content: 'export {}\n' }],
    risk: 'Describe the consequences.',
    rollback: 'Explain whether reverting code suffices for data.',
  }
  return [
    `Change object example: ${JSON.stringify(example)}`,
    'Use exactly those keys in the change object and each file object. Risk and rollback must be nonblank.',
    `Use one English Conventional Commit line of at most ${maxMessage} characters. Allowed types: ${commitTypes.replaceAll('|', ', ')}. Use an optional lowercase alphabetic scope and end with (#N) for a ticket in scope.`,
    `Include 1 to ${maxFiles} distinct repository-relative paths (case insensitive) and keep the change object within ${maxBytes} UTF-8 bytes. Use mode "100644" and full text, or null for an allowed deletion.`,
    'Protected paths cannot change. Root GLOSSARY.md and README.md can only be edited if they already exist.',
    'For contract changes include contract/main.tsp. The controller generates OpenAPI, the TypeScript client and C# DTOs. Omit generated files.',
  ].join('\n')
}

export class InvalidResult extends Error {}

// Field names and rules are supplied exclusively by the validators below.
function requireResult(ok, field, rule, details = '') {
  if (!ok) throw new InvalidResult(`field=${field} rule=${rule}${details}`)
}

function keys(value, fields, field, details) {
  requireResult(
    value && typeof value === 'object' && !Array.isArray(value),
    field,
    'object',
    details,
  )
  for (const key of fields)
    requireResult(Object.hasOwn(value, key), `${field}.${key}`, 'required', details)
  requireResult(Object.keys(value).length === fields.length, field, 'exact_keys', details)
}

const nonempty = (value) => typeof value === 'string' && value.trim().length > 0

export function validateChanges(reply, tickets, field = 'result') {
  keys(reply, ['version', 'message', 'files', 'risk', 'rollback'], field)
  requireResult(reply.version === 1, `${field}.version`, 'expected_version', ' expected=1')
  const message = `${field}.message`
  requireResult(typeof reply.message === 'string', message, 'string')
  requireResult(reply.message.length <= maxMessage, message, 'max_length', ` max=${maxMessage}`)
  requireResult(
    !/[\r\n]/.test(reply.message) && commitPattern.test(reply.message),
    message,
    'conventional_commit',
  )
  requireResult(
    tickets.some((n) => reply.message.endsWith(`(#${n})`)),
    message,
    'approved_ticket',
  )
  const files = `${field}.files`
  requireResult(Array.isArray(reply.files), files, 'array')
  requireResult(
    reply.files.length > 0 && reply.files.length <= maxFiles,
    files,
    'file_count',
    ` min=1 max=${maxFiles}`,
  )
  const seen = new Set()
  for (const [index, file] of reply.files.entries()) {
    const details = ` index=${index}`
    keys(file, ['path', 'mode', 'content'], files, details)
    requireResult(typeof file.path === 'string', `${files}.path`, 'string', details)
    requireResult(!generated(file.path), `${files}.path`, 'generated_path', details)
    requireResult(allowedPath(file.path), `${files}.path`, 'protected_path', details)
    const path = file.path.toLowerCase()
    requireResult(!seen.has(path), `${files}.path`, 'duplicate_path', details)
    seen.add(path)
    requireResult(file.mode === '100644', `${files}.mode`, 'regular_file', details)
    requireResult(
      file.content === null || typeof file.content === 'string',
      `${files}.content`,
      'string_or_null',
      details,
    )
    requireResult(
      file.content !== null || !existingDocument(file.path),
      `${files}.content`,
      'document_deletion',
      details,
    )
  }
  for (const key of ['risk', 'rollback'])
    requireResult(nonempty(reply[key]), `${field}.${key}`, 'nonblank')
  requireResult(
    Buffer.byteLength(JSON.stringify(reply)) <= maxBytes,
    field,
    'max_bytes',
    ` max=${maxBytes}`,
  )
}

export function validateExistingDocuments(files, exists, field = 'result') {
  for (const [index, { path }] of files.entries()) {
    if (existingDocument(path))
      requireResult(exists(path), `${field}.files.path`, 'existing_document', ` index=${index}`)
  }
}
