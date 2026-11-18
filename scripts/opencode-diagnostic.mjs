const categories = {
  submission_missing: ['reply', 'Модель не передала результат через submit_reply.'],
  submission_conflict: ['reply', 'Модель передала разные результаты через submit_reply.'],
  cli_start: ['cli', 'Не удалось запустить OpenCode CLI.'],
  cli_exit: ['cli', 'OpenCode CLI завершился с ошибкой.'],
  stream_limit: ['stream', 'Ответ OpenCode превысил допустимый размер.'],
  provider_error: ['provider', 'Провайдер модели сообщил об ошибке.'],
  provider_auth: ['provider', 'Провайдер отклонил авторизацию.'],
  provider_rate: ['provider', 'Провайдер сообщил об ограничении запросов (HTTP 429).'],
  stream_json: ['stream', 'OpenCode вернул некорректный поток JSONL.'],
  incomplete: ['stream', 'OpenCode не вернул завершённый ответ.'],
  reply_json: ['reply', 'Итоговый ответ модели не является JSON или единственным блоком JSON.'],
  reply_schema: ['reply', 'Итоговый ответ модели не соответствует схеме публикации.'],
  file_read: ['files', 'Не удалось прочитать входные файлы.'],
  file_write: ['files', 'Не удалось записать результат подготовки.'],
  configuration: ['configuration', 'Не задана необходимая конфигурация OpenCode.'],
  publication: ['publish', 'Не удалось завершить публикацию.'],
  unknown: ['unknown', 'OpenCode не завершил подготовку или публикацию.'],
}

export class DiagnosticError extends Error {
  constructor(code, details) {
    super(code)
    this.diagnostic = { version: 1, code, stage: categories[code][0] }
    if (['reply_json', 'reply_schema'].includes(code) && details !== undefined)
      this.diagnostic = { version: 2, code, stage: 'reply', details }
    if (code === 'reply_schema' && details?.reason !== undefined)
      this.diagnostic = { version: 3, code, stage: 'reply', details }
    if (code === 'publication') this.diagnostic = { version: 3, code, stage: 'publish', details }
    if (code === 'reply_json' && details?.category !== undefined)
      this.diagnostic = { version: 4, code, stage: 'reply', details }
  }
}

export function diagnosticFor(error) {
  return error instanceof DiagnosticError && validDiagnostic(error.diagnostic)
    ? error.diagnostic
    : { version: 1, code: 'unknown', stage: 'unknown' }
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === keys.split(',').sort().join(',')
  )
}

function bounded(value) {
  return Number.isInteger(value) && value >= 0 && value <= 2_000_000
}

