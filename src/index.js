import http from 'node:http';
import { Telegraf, Markup, session } from 'telegraf';
import { config, validateConfig } from './config.js';
import { getCategories, getProducts, upsertCustomer, createOrder } from './db.js';

validateConfig();
const bot = new Telegraf(config.botToken);
bot.use(session({ defaultSession: () => ({ cart: [], checkout: null }) }));

const money = value => `${Number(value).toLocaleString('ar-AE')} ${config.currency}`;

// Main navigation stays inside the bot message, above Telegram's text input.
function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🍽️ المنيو', 'menu:show'), Markup.button.callback('🛒 السلة', 'cart:show')],
    [Markup.button.callback('📦 طلباتي', 'orders:show'), Markup.button.callback('📍 بيانات التوصيل', 'delivery:show')],
    [Markup.button.callback('ℹ️ المساعدة', 'help:show')]
  ]);
}

async function showCategories(ctx) {
  const categories = await getCategories();
  if (!categories.length) return ctx.reply('المنيو قيد التجهيز حاليًا.', mainMenu());
  return ctx.reply('اختر القسم:', Markup.inlineKeyboard([
    ...categories.map(c => [Markup.button.callback(c.name, `cat:${c.id}`)]),
    [Markup.button.callback('🏠 القائمة الرئيسية', 'menu:home')]
  ]));
}

async function showProducts(ctx, categoryId) {
  const products = await getProducts(categoryId);
  if (!products.length) return ctx.reply('لا توجد منتجات متاحة في هذا القسم حاليًا.', mainMenu());
  for (const p of products) {
    const caption = `<b>${p.name}</b>\n${p.description || ''}\nالسعر: <b>${money(p.price)}</b>`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('➕ أضف للسلة', `add:${p.id}`)],
      [Markup.button.callback('🍽️ الأقسام', 'menu:show'), Markup.button.callback('🛒 السلة', 'cart:show')]
    ]);
    if (p.image_url) await ctx.replyWithPhoto(p.image_url, { caption, parse_mode: 'HTML', ...keyboard });
    else await ctx.reply(caption, { parse_mode: 'HTML', ...keyboard });
  }
}

function cartText(cart) {
  if (!cart.length) return '🛒 السلة فارغة.';
  let total = 0;
  const lines = cart.map((item, i) => {
    const line = item.product.price * item.quantity;
    total += line;
    return `${i + 1}. ${item.product.name} × ${item.quantity} = ${money(line)}`;
  });
  return `🛒 <b>السلة</b>\n\n${lines.join('\n')}\n\nالمجموع: <b>${money(total)}</b>`;
}

async function showCart(ctx) {
  const cart = ctx.session.cart || [];
  if (!cart.length) return ctx.reply(cartText(cart), { parse_mode: 'HTML', ...mainMenu() });
  return ctx.reply(cartText(cart), {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🧹 تفريغ السلة', 'cart:clear')],
      [Markup.button.callback('✅ متابعة الطلب', 'checkout:start')],
      [Markup.button.callback('🍽️ متابعة التسوق', 'menu:show')]
    ])
  });
}

bot.start(async ctx => {
  await upsertCustomer(ctx.from);
  // Remove any legacy Reply Keyboard that may still be persisted in Telegram chats.
  await ctx.reply('تم تحديث واجهة القائمة. 👌', Markup.removeKeyboard());
  await ctx.reply(`أهلًا بك في ${config.restaurantName} 👋\nاختر ما تريد من القائمة.`, mainMenu());
});
bot.command('menu', showCategories);

bot.action('menu:home', async ctx => {
  await ctx.answerCbQuery();
  return ctx.reply(`أهلًا بك في ${config.restaurantName} 👋\nاختر ما تريد من القائمة.`, mainMenu());
});
bot.action('menu:show', async ctx => {
  await ctx.answerCbQuery();
  return showCategories(ctx);
});
bot.action('cart:show', async ctx => {
  await ctx.answerCbQuery();
  return showCart(ctx);
});
bot.action('orders:show', async ctx => {
  await ctx.answerCbQuery();
  return ctx.reply('📦 قسم طلباتي قيد التجهيز، وسنعرض هنا الطلبات السابقة وحالة الطلب الحالي.', mainMenu());
});
bot.action('delivery:show', async ctx => {
  await ctx.answerCbQuery();
  return ctx.reply('📍 بيانات التوصيل تُطلب أثناء إتمام الطلب. يمكنك إدخال عنوانك في خطوة التوصيل.', mainMenu());
});
bot.action('help:show', async ctx => {
  await ctx.answerCbQuery();
  return ctx.reply('ℹ️ اختر المنيو لإضافة المنتجات، ثم السلة لتأكيد الطلب.', mainMenu());
});

async function showCategoriesForText(ctx) {
  return showCategories(ctx);
}

bot.hears('🍽️ المنيو', showCategoriesForText);
bot.hears('🛒 السلة', showCart);
bot.hears('ℹ️ المساعدة', ctx => ctx.reply('اختر المنيو لإضافة المنتجات، ثم السلة لتأكيد الطلب.', mainMenu()));

