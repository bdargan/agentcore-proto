import { Model, type Message } from '@strands-agents/sdk'
import { FIX_TOOL, READ_TOOL } from '../tools/catalogue.js'
import { contentPayload } from '../tools/content.js'

/** Stand-in for Bedrock so Stage A runs with no AWS. Not part of the production agent. */
export class ScriptedModel extends Model {
  constructor(private readonly table = 'payments_daily', private readonly allowFix = true) {
    super()
  }
  private cfg: Record<string, unknown> = { modelId: 'scripted-fake' }
  updateConfig(c: Record<string, unknown>) { this.cfg = { ...this.cfg, ...c } }
  getConfig() { return this.cfg }

  async *stream(messages: Message[]): AsyncIterable<any> {
    const used = (name: string) =>
      messages.some((m) => m.content.some((b) => b.type === 'toolUseBlock' && b.name === name))
    const last = messages.at(-1)
    const toolResult = last?.content.find((b) => b.type === 'toolResultBlock')

    yield { type: 'modelMessageStartEvent', role: 'assistant' }

    const call = (name: string, id: string) => [
      { type: 'modelContentBlockStartEvent', start: { type: 'toolUseStart', name, toolUseId: id } },
      { type: 'modelContentBlockDeltaEvent', delta: { type: 'toolUseInputDelta', input: JSON.stringify({ table_name: this.table }) } },
      { type: 'modelContentBlockStopEvent' },
      { type: 'modelMessageStopEvent', stopReason: 'toolUse' },
    ]

    if (!used(READ_TOOL)) {
      yield* call(READ_TOOL, 's-read')
      return
    }
    if (this.allowFix && !used(FIX_TOOL)) {
      yield* call(FIX_TOOL, 's-fix')
      return
    }

    const text = toolResult
      ? `Tool returned: ${contentPayload(toolResult.content)}`
      : 'No further tools available at this autonomy level.'
    yield { type: 'modelContentBlockStartEvent' }
    yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text } }
    yield { type: 'modelContentBlockStopEvent' }
    yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
  }
}
