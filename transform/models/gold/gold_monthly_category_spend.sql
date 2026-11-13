-- Spending per month per category (refunds net off within their category).

select
    transaction_month as month,
    category,
    category_label,
    sum(spend_pence)  as spend_pence,
    count(*)          as transaction_count
from {{ ref('gold_spending_transactions') }}
group by all
order by month, spend_pence desc
