import http from 'node:http';
import { Telegraf, Markup, session } from 'telegraf';
import { config, validateConfig } from './config.js';
import { getCategories, getProducts, getProduct, upsertCustomer, createOrder } from './db.js';

validateConfig();
const bot = new Telegraf(config.botToken);
bot.use(session({ defaultSession: () => ({ cart: [], checkout: null, productQuantities: {} }) }));

const money = value => `${Number(value).toLocaleString('ar-AE')} ${config.currency}`;

function mainMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('  🍽️ المنيو والمنتجات  ', 'menu:show'),
      Markup.button.callback('  🛒 السلة والطلب  ', 'cart:show')
    ],
    [
      Markup.button.callback('  📦 طلباتي  ', 'orders:show'),
      Markup.button.callback('  📍 التوصيل  ', 'delivery:show')
    ],
    [
      Markup.button.callback('ℹ️ المساعدة', 'help:show')
    ]
  ]);
}

function backHome() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('  🏠 الرئيسية  ', 'menu:home'),
      Markup.button.callback('  🛒 السلة  ', 'cart:show')
    ]
  ]);
}

async function showCategories(ctx) {
  const categories = await getCategories();

  const keyboard = categories.length
    ? (() => {
        const rows = [];
        for (let i = 0; i < categories.length; i += 2) {
          rows.push(categories.slice(i, i + 2).map(c =>
            Markup.button.callback(`  ${c.name}  `, `cat:${c.id}`)
          ));
        }
        rows.push([
          Markup.button.callback('  🏠 الرئيسية  ', 'menu:home'),
          Markup.button.callback('  🛒 السلة والطلب  ', 'cart:show')
        ]);
        return Markup.inlineKeyboard(rows);
      })()
    : mainMenu();

  const text = categories.length ? '🍽️ اختر القسم:' : 'المنيو قيد التجهيز حاليًا.';

  if (ctx.callbackQuery?.message) {
    try {
      return await ctx.editMessageText(text, keyboard);
    } catch (err) {
      return ctx.reply(text, keyboard);
    }
  }

  return ctx.reply(text, keyboard);
}

function getProductQuantity(ctx, productId) {
  const quantities = ctx.session.productQuantities || (ctx.session.productQuantities = {});
  return Math.max(1, Number(quantities[productId] || 1));
}

function setProductQuantity(ctx, productId, quantity) {
  const quantities = ctx.session.productQuantities || (ctx.session.productQuantities = {});
  quantities[productId] = Math.max(1, Math.min(99, Number(quantity) || 1));
  return quantities[productId];
}

function productKeyboard(productId, quantity) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(' ➖ ', `qty:${productId}:-1`),
      Markup.button.callback(` الكمية: ${quantity} `, 'qty:none'),
      Markup.button.callback(' ➕ ', `qty:${productId}:1`)
    ],
    [
      Markup.button.callback('  🛒 أضف للسلة  ', `add:${productId}`),
      Markup.button.callback('  🛒 السلة  ', 'cart:show')
    ],
    [
      Markup.button.callback('  🍽️ الأقسام  ', 'menu:show'),
      Markup.button.callback('  🏠 الرئيسية  ', 'menu:home')
    ]
  ]);
}

async function showProducts(ctx, categoryId) {
  const products = await getProducts(categoryId);
  if (!products.length) return ctx.reply('لا توجد منتجات متاحة في هذا القسم حاليًا.', backHome());

  for (const p of products) {
    const caption = `<b>${p.name}</b>\n${p.description || ''}\nالسعر: <b>${money(p.price)}</b>`;
    const keyboard = productKeyboard(p.id, getProductQuantity(ctx, p.id));

    if (p.image_url) {
      await ctx.replyWithPhoto(p.image_url, { caption, parse_mode: 'HTML', ...keyboard });
    } else {
      await ctx.reply(caption, { parse_mode: 'HTML', ...keyboard });
    }
  }
}

