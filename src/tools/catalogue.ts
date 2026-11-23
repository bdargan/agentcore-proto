/**
 * Fake warehouse catalogue used by both the local Stage A tools and the Gateway Lambda.
 * payments_daily is stale and its "rerun" fails — that's the downgrade demo case.
 */
export type DatasetInfo = {
  owner: string
  slaHours: number
  hoursSinceLastLoad: number
  lastRowCount: number
  previousRowCount: number
  nullRatePct: number
  rerunFails?: string
}

export const CATALOGUE: Record<string, DatasetInfo> = {
  orders: { owner: 'commerce-data', slaHours: 2, hoursSinceLastLoad: 0.5, lastRowCount: 1_204_331, previousRowCount: 1_198_120, nullRatePct: 0.1 },
  customers: { owner: 'crm-platform', slaHours: 24, hoursSinceLastLoad: 6, lastRowCount: 88_410, previousRowCount: 88_377, nullRatePct: 1.4 },
  payments_daily: {
    owner: 'finance-eng', slaHours: 24, hoursSinceLastLoad: 51, lastRowCount: 0, previousRowCount: 41_902, nullRatePct: 0,
    rerunFails: 'extract job returned 0 rows (source system unavailable)',
  },
}

export type Freshness = {
  table: string
  status: 'FRESH' | 'STALE' | 'UNKNOWN'
  lastLoadedAt: string | null
  slaHours: number | null
  hoursSinceLastLoad: number | null
  rowCountChangePct: number | null
  nullRatePct: number | null
  owner: string | null
  notes: string
}

export function getDatasetFreshness(tableName: string, now = new Date()): Freshness {
  const key = tableName.trim().toLowerCase()
  const info = CATALOGUE[key]
  if (!info) {
    return {
      table: key, status: 'UNKNOWN', lastLoadedAt: null, slaHours: null, hoursSinceLastLoad: null,
      rowCountChangePct: null, nullRatePct: null, owner: null,
      notes: `No such table. Known tables: ${Object.keys(CATALOGUE).join(', ')}`,
    }
  }
  const lastLoadedAt = new Date(now.getTime() - info.hoursSinceLastLoad * 3_600_000).toISOString()
  const rowCountChangePct = Number((((info.lastRowCount - info.previousRowCount) / Math.max(info.previousRowCount, 1)) * 100).toFixed(2))
  const stale = info.hoursSinceLastLoad > info.slaHours
  const notes: string[] = []
  if (stale) notes.push(`Last load is ${info.hoursSinceLastLoad}h old, breaching the ${info.slaHours}h SLA.`)
  if (rowCountChangePct <= -50) notes.push(`Row count dropped ${Math.abs(rowCountChangePct)}% vs previous load.`)
  if (info.nullRatePct > 1) notes.push(`Null rate in key columns is ${info.nullRatePct}%.`)
  return {
    table: key, status: stale ? 'STALE' : 'FRESH', lastLoadedAt, slaHours: info.slaHours,
    hoursSinceLastLoad: info.hoursSinceLastLoad, rowCountChangePct, nullRatePct: info.nullRatePct,
    owner: info.owner, notes: notes.join(' ') || 'All checks passed.',
  }
}

export type RerunResult = {
  ok: boolean
  table: string
  jobId?: string
  error?: string
  owner?: string
}

export function rerunLoad(tableName: string): RerunResult {
  const key = tableName.trim().toLowerCase()
  const info = CATALOGUE[key]
  if (!info) return { ok: false, table: key, error: `No such table. Known: ${Object.keys(CATALOGUE).join(', ')}` }
  if (info.rerunFails) return { ok: false, table: key, owner: info.owner, error: info.rerunFails }
  return { ok: true, table: key, owner: info.owner, jobId: `job-${key}-${Date.now()}` }
}

export const FIX_TOOL = 'rerun_load'
export const READ_TOOL = 'get_dataset_freshness'

export function isFixFailure(payload: unknown): boolean {
  if (payload && typeof payload === 'object' && 'ok' in payload && (payload as { ok: unknown }).ok === false) return true
  if (typeof payload === 'string') {
    try { return isFixFailure(JSON.parse(payload)) } catch { return /"ok"\s*:\s*false/.test(payload) }
  }
  return false
}
