select order_id, customer_id, cast(ordered_at as date) as ordered_at, status, channel, amount, discount
from {{ ref('raw_orders') }}
