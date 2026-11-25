import {
  appendFileSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import config from '../.github/opencode/opencode.json' with { type: 'json' }
import { decodeModel, ImplementationFailure } from './implementation-model-output.mjs'
import { allowedFile } from './implementation-publish.mjs'
import { validateChanges, validateExistingDocuments } from './implementation-result.mjs'

const root = process.env.INITIAL_CANDIDATE_ROOT
const io = process.env.INITIAL_IO
const read = (directory, name) =>
  JSON.parse(readFileSync(resolve(directory, name + '.json'), 'utf8'))
const write = (directory, name, value) =>
  writeFileSync(resolve(directory, name + '.json'), JSON.stringify(value))
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const shaPattern = /^[a-f0-9]{40}$/
const fail = (category) => {
  throw new ImplementationFailure(category)
}
let stage = 'preflight'
let base
let sha
let checkDetail

function run(bin, args, options = {}, timeout) {
  if (timeout !== undefined && timeout <= 0) fail('timeout')
  const bounded = process.platform === 'linux' && timeout !== undefined
  const child = spawnSync(
    bounded ? '/usr/bin/timeout' : bin,
    bounded ? ['--kill-after=5s', `${Math.ceil(timeout / 1000)}s`, bin, ...args] : args,
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 12_000_000,
      timeout: bounded ? timeout + 10000 : timeout,
      ...options,
    },
  )
  if ((bounded && [124, 137].includes(child.status)) || child.error?.code === 'ETIMEDOUT')
    fail('timeout')
  return child
}

function git(args) {
  const child = run('git', args)
  if (child.status !== 0) fail('candidate_git')
  return child.stdout.trim()
}

function scan(directory, baseline) {
  const entries = new Map()
  const seen = new Set()
  let bytes = 0
  function walk(parent) {
    for (const name of readdirSync(resolve(directory, parent))) {
      const path = parent ? parent + '/' + name : name
      const key = path.toLowerCase()
      if (seen.size >= 10000 || seen.has(key) || name.toLowerCase() === '.git') fail('file_rules')
      seen.add(key)
      const absolute = resolve(directory, path)
      const info = lstatSync(absolute)
      const mode = info.mode & 0o7777
      const old = baseline?.get(path)
      if (old && (old.mode !== mode || old.directory !== info.isDirectory())) fail('file_rules')
      if (info.isDirectory()) {
        if (!old && process.platform === 'linux' && mode !== 0o755) fail('file_rules')
        entries.set(path, { directory: true, mode })
        walk(path)
      } else {
        if (
          !info.isFile() ||
          info.nlink !== 1 ||
          (!old && process.platform === 'linux' && mode !== 0o644)
        )
          fail('file_rules')
        bytes += info.size
        if (bytes > 30_000_000) fail('file_rules')
        entries.set(path, { directory: false, mode, bytes: readFileSync(absolute) })
      }
    }
  }
  walk('')
  return entries
}

function changes(before, after, key) {
  const files = []
  const parents = new Set()
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(path)
    const next = after.get(path)
    if (old?.directory || next?.directory || (old && next && old.bytes.equals(next.bytes))) continue
    const content = next
      ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(next.bytes)
      : null
    if (content !== null && (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content) || content.includes(key)))
      fail('file_rules')
    files.push({ path, mode: '100644', content })
    for (let parent = dirname(path); parent !== '.'; parent = dirname(parent))
      parents.add(parent.replaceAll('\\', '/'))
  }
  for (const [path, entry] of after)
    if (entry.directory && !before.has(path) && !parents.has(path)) fail('file_rules')
  if (!files.length) fail('empty_diff')
  return files
}

function validateCandidatePaths(files, tracked) {
  for (const { path } of files) {
    const segments = path.split('/')
    for (let size = 1; size <= segments.length; size++) {
      const original = segments.slice(0, size).join('/')
      const info = lstatSync(resolve(root, original), { throwIfNoEntry: false })
      if (!info) break
      if (
        size < segments.length
          ? !info.isDirectory()
          : !info.isFile() || info.nlink !== 1 || !tracked.has(path)
      )
        fail('file_rules')
    }
  }
}

