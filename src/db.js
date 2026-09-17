import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

export async function getCategories() {
  const { data, error } = await supabase.from('menu_categories').select('*').eq('is_active', true).order('sort_order');
  if (error) throw error;
  return data || [];
}

export async function getProducts(categoryId) {
  let query = supabase.from('menu_products').select('*').eq('is_active', true).order('sort_order');
  if (categoryId) query = query.eq('category_id', categoryId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function upsertCustomer(telegramUser) {
  const payload = {
    telegram_user_id: telegramUser.id,
    username: telegramUser.username || null,
    first_name: telegramUser.first_name || null,
    last_name: telegramUser.last_name || null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase.from('customers').upsert(payload, { onConflict: 'telegram_user_id' }).select().single();
  if (error) throw error;
  return data;
}

export async function createOrder({ customerId, items, deliveryType, address, latitude, longitude, paymentMethod, subtotal, deliveryFee, total }) {
  const { data: order, error } = await supabase.from('orders').insert({
    customer_id: customerId,
    status: 'pending',
    delivery_type: deliveryType,
    delivery_address: address || null,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    payment_method: paymentMethod,
    payment_status: 'pending',
    subtotal,
    delivery_fee: deliveryFee,
    total,
    currency: config.currency
  }).select().single();
  if (error) throw error;

  const rows = items.map(item => ({
    order_id: order.id,
    product_id: item.product.id,
    product_name: item.product.name,
    unit_price: item.product.price,
    quantity: item.quantity,
    line_total: item.product.price * item.quantity
  }));
  const { error: itemError } = await supabase.from('order_items').insert(rows);
  if (itemError) throw itemError;
  return order;
}
