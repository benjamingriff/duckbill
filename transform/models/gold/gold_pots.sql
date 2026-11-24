-- Open pots as they stand now, with their goal where one is set. Savings pots
-- (Monzo's interest-paying ones) have a type other than default. History is
-- in gold_daily_pot_balance.

select
    pot_id,
    account_id,
    pot_name,
    pot_type,
    coalesce(pot_type, 'default') <> 'default' as is_savings,
    is_bills_pot,
    balance_pence,
    goal_pence
from {{ ref('silver_pots') }}
where not is_deleted
order by balance_pence desc
