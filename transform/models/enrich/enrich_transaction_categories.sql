-- The categorisation layer. v0 adopts Monzo's category as-is. Later versions
-- can layer rules (e.g. merchant -> "coffee") or a model on top; record which
-- one produced each row in category_source/rules_version so runs are reproducible.
-- Display (label, colour, group) comes from enrich_categories.

select
    t.transaction_id,
    coalesce(t.monzo_category, 'general')          as category,
    c.label                                        as category_label,
    'monzo'                                        as category_source,
    'v0'                                           as rules_version
from {{ ref('silver_transactions') }} as t
join {{ ref('enrich_categories') }} as c
    on c.category = coalesce(t.monzo_category, 'general')
