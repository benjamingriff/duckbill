-- Food spending per calendar day, at home (groceries) and out (restaurants
-- and bars, or takeaway), with zero days included so averages per weekday
-- and shares per season divide by the right number of days.

with food as (
    select
        transaction_date as day,
        sum(spend_pence) filter (where food_kind = 'eating_in')  as eating_in_pence,
        sum(spend_pence) filter (where food_kind = 'eating_out') as eating_out_pence,
        sum(spend_pence) filter (where food_kind = 'takeaway')   as takeaway_pence
    from {{ ref('gold_effective_transactions') }}
    where counts_as_spending and food_kind is not null
    group by 1
),

days as (
    select cast(unnest(generate_series(
        cast((select min(transaction_date) from {{ ref('silver_transactions') }}) as timestamp),
        cast(cast({{ to_local('now()') }} as date) as timestamp),
        interval 1 day
    )) as date) as day
)

select
    d.day,
    isodow(d.day)                            as weekday,
    cast(date_trunc('month', d.day) as date) as month,
    {{ season('d.day') }}                    as season,
    coalesce(f.eating_in_pence, 0)           as eating_in_pence,
    coalesce(f.eating_out_pence, 0)          as eating_out_pence,
    coalesce(f.takeaway_pence, 0)            as takeaway_pence
from days as d
left join food as f using (day)
order by d.day
