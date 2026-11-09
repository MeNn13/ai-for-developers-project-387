import { MantineProvider } from '@mantine/core'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingPage } from './BookingPage'

vi.mock('../api/generated/booking', () => ({
  listMeetingTypes: vi.fn(),
  listSlots: vi.fn(),
  createMeeting: vi.fn(),
}))

import { createMeeting, listMeetingTypes, listSlots } from '../api/generated/booking'
import type {
  Meeting,
  MeetingType,
  ProblemDetails,
  Slot,
  SlotDay,
  SlotsResponse,
  createMeetingResponse,
} from '../api/generated/booking'

const meetingTypes: MeetingType[] = [
  {
    id: 'znakomstvo',
    title: 'Знакомство',
    description: 'Короткий первый созвон.',
    durationMinutes: 30,
  },
  {
    id: 'razbor',
    title: 'Разбор',
    description: '',
    durationMinutes: 60,
  },
]

const freeSlot: Slot = {
  start: '2026-11-02T10:00:00+03:00',
  end: '2026-11-02T10:30:00+03:00',
  available: true,
}

const takenSlot: Slot = {
  start: '2026-11-02T10:30:00+03:00',
  end: '2026-11-02T11:00:00+03:00',
  available: false,
}

const bookedMeeting: Meeting = {
  id: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
  meetingTypeId: 'znakomstvo',
  meetingTypeTitle: 'Знакомство',
  durationMinutes: 30,
  start: '2026-11-02T10:00:00+03:00',
  end: '2026-11-02T10:30:00+03:00',
  guestName: 'Анна',
}

function windowDays(): SlotDay[] {
  return Array.from({ length: 14 }, (_, offset) => ({
    date: new Date(Date.UTC(2026, 10, 2 + offset)).toISOString().slice(0, 10),
    slots: [],
  }))
}

