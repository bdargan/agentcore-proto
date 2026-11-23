import {
  Agent, AfterToolCallEvent, BedrockModel, BeforeToolCallEvent,
} from '@strands-agents/sdk'
import { autoFixes, requiresApproval, type AutonomyLevel, canRunFix } from '../autonomy/levels.js'
import { FIX_TOOL, isFixFailure } from '../tools/catalogue.js'
import { contentPayload } from '../tools/content.js'
import { freshnessTool, rerunTool } from './strands-tools.js'
import { ScriptedModel } from './scripted-model.js'

export const DEFAULT_MODEL_ID = 'au.anthropic.claude-sonnet-4-6'
export const DEFAULT_REGION = 'ap-southeast-2'

export function toolsFor(level: AutonomyLevel) {
  return canRunFix(level) ? [freshnessTool, rerunTool] : [freshnessTool]
}

function systemPrompt(level: AutonomyLevel, task: string): string {
  return `You are a data-reliability assistant on task "${task}" at autonomy level "${level}".
Use get_dataset_freshness before answering. Do not guess.
${level === 'inform' ? 'You may only report status. Do not attempt a fix.' : ''}
${requiresApproval(level) ? 'You may propose rerun_load; a human must approve it before it runs.' : ''}
${autoFixes(level) ? 'You may call rerun_load yourself. If it fails, report the failure and stop — do not retry.' : ''}
Answer in 3-6 short lines.`
}

export function buildAgent(opts: {
  level: AutonomyLevel
  task: string
  live?: boolean
  table?: string
  onApproval?: () => string
}) {
  const tools = toolsFor(opts.level)
  const model = opts.live
    ? new BedrockModel({
        region: process.env.AWS_REGION ?? DEFAULT_REGION,
        modelId: process.env.MODEL_ID ?? DEFAULT_MODEL_ID,
      })
    : new ScriptedModel(opts.table ?? 'payments_daily', canRunFix(opts.level))

  const agent = new Agent({
    model,
    systemPrompt: systemPrompt(opts.level, opts.task),
    tools,
    printer: true,
  })

  if (requiresApproval(opts.level)) {
    agent.addHook(BeforeToolCallEvent, (event) => {
      if (event.toolUse.name !== FIX_TOOL) return
      const approval = event.interrupt<string>({
        name: 'approve-fix',
        reason: { tool: event.toolUse.name, input: event.toolUse.input },
      })
      if (approval.trim().toLowerCase() !== 'y') {
        event.cancel = 'Operator declined the fix'
      }
    })
  }

  if (autoFixes(opts.level)) {
    agent.addHook(AfterToolCallEvent, (event) => {
      if (event.toolUse.name !== FIX_TOOL) return
      const tag = opts.level === 'fix_notify' ? 'NOTIFY' : 'LOG'
      const body = contentPayload(event.result.content)
      console.log(`${tag}: ${FIX_TOOL} ${JSON.stringify(event.toolUse.input)} -> ${body}`)
    })
  }

  return agent
}

export function fixAttemptFailed(agent: Agent): boolean {
  for (const m of agent.messages) {
    for (const b of m.content) {
      if (b.type !== 'toolResultBlock') continue
      // toolUseId isn't on the result from our angle easily; inspect text
      const text = contentPayload(b.content ?? [])
      if (isFixFailure(text) || b.status === 'error' || /Operator declined/.test(text)) return true
    }
  }
  return false
}