async function refreshProductQuantity(ctx, productId) {
  const product = await getProduct(productId);
  if (!product || !ctx.callbackQuery?.message) return;

  const quantity = getProductQuantity(ctx, productId);
  const caption = `<b>${product.name}</b>\n${product.description || ''}\nالسعر: <b>${money(product.price)}</b>`;

  try {
    if (ctx.callbackQuery.message.photo) {
      return await ctx.editMessageCaption(caption, { parse_mode: 'HTML', ...productKeyboard(productId, quantity) });
    }
    return await ctx.editMessageText(caption, { parse_mode: 'HTML', ...productKeyboard(productId, quantity) });
  } catch (err) {
    return;
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
  const keyboard = !cart.length
    ? mainMenu()
    : Markup.inlineKeyboard([
        [
          Markup.button.callback('  🧹 تفريغ السلة  ', 'cart:clear'),
          Markup.button.callback('  ✅ متابعة الطلب  ', 'checkout:start')
        ],
        [
          Markup.button.callback('  🍽️ متابعة التسوق  ', 'menu:show'),
          Markup.button.callback('  🏠 الرئيسية  ', 'menu:home')
        ]
      ]);

  const text = cartText(cart);

  if (ctx.callbackQuery?.message) {
    try {
      return await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    } catch (err) {
      return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
  }

  return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
}

bot.start(async ctx => {
  await upsertCustomer(ctx.from);
  return ctx.reply(
    `أهلًا بك في ${config.restaurantName} 👋\nاختر ما تريد من القائمة.`,
    mainMenu()
  );
});

bot.command('menu', showCategories);

bot.action('menu:home', async ctx => {
  await ctx.answerCbQuery();
  const text = `أهلًا بك في ${config.restaurantName} 👋\nاختر ما تريد من القائمة.`;
  try {
    return await ctx.editMessageText(text, mainMenu());
  } catch (err) {
    return ctx.reply(text, mainMenu());
  }
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
  return ctx.reply('📦 قسم طلباتي قيد التجهيز، وسنعرض هنا الطلبات السابقة وحالة الطلب الحالي.', backHome());
});

bot.action('delivery:show', async ctx => {
  await ctx.answerCbQuery();
  return ctx.reply('📍 بيانات التوصيل تُطلب أثناء إتمام الطلب. يمكنك إدخال العنوان أثناء إتمام الطلب.', backHome());
});

bot.action('help:show', async ctx => {
  await ctx.answerCbQuery();
  return ctx.reply('ℹ️ اختر المنيو لإضافة المنتجات، ثم السلة لمراجعة الطلب وإتمامه.', backHome());
});

bot.action(/^cat:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  return showProducts(ctx, ctx.match[1]);
});

bot.action(/^qty:(.+):(-?1)$/, async ctx => {
  const productId = ctx.match[1];
  const delta = Number(ctx.match[2]);
  const quantity = setProductQuantity(ctx, productId, getProductQuantity(ctx, productId) + delta);
  await ctx.answerCbQuery(`الكمية: ${quantity}`);
  return refreshProductQuantity(ctx, productId);
});

bot.action('qty:none', async ctx => {
  return ctx.answerCbQuery('استخدم ➕ و ➖ لتحديد الكمية');
});

bot.action(/^add:(.+)$/, async ctx => {
  const product = await getProduct(ctx.match[1]);
  if (!product) {
    await ctx.answerCbQuery('المنتج غير موجود');
    return ctx.reply('تعذر العثور على المنتج.', backHome());
  }

  const quantity = getProductQuantity(ctx, product.id);
  const cart = ctx.session.cart || (ctx.session.cart = []);
  const existing = cart.find(i => String(i.product.id) === String(product.id));
  if (existing) existing.quantity += quantity;
  else cart.push({ product, quantity });

  setProductQuantity(ctx, product.id, 1);

  await ctx.answerCbQuery(`تمت إضافة ${quantity} من المنتج إلى السلة`);
  return ctx.reply(`✅ تمت إضافة ${product.name} × ${quantity} إلى السلة.`, Markup.inlineKeyboard([
    [
      Markup.button.callback('  🛒 عرض السلة  ', 'cart:show'),
      Markup.button.callback('  🍽️ متابعة التسوق  ', 'menu:show')
    ]
  ]));
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
    [
      Markup.button.callback('🚚 توصيل', 'checkout:delivery'),
      Markup.button.callback('🏪 استلام من المطعم', 'checkout:pickup')
    ],
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
    [
      Markup.button.callback('💵 دفع عند الاستلام', 'pay:cash'),
      Markup.button.callback('💳 دفع إلكتروني', 'pay:online')
    ]
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
      [
        Markup.button.callback('💵 دفع عند الاستلام', 'pay:cash'),
        Markup.button.callback('💳 دفع إلكتروني', 'pay:online')
      ]
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

const port = Number(process.env.PORT || config.port || 10000);
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Restaurant bot is running.');
});
server.listen(port, '0.0.0.0', () => console.log(`HTTP health server listening on ${port}`));

if (config.webhookDomain) {
  bot.launch({
    webhook: {
      domain: config.webhookDomain,
      port: config.port,
      path: config.webhookPath,
      secretToken: config.webhookSecret || undefined
    }
  });
} else {
  bot.launch();
}

process.once('SIGINT', () => { bot.stop('SIGINT'); server.close(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); server.close(); });
