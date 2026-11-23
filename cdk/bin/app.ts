import * as cdk from 'aws-cdk-lib'
import { AgentCoreProtoStack } from '../lib/stack.js'

const app = new cdk.App()
const region = process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'ap-southeast-2'
new AgentCoreProtoStack(app, 'AgentCoreProtoStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
  description: 'AgentCore Gateway + Cognito 2LO/3LO + Cedar policy for the data-reliability prototype',
})
