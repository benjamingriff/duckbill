"""One-off MotherDuck setup and checks, run by deploy/setup.sh.

    share  As the writer service account: create the `duckbill` database (if the
           first publish hasn't yet) and a hidden, restricted, auto-updating
           share of it, grant read access, and print the share URL.
    check  As the reader service account: attach the share and report the
           build it serves; exits 1 if none is newer than --since.

The token comes from the `motherduck_token` environment variable, never argv.
Usage: uv run python deploy/motherduck.py share --grant duckbill_reader --grant <you>
       uv run python deploy/motherduck.py check --share md:_share/... [--since ISO]
"""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime

import duckdb

DATABASE = "duckbill"
ALIAS = "duckbill"  # what the API attaches the share as (apps/api/src/db.ts)


def _ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def share(grants: list[str]) -> int:
    con = duckdb.connect("md:")
    con.execute(f"create database if not exists {_ident(DATABASE)}")
    [(url,)] = con.execute(
        f"create share if not exists {_ident(DATABASE)} from {_ident(DATABASE)} "
        "(access restricted, visibility hidden, update automatic)"
    ).fetchall()
    if grants:
        users = ", ".join(f"user {_ident(user)}" for user in grants)
        con.execute(f"grant read on share {_ident(DATABASE)} to {users}")
    print(url)
    return 0


def check(url: str, since: datetime | None) -> int:
    con = duckdb.connect("md:")
    # MotherDuck keeps attachments across sessions; reattach so the alias is this share.
    con.execute(f"detach database if exists {ALIAS}")
    con.execute(f"attach '{url}' as {ALIAS}")
    try:
        [(build_id, built_at, tables)] = con.execute(
            f"""
            select build_id, built_at,
                   (select count(*) from duckdb_tables() where database_name = '{ALIAS}')
            from {ALIAS}.gold.gold_build_info
            """
        ).fetchall()
    except duckdb.CatalogException:
        print("no build published yet")
        return 1
    print(f"build {build_id} at {built_at:%Y-%m-%d %H:%M} UTC, {tables} tables")
    if since is not None and since.tzinfo is None:
        since = since.replace(tzinfo=UTC)  # a cutoff without an offset means UTC
    return 0 if since is None or built_at >= since else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    share_p = sub.add_parser("share")
    share_p.add_argument("--grant", action="append", default=[], help="username to grant read")
    check_p = sub.add_parser("check")
    check_p.add_argument("--share", required=True)
    check_p.add_argument("--since", type=datetime.fromisoformat)
    args = parser.parse_args()
    if args.command == "share":
        return share(args.grant)
    return check(args.share, args.since)


if __name__ == "__main__":
    sys.exit(main())
