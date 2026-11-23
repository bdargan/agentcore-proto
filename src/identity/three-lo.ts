/**
 * Stage D (optional): 3LO / USER_FEDERATION.
 * Starts http://localhost:9090/oauth2/callback, prints the authorization URL,
 * waits for Cognito sign-in + CompleteResourceTokenAuth, then writes .token.
 *
 * Still required once: add UserProviderCallbackUrl to the Cognito UserClient
 * allowed callback URLs (that is the *provider* callback, not the app return URL).
 * The workload identity must list http://localhost:9090/oauth2/callback in
 * allowedResourceOauth2ReturnUrls (redeploy, or the update-workload-identity command in the README).
 */
import { writeFileSync } from 'node:fs'
import { loadOutputs } from './config.js'
import { APP_RETURN_URL, getUserFederationToken, getWorkloadAccessToken } from './tokens.js'

const USER_ID = 'browser-user'
const out = loadOutputs()

console.log(`Starting 3LO. App return URL: ${APP_RETURN_URL}`)
console.log('Open the authorization URL below, sign in as the demo user, and wait...')
const wat = await getWorkloadAccessToken(out.WorkloadName, USER_ID)
const token = await getUserFederationToken({
  workloadAccessToken: wat,
  providerName: out.UserProviderName,
  scopes: ['datarel/read', 'datarel/fix', 'openid'],
  userId: USER_ID,
  onAuthUrl: (url) => console.log(`\nAuthorization URL:\n${url}\n`),
})
writeFileSync('.token', token)
console.log('3LO token written to .token')
console.log('Next: npm run gateway:call -- get_dataset_freshness payments_daily')
