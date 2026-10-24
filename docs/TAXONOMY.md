# Shilevi Taxonomy and Permission Model

Working document. This is the catalogue of what can be offered, who may offer it, and how the platform must enforce that separation. It is not a claim that every category is active at launch.

## Structure

```
Division -> Category -> Subcategory -> Listing
                         \-> Activity (permission) -> allowed transaction types
```

- **Division**: one of four public pillars (`products`, `services`, `transport_delivery`, `property_places`).
- **Category**: a stable, admin-managed record with a slug and a per-category field schema.
- **Subcategory**: optional narrower grouping (for example `services / hair-beauty / dreadlocks`).
- **Activity**: **not a catalogue level.** It is the permission record that says an account may publish in a category (or its subtree) using specific transaction types. A listing references both its activity and its category, and the server checks the activity, not only the division.
- **Listing**: belongs to exactly one activity and one category.

**Rule:** approval for one activity never grants permission for another. A food seller cannot publish a property listing by changing a request payload.

**Transaction types** (stored on the listing, not inferred from the category):

| Code | Meaning |
|---|---|
| `sale` | one-off purchase of a product |
| `rent` | recurring rental (property, equipment) |
| `short_stay` | nightly/weekly accommodation |
| `booking` | dated service appointment |
| `quote` | request for estimate, then accept |
| `viewing` | property viewing request |
| `delivery` | move goods from A to B |
| `ride` | move a person from A to B |
| `hire` | vehicle hire with or without driver |
| `lease` | commercial or agricultural lease |

A category declares which transaction types it allows. "Rent" is not a division; it is a mode of a product, property, or equipment category.

**Verification tiers** (risk-based, per activity):

| Tier | Requirements | Typical use |
|---|---|---|
| T0 | phone + email verified | buyers |
| T1 | T0 + government ID + selfie | individual sellers, independent service providers |
| T2 | T1 + business registration **or** property ownership/authority evidence | registered retailers, landlords, agents, accommodation operators |
| T3 | T2 + category licence, vehicle, insurance, or professional registration | transport, health, legal, security, agrochemicals, medical supplies |

Documents live in private storage. Access is limited to the verification role, logged, and retained only as long as the policy requires.

---

## A. Products

