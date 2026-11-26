-- Each open account's balance as Monzo reported it at the last sync, with
-- Monzo's own total (the account plus every pot). The dashboard sets that
-- total against the account and the pots we hold, so a pot the data misses
-- shows up as a difference.

select
    s.account_id,
    s.balance_pence,
    s.total_balance_pence as monzo_total_pence,
    s.fetched_at          as synced_at
from {{ ref('silver_balance_snapshots') }} as s
join {{ ref('silver_accounts') }} as a using (account_id)
where not a.is_closed
qualify row_number() over (partition by s.account_id order by s.fetched_at desc) = 1
