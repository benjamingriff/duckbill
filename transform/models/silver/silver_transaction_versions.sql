{{ config(materialized='view') }}

-- Every observation of every transaction, one row per (transaction, fetch).
-- Pending payments are seen several times as they settle; silver_transactions
-- keeps the latest observation.

with envelopes as (
    select run_id, fetched_at, payload
    from {{ raw_envelopes('transactions') }}
),

items as (
    select
        run_id,
        fetched_at,
        unnest(json_extract(payload, '$.transactions[*]')) as tx
    from envelopes
)

select
    tx ->> 'id'                                         as transaction_id,
    tx ->> 'account_id'                                 as account_id,
    run_id,
    fetched_at,
    (tx ->> 'created')::timestamptz                     as created_at,
    nullif(tx ->> 'settled', '')::timestamptz           as settled_at,
    nullif(tx ->> 'updated', '')::timestamptz           as updated_at,
    (tx ->> 'amount')::bigint                           as amount_pence,
    tx ->> 'currency'                                   as currency,
    (tx ->> 'local_amount')::bigint                     as local_amount_minor,
    tx ->> 'local_currency'                             as local_currency,
    tx ->> 'description'                                as description,
    tx ->> 'category'                                   as monzo_category,
    tx ->> 'scheme'                                     as scheme,
    coalesce((tx ->> 'is_load')::boolean, false)        as is_load,
    nullif(tx ->> 'decline_reason', '')                 as decline_reason,
    (tx ->> 'include_in_spending')::boolean             as include_in_spending,
    coalesce((tx ->> 'amount_is_pending')::boolean, false) as amount_is_pending,
    tx -> 'metadata' ->> 'pot_id'                       as pot_id,
    nullif(tx ->> 'notes', '')                          as notes,
    -- `merchant` is an object when requested with expand[]=merchant, else an id.
    case json_type(tx -> 'merchant')
        when 'OBJECT' then tx -> 'merchant' ->> 'id'
        when 'VARCHAR' then tx ->> 'merchant'
    end                                                 as merchant_id,
    tx -> 'merchant' ->> 'group_id'                     as merchant_group_id,
    tx -> 'merchant' ->> 'name'                         as merchant_name,
    nullif(tx -> 'merchant' ->> 'emoji', '')            as merchant_emoji,
    nullif(tx -> 'merchant' ->> 'logo', '')             as merchant_logo,
    (tx -> 'merchant' ->> 'online')::boolean            as merchant_online,
    nullif(tx -> 'counterparty' ->> 'name', '')         as counterparty_name,
    tx                                                  as raw_json
from items