| # | Category | Representative subcategories | Txn | Verify |
|---|---|---|---|---|
| 1 | `fashion-clothing` | dresses, shirts, trousers, suits, uniforms, traditional wear | sale | T1/T2 |
| 2 | `shoes-footwear` | sneakers, boots, sandals, heels, school shoes | sale | T1/T2 |
| 3 | `bags-accessories` | handbags, backpacks, belts, watches, jewellery, sunglasses | sale | T1/T2 |
| 4 | `hair-hair-products` | wigs, extensions, braids, dreadlocks, hairpieces, hair care | sale | T1/T2 |
| 5 | `beauty-cosmetics` | makeup, skincare, perfume, grooming | sale | T1/T2 |
| 6 | `electronics` | TVs, audio, cameras, headphones | sale | T1/T2 |
| 7 | `phones-accessories` | smartphones, chargers, cases, screen protectors | sale | T1/T2 |
| 8 | `computers-technology` | laptops, desktops, monitors, keyboards, networking, storage | sale | T1/T2 |
| 9 | `home-living` | curtains, carpets, decor, kitchenware, bedding | sale | T1/T2 |
| 10 | `furniture` | beds, sofas, tables, chairs, wardrobes | sale, rent | T1/T2 |
| 11 | `mattresses-bedding` | mattresses, pillows, duvets, sheets | sale | T1/T2 |
| 12 | `kitchen-appliances` | cookers, fridges, blenders, pans, utensils | sale, rent | T1/T2 |
| 13 | `food-groceries` | fresh produce, staples, packaged food, cooking oil | sale | T1/T2 |
| 14 | `meat-fish-poultry` | beef, chicken, fish, eggs | sale | T2/T3 |
| 15 | `bakery-confectionery` | bread, cakes, biscuits, sweets | sale, booking | T2/T3 |
| 16 | `beverages` | water, juice, soda, tea, coffee | sale | T2/T3 |
| 17 | `agriculture-produce` | maize, beans, rice, potatoes, fruit, vegetables (bulk) | sale | T1/T2 |
| 18 | `seeds-fertilizer-agro-inputs` | certified seed, fertilizer, approved pesticides | sale | T3 |
| 19 | `livestock-animal-products` | poultry, goats, cattle, feed, milk, eggs | sale | T2/T3 |
| 20 | `building-materials` | cement, sand, ballast, timber, roofing, tiles, pipes | sale, delivery | T1/T2 |
| 21 | `hardware-tools` | hand tools, power tools, fasteners, plumbing, electrical | sale, rent | T1/T2 |
| 22 | `timber-wood` | planks, poles, firewood, furniture timber | sale, delivery | T1/T2 |
| 23 | `automotive-spares` | parts, tyres, batteries, oils, accessories | sale | T1/T2 |
| 24 | `motorcycles-bicycles` | new/used motorcycles and bicycles, parts, accessories | sale | T1/T2 |
| 25 | `sports-fitness` | balls, gym equipment, sportswear, outdoor gear | sale | T1/T2 |
| 26 | `books-stationery` | textbooks, novels, pens, notebooks, office paper | sale | T1/T2 |
| 27 | `school-office-supplies` | bags, printers, furniture, consumables | sale | T1/T2 |
| 28 | `toys-baby-kids` | toys, clothes, strollers, car seats, school items | sale | T1/T2 |
| 29 | `health-medical-supplies` | eligible devices, first aid, permitted products | sale | T3 |
| 30 | `cleaning-household` | detergents, mops, brooms, bins | sale | T1/T2 |
| 31 | `art-crafts-handmade` | paintings, carvings, beadwork, crafts | sale | T1 |
| 32 | `musical-instruments` | guitars, keyboards, drums, PA, accessories | sale, rent | T1/T2 |
| 33 | `second-hand-refurbished` | used phones, furniture, clothes, appliances | sale | T1/T2 |
| 34 | `industrial-commercial-equipment` | machinery, packaging, POS, safes, tools | sale, rent | T2/T3 |
| 35 | `water-solar-energy` | tanks, pumps, solar panels, inverters, batteries | sale | T2/T3 |
| 36 | `party-event-supplies` | tents, chairs, decor, disposable supplies | sale, rent | T1/T2 |
| 37 | `religious-cultural-goods` | permitted items, traditional clothing, ceremonial goods | sale | T1 |
| 38 | `pet-animal-supplies` | pet food, cages, accessories, approved vet supplies | sale | T2/T3 |
| 39 | `other-products` | admin-created only | per case | per case |

---

## B. Services

