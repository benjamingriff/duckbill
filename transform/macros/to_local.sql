{# Convert a TIMESTAMPTZ to wall-clock time in the reporting timezone. #}
{% macro to_local(column) -%}
    timezone('{{ var("reporting_timezone") }}', {{ column }})
{%- endmacro %}
