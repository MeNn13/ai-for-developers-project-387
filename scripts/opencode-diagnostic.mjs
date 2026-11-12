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
  constructor(code) {
    super(code)
    this.diagnostic = { version: 1, code, stage: categories[code][0] }
  }
}

export function diagnosticFor(error) {
  return error instanceof DiagnosticError
    ? error.diagnostic
    : { version: 1, code: 'unknown', stage: 'unknown' }
}

export function failureNotice(diagnostic, run) {
  const valid =
    diagnostic &&
    Object.keys(diagnostic).sort().join(',') === 'code,stage,version' &&
    diagnostic.version === 1 &&
    typeof diagnostic.code === 'string' &&
    Object.hasOwn(categories, diagnostic.code) &&
    diagnostic.stage === categories[diagnostic.code][0]
  const code = valid ? diagnostic.code : 'unknown'
  return `${categories[code][1]} При частичной публикации повторите прогон с исходным артефактом; созданные issues сохраняются. [Actions](${run})`
}
