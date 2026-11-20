/**
 * Query results cached per dbt build. Gold only changes when a new build is
 * published, so results are kept until `gold_build_info.build_id` changes.
 * The build id itself is checked at most every `checkEveryMs`, and only when a
 * request arrives, so an idle dashboard costs nothing. Without a build id
 * (an older warehouse) nothing is cached.
 */
export interface BuildCache {
  get<T>(key: string, load: () => Promise<T>): Promise<T>;
}

export function buildCache(options: {
  currentBuildId: () => Promise<string | null>;
  checkEveryMs: number;
  now?: () => number;
}): BuildCache {
  const now = options.now ?? Date.now;
  let build: string | null = null;
  let checkedAt = -Infinity;
  let entries = new Map<string, Promise<unknown>>();

  async function refresh(): Promise<void> {
    if (now() - checkedAt < options.checkEveryMs) return;
    checkedAt = now();
    const latest = await options.currentBuildId();
    if (latest !== build) {
      build = latest;
      entries = new Map();
    }
  }

  return {
    async get<T>(key: string, load: () => Promise<T>): Promise<T> {
      await refresh();
      if (build === null) return load();
      let entry = entries.get(key) as Promise<T> | undefined;
      if (!entry) {
        entry = load();
        entries.set(key, entry);
        // Don't keep failures: the next request should try again.
        entry.catch(() => entries.delete(key));
      }
      return entry;
    },
  };
}
