# Restaurant Bot Platform

A reusable multi-channel ordering platform whose first commercial template is the restaurant system.

## Product principle: minimum customer effort
The buyer should never need to understand the technical architecture. The platform hides technical complexity and turns onboarding into a short guided setup.

### Fast connection flow
1. Create restaurant workspace.
2. Enter restaurant name, logo, contact details and basic settings.
3. Import or enter the menu and product images.
4. Choose delivery/pickup and payment methods.
5. Connect the desired channels through guided connection buttons.
6. Run an automatic end-to-end test.
7. Activate the restaurant.

The target is a few clear steps, with each step showing only the information required from the restaurant owner. Technical credentials, webhooks and provider configuration stay behind the platform and are stored as secure environment/secret values. The owner should never be asked to paste tokens into GitHub or chat.

## Multi-channel architecture
One shared ordering engine powers:
- WhatsApp — primary Gulf/Arab channel
- Telegram — secondary channel
- Web ordering link — browser channel

Channels are adapters over the same backend, not separate ordering systems.

## Future Bot Builder nucleus
The platform is intentionally designed as a future bot-building SaaS. The reusable core will support:
- tenants/restaurants with strict data isolation
- customers and conversations
- menus, products, images and services
- buttons, menus and guided flows
- carts, orders and order status
- delivery, pickup and customer location
- payment-provider abstraction
- notifications and webhooks
- admin, cashier and kitchen workflows
- Arabic/RTL first with regional localization
- configurable channels and provider adapters

Future business templates can reuse the same engine: restaurant, store, salon, hotel, clinic, bookings, services and other workflows without rebuilding the core.

## Integration principle
Every external integration must have a **quick-connect adapter**:
- show the customer the minimum required steps;
- keep provider-specific details out of the main product UI;
- validate the connection automatically;
- provide a visible connection status;
- provide a test action before activation;
- allow reconnect/disconnect without rebuilding the restaurant;
- keep secrets outside source control.

The technical architecture must support adding new providers without changing the ordering engine.

## Security
Never commit `.env`, access tokens, API keys, webhook secrets or payment secrets. Store secrets in secure deployment/Supabase secret settings. Restaurant credentials must remain isolated per tenant.

## Commercial model
The master platform is built once. Each new restaurant should be primarily a configuration, connection and activation operation rather than a new software project. Channel/provider operating costs are activated only when a restaurant actually uses the relevant service.

## Current state
Foundation implementation is being built first. Provider-specific payment and delivery integrations remain configurable until the exact provider/API is selected and verified.
