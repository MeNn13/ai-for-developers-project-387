import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OwnerPage } from './OwnerPage'

vi.mock('../api/generated/booking', () => ({
  listMeetingTypes: vi.fn(),
  createMeetingType: vi.fn(),
  listMeetings: vi.fn(),
}))

import { createMeetingType, listMeetingTypes, listMeetings } from '../api/generated/booking'
import type {
  Meeting,
  MeetingType,
  createMeetingTypeResponse,
  listMeetingsResponse,
} from '../api/generated/booking'

function renderOwnerPage() {
  return render(
    <MantineProvider defaultColorScheme="light">
      <OwnerPage />
    </MantineProvider>,
  )
}

function mockEmptyTypes() {
  vi.mocked(listMeetingTypes).mockResolvedValue({
    data: [],
    status: 200,
    headers: new Headers(),
  })
}

function mockMeetings(meetings: Meeting[]) {
  vi.mocked(listMeetings).mockResolvedValue({
    data: meetings,
    status: 200,
    headers: new Headers(),
  })
}

const ID_HINT = 'подставлено из названия — можно изменить'
const ID_TAKEN = 'Такой id уже занят — измените его'

const firstType: MeetingType = {
  id: 'znakomstvo',
  title: 'Знакомство',
  description: 'Короткий первый созвон.',
  durationMinutes: 30,
}

const secondType: MeetingType = {
  id: '-razbor-1-1',
  title: 'Разбор 1:1',
  description: '',
  durationMinutes: 45,
}

const firstMeeting: Meeting = {
  id: '11111111-1111-4111-8111-111111111111',
  meetingTypeId: 'znakomstvo',
  meetingTypeTitle: 'Знакомство',
  durationMinutes: 30,
  start: '2026-11-02T10:00:00+03:00',
  end: '2026-11-02T10:30:00+03:00',
  guestName: 'Анна',
}

const secondMeeting: Meeting = {
  id: '22222222-2222-4222-8222-222222222222',
  meetingTypeId: '-razbor-1-1',
  meetingTypeTitle: 'Разбор 1:1',
  durationMinutes: 45,
  start: '2026-11-02T12:00:00+03:00',
  end: '2026-11-02T12:45:00+03:00',
  guestName: 'Борис',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMeetings([])
})

