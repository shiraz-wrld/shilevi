# Delivery coordinates, pickup points and proximity matching

Migration: [0042_delivery_coordinates_proximity_matching.sql](supabase/migrations/0042_delivery_coordinates_proximity_matching.sql)
(applies after 0041; neither is assumed to exist on hosted Supabase until you run it).

## The rule this stage is built on

A coordinate in Shilevi is a fact someone stated, never a guess:

| Stored value | Meaning |
|---|---|
| `pickup_point_source = 'none'` | No exact collection point exists. Riders are matched by declared routes and service areas. |
| `'seller_pin'` | The seller confirmed this exact spot through `set_my_pickup_point()` / `set_delivery_pickup_point()`. |
| `dropoff_point_source = 'customer_pin'` | The customer placed and confirmed this exact spot at checkout or from the order page. |
| `'staff_pin'` | An authorized admin or delivery manager confirmed the point. |
| `'geocoder'` | Reserved for an address resolved by a configured provider; the value is only written after a human confirms the pin. |

Historical deliveries keep `'none'` and stay valid. Nothing back-fills a point from a county, an
address string or a listing's business profile.

## What is written where

- `deliveries.pickup_lat/lng`, `pickup_accuracy_m`, `pickup_landmark`, `pickup_point_source`,
  `pickup_point_confirmed_at`
- `deliveries.dropoff_lat/lng`, `dropoff_accuracy_m`, `dropoff_landmark`, `dropoff_point_source`,
  `dropoff_point_confirmed_at`
- `provider_pickup_points` — one saved point per provider, used to pre-fill a new shipment through
  the `deliveries_prefill_pickup_point` trigger.

Constraints make a half-point impossible: `(lat is null) = (lng is null)`, latitude `-90..90`,
longitude `-180..180`.

## Who may write what

| Function | Caller | Window |
|---|---|---|
| `set_my_pickup_point(lat, lng, accuracy, landmark, label)` | an approved seller/service/transport provider, or the owner of a listing | any time |
| `set_delivery_pickup_point(delivery_id, …)` | the seller who owns an item on the order, or delivery staff | `requested`, `assigned`, `to_pickup` |
| `set_delivery_destination(order_id, …)` | the order's own customer, or the owner | `requested`, `assigned`, `to_pickup` |

Both write functions refuse anyone else with `42501`, and refuse a collected parcel with `22023`.
No pricing, fee, commission or ledger column is touched by either function.

## Matching

`match_delivery_candidates()` keeps every eligibility gate from 0029 — approved application,
approved and active vehicle, current documents, approved fleet, vehicle class, weight and dimension
fit, declared route or service area — and adds two ordering signals:

1. `position_fresh` — a position reported within ten minutes. Fresh candidates are always ordered
   before candidates with no fresh fix.
2. `rider_distance_km` — great-circle distance from the rider's fresh fix to the delivery's pickup
   point. Ties break on the existing `rank_score`.

A stale position yields **no** distance (`null`) and sorts last; it is never presented as current.
Distance can only order riders who already passed every eligibility rule, and no client-supplied
value participates: the input is the delivery id, and the pickup point comes from the database.

`reason.distance_basis` is always `straight_line`. Road distance and ETA require a routing provider
and are not computed.

## Geocoding (optional)

`POST /api/geocode { query }` requires a signed-in session and a same-origin request.

- `GEOCODE_PROVIDER=nominatim` + `GEOCODE_CONTACT` (its usage policy requires a contact),
  optional `GEOCODE_BASE_URL`
- `GEOCODE_PROVIDER=mapbox` + `MAPBOX_TOKEN`
- `GEOCODE_PROVIDER=google` + `GOOGLE_MAPS_API_KEY`

Unconfigured → `503` with a message that says address lookup is unavailable. Unresolved address →
`404`, never a nearby substitute. The provider credential is read only in this server route and is
never returned to the browser. The picker always shows the resolved point and tells the customer to
correct it by tapping the map.

## Customer experience

- **Checkout** (`/checkout`): an optional "Exact destination on the map" block with a click-to-pin
  map, an explicit "Use my current location" button, a landmark field and an address lookup. If the
  pin cannot be saved server-side the flow stops before payment and links to the order.
- **Order page** (`/account/orders/[id]`): the stored point, its source and directions, an
  "Adjust destination" control while the parcel is not yet collected, and the live tracking card.
- **Seller** (`/provider/orders`): a saved collection point plus a per-order confirmation, both with
  the same picker.
- **Rider** (`/rider/jobs/[id]`, `/rider/rides`): the route map from `delivery_tracking()`, which
  only exists for a participant in a live window.

## Limits you must not paper over

- Distance is straight-line, not road distance. There is no ETA.
- Live positions refresh through a 20-second poll; there is no realtime stream.
- Matching is still triggered by staff/`delivery.manage` (`offer_delivery_to_candidates`); there is
  no automatic dispatcher loop yet.
- No routing/matrix provider is configured, so "rider → pickup" and "pickup → destination" legs are
  shown as markers and a straight-line figure only.
- Device geolocation, the checkout pin and the rider map have not been exercised on a real phone.
