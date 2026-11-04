select customer_id, cast(signed_up_at as date) as signed_up_at, region, tier,
  case when tier = 'gold' then 'active' else 'dormant' end as status
from {{ ref('raw_customers') }}
