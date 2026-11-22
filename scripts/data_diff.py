"""Compare two built warehouses table by table, as a Markdown report.

CI builds the demo raw data with main's models and with the PR's, then runs:

    uv run python scripts/data_diff.py <main warehouse> <pr warehouse>

so a PR that changes any published number says which tables and how many rows.
It also works on two builds of your real data, e.g. before and after a model
change. The report has counts only, never row contents. It always exits 0: a
change is a fact to explain in the PR, not a failure.
"""

from __future__ import annotations

import sys

import duckdb
from duckbill_ingest.publish import SCHEMAS

# Different on every build by design.
IGNORED = {("gold", "gold_build_info")}


def _tables(con: duckdb.DuckDBPyConnection, catalog: str) -> dict[tuple[str, str], list]:
    """Each published table's ordered (column, type) pairs: EXCEPT ALL coerces types."""
    rows = con.execute(
        """
        select schema_name, table_name, list((column_name, data_type) order by column_index)
        from duckdb_columns()
        where database_name = ? and schema_name in (select unnest(?))
          -- Tables only, as published: dbt's views name the catalog they were built in.
          and table_oid in (select table_oid from duckdb_tables())
        group by all
        """,
        [catalog, list(SCHEMAS)],
    ).fetchall()
    return {(schema, table): columns for schema, table, columns in rows}


def diff(main: str, pr: str) -> list[str]:
    con = duckdb.connect()
    con.execute(f"attach '{main}' as main_build (read_only)")
    con.execute(f"attach '{pr}' as pr_build (read_only)")
    before, after = _tables(con, "main_build"), _tables(con, "pr_build")

    lines = []
    for key in sorted((before.keys() | after.keys()) - IGNORED):
        name = ".".join(key)
        ref = '"{}"."{}"."{}"'
        old, new = ref.format("main_build", *key), ref.format("pr_build", *key)
        if key not in after:
            lines.append(f"| `{name}` | removed | | |")
        elif key not in before:
            [(rows,)] = con.execute(f"select count(*) from {new}").fetchall()
            lines.append(f"| `{name}` | added, {rows} row{'' if rows == 1 else 's'} | | |")
        elif before[key] != after[key]:
            lines.append(f"| `{name}` | columns changed | | |")
        else:
            [(gone,)] = con.execute(
                f"select count(*) from (from {old} except all from {new})"
            ).fetchall()
            [(came,)] = con.execute(
                f"select count(*) from (from {new} except all from {old})"
            ).fetchall()
            if gone or came:
                lines.append(f"| `{name}` | rows changed | {gone} | {came} |")
    con.close()

    if not lines:
        return ["**Data diff (demo data):** every published table is unchanged."]
    return [
        "**Data diff (demo data):** this PR changes what the dashboard shows.",
        "",
        "| Table | Change | Rows only on main | Rows only in this PR |",
        "| --- | --- | --- | --- |",
        *lines,
    ]


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: data_diff.py <main warehouse> <pr warehouse>")
    print("\n".join(diff(sys.argv[1], sys.argv[2])))
