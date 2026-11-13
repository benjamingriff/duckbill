-- Every balance reading taken during a sync. The API has no balance history,
-- so these snapshots (plus reconstruction in gold) are the only source of it.

select
    params ->> 'account_id'                       as account_id,
    fetched_at,
    cast({{ to_local('fetched_at') }} as date)    as snapshot_date,
    (payload ->> 'balance')::bigint               as balance_pence,
    (payload ->> 'total_balance')::bigint         as total_balance_pence,
    payload ->> 'currency'                        as currency,
    (payload ->> 'spend_today')::bigint           as spend_today_pence
from {{ raw_envelopes('balance') }}
