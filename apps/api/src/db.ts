import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance, type DuckDBValue } from "@duckdb/node-api";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const envFile = resolve(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const dataDir = resolve(repoRoot, process.env.DUCKBILL_DATA_DIR ?? "./data");

// The database the API reads: a local DuckDB file (default: the data dir's
// warehouse), a MotherDuck database the token's account owns (`md:duckbill`),
// or a share URL (`md:_share/duckbill/<id>`), which is how the read-only
// service account in production sees the warehouse. The MotherDuck token
// comes from MOTHERDUCK_TOKEN.
export const warehouse = process.env.DUCKBILL_WAREHOUSE || resolve(dataDir, "warehouse.duckdb");
export const isMotherDuck = warehouse.startsWith("md:");
const isShare = warehouse.startsWith("md:_share/");
const SHARE_ALIAS = "duckbill";

export class WarehouseUnavailable extends Error {}

// MotherDuck: one long-lived instance, so the connection and auth handshake
// happen once rather than per request. A share is (re)attached at connect time,
// so the alias always points at the configured share URL even though MotherDuck
// keeps attachments across sessions, and is selected on every connection.
let remote: Promise<DuckDBInstance> | null = null;

async function connectMotherDuck(): Promise<DuckDBInstance> {
  const instance = await DuckDBInstance.create(isShare ? "md:" : warehouse, {
    motherduck_token: process.env.MOTHERDUCK_TOKEN ?? "",
  });
  if (isShare) {
    const connection = await instance.connect();
    try {
      await connection.run(`detach database if exists ${SHARE_ALIAS}`);
      await connection.run(`attach '${warehouse.replaceAll("'", "''")}' as ${SHARE_ALIAS}`);
    } finally {
      connection.closeSync();
    }
  }
  return instance;
}

function motherDuck(): Promise<DuckDBInstance> {
  remote ??= connectMotherDuck().catch((cause: unknown) => {
    remote = null; // retry on the next request
    throw new WarehouseUnavailable(`Can't connect to MotherDuck: ${String(cause)}`);
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
    if (isShare) await connection.run(`use ${SHARE_ALIAS}`);
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
    const [row] = await query<{ id: string }>(`select build_id as "id" from gold.gold_build_info`);
    return row?.id ?? null;
  } catch (err) {
    if (err instanceof WarehouseUnavailable) throw err;
    return null; // built before gold_build_info existed
  }
}
