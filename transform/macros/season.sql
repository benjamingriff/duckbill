{# The season a date falls in, by meteorological season (winter is Dec to Feb). #}
{% macro season(column) -%}
    case
        when month({{ column }}) in (12, 1, 2) then 'winter'
        when month({{ column }}) in (3, 4, 5) then 'spring'
        when month({{ column }}) in (6, 7, 8) then 'summer'
        else 'autumn'
    end
{%- endmacro %}