| # | Category | Representative subcategories | Txn | Verify |
|---|---|---|---|---|
| 1 | `hair-beauty-services` | washing, braiding, dreadlocks, wig install, makeup, nails, spa | booking | T1 |
| 2 | `barbering` | cuts, shaving, beard grooming | booking | T1 |
| 3 | `home-cleaning` | house, office, laundry, ironing, deep clean | booking, quote | T1 |
| 4 | `plumbing` | pipes, taps, drainage, water heaters, boreholes | quote, booking | T1/T2 |
| 5 | `electrical` | wiring, repairs, installations, solar | quote, booking | T1/T2 |
| 6 | `construction-masonry` | building, plastering, tiling, renovations | quote | T2 |
| 7 | `painting-decorating` | interior/exterior, wallpaper, gypsum | quote | T1/T2 |
| 8 | `carpentry-joinery` | furniture, doors, cabinets, upholstery | quote, booking | T1/T2 |
| 9 | `roofing-ceilings` | repairs, installation, gutters | quote | T1/T2 |
| 10 | `welding-metalwork` | gates, grills, balustrades, fabrication | quote | T1/T2 |
| 11 | `glass-aluminium` | windows, doors, partitions | quote | T1/T2 |
| 12 | `gardening-landscaping` | lawn, hedges, landscaping, tree cutting | quote, booking | T1 |
| 13 | `pest-control-fumigation` | inspection, treatment, termites | quote | T3 |
| 14 | `appliance-repair` | fridges, cookers, washing machines, AC | quote, booking | T1 |
| 15 | `phone-computer-repair` | screens, batteries, software, data recovery | quote, booking | T1 |
| 16 | `automotive-services` | repair, servicing, diagnostics, car wash, detailing | quote, booking | T1/T2 |
| 17 | `motorcycle-bicycle-repair` | servicing, parts fitting | quote, booking | T1 |
| 18 | `photography` | events, portraits, product, commercial | booking, quote | T1 |
| 19 | `videography` | events, adverts, music videos, editing | booking, quote | T1 |
| 20 | `djs-mcs-entertainment` | DJ, MC, live band, performers | booking | T1 |
| 21 | `event-planning-decor` | planning, decor, tents, lighting | quote, booking | T2 |
| 22 | `catering-food-service` | event catering, private chef, waiters | quote, booking | T2/T3 |
| 23 | `education-tutoring` | school subjects, exam prep, language, music | booking | T1/T2 |
| 24 | `training-coaching` | fitness, sports, professional, driving school | booking | T1/T2 |
| 25 | `it-technology` | software, support, networking, CCTV, web | quote, booking | T1/T2 |
| 26 | `graphic-digital-design` | logos, branding, social content | quote | T1 |
| 27 | `digital-marketing` | social media, ads, SEO, content | quote | T1/T2 |
| 28 | `writing-translation` | copywriting, editing, translation, transcription | quote | T1 |
| 29 | `professional-business-services` | accounting, bookkeeping, consulting, HR | quote | T2/T3 |
| 30 | `legal-services` | qualified advocates, conveyancing, contracts | quote | T3 |
| 31 | `health-wellness` | clinics, pharmacy, lab, physio, home care | booking | T3 |
| 32 | `personal-care` | makeup, grooming, errands, companionship | booking | T1 |
| 33 | `pet-services` | grooming, boarding, training, vet | booking | T2/T3 |
| 34 | `agricultural-services` | ploughing, planting, harvesting, spraying, vet, AI | quote | T2/T3 |
| 35 | `moving-relocation` | house/office moves, packing, loading | quote | T1/T2 |
| 36 | `delivery-services` | local parcel, business delivery (cross-links to Transport) | delivery | T1 |
| 37 | `laundry-garment-care` | wash, dry, iron, dry clean | booking | T1 |
| 38 | `child-family-services` | childcare, babysitting, tutoring, elder care | booking | T2 |
| 39 | `home-assistance` | errands, cleaning, minor repairs, shopping | booking | T1 |
| 40 | `repairs-maintenance` | general handyman | quote, booking | T1 |
| 41 | `travel-tourism` | tours, guides, travel planning, airport assistance | booking | T2 |
| 42 | `tailoring-fashion-design` | alterations, custom garments | quote | T1 |
| 43 | `printing-signage` | banners, T-shirts, signage, branding | quote | T1 |
| 44 | `security-services` | guards, CCTV monitoring, alarm | quote | T3 |
| 45 | `waste-sanitation` | garbage collection, septic emptying, recycling | quote | T3 |
| 46 | `other-services` | admin-created only | per case | per case |

---

## C. Transport and Delivery

| # | Category | Representative subcategories | Txn | Verify |
|---|---|---|---|---|
| 1 | `motorcycle-delivery` | small parcels, documents | delivery | T3 |
| 2 | `food-delivery` | restaurant meals | delivery | T3 |
| 3 | `grocery-delivery` | supermarket runs | delivery | T3 |
| 4 | `parcel-document-delivery` | same-town and courier parcels | delivery | T3 |
| 5 | `furniture-bulky-delivery` | beds, sofas, appliances | delivery | T3 |
| 6 | `household-moving` | house moves, packing | delivery | T3 |
| 7 | `office-relocation` | equipment, furniture | delivery | T3 |
| 8 | `pickup-hire` | building materials, bulky goods | delivery, hire | T3 |
| 9 | `van-hire` | larger deliveries, business cargo | delivery, hire | T3 |
| 10 | `truck-lorry` | bulk and heavy goods | delivery, hire | T3 |
| 11 | `commercial-freight` | B2B, pallets | delivery | T3 |
| 12 | `agricultural-transport` | produce, inputs, livestock | delivery | T3 |
| 13 | `passenger-rides` | taxi and car hailing | ride | T3 |
| 14 | `motorcycle-passenger` | boda passenger, where permitted | ride | T3 |
| 15 | `tuk-tuk-passenger` | where permitted | ride | T3 |
| 16 | `intercity-transport` | between towns | ride, hire | T3 |
| 17 | `airport-transfers` | pickups and drop-offs | ride, hire | T3 |
| 18 | `vehicle-hire` | self-drive or chauffeur | hire | T3 |
| 19 | `equipment-machinery-transport` | specialized cargo | delivery | T3 |
| 20 | `specialized-logistics` | cold chain, fragile, hazardous | delivery | T3 |
| 21 | `other-transport` | admin-created only | per case | per case |

Delivery and passenger permissions are separate rows. A motorcycle approved for parcels is not approved for passengers. A car approved for rides is not approved for freight.

