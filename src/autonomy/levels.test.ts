import assert from 'node:assert/strict'
import { test } from 'node:test'
import { downgrade, effectiveLevel, minLevel, parseLevel } from './levels.js'
import { taskLevel } from './tasks.js'

test('task table maps the four demo tasks', () => {
  assert.equal(taskLevel('check_freshness'), 'inform')
  assert.equal(taskLevel('rerun_stale_load'), 'ask')
  assert.equal(taskLevel('rerun_failed_load'), 'fix_notify')
  assert.equal(taskLevel('rerun_empty_load'), 'fix_log')
})

test('effective level is the minimum of task, agent max, and optional request', () => {
  assert.equal(effectiveLevel({ taskLevel: 'inform', agentMax: 'fix_log' }), 'inform')
  assert.equal(effectiveLevel({ taskLevel: 'fix_log', agentMax: 'ask' }), 'ask')
  assert.equal(effectiveLevel({ taskLevel: 'fix_log', agentMax: 'fix_log', requested: 'inform' }), 'inform')
  assert.equal(effectiveLevel({ taskLevel: 'fix_notify', agentMax: 'fix_log', requested: 'ask' }), 'ask')
})

test('a requested or task level cannot raise the agent ceiling', () => {
  assert.equal(effectiveLevel({ taskLevel: 'inform', agentMax: 'fix_log', requested: 'fix_log' }), 'inform')
  assert.equal(effectiveLevel({ taskLevel: 'fix_log', agentMax: 'inform', requested: 'fix_log' }), 'inform')
  assert.equal(minLevel('fix_log', 'inform', 'ask'), 'inform')
})

test('failed fix downgrades fix_* → ask → inform, and does not go below inform', () => {
  assert.equal(downgrade('fix_log'), 'ask')
  assert.equal(downgrade('fix_notify'), 'ask')
  assert.equal(downgrade('ask'), 'inform')
  assert.equal(downgrade('inform'), 'inform')
})

test('parseLevel rejects unknown values', () => {
  assert.throws(() => parseLevel('autonomous'), /Unknown level/)
})
