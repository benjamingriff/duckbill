{{ config(severity='warn') }}

-- If the full history was backfilled, the reconstructed balance before the
-- first transaction is zero. A non-zero value means history is missing (e.g.
-- the backfill ran outside Monzo's 5 minute window) or a transaction changed.

with first_day as (
    select account_id, min(day) as day
    from {{ ref('gold_daily_balance') }}
    group by 1
)

select
    b.account_id,
    b.balance_pence - coalesce(sum(t.amount_pence), 0) as opening_balance_pence
from {{ ref('gold_daily_balance') }} as b
join first_day using (account_id, day)
left join {{ ref('silver_transactions') }} as t
    on t.account_id = b.account_id
    and t.transaction_date = b.day
    and not t.is_declined
group by b.account_id, b.balance_pence
having opening_balance_pence != 0
