/**
 * Autonomy is per task, clipped by a hard agent ceiling.
 *
 *   effective = min(task level, agent max, requested level if the operator directed one)
 *
 * The ceiling cannot be raised by a human or by the agent. If a fix fails (or can't
 * be performed), downgrade fix_* → ask → inform rather than retrying at the same level.
 */
export const LEVELS = ['inform', 'ask', 'fix_notify', 'fix_log'] as const
export type AutonomyLevel = (typeof LEVELS)[number]

export const RANK: Record<AutonomyLevel, number> = {
  inform: 0,
  ask: 1,
  fix_notify: 2,
  fix_log: 3,
}

export function isLevel(value: string): value is AutonomyLevel {
  return (LEVELS as readonly string[]).includes(value)
}

export function parseLevel(value: string, label = 'level'): AutonomyLevel {
  if (!isLevel(value)) throw new Error(`Unknown ${label} "${value}". Use: ${LEVELS.join(', ')}`)
  return value
}

/** Lowest (most restrictive) of the provided levels. Ignores undefined. */
export function minLevel(...levels: Array<AutonomyLevel | undefined>): AutonomyLevel {
  const present = levels.filter((l): l is AutonomyLevel => l !== undefined)
  if (present.length === 0) throw new Error('minLevel requires at least one level')
  return present.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b))
}

export function effectiveLevel(opts: {
  taskLevel: AutonomyLevel
  agentMax: AutonomyLevel
  requested?: AutonomyLevel
}): AutonomyLevel {
  return minLevel(opts.taskLevel, opts.agentMax, opts.requested)
}

/** fix_* → ask → inform. Already at inform stays at inform. */
export function downgrade(level: AutonomyLevel): AutonomyLevel {
  if (level === 'fix_log' || level === 'fix_notify') return 'ask'
  if (level === 'ask') return 'inform'
  return 'inform'
}

export function canRunFix(level: AutonomyLevel): boolean {
  return RANK[level] >= RANK.ask // ask (after approval) and both fix_* levels
}

export function autoFixes(level: AutonomyLevel): boolean {
  return level === 'fix_notify' || level === 'fix_log'
}

export function requiresApproval(level: AutonomyLevel): boolean {
  return level === 'ask'
}
