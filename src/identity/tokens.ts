/**
 * Local Identity helpers. The public TS export `bedrock-agentcore/identity` is
 * withAccessToken / withApiKey (token comes from Runtime request context).
 * Outside Runtime we call the data-plane APIs that IdentityClient wraps:
 *   GetWorkloadAccessTokenForUserId, GetResourceOauth2Token, CompleteResourceTokenAuth
 * https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/get-workload-access-token.html
 * https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity-authentication.html
 * https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/oauth2-authorization-url-session-binding.html
 */
import { createServer, type Server } from 'node:http'
import {
  BedrockAgentCoreClient,
  CompleteResourceTokenAuthCommand,
  GetResourceOauth2TokenCommand,
  GetWorkloadAccessTokenForUserIdCommand,
} from '@aws-sdk/client-bedrock-agentcore'

/** App return URL for 3LO session binding. Must be on the workload identity. Official samples use this exact URL. */
export const APP_RETURN_URL = 'http://localhost:9090/oauth2/callback'
export const APP_RETURN_URLS = [APP_RETURN_URL, 'http://127.0.0.1:9090/oauth2/callback'] as const

const POLL_MS = 5_000
const client = () => new BedrockAgentCoreClient({ region: process.env.AWS_REGION ?? 'ap-southeast-2' })

export async function getWorkloadAccessToken(workloadName: string, userId = 'local-dev'): Promise<string> {
  const out = await client().send(new GetWorkloadAccessTokenForUserIdCommand({ workloadName, userId }))
  if (!out.workloadAccessToken) throw new Error('GetWorkloadAccessTokenForUserId returned no token')
  return out.workloadAccessToken
}

export async function getM2MToken(opts: {
  workloadAccessToken: string
  providerName: string
  scopes: string[]
}): Promise<string> {
  const out = await client().send(new GetResourceOauth2TokenCommand({
    workloadIdentityToken: opts.workloadAccessToken,
    resourceCredentialProviderName: opts.providerName,
    scopes: opts.scopes,
    oauth2Flow: 'M2M',
  }))
  if (!out.accessToken) throw new Error('M2M GetResourceOauth2Token returned no accessToken')
  return out.accessToken
}

/** sessionUri may be omitted on the first response; the authorize URL carries it as request_uri. */
export function sessionUriFrom(out: { sessionUri?: string; authorizationUrl?: string }): string | undefined {
  if (out.sessionUri) return out.sessionUri
  if (!out.authorizationUrl) return undefined
  try {
    return new URL(out.authorizationUrl).searchParams.get('request_uri') ?? undefined
  } catch {
    return undefined
  }
}

function asSessionUri(sessionId: string): string {
  return sessionId.startsWith('urn:ietf:params:oauth:request_uri:')
    ? sessionId
    : `urn:ietf:params:oauth:request_uri:${sessionId}`
}

/** Tiny localhost server: AgentCore redirects here with ?session_id=...; we call CompleteResourceTokenAuth. */
function listenForSessionBinding(userId: string): { url: string; done: Promise<string>; close: () => void } {
  const url = new URL(APP_RETURN_URL)
  let server: Server
  const done = new Promise<string>((resolve, reject) => {
    server = createServer((req, res) => {
      const incoming = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      if (incoming.pathname !== url.pathname) {
        res.writeHead(404).end('not found')
        return
      }
      const sessionId = incoming.searchParams.get('session_id')
      if (!sessionId) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('missing session_id query parameter')
        return
      }
      const sessionUri = asSessionUri(sessionId)
      void client()
        .send(new CompleteResourceTokenAuthCommand({ sessionUri, userIdentifier: { userId } }))
        .then(() => {
          res.writeHead(200, { 'content-type': 'text/html' }).end('<p>3LO complete. You can close this tab and return to the terminal.</p>')
          resolve(sessionUri)
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          res.writeHead(500, { 'content-type': 'text/plain' }).end(message)
          reject(err)
        })
    })
    server.listen(Number(url.port), '127.0.0.1', () => {
      console.log(`3LO callback listening on ${APP_RETURN_URL}`)
    })
    server.on('error', reject)
  })
  return { url: APP_RETURN_URL, done, close: () => server!.close() }
}

/**
 * 3LO / USER_FEDERATION:
 * 1. GetResourceOauth2Token returns authorizationUrl (sessionUri is often only in request_uri).
 * 2. User signs in. AgentCore then redirects to resourceOauth2ReturnUrl?session_id=...
 * 3. That handler must call CompleteResourceTokenAuth with the same userId used for the WAT.
 * 4. Re-call GetResourceOauth2Token until accessToken is returned (official IdentityClient poll).
 */
export async function getUserFederationToken(opts: {
  workloadAccessToken: string
  providerName: string
  scopes: string[]
  userId: string
  onAuthUrl: (url: string) => void
  timeoutMs?: number
}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000
  const callback = listenForSessionBinding(opts.userId)
  const tokenInput = {
    workloadIdentityToken: opts.workloadAccessToken,
    resourceCredentialProviderName: opts.providerName,
    scopes: opts.scopes,
    oauth2Flow: 'USER_FEDERATION' as const,
    resourceOauth2ReturnUrl: APP_RETURN_URL,
  }
  try {
    const first = await client().send(new GetResourceOauth2TokenCommand({ ...tokenInput, forceAuthentication: true }))
    if (first.accessToken) return first.accessToken
    if (!first.authorizationUrl) throw new Error('Identity did not return a token or authorization URL')
    opts.onAuthUrl(first.authorizationUrl)
    const fromApi = sessionUriFrom(first)
    if (fromApi) console.log(`sessionUri: ${fromApi}`)

    const started = Date.now()
    await Promise.race([
      callback.done,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timed out waiting for the 3LO callback (CompleteResourceTokenAuth)')), timeoutMs),
      ),
    ])

    let sessionUri = sessionUriFrom(first)
    while (Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      const out = await client().send(new GetResourceOauth2TokenCommand({
        ...tokenInput,
        sessionUri,
        forceAuthentication: false,
      }))
      if (out.accessToken) return out.accessToken
      sessionUri = sessionUriFrom(out) ?? sessionUri
      if (out.sessionStatus === 'FAILED') throw new Error('3LO sessionStatus=FAILED')
    }
    throw new Error('Timed out polling GetResourceOauth2Token after the callback. The user may not have finished signing in.')
  } finally {
    callback.close()
  }
}
