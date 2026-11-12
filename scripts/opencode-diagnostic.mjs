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
  unknown: ['unknown', 'OpenCode не завершил подготовку или публикацию.'],
}

export class DiagnosticError extends Error {
  constructor(code, details) {
    super(code)
    this.diagnostic = { version: 1, code, stage: categories[code][0] }
    if (code === 'reply_json' && details !== undefined)
      this.diagnostic = { version: 2, code, stage: 'reply', details }
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
  if (value.version === 1) return exactKeys(value, 'version,code,stage')
  if (
    value.version !== 2 ||
    value.code !== 'reply_json' ||
    !exactKeys(value, 'version,code,stage,details')
  )
    return false
  const details = value.details
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

export function failureNotice(diagnostic, run) {
  const code = validDiagnostic(diagnostic) ? diagnostic.code : 'unknown'
  if (code === 'reply_json')
    return `Не удалось разобрать итоговый ответ модели как JSON. Публикация не начиналась. Код reply_json; безопасные сведения — в артефакте opencode-diagnostic. Передайте ссылку на прогон для диагностики. [Actions](${run})`
  if (code !== 'unknown')
    return `${categories[code][1]} Публикация не начиналась. [Actions](${run})`
  return `${categories[code][1]} При частичной публикации повторите прогон с исходным артефактом; созданные issues сохраняются. [Actions](${run})`
}