---

## D. Property and Places

| # | Category | Representative subcategories | Txn | Verify |
|---|---|---|---|---|
| 1 | `bedsitters-single-rooms` | bedsitters, single rooms, shared rooms | rent, viewing | T2 |
| 2 | `apartments-rent` | one-bedroom, two-bedroom, larger | rent, viewing | T2 |
| 3 | `houses-rent` | standalone homes, family houses | rent, viewing | T2 |
| 4 | `houses-sale` | residential sale | sale, viewing | T2 |
| 5 | `land-sale` | residential, agricultural, commercial | sale, viewing | T2 |
| 6 | `commercial-property` | shops, offices, business premises | rent, lease, sale | T2 |
| 7 | `student-accommodation` | hostels, student rooms | rent, short_stay | T2 |
| 8 | `hotels` | hotel rooms | short_stay | T2/T3 |
| 9 | `guesthouses-lodges` | short-stay accommodation | short_stay | T2/T3 |
| 10 | `furnished-short-stay` | furnished apartments | short_stay | T2 |
| 11 | `holiday-homes` | vacation rentals | short_stay | T2 |
| 12 | `warehouses-storage` | warehouses, storage units | rent, lease | T2 |
| 13 | `event-venues` | wedding and party venues | booking | T2 |
| 14 | `meeting-conference-rooms` | meeting and conference facilities | booking | T2 |
| 15 | `workspaces-coworking` | shared offices, coworking | rent, booking | T2 |
| 16 | `shops-market-stalls` | retail spaces and stalls | rent, lease | T2 |
| 17 | `industrial-property` | workshops, factories | rent, lease, sale | T2 |
| 18 | `farms-agricultural-land` | farms and agricultural land | rent, lease, sale | T2 |
| 19 | `parking-vehicle-storage` | parking and vehicle storage | rent | T2 |
| 20 | `other-property` | admin-created only | per case | per case |

Property requires evidence of **ownership or lawful authority** (title, rates bill, lease, management agreement, or written authority). A verified badge is per listing, not only per account.

---

## Restricted and prohibited

Admin-approved and legally reviewed before activation. Not available to self-service listing:

- alcohol and tobacco
- prescription medicines and controlled substances
- weapons, ammunition, explosives
- wildlife and protected species products
- counterfeit or stolen goods
- human remains, organs, and surrogacy/adoption services
- gambling, betting, and financial/investment products
- adult content and sexual services
- hazardous chemicals and explosives precursors
- medical devices requiring licensing
- recruitment fees charged to workers
- any activity requiring a licence the platform has not verified

`other-products`, `other-services`, `other-transport`, and `other-property` exist so the admin team can add a legitimate category without a redesign. They are **not** a user-selectable loophole.

---

## Participants

### Marketplace humans

| Group | Examples | What they do |
|---|---|---|
| Buyer (individual) | household customer | browse, buy, rent, book, request delivery/ride, pay, review |
| Buyer (business) | retailer, restaurant, contractor, office | bulk purchase, procurement, recurring orders, invoices |
| Product seller | individual, shop, wholesaler, manufacturer, farmer, vendor | list products, manage stock and orders, fulfil or request delivery |
| Service provider | individual professional, registered business | list services, quote, accept bookings, complete work |
| Property owner / landlord | individual owner, landowner | list property, prove ownership, manage enquiries and viewings |
| Property agent / manager | agent, management company | list on behalf of an owner with documented authority |
| Accommodation operator | hotel, guesthouse, hostel, host | manage rooms, availability, short stays |
| Equipment rental provider | tools, furniture, event equipment, vehicles | manage availability, deposits, rental terms |
| Transport partner (delivery) | motorcycle, bicycle, car, pickup, van, lorry, freight company | accept delivery jobs, collect, hand over, earn |
| Transport partner (passenger) | taxi, boda, tuk-tuk, shuttle, tour operator | accept rides, complete trips, earn |
| Vehicle hire operator | self-drive and chauffeur hire | manage fleet, availability, handover |

One person may hold several roles. Roles are grants, not account types.

### Staff (capabilities, not job titles)

| Staff role | Key capabilities |
|---|---|
| Super admin | all capabilities, including commission and security settings; dual control for high-risk changes |
| Operations admin | categories, locations, activation, promotions, content |
| Verification officer | review applications and documents, request more information, approve/reject at assigned tiers |
| Support agent | view orders and conversations, open disputes, issue approved goodwill credits |
| Finance officer | reconcile payments, approve refunds within limits, release payouts, export ledger |
| Trust and safety | investigate fraud, suspend accounts, preserve evidence, manage appeals |
| Content moderator | review reported listings, remove prohibited content |
| Marketing | promotions, featured placement, campaign reporting; no access to identity documents |
| Data protection officer | access requests, retention, deletion review, breach process |

