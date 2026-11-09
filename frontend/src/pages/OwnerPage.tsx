import {
  Alert,
  Button,
  Container,
  Group,
  List,
  NumberInput,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createMeetingType, listMeetingTypes, listMeetings } from '../api/generated/booking'
import type { Meeting, MeetingType, MeetingTypeCreateRequest } from '../api/generated/booking'
import { formatMeetingWhen, formatTimeOfDay } from '../lib/moscowTime'
import { isProblemDetails } from '../lib/problemDetails'
import { transliterate } from '../lib/transliterate'

// Подсказка под полем id, пока id не правили руками (спека #23, решение #17).
const ID_HINT = 'подставлено из названия — можно изменить'
// Коллизия с загруженным списком и серверный 409 meeting-type-exists показываются одним текстом.
const ID_TAKEN = 'Такой id уже занят — измените его'
// Единый текст отказа, который нельзя разложить по полям (сеть, 5xx, неразобранный 400).
const CREATE_FAILED = 'Не удалось создать тип встречи'

// Ограничения зеркалят контракт (contract/main.tsp): длительность 15–480 минут шагом 5,
// поля формы по умолчанию: длительность 30, остальные пустые.
const DURATION_MIN_MINUTES = 15
const DURATION_MAX_MINUTES = 480
const DURATION_STEP_MINUTES = 5
const DURATION_DEFAULT_MINUTES = 30
const TITLE_MAX_LENGTH = 120
const DESCRIPTION_MAX_LENGTH = 500
const ID_MAX_LENGTH = 64

type TypesState =
  | { status: 'loading'; types: [] }
  | { status: 'error'; types: [] }
  | { status: 'ready'; types: MeetingType[] }

// Встречи хранятся и в состояниях загрузки и ошибки, чтобы уже показанные
// данные не исчезали при неудачном обновлении.
type MeetingsState =
  | { status: 'loading'; meetings: Meeting[] }
  | { status: 'error'; meetings: Meeting[] }
  | { status: 'ready'; meetings: Meeting[] }

type FieldName = 'title' | 'description' | 'durationMinutes' | 'id'

const idPattern = /^[a-z0-9-]+$/

// Локальная валидация зеркалит ограничения контракта (MeetingTypeCreateRequest);
// расхождение с сервером поправит 400 validation-failed.
function validate(values: {
  title: string
  description: string
  duration: number | string
  id: string
}): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {}

  if (values.title.trim() === '') {
    errors.title = 'Укажите название'
  }

  if (values.description.length > DESCRIPTION_MAX_LENGTH) {
    errors.description = `Описание не длиннее ${DESCRIPTION_MAX_LENGTH} символов`
  }

  const duration = Number(values.duration)
  if (values.duration === '' || !Number.isFinite(duration)) {
    errors.durationMinutes = 'Укажите длительность'
  } else if (!Number.isInteger(duration)) {
    errors.durationMinutes = 'Длительность считается целым числом минут'
  } else if (duration < DURATION_MIN_MINUTES || duration > DURATION_MAX_MINUTES) {
    errors.durationMinutes = `Длительность от ${DURATION_MIN_MINUTES} до ${DURATION_MAX_MINUTES} минут`
  } else if (duration % DURATION_STEP_MINUTES !== 0) {
    errors.durationMinutes = 'Длительность кратна 5 минутам'
  }

  if (values.id === '') {
    errors.id = 'Укажите идентификатор'
  } else if (!idPattern.test(values.id)) {
    errors.id = 'Только строчные латинские буквы, цифры и дефис'
  } else if (values.id.length > ID_MAX_LENGTH) {
    errors.id = `Идентификатор не длиннее ${ID_MAX_LENGTH} символов`
  }

  return errors
}

async function fetchTypes(): Promise<TypesState> {
  try {
    const response = await listMeetingTypes()
    if (response.status === 200) {
      return { status: 'ready', types: response.data }
    }
    return { status: 'error', types: [] }
  } catch {
    return { status: 'error', types: [] }
  }
}

// null означает неудачу: вызывающий сохраняет уже показанные встречи.
async function fetchMeetings(): Promise<Meeting[] | null> {
  try {
    const response = await listMeetings()
    return response.status === 200 ? response.data : null
  } catch {
    return null
  }
}

