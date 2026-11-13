-- Pots as of the most recent pots fetch for each account. The latest
-- response is chosen before unnesting, so a response with no pots (all
-- closed) correctly yields none rather than falling back to older data.

with envelopes as (
    select
        params ->> 'current_account_id' as account_id,
        fetched_at,
        payload
    from {{ raw_envelopes('pots') }}
    qualify row_number() over (partition by account_id order by fetched_at desc) = 1
),

items as (
    select
        account_id,
        fetched_at,
        unnest(json_extract(payload, '$.pots[*]')) as pot
    from envelopes
)

select
    pot ->> 'id'                                  as pot_id,
    account_id,
    pot ->> 'name'                                as pot_name,
    (pot ->> 'balance')::bigint                   as balance_pence,
    pot ->> 'currency'                            as currency,
    (pot ->> 'created')::timestamptz              as created_at,
    coalesce((pot ->> 'deleted')::boolean, false) as is_deleted,
    fetched_at                                    as last_seen_at
from items
