"""Copy a locally built warehouse into MotherDuck (or any DuckDB database).

dbt builds and tests in a local file, so only a green build is published and
MotherDuck's compute is spent on reads, not transforms. Every table in the
published schemas is replaced in one transaction: readers see the previous
build or this one, never a mix. Tables that no longer exist locally are
dropped, so renamed or deleted models don't linger.
"""

from __future__ import annotations

from pathlib import Path

import duckdb

SCHEMAS = ("ref", "silver", "enrich", "gold")


def _tables(con: duckdb.DuckDBPyConnection, catalog: str) -> set[tuple[str, str]]:
    rows = con.execute(
        """
        select schema_name, table_name from duckdb_tables()
        where database_name = ? and schema_name in (select unnest(?))
        """,
        [catalog, list(SCHEMAS)],
    ).fetchall()
    return {(schema, table) for schema, table in rows}


def publish(warehouse: Path, target: str, extension_dir: str) -> list[str]:
    """Replace `target`'s silver/gold/etc. tables with the warehouse's.

    `target` is `md:<database>` (the token comes from the `motherduck_token`
    environment variable; the database is created on first publish, owned by
    that account) or a local DuckDB path. Returns the tables published, as
    `schema.table`.
    """
    config = {"extension_directory": extension_dir}
    if target.startswith("md:"):
        catalog = target.removeprefix("md:")
        con = duckdb.connect("md:", config=config)
        con.execute(f'create database if not exists "{catalog}"')
    else:
        con = duckdb.connect(target, config=config)
        [(catalog,)] = con.execute("select current_database()").fetchall()
    try:
        con.execute(f"attach '{warehouse}' as build (read_only)")
        local = _tables(con, "build")
        if not local:
            raise RuntimeError(f"{warehouse} has no tables in {SCHEMAS}; refusing to publish")
        stale = _tables(con, catalog) - local

        con.execute("begin")
        for schema in sorted({schema for schema, _ in local}):
            con.execute(f'create schema if not exists "{catalog}"."{schema}"')
        for schema, table in sorted(local):
            con.execute(
                f'create or replace table "{catalog}"."{schema}"."{table}" '
                f'as from build."{schema}"."{table}"'
            )
        for schema, table in sorted(stale):
            con.execute(f'drop table "{catalog}"."{schema}"."{table}"')
        con.execute("commit")
    finally:
        con.close()
    return [f"{schema}.{table}" for schema, table in sorted(local)]