describe('owner page', () => {
  it('lists created meeting types in creation order', async () => {
    vi.mocked(listMeetingTypes).mockResolvedValue({
      data: [firstType, secondType],
      status: 200,
      headers: new Headers(),
    })

    renderOwnerPage()

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(2)

    expect(items[0]).toHaveTextContent('Знакомство')
    expect(items[0]).toHaveTextContent('znakomstvo')
    expect(items[0]).toHaveTextContent('30 мин')
    expect(items[1]).toHaveTextContent('Разбор 1:1')
    expect(items[1]).toHaveTextContent('-razbor-1-1')
    expect(items[1]).toHaveTextContent('45 мин')
  })

  it('creates a meeting type with manual id and refreshes the list', async () => {
    const user = userEvent.setup()

    vi.mocked(listMeetingTypes)
      .mockResolvedValueOnce({ data: [], status: 200, headers: new Headers() })
      .mockResolvedValueOnce({ data: [firstType], status: 200, headers: new Headers() })
    vi.mocked(createMeetingType).mockResolvedValue({
      data: firstType,
      status: 201,
      headers: new Headers(),
    })

    renderOwnerPage()

    expect(await screen.findByText('Типы встреч ещё не созданы')).toBeVisible()

    await user.type(screen.getByLabelText('Название'), 'Знакомство')
    // Ручная правка id: сначала отцепить значение от подсказки, затем ввести своё.
    const idInput = screen.getByLabelText('Идентификатор')
    await user.clear(idInput)
    await user.type(idInput, 'znakomstvo')
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    await waitFor(() =>
      expect(createMeetingType).toHaveBeenCalledWith({
        id: 'znakomstvo',
        title: 'Знакомство',
        description: '',
        durationMinutes: 30,
      }),
    )

    expect(await screen.findByText('Тип встречи создан')).toBeVisible()
    expect(listMeetingTypes).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('Знакомство')).toBeVisible()

    // После успешного создания форма возвращается к значениям по умолчанию.
    expect(screen.getByLabelText('Название')).toHaveValue('')
    expect(screen.getByLabelText('Идентификатор')).toHaveValue('')
    expect(screen.getByLabelText('Длительность, мин')).toHaveValue('30')
  })

  it('suggests id from the title and shows the hint while id is untouched', async () => {
    mockEmptyTypes()
    const user = userEvent.setup()
    renderOwnerPage()

    await user.type(screen.getByLabelText('Название'), 'Знакомство')

    expect(screen.getByLabelText('Идентификатор')).toHaveValue('znakomstvo')
    expect(screen.getByText(ID_HINT)).toBeVisible()
  })

  it('detaches id from the title after the first manual edit', async () => {
    mockEmptyTypes()
    const user = userEvent.setup()
    renderOwnerPage()

    const title = screen.getByLabelText('Название')
    const id = screen.getByLabelText('Идентификатор')

    await user.type(title, 'Знакомство')
    await user.type(id, '2026')

    expect(id).toHaveValue('znakomstvo2026')
    expect(screen.queryByText(ID_HINT)).not.toBeInTheDocument()

    // Последующие изменения названия больше не трогают id.
    await user.type(title, '!')

    expect(id).toHaveValue('znakomstvo2026')
  })

  it('re-couples id to the title when id is cleared to empty', async () => {
    mockEmptyTypes()
    const user = userEvent.setup()
    renderOwnerPage()

    const title = screen.getByLabelText('Название')
    const id = screen.getByLabelText('Идентификатор')

    await user.type(title, 'Знакомство')
    await user.type(id, '2026')
    await user.clear(id)

    expect(screen.getByText(ID_HINT)).toBeVisible()

    await user.clear(title)
    await user.type(title, 'Воркшоп')

    expect(id).toHaveValue('vorkshop')
  })

  it('clears the suggested id when the title is cleared', async () => {
    mockEmptyTypes()
    const user = userEvent.setup()
    renderOwnerPage()

    const title = screen.getByLabelText('Название')

    await user.type(title, 'Знакомство')
    expect(screen.getByLabelText('Идентификатор')).toHaveValue('znakomstvo')

    await user.clear(title)

    expect(screen.getByLabelText('Идентификатор')).toHaveValue('')
  })

  it('shows the collision warning for an existing id without adding a suffix and blocks submit', async () => {
    vi.mocked(listMeetingTypes).mockResolvedValue({
      data: [firstType],
      status: 200,
      headers: new Headers(),
    })
    const user = userEvent.setup()
    renderOwnerPage()

    await screen.findByRole('listitem')
    await user.type(screen.getByLabelText('Название'), 'Знакомство')

    // Подсказка не додумывает суффиксы вида «-2»: id остаётся как есть.
    expect(screen.getByLabelText('Идентификатор')).toHaveValue('znakomstvo')
    expect(screen.getByText(ID_TAKEN)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Создать' })).toBeDisabled()
  })

  it('shows the same collision text when the server answers 409 meeting-type-exists', async () => {
    mockEmptyTypes()
    vi.mocked(createMeetingType).mockResolvedValue({
      data: {
        type: 'meeting-type-exists',
        title: 'Конфликт',
        status: 409,
        detail: 'Тип встречи с таким id уже существует.',
        instance: '/api/meeting-types',
      },
      status: 409,
      headers: new Headers(),
    })
    const user = userEvent.setup()
    renderOwnerPage()

    const title = screen.getByLabelText('Название')
    await user.type(title, 'Знакомство')
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    expect(await screen.findByText(ID_TAKEN)).toBeVisible()

    // Остальные значения сохраняются.
    expect(title).toHaveValue('Знакомство')
    expect(screen.getByLabelText('Идентификатор')).toHaveValue('znakomstvo')
  })

  it('disables the create button while the form is invalid', async () => {
    mockEmptyTypes()
    renderOwnerPage()

    // Пустые обязательные название и id делают форму невалидной сразу.
    expect(screen.getByRole('button', { name: 'Создать' })).toBeDisabled()
  })

  it('validates fields on blur and keeps the errors under them', async () => {
    mockEmptyTypes()
    const user = userEvent.setup()
    renderOwnerPage()

    const title = screen.getByLabelText('Название')
    const id = screen.getByLabelText('Идентификатор')
    const duration = screen.getByLabelText('Длительность, мин')

    await user.click(title)
    await user.tab()
    expect(await screen.findByText('Укажите название')).toBeVisible()

    await user.type(id, 'ABC')
    await user.tab()
    expect(await screen.findByText('Только строчные латинские буквы, цифры и дефис')).toBeVisible()

    await user.click(duration)
    await user.clear(duration)
    await user.type(duration, '17')
    await user.tab()
    expect(await screen.findByText('Длительность кратна 5 минутам')).toBeVisible()

    expect(screen.getByRole('button', { name: 'Создать' })).toBeDisabled()
  })

  it('locks the fields and blocks double submit while the request is in flight', async () => {
    mockEmptyTypes()
    let resolveCreate: ((value: createMeetingTypeResponse) => void) | undefined
    vi.mocked(createMeetingType).mockImplementation(
      () =>
        new Promise<createMeetingTypeResponse>((resolve) => {
          resolveCreate = resolve
        }),
    )
    const user = userEvent.setup()
    renderOwnerPage()

    await user.type(screen.getByLabelText('Название'), 'Знакомство')

    const create = screen.getByRole('button', { name: 'Создать' })
    await user.click(create)
    await user.click(create)

    expect(createMeetingType).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Название')).toBeDisabled()
    expect(screen.getByLabelText('Идентификатор')).toBeDisabled()

    resolveCreate?.({ data: firstType, status: 201, headers: new Headers() })

    expect(await screen.findByText('Тип встречи создан')).toBeVisible()
    expect(screen.getByLabelText('Название')).toBeEnabled()
  })

  it('keeps the values and offers a retry when the network fails', async () => {
    mockEmptyTypes()
    vi.mocked(createMeetingType)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ data: firstType, status: 201, headers: new Headers() })
    const user = userEvent.setup()
    renderOwnerPage()

    await user.type(screen.getByLabelText('Название'), 'Знакомство')
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    expect(await screen.findByText('Не удалось создать тип встречи')).toBeVisible()
    expect(screen.getByLabelText('Название')).toHaveValue('Знакомство')
    expect(screen.getByLabelText('Идентификатор')).toHaveValue('znakomstvo')

    await user.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByText('Тип встречи создан')).toBeVisible()
    expect(createMeetingType).toHaveBeenCalledTimes(2)
    expect(createMeetingType).toHaveBeenLastCalledWith({
      id: 'znakomstvo',
      title: 'Знакомство',
      description: '',
      durationMinutes: 30,
    })
  })

  it('distributes server validation-failed errors under the fields and keeps the values', async () => {
    mockEmptyTypes()
    vi.mocked(createMeetingType).mockResolvedValue({
      data: {
        type: 'validation-failed',
        title: 'Запрос некорректен',
        status: 400,
        detail: 'Проверьте введённые значения.',
        instance: '/api/meeting-types',
        errors: { durationMinutes: ['Длительность должна быть кратна 5 минутам.'] },
      },
      status: 400,
      headers: new Headers(),
    })
    const user = userEvent.setup()
    renderOwnerPage()

    await user.type(screen.getByLabelText('Название'), 'Знакомство')
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    expect(await screen.findByText('Длительность должна быть кратна 5 минутам.')).toBeVisible()
    expect(screen.getByLabelText('Название')).toHaveValue('Знакомство')
    expect(screen.queryByText('Не удалось создать тип встречи')).not.toBeInTheDocument()
  })

  it('falls back to the failure plaque when the error body is not ProblemDetails', async () => {
    mockEmptyTypes()
    vi.mocked(createMeetingType).mockResolvedValue({
      data: { message: 'Internal error' },
      status: 500,
      headers: new Headers(),
    } as never)
    const user = userEvent.setup()
    renderOwnerPage()

    await user.type(screen.getByLabelText('Название'), 'Знакомство')
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    expect(await screen.findByText('Не удалось создать тип встречи')).toBeVisible()
    expect(screen.getByLabelText('Название')).toHaveValue('Знакомство')
  })

  it('resets the form to defaults and returns focus to the title on success', async () => {
    vi.mocked(listMeetingTypes)
      .mockResolvedValueOnce({ data: [], status: 200, headers: new Headers() })
      .mockResolvedValueOnce({ data: [firstType], status: 200, headers: new Headers() })
    vi.mocked(createMeetingType).mockResolvedValue({
      data: firstType,
      status: 201,
      headers: new Headers(),
    })
    const user = userEvent.setup()
    renderOwnerPage()

    await user.type(screen.getByLabelText('Название'), 'Знакомство')
    await user.type(screen.getByLabelText('Описание'), 'Короткий созвон')
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    expect(await screen.findByText('Тип встречи создан')).toBeVisible()

    // Умолчания: длительность снова 30, текст очищен, id снова свободен от подсказки.
    const title = screen.getByLabelText('Название')
    expect(title).toHaveValue('')
    expect(title).toHaveFocus()
    expect(screen.getByLabelText('Описание')).toHaveValue('')
    expect(screen.getByLabelText('Длительность, мин')).toHaveValue('30')
    expect(screen.getByLabelText('Идентификатор')).toHaveValue('')
    expect(screen.getByText(ID_HINT)).toBeVisible()

    // Список типов перезапрошен ровно один раз сверх стартового.
    expect(listMeetingTypes).toHaveBeenCalledTimes(2)
  })
})

