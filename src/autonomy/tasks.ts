import { parseLevel, type AutonomyLevel } from './levels.js'
import table from './tasks.json' with { type: 'json' }

const TASKS = table as Record<string, string>

export function taskNames(): string[] {
  return Object.keys(TASKS)
}

export function taskLevel(task: string): AutonomyLevel {
  const raw = TASKS[task]
  if (!raw) throw new Error(`Unknown task "${task}". Known: ${taskNames().join(', ')}`)
  return parseLevel(raw, `task "${task}" mapping`)
}
