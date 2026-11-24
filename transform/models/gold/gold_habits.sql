-- "Habits worth knowing": a few facts that are only visible over time. One
-- row per habit that the data supports; a habit with too little data is left
-- out rather than shown as zero.
--
--   top_payee         the payee you visit most in the last year: yearly spend
--                     (value), visits (count) and average visit (compare)
--   payday_lift       average daily flexible spend in the 5 days from each
--                     payday (value) against the other days (compare)
--   takeaway_average  average takeaway this year (value) against the earliest
--                     of the two years before (compare)

with recent as (
    select *
    from {{ ref('gold_effective_transactions') }}
    where transaction_date > cast({{ to_local('now()') }} as date) - interval 365 day
),

top_payee as (
    select
        'top_payee'                                  as habit,
        any_value(payee_name)                        as label,
        sum(spend_pence)                             as value_pence,
        cast(round(avg(spend_pence)) as bigint)      as compare_pence,
        count(*)                                     as count,
        null::integer                                as from_year,
        null::integer                                as to_year
    from recent
    where counts_as_spending and amount_pence < 0
    group by payee_key
    having count(*) >= 12
    order by count(*) desc, sum(spend_pence) desc
    limit 1
),

paydays as (
    select distinct transaction_date as payday
    from recent
    where income_kind = 'salary'
),

days as (
    select cast(unnest(generate_series(
        cast(cast({{ to_local('now()') }} as date) - interval 364 day as timestamp),
        cast(cast({{ to_local('now()') }} as date) as timestamp),
        interval 1 day
    )) as date) as day
),

flexible_days as (
    select
        d.day,
        coalesce(sum(r.spend_pence), 0) as spend_pence,
        exists (
            select 1 from paydays as p where d.day between p.payday and p.payday + 4
        ) as after_payday
    from days as d
    left join recent as r
        on r.transaction_date = d.day and r.counts_as_spending and r.recurring_key is null
    group by d.day
),

payday_lift as (
    select
        'payday_lift'                                                   as habit,
        null                                                            as label,
        cast(round(avg(spend_pence) filter (where after_payday)) as bigint)     as value_pence,
        cast(round(avg(spend_pence) filter (where not after_payday)) as bigint) as compare_pence,
        (select count(*) from paydays)                                  as count,
        null::integer                                                   as from_year,
        null::integer                                                   as to_year
    from flexible_days
    having count(*) filter (where after_payday) > 0
),

takeaway_years as (
    select
        year(transaction_date)                  as year,
        cast(round(avg(spend_pence)) as bigint) as average_pence,
        count(*)                                as count
    from {{ ref('gold_effective_transactions') }}
    where food_kind = 'takeaway' and amount_pence < 0
        and year(transaction_date) >= year({{ to_local('now()') }}) - 2
    group by 1
),

takeaway_average as (
    select
        'takeaway_average'   as habit,
        null                 as label,
        last.average_pence   as value_pence,
        first.average_pence  as compare_pence,
        last.count           as count,
        first.year           as from_year,
        last.year            as to_year
    from (select * from takeaway_years order by year limit 1) as first
    cross join (select * from takeaway_years order by year desc limit 1) as last
    where first.year < last.year
)

select * from top_payee
union all
select * from payday_lift
union all
select * from takeaway_average
