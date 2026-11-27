import { createClerkClient } from "@clerk/backend";
import type { MiddlewareHandler } from "hono";

// Resolves the signed-in user for a request, or null.
export type Authenticate = (request: Request) => Promise<string | null>;

interface ClerkKeys {
  secretKey: string;
  publishableKey: string;
  // Clerk's public key, to verify JWTs offline. Optional; the tests use it.
  jwtKey?: string;
}

function clerkClient({ secretKey, publishableKey, jwtKey }: ClerkKeys) {
  return createClerkClient({ secretKey, publishableKey, jwtKey });
}

/**
 * Clerk session check: the session token comes from the `Authorization: Bearer`
 * header (or Clerk's same-origin cookie), and must have been issued to one of
 * `authorizedParties` (the app's own https origins). OAuth access tokens are
 * not session tokens, so an MCP connector's token can't open the dashboard API.
 */
export function clerkAuthenticator(
  options: ClerkKeys & { authorizedParties: string[] },
): Authenticate {
  const clerk = clerkClient(options);
  return async (request) => {
    const state = await clerk.authenticateRequest(request, {
      authorizedParties: options.authorizedParties,
    });
    return state.isAuthenticated ? state.toAuth().userId : null;
  };
}

// Resolves the user an OAuth access token was issued to, or null.
export type VerifyOAuthToken = (token: string, audience: string) => Promise<string | null>;

/**
 * Clerk OAuth check for the MCP endpoint: the token must be an OAuth access
 * token Clerk issued for `audience`, the endpoint's own URL. Without the
 * audience Clerk would accept a token issued for any resource on the instance.
 */
export function clerkOAuthVerifier(options: ClerkKeys): VerifyOAuthToken {
  const clerk = clerkClient(options);
  return async (token, audience) => {
    const state = await clerk.authenticateRequest(
      new Request(audience, { headers: { authorization: `Bearer ${token}` } }),
      { acceptsToken: "oauth_token", audience },
    );
    return state.isAuthenticated ? state.toAuth().userId : null;
  };
}

/**
 * The Clerk Frontend API origin, which is the OAuth authorization server, from
 * a publishable key (`pk_test_` or `pk_live_`, then base64 of "<host>$").
 * Null when the key doesn't decode to a hostname.
 */
export function clerkIssuer(publishableKey: string): string | null {
  const encoded = publishableKey.split("_")[2] ?? "";
  const host = Buffer.from(encoded, "base64").toString().replace(/\$$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) ? `https://${host}` : null;
}

/**
 * Only the owner gets through: 401 without a valid session, 403 for anyone
 * else who manages to sign in. The 403 names the caller's own user id, which
 * is how you find the value for DUCKBILL_OWNER_USER_ID on first sign-in.
 */
export function requireOwner(ownerUserId: string, authenticate: Authenticate): MiddlewareHandler {
  return async (c, next) => {
    const userId = await authenticate(c.req.raw).catch(() => null);
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    if (userId !== ownerUserId) {
      return c.json({ error: "Not allowed", hint: `Signed in as ${userId}` }, 403);
    }
    await next();
  };
}
