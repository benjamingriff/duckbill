# One image for both Lambda functions; the CDK stack picks the handler:
#   duckbill_ingest.aws.ingest_handler   daily Monzo sync into S3
#   duckbill_ingest.aws.dbt_handler      dbt build in /tmp, publish to MotherDuck
# Build context is the repo root: docker build -f deploy/lambda/Dockerfile .
FROM public.ecr.aws/lambda/python:3.13

COPY --from=ghcr.io/astral-sh/uv:0.11.29 /uv /bin/uv

# Dependencies from the lockfile, installed into the task root.
COPY pyproject.toml uv.lock /tmp/build/
RUN cd /tmp/build \
    && uv export --frozen --no-dev --no-emit-project --no-hashes -o requirements.txt \
    && uv pip install --no-cache --target "${LAMBDA_TASK_ROOT}" -r requirements.txt \
    && rm -rf /tmp/build

# DuckDB extensions are baked into /opt so runs don't download them. Loading
# motherduck here also fetches its versioned implementation. Lambda's
# filesystem is read-only apart from /tmp, and the motherduck extension
# downloads a newer implementation when one is released, so the handlers copy
# this directory to DUCKBILL_DUCKDB_EXTENSION_DIR in /tmp and load from there.
RUN PYTHONPATH="${LAMBDA_TASK_ROOT}" python -c "import duckdb; \
con = duckdb.connect(config={'extension_directory': '/opt/duckdb-extensions'}); \
[con.install_extension(e) for e in ('httpfs', 'aws', 'motherduck')]; \
con.load_extension('motherduck')"
ENV DUCKBILL_DUCKDB_EXTENSION_DIR=/tmp/duckdb-extensions

# Keep the repo layout: config.py finds transform/ relative to the package.
COPY ingest/duckbill_ingest ${LAMBDA_TASK_ROOT}/ingest/duckbill_ingest
COPY transform/dbt_project.yml transform/profiles.yml ${LAMBDA_TASK_ROOT}/transform/
COPY transform/models ${LAMBDA_TASK_ROOT}/transform/models
COPY transform/macros ${LAMBDA_TASK_ROOT}/transform/macros
COPY transform/seeds ${LAMBDA_TASK_ROOT}/transform/seeds
COPY transform/tests ${LAMBDA_TASK_ROOT}/transform/tests

# Everything that writes goes to /tmp: dbt's target and logs, and HOME for
# anything that caches there (dbt, the MotherDuck extension).
ENV PYTHONPATH="${LAMBDA_TASK_ROOT}/ingest:${LAMBDA_TASK_ROOT}" \
    HOME=/tmp \
    DBT_TARGET_PATH=/tmp/dbt/target \
    DBT_LOG_PATH=/tmp/dbt/logs \
    DBT_SEND_ANONYMOUS_USAGE_STATS=false \
    PYTHONDONTWRITEBYTECODE=1

CMD ["duckbill_ingest.aws.ingest_handler"]
