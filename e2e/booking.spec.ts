import { expect, test, type Page } from '@playwright/test'

async function selectLastWorkingDay(page: Page) {
  // Prefer the last working day so a run near today's closing time has future slots.
  await expect(page.getByRole('status', { name: 'Загрузка слотов' })).toHaveCount(0)
  const nextMonth = page.getByRole('button', { name: 'Следующий месяц' })
  if (await nextMonth.isEnabled()) {
    await nextMonth.click()
  }
  for (const day of (await page.getByRole('table').getByRole('button').all()).reverse()) {
    if (await day.isEnabled()) {
      const label = await day.getAttribute('aria-label')
      expect(label).toBeTruthy()
      await day.click()
      return label ?? ''
    }
  }
  throw new Error('No working day in the booking window')
}

test('guest recovers from an overlapping booking in another tab', async ({ page, context }) => {
  await page.goto('/owner')
  for (const [title, duration] of [
    ['Long browser meeting', '60'],
    ['Short browser meeting', '30'],
  ]) {
    await page.getByLabel('Название', { exact: true }).fill(title)
    await page.getByLabel('Описание', { exact: true }).fill('Overlap recovery')
    await page.getByLabel('Длительность, мин').fill(duration)
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    await expect(page.getByText('Тип встречи создан', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Название', { exact: true })).toHaveValue('')
  }

  await page.goto('/book')
  await page.getByRole('button', { name: /Long browser meeting/ }).click()
  const day = await selectLastWorkingDay(page)
  const longSlot = page.getByRole('button', { name: /^\d{2}:\d{2}–\d{2}:\d{2}$/ }).first()
  await expect(longSlot).toBeEnabled()
  const longTime = await longSlot.innerText()
  await longSlot.click()
  await page.getByLabel('Ваше имя').fill('Overlap Winner')

  const other = await context.newPage()
  await other.goto('/book')
  await other.getByRole('button', { name: /Short browser meeting/ }).click()
  expect(await selectLastWorkingDay(other)).toBe(day)
  // The last half-hour of the 60-minute interval has a different start.
  const end = longTime.slice(-5)
  const [hour, minute] = end.split(':').map(Number)
  const startMinutes = hour * 60 + minute - 30
  const start = `${Math.floor(startMinutes / 60)
    .toString()
    .padStart(2, '0')}:${(startMinutes % 60).toString().padStart(2, '0')}`
  const staleTime = `${start}–${end}`
  await other.getByRole('button', { name: staleTime, exact: true }).click()
  await other.getByLabel('Ваше имя').fill('Retrying Guest')

  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Встреча забронирована' })).toBeVisible()
  await expect(page.getByText(/\(МСК\)$/)).toContainText(longTime)

  const conflictResponse = other.waitForResponse(
    (response) =>
      response.url().endsWith('/api/meetings') && response.request().method() === 'POST',
  )
  await other.getByRole('button', { name: 'Продолжить', exact: true }).click()
  const conflict = await conflictResponse
  expect(conflict.status()).toBe(409)
  expect(await conflict.json()).toMatchObject({ type: 'slot-taken' })
  await expect(other.getByText('Это время только что заняли. Выберите другое время.')).toBeVisible()
  await expect(other.getByRole('status', { name: 'Загрузка слотов' })).toHaveCount(0)
  await expect(
    other.getByRole('button', { name: `${staleTime} занято`, exact: true }),
  ).toBeDisabled()
  await expect(other.getByLabel('Ваше имя')).toHaveValue('Retrying Guest')
  await expect(other.getByRole('button', { name: 'Продолжить', exact: true })).toBeDisabled()

  const retrySlot = other.getByRole('button', { name: /^\d{2}:\d{2}–\d{2}:\d{2}$/ }).first()
  const retryTime = await retrySlot.innerText()
  await retrySlot.click()
  await expect(other.getByLabel('Ваше имя')).toHaveValue('Retrying Guest')
  await other.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(other.getByRole('heading', { name: 'Встреча забронирована' })).toBeVisible()
  await expect(other.getByText('Short browser meeting', { exact: true })).toBeVisible()
  await expect(other.getByText('Retrying Guest', { exact: true })).toBeVisible()
  const confirmation = other.getByText(/\(МСК\)$/)
  await expect(confirmation).toContainText(retryTime)
  await expect(confirmation).toContainText(day.replace(/\s+\d{4}$/, ''))
  const retryWhen = (await confirmation.innerText()).replace(' (МСК)', '')

  await page.goto('/owner')
  const firstMeeting = page.getByRole('row').filter({ hasText: 'Overlap Winner' })
  await expect(firstMeeting).toHaveCount(1)
  await expect(firstMeeting).toContainText('Long browser meeting')
  await expect(firstMeeting).toContainText(longTime)
  await expect(firstMeeting).toContainText('60 мин')
  const retryMeeting = page.getByRole('row').filter({ hasText: 'Retrying Guest' })
  await expect(retryMeeting).toHaveCount(1)
  await expect(retryMeeting).toContainText('Short browser meeting')
  await expect(retryMeeting).toContainText('30 мин')
  await expect(retryMeeting).toContainText(retryWhen)
  await expect(retryMeeting).not.toContainText(staleTime)
})

test('owner creates a meeting type and sees the guest booking', async ({ page }) => {
  await page.goto('/owner')
  await page.getByLabel('Название', { exact: true }).fill('Browser consultation')
  await page.getByLabel('Описание', { exact: true }).fill('A real browser booking')
  await page.getByLabel('Длительность, мин').fill('30')
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByText('Тип встречи создан', { exact: true })).toBeVisible()

  await page.goto('/book')
  await page.getByRole('button', { name: /Browser consultation/ }).click()
  const day = await selectLastWorkingDay(page)
  const slot = page.getByRole('button', { name: /^\d{2}:\d{2}–\d{2}:\d{2}$/ }).first()
  await expect(slot).toBeEnabled()
  const time = await slot.innerText()
  await slot.click()
  await page.getByLabel('Ваше имя').fill('Browser Guest')
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Встреча забронирована' })).toBeVisible()
  await expect(page.getByText('Browser consultation', { exact: true })).toBeVisible()
  await expect(page.getByText('Browser Guest', { exact: true })).toBeVisible()
  const confirmation = page.getByText(/\(МСК\)$/)
  await expect(confirmation).toContainText(time)
  expect(day).toBeTruthy()
  await expect(confirmation).toContainText(day.replace(/\s+\d{4}$/, ''))
  const when = (await confirmation.innerText()).replace(' (МСК)', '')

  await page.goto('/owner')
  const meeting = page.getByRole('row').filter({ hasText: 'Browser Guest' })
  await expect(meeting).toContainText('Browser consultation')
  await expect(meeting).toContainText('30 мин')
  await expect(meeting).toContainText(when)
  await expect(meeting).toHaveCount(1)
})
