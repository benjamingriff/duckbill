{# Use the layer name (silver/enrich/gold) as the schema, without a target prefix. #}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {{ custom_schema_name if custom_schema_name else target.schema }}
{%- endmacro %}
