/**
 * Locked-path demo of a failed fix downgrading, with no prompts and no AWS.
 * Task rerun_failed_load maps to fix_notify; payments_daily's rerun fails;
 * we auto-decline the subsequent ask, then finish at inform.
 */
import { effectiveLevel } from '../autonomy/levels.js'
import { taskLevel } from '../autonomy/tasks.js'

process.argv.push(
  '--task', 'rerun_failed_load',
  '--max', 'fix_log',
  '--table', 'payments_daily',
  '--approve', 'n',
)
const planned = effectiveLevel({ taskLevel: taskLevel('rerun_failed_load'), agentMax: 'fix_log' })
console.log(`Downgrade demo: task rerun_failed_load, agentMax=fix_log, table=payments_daily`)
console.log(`Effective start level: ${planned} (expect fix_notify). The load will fail, then ask will be declined.\n`)

await import('./stage-a.js')
