/**
 * Stage A: per-task autonomy, agent ceiling, Strands interrupt for 'ask'.
 * Default run uses a scripted model (no AWS). Pass --live to use Bedrock.
 *
 *   npm run stage-a -- --task check_freshness --max ask
 *   npm run stage-a -- --task rerun_stale_load --max fix_log --approve y
 *   npm run stage-a -- --task rerun_failed_load --max inform
 */
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { downgrade, effectiveLevel, parseLevel, type AutonomyLevel } from '../autonomy/levels.js'
import { taskLevel, taskNames } from '../autonomy/tasks.js'
import { buildAgent, fixAttemptFailed } from './build-agent.js'

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : fallback
}
function has(flag: string) { return process.argv.includes(flag) }

async function approveFrom(result: { interrupts?: Array<{ id: string; name: string; reason?: unknown }> }, canned?: string) {
  const answers: Array<{ interruptResponse: { interruptId: string; response: string } }> = []
  for (const irq of result.interrupts ?? []) {
    let response = canned
    if (response === undefined) {
      const rl = createInterface({ input, output })
      response = await rl.question(`Approve ${JSON.stringify(irq.reason)}? [y/N] `)
      rl.close()
    }
    answers.push({ interruptResponse: { interruptId: irq.id, response } })
  }
  return answers
}

async function main() {
  if (has('--help') || has('-h')) {
    console.log(`Usage: npm run stage-a -- --task <name> --max <level> [--requested <level>] [--approve y|n] [--live] [--table payments_daily]
Tasks:    ${taskNames().join(', ')}
Levels:   inform, ask, fix_notify, fix_log
Example:  npm run stage-a -- --task rerun_stale_load --max ask --approve n`)
    return
  }

  const task = arg('--task', 'check_freshness')!
  const agentMax = parseLevel(arg('--max', 'ask')!, 'agent max')
  const requestedRaw = arg('--requested')
  const requested = requestedRaw ? parseLevel(requestedRaw, 'requested') : undefined
  const table = arg('--table', 'payments_daily')!
  const live = has('--live')
  const canned = arg('--approve')
  const taskLv = taskLevel(task)
  let level: AutonomyLevel = effectiveLevel({ taskLevel: taskLv, agentMax, requested })

  console.log(`task=${task} (mapped ${taskLv})  agentMax=${agentMax}` + (requested ? `  requested=${requested}` : '') + `  => effective=${level}`)

  // Loop: run at the current level; on a failed/declined fix, downgrade rather than retry.
  for (;;) {
    const agent = buildAgent({ level, task, live, table })
    const prompt = `Please handle the "${task}" task for table ${table}.`
    console.log(`\n--- running at ${level} ---\nUser: ${prompt}\n`)
    let result = await agent.invoke(prompt)

    while (result.stopReason === 'interrupt') {
      const answers = await approveFrom(result, canned)
      result = await agent.invoke(answers)
    }

    console.log(`\nstopReason=${result.stopReason}`)
    if ((level !== 'inform') && fixAttemptFailed(agent)) {
      const next = downgrade(level)
      if (next === level) break
      console.log(`Fix failed or was declined. Downgrading ${level} → ${next} (no retry at ${level}).`)
      level = next
      continue
    }
    break
  }
}

await main()
