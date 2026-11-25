import { spawnSync } from 'node:child_process'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  analyzeAuditWithModel,
  auditUrl,
  readAuditReport,
  trainingReport,
  validateAuditResult,
} from './lighthouse-audit.mjs'

const { AUDIT_DIR: directory, AUDIT_MODE: mode, APP_URL: appUrl } = process.env

async function collect() {
  await mkdir(directory, { recursive: true })
  const reportPath = join(directory, 'lighthouse.json')
  let url
  let unavailable
  try {
    if (mode === 'training') {
      url = 'https://example.invalid/book'
      await writeFile(reportPath, JSON.stringify(trainingReport(url), null, 2))
    } else if (mode === 'live') {
      url = auditUrl(appUrl)
      const warmup = spawnSync(
        'curl',
        [
          '--fail',
          '--silent',
          '--location',
          '--max-time',
          '90',
          '--output',
          '/dev/null',
          '--',
          url,
        ],
        { stdio: 'ignore', timeout: 95_000 },
      )
      if (warmup.status !== 0) throw new Error('Страница недоступна из GitHub Actions.')
      const lighthouse = spawnSync(
        'npm',
        [
          'exec',
          '--yes',
          '--package=lighthouse@13.6.0',
          '--',
          'lighthouse',
          '--only-categories=performance',
          '--output=json',
          `--output-path=${reportPath}`,
          '--chrome-flags=--headless',
          '--quiet',
          url,
        ],
        { stdio: 'ignore', timeout: 360_000 },
      )
      if (lighthouse.status !== 0)
        throw new Error('Сбор Lighthouse завершился ошибкой или по тайм-ауту.')
    } else {
      throw new Error('Неизвестный режим аудита.')
    }
    const raw = await readFile(reportPath, 'utf8').catch(() => '')
    let report
    try {
      report = JSON.parse(raw)
    } catch {
      throw new Error('Lighthouse не записал читаемый JSON-отчёт.')
    }
    readAuditReport(report, mode, url)
  } catch (error) {
    unavailable = error.code ? 'Не удалось сохранить отчёт Lighthouse.' : error.message
  }
  await writeFile(join(directory, 'collection.json'), JSON.stringify({ mode, url, unavailable }))
  await appendFile(process.env.GITHUB_OUTPUT, `available=${!unavailable}\n`)
}

async function analyze() {
  const apiKey = process.env.OPENCODE_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  const cloudflareKey = process.env.CLOUDFLARE_API_KEY
  const cloudflareAvailable = Boolean(cloudflareKey && process.env.CLOUDFLARE_ACCOUNT_ID)
  if (!apiKey) throw new Error('Нужен секрет OPENCODE_API_KEY.')
  const collection = JSON.parse(await readFile(join(directory, 'collection.json'), 'utf8'))
  const report = readAuditReport(
    JSON.parse(await readFile(join(directory, 'lighthouse.json'), 'utf8')),
    collection.mode,
    collection.url,
  )
  const config = JSON.parse(await readFile('.github/opencode/opencode.json', 'utf8'))
  const prompt = await readFile('.github/opencode/lighthouse-audit-prompt.txt', 'utf8')
  const env = { ...process.env, OPENCODE_DISABLE_PROJECT_CONFIG: '1' }
  delete env.GH_TOKEN
  delete env.GITHUB_TOKEN
  const invoke = (model) =>
    spawnSync(
      process.env.OPENCODE_BIN ?? 'opencode',
      [
        'run',
        '--standalone',
        '--format',
        'json',
        '--agent',
        'discussion',
        '--model',
        model,
        '--title',
        'Lighthouse audit',
      ],
      {
        cwd: directory,
        env,
        input: `${prompt}\n\nДанные отчёта (JSON):\n${JSON.stringify(report)}`,
        encoding: 'utf8',
        maxBuffer: 2_000_000,
        timeout: 120_000,
      },
    )
  const { model, verdict } = analyzeAuditWithModel(config.model, invoke, {
    cloudflareAvailable,
    geminiAvailable: Boolean(geminiKey),
    reportFallback: (reason) => console.warn(`OpenCode: ${reason}. Пробуем следующую модель.`),
  })
  const result = validateAuditResult(report, verdict)
  const json = JSON.stringify(result)
  if ([apiKey, geminiKey, cloudflareKey].some((key) => key && json.includes(key))) {
    throw new Error('Ответ OpenCode содержит секрет.')
  }
  await mkdir(process.env.AUDIT_RESULT_DIR, { recursive: true })
  await writeFile(join(process.env.AUDIT_RESULT_DIR, 'analysis.json'), json)
  console.log(`Отчёт проанализирован моделью ${model}.`)
}

try {
  const command = process.argv[2]
  if (command === 'collect') await collect()
  else if (command === 'analyze') await analyze()
  else throw new Error('Ожидается команда collect или analyze.')
} catch (error) {
  console.error(`Аудит Lighthouse: ${error.message}`)
  process.exitCode = 1
}
