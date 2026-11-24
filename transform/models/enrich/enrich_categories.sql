-- The category table every page reads display from: key, label, colour,
-- parent and group (committed, flexible, saving, income, transfer). Today
-- it is the `categories` seed of Monzo's categories, plus a row for each
-- Monzo custom category (`category_0000…`), which the API sends without a
-- name. Replacing the seed's contents changes every page without code changes.

with custom as (
    select
        monzo_category                                  as category,
        min(created_at)                                 as first_seen
    from {{ ref('silver_transactions') }}
    where monzo_category is not null
        and monzo_category not in (select category from {{ ref('categories') }})
    group by 1
)

select category, label, colour, parent, category_group
from {{ ref('categories') }}

union all

select
    category,
    -- Monzo's API doesn't name custom categories; number them by first use.
    'Custom ' || row_number() over (order by first_seen, category) as label,
    '#77716c'                                                    as colour,
    null                                                         as parent,
    'flexible'                                                   as category_group
from custom
