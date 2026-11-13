-- End-of-day balance per account, reconstructed backwards from the latest
-- balance snapshot: balance(d) = current balance - net of everything after d.
-- Pot totals are reconstructed the same way from pot transfers (interest
-- earned inside pots is not visible to the API, so older pot values drift).

with current_balance as (
    select account_id, balance_pence
    from {{ ref('silver_balance_snapshots') }}
    qualify row_number() over (partition by account_id order by fetched_at desc) = 1
),

current_pots as (
    select account_id, sum(balance_pence) as pots_pence
    from {{ ref('silver_pots') }}
    where not is_deleted
    group by 1
),

daily as (
    select
        account_id,
        transaction_date as day,
        sum(amount_pence)                                              as net_pence,
        sum(case when is_pot_transfer then -amount_pence else 0 end)  as to_pots_pence
    from {{ ref('silver_transactions') }}
    where not is_declined
    group by 1, 2
),

spine as (
    select a.account_id, cast(d.day as date) as day
    from {{ ref('silver_accounts') }} as a
    cross join range(
        (select min(transaction_date) from {{ ref('silver_transactions') }}),
        cast({{ to_local('now()') }} as date) + 1,
        interval 1 day
    ) as d(day)
    where not a.is_closed
),

filled as (
    select
        s.account_id,
        s.day,
        coalesce(d.net_pence, 0)     as net_pence,
        coalesce(d.to_pots_pence, 0) as to_pots_pence
    from spine as s
    left join daily as d using (account_id, day)
)

select
    f.account_id,
    f.day,
    b.balance_pence - coalesce(sum(f.net_pence) over after_day, 0)          as balance_pence,
    coalesce(p.pots_pence, 0) - coalesce(sum(f.to_pots_pence) over after_day, 0) as pots_pence
from filled as f
join current_balance as b using (account_id)
left join current_pots as p using (account_id)
window after_day as (
    partition by f.account_id order by f.day
    rows between 1 following and unbounded following
)
order by f.account_id, f.day
