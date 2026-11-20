import { createClerkClient } from "@clerk/backend";
import type { MiddlewareHandler } from "hono";

// Resolves the signed-in user for a request, or null.
export type Authenticate = (request: Request) => Promise<string | null>;

/**
 * Clerk session check: the session token comes from the `Authorization: Bearer`
 * header (or Clerk's same-origin cookie), and must have been issued to one of
 * `authorizedParties` (the app's own https origins).
 */
export function clerkAuthenticator(options: {
  secretKey: string;
  publishableKey: string;
  authorizedParties: string[];
}): Authenticate {
  const clerk = createClerkClient({
    secretKey: options.secretKey,
    publishableKey: options.publishableKey,
  });
  return async (request) => {
    const state = await clerk.authenticateRequest(request, {
      authorizedParties: options.authorizedParties,
    });
    return state.isAuthenticated ? state.toAuth().userId : null;
  };
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
