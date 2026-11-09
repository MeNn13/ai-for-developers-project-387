import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './App'

// Страница владельца обращается к API при монтировании: сгенерированный клиент
// мокается на границе модуля, чтобы тесты роутинга не зависели от fetch.
vi.mock('./api/generated/booking', () => ({
  listMeetingTypes: vi.fn(async () => ({ data: [], status: 200, headers: new Headers() })),
  listSlots: vi.fn(),
  createMeetingType: vi.fn(),
}))

function renderAt(path: string) {
  return render(
    <MantineProvider defaultColorScheme="light">
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </MantineProvider>,
  )
}

describe('main page', () => {
  it('introduces the service and lists its capabilities', () => {
    renderAt('/')

    expect(screen.getByRole('heading', { level: 1, name: 'Календарь звонков' })).toBeVisible()
    expect(
      screen.getByText(
        'Календарь звонков — сервис бронирования встреч без регистрации. Свободные слоты видны сразу: занятый слот исчезает из списка.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: 'Возможности' })).toBeVisible()
    expect(screen.getByText('Выбрать тип встречи и её длительность')).toBeVisible()
    expect(
      screen.getByText(
        'Забронировать свободный слот на 14 дней вперёд в рабочие часы Пн–Пт, 10:00–18:00 (МСК)',
      ),
    ).toBeVisible()
    expect(screen.getByText('Записаться без регистрации — достаточно имени')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Записаться' })).toHaveAttribute('href', '/book')
  })

  it('opens the booking page from the call to action', async () => {
    const user = userEvent.setup()
    renderAt('/')

    await user.click(screen.getByRole('link', { name: 'Записаться' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Бронирование' })).toBeVisible()
    expect(await screen.findByText('Типы встреч ещё не созданы')).toBeVisible()
  })

  it('opens the owner page from the header', async () => {
    const user = userEvent.setup()
    renderAt('/')

    await user.click(screen.getByRole('link', { name: 'Страница владельца' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Страница владельца' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: 'Новый тип встречи' })).toBeVisible()
  })

  it('marks the current page in the header', () => {
    renderAt('/owner')

    expect(screen.getByRole('link', { name: 'Страница владельца' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Бронирование' })).not.toHaveAttribute('aria-current')
  })

  it('returns to the main page through the header title', async () => {
    const user = userEvent.setup()
    renderAt('/owner')

    await user.click(screen.getByRole('link', { name: 'Календарь звонков' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Календарь звонков' })).toBeVisible()
  })

  it('opens the booking page from the owner page header', async () => {
    const user = userEvent.setup()
    renderAt('/owner')

    await user.click(screen.getByRole('link', { name: 'Бронирование' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Бронирование' })).toBeVisible()
  })

  it('marks only the current page in the header', () => {
    renderAt('/book')

    expect(screen.getByRole('link', { name: 'Бронирование' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Страница владельца' })).not.toHaveAttribute(
      'aria-current',
    )
    expect(screen.getByRole('link', { name: 'Календарь звонков' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('redirects unknown paths to the main page', () => {
    renderAt('/missing')

    expect(screen.getByRole('heading', { level: 1, name: 'Календарь звонков' })).toBeVisible()
  })
})
