-- The categorisation layer. v0 adopts Monzo's category as-is. Later versions
-- can layer rules (e.g. merchant -> "coffee") or a model on top; record which
-- one produced each row in category_source/rules_version so runs are reproducible.

select
    t.transaction_id,
    coalesce(t.monzo_category, 'general')          as category,
    coalesce(c.label, replace(t.monzo_category, '_', ' '), 'General')
                                                   as category_label,
    'monzo'                                        as category_source,
    'v0'                                           as rules_version
from {{ ref('silver_transactions') }} as t
left join {{ ref('monzo_categories') }} as c
    on c.category = t.monzo_category
