import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

export async function getCategories() {
  const { data, error } = await supabase
    .from('menu_categories_v2')
    .select('*')
    .eq('restaurant_id', config.restaurantId)
    .eq('active', true)
    .order('sort_order');
  if (error) throw error;
  return data || [];
}

export async function getProducts(categoryId) {
  let query = supabase
    .from('menu_products_v2')
    .select('*')
    .eq('restaurant_id', config.restaurantId)
    .eq('active', true)
    .order('sort_order');
  if (categoryId) query = query.eq('category_id', categoryId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getProduct(productId) {
  const { data, error } = await supabase
    .from('menu_products_v2')
    .select('*')
    .eq('restaurant_id', config.restaurantId)
    .eq('id', productId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProductOptions(productId) {
  const { data, error } = await supabase
    .from('product_options')
    .select('*')
    .eq('restaurant_id', config.restaurantId)
    .eq('product_id', productId)
    .eq('active', true)
    .order('sort_order');
  if (error) throw error;
  return data || [];
}

export async function getProductOption(optionId) {
  const { data, error } = await supabase
    .from('product_options')
    .select('*')
    .eq('restaurant_id', config.restaurantId)
    .eq('id', optionId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertCustomer(telegramUser, extra = {}) {
  const payload = {
    restaurant_id: config.restaurantId,
    channel: 'telegram',
    external_user_id: String(telegramUser.id),
    name: [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') || null,
    phone: extra.phone || null,
    default_address: extra.address || null,
    default_latitude: extra.latitude ?? null,
    default_longitude: extra.longitude ?? null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('customers_v2')
    .upsert(payload, { onConflict: 'restaurant_id,channel,external_user_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listCustomerOrders(customerId) {
  const { data, error } = await supabase
    .from('orders_v2')
    .select('id,status,delivery_type,payment_method,payment_status,total,currency,created_at')
    .eq('restaurant_id', config.restaurantId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data || [];
}

export async function createOrder({ customerId, items, deliveryType, address, latitude, longitude, deliveryZoneId, paymentMethod, subtotal, tax, deliveryFee, total }) {
  const { data: order, error } = await supabase.from('orders_v2').insert({
    restaurant_id: config.restaurantId,
    customer_id: customerId,
    channel: 'telegram',
    status: 'pending',
    delivery_type: deliveryType,
    delivery_zone_id: deliveryZoneId || null,
    delivery_address: address || null,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    payment_method: paymentMethod,
    payment_status: paymentMethod === 'cash' ? 'pending' : 'pending',
    subtotal,
    tax_amount: tax,
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
    options_json: item.options || [],
    line_total: item.lineTotal ?? (item.product.price * item.quantity)
  }));
  const { error: itemError } = await supabase.from('order_items_v2').insert(rows);
  if (itemError) throw itemError;
  return order;
}