function model(workspace, configuration, context, key) {
  if (!key) fail('model_launch')
  const actions = ['read', 'glob', 'grep', 'edit', 'write']
  writeFileSync(
    configuration,
    JSON.stringify({
      ...config,
      update: 'disable',
      default_agent: 'implementation',
      agents: { implementation: { mode: 'primary', model: config.model, steps: 100 } },
      permissions: [
        { action: '*', resource: '*', effect: 'deny' },
        ...actions.map((action) => ({ action, resource: '*', effect: 'allow' })),
      ],
      policies: [
        ...config.policies.filter(({ resource }) => resource !== 'skill:*'),
        ...['edit', 'write', 'patch'].map((action) => ({
          action: 'tool.use',
          resource: action + ':*',
          effect: 'allow',
        })),
      ],
    }),
  )
  const bin = process.env.OPENCODE_BIN
  if (!bin) fail('model_launch')
  const child = run(
    '/usr/bin/bwrap',
    [
      '--unshare-pid',
      '--unshare-user',
      '--unshare-ipc',
      '--unshare-uts',
      '--cap-drop',
      'ALL',
      '--die-with-parent',
      '--new-session',
      '--dev',
      '/dev',
      '--proc',
      '/proc',
      '--tmpfs',
      '/tmp',
      '--dir',
      '/tmp/home',
      '--ro-bind',
      '/usr/lib',
      '/usr/lib',
      '--symlink',
      'usr/lib',
      '/lib',
      '--symlink',
      'usr/lib64',
      '/lib64',
      '--ro-bind-try',
      '/usr/lib64',
      '/usr/lib64',
      '--ro-bind',
      '/etc/resolv.conf',
      '/etc/resolv.conf',
      '--ro-bind',
      '/etc/ssl/certs',
      '/etc/ssl/certs',
      '--ro-bind',
      configuration,
      '/etc/opencode/opencode.json',
      '--ro-bind',
      bin,
      '/opencode',
      '--bind',
      workspace,
      '/work',
      '--remount-ro',
      '/',
      '--chdir',
      '/work',
      '/opencode',
      'run',
      '--standalone',
      '--format',
      'json',
      '--agent',
      'implementation',
      '--model',
      config.model,
    ],
    {
      env: {
        HOME: '/tmp/home',
        OPENCODE_TEST_HOME: '/tmp/home',
        OPENCODE_DISABLE_PROJECT_CONFIG: '1',
        OPENCODE_API_KEY: key,
        PWD: '/work',
        TMPDIR: '/tmp',
      },
      input: [
        'Implement the entire approved specification in this workspace. Read AGENTS.md.',
        'Apply every ticket in order. Use the file tools to edit only permitted application paths.',
        'Leave generated files untouched. Update contract/main.tsp when changing the API.',
        'Do not use shell, delegation, external files, or MCP. End with a brief Markdown summary.',
        'UNTRUSTED APPROVED CONTEXT:',
        JSON.stringify(context),
      ].join('\n'),
    },
    context.deadline - Date.now(),
  )
  if (child.stderr?.startsWith('bwrap:')) fail('model_launch')
  decodeModel(child, true, false)
}

