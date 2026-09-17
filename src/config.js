function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  botToken: process.env.BOT_TOKEN || '',
  restaurantId: process.env.RESTAURANT_ID || '',
  restaurantName: process.env.RESTAURANT_NAME || 'مطعمنا',
  currency: process.env.CURRENCY || 'AED',
  countryCode: process.env.COUNTRY_CODE || 'AE',
  adminIds: (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(v => v.trim()).filter(Boolean),
  port: Number(process.env.PORT || 3000),
  webhookDomain: process.env.WEBHOOK_DOMAIN || '',
  webhookPath: process.env.WEBHOOK_PATH || '/telegram/webhook',
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  deliveryEnabled: process.env.DELIVERY_ENABLED !== 'false',
  defaultDeliveryFee: Number(process.env.DELIVERY_FEE || 0),
  paymentProvider: process.env.PAYMENT_PROVIDER || 'manual',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
};

export function validateConfig() {
  required('BOT_TOKEN');
  required('SUPABASE_URL');
  required('SUPABASE_SERVICE_ROLE_KEY');
  required('RESTAURANT_ID');
}
