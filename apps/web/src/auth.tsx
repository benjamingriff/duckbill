import type { ReactNode } from "react";
import { ClerkProvider, Show, SignIn, UserButton, useAuth } from "@clerk/react";
import { setTokenProvider } from "./api.ts";

// Clerk is on when VITE_CLERK_PUBLISHABLE_KEY is set at build time. Without it
// (local dev) the dashboard shows directly; the API then only serves localhost.
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

/** Shows the sign-in screen until signed in, then `children`. */
export function AuthGate({ children }: { children: ReactNode }) {
  if (!publishableKey) return children;
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <Show when="signed-out">
        <div className="signin">
          <SignIn routing="hash" />
        </div>
      </Show>
      <Show when="signed-in">
        <SessionToken />
        {children}
      </Show>
    </ClerkProvider>
  );
}

// Hands Clerk's session token getter to the API client. Rendered before the
// dashboard so the first request already carries it.
function SessionToken() {
  const { getToken } = useAuth();
  setTokenProvider(() => getToken());
  return null;
}

/** The account menu (sign out), when Clerk is on. */
export function AccountMenu() {
  return publishableKey ? <UserButton /> : null;
}
