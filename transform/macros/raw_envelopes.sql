{#
  Read every raw envelope written for a Monzo endpoint. Raw files are
  append-only gzipped JSON Lines; the response body stays untouched in `payload`.
#}
{% macro raw_envelopes(endpoint) %}
    read_json(
        '{{ env_var("DUCKBILL_DATA_DIR") }}/raw/monzo/{{ endpoint }}/*/*.jsonl.gz',
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
