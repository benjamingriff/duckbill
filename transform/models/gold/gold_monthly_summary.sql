-- Headline numbers per month.

with tx as (
    select
        transaction_month as month,
        sum(spend_pence)                                   as spend_pence,
        sum(income_pence)                                  as income_pence,
        count(*) filter (where counts_as_spending and amount_pence < 0) as spend_count,
        sum(case when is_pot_transfer then -amount_pence else 0 end) as saved_to_pots_pence
    from {{ ref('silver_transactions') }}
    where not is_declined
    group by 1
)

select
    s.month,
    coalesce(tx.spend_pence, 0)                            as spend_pence,
    coalesce(tx.income_pence, 0)                           as income_pence,
    coalesce(tx.income_pence, 0) - coalesce(tx.spend_pence, 0) as net_pence,
    coalesce(tx.saved_to_pots_pence, 0)                    as saved_to_pots_pence,
    coalesce(tx.spend_count, 0)                            as spend_count
from {{ ref('gold_month_spine') }} as s
left join tx using (month)
order by s.month
