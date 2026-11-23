import { tool } from '@strands-agents/sdk'
import { z } from 'zod'
import { FIX_TOOL, READ_TOOL, getDatasetFreshness, rerunLoad } from '../tools/catalogue.js'

export const freshnessTool = tool({
  name: READ_TOOL,
  description: 'Returns data-reliability info for a warehouse table: freshness vs SLA, row-count change, null rate, owner.',
  inputSchema: z.object({ table_name: z.string().describe('Table name, e.g. orders, customers, payments_daily') }),
  callback: ({ table_name }) => getDatasetFreshness(table_name),
})

export const rerunTool = tool({
  name: FIX_TOOL,
  description: 'Rerun the load job for a warehouse table. Use only when a table is stale or failed and a fix is in scope.',
  inputSchema: z.object({ table_name: z.string().describe('Table name to reload') }),
  callback: ({ table_name }) => rerunLoad(table_name),
})