function validDiagnostic(value) {
  if (
    !value ||
    typeof value.code !== 'string' ||
    !Object.hasOwn(categories, value.code) ||
    value.stage !== categories[value.code][0]
  )
    return false
  if (value.code === 'publication')
    return (
      value.version === 3 &&
      exactKeys(value, 'version,code,stage,details') &&
      exactKeys(value.details, 'reason,state') &&
      typeof value.details.reason === 'string' &&
      typeof value.details.state === 'string' &&
      Object.hasOwn(publicationReasons, value.details.reason) &&
      ['none', 'possible', 'unknown'].includes(value.details.state)
    )
  if (value.version === 1) return exactKeys(value, 'version,code,stage')
  if (value.version === 4) {
    if (!exactKeys(value, 'version,code,stage,details') || value.code !== 'reply_json') return false
    const d = value.details
    if (
      !exactKeys(
        d,
        'streamBytes,eventCount,textEventCount,messageCount,finalTextEventCount,answerBytes,candidateChars,wrapper,root,parseKind,position,category,line,column,unclosed',
      )
    )
      return false
    const { category, line, column, unclosed, ...legacy } = d
    return (
      validDiagnostic({ version: 2, code: 'reply_json', stage: 'reply', details: legacy }) &&
      typeof category === 'string' &&
      Object.hasOwn(jsonReasons, category) &&
      ['none', 'object', 'array', 'string'].includes(unclosed) &&
      d.candidateChars <= d.answerBytes &&
      d.answerBytes <= d.streamBytes &&
      d.finalTextEventCount <= d.textEventCount &&
      d.textEventCount <= d.eventCount &&
      d.messageCount <= d.textEventCount &&
      (d.position === null
        ? line === null && column === null
        : bounded(line) &&
          bounded(column) &&
          line >= 1 &&
          column >= 1 &&
          line + column <= d.position + 2 &&
          (line !== 1 || column === d.position + 1)) &&
      Buffer.byteLength(JSON.stringify(value)) <= 1024
    )
  }
  if (value.version === 3)
    return (
      exactKeys(value, 'version,code,stage,details') &&
      value.code === 'reply_schema' &&
      exactKeys(value.details, 'rule,field,reason') &&
      typeof value.details.rule === 'string' &&
      typeof value.details.field === 'string' &&
      typeof value.details.reason === 'string' &&
      Object.hasOwn(schemaFields, value.details.rule) &&
      schemaFields[value.details.rule].includes(value.details.field) &&
      Object.hasOwn(schemaReasons, value.details.reason)
    )
  if (value.version !== 2 || !exactKeys(value, 'version,code,stage,details')) return false
  const details = value.details
  if (value.code === 'reply_schema')
    return (
      exactKeys(details, 'rule') &&
      [
        'version_comment',
        'publication_kind',
        'publication_items',
        'spec_item_count',
        'ticket_references',
        'item_key',
        'item_text',
        'item_blockers',
        'blocker_order',
        'spec_blockers',
        'schema_other',
      ].includes(details.rule)
    )
  if (value.code !== 'reply_json') return false
  const counts = [
    'streamBytes',
    'eventCount',
    'textEventCount',
    'messageCount',
    'finalTextEventCount',
    'answerBytes',
    'candidateChars',
  ]
  return (
    exactKeys(details, [...counts, 'wrapper', 'root', 'parseKind', 'position'].join(',')) &&
    counts.every((key) => bounded(details[key])) &&
    ['none', 'json_fence', 'bare_fence', 'other_fence'].includes(details.wrapper) &&
    ['object', 'array', 'other', 'empty'].includes(details.root) &&
    [
      'unexpected_end',
      'trailing_content',
      'invalid_escape',
      'invalid_control',
      'syntax_other',
    ].includes(details.parseKind) &&
    (details.position === null ||
      (bounded(details.position) && details.position <= details.candidateChars))
  )
}

const jsonReasons = {
  not_json: 'Ответ не распознан как JSON.',
  wrapper: 'Неподдерживаемая Markdown-обёртка или текст вне JSON.',
  trailing: 'Лишнее содержимое после JSON.',
  escaping: 'Неверное экранирование или управляющий символ в JSON.',
  syntax: 'Синтаксическая ошибка внутри документа JSON.',
  end: 'Ошибка на конце документа JSON; причина завершения ответа неизвестна.',
  unclassified: 'Неклассифицированная синтаксическая ошибка JSON.',
}

const schemaFields = {
  version_comment: ['reply', 'version', 'comment'],
  publication_kind: ['publication', 'kind'],
  publication_items: ['items'],
  spec_item_count: ['items'],
  ticket_references: ['spec', 'approvalComment'],
  item_key: ['item', 'key'],
  item_text: ['title', 'body'],
  item_blockers: ['blockedBy'],
  blocker_order: ['blockedBy'],
  spec_blockers: ['blockedBy'],
}
const schemaReasons = {
  missing: 'Отсутствует обязательное поле',
  type: 'Неверный тип поля',
  empty: 'Пустое значение поля',
  too_long: 'Превышен допустимый размер поля',
  invalid: 'Недопустимое значение поля',
  duplicate_key: 'Повтор ключа в поле',
  duplicate_dependency: 'Повтор зависимости в поле',
  reference: 'Ссылка ведёт не на ранее перечисленный элемент в поле',
}

