{#
  Read every raw envelope written for a Monzo endpoint. Raw files are
  append-only gzipped JSON Lines; the response body stays untouched in `payload`.
  DUCKBILL_RAW_URI is a local directory or s3:// prefix, set by `duckbill transform`.
#}
{% macro raw_envelopes(endpoint) %}
    read_json(
        '{{ env_var("DUCKBILL_RAW_URI") }}/monzo/{{ endpoint }}/*/*.jsonl.gz',
        format = 'newline_delimited',
        hive_partitioning = false,
        filename = true,
        columns = {
            run_id: 'VARCHAR',
            fetched_at: 'TIMESTAMPTZ',
            endpoint: 'VARCHAR',
            params: 'JSON',
            payload: 'JSON'
        }
    )
{% endmacro %}
