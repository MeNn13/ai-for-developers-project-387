import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pages, relatedIssues, github, run } from './opencode.mjs'
import { trustedHuman } from './opencode-publish.mjs'
import { validateReply } from './opencode-protocol.mjs'

export function eligible(pr, repository, app = {}) {
  return (
    pr.head?.repo?.full_name === repository &&
    (trustedHuman(pr) ||
      (pr.user?.type === 'Bot' &&
        Boolean(app.login) &&
        Number.isSafeInteger(app.id) &&
        app.id > 0 &&
        pr.user.login === app.login &&
        pr.user.id === app.id))
  )
}

const criteria =
  'Свободные слоты: start > now; пересечения интервалов запрещены; атомарность бронирования при конкуренции. Сетка стартов каждые 30 минут; рабочие часы Пн–Пт 10:00–18:00 Europe/Moscow; окно записи 14 календарных дней. Проверить затронутые сценарии гостя и владельца.'

export async function prepareReview(pr, repository, api) {
  const comments = await pages(api, `/issues/${pr.number}/comments`)
  const context = {
    mode: 'review',
    repository,
    number: pr.number,
    head: pr.head.sha,
    title: pr.title,
    body: pr.body,
    comments,
    criteria,
    related: await relatedIssues({ ...pr, comments }, repository, api),
    diff: await api(`/pulls/${pr.number}`, 'application/vnd.github.diff'),
    reviews: await pages(api, `/pulls/${pr.number}/reviews`),
    threads: await pages(api, `/pulls/${pr.number}/comments`),
    checks: {
      check_runs: await pages(
        async (route) => (await api(route)).check_runs,
        `/commits/${pr.head.sha}/check-runs`,
      ),
    },
    statuses: await api(`/commits/${pr.head.sha}/status`),
  }
  if (Buffer.byteLength(JSON.stringify(context)) > 300_000)
    throw new Error('Review context exceeds 300 KB')
  return context
}

export async function publishReview(reply, context, api, comment, runUrl, app) {
  validateReply(reply)
  if (reply.publication !== null || context.mode !== 'review') throw new Error('Review only')
  const pr = await api(`/pulls/${context.number}`)
  if (!eligible(pr, context.repository, app) || pr.head.sha !== context.head)
    throw new Error('Stale or untrusted review')
  const marker = `<!-- independent-review:${context.head} -->`
  const comments = await pages(api, `/issues/${context.number}/comments`)
  if (
    comments.some(
      (item) => item.user?.login === 'github-actions[bot]' && item.body?.includes(marker),
    )
  )
    return
  await comment(
    context.number,
    `AI: независимое ревью ${context.head}\n\n${reply.comment}\n\n[Actions](${runUrl})\n${marker}`,
  )
}

async function main() {
  const directory = process.env.OPENCODE_IO
  const app = { login: process.env.REVIEW_APP_LOGIN, id: Number(process.env.REVIEW_APP_ID) }
  if (process.argv[2] === 'prepare') {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
    const pr = await github(`/pulls/${event.pull_request.number}`)
    const allowed =
      eligible(pr, process.env.GITHUB_REPOSITORY, app) &&
      pr.head.sha === event.pull_request.head.sha
    await appendFile(process.env.GITHUB_OUTPUT, `allowed=${allowed}\n`)
    if (!allowed) return
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, 'context.json'),
      JSON.stringify(await prepareReview(pr, process.env.GITHUB_REPOSITORY, github)),
    )
  } else if (process.argv[2] === 'run') {
    await run(directory, {
      prompt: '.github/opencode/review-prompt.txt',
      title: 'Independent PR review',
    })
  } else if (process.argv[2] === 'publish') {
    const context = JSON.parse(await readFile(join(directory, 'context.json'), 'utf8'))
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
    if (
      context.repository !== process.env.GITHUB_REPOSITORY ||
      context.number !== event.pull_request.number ||
      context.head !== event.pull_request.head.sha
    )
      throw new Error('Context mismatch')
    const reply = JSON.parse(await readFile(join(directory, 'reply.json'), 'utf8'))
    const { execFileSync } = await import('node:child_process')
    await publishReview(
      reply,
      context,
      github,
      async (number, body) => {
        const file = join(directory, 'comment.md')
        await writeFile(file, body)
        execFileSync(
          'gh',
          ['pr', 'comment', String(number), '--repo', context.repository, '--body-file', file],
          { stdio: 'inherit' },
        )
      },
      `${process.env.GITHUB_SERVER_URL}/${context.repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      app,
    )
  } else throw new Error('Unknown review command')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Independent review failed; see job stage.')
    process.exitCode = 1
  })
}
