"""The S3 and SSM backends, against moto's in-process AWS fakes."""

import gzip
import json

import boto3
import pytest
from duckbill_ingest.auth import SsmTokenStore, Token
from duckbill_ingest.raw import RawWriter, missing_endpoints
from duckbill_ingest.storage import LocalStore, S3Store, open_store
from moto import mock_aws

BUCKET = "duckbill-test"


@pytest.fixture
def aws(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-west-2")
    with mock_aws():
        yield


@pytest.fixture
def s3(aws):
    client = boto3.client("s3")
    client.create_bucket(
        Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": "eu-west-2"}
    )
    return client


@pytest.fixture(params=["local", "s3"])
def store(request, tmp_path):
    if request.param == "local":
        return LocalStore(tmp_path)
    return S3Store(BUCKET, "prefix", request.getfixturevalue("s3"))


def test_stores_put_get_and_list_under_a_prefix(store):
    store.put("raw/monzo/balance/date=2026-11-20/run1.jsonl.gz", b"a")
    store.put("raw/monzo/pots/date=2026-11-20/run1.jsonl.gz", b"b")
    store.put("state/sync_state.json", b"{}")

    assert store.get("state/sync_state.json") == b"{}"
    assert store.get("state/missing.json") is None
    assert sorted(store.keys("raw/monzo/")) == [
        "raw/monzo/balance/date=2026-11-20/run1.jsonl.gz",
        "raw/monzo/pots/date=2026-11-20/run1.jsonl.gz",
    ]
    assert list(store.keys("nothing/")) == []


def test_raw_writer_publishes_to_s3_under_the_prefix_on_close(s3):
    store = S3Store(BUCKET, "duckbill", s3)
    with RawWriter(store, "run1") as writer:
        writer.write("balance", {"account_id": "acc_1"}, {"balance": 1})
        assert s3.list_objects_v2(Bucket=BUCKET).get("KeyCount") == 0

    [item] = s3.list_objects_v2(Bucket=BUCKET)["Contents"]
    assert item["Key"].startswith("duckbill/raw/monzo/balance/date=")
    body = s3.get_object(Bucket=BUCKET, Key=item["Key"])["Body"].read()
    assert json.loads(gzip.decompress(body))["payload"] == {"balance": 1}
    assert missing_endpoints(store) == ["accounts", "pots", "transactions"]


def test_open_store_parses_s3_uris(aws):
    assert open_store("s3://bucket").uri == "s3://bucket"
    assert open_store("s3://bucket/some/prefix/").uri == "s3://bucket/some/prefix"
    with pytest.raises(SystemExit):
        open_store("s3:///prefix")


def test_ssm_token_store_round_trips_as_a_secure_string(aws):
    client = boto3.client("ssm")
    store = SsmTokenStore("/duckbill/monzo-token", client)
    assert store.load() is None

    store.save(Token("access", "refresh", 123.0, "user_1"))
    store.save(Token("access2", "refresh2", 456.0, "user_1"))

    assert store.load() == Token("access2", "refresh2", 456.0, "user_1")
    parameter = client.get_parameter(Name="/duckbill/monzo-token")["Parameter"]
    assert parameter["Type"] == "SecureString"