const publicationReasons = {
  source_context: 'Некорректный контекст исходного обращения.',
  trusted_request: 'Запрос не принадлежит доверенному автору.',
  triage_only: 'Автотриаж допускает только комментарий установленного размера.',
  issue_only: 'Публикация спецификаций и тикетов доступна только в issues.',
  specification_context: 'Спецификация недоступна в переданном контексте.',
  approval: 'Нет подходящего согласования доверенного автора в исходном обсуждении.',
  changed_payload:
    'Ответ изменён относительно предыдущей публикации; используйте исходный артефакт.',
  duplicate_markers: 'Найдены повторные маркеры публикации; требуется проверка созданных issues.',
  configuration: 'Недоступна обязательная метка ready-for-agent.',
  github_read: 'Не удалось прочитать данные GitHub.',
  github_write: 'GitHub не подтвердил операцию записи.',
  pagination: 'Результат GitHub превысил допустимое количество страниц.',
  reply_invalid: 'Итоговый ответ не соответствует протоколу публикации.',
  workflow_context: 'Контекст артефакта не соответствует текущему запуску.',
  artifact_read: 'Не удалось прочитать артефакты публикации.',
  unknown: 'Не удалось завершить публикацию по неизвестной причине.',
}

export function failureNotice(diagnostic, run, publicationState) {
  const notice = buildFailureNotice(diagnostic, run)
  if (validDiagnostic(diagnostic) && diagnostic.code === 'publication') return notice
  const state = ['none', 'possible', 'unknown'].includes(publicationState)
    ? publicationState
    : 'unknown'
  const status =
    state === 'none'
      ? 'Публикация не начиналась (none).'
      : state === 'possible'
        ? 'Публикация могла начаться в предыдущем прогоне (possible). При частичной публикации сохраните созданные issues и восстановите издателя с исходным корректным артефактом.'
        : 'Состояние публикации неизвестно (unknown). Сначала проверьте созданные issues и комментарии; слепой повтор не рекомендуется.'
  return notice.replace(
    'Публикация не начиналась.',
    status +
      ' Корректного reply.json нет: результата для восстановления этого ответа нет, повтор только издателя не поможет.',
  )
}

function buildFailureNotice(diagnostic, run) {
  const code = validDiagnostic(diagnostic) ? diagnostic.code : 'unknown'
  if (code === 'publication') {
    const state =
      diagnostic.details.state === 'none'
        ? 'Публикация не начиналась (none). Проверьте причину и исходный корректный артефакт перед восстановлением издателя.'
        : diagnostic.details.state === 'possible'
          ? 'Публикация могла начаться (possible). При частичной публикации сохраните созданные issues и восстановите издателя с исходным корректным артефактом.'
          : 'Состояние публикации неизвестно (unknown). Сначала проверьте созданные issues и комментарии; слепой повтор не рекомендуется.'
    return `${publicationReasons[diagnostic.details.reason]} ${state} [Actions](${run})`
  }
  if (code === 'reply_schema' && diagnostic.version === 3)
    return `${schemaReasons[diagnostic.details.reason]} «${diagnostic.details.field}». Публикация не начиналась. [Actions](${run})`
  if (code === 'reply_json') {
    const details = diagnostic.details
    const legacy = {
      unexpected_end: 'end',
      trailing_content: 'trailing',
      invalid_escape: 'escaping',
      invalid_control: 'escaping',
    }
    const reason =
      diagnostic.version === 4
        ? jsonReasons[details.category]
        : (jsonReasons[legacy[details?.parseKind]] ??
          'Не удалось разобрать итоговый ответ модели как JSON.')
    const location =
      details?.position != null
        ? `Позиция в JSON-кандидате: offset ${details.position} (0-based UTF-16)${diagnostic.version === 4 ? `, строка ${details.line}, столбец ${details.column} (1-based)` : '; строка и столбец не сохранены'}.`
        : 'Точная позиция не определена.'
    const structure =
      diagnostic.version === 4 && details.unclosed !== 'none'
        ? `Незакрытая структура: ${{ object: 'объект', array: 'массив', string: 'строка' }[details.unclosed]}.`
        : ''
    return `Стадия: подготовка ответа (reply_json). ${reason} ${location} ${structure} Публикация не начиналась. Безопасные сведения — в артефакте opencode-diagnostic. Передайте ссылку на прогон для диагностики. [Actions](${run})`
  }
  if (code === 'reply_schema')
    return `Итоговый ответ модели не соответствует схеме публикации. Публикация не начиналась. Код reply_schema; безопасные сведения — в артефакте opencode-diagnostic. Передайте ссылку на прогон для диагностики. [Actions](${run})`
  if (code !== 'unknown')
    return `${categories[code][1]} Публикация не начиналась. [Actions](${run})`
  return `${categories[code][1]} Публикация не начиналась. [Actions](${run})`
}