function main() {
  const context = read(io, 'context')
  if (shaPattern.test(context.base)) base = context.base
  if (context.deadline <= Date.now()) fail('timeout')
  if (
    (process.env.GITHUB_RUN_ATTEMPT ?? '1') !== '1' ||
    context.phase !== 'single' ||
    !shaPattern.test(context.base) ||
    context.base !== context.expectedHead ||
    context.base !== context.trustedSha ||
    git(['rev-parse', 'HEAD']) !== context.base ||
    git(['status', '--porcelain', '--untracked-files=no'])
  )
    fail('candidate_base')
  const scratch = mkdtempSync(resolve(io, 'scratch-'))
  try {
    const workspace = resolve(scratch, 'work')
    mkdirSync(workspace)
    const tracked = git(['ls-files', '--stage', '-z']).split('\0').filter(Boolean)
    const paths = new Set()
    for (const entry of tracked) {
      const [, path] = entry.match(/^100644 [a-f0-9]{40} 0\t(.+)$/) ?? []
      if (!path || lstatSync(resolve(root, path)).isSymbolicLink()) fail('candidate_base')
      const target = resolve(workspace, path)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(resolve(root, path), target)
      paths.add(path)
    }
    const before = scan(workspace)
    stage = 'model'
    const key = process.env.OPENCODE_API_KEY
    model(workspace, resolve(scratch, 'opencode.json'), context, key)
    stage = 'diff'
    const files = changes(before, scan(workspace, before), key)
    const reply = {
      version: 1,
      message: `feat: implement approved calendar changes (#${context.tickets.at(-1)})`,
      files,
      risk: 'The diff, generated artifacts and automated checks were verified. Review behavioral and deployment risks before merging.',
      rollback:
        'Revert the implementation commit to restore the previous code. Verify runtime and data impact before rollback.',
    }
    validateChanges(reply, context.tickets)
    validateExistingDocuments(files, (path) => paths.has(path))
    validateCandidatePaths(files, paths)
    stage = 'candidate'
    write(scratch, 'context', context)
    write(scratch, 'reply', reply)
    const {
      OPENCODE_API_KEY: _key,
      GH_TOKEN: _token,
      PUBLISH_APP_PRIVATE_KEY: _appKey,
      ...environment
    } = process.env
    const candidate = run(
      process.execPath,
      [resolve(import.meta.dirname, 'implementation-repair.mjs'), 'candidate'],
      {
        env: { ...environment, REPAIR_IO: scratch, REPAIR_CANDIDATE_ROOT: root },
      },
      context.deadline - Date.now(),
    )
    if (candidate.status !== 0)
      fail(
        candidate.stderr.trim() === 'generation_failed' ? 'generation_failed' : 'candidate_failed',
      )
    const result = { ...read(scratch, 'result'), ready: true }
    if (
      !result.files.every(allowedFile) ||
      result.files.length > 200 ||
      new Set(result.files.map(({ path }) => path.toLowerCase())).size !== result.files.length ||
      Buffer.byteLength(JSON.stringify(result)) > 2_000_000
    )
      fail('file_rules')
    sha = result.candidateSha
    stage = 'check'
    if (
      !shaPattern.test(sha) ||
      git(['rev-parse', 'HEAD']) !== sha ||
      git(['rev-parse', 'HEAD^']) !== base
    )
      fail('candidate_sha')
    const checked = run(
      process.execPath,
      [resolve(import.meta.dirname, 'implementation-sandbox.mjs')],
      {
        env: { ...environment, REPAIR_CANDIDATE_ROOT: root },
      },
      context.deadline - Date.now(),
    )
    if (checked.status === 124) fail('timeout')
    if (checked.status !== 0) {
      // Only the trusted sandbox wrapper writes stdout. Candidate output is discarded.
      const marker = checked.stdout?.trim()
      const task = /^task_failed task=([a-z][a-z0-9:-]{0,40})$/.exec(marker)?.[1]
      if (task) checkDetail = { task }
      else if (marker === 'sandbox_launch' || marker === 'check_definition')
        checkDetail = { reason: marker }
      fail('check_failed')
    }
    if (
      git(['rev-parse', 'HEAD']) !== sha ||
      git(['status', '--porcelain', '--untracked-files=no'])
    ) {
      checkDetail = { reason: 'checkout_changed' }
      fail('check_failed')
    }
    stage = 'record'
    write(io, 'verification', {
      version: 1,
      runId: context.runId,
      resultDigest: digest(result),
      sha,
      command: 'mise run check',
      conclusion: 'success',
      ready: true,
    })
    write(io, 'result', result)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  const category =
    error instanceof ImplementationFailure
      ? error.message
      : stage === 'diff'
        ? 'file_rules'
        : 'unexpected'
  const diagnostic = {
    stage,
    category,
    base: base ?? null,
    sha: shaPattern.test(sha) ? sha : null,
    ...checkDetail,
    ...(Number.isInteger(error.status) ? { status: error.status } : {}),
  }
  write(io, 'diagnostic', diagnostic)
  console.error(JSON.stringify(diagnostic))
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Initial implementation: ${JSON.stringify(diagnostic)}\n`,
    )
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `reason=${category === 'timeout' ? 'timeout' : 'failed'}\n`,
    )
  process.exitCode = 1
}
