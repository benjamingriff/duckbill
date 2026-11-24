-- Spend per category within each Monzo-detected trip.

select
    trip_id,
    category,
    any_value(category_label)  as category_label,
    any_value(category_colour) as category_colour,
    sum(spend_pence)           as spend_pence,
    count(*) filter (where amount_pence < 0) as transaction_count
from {{ ref('gold_effective_transactions') }}
where trip_id is not null and counts_as_spending
group by trip_id, category
order by trip_id, spend_pence desc
