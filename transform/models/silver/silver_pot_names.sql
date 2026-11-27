-- Every pot ever seen in any pots fetch, with its latest name and whether it
-- is closed. Unlike silver_pots (the latest fetch only), this reads every
-- fetch, so a pot keeps its name even if Monzo stops listing it. Monzo lists
-- deleted pots with deleted: true, so closed pots are named here too.
-- silver_transactions uses it to name pot transfers.

with items as (
    select
        fetched_at,
        unnest(json_extract(payload, '$.pots[*]')) as pot
    from {{ raw_envelopes('pots') }}
)

select
    pot ->> 'id'                                                           as pot_id,
    arg_max(pot ->> 'name', fetched_at)                                    as pot_name,
    arg_max(coalesce((pot ->> 'deleted')::boolean, false), fetched_at)     as is_deleted
from items
group by 1
