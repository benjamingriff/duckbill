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
    -- A payment the bills pot made directly: the money leaves that pot.
    tx -> 'metadata' ->> 'bills_pot_id'                 as bills_pot_id,
    -- Monzo's own detection: subscriptions, direct debit mandates, standing
    -- order series, trips, split bills and shared tabs. All optional.
    tx -> 'metadata' ->> 'subscription_id'              as subscription_id,
    tx -> 'metadata' ->> 'bacs_direct_debit_instruction_id' as direct_debit_mandate_id,
    tx -> 'metadata' ->> 'series_id'                    as standing_order_series_id,
    tx -> 'metadata' ->> 'trip_id'                      as trip_id,
    tx -> 'metadata' ->> 'mcc'                          as mcc,
    tx -> 'metadata' ->> 'bill_splitting_id'            as bill_splitting_id,
    tx -> 'metadata' ->> 'tab_id'                       as tab_id,
    coalesce(tx -> 'metadata' ->> 'p2p_is_to_self' = 'true', false) as is_to_self,
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
    nullif(tx -> 'merchant' -> 'address' ->> 'city', '') as merchant_city,
    nullif(tx -> 'merchant' -> 'address' ->> 'country', '') as merchant_country,
    nullif(tx -> 'counterparty' ->> 'name', '')         as counterparty_name,
    tx                                                  as raw_json
from items