describe('upcoming meetings', () => {
  it('renders meetings in ascending start order with the Moscow caption', async () => {
    mockEmptyTypes()
    mockMeetings([firstMeeting, secondMeeting])

    renderOwnerPage()

    expect(await screen.findByRole('table')).toBeVisible()
    expect(screen.getByText('Время указано по Москве (UTC+3)')).toBeVisible()

    expect(screen.getByRole('columnheader', { name: 'Когда' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Тип встречи' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Длительность' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Гость' })).toBeVisible()

    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(3)

    expect(rows[1]).toHaveTextContent('Пн, 2 ноября, 10:00–10:30')
    expect(rows[1]).toHaveTextContent('Знакомство')
    expect(rows[1]).toHaveTextContent('30 мин')
    expect(rows[1]).toHaveTextContent('Анна')

    expect(rows[2]).toHaveTextContent('Пн, 2 ноября, 12:00–12:45')
    expect(rows[2]).toHaveTextContent('Разбор 1:1')
    expect(rows[2]).toHaveTextContent('45 мин')
    expect(rows[2]).toHaveTextContent('Борис')
  })

  it('refreshes meetings when the tab becomes visible again', async () => {
    mockEmptyTypes()
    mockMeetings([firstMeeting])

    renderOwnerPage()
    await screen.findByRole('table')
    expect(listMeetings).toHaveBeenCalledTimes(1)

    fireEvent(document, new Event('visibilitychange'))

    await waitFor(() => expect(listMeetings).toHaveBeenCalledTimes(2))
  })

  it('refreshes meetings with the button and shows the Moscow update time', async () => {
    mockEmptyTypes()
    mockMeetings([firstMeeting])
    const user = userEvent.setup()

    renderOwnerPage()

    expect(await screen.findByText(/^Обновлено в \d{2}:\d{2}$/)).toBeVisible()
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Обновить' }))

    await waitFor(() => expect(listMeetings).toHaveBeenCalledTimes(2))
  })

  it('shows a skeleton while meetings are loading', async () => {
    mockEmptyTypes()
    let resolveMeetings: ((value: listMeetingsResponse) => void) | undefined
    vi.mocked(listMeetings).mockImplementation(
      () =>
        new Promise<listMeetingsResponse>((resolve) => {
          resolveMeetings = resolve
        }),
    )

    renderOwnerPage()

    expect(screen.getByRole('status', { name: 'Загрузка предстоящих встреч' })).toBeVisible()

    resolveMeetings?.({ data: [firstMeeting], status: 200, headers: new Headers() })

    expect(await screen.findByRole('table')).toBeVisible()
    expect(screen.queryByRole('status', { name: 'Загрузка предстоящих встреч' })).toBeNull()
  })

  it('keeps shown meetings and offers a retry when a refresh fails', async () => {
    mockEmptyTypes()
    vi.mocked(listMeetings)
      .mockResolvedValueOnce({ data: [firstMeeting], status: 200, headers: new Headers() })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        data: [firstMeeting, secondMeeting],
        status: 200,
        headers: new Headers(),
      })
    const user = userEvent.setup()

    renderOwnerPage()
    await screen.findByRole('table')

    await user.click(screen.getByRole('button', { name: 'Обновить' }))

    expect(await screen.findByText('Не удалось загрузить предстоящие встречи')).toBeVisible()
    // Уже показанные встречи не стираются при ошибке обновления.
    expect(screen.getByRole('table')).toBeVisible()
    expect(screen.getByText('Анна')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByText('Борис')).toBeVisible()
    expect(listMeetings).toHaveBeenCalledTimes(3)
  })

  it('shows the empty state while keeping the creation form usable', async () => {
    mockEmptyTypes()
    mockMeetings([])

    renderOwnerPage()

    expect(await screen.findByText('Предстоящих встреч нет')).toBeVisible()
    expect(screen.getByLabelText('Название')).toBeEnabled()
  })

  it('keeps the form and types list usable when meetings fail to load', async () => {
    vi.mocked(listMeetingTypes).mockResolvedValue({
      data: [firstType],
      status: 200,
      headers: new Headers(),
    })
    vi.mocked(listMeetings).mockRejectedValue(new TypeError('Failed to fetch'))

    renderOwnerPage()

    expect(await screen.findByText('Не удалось загрузить предстоящие встречи')).toBeVisible()
    expect(screen.getByLabelText('Название')).toBeEnabled()
    expect(await screen.findByRole('listitem')).toHaveTextContent('Знакомство')
  })

  it('keeps meetings visible when the types list fails to load', async () => {
    vi.mocked(listMeetingTypes).mockRejectedValue(new TypeError('Failed to fetch'))
    mockMeetings([firstMeeting])

    renderOwnerPage()

    expect(await screen.findByRole('table')).toBeVisible()
    expect(screen.getByText('Анна')).toBeVisible()
    expect(await screen.findByText('Не удалось загрузить типы встреч')).toBeVisible()
  })
})
