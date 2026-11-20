import duckdb
import pytest
from duckbill_ingest.publish import publish


def _warehouse(path, rows):
    con = duckdb.connect(str(path))
    con.execute("create schema gold")
    con.execute("create table gold.gold_build_info as select ? as build_id", [rows])
    con.close()


def test_publish_replaces_tables_and_drops_stale_ones(tmp_path):
    target = tmp_path / "target.duckdb"
    con = duckdb.connect(str(target))
    con.execute("create schema gold")
    con.execute("create table gold.gold_build_info as select 'old' as build_id")
    con.execute("create table gold.gold_renamed_away as select 1 as x")
    con.execute("create table main.not_ours as select 1 as x")
    con.close()

    warehouse = tmp_path / "warehouse.duckdb"
    _warehouse(warehouse, "new")
    published = publish(warehouse, str(target), str(tmp_path / "ext"))

    assert published == ["gold.gold_build_info"]
    con = duckdb.connect(str(target), read_only=True)
    assert con.execute("select build_id from gold.gold_build_info").fetchall() == [("new",)]
    tables = {r[0] for r in con.execute("select table_name from duckdb_tables()").fetchall()}
    assert tables == {"gold_build_info", "not_ours"}


def test_publish_refuses_an_empty_warehouse(tmp_path):
    duckdb.connect(str(tmp_path / "empty.duckdb")).close()
    with pytest.raises(RuntimeError, match="refusing"):
        publish(tmp_path / "empty.duckdb", str(tmp_path / "t.duckdb"), str(tmp_path / "ext"))
