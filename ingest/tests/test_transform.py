"""The dbt project as dbt itself parses it."""

from dbt.cli.main import dbtRunner
from duckbill_ingest.config import TRANSFORM_DIR


def test_every_model_is_rebuilt_from_raw_on_each_run(tmp_path, monkeypatch):
    # Raw is the only state: silver and gold are rebuilt from it every run, so a
    # broken model is fixed by fixing the SQL, with nothing to repair or backfill.
    # An incremental model or a snapshot would keep state between runs that a bad
    # build could corrupt. Keep it that way, or change this test on purpose.
    monkeypatch.setenv("DUCKBILL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DUCKBILL_DBT_TARGET", "local")
    monkeypatch.setenv("DUCKBILL_RAW_URI", str(tmp_path / "raw"))
    monkeypatch.setenv("DBT_LOG_PATH", str(tmp_path / "logs"))
    result = dbtRunner().invoke(
        [
            "parse",
            "--project-dir",
            str(TRANSFORM_DIR),
            "--profiles-dir",
            str(TRANSFORM_DIR),
            "--target-path",
            str(tmp_path / "target"),
            "--quiet",
        ]
    )
    assert result.success, result.exception
    nodes = result.result.nodes.values()
    kinds = {n.unique_id: n.config.materialized for n in nodes if n.resource_type == "model"}
    assert kinds, "no models parsed"
    assert {uid: kind for uid, kind in kinds.items() if kind not in ("table", "view")} == {}
    assert [n.unique_id for n in nodes if n.resource_type == "snapshot"] == []