export function OwnerPage() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState<number | string>(DURATION_DEFAULT_MINUTES)
  const [id, setId] = useState('')
  // id отвязан от названия после первой ручной правки; пустое значение возвращает связь.
  const [idDetached, setIdDetached] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({})
  // Локальные ошибки показываем после blur поля или попытки отправки.
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({})
  const [createError, setCreateError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)
  const [saving, setSaving] = useState(false)
  const [typesState, setTypesState] = useState<TypesState>({ status: 'loading', types: [] })
  const [meetingsState, setMeetingsState] = useState<MeetingsState>({
    status: 'loading',
    meetings: [],
  })
  const [meetingsUpdatedAt, setMeetingsUpdatedAt] = useState<Date | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchTypes().then(setTypesState)
  }, [])

  // Свежесть без polling: запрос при открытии страницы и при возврате фокуса
  // на вкладку (спека #23, решение #18).
  useEffect(() => {
    refreshMeetings()

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refreshMeetings()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  function refreshMeetings() {
    setMeetingsState((prev) => ({ status: 'loading', meetings: prev.meetings }))

    void fetchMeetings().then((meetings) => {
      if (meetings) {
        setMeetingsState({ status: 'ready', meetings })
        setMeetingsUpdatedAt(new Date())
        return
      }

      setMeetingsState((prev) => ({ status: 'error', meetings: prev.meetings }))
    })
  }

  // После 201 фокус возвращается в «Название» (спека #18). Поля в этот момент
  // уже разблокированы: created и saving обновляются одним рендером.
  useEffect(() => {
    if (created) {
      titleInputRef.current?.focus()
    }
  }, [created])

  function markTouched(field: FieldName) {
    setTouched((prev) => ({ ...prev, [field]: true }))
  }

  // Правка поля снимает серверную ошибку по нему — значение уже изменено,
  // старый текст больше не относится к делу.
  function clearServerError(field: FieldName) {
    setFieldErrors((prev) => {
      if (prev[field] === undefined) {
        return prev
      }
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  function handleTitleChange(value: string) {
    setTitle(value)
    clearServerError('title')
    if (!idDetached) {
      setId(transliterate(value))
    }
  }

  function handleIdChange(value: string) {
    setId(value)
    clearServerError('id')
    setIdDetached(value !== '')
  }

  function handleDescriptionChange(value: string) {
    setDescription(value)
    clearServerError('description')
  }

  function handleDurationChange(value: number | string) {
    setDuration(value)
    clearServerError('durationMinutes')
  }

  async function createType() {
    if (saving) {
      return
    }

    setSaving(true)
    setCreated(false)
    setCreateError(null)
    setFieldErrors({})

    const request: MeetingTypeCreateRequest = {
      id,
      title,
      description,
      durationMinutes: Number(duration),
    }

    try {
      const response = await createMeetingType(request)
      if (response.status === 201) {
        setTitle('')
        setDescription('')
        setDuration(DURATION_DEFAULT_MINUTES)
        setId('')
        setIdDetached(false)
        setTouched({})
        setCreated(true)
        setTypesState(await fetchTypes())
        return
      }

      if (response.status === 400) {
        // 400 без разбора ProblemDetails или без карты errors — общий отказ.
        if (isProblemDetails(response.data) && response.data.errors) {
          const serverErrors = response.data.errors
          if (Object.keys(serverErrors).length > 0) {
            setFieldErrors(serverErrors)
            return
          }
        }
        setCreateError(CREATE_FAILED)
        return
      }

      if (response.status === 409) {
        if (isProblemDetails(response.data) && response.data.type === 'meeting-type-exists') {
          setFieldErrors({ id: [ID_TAKEN] })
          return
        }
        setCreateError(CREATE_FAILED)
        return
      }

      setCreateError(CREATE_FAILED)
    } catch {
      setCreateError(CREATE_FAILED)
    } finally {
      setSaving(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTouched({ title: true, description: true, durationMinutes: true, id: true })
    if (saving || formInvalid) {
      return
    }
    void createType()
  }

  function retry() {
    void createType()
  }

  // Коллизия видна до отправки: id совпадает с уже созданным типом из загруженного
  // списка. Суффиксы вида «-2» не добавляются — владелец правит id сам (спека #17).
  const collides = id !== '' && typesState.types.some((type) => type.id === id)

  const localErrors = validate({ title, description, duration, id })
  const formInvalid = Object.keys(localErrors).length > 0 || collides

  function shownError(field: FieldName): string | undefined {
    return fieldErrors[field]?.[0] ?? (touched[field] ? localErrors[field] : undefined)
  }

  const idError = shownError('id') ?? (collides ? ID_TAKEN : undefined)

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <Title order={1}>Страница владельца</Title>

        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xl">
          <Stack gap="xl">
            <form onSubmit={submit}>
              <Stack gap="md">
                <Title order={2}>Новый тип встречи</Title>

                {created && (
                  <Alert color="green" withCloseButton={false}>
                    Тип встречи создан
                  </Alert>
                )}

                {createError && (
                  <Alert color="red" withCloseButton={false}>
                    {createError}{' '}
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={saving}
                      onClick={retry}
                    >
                      Повторить
                    </Button>
                  </Alert>
                )}

                <TextInput
                  ref={titleInputRef}
                  label="Название"
                  value={title}
                  onChange={(event) => handleTitleChange(event.currentTarget.value)}
                  onBlur={() => markTouched('title')}
                  disabled={saving}
                  maxLength={TITLE_MAX_LENGTH}
                  error={shownError('title')}
                />

                <Textarea
                  label="Описание"
                  value={description}
                  onChange={(event) => handleDescriptionChange(event.currentTarget.value)}
                  onBlur={() => markTouched('description')}
                  disabled={saving}
                  maxLength={DESCRIPTION_MAX_LENGTH}
                  error={shownError('description')}
                />

                <NumberInput
                  label="Длительность, мин"
                  value={duration}
                  onChange={handleDurationChange}
                  onBlur={() => markTouched('durationMinutes')}
                  disabled={saving}
                  min={DURATION_MIN_MINUTES}
                  max={DURATION_MAX_MINUTES}
                  step={DURATION_STEP_MINUTES}
                  error={shownError('durationMinutes')}
                />

                <TextInput
                  label="Идентификатор"
                  value={id}
                  onChange={(event) => handleIdChange(event.currentTarget.value)}
                  onBlur={() => markTouched('id')}
                  disabled={saving}
                  maxLength={ID_MAX_LENGTH}
                  description={idDetached ? undefined : ID_HINT}
                  inputWrapperOrder={['label', 'input', 'description', 'error']}
                  error={idError}
                />

                <Group>
                  <Button type="submit" loading={saving} disabled={saving || formInvalid}>
                    Создать
                  </Button>
                </Group>
              </Stack>
            </form>

            <Stack gap="md">
              <Title order={2}>Типы встреч</Title>

              {typesState.status === 'loading' && (
                <Stack gap="xs">
                  <Skeleton height={22} radius="sm" />
                  <Skeleton height={22} radius="sm" width="80%" />
                </Stack>
              )}

              {typesState.status === 'error' && (
                <Alert color="red" withCloseButton={false}>
                  Не удалось загрузить типы встреч{' '}
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => fetchTypes().then(setTypesState)}
                  >
                    Повторить
                  </Button>
                </Alert>
              )}

              {typesState.status === 'ready' && typesState.types.length === 0 && (
                <Stack gap={0}>
                  <Text c="dimmed">Типы встреч ещё не созданы</Text>
                  <Text c="dimmed" fz="sm">
                    Заполните форму «Новый тип встречи», чтобы создать первый тип.
                  </Text>
                </Stack>
              )}

              {typesState.status === 'ready' && typesState.types.length > 0 && (
                <List withPadding={false}>
                  {typesState.types.map((type) => (
                    <List.Item key={type.id}>
                      <Group justify="space-between" gap="md">
                        <Stack gap={0}>
                          <Text fw={600}>{type.title}</Text>
                          <Text fz="sm" c="dimmed">
                            {type.id}
                          </Text>
                        </Stack>
                        <Text fz="sm">{type.durationMinutes} мин</Text>
                      </Group>
                    </List.Item>
                  ))}
                </List>
              )}
            </Stack>
          </Stack>

          <Stack gap="md">
            <Group justify="space-between" align="center" gap="sm" wrap="wrap">
              <Title order={2}>Предстоящие встречи</Title>
              <Group gap="sm" align="center">
                {meetingsUpdatedAt && (
                  <Text fz="sm" c="dimmed">
                    Обновлено в {formatTimeOfDay(meetingsUpdatedAt)}
                  </Text>
                )}
                <Button
                  variant="default"
                  size="xs"
                  loading={meetingsState.status === 'loading'}
                  onClick={refreshMeetings}
                >
                  Обновить
                </Button>
              </Group>
            </Group>

            <Text fz="sm" c="dimmed">
              Время указано по Москве (UTC+3)
            </Text>

            {meetingsState.status === 'error' && (
              <Alert color="red" withCloseButton={false}>
                Не удалось загрузить предстоящие встречи{' '}
                <Button variant="outline" size="xs" onClick={refreshMeetings}>
                  Повторить
                </Button>
              </Alert>
            )}

            {meetingsState.status === 'loading' && meetingsState.meetings.length === 0 && (
              <div role="status" aria-label="Загрузка предстоящих встреч">
                <Stack gap="xs">
                  <Skeleton height={22} radius="sm" />
                  <Skeleton height={22} radius="sm" width="80%" />
                  <Skeleton height={22} radius="sm" width="60%" />
                </Stack>
              </div>
            )}

            {meetingsState.status === 'ready' && meetingsState.meetings.length === 0 && (
              <Text c="dimmed">Предстоящих встреч нет</Text>
            )}

            {meetingsState.meetings.length > 0 && (
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Когда</Table.Th>
                    <Table.Th>Тип встречи</Table.Th>
                    <Table.Th>Длительность</Table.Th>
                    <Table.Th>Гость</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {meetingsState.meetings.map((meeting) => (
                    <Table.Tr key={meeting.id}>
                      <Table.Td>{formatMeetingWhen(meeting.start, meeting.end)}</Table.Td>
                      <Table.Td>{meeting.meetingTypeTitle}</Table.Td>
                      <Table.Td>{meeting.durationMinutes} мин</Table.Td>
                      <Table.Td>{meeting.guestName}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        </SimpleGrid>
      </Stack>
    </Container>
  )
}
