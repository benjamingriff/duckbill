-- Transactions that count towards spending, with their category. Base for
-- the other gold spending models and for drill-downs.

select
    t.transaction_id,
    t.account_id,
    t.created_at_local,
    t.transaction_date,
    t.transaction_month,
    t.payee_key,
    t.payee_name,
    t.merchant_emoji,
    t.description,
    t.spend_pence,
    t.local_amount_minor,
    t.local_currency,
    t.is_pending,
    c.category,
    c.category_label
from {{ ref('silver_transactions') }} as t
join {{ ref('enrich_transaction_categories') }} as c using (transaction_id)
where t.counts_as_spending
