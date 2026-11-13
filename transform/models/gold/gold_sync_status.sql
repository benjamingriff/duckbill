-- Freshness and coverage, shown in the dashboard header.

select
    -- Every successful sync records a balance, even when no transactions came back.
    (select max(fetched_at) from {{ ref('silver_balance_snapshots') }})    as last_synced_at,
    (select min(transaction_date) from {{ ref('silver_transactions') }})   as first_transaction_date,
    (select max(transaction_date) from {{ ref('silver_transactions') }})   as last_transaction_date,
    (select count(*) from {{ ref('silver_transactions') }})                as transaction_count,
    (select count(*) from {{ ref('silver_transactions') }} where is_pending) as pending_count
