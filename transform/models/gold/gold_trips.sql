-- Trips Monzo detected (metadata.trip_id), read-only. Named after the city
-- with the most payments; spend by category for the breakdown bar.

with trip_tx as (
    select *
    from {{ ref('gold_effective_transactions') }}
    where trip_id is not null and counts_as_spending
)

select
    trip_id,
    mode(merchant_city)                               as city,
    mode(merchant_country)                            as country,
    min(transaction_date)                             as start_date,
    max(transaction_date)                             as end_date,
    max(transaction_date) - min(transaction_date)     as nights,
    sum(spend_pence)                                  as spend_pence,
    count(*)                                          as transaction_count,
    mode(local_currency)                              as currency,
    arg_min(season, transaction_date)                 as season
from trip_tx
group by trip_id
order by start_date desc
