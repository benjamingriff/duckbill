-- One row identifying this dbt build. The API caches query results until
-- build_id changes, so a new build (or a schema change) shows up straight away.

select
    '{{ invocation_id }}'  as build_id,
    now()                  as built_at
