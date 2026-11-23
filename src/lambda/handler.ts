/**
 * Gateway Lambda target. The event is the tool's inputSchema properties
 * (e.g. { table_name: "orders" }). The tool name is in
 * context.clientContext.custom.bedrockAgentCoreToolName as target___tool.
 * https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-add-target-lambda.html
 */
import type { Context } from 'aws-lambda'
import { FIX_TOOL, READ_TOOL, getDatasetFreshness, rerunLoad } from '../tools/catalogue.js'

type Event = { table_name?: string }

function toolName(context: Context): string {
  const raw = context.clientContext?.custom?.['bedrockAgentCoreToolName'] ?? ''
  const delim = '___'
  const i = raw.indexOf(delim)
  return i >= 0 ? raw.slice(i + delim.length) : raw
}

export const handler = async (event: Event, context: Context) => {
  const table = event.table_name ?? ''
  const name = toolName(context)
  if (name === READ_TOOL) return getDatasetFreshness(table)
  if (name === FIX_TOOL) return rerunLoad(table)
  return { ok: false, error: `Unknown tool: ${name || '(missing)'}` }
}
