{{ config(materialized='view') }}

-- Every calendar month from the first transaction to the current month, so
-- months with no activity still appear as zero.

select cast(month as date) as month
from range(
    (select date_trunc('month', min(created_at_local)) from {{ ref('silver_transactions') }}),
    date_trunc('month', {{ to_local('now()') }}) + interval 1 month,
    interval 1 month
) as months(month)
