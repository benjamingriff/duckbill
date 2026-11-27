-- One row per transaction: the most recent observation, typed and flagged.
--
-- "Spending" follows Monzo's own include_in_spending flag where present (it
-- already excludes salary, top-ups and transfers you've marked as excluded),
-- and never counts declines or moves between the account and its pots.
-- Refunds count as negative spending. Without the flag, outgoing payments and
-- money back from a merchant (refunds) count; other incoming money is income.
--
-- Monzo describes a pot transfer by the pot's id, so those rows take the
-- pot's latest name from silver_pot_names instead, or "Unknown pot" for a
-- pot never seen in a pots fetch. Their payee is the pot itself.

with latest as (
    select *
    from {{ ref('silver_transaction_versions') }}
    qualify row_number() over (
        partition by transaction_id
        order by fetched_at desc, coalesce(updated_at, created_at) desc
    ) = 1
),

flagged as (
    select
        l.*,
        {{ to_local('l.created_at') }}                       as created_at_local,
        l.decline_reason is not null                         as is_declined,
        l.scheme = 'uk_retail_pot' or l.pot_id is not null   as is_pot_transfer,
        p.pot_name,
        coalesce(p.is_deleted, false)                        as pot_is_closed
    from latest as l
    left join {{ ref('silver_pot_names') }} as p on p.pot_id = l.pot_id
)

select
    transaction_id,
    account_id,
    created_at,
    created_at_local,
    cast(created_at_local as date)                           as transaction_date,
    cast(date_trunc('month', created_at_local) as date)      as transaction_month,
    settled_at,
    updated_at,
    amount_pence,
    currency,
    local_amount_minor,
    local_currency,
    description,
    monzo_category,
    scheme,
    merchant_id,
    merchant_group_id,
    merchant_name,
    merchant_emoji,
    merchant_logo,
    merchant_online,
    merchant_city,
    merchant_country,
    counterparty_name,
    notes,
    pot_id,
    pot_name,
    pot_is_closed,
    bills_pot_id,
    subscription_id,
    direct_debit_mandate_id,
    standing_order_series_id,
    trip_id,
    mcc,
    bill_splitting_id,
    tab_id,
    is_to_self,
    decline_reason,
    is_load,
    include_in_spending,
    is_declined,
    is_pot_transfer,
    settled_at is null and not is_declined                   as is_pending,
    coalesce(pot_id, merchant_group_id, merchant_id, counterparty_name, description)
                                                             as payee_key,
    case
        when is_pot_transfer then coalesce(nullif(pot_name, ''), 'Unknown pot')
        else coalesce(merchant_name, counterparty_name, description)
    end                                                      as payee_name,
    counts_as_spending,
    case when counts_as_spending then -amount_pence else 0 end as spend_pence,
    case
        when not is_declined and not is_pot_transfer and not is_load
            and not counts_as_spending and amount_pence > 0
        then amount_pence else 0
    end                                                      as income_pence,
    fetched_at                                               as last_seen_at,
    raw_json
from (
    select
        *,
        not is_declined
            and not is_pot_transfer
            and coalesce(
                include_in_spending,
                not is_load and (amount_pence < 0 or merchant_id is not null)
            )
            as counts_as_spending
    from flagged
)
