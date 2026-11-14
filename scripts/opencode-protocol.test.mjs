import assert from 'node:assert/strict'
import test from 'node:test'
import { protocolInstruction, protocolExamples, validateReply } from './opencode-protocol.mjs'
import { resultReply } from './opencode.mjs'

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
