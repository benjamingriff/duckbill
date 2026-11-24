-- Every settled or pending transaction (declines aside) with what it counts
-- as for you: spend, income or neither. Every gold spending and income model
-- is built on this one, so Overview, Transactions and Insights always agree.
--
-- Phase 1: spending is silver's, minus transfers to yourself (Monzo counts
-- payments to your own accounts elsewhere as spending). Splits and
-- exclusions will change spend_pence here, not in the models downstream.
-- Income is split into salary (matched by the income_sources seed) and other.

with tx as (
    select
        t.*,
        not t.is_to_self and t.counts_as_spending           as counts,
        case when t.is_to_self then 0 else t.income_pence end as income
    from {{ ref('silver_transactions') }} as t
    where not t.is_declined
),

matched as (
    select
        tx.*,
        (
            select any_value(s.kind)
            from {{ ref('income_sources') }} as s
            where lower(s.value) = lower(case s.match_on
                when 'merchant_id' then tx.merchant_id
                when 'merchant_name' then tx.merchant_name
                when 'counterparty_name' then tx.counterparty_name
                when 'description' then tx.description
            end)
        ) as source_kind
    from tx
)

select
    t.transaction_id,
    t.account_id,
    t.created_at_local,
    t.transaction_date,
    t.transaction_month,
    isodow(t.transaction_date)                           as weekday,
    {{ season('t.transaction_date') }}                  as season,
    t.payee_key,
    t.payee_name,
    t.merchant_emoji,
    t.merchant_city,
    t.merchant_country,
    t.description,
    t.notes,
    t.scheme,
    t.amount_pence,
    t.local_amount_minor,
    t.local_currency,
    t.is_pending,
    t.is_pot_transfer,
    t.is_to_self,
    t.counts                                             as counts_as_spending,
    case when t.counts then -t.amount_pence else 0 end   as spend_pence,
    t.income                                             as income_pence,
    case
        when t.income > 0 then coalesce(t.source_kind, 'other')
    end                                                  as income_kind,
    c.category,
    c.category_label,
    k.colour                                             as category_colour,
    k.category_group,
    coalesce(t.direct_debit_mandate_id, t.standing_order_series_id, t.subscription_id)
                                                         as recurring_key,
    case
        when t.direct_debit_mandate_id is not null then 'direct_debit'
        when t.standing_order_series_id is not null then 'standing_order'
        when t.subscription_id is not null then 'subscription'
    end                                                  as recurring_kind,
    t.trip_id,
    t.mcc,
    -- Food at home vs out. Merchant code 5814 (fast food) is takeaway and
    -- grab-and-go; restaurants (5812) and bars (5813) are eating out.
    case
        when c.category = 'groceries' then 'eating_in'
        when c.category = 'eating_out' and t.mcc = '5814' then 'takeaway'
        when c.category = 'eating_out' then 'eating_out'
    end                                                  as food_kind,
    t.bill_splitting_id,
    t.tab_id
from matched as t
join {{ ref('enrich_transaction_categories') }} as c using (transaction_id)
join {{ ref('enrich_categories') }} as k on k.category = c.category
