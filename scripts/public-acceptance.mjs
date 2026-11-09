import assert from 'node:assert/strict'

const base = 'https://booking-calendar-i16y.onrender.com'
console.log(`Public HTTP acceptance: ${base}, ${new Date().toISOString()}`)
async function request(path, body) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  })
  const text = await response.text()
  const result = { path, status: response.status, body: text }
  console.log(JSON.stringify(result))
  return {
    status: response.status,
    data: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text,
  }
}
assert.deepEqual(await request('/api/health'), { status: 200, data: { status: 'ok' } })
for (const path of ['/', '/book', '/owner']) {
  const result = await request(path)
  assert.equal(result.status, 200)
  assert.match(result.data, /id="root"/)
}
const id = 'acceptance-' + Date.now()
assert.equal(
  (
    await request('/api/meeting-types', {
      id,
      title: 'Public acceptance',
      description: 'Deployment verification',
      durationMinutes: 60,
    })
  ).status,
  201,
)
const slots = await request('/api/slots?meetingTypeId=' + id)
assert.equal(slots.status, 200)
const slot = slots.data.days
  .flatMap((day) => day.slots)
  .find(
    (slot) =>
      slot.available && new Date(slot.start) > new Date() && slot.start.includes('10:00:00'),
  )
assert.ok(slot, 'future 10:00 slot exists')
const booking = { meetingTypeId: id, start: slot.start, guestName: 'Deployment acceptance' }
const created = await request('/api/meetings', booking)
assert.equal(created.status, 201)
const meetings = await request('/api/meetings')
assert.equal(meetings.status, 200)
assert.ok(
  meetings.data.some(
    (meeting) => meeting.id === created.data.id && meeting.guestName === booking.guestName,
  ),
)
for (const start of [
  slot.start,
  new Date(new Date(slot.start).getTime() + 30 * 60000).toISOString(),
]) {
  const rejected = await request('/api/meetings', { ...booking, start })
  assert.equal(rejected.status, 409)
  assert.equal(rejected.data.type, 'slot-taken')
}
console.log('PUBLIC ACCEPTANCE PASSED')
