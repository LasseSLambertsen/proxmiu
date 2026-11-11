import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('restricted host updater Python fixtures (no real host operations)', { skip: process.platform === 'win32' ? 'Unix-only host helper; transport and API fixtures run on Windows' : false }, () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'scripts/tests', '-p', 'test_host_updater*.py'], { encoding: 'utf8', timeout: 120_000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
