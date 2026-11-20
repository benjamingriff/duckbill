import { useEffect, useState } from "react";
import type { ApiError } from "@duckbill/api/types";

export class RequestError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

// Supplies the session token for API calls; set by auth.tsx when Clerk is on.
let tokenProvider: () => Promise<string | null> = async () => null;

export function setTokenProvider(provider: () => Promise<string | null>): void {
  tokenProvider = provider;
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const token = await tokenProvider();
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(url, { signal, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    throw new RequestError(body?.error ?? `${response.status} ${response.statusText}`, body?.hint);
  }
  return (await response.json()) as T;
}

// `data` may be from a previous URL while reloading or after an error;
// `dataUrl` says which request it answered.
export type Loadable<T> =
  | { state: "loading"; data?: T; dataUrl?: string }
  | { state: "ready"; data: T; dataUrl: string }
  | { state: "error"; error: RequestError; data?: T; dataUrl?: string };

/** Fetch JSON whenever `url` changes, keeping the previous data while reloading. */
export function useJson<T>(url: string | null): Loadable<T> {
  const [result, setResult] = useState<Loadable<T>>({ state: "loading" });

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setResult((prev) => ({ state: "loading", data: prev.data, dataUrl: prev.dataUrl }));
    getJson<T>(url, controller.signal)
      .then((data) => setResult({ state: "ready", data, dataUrl: url }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const err = error instanceof RequestError ? error : new RequestError(String(error));
        setResult((prev) => ({ state: "error", error: err, data: prev.data, dataUrl: prev.dataUrl }));
      });
    return () => controller.abort();
  }, [url]);

  return result;
}
