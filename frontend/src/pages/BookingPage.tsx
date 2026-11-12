import {
  Alert,
  Anchor,
  Button,
  Card,
  Container,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { DatePicker, DatesProvider } from '@mantine/dates'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { createMeeting, listMeetingTypes, listSlots } from '../api/generated/booking'
import type { Meeting, MeetingType, Slot, SlotDay, SlotsResponse } from '../api/generated/booking'
import { formatMeetingConfirmation, formatTimeOfDay, formatTimeRange } from '../lib/moscowTime'
import { isProblemDetails } from '../lib/problemDetails'
import classes from './BookingPage.module.css'

type TypesState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; types: MeetingType[] }

type SlotsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; response: SlotsResponse }

// Ограничение длины имени гостя из контракта (MeetingCreateRequest.guestName).
const GUEST_NAME_MAX_LENGTH = 100

// Отказ «слот только что заняли» (спека #23, состояние 13).
const SLOT_TAKEN_MESSAGE = 'Это время только что заняли. Выберите другое время.'
// Отказ «слот больше недоступен по правилам» — то же поведение, другой текст (спека #15-14).
const SLOT_NOT_BOOKABLE_MESSAGE = 'Это время больше недоступно. Выберите другое.'
// Отказ «тип встречи исчез» — плашка, сброс к выбору типа, перезапрос типов (спека #15-15).
const TYPE_NOT_FOUND_MESSAGE = 'Этот тип встречи больше недоступен. Выберите другой.'
// Сеть, 5xx и неразобранные ответы — единая плашка с повтором (спека #15-17).
const REQUEST_FAILED_MESSAGE = 'Не удалось выполнить запрос'

async function fetchTypes(): Promise<TypesState> {
  try {
    const response = await listMeetingTypes()
    if (response.status === 200) {
      return { status: 'ready', types: response.data }
    }

    return { status: 'error' }
  } catch {
    return { status: 'error' }
  }
}

// Окно записи начинается сегодня по Москве, поэтому первый день ответа — сегодня.
function isWorkingDay(date: string): boolean {
  const weekday = dayjs(date).day()

  return weekday !== 0 && weekday !== 6
}

function defaultDay(days: SlotDay[]): string | null {
  const today = days[0]?.date
  if (!today) {
    return null
  }

  if (isWorkingDay(today)) {
    return today
  }

  return days.find((day) => isWorkingDay(day.date))?.date ?? null
}

function hasFreeSlot(response: SlotsResponse): boolean {
  return response.days.some((day) => day.slots.some((slot) => slot.available))
}

