-- Latest known state of each account.

with items as (
    select
        fetched_at,
        unnest(json_extract(payload, '$.accounts[*]')) as account
    from {{ raw_envelopes('accounts') }}
)

select
    account ->> 'id'                              as account_id,
    account ->> 'type'                            as account_type,
    account ->> 'description'                     as description,
    account ->> 'currency'                        as currency,
    (account ->> 'created')::timestamptz          as created_at,
    coalesce((account ->> 'closed')::boolean, false) as is_closed,
    fetched_at                                    as last_seen_at
from items
qualify row_number() over (partition by account ->> 'id' order by fetched_at desc) = 1
