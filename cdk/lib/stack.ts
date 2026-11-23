/**
 * Cognito (2LO + optional 3LO clients) → AgentCore Gateway (MCP, JWT in) → Lambda tools
 * Policy engine (Cedar, ENFORCE) attached to the Gateway.
 * Identity: workload identity + OAuth2 credential providers (Cognito) for outbound 2LO/3LO.
 *
 * https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html
 * https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-understanding-cedar.html
 * https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/example-policies-principal.html
 */
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cdk from 'aws-cdk-lib'
import { APP_RETURN_URL, APP_RETURN_URLS } from '../../src/identity/tokens.js'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore'
import { Construct } from 'constructs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TARGET = 'DataReliability'

export class AgentCoreProtoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const pool = new cognito.UserPool(this, 'Pool', {
      userPoolName: 'datarel-pool',
      selfSignUpEnabled: false,
      signInAliases: { username: true, email: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    const domain = pool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: `drel${cdk.Names.uniqueId(this).slice(-8).toLowerCase()}` },
    })

    const scopeRead = new cognito.ResourceServerScope({ scopeName: 'read', scopeDescription: 'Read freshness' })
    const scopeFix = new cognito.ResourceServerScope({ scopeName: 'fix', scopeDescription: 'Rerun a load' })
    const resourceServer = pool.addResourceServer('Rs', {
      identifier: 'datarel',
      userPoolResourceServerName: 'datarel',
      scopes: [scopeRead, scopeFix],
    })

    const informClient = pool.addClient('InformClient', {
      userPoolClientName: 'datarel-inform',
      generateSecret: true,
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [cognito.OAuthScope.resourceServer(resourceServer, scopeRead)],
      },
      accessTokenValidity: cdk.Duration.hours(1),
      authFlows: { userPassword: false, userSrp: false },
    })
    informClient.node.addDependency(resourceServer)

    const fixClient = pool.addClient('FixClient', {
      userPoolClientName: 'datarel-fix',
      generateSecret: true,
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [
          cognito.OAuthScope.resourceServer(resourceServer, scopeRead),
          cognito.OAuthScope.resourceServer(resourceServer, scopeFix),
        ],
      },
      accessTokenValidity: cdk.Duration.hours(1),
    })
    fixClient.node.addDependency(resourceServer)

    // 3LO client. Callback URL is a placeholder until the Identity provider's
    // callbackUrl is known (see README Stage D).
    const userClient = pool.addClient('UserClient', {
      userPoolClientName: 'datarel-user',
      generateSecret: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.resourceServer(resourceServer, scopeRead),
          cognito.OAuthScope.resourceServer(resourceServer, scopeFix),
        ],
        callbackUrls: ['https://localhost/dev-placeholder'],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    })
    userClient.node.addDependency(resourceServer)

    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${pool.userPoolId}`
    const tokenEndpoint = `${domain.baseUrl()}/oauth2/token`
    const authorizationEndpoint = `${domain.baseUrl()}/oauth2/authorize`

    const informProvider = agentcore.OAuth2CredentialProvider.usingCognito(this, 'InformProvider', {
      oAuth2CredentialProviderName: 'datarel_m2m_inform',
      clientId: informClient.userPoolClientId,
      clientSecret: informClient.userPoolClientSecret,
      issuer,
      tokenEndpoint,
      authorizationEndpoint,
    })
    const fixProvider = agentcore.OAuth2CredentialProvider.usingCognito(this, 'FixProvider', {
      oAuth2CredentialProviderName: 'datarel_m2m_fix',
      clientId: fixClient.userPoolClientId,
      clientSecret: fixClient.userPoolClientSecret,
      issuer,
      tokenEndpoint,
      authorizationEndpoint,
    })
    const userProvider = agentcore.OAuth2CredentialProvider.usingCognito(this, 'UserProvider', {
      oAuth2CredentialProviderName: 'datarel_user',
      clientId: userClient.userPoolClientId,
      clientSecret: userClient.userPoolClientSecret,
      issuer,
      tokenEndpoint,
      authorizationEndpoint,
    })

    const workload = new agentcore.WorkloadIdentity(this, 'Workload', {
      workloadIdentityName: 'datarel_workload',
      // App return URL for 3LO session binding (not the provider callback).
      // https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/oauth2-authorization-url-session-binding.html
      allowedResourceOauth2ReturnUrls: [...APP_RETURN_URLS],
    })

    const tools = new NodejsFunction(this, 'Tools', {
      entry: path.join(ROOT, 'src/lambda/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      logGroup: new logs.LogGroup(this, 'ToolsLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      projectRoot: ROOT,
      depsLockFilePath: path.join(ROOT, 'package-lock.json'),
      bundling: { format: OutputFormat.ESM, target: 'node22', mainFields: ['module', 'main'] },
    })

    const policyEngine = new agentcore.PolicyEngine(this, 'Policies', {
      policyEngineName: 'datarel_policies',
      description: 'Permit freshness; permit rerun_load only with datarel/fix and not on payments_daily',
    })

    const gateway = new agentcore.Gateway(this, 'Gateway', {
      gatewayName: 'datarel-gw',
      description: 'Data reliability MCP tools',
      authorizerConfiguration: agentcore.GatewayAuthorizer.usingCognito({
        userPool: pool,
        allowedClients: [informClient, fixClient, userClient],
        allowedScopes: ['datarel/read'],
      }),
      policyEngineConfiguration: {
        policyEngine,
        mode: agentcore.PolicyEngineMode.ENFORCE,
      },
      exceptionLevel: agentcore.GatewayExceptionLevel.DEBUG,
    })

    const tableProp = {
      type: agentcore.SchemaDefinitionType.STRING,
      description: 'Warehouse table name (orders, customers, payments_daily)',
    }
    gateway.addLambdaTarget('ToolsTarget', {
      gatewayTargetName: TARGET,
      description: 'Freshness and rerun_load',
      lambdaFunction: tools,
      toolSchema: agentcore.ToolSchema.fromInline([
        {
          name: 'get_dataset_freshness',
          description: 'Returns data-reliability info for a warehouse table.',
          inputSchema: { type: agentcore.SchemaDefinitionType.OBJECT, properties: { table_name: tableProp }, required: ['table_name'] },
        },
        {
          name: 'rerun_load',
          description: 'Rerun the load job for a warehouse table.',
          inputSchema: { type: agentcore.SchemaDefinitionType.OBJECT, properties: { table_name: tableProp }, required: ['table_name'] },
        },
      ]),
    })

    const resource = `resource == AgentCore::Gateway::"${gateway.gatewayArn}"`
    // IGNORE_ALL_FINDINGS: the gateway ARN is a CloudFormation token at synth time.
    const cedar = (statement: string, policyName: string, description: string) =>
      policyEngine.addPolicy(policyName, {
        policyName,
        description,
        statement: agentcore.PolicyStatement.fromCedar(statement),
        validationMode: agentcore.PolicyValidationMode.IGNORE_ALL_FINDINGS,
      })

    cedar(
      `permit(
        principal is AgentCore::OAuthUser,
        action == AgentCore::Action::"${TARGET}___get_dataset_freshness",
        ${resource}
      )
      when { principal.hasTag("scope") && principal.getTag("scope") like "*datarel/read*" };`,
      'AllowFreshness',
      'Any caller with datarel/read may check freshness',
    )
    cedar(
      `permit(
        principal is AgentCore::OAuthUser,
        action == AgentCore::Action::"${TARGET}___rerun_load",
        ${resource}
      )
      when {
        principal.hasTag("scope") &&
        principal.getTag("scope") like "*datarel/fix*" &&
        context.input.table_name != "payments_daily"
      };`,
      'AllowRerunExceptPayments',
      'rerun_load only with datarel/fix (agent ceiling at or above ask) and not on payments_daily',
    )
    cedar(
      `forbid(
        principal is AgentCore::OAuthUser,
        action == AgentCore::Action::"${TARGET}___rerun_load",
        ${resource}
      )
      when { context.input.table_name == "payments_daily" };`,
      'ForbidRerunPayments',
      'payments_daily reruns are always denied at the gateway',
    )

    new cdk.CfnOutput(this, 'GatewayUrl', { value: gateway.gatewayUrl ?? '' })
    new cdk.CfnOutput(this, 'WorkloadName', { value: workload.workloadIdentityName })
    new cdk.CfnOutput(this, 'InformProviderName', { value: informProvider.oAuth2CredentialProviderName })
    new cdk.CfnOutput(this, 'FixProviderName', { value: fixProvider.oAuth2CredentialProviderName })
    new cdk.CfnOutput(this, 'UserProviderName', { value: userProvider.oAuth2CredentialProviderName })
    new cdk.CfnOutput(this, 'UserProviderCallbackUrl', { value: userProvider.callbackUrl ?? '' })
    new cdk.CfnOutput(this, 'AppReturnUrl', { value: APP_RETURN_URL })
    new cdk.CfnOutput(this, 'TokenUrl', { value: tokenEndpoint })
    new cdk.CfnOutput(this, 'UserPoolId', { value: pool.userPoolId })
    new cdk.CfnOutput(this, 'InformClientId', { value: informClient.userPoolClientId })
    new cdk.CfnOutput(this, 'FixClientId', { value: fixClient.userPoolClientId })
    new cdk.CfnOutput(this, 'UserClientId', { value: userClient.userPoolClientId })
  }
}
