select customer_id, cast(signed_up_at as date) as signed_up_at, region, tier
from {{ ref('raw_customers') }}
