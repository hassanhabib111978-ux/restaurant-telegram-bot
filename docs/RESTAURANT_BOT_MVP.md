# Restaurant Bot — Integrated MVP

## Goal
Build the first complete restaurant ordering product before building the generic bot factory.

## Customer journey
1. Start / welcome
2. Browse categories
3. View product image, description and price
4. Select options/add-ons when available
5. Add to cart
6. Review/edit cart
7. Choose delivery or pickup
8. Provide phone and address/location when delivery is selected
9. Choose cash or online payment
10. Confirm order
11. Receive order number
12. Receive status updates
13. View previous orders and reorder

## Restaurant journey
1. Receive new order
2. Accept or reject
3. Mark preparing
4. Mark ready
5. Assign/mark delivery when applicable
6. Mark delivered or cancelled
7. View order history

## Admin data
- Restaurant profile
- Categories
- Products
- Product images
- Options and add-ons
- Delivery zones and fees
- Opening hours / ordering availability
- Payment methods
- Staff roles
- Order settings
- Invoice settings

## Implementation rule
Keep the first version small and reliable. Reuse one order engine for Telegram, WhatsApp and Web. Do not build provider-specific logic into the order domain.

## Future extraction
After the restaurant MVP is working end-to-end, extract reusable primitives into the future Bot Factory: tenant, customer, conversation, catalog, flow, cart, order, payment adapter, channel adapter and notification adapter.