### External parties

Payment provider, identity/KYC vendor, maps/geocoding, SMS/email/push, insurance partner, logistics partners, regulators, auditors. These are integrations and legal relationships, not marketplace accounts.

---

## Permission model (database)

The current `provider_applications.activity_type` is division-level. It cannot enforce "approved for food, therefore only food." Migration 0007 checks the division only, so an approved product seller can currently post in any product category.

Add:

```sql
provider_activities (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  application_id uuid not null references provider_applications(id),
  category_id uuid not null references marketplace_categories(id),
  transaction_types text[] not null,
  status text not null check (status in ('pending','approved','suspended','expired')),
  verification_tier smallint not null check (verification_tier between 0 and 3),
  approved_at timestamptz,
  expires_at timestamptz,
  unique (user_id, category_id, application_id)
)
```

And on `listings`:

- `provider_activity_id uuid not null references provider_activities(id)`
- `transaction_type text not null` with a check that it is in the activity's allowed set

Enforcement belongs in both the RLS insert/update policy and the publication trigger:

1. `owner_id = auth.uid()`
2. activity belongs to the same user
3. activity status is `approved`
4. activity category equals `listings.category_id`
5. `listings.transaction_type = any(activity.transaction_types)`
6. category and division are active
7. any category-specific publication checks pass

Hiding a button is not enforcement. A direct PostgREST call must fail.

---

## Commission rules

**Confirmed default: 10% of the defined commission base**, configurable per category and transaction type. The base, payer, and rounding must be stated explicitly for each transaction type; "10%" alone is not a complete rule.

Commission must be configurable, versioned, auditable, and snapshotted onto the order.

```sql
commission_rules (
  id uuid primary key,
  scope_type text check (scope_type in ('global','division','category','activity','vehicle','town')),
  scope_id text,
  basis text check (basis in ('customer_price','provider_earning')),
  calc_type text check (calc_type in ('percent','fixed','tiered')),
  rate_bps integer,
  min_fee_minor bigint,
  max_fee_minor bigint,
  rounding text check (rounding in ('none','nearest_5','nearest_10','ceil_5')),
  payer text check (payer in ('provider','customer','split')),
  effective_from timestamptz not null,
  effective_to timestamptz,
  version integer not null,
  is_active boolean not null default false
)

commission_tiers (
  rule_id uuid references commission_rules(id),
  lower_minor bigint not null,
  upper_minor bigint,
  fixed_minor bigint,
  rate_bps integer,
  primary key (rule_id, lower_minor)
)
```

Boundaries are half-open `[lower, upper)`, must not overlap, and must cover the whole range. Define exactly what happens at KSh 50, 100, 200, and 1,000.

Orders snapshot `commission_rule_id`, `commission_base_minor`, `commission_minor`, `provider_net_minor`, and `customer_fee_minor`. A later rule change never rewrites a completed order.

The examples in the brief (50→5, 100→10, 200→20, 1,000→100, 2,000→200) are all 10%. A percentage rule with rounding to the nearest KSh 5 is simpler and avoids cliffs at boundaries. Use tiers only where a category genuinely needs a different shape.

Fuel and distance are **pricing adjustments**, not commission. Keep a separate `pricing_adjustments` table (per-km, per-trip, fuel surcharge, night surcharge) so changing fuel costs does not require editing commission logic.

Every rule change needs: admin preview/simulation, a maximum-rate guardrail, an audit entry, and a version number. Above a configured threshold, require a second approver.

---

## Category activation

A category existing in the catalogue does not mean it is available everywhere.

```sql
category_activation (
  category_id uuid references marketplace_categories(id),
  location_id uuid references service_locations(id),
  state text check (state in ('unavailable','enquiry_only','limited','active')),
  min_supply integer,
  notes text,
  activated_at timestamptz,
  primary key (category_id, location_id)
)
```

The public catalogue can show every planned category. Search, booking, and checkout only accept `active` or `limited` where the request can actually be fulfilled. `enquiry_only` means the customer can contact providers but cannot pay through the platform yet.

This is how the platform keeps the "everything is here" promise without lying about local supply.
