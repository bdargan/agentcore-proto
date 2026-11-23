/**
 * Stage B/C: mint a Cognito access token via AgentCore Identity M2M (2LO)
 * and write it to .token for gateway:call.
 *
 *   npm run identity:2lo -- --ceiling fix      # scopes read+fix
 *   npm run identity:2lo -- --ceiling inform   # read only; Cedar will deny rerun_load
 */
import { writeFileSync } from 'node:fs'
import { arg, loadOutputs } from './config.js'
import { getM2MToken, getWorkloadAccessToken } from './tokens.js'

const ceiling = arg('--ceiling', 'fix')
if (ceiling !== 'fix' && ceiling !== 'inform') throw new Error('--ceiling must be fix or inform')

const out = loadOutputs()
const providerName = ceiling === 'fix' ? out.FixProviderName : out.InformProviderName
const scopes = ceiling === 'fix' ? ['datarel/read', 'datarel/fix'] : ['datarel/read']

const wat = await getWorkloadAccessToken(out.WorkloadName)
const token = await getM2MToken({ workloadAccessToken: wat, providerName, scopes })
writeFileSync('.token', token)
console.log(`2LO token written to .token (ceiling=${ceiling}, provider=${providerName}, scopes=${scopes.join(' ')})`)
console.log(`Gateway: ${out.GatewayUrl}`)
console.log('Next: npm run gateway:call -- get_dataset_freshness payments_daily')
