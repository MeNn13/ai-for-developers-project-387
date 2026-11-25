import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingPage } from './BookingPage'

vi.mock('../api/generated/booking', () => ({
  listMeetingTypes: vi.fn(),
  listSlots: vi.fn(),
  createMeeting: vi.fn(),
}))

import { createMeeting, listMeetingTypes, listSlots } from '../api/generated/booking'
import type { Meeting, MeetingType, Slot, SlotsResponse } from '../api/generated/booking'

const meetingTypes: MeetingType[] = [
  {
    id: 'znakomstvo',
    title: 'Знакомство',
    description: '',
    durationMinutes: 30,
  },
]

const freeSlot: Slot = {
  start: '2026-11-02T10:00:00+03:00',
  end: '2026-11-02T10:30:00+03:00',
  available: true,
}

const slotsResponse: SlotsResponse = {
  timezone: 'Europe/Moscow',
  window: { from: '2026-11-02', to: '2026-11-15' },
  days: [
    { date: '2026-11-02', slots: [freeSlot] },
    ...Array.from({ length: 13 }, (_, offset) => ({
      date: new Date(Date.UTC(2026, 10, 3 + offset)).toISOString().slice(0, 10),
      slots: [],
    })),
  ],
}

const bookedMeeting: Meeting = {
  id: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
  meetingTypeId: 'znakomstvo',
  meetingTypeTitle: 'Знакомство',
  durationMinutes: 30,
  start: freeSlot.start,
  end: freeSlot.end,
  guestName: 'Анна',
}

function renderBookingPage() {
  return render(
    <MantineProvider defaultColorScheme="light">
      <MemoryRouter>
        <BookingPage />
      </MemoryRouter>
    </MantineProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('booking page book again', () => {
  it('recovers type selection after the types reload fails', async () => {
    const user = userEvent.setup()
    vi.mocked(listMeetingTypes)
      .mockResolvedValueOnce({ data: meetingTypes, status: 200, headers: new Headers() })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: meetingTypes, status: 200, headers: new Headers() })
    vi.mocked(listSlots).mockResolvedValue({
      data: slotsResponse,
      status: 200,
      headers: new Headers(),
    })
    vi.mocked(createMeeting).mockResolvedValue({
      data: bookedMeeting,
      status: 201,
      headers: new Headers(),
    })

    renderBookingPage()
    await user.click(await screen.findByRole('button', { name: /Знакомство/ }))
    await user.click(await screen.findByRole('button', { name: '10:00–10:30' }))
    await user.type(screen.getByLabelText('Ваше имя'), 'Анна')
    await user.click(screen.getByRole('button', { name: 'Продолжить' }))
    await screen.findByRole('heading', { name: 'Встреча забронирована' })

    await user.click(screen.getByRole('button', { name: 'Записаться на другую встречу' }))

    expect(await screen.findByText('Не удалось загрузить типы встреч')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible()
    expect(listMeetingTypes).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByRole('button', { name: /Знакомство/ })).toBeVisible()
    expect(screen.getByText('Выберите тип встречи')).toBeVisible()
    expect(screen.queryByText('Не удалось загрузить типы встреч')).not.toBeInTheDocument()
    expect(listMeetingTypes).toHaveBeenCalledTimes(3)

    await user.click(screen.getByRole('button', { name: /Знакомство/ }))
    expect(await screen.findByRole('button', { name: 'Изменить' })).toBeVisible()
  })
})
