-- Headline numbers per month. Spend and income come from the effective
-- transactions; income splits into salary and everything else, and
-- committed spend is the part paid by subscriptions, direct debits and
-- standing orders.

with tx as (
    select
        transaction_month as month,
        sum(spend_pence)                                                   as spend_pence,
        sum(spend_pence) filter (where recurring_key is not null)          as committed_spend_pence,
        sum(income_pence)                                                  as income_pence,
        sum(income_pence) filter (where income_kind = 'salary')            as salary_income_pence,
        count(*) filter (where counts_as_spending and amount_pence < 0)    as spend_count
    from {{ ref('gold_effective_transactions') }}
    group by 1
),

pots as (
    select
        transaction_month as month,
        sum(-amount_pence) as saved_to_pots_pence
    from {{ ref('silver_transactions') }}
    where not is_declined and is_pot_transfer
    group by 1
)

select
    s.month,
    coalesce(tx.spend_pence, 0)                                    as spend_pence,
    coalesce(tx.committed_spend_pence, 0)                          as committed_spend_pence,
    coalesce(tx.income_pence, 0)                                   as income_pence,
    coalesce(tx.salary_income_pence, 0)                            as salary_income_pence,
    coalesce(tx.income_pence, 0) - coalesce(tx.salary_income_pence, 0) as other_income_pence,
    coalesce(tx.income_pence, 0) - coalesce(tx.spend_pence, 0)     as net_pence,
    coalesce(pots.saved_to_pots_pence, 0)                          as saved_to_pots_pence,
    coalesce(tx.spend_count, 0)                                    as spend_count
from {{ ref('gold_month_spine') }} as s
left join tx using (month)
left join pots using (month)
order by s.month
