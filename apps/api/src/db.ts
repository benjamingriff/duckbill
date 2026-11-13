import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance, type DuckDBValue } from "@duckdb/node-api";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const envFile = resolve(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const dataDir = resolve(repoRoot, process.env.DUCKBILL_DATA_DIR ?? "./data");
export const warehousePath = resolve(dataDir, "warehouse.duckdb");

export class WarehouseUnavailable extends Error {}

/**
 * Run a read-only query against the warehouse.
 *
 * DuckDB allows one writer or many readers per file, so the connection is
 * opened per request and closed straight after; holding it open would block
 * `duckbill transform` from rebuilding the tables.
 */
export async function query<T>(
  sql: string,
  params: Record<string, DuckDBValue> = {},
): Promise<T[]> {
  if (!existsSync(warehousePath)) {
    throw new WarehouseUnavailable(`No warehouse at ${warehousePath}`);
  }
  let instance: DuckDBInstance;
  try {
    instance = await DuckDBInstance.create(warehousePath, { access_mode: "READ_ONLY" });
  } catch (cause) {
    throw new WarehouseUnavailable(`Warehouse is locked or unreadable: ${String(cause)}`);
  }
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(sql, params);
    return reader.getRowObjectsJS() as T[];
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