function slotsResponse(days: SlotDay[] = windowDays()): SlotsResponse {
  return {
    timezone: 'Europe/Moscow',
    window: { from: '2026-11-02', to: '2026-11-15' },
    days,
  }
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

function mockBookingData() {
  vi.mocked(listMeetingTypes).mockResolvedValue({
    data: meetingTypes,
    status: 200,
    headers: new Headers(),
  })
  vi.mocked(listSlots).mockResolvedValue({
    data: slotsResponse([
      { ...windowDays()[0], slots: [freeSlot, takenSlot] },
      ...windowDays().slice(1),
    ]),
    status: 200,
    headers: new Headers(),
  })
}

// Слоты одного дня окна: день приходит первым, остальные дни пустые.
function dayWithSlots(slots: Slot[]): SlotsResponse {
  return slotsResponse([{ ...windowDays()[0], slots }, ...windowDays().slice(1)])
}

// Слоты конкретного дня окна — чтобы проверить сохранение выбранного дня при перезапросе.
function windowWithSlots(dayIndex: number, slots: Slot[]): SlotsResponse {
  const days = windowDays().map((day, index) => (index === dayIndex ? { ...day, slots } : day))
  return slotsResponse(days)
}

// Тот же слот, что пытались забронировать, но уже занятый: так его отдаёт перезапрос.
const takenFormerFreeSlot: Slot = { ...freeSlot, available: false }
const lateFreeSlot: Slot = {
  start: '2026-11-02T11:00:00+03:00',
  end: '2026-11-02T11:30:00+03:00',
  available: true,
}

// Слоты на втором рабочем дне окна (ср, 4 ноября).
const laterFreeSlot: Slot = {
  start: '2026-11-04T10:00:00+03:00',
  end: '2026-11-04T10:30:00+03:00',
  available: true,
}
const takenLaterFreeSlot: Slot = { ...laterFreeSlot, available: false }
const takenLaterSlot: Slot = {
  start: '2026-11-04T10:30:00+03:00',
  end: '2026-11-04T11:00:00+03:00',
  available: false,
}

function rejection(
  status: 400 | 404 | 409,
  type: ProblemDetails['type'],
  errors?: ProblemDetails['errors'],
): createMeetingResponse {
  const data: ProblemDetails = {
    type,
    title: 'Отказ',
    status,
    detail: 'Проверьте выбранные значения.',
    instance: '/api/meetings',
    ...(errors ? { errors } : {}),
  }
  return { data, status, headers: new Headers() }
}

// Путь гостя до отправки: тип, свободный слот, имя, «Продолжить».
async function bookFreeSlotWithName(user: UserEvent, name: string) {
  await user.click(await screen.findByRole('button', { name: /Знакомство/ }))
  await user.click(await screen.findByRole('button', { name: '10:00–10:30' }))
  await user.type(screen.getByLabelText('Ваше имя'), name)
  await user.click(screen.getByRole('button', { name: 'Продолжить' }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('booking page', () => {
  it('shows type cards, the month calendar and slots of the selected type', async () => {
    const user = userEvent.setup()
    vi.mocked(listMeetingTypes).mockResolvedValue({
      data: meetingTypes,
      status: 200,
      headers: new Headers(),
    })
    vi.mocked(listSlots).mockResolvedValue({
      data: slotsResponse([
        { ...windowDays()[0], slots: [freeSlot, takenSlot] },
        ...windowDays().slice(1),
      ]),
      status: 200,
      headers: new Headers(),
    })

    renderBookingPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Бронирование' })).toBeVisible()
    expect(await screen.findByRole('button', { name: /Знакомство/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Разбор/ })).toBeVisible()
    expect(screen.getByRole('table')).toBeVisible()

    await user.click(screen.getByRole('button', { name: /Знакомство/ }))

    await waitFor(() => expect(listSlots).toHaveBeenCalledWith({ meetingTypeId: 'znakomstvo' }))
    expect(await screen.findByText('Время указано по Москве (UTC+3)')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeVisible()
    expect(screen.getByRole('button', { name: '10:00–10:30' })).toBeVisible()
    expect(screen.getByRole('button', { name: '10:30–11:00 занято' })).toBeVisible()
    // Первый тяжёлый тест файла: рендер Mantine-календаря не укладывался в
    // дефолтные 5 секунд на загруженном раннере CI.
  }, 15_000)

  it('disables taken slots, marks them busy and highlights the chosen slot', async () => {
    const user = userEvent.setup()
    vi.mocked(listMeetingTypes).mockResolvedValue({
      data: meetingTypes,
      status: 200,
      headers: new Headers(),
    })
    vi.mocked(listSlots).mockResolvedValue({
      data: slotsResponse([
        { ...windowDays()[0], slots: [freeSlot, takenSlot] },
        ...windowDays().slice(1),
      ]),
      status: 200,
      headers: new Headers(),
    })

    renderBookingPage()
    await user.click(await screen.findByRole('button', { name: /Знакомство/ }))

    const free = await screen.findByRole('button', { name: '10:00–10:30' })
    const taken = screen.getByRole('button', { name: '10:30–11:00 занято' })

    expect(free).toBeEnabled()
    expect(taken).toBeDisabled()

    await user.click(free)

    expect(free).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the type loading state and keeps the calendar inactive', () => {
    vi.mocked(listMeetingTypes).mockReturnValue(new Promise(() => {}))

    renderBookingPage()

    expect(screen.getByRole('status', { name: 'Загрузка типов встреч' })).toBeVisible()
    const dayButtons = within(screen.getByRole('table')).getAllByRole('button')
    expect(dayButtons.length).toBeGreaterThan(0)
    expect(dayButtons.every((button) => button.hasAttribute('disabled'))).toBe(true)
  })

  it('recovers from a types loading error with the retry button', async () => {
    const user = userEvent.setup()
    vi.mocked(listMeetingTypes)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: meetingTypes, status: 200, headers: new Headers() })

    renderBookingPage()

    expect(await screen.findByText('Не удалось загрузить типы встреч')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByRole('button', { name: /Знакомство/ })).toBeVisible()
    expect(listMeetingTypes).toHaveBeenCalledTimes(2)
  })

  it('explains that meeting types are not created yet and links to the owner page', async () => {
    vi.mocked(listMeetingTypes).mockResolvedValue({
      data: [],
      status: 200,
      headers: new Headers(),
    })

    renderBookingPage()

    expect(await screen.findByText('Типы встреч ещё не созданы')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Страница владельца' })).toHaveAttribute(
      'href',
      '/owner',
    )
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeVisible()
  })

  it('keeps only working days of the window active and marks today', async () => {
    const user = userEvent.setup()
    vi.mocked(listMeetingTypes).mockResolvedValue({
      data: meetingTypes,
      status: 200,
      headers: new Headers(),
    })
    vi.mocked(listSlots).mockResolvedValue({
      data: slotsResponse([{ ...windowDays()[0], slots: [freeSlot] }, ...windowDays().slice(1)]),
      status: 200,
      headers: new Headers(),
    })

    renderBookingPage()
    await user.click(await screen.findByRole('button', { name: /Знакомство/ }))
    await screen.findByRole('button', { name: '10:00–10:30' })

    // Сегодня — первый день окна: он отмечен бейджем и выбран по умолчанию.
    expect(screen.getByText('сегодня')).toBeVisible()
    expect(screen.getByRole('button', { name: '2 ноября 2026' })).toHaveAttribute(
      'data-selected',
      'true',
    )

    // Суббота и день за границей окна недоступны, ошибки при этом нет.
    expect(screen.getByRole('button', { name: '7 ноября 2026' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '16 ноября 2026' })).toBeDisabled()
  })

  it('asks to choose a meeting type while the calendar stays disabled', async () => {
    vi.mocked(listMeetingTypes).mockResolvedValue({
      data: meetingTypes,
      status: 200,
      headers: new Headers(),
    })

    renderBookingPage()

    expect(await screen.findByText('Выберите тип встречи')).toBeVisible()

    const dayButtons = within(screen.getByRole('table')).getAllByRole('button')
    expect(dayButtons.every((button) => button.hasAttribute('disabled'))).toBe(true)
  })

  it('recovers from a slots loading error with the retry button', async () => {
    const user = userEvent.setup()
    vi.mocked(listMeetingTypes).mockResolvedValue({
      data: meetingTypes,
      status: 200,
      headers: new Headers(),
    })
    vi.mocked(listSlots)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        data: slotsResponse([{ ...windowDays()[0], slots: [freeSlot] }, ...windowDays().slice(1)]),
        status: 200,
        headers: new Headers(),
      })

    renderBookingPage()
    await user.click(await screen.findByRole('button', { name: /Знакомство/ }))

    expect(await screen.findByText('Не удалось загрузить слоты')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByRole('button', { name: '10:00–10:30' })).toBeVisible()
    expect(listSlots).toHaveBeenCalledTimes(2)
  })

  it('tells the guest when the selected day has no free slots', async () => {
    const user = userEvent.setup()
    vi.mocked(listMeetingTypes).mockResolvedValue({
      data: meetingTypes,
      status: 200,
      headers: new Headers(),
    })
    vi.mocked(listSlots).mockResolvedValue({
      data: slotsResponse([{ ...windowDays()[0], slots: [takenSlot] }, ...windowDays().slice(1)]),
      status: 200,
      headers: new Headers(),
    })

    renderBookingPage()
    await user.click(await screen.findByRole('button', { name: /Знакомство/ }))

    expect(await screen.findByText('На этот день свободных слотов нет')).toBeVisible()
    expect(screen.getByRole('button', { name: '10:30–11:00 занято' })).toBeDisabled()
  })

  it('explains an empty window and refetches slots on refresh', async () => {
    const user = userEvent.setup()
    vi.mocked(listMeetingTypes).mockResolvedValue({
      data: meetingTypes,
      status: 200,
      headers: new Headers(),
    })
    vi.mocked(listSlots).mockResolvedValue({
      data: slotsResponse(),
      status: 200,
      headers: new Headers(),
    })

    renderBookingPage()
    await user.click(await screen.findByRole('button', { name: /Знакомство/ }))

    expect(await screen.findByText('В ближайшие 14 дней свободных слотов нет')).toBeVisible()

    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Обновить' }))

    await waitFor(() => expect(listSlots).toHaveBeenCalledTimes(2))
  })

  it('shows the slots freshness caption and refetches slots with the refresh button', async () => {
    const user = userEvent.setup()
    mockBookingData()

    renderBookingPage()
    await user.click(await screen.findByRole('button', { name: /Знакомство/ }))

    // Подпись свежести видна постоянно, пока слоты загружены, время — по Москве.
    expect(await screen.findByText(/^Обновлено в \d{2}:\d{2}$/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Обновить' }))

    await waitFor(() => expect(listSlots).toHaveBeenCalledTimes(2))
    // Подпись остаётся после перезапроса.
    expect(await screen.findByText(/^Обновлено в \d{2}:\d{2}$/)).toBeVisible()
  })

  it('returns to the type list through the change button', async () => {
    const user = userEvent.setup()
    vi.mocked(listMeetingTypes).mockResolvedValue({
      data: meetingTypes,
      status: 200,
      headers: new Headers(),
    })
    vi.mocked(listSlots).mockResolvedValue({
      data: slotsResponse([{ ...windowDays()[0], slots: [freeSlot] }, ...windowDays().slice(1)]),
      status: 200,
      headers: new Headers(),
    })

    renderBookingPage()
    await user.click(await screen.findByRole('button', { name: /Знакомство/ }))
    await screen.findByRole('button', { name: 'Изменить' })

    await user.click(screen.getByRole('button', { name: 'Изменить' }))

    expect(await screen.findByRole('button', { name: /Разбор/ })).toBeVisible()
    expect(screen.getByText('Выберите тип встречи')).toBeVisible()
  })

  it('activates the name field only after a slot is chosen', async () => {
    const user = userEvent.setup()
    mockBookingData()

    renderBookingPage()
    await user.click(await screen.findByRole('button', { name: /Знакомство/ }))

    const name = screen.getByLabelText('Ваше имя')
    expect(name).toBeVisible()
    expect(name).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '10:00–10:30' }))

    expect(name).toBeEnabled()
    expect(name).toHaveFocus()
  })

  it('keeps continue disabled until the guest name is filled', async () => {
    const user = userEvent.setup()
    mockBookingData()

    renderBookingPage()
    await user.click(await screen.findByRole('button', { name: /Знакомство/ }))
    await user.click(await screen.findByRole('button', { name: '10:00–10:30' }))

    const continueButton = screen.getByRole('button', { name: 'Продолжить' })
    expect(continueButton).toBeDisabled()

    await user.type(screen.getByLabelText('Ваше имя'), '   ')
    expect(continueButton).toBeDisabled()

    await user.type(screen.getByLabelText('Ваше имя'), 'Анна')
    expect(continueButton).toBeEnabled()
  })

  it('replaces the form with a confirmation after a successful booking', async () => {
    const user = userEvent.setup()
    mockBookingData()
    vi.mocked(createMeeting).mockResolvedValue({
      data: bookedMeeting,
      status: 201,
      headers: new Headers(),
    })

    renderBookingPage()
    await user.click(await screen.findByRole('button', { name: /Знакомство/ }))
    await user.click(await screen.findByRole('button', { name: '10:00–10:30' }))
    await user.type(screen.getByLabelText('Ваше имя'), '  Анна  ')
    await user.click(screen.getByRole('button', { name: 'Продолжить' }))

    expect(await screen.findByRole('heading', { name: 'Встреча забронирована' })).toBeVisible()
    expect(screen.getByText('Знакомство')).toBeVisible()
    expect(screen.getByText('Пн, 2 ноября, 10:00–10:30 (МСК)')).toBeVisible()
    expect(screen.getByText('Анна')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Продолжить' })).not.toBeInTheDocument()
    expect(createMeeting).toHaveBeenCalledWith({
      meetingTypeId: 'znakomstvo',
      start: '2026-11-02T10:00:00+03:00',
      guestName: 'Анна',
    })
  })

  it('returns to the initial state and refetches types on book again', async () => {
    const user = userEvent.setup()
    mockBookingData()
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

    await user.click(screen.getByRole('button', { name: 'Записаться ещё' }))

    expect(await screen.findByRole('button', { name: /Знакомство/ })).toBeVisible()
    expect(screen.queryByText('Встреча забронирована')).not.toBeInTheDocument()
    expect(listMeetingTypes).toHaveBeenCalledTimes(2)
  })

  it('clears the slot and the name on back while keeping the type and the day', async () => {
    const user = userEvent.setup()
    mockBookingData()

    renderBookingPage()
    await user.click(await screen.findByRole('button', { name: /Знакомство/ }))
    await user.click(await screen.findByRole('button', { name: '10:00–10:30' }))
    await user.type(screen.getByLabelText('Ваше имя'), 'Анна')

    await user.click(screen.getByRole('button', { name: 'Назад' }))

    expect(screen.getByLabelText('Ваше имя')).toHaveValue('')
    expect(screen.getByLabelText('Ваше имя')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeVisible()
    expect(screen.getByRole('button', { name: '10:00–10:30' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: '2 ноября 2026' })).toHaveAttribute(
      'data-selected',
      'true',
    )
  })

  it('recovers from a slot-taken rejection by re-fetching slots and keeping the type and name', async () => {
    const user = userEvent.setup()
    mockBookingData()
    // Второй ответ слотов — тот же слот уже занят: так выглядит перезапрос после отказа.
    vi.mocked(listSlots)
      .mockResolvedValueOnce({
        data: dayWithSlots([freeSlot, takenSlot]),
        status: 200,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        data: dayWithSlots([takenFormerFreeSlot, takenSlot]),
        status: 200,
        headers: new Headers(),
      })
    vi.mocked(createMeeting).mockResolvedValueOnce(rejection(409, 'slot-taken'))

    renderBookingPage()
    await bookFreeSlotWithName(user, 'Анна')

    expect(
      await screen.findByText('Это время только что заняли. Выберите другое время.'),
    ).toBeVisible()
    await waitFor(() => expect(listSlots).toHaveBeenCalledTimes(2))

    // Выбор слота снят, «Продолжить» недоступна до нового выбора.
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeDisabled()
    // Тип и имя сохранены.
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeVisible()
    expect(screen.getByLabelText('Ваше имя')).toHaveValue('Анна')
    // Занятый слот виден с меткой «занято».
    expect(screen.getByRole('button', { name: '10:00–10:30 занято' })).toBeDisabled()
    // Автоповтора брони нет.
    expect(createMeeting).toHaveBeenCalledTimes(1)
  })

  it('dismisses the rejection plaque when the guest picks another slot', async () => {
    const user = userEvent.setup()
    mockBookingData()
    // После отказа слот занят, но соседний свободен: с него и начинается восстановление.
    vi.mocked(listSlots)
      .mockResolvedValueOnce({
        data: dayWithSlots([freeSlot, takenSlot]),
        status: 200,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        data: dayWithSlots([takenFormerFreeSlot, lateFreeSlot]),
        status: 200,
        headers: new Headers(),
      })
    vi.mocked(createMeeting).mockResolvedValueOnce(rejection(409, 'slot-taken'))

    renderBookingPage()
    await bookFreeSlotWithName(user, 'Анна')

    expect(
      await screen.findByText('Это время только что заняли. Выберите другое время.'),
    ).toBeVisible()

    await user.click(await screen.findByRole('button', { name: '11:00–11:30' }))

    expect(
      screen.queryByText('Это время только что заняли. Выберите другое время.'),
    ).not.toBeInTheDocument()
    // Имя сохранено, «Продолжить» снова доступна после нового выбора.
    expect(screen.getByLabelText('Ваше имя')).toHaveValue('Анна')
    expect(screen.getByLabelText('Ваше имя')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '11:00–11:30' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('recovers from a slot-not-bookable rejection keeping type, name and chosen day', async () => {
    const user = userEvent.setup()
    mockBookingData()
    // Слоты на втором рабочем дне окна (ср, 4 ноября): после отказа день обязан остаться.
    vi.mocked(listSlots)
      .mockResolvedValueOnce({
        data: windowWithSlots(2, [laterFreeSlot, takenLaterSlot]),
        status: 200,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        data: windowWithSlots(2, [takenLaterFreeSlot, takenLaterSlot]),
        status: 200,
        headers: new Headers(),
      })
    vi.mocked(createMeeting).mockResolvedValueOnce(rejection(400, 'slot-not-bookable'))

    renderBookingPage()
    await user.click(await screen.findByRole('button', { name: /Знакомство/ }))
    await user.click(await screen.findByRole('button', { name: '4 ноября 2026' }))
    await user.click(await screen.findByRole('button', { name: '10:00–10:30' }))
    await user.type(screen.getByLabelText('Ваше имя'), 'Анна')
    await user.click(screen.getByRole('button', { name: 'Продолжить' }))

    expect(await screen.findByText('Это время больше недоступно. Выберите другое.')).toBeVisible()
    await waitFor(() => expect(listSlots).toHaveBeenCalledTimes(2))

    // Выбранный день и тип сохранены, выбор слота снят, имя на месте.
    expect(screen.getByRole('button', { name: '4 ноября 2026' })).toHaveAttribute(
      'data-selected',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeVisible()
    expect(screen.getByLabelText('Ваше имя')).toHaveValue('Анна')
    expect(screen.getByRole('button', { name: '10:00–10:30 занято' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeDisabled()
    // Автоповтора брони нет.
    expect(createMeeting).toHaveBeenCalledTimes(1)
  })

  it('resets to type selection and re-fetches types when the meeting type disappeared', async () => {
    const user = userEvent.setup()
    mockBookingData()
    vi.mocked(createMeeting).mockResolvedValueOnce(rejection(404, 'meeting-type-not-found'))

    renderBookingPage()
    await bookFreeSlotWithName(user, 'Анна')

    expect(
      await screen.findByText('Этот тип встречи больше недоступен. Выберите другой.'),
    ).toBeVisible()

    // Сброс к выбору типа: карточки типов видны, сводка выбранного типа — нет.
    expect(await screen.findByRole('button', { name: /Разбор/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument()
    expect(screen.getByText('Выберите тип встречи')).toBeVisible()
    // Перезапрос типов.
    await waitFor(() => expect(listMeetingTypes).toHaveBeenCalledTimes(2))

    // Выбор нового типа снимает плашку — отказ не висит вечно.
    await user.click(screen.getByRole('button', { name: /Разбор/ }))
    expect(
      screen.queryByText('Этот тип встречи больше недоступен. Выберите другой.'),
    ).not.toBeInTheDocument()
  })

  it('shows the server name error under the field and keeps the form on validation-failed', async () => {
    const user = userEvent.setup()
    mockBookingData()
    vi.mocked(createMeeting).mockResolvedValueOnce(
      rejection(400, 'validation-failed', { guestName: ['Имя не может быть пустым.'] }),
    )

    renderBookingPage()
    await bookFreeSlotWithName(user, 'Анна')

    // Ошибка errors.guestName показана под полем имени.
    expect(await screen.findByText('Имя не может быть пустым.')).toBeVisible()
    // Форма и значения сохранены: слот выбран, имя на месте, «Продолжить» доступна.
    expect(screen.getByLabelText('Ваше имя')).toHaveValue('Анна')
    expect(screen.getByRole('button', { name: '10:00–10:30' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeEnabled()
    // Слоты не перезапрашиваются, слот-плашки нет.
    expect(listSlots).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByText('Это время только что заняли. Выберите другое время.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Не удалось забронировать встречу')).not.toBeInTheDocument()
  })

  it('keeps entered values and retries the same request after a network failure', async () => {
    const user = userEvent.setup()
    mockBookingData()
    vi.mocked(createMeeting)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: bookedMeeting, status: 201, headers: new Headers() })

    renderBookingPage()
    await bookFreeSlotWithName(user, 'Анна')

    expect(await screen.findByText('Не удалось выполнить запрос')).toBeVisible()
    // Введённые значения сохранены: слот выбран, имя на месте.
    expect(screen.getByRole('button', { name: '10:00–10:30' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByLabelText('Ваше имя')).toHaveValue('Анна')
    // Слоты при сетевом отказе не перезапрашиваются.
    expect(listSlots).toHaveBeenCalledTimes(1)

    // «Повторить» отправляет тот же запрос с теми же значениями.
    await user.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByRole('heading', { name: 'Встреча забронирована' })).toBeVisible()
    expect(createMeeting).toHaveBeenCalledTimes(2)
    expect(createMeeting).toHaveBeenLastCalledWith({
      meetingTypeId: 'znakomstvo',
      start: '2026-11-02T10:00:00+03:00',
      guestName: 'Анна',
    })
  })

  it('treats a server 5xx with an unparsable body as a request failure', async () => {
    const user = userEvent.setup()
    mockBookingData()
    vi.mocked(createMeeting).mockResolvedValueOnce({
      data: { message: 'Internal error' },
      status: 500,
      headers: new Headers(),
    } as never)

    renderBookingPage()
    await bookFreeSlotWithName(user, 'Анна')

    // Та же плашка с повтором, значения сохранены, автоповтора нет.
    expect(await screen.findByText('Не удалось выполнить запрос')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible()
    expect(screen.getByLabelText('Ваше имя')).toHaveValue('Анна')
    expect(screen.getByRole('button', { name: '10:00–10:30' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(createMeeting).toHaveBeenCalledTimes(1)
    expect(listSlots).toHaveBeenCalledTimes(1)
  })

  it('locks the form and blocks a second submit while the booking is in flight', async () => {
    const user = userEvent.setup()
    mockBookingData()
    let resolveCreate: ((value: createMeetingResponse) => void) | undefined
    vi.mocked(createMeeting).mockImplementation(
      () =>
        new Promise<createMeetingResponse>((resolve) => {
          resolveCreate = resolve
        }),
    )

    renderBookingPage()
    await user.click(await screen.findByRole('button', { name: /Знакомство/ }))
    await user.click(await screen.findByRole('button', { name: '10:00–10:30' }))
    await user.type(screen.getByLabelText('Ваше имя'), 'Анна')

    const continueButton = screen.getByRole('button', { name: 'Продолжить' })
    await user.click(continueButton)
    await user.click(continueButton)

    // Пока запрос в полёте, «Продолжить» в loading, повторный клик не шлёт второй POST.
    expect(continueButton).toHaveAttribute('data-loading', 'true')
    expect(createMeeting).toHaveBeenCalledTimes(1)
    // Элементы управления заблокированы.
    expect(screen.getByLabelText('Ваше имя')).toBeDisabled()
    expect(screen.getByRole('button', { name: '10:00–10:30' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Назад' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeDisabled()

    resolveCreate?.({ data: bookedMeeting, status: 201, headers: new Headers() })

    expect(await screen.findByRole('heading', { name: 'Встреча забронирована' })).toBeVisible()
    expect(createMeeting).toHaveBeenCalledTimes(1)
  })
})