export function BookingPage() {
  const [typesState, setTypesState] = useState<TypesState>({ status: 'loading' })
  const [selectedType, setSelectedType] = useState<MeetingType | null>(null)
  const [slotsState, setSlotsState] = useState<SlotsState>({ status: 'idle' })
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [visibleMonth, setVisibleMonth] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [guestName, setGuestName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [requestFailed, setRequestFailed] = useState(false)
  const [slotRejection, setSlotRejection] = useState<string | null>(null)
  // Серверная ошибка errors.guestName показывается под полем (спека #15-16).
  const [guestNameError, setGuestNameError] = useState<string | undefined>(undefined)
  const [confirmation, setConfirmation] = useState<Meeting | null>(null)
  // Время последнего успешного перезапроса слотов: подпись «Обновлено в …» (US#36).
  const [slotsUpdatedAt, setSlotsUpdatedAt] = useState<Date | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const bookingControlsRef = useRef<HTMLDivElement>(null)
  const selectedSlotRef = useRef<HTMLButtonElement>(null)

  async function loadSlots(type: MeetingType, keepDay = false) {
    setSlotsState({ status: 'loading' })
    setSelectedSlot(null)

    try {
      const response = await listSlots({ meetingTypeId: type.id })
      if (response.status === 200) {
        // Перезапрос после отказа оставляет выбранный день, если он ещё в окне.
        const day =
          keepDay && selectedDay && response.data.days.some((d) => d.date === selectedDay)
            ? selectedDay
            : defaultDay(response.data.days)
        setSlotsState({ status: 'ready', response: response.data })
        // Отметка ставится при обновлении состояния, а не в теле рендера.
        setSlotsUpdatedAt(() => new Date())
        setSelectedDay(day)
        setVisibleMonth(day)
        return
      }

      setSlotsState({ status: 'error' })
    } catch {
      setSlotsState({ status: 'error' })
    }
  }

  useEffect(() => {
    void fetchTypes().then(setTypesState)
  }, [])

  // Выбор слота активирует поле имени и переводит в него фокус.
  useEffect(() => {
    if (selectedSlot) {
      nameInputRef.current?.focus()
      if (window.matchMedia('(max-width: 61.99em)').matches) {
        bookingControlsRef.current?.scrollIntoView({ block: 'end' })
        selectedSlotRef.current?.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedSlot])

  function refreshTypes() {
    setTypesState({ status: 'loading' })
    void fetchTypes().then(setTypesState)
  }

  function selectType(type: MeetingType) {
    if (submitting) {
      return
    }

    setSlotRejection(null)
    setSelectedType(type)
    setSelectedDay(null)
    void loadSlots(type)
  }

  function changeType() {
    if (submitting) {
      return
    }

    setSelectedType(null)
    setSlotsState({ status: 'idle' })
    setSelectedDay(null)
    setVisibleMonth(null)
    setSelectedSlot(null)
    setGuestName('')
    setRequestFailed(false)
    setSlotRejection(null)
  }

  function selectDay(day: string | null) {
    if (submitting) {
      return
    }

    // Смена дня относится к уже снятому слоту — старые плашки отказа больше не к месту.
    setSlotRejection(null)
    setRequestFailed(false)
    setSelectedDay(day)
    setSelectedSlot(null)
  }

  // Новый выбор слота снимает плашку отказа: она относилась к прежнему слоту.
  function selectSlot(slot: Slot) {
    setSlotRejection(null)
    setRequestFailed(false)
    setSelectedSlot(slot)
  }

  function refreshSlots() {
    if (selectedType && !submitting) {
      void loadSlots(selectedType)
    }
  }

  // «Назад» снимает слот и очищает имя, оставляя тип и день.
  function backToSlots() {
    setSelectedSlot(null)
    setGuestName('')
    setRequestFailed(false)
    setSlotRejection(null)
  }

  // «Записаться ещё» возвращает экран в исходное состояние и перезапрашивает типы.
  function bookAgain() {
    setConfirmation(null)
    setSelectedType(null)
    setSlotsState({ status: 'idle' })
    setSelectedDay(null)
    setVisibleMonth(null)
    setSelectedSlot(null)
    setGuestName('')
    setRequestFailed(false)
    setSlotRejection(null)
    refreshTypes()
  }

  async function submitBooking() {
    if (!selectedType || !selectedSlot || submitting || guestName.trim() === '') {
      return
    }

    setSubmitting(true)
    setRequestFailed(false)
    setSlotRejection(null)
    setGuestNameError(undefined)

    try {
      const response = await createMeeting({
        meetingTypeId: selectedType.id,
        start: selectedSlot.start,
        guestName: guestName.trim(),
      })

      if (response.status === 201) {
        setConfirmation(response.data)
        return
      }

      // 409 slot-taken: плашка над слотами, перезапрос слотов, выбор снят,
      // тип и имя сохранены, «Продолжить» недоступна до нового выбора (спека #15-13).
      if (response.status === 409 && isProblemDetails(response.data)) {
        if (response.data.type === 'slot-taken') {
          setSlotRejection(SLOT_TAKEN_MESSAGE)
          void loadSlots(selectedType, true)
          return
        }
      }

      // 400 slot-not-bookable — то же восстановление, другой текст (спека #15-14).
      if (response.status === 400 && isProblemDetails(response.data)) {
        if (response.data.type === 'slot-not-bookable') {
          setSlotRejection(SLOT_NOT_BOOKABLE_MESSAGE)
          void loadSlots(selectedType, true)
          return
        }

        // 400 validation-failed: ошибки errors.guestName под полем, форма сохранена (спека #15-16).
        if (response.data.type === 'validation-failed') {
          const nameErrors = response.data.errors?.guestName
          if (nameErrors && nameErrors.length > 0) {
            setGuestNameError(nameErrors[0])
            return
          }
        }
      }

      // 404 meeting-type-not-found: плашка, сброс к выбору типа, перезапрос типов (спека #15-15).
      if (response.status === 404 && isProblemDetails(response.data)) {
        if (response.data.type === 'meeting-type-not-found') {
          setSlotRejection(TYPE_NOT_FOUND_MESSAGE)
          setSelectedType(null)
          setSlotsState({ status: 'idle' })
          setSelectedDay(null)
          setVisibleMonth(null)
          setSelectedSlot(null)
          setGuestName('')
          refreshTypes()
          return
        }
      }

      // Прочие отказы: сеть, 5xx, неразобранные ответы — плашка с «Повторить» (спека #15-17).
      setRequestFailed(true)
    } catch {
      setRequestFailed(true)
    } finally {
      setSubmitting(false)
    }
  }

  const bookingWindow = slotsState.status === 'ready' ? slotsState.response.window : null
  const today = bookingWindow?.from ?? null
  const timeZone = slotsState.status === 'ready' ? slotsState.response.timezone : null
  const calendarActive = selectedType !== null && slotsState.status === 'ready'
  const daySlots =
    slotsState.status === 'ready'
      ? (slotsState.response.days.find((day) => day.date === selectedDay)?.slots ?? [])
      : []
  const nameReady = selectedSlot !== null && guestName.trim() !== ''

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Title order={1}>Бронирование</Title>

        {confirmation ? (
          <Paper withBorder p="md">
            <Stack gap="sm" align="flex-start">
              <Title order={2}>Встреча забронирована</Title>
              <Text fw={600} className={classes.confirmationText}>
                {confirmation.meetingTypeTitle}
              </Text>
              <Text>
                {formatMeetingConfirmation(
                  confirmation.start,
                  confirmation.end,
                  timeZone ?? 'Europe/Moscow',
                )}
              </Text>
              <Text className={classes.confirmationText}>{confirmation.guestName}</Text>
              <Button onClick={bookAgain}>Записаться ещё</Button>
            </Stack>
          </Paper>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
            <Paper withBorder p="md">
              <Stack gap="md">
                <Title order={2}>Типы встреч</Title>

                {typesState.status === 'loading' && (
                  <Stack gap="xs" role="status" aria-label="Загрузка типов встреч">
                    <Skeleton height={72} radius="sm" />
                    <Skeleton height={72} radius="sm" />
                  </Stack>
                )}

                {typesState.status === 'error' && (
                  <Alert color="red" withCloseButton={false}>
                    <Stack gap="xs" align="flex-start">
                      <Text>Не удалось загрузить типы встреч</Text>
                      <Button variant="outline" size="xs" onClick={refreshTypes}>
                        Повторить
                      </Button>
                    </Stack>
                  </Alert>
                )}

                {typesState.status === 'ready' && typesState.types.length === 0 && (
                  <Alert color="blue" withCloseButton={false}>
                    <Stack gap="xs" align="flex-start">
                      <Text>Типы встреч ещё не созданы</Text>
                      <Anchor component={Link} to="/owner" size="sm">
                        Страница владельца
                      </Anchor>
                      <Button variant="outline" size="xs" onClick={refreshTypes}>
                        Обновить
                      </Button>
                    </Stack>
                  </Alert>
                )}

                {typesState.status === 'ready' && typesState.types.length > 0 && !selectedType && (
                  <Stack gap="sm">
                    {typesState.types.map((type) => (
                      <Card
                        key={type.id}
                        component="button"
                        type="button"
                        withBorder
                        p="md"
                        onClick={() => selectType(type)}
                        style={{ textAlign: 'left', cursor: submitting ? 'default' : 'pointer' }}
                      >
                        <Stack gap={4}>
                          <Text fw={600}>{type.title}</Text>
                          {type.description && (
                            <Text fz="sm" c="dimmed">
                              {type.description}
                            </Text>
                          )}
                          <Text fz="sm">{type.durationMinutes} мин</Text>
                        </Stack>
                      </Card>
                    ))}
                  </Stack>
                )}

                {selectedType && (
                  <Paper withBorder p="md">
                    <Stack gap="xs">
                      <Title order={3}>{selectedType.title}</Title>
                      {selectedType.description && (
                        <Text fz="sm" c="dimmed">
                          {selectedType.description}
                        </Text>
                      )}
                      <Text fz="sm">{selectedType.durationMinutes} мин</Text>
                      <Text fz="sm" c="dimmed">
                        Время указано по Москве (UTC+3)
                      </Text>
                      <Button variant="light" onClick={changeType} disabled={submitting}>
                        Изменить
                      </Button>
                    </Stack>
                  </Paper>
                )}
              </Stack>
            </Paper>

            <Paper withBorder p="md">
              <Stack gap="md">
                {slotsState.status === 'ready' && !hasFreeSlot(slotsState.response) && (
                  <Alert color="blue" withCloseButton={false}>
                    <Stack gap="xs" align="flex-start">
                      <Text>В ближайшие 14 дней свободных слотов нет</Text>
                      <Button variant="outline" size="xs" onClick={refreshSlots}>
                        Обновить
                      </Button>
                    </Stack>
                  </Alert>
                )}

                <DatesProvider settings={{ locale: 'ru', firstDayOfWeek: 1 }}>
                  <DatePicker
                    ariaLabels={{ nextMonth: 'Следующий месяц', previousMonth: 'Предыдущий месяц' }}
                    value={selectedDay}
                    onChange={selectDay}
                    date={visibleMonth ?? undefined}
                    onDateChange={setVisibleMonth}
                    minDate={bookingWindow?.from}
                    maxDate={bookingWindow?.to}
                    excludeDate={(date) => submitting || !calendarActive || !isWorkingDay(date)}
                    firstDayOfWeek={1}
                    highlightToday={false}
                    renderDay={(date) => (
                      <span
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 2,
                        }}
                      >
                        <span>{dayjs(date).date()}</span>
                        {date === today && (
                          <span style={{ fontSize: 9, lineHeight: 1 }}>сегодня</span>
                        )}
                      </span>
                    )}
                  />
                </DatesProvider>
              </Stack>
            </Paper>

            <Paper withBorder p="md">
              <Stack gap="md">
                <Group justify="space-between" align="center" gap="sm" wrap="wrap">
                  <Title order={2}>Слоты</Title>
                  {slotsState.status === 'ready' && slotsUpdatedAt && (
                    <Group gap="sm" align="center">
                      <Text fz="sm" c="dimmed">
                        Обновлено в {formatTimeOfDay(slotsUpdatedAt)}
                      </Text>
                      <Button
                        variant="default"
                        size="xs"
                        disabled={submitting}
                        onClick={refreshSlots}
                      >
                        Обновить
                      </Button>
                    </Group>
                  )}
                </Group>

                {slotRejection && (
                  <Alert color="red" withCloseButton={false}>
                    {slotRejection}
                  </Alert>
                )}

                {!selectedType && typesState.status === 'ready' && (
                  <Text c="dimmed">Выберите тип встречи</Text>
                )}

                {selectedType && slotsState.status === 'loading' && (
                  <Stack gap="xs" role="status" aria-label="Загрузка слотов">
                    <Skeleton height={36} radius="sm" />
                    <Skeleton height={36} radius="sm" />
                    <Skeleton height={36} radius="sm" />
                  </Stack>
                )}

                {selectedType && slotsState.status === 'error' && (
                  <Alert color="red" withCloseButton={false}>
                    <Stack gap="xs" align="flex-start">
                      <Text>Не удалось загрузить слоты</Text>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => void loadSlots(selectedType)}
                      >
                        Повторить
                      </Button>
                    </Stack>
                  </Alert>
                )}

                {slotsState.status === 'ready' && (
                  <Stack gap="sm" ref={bookingControlsRef} style={{ scrollMarginBottom: 16 }}>
                    {!daySlots.some((slot) => slot.available) && (
                      <Text c="dimmed">На этот день свободных слотов нет</Text>
                    )}

                    <Stack gap="sm" mah={{ base: 160, md: 'none' }} style={{ overflowY: 'auto' }}>
                      {daySlots.map((slot) => {
                        const label = timeZone
                          ? formatTimeRange(slot.start, slot.end, timeZone)
                          : slot.start

                        return (
                          <Button
                            key={slot.start}
                            ref={selectedSlot?.start === slot.start ? selectedSlotRef : undefined}
                            style={{ flexShrink: 0 }}
                            variant={selectedSlot?.start === slot.start ? 'filled' : 'default'}
                            disabled={!slot.available || submitting}
                            aria-pressed={selectedSlot?.start === slot.start}
                            aria-label={slot.available ? label : `${label} занято`}
                            onClick={() => selectSlot(slot)}
                            justify="space-between"
                            fullWidth
                          >
                            <span>{label}</span>
                            {!slot.available && <span>занято</span>}
                          </Button>
                        )
                      })}
                    </Stack>

                    <TextInput
                      ref={nameInputRef}
                      label="Ваше имя"
                      value={guestName}
                      maxLength={GUEST_NAME_MAX_LENGTH}
                      disabled={!selectedSlot || submitting}
                      error={guestNameError}
                      // Правка имени снимает серверную ошибку по этому полю.
                      onChange={(event) => {
                        setGuestName(event.currentTarget.value)
                        setGuestNameError(undefined)
                      }}
                    />

                    {requestFailed && (
                      <Alert color="red" withCloseButton={false}>
                        <Stack gap="xs" align="flex-start">
                          <Text>{REQUEST_FAILED_MESSAGE}</Text>
                          {/* Повтор отправляет тот же запрос с теми же значениями. */}
                          <Button variant="outline" size="xs" onClick={() => void submitBooking()}>
                            Повторить
                          </Button>
                        </Stack>
                      </Alert>
                    )}

                    <Group justify="space-between">
                      <Button
                        variant="default"
                        onClick={backToSlots}
                        disabled={!selectedSlot || submitting}
                      >
                        Назад
                      </Button>
                      <Button
                        onClick={() => void submitBooking()}
                        loading={submitting}
                        disabled={!nameReady || submitting}
                      >
                        Продолжить
                      </Button>
                    </Group>
                  </Stack>
                )}
              </Stack>
            </Paper>
          </SimpleGrid>
        )}
      </Stack>
    </Container>
  )
}
