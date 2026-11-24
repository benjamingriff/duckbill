-- Payments to your own accounts elsewhere move money, they don't spend or
-- earn it, whatever Monzo's include_in_spending says.

select transaction_id
from {{ ref('gold_effective_transactions') }}
where is_to_self and (counts_as_spending or income_pence != 0)
