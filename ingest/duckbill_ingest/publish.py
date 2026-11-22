"""Copy a locally built warehouse into MotherDuck (or any DuckDB database).

dbt builds and tests in a local file, so only a green build is published and
MotherDuck's compute is spent on reads, not transforms. Every table in the
published schemas is replaced in one transaction: readers see the previous
build or this one, never a mix. Tables that no longer exist locally are
dropped, so renamed or deleted models don't linger.

A build that passes its tests can still be wrong. Raw is append-only and silver
keeps one row per transaction ever seen, so `silver_transactions` can only grow:
a build with fewer rows than the published one has lost history (a model change
filtered rows out, or raw went missing) and is refused unless `allow_shrink`.
"""

from __future__ import annotations

from pathlib import Path

import duckdb

SCHEMAS = ("ref", "silver", "enrich", "gold")
NEVER_SHRINKS = ("silver", "silver_transactions")


def _tables(con: duckdb.DuckDBPyConnection, catalog: str) -> set[tuple[str, str]]:
    rows = con.execute(
        """
        select schema_name, table_name from duckdb_tables()
        where database_name = ? and schema_name in (select unnest(?))
        """,
        [catalog, list(SCHEMAS)],
    ).fetchall()
    return {(schema, table) for schema, table in rows}


def _rows(con: duckdb.DuckDBPyConnection, catalog: str, tables: set[tuple[str, str]]) -> int:
    """Rows in NEVER_SHRINKS within `catalog`, or 0 if `tables` doesn't have it."""
    if NEVER_SHRINKS not in tables:
        return 0
    schema, table = NEVER_SHRINKS
    [(count,)] = con.execute(f'select count(*) from "{catalog}"."{schema}"."{table}"').fetchall()
    return count


def publish(
    warehouse: Path, target: str, extension_dir: str, *, allow_shrink: bool = False
) -> list[str]:
    """Replace `target`'s silver/gold/etc. tables with the warehouse's.

    `target` is `md:<database>` (the token comes from the `motherduck_token`
    environment variable; the database is created on first publish, owned by
    that account) or a local DuckDB path. Returns the tables published, as
    `schema.table`. Raises if `silver_transactions` would lose rows, unless
    `allow_shrink`.
    """
    config: dict[str, str | bool | int | float | list[str]] = {"extension_directory": extension_dir}
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

        # The count is read in the same transaction as the swap, so a publish
        # that commits in between makes this one conflict instead of slipping past.
        con.execute("begin")
        published = _tables(con, catalog)
        before, after = _rows(con, catalog, published), _rows(con, "build", local)
        if after < before and not allow_shrink:
            raise RuntimeError(
                f"{'.'.join(NEVER_SHRINKS)} would shrink from {before} to {after} rows; "
                "refusing to publish. If that's intended, publish with allow_shrink."
            )
        stale = published - local
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
