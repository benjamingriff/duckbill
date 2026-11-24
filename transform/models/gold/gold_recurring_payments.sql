-- Regular payments, one row per direct debit mandate, standing order series
-- or Monzo-detected subscription: what it is, what it usually costs, how
-- often and on which day. Active ones make up the committed spend list.
-- Cadence comes from the median gap between recent payments.

with payments as (
    select
        recurring_key,
        recurring_kind,
        transaction_date,
        spend_pence,
        payee_name,
        category,
        category_label,
        category_colour,
        category_group,
        row_number() over (partition by recurring_key order by created_at_local desc) as recency,
        transaction_date - lag(transaction_date) over (
            partition by recurring_key order by created_at_local
        ) as gap_days
    from {{ ref('gold_effective_transactions') }}
    where counts_as_spending and recurring_key is not null and amount_pence < 0
),

summary as (
    select
        recurring_key,
        any_value(recurring_kind)                                     as recurring_kind,
        arg_max(payee_name, transaction_date)                         as name,
        arg_max(category, transaction_date)                           as category,
        arg_max(category_label, transaction_date)                     as category_label,
        arg_max(category_colour, transaction_date)                    as category_colour,
        arg_max(category_group, transaction_date)                     as category_group,
        count(*)                                                      as payment_count,
        min(transaction_date)                                         as first_paid_on,
        max(transaction_date)                                         as last_paid_on,
        cast(median(spend_pence) filter (where recency <= 3) as bigint) as typical_pence,
        median(gap_days) filter (where recency <= 6)                  as median_gap_days,
        mode(day(transaction_date)) filter (where recency <= 6)       as typical_day_of_month,
        mode(isodow(transaction_date)) filter (where recency <= 6)    as typical_weekday
    from payments
    group by recurring_key
),

cadenced as (
    select
        *,
        case
            when median_gap_days is null then 'unknown'
            when median_gap_days between 5 and 9 then 'weekly'
            when median_gap_days between 25 and 35 then 'monthly'
            when median_gap_days between 80 and 100 then 'quarterly'
            when median_gap_days between 350 and 380 then 'yearly'
            else 'irregular'
        end as cadence
    from summary
)

select
    recurring_key,
    recurring_kind,
    name,
    category,
    category_label,
    category_colour,
    category_group,
    cadence,
    case when cadence = 'weekly' then typical_weekday end              as typical_weekday,
    case when cadence in ('monthly', 'quarterly', 'yearly') then typical_day_of_month end
                                                                       as typical_day_of_month,
    typical_pence,
    -- What it costs in an average month, for committed totals.
    cast(round(typical_pence * case cadence
        when 'weekly' then 52.0 / 12
        when 'monthly' then 1
        when 'quarterly' then 1.0 / 3
        when 'yearly' then 1.0 / 12
    end) as bigint)                                                    as monthly_pence,
    payment_count,
    first_paid_on,
    last_paid_on,
    -- Still running if the next payment isn't overdue by more than half a
    -- cycle, as of the newest transaction (so a paused sync doesn't end them).
    last_paid_on >= (select max(transaction_date) from {{ ref('silver_transactions') }})
        - cast(round(case cadence
        when 'weekly' then 7 * 1.5
        when 'monthly' then 31 * 1.5
        when 'quarterly' then 92 * 1.5
        when 'yearly' then 366 * 1.5
        else 45
    end) as integer)                                                   as is_active
from cadenced
order by is_active desc, monthly_pence desc nulls last
