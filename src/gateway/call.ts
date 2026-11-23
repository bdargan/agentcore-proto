/**
 * Call one Gateway MCP tool with the bearer token in .token.
 *   npm run gateway:call -- get_dataset_freshness payments_daily
 *   npm run gateway:call -- rerun_load orders
 *   npm run gateway:call -- rerun_load payments_daily    # expect Cedar deny
 */
import { readFileSync, existsSync } from 'node:fs'
import { McpClient } from '@strands-agents/sdk'
import { loadOutputs } from '../identity/config.js'

const [toolName, table] = [process.argv[2], process.argv[3] ?? 'payments_daily']
if (!toolName) {
  console.error('Usage: npm run gateway:call -- <tool> [table]')
  process.exit(1)
}
if (!existsSync('.token')) throw new Error('No .token. Run npm run identity:2lo first.')

const out = loadOutputs()
const client = new McpClient({
  url: out.GatewayUrl,
  headers: { Authorization: `Bearer ${readFileSync('.token', 'utf8').trim()}` },
})
try {
  const tools = await client.listTools()
  console.log('Tools:', tools.map((t) => t.name).join(', ') || '(none)')
  const tool = tools.find((t) => t.name === toolName || t.name.endsWith(`___${toolName}`) || t.name.endsWith(`__${toolName}`))
  if (!tool) throw new Error(`Tool ${toolName} not in the list above`)
  const result = await client.callTool(tool, { table_name: table })
  console.log(JSON.stringify(result, null, 2))
} catch (err) {
  console.error('CALL FAILED (a Cedar deny shows up here):')
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await client.disconnect()
}