bot.action(/^cat:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  await showProducts(ctx, ctx.match[1]);
});

bot.action(/^add:(.+)$/, async ctx => {
  await ctx.answerCbQuery('تمت الإضافة إلى السلة');
  const product = await import('./db.js').then(({ getProduct }) => getProduct(ctx.match[1]));
  if (!product) return ctx.reply('تعذر العثور على المنتج.', mainMenu());
  const cart = ctx.session.cart || (ctx.session.cart = []);
  const existing = cart.find(i => String(i.product.id) === String(product.id));
  if (existing) existing.quantity += 1;
  else cart.push({ product, quantity: 1 });
  return ctx.reply(`✅ تمت إضافة ${product.name} إلى السلة.`, mainMenu());
});

bot.action('cart:clear', async ctx => {
  ctx.session.cart = [];
  await ctx.answerCbQuery('تم تفريغ السلة');
  return ctx.editMessageText('🛒 تم تفريغ السلة.', mainMenu());
});

bot.action('checkout:start', async ctx => {
  await ctx.answerCbQuery();
  if (!ctx.session.cart?.length) return ctx.reply('السلة فارغة.', mainMenu());
  ctx.session.checkout = { step: 'delivery_type' };
  return ctx.reply('كيف تريد استلام الطلب؟', Markup.inlineKeyboard([
    [Markup.button.callback('🚚 توصيل', 'checkout:delivery')],
    [Markup.button.callback('🏪 استلام من المطعم', 'checkout:pickup')],
    [Markup.button.callback('🛒 العودة للسلة', 'cart:show')]
  ]));
});

bot.action('checkout:delivery', async ctx => {
  ctx.session.checkout = { step: 'address', deliveryType: 'delivery' };
  await ctx.answerCbQuery();
  return ctx.reply('أرسل عنوان التوصيل كتابةً، ويمكنك لاحقًا إضافة مشاركة الموقع.');
});

bot.action('checkout:pickup', async ctx => {
  ctx.session.checkout = { step: 'payment', deliveryType: 'pickup' };
  await ctx.answerCbQuery();
  return ctx.reply('اختر طريقة الدفع:', Markup.inlineKeyboard([
    [Markup.button.callback('💵 دفع عند الاستلام', 'pay:cash')],
    [Markup.button.callback('💳 دفع إلكتروني', 'pay:online')]
  ]));
});

bot.action('pay:cash', async ctx => finishCheckout(ctx, 'cash'));
bot.action('pay:online', async ctx => {
  await ctx.answerCbQuery();
  return ctx.reply('الدفع الإلكتروني جاهز للربط بمزود الدفع، لكن لن نفعل أي بوابة قبل تحديد المزود وواجهته رسميًا.');
});

bot.on('text', async ctx => {
  const checkout = ctx.session.checkout;
  if (!checkout) return;
  if (checkout.step === 'address') {
    checkout.address = ctx.message.text;
    checkout.step = 'payment';
    return ctx.reply('اختر طريقة الدفع:', Markup.inlineKeyboard([
      [Markup.button.callback('💵 دفع عند الاستلام', 'pay:cash')],
      [Markup.button.callback('💳 دفع إلكتروني', 'pay:online')]
    ]));
  }
});

async function finishCheckout(ctx, paymentMethod) {
  await ctx.answerCbQuery();
  const cart = ctx.session.cart || [];
  if (!cart.length) return ctx.reply('السلة فارغة.', mainMenu());
  const customer = await upsertCustomer(ctx.from);
  const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const deliveryFee = ctx.session.checkout?.deliveryType === 'delivery' ? config.defaultDeliveryFee : 0;
  const order = await createOrder({
    customerId: customer.id,
    items: cart,
    deliveryType: ctx.session.checkout?.deliveryType || 'pickup',
    address: ctx.session.checkout?.address,
    paymentMethod,
    subtotal,
    tax: 0,
    deliveryFee,
    total: subtotal + deliveryFee
  });
  ctx.session.cart = [];
  ctx.session.checkout = null;
  return ctx.reply(`✅ تم استلام طلبك بنجاح.\nرقم الطلب: #${order.id}\nالإجمالي: ${money(order.total)}\n\nسنرسل لك تحديثات حالة الطلب هنا.`, mainMenu());
}

bot.catch((err, ctx) => {
  console.error('BOT_ERROR', err);
  ctx.reply('حدث خطأ غير متوقع. حاول مرة أخرى بعد قليل.').catch(() => {});
});

// Render Web Services must have an HTTP listener. Telegram can still use polling.
const port = Number(process.env.PORT || config.port || 10000);
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Restaurant bot is running.');
});
server.listen(port, '0.0.0.0', () => console.log(`HTTP health server listening on ${port}`));

if (config.webhookDomain) {
  bot.launch({ webhook: { domain: config.webhookDomain, port: config.port, path: config.webhookPath, secretToken: config.webhookSecret || undefined } });
} else {
  bot.launch();
}

process.once('SIGINT', () => { bot.stop('SIGINT'); server.close(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); server.close(); });