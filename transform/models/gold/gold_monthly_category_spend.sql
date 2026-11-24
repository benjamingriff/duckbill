-- Spending per month per category (refunds net off within their category),
-- with the month before and the same month last year for month-on-month and
-- year-on-year change. Every category that has ever had spending gets a row
-- for every month, zero when quiet, so changes compare like with like.

with spend as (
    select
        transaction_month as month,
        category,
        sum(spend_pence)  as spend_pence,
        -- Visits: payments out. Refunds net off the spend but aren't visits.
        count(*) filter (where amount_pence < 0) as transaction_count
    from {{ ref('gold_effective_transactions') }}
    where counts_as_spending
    group by all
),

grid as (
    select m.month, c.category
    from {{ ref('gold_month_spine') }} as m
    cross join (select distinct category from spend) as c
),

filled as (
    select
        g.month,
        g.category,
        coalesce(s.spend_pence, 0)       as spend_pence,
        coalesce(s.transaction_count, 0) as transaction_count
    from grid as g
    left join spend as s using (month, category)
)

select
    f.month,
    f.category,
    k.label                             as category_label,
    f.spend_pence,
    f.transaction_count,
    prev.spend_pence                    as previous_month_spend_pence,
    last_year.spend_pence               as last_year_spend_pence
from filled as f
join {{ ref('enrich_categories') }} as k using (category)
left join filled as prev
    on prev.category = f.category and prev.month = f.month - interval 1 month
left join filled as last_year
    on last_year.category = f.category and last_year.month = f.month - interval 1 year
order by f.month, f.spend_pence desc
