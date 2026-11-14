const categories = {
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

export function failureNotice(diagnostic, run, previousPublicationUnknown = false) {
  const notice = buildFailureNotice(diagnostic, run)
  return previousPublicationUnknown
    ? notice.replace(
        'Публикация не начиналась.',
        'Публикация могла начаться в предыдущем прогоне. При частичной публикации повторите прогон с исходным артефактом; созданные issues сохраняются.',
      )
    : notice
}

function buildFailureNotice(diagnostic, run) {
  const code = validDiagnostic(diagnostic) ? diagnostic.code : 'unknown'
  if (code === 'publication') {
    const state =
      diagnostic.details.state === 'none'
        ? 'Публикация не начиналась.'
        : 'Публикация могла начаться, в том числе в предыдущем прогоне. Повторите прогон с исходным артефактом; созданные issues сохраняются.'
    return `${publicationReasons[diagnostic.details.reason]} ${state} [Actions](${run})`
  }
  if (code === 'reply_schema' && diagnostic.version === 3)
    return `${schemaReasons[diagnostic.details.reason]} «${diagnostic.details.field}». Публикация не начиналась. [Actions](${run})`
  if (code === 'reply_json')
    return `Не удалось разобрать итоговый ответ модели как JSON. Публикация не начиналась. Код reply_json; безопасные сведения — в артефакте opencode-diagnostic. Передайте ссылку на прогон для диагностики. [Actions](${run})`
  if (code === 'reply_schema')
    return `Итоговый ответ модели не соответствует схеме публикации. Публикация не начиналась. Код reply_schema; безопасные сведения — в артефакте opencode-diagnostic. Передайте ссылку на прогон для диагностики. [Actions](${run})`
  if (code !== 'unknown')
    return `${categories[code][1]} Публикация не начиналась. [Actions](${run})`
  return `${categories[code][1]} При частичной публикации повторите прогон с исходным артефактом; созданные issues сохраняются. [Actions](${run})`
}
