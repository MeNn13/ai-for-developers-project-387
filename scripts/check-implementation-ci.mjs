#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const candidate = process.env.INITIAL_CANDIDATE_ROOT
assert.ok(process.platform === 'linux', 'The implementation CI fixture requires Linux Bubblewrap')
assert.ok(candidate && process.env.RUNNER_TEMP, 'Set INITIAL_CANDIDATE_ROOT and RUNNER_TEMP')
const git = (...args) => execFileSync('git', args, { cwd: candidate, encoding: 'utf8' }).trim()
// A native executable stands in for the pinned CLI inside the real Bubblewrap boundary.
function fixture(io, changes) {
  const source = join(io, 'model.c')
  const bin = join(io, 'model')
  const events = [
    { type: 'text', text: '## Both dependent tickets implemented' },
    { type: 'step_finish', reason: 'stop' },
  ].map(({ type, ...part }) =>
    JSON.stringify({
      type,
      sessionID: 'fixture',
      part: { sessionID: 'fixture', messageID: 'reply', ...part },
    }),
  )
  const writes = changes.map(
    ([path, text]) =>
      `out = fopen(${JSON.stringify(path)}, "w");
     if (!out || fputs(${JSON.stringify(text)}, out) < 0 || fclose(out)) return 3;`,
  )
  writeFileSync(
    source,
    `
    #include <stdio.h>
    #include <stdlib.h>
    #include <string.h>
    #include <unistd.h>
    int main(void) {
      char input[300001];
      size_t length = fread(input, 1, sizeof(input)-1, stdin);
      input[length] = 0;
      if (!strstr(input, "\\"order\\":[57,58]") || getenv("GH_TOKEN") ||
          getenv("PUBLISH_APP_PRIVATE_KEY") || !getenv("OPENCODE_API_KEY") ||
          !access(".git", F_OK) || !access("/opencode", W_OK) ||
          !access("/etc/opencode/opencode.json", W_OK) ||
          !access("/usr/bin/git", F_OK)) return 2;
      FILE *out;
      ${writes.join('\n')}
      ${events.map((event) => `puts(${JSON.stringify(event)});`).join('\n')}
      return 0;
    }`,
  )
  execFileSync('/usr/bin/cc', ['-o', bin, source])
  return bin
}

const base = git('rev-parse', 'HEAD')
{
  for (const scenario of ['valid', 'invalid']) {
    git('checkout', '--detach', base)
    const io = join(process.env.RUNNER_TEMP, 'graph-' + scenario)
    mkdirSync(io)
    const json = (name) => JSON.parse(readFileSync(join(io, name + '.json'), 'utf8'))
    writeFileSync(
      join(io, 'context.json'),
      JSON.stringify({
        version: 1,
        runId: 1,
        initial: true,
        phase: 'single',
        expectedHead: base,
        trustedSha: base,
        base,
        tickets: [58, 57],
        order: [57, 58],
        graph: [
          { number: 58, blockedBy: [57] },
          { number: 57, blockedBy: [] },
        ],
        deadline: Date.now() + 60 * 60 * 1000,
        commitDate: '2026-11-15T00:00:00Z',
      }),
    )
    const result = spawnSync(
      process.execPath,
      [resolve(import.meta.dirname, 'implementation-graph.mjs')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          INITIAL_IO: io,
          GITHUB_OUTPUT: join(io, 'outputs'),
          GITHUB_RUN_ATTEMPT: '1',
          OPENCODE_BIN: fixture(io, [
            [
              'contract/main.tsp',
              readFileSync(join(candidate, 'contract/main.tsp'), 'utf8').replace(
                'title: "Booking Calendar API"',
                'title: "Booking Calendar CI"',
              ),
            ],
            [
              'README.md',
              readFileSync(join(candidate, 'README.md'), 'utf8') +
                (scenario === 'invalid' ? '\n#    Invalid   formatting\n' : '\nCI fixture.\n'),
            ],
          ]),
          OPENCODE_API_KEY: 'fixture-provider-key',
          GH_TOKEN: 'fixture-github',
          PUBLISH_APP_PRIVATE_KEY: 'fixture-app',
        },
      },
    )
    if (scenario === 'valid') {
      assert.equal(result.status, 0, result.stderr)
      assert.equal(json('result').ready, true)
      assert.ok(
        json('result').files.some(
          (file) =>
            file.path === 'contract/openapi/openapi.yaml' &&
            file.content.includes('Booking Calendar CI'),
        ),
      )
      assert.equal(json('result').candidateSha, git('rev-parse', 'HEAD'))
      assert.equal(json('verification').sha, json('result').candidateSha)
      assert.equal(git('rev-parse', 'HEAD^'), base)
      assert.ok(json('result').files.some(({ path }) => path === 'README.md'))
    } else {
      assert.equal(result.status, 1, result.stderr)
      assert.equal(json('diagnostic').category, 'check_failed', result.stderr)
      assert.equal(json('diagnostic').task, 'lint', result.stderr)
      assert.equal(json('diagnostic').sha, git('rev-parse', 'HEAD'))
      assert.equal(existsSync(join(io, 'result.json')), false)
      assert.equal(existsSync(join(io, 'verification.json')), false)
    }
  }
}
