# Restaurant Telegram Bot

Standalone Telegram ordering system for a restaurant.

## Initial architecture
- Telegram customer bot
- Product categories and product photos
- Cart and checkout
- Customer profile and delivery address/location
- Order lifecycle and admin notifications
- Payment provider abstraction (no provider secret hard-coded)
- Supabase database/storage ready
- Webhook-ready production runtime

## Security
Never commit `.env` or the Telegram bot token. Store secrets in the deployment platform's secret/environment settings.

## Current state
Foundation implementation is being built first. Payment gateway and delivery provider remain configurable until the exact provider/API is selected.
