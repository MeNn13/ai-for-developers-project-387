import assert from 'node:assert/strict'
import test from 'node:test'
import { protocolInstruction, protocolExamples, validateReply } from './opencode-protocol.mjs'
import { resultReply } from './opencode.mjs'
import { failureNotice, diagnosticFor, DiagnosticError } from './opencode-diagnostic.mjs'

const schemaFailureCases = [
  ['missing', 'blockedBy', (item) => delete item.blockedBy, /Отсутствует обязательное поле/],
  ['type', 'blockedBy', (item) => (item.blockedBy = null), /Неверный тип/],
  ['empty', 'title', (item) => (item.title = '\u00a0\uFEFF'), /Пустое значение/],
  ['too_long', 'title', (item) => (item.title = '😀'.repeat(101)), /Превышен допустимый размер/],
  ['invalid', 'key', (item) => (item.key = 'fake secret'), /Недопустимое значение/],
  [
    'duplicate_dependency',
    'blockedBy',
    (item) => (item.blockedBy = ['first', 'first']),
    /Повтор зависимости/,
  ],
  [
    'reference',
    'blockedBy',
    (item) => (item.blockedBy = ['fake-secret']),
    /Ссылка ведёт не на ранее/,
  ],
]

test('every schema reason gives a fixed explanation with no response values', () => {
  for (const [reason, field, change, explanation] of schemaFailureCases) {
    const reply = structuredClone(protocolExamples[2])
    change(reply.publication.items[1])
    const stream = [
      { type: 'text', part: { messageID: 'last', text: JSON.stringify(reply) } },
      { type: 'step_finish', part: { reason: 'stop' } },
    ]
      .map(JSON.stringify)
      .join('\n')
    assert.throws(
      () => resultReply(stream),
      (error) => {
        assert.equal(error.diagnostic.details.reason, reason)
        assert.equal(error.diagnostic.details.field, field)
        const serialized = JSON.stringify(diagnosticFor(error))
        assert.ok(Buffer.byteLength(serialized) <= 1024)
        const notice = failureNotice(error.diagnostic, 'run')
        assert.match(notice, explanation)
        assert.doesNotMatch(serialized + notice, /fake.secret|😀/)
        return true
      },
    )
  }
  const duplicate = structuredClone(protocolExamples[2])
  duplicate.publication.items[1].key = 'first'
  const stream = [
    { type: 'text', part: { messageID: 'last', text: JSON.stringify(duplicate) } },
    { type: 'step_finish', part: { reason: 'stop' } },
  ]
    .map(JSON.stringify)
    .join('\n')
  assert.throws(
    () => resultReply(stream),
    (error) => {
      assert.equal(error.diagnostic.details.reason, 'duplicate_key')
      assert.match(failureNotice(error.diagnostic, 'run'), /Повтор ключа/)
      return true
    },
  )
})

test('v3 diagnostics reject injected fields, unknown reasons and mismatched rules', () => {
  const good = {
    version: 3,
    code: 'reply_schema',
    stage: 'reply',
    details: { rule: 'item_blockers', field: 'blockedBy', reason: 'missing' },
  }
  for (const bad of [
    { ...good, extra: 'fake-secret' },
    { ...good, stage: 'files' },
    { ...good, details: { ...good.details, extra: 'fake-secret' } },
    { ...good, details: { ...good.details, field: 'fake-secret' } },
    { ...good, details: { ...good.details, reason: 'fake-secret' } },
    { ...good, details: { ...good.details, reason: ['type'] } },
    { ...good, details: { ...good.details, rule: ['item_blockers'] } },
    { ...good, details: { ...good.details, rule: 'item_key' } },
  ]) {
    assert.match(failureNotice(bad, 'run'), /При частичной публикации/)
    assert.doesNotMatch(failureNotice(bad, 'run'), /fake-secret/)
    const error = new DiagnosticError('reply_schema', good.details)
    error.diagnostic = bad
    assert.equal(diagnosticFor(error).code, 'unknown')
  }
})

test('missing blockedBy reports a safe actionable reason', () => {
  const reply = structuredClone(protocolExamples[1])
  delete reply.publication.items[0].blockedBy
  const stream = [
    { type: 'text', part: { messageID: 'last', text: JSON.stringify(reply) } },
    { type: 'step_finish', part: { reason: 'stop' } },
  ]
    .map(JSON.stringify)
    .join('\n')
  assert.throws(
    () => resultReply(stream),
    (error) => {
      assert.equal(error.diagnostic.version, 3)
      assert.deepEqual(error.diagnostic.details, {
        rule: 'item_blockers',
        field: 'blockedBy',
        reason: 'missing',
      })
      assert.match(
        failureNotice(error.diagnostic, 'run'),
        /Отсутствует обязательное поле.*blockedBy/,
      )
      return true
    },
  )
})

test('published protocol examples are accepted by preparation and public validation', () => {
  for (const example of protocolExamples) {
    assert.doesNotThrow(() => validateReply(example))
    const stream = [
      { type: 'text', part: { messageID: 'last', text: JSON.stringify(example) } },
      { type: 'step_finish', part: { reason: 'stop' } },
    ]
      .map(JSON.stringify)
      .join('\n')
    assert.deepEqual(resultReply(stream), example)
    assert.ok(protocolInstruction().includes(JSON.stringify(example)))
  }
})

test('compatibility preserves optional publication, extra fields and UTF-16 whitespace boundaries', () => {
  const stream = (reply) =>
    [
      { type: 'text', part: { messageID: 'last', text: JSON.stringify(reply) } },
      { type: 'step_finish', part: { reason: 'stop' } },
    ]
      .map(JSON.stringify)
      .join('\n')
  for (const reply of [
    { version: 1, comment: ' \uFEFFhello\u00a0 ', extra: true },
    { version: 1, comment: 'a'.repeat(500_000), publication: null },
    { ...structuredClone(protocolExamples[1]), extra: true },
    {
      ...structuredClone(protocolExamples[2]),
      publication: {
        ...structuredClone(protocolExamples[2].publication),
        spec: Number.MAX_SAFE_INTEGER,
        approvalComment: Number.MAX_SAFE_INTEGER,
      },
    },
  ])
    assert.deepEqual(resultReply(stream(reply)), reply)
  const spec = structuredClone(protocolExamples[1])
  spec.publication.items[0].title = ' ' + '😀'.repeat(99) + 'x'
  spec.publication.items[0].body = '😀'.repeat(25_000)
  assert.deepEqual(resultReply(stream(spec)), spec)
  spec.publication.items[0].title += 'x'
  assert.throws(() => resultReply(stream(spec)))
  spec.publication.items[0].title = '\uFEFF\u00a0'
  assert.throws(() => resultReply(stream(spec)))
  const tickets = structuredClone(protocolExamples[2])
  tickets.publication.spec = Number.MAX_SAFE_INTEGER + 1
  assert.throws(() => resultReply(stream(tickets)))
})
