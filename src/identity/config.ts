import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export type StackOutputs = {
  GatewayUrl: string
  WorkloadName: string
  InformProviderName: string
  FixProviderName: string
  UserProviderName: string
  UserProviderCallbackUrl: string
  AppReturnUrl?: string
  TokenUrl: string
  UserPoolId: string
  InformClientId: string
  FixClientId: string
  UserClientId: string
}

export function loadOutputs(path = process.env.OUTPUTS ?? 'outputs.json'): StackOutputs {
  const file = resolve(path)
  if (!existsSync(file)) {
    throw new Error(`Missing ${file}. Deploy with: npx cdk deploy --outputs-file outputs.json`)
  }
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string>>
  const stack = raw.AgentCoreProtoStack ?? Object.values(raw)[0]
  if (!stack?.GatewayUrl) throw new Error(`No GatewayUrl in ${file}`)
  return stack as StackOutputs
}

export function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : fallback
}
