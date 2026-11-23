/**
 * Optional: the same Stage A agent hosted on AgentCore Runtime via BedrockAgentCoreApp
 * (HTTP /ping + /invocations on port 8080). Not wired into the default CDK stack —
 * Runtime for TypeScript needs a container or a NODE_22 code asset, and Docker is
 * out of scope for this prototype. Hook it up later with:
 *   AgentRuntimeArtifact.fromAsset(...) or fromCodeAsset({ runtime: AgentCoreRuntime.NODE_22, ... })
 * https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html
 * https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-typescript-sdk-reference.html
 */
import { z } from 'zod'
import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime'
import { effectiveLevel, parseLevel } from '../autonomy/levels.js'
import { taskLevel } from '../autonomy/tasks.js'
import { buildAgent, fixAttemptFailed } from '../agent/build-agent.js'
import { downgrade } from '../autonomy/levels.js'

const Request = z.object({
  prompt: z.string(),
  task: z.string().default('check_freshness'),
  agentMax: z.string().default('ask'),
  requested: z.string().optional(),
})

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: Request,
    process: async (request) => {
      let level = effectiveLevel({
        taskLevel: taskLevel(request.task),
        agentMax: parseLevel(request.agentMax, 'agentMax'),
        requested: request.requested ? parseLevel(request.requested, 'requested') : undefined,
      })
      const agent = buildAgent({ level, task: request.task, live: true })
      const result = await agent.invoke(request.prompt)
      return {
        level,
        stopReason: result.stopReason,
        answer: result.toString(),
        shouldDowngrade: fixAttemptFailed(agent) ? downgrade(level) : undefined,
      }
    },
  },
})

if (import.meta.url === `file://${process.argv[1]}`) app.run()
