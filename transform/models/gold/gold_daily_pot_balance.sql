-- End-of-day balance per open pot, reconstructed backwards from its latest
-- balance the same way gold_daily_balance does for accounts: balance(d) =
-- current balance - net of the pot's movements after d. Movements are pot
-- transfers (pot_id) and payments a bills pot made itself (bills_pot_id).
-- Interest, and money a pot got some other way the API doesn't show, isn't
-- visible, so older values of those pots read low.

with pots as (
    select pot_id, account_id, balance_pence, goal_pence, cast({{ to_local('created_at') }} as date) as created_on
    from {{ ref('silver_pots') }}
    where not is_deleted
),

movements as (
    -- Money out of the account into a pot is money into the pot.
    select pot_id, transaction_date as day, -amount_pence as net_pence
    from {{ ref('silver_transactions') }}
    where not is_declined and pot_id is not null
    union all
    select bills_pot_id, transaction_date, amount_pence
    from {{ ref('silver_transactions') }}
    where not is_declined and bills_pot_id is not null
),

daily as (
    select pot_id, day, sum(net_pence) as net_pence
    from movements
    group by 1, 2
),

spine as (
    select
        pot_id,
        cast(unnest(generate_series(
            cast(created_on as timestamp),
            cast(cast({{ to_local('now()') }} as date) as timestamp),
            interval 1 day
        )) as date) as day
    from pots
),

filled as (
    select s.pot_id, s.day, coalesce(d.net_pence, 0) as net_pence
    from spine as s
    left join daily as d using (pot_id, day)
)

select
    f.pot_id,
    p.account_id,
    f.day,
    p.balance_pence - coalesce(sum(f.net_pence) over after_day, 0) as balance_pence,
    p.goal_pence
from filled as f
join pots as p using (pot_id)
window after_day as (
    partition by f.pot_id order by f.day
    rows between 1 following and unbounded following
)
order by f.pot_id, f.day
