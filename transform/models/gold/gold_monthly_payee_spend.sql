-- Spending per month per merchant/payee, for "top merchants" views.

select
    transaction_month                 as month,
    payee_key,
    any_value(payee_name)             as payee_name,
    any_value(merchant_emoji)         as emoji,
    mode(category_label)              as category_label,
    sum(spend_pence)                  as spend_pence,
    count(*)                          as transaction_count
from {{ ref('gold_effective_transactions') }}
where counts_as_spending
group by transaction_month, payee_key
