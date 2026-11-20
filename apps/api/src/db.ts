import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance, type DuckDBValue } from "@duckdb/node-api";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const envFile = resolve(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const dataDir = resolve(repoRoot, process.env.DUCKBILL_DATA_DIR ?? "./data");

// The database the API reads: a local DuckDB file (default: the data dir's
// warehouse) or a MotherDuck database such as `md:duckbill`, which reads its
// token from MOTHERDUCK_TOKEN.
export const warehouse = process.env.DUCKBILL_WAREHOUSE || resolve(dataDir, "warehouse.duckdb");
export const isMotherDuck = warehouse.startsWith("md:");

export class WarehouseUnavailable extends Error {}

// MotherDuck: one long-lived instance, so the connection and auth handshake
// happen once rather than per request.
let remote: Promise<DuckDBInstance> | null = null;

function motherDuck(): Promise<DuckDBInstance> {
  remote ??= DuckDBInstance.create(warehouse, {
    motherduck_token: process.env.MOTHERDUCK_TOKEN ?? "",
  }).catch((cause: unknown) => {
    remote = null; // retry on the next request
    throw new WarehouseUnavailable(`Can't connect to ${warehouse}: ${String(cause)}`);
  });
  return remote;
}

/**
 * Local file: DuckDB allows one writer or many readers per file, so the file is
 * opened read-only per request and closed straight after; holding it open would
 * block `duckbill transform` from rebuilding the tables.
 */
async function local(): Promise<DuckDBInstance> {
  if (!existsSync(warehouse)) {
    throw new WarehouseUnavailable(`No warehouse at ${warehouse}`);
  }
  try {
    return await DuckDBInstance.create(warehouse, { access_mode: "READ_ONLY" });
  } catch (cause) {
    throw new WarehouseUnavailable(`Warehouse is locked or unreadable: ${String(cause)}`);
  }
}

/** Run a read-only query against the warehouse. */
export async function query<T>(
  sql: string,
  params: Record<string, DuckDBValue> = {},
): Promise<T[]> {
  const instance = isMotherDuck ? await motherDuck() : await local();
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(sql, params);
    return reader.getRowObjectsJS() as T[];
  } finally {
    connection.closeSync();
    if (!isMotherDuck) instance.closeSync();
  }
}

/** The id of the dbt build being served, or null for a warehouse without one. */
export async function currentBuildId(): Promise<string | null> {
  try {
    const [row] = await query<{ id: string }>(
      `select build_id as "id" from gold.gold_build_info`,
    );
    return row?.id ?? null;
  } catch (err) {
    if (err instanceof WarehouseUnavailable) throw err;
    return null; // built before gold_build_info existed
  }
}
