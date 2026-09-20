import http from 'node:http';
import { Telegraf, Markup, session } from 'telegraf';
import { config, validateConfig } from './config.js';
import { getCategories, getProducts, getProduct, getProductOptions, getProductOption, getDeliveryZones, upsertCustomer, getCustomer, getCustomerById, listCustomerOrders, listPendingOrders, updateOrderStatus, createOrder } from './db.js';

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
        for (const c of categories) {
          rows.push([
            Markup.button.callback(`🍽️ ${c.name}  •  فتح القسم`, `cat:${c.id}`)
          ]);
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

function getSelectedOptions(ctx, productId) {
  const all = ctx.session.productOptions || (ctx.session.productOptions = {});
  return all[productId] || [];
}

function toggleProductOption(ctx, productId, option) {
  const all = ctx.session.productOptions || (ctx.session.productOptions = {});
  const selected = new Set(all[productId] || []);
  if (selected.has(option.id)) selected.delete(option.id);
  else selected.add(option.id);
  all[productId] = [...selected];
  return all[productId];
}

function selectedOptionRows(options, selectedIds) {
  return options.map(option => {
    const selected = selectedIds.includes(option.id);
    const delta = Number(option.price_delta || 0);
    const price = delta > 0 ? ` + ${money(delta)}` : delta < 0 ? ` - ${money(Math.abs(delta))}` : '';
    return [
      Markup.button.callback(
        `${selected ? '✅' : '➕'} ${option.name}${price}`,
        `opt:${option.id}`
      )
    ];
  });
}

function productKeyboard(productId, quantity, options = [], selectedIds = []) {
  const rows = [
    [
      Markup.button.callback(' ➖ ', `qty:${productId}:-1`),
      Markup.button.callback(` الكمية: ${quantity} `, 'qty:none'),
      Markup.button.callback(' ➕ ', `qty:${productId}:1`)
    ],
    ...selectedOptionRows(options, selectedIds),
    [
      Markup.button.callback('  🛒 أضف للسلة  ', `add:${productId}`),
      Markup.button.callback('  🛒 السلة  ', 'cart:show')
    ],
    [
      Markup.button.callback('  🍽️ الأقسام  ', 'menu:show'),
      Markup.button.callback('  🏠 الرئيسية  ', 'menu:home')
    ]
  ];
  return Markup.inlineKeyboard(rows);
}

function productUnitPrice(product, options = [], selectedIds = []) {
  return Number(product.price) + options
    .filter(option => selectedIds.includes(option.id))
    .reduce((sum, option) => sum + Number(option.price_delta || 0), 0);
}

function productCaption(product, options = [], selectedIds = [], quantity = 1) {
  const selected = options.filter(option => selectedIds.includes(option.id));
  const unitPrice = productUnitPrice(product, options, selectedIds);
  const optionText = selected.length
    ? `\nالإضافات: ${selected.map(option => option.name).join('، ')}`
    : '';
  return `<b>${product.name}</b>\n${product.description || ''}${optionText}\nالسعر للوحدة: <b>${money(unitPrice)}</b>\nالكمية: <b>${quantity}</b>\nالإجمالي: <b>${money(unitPrice * quantity)}</b>`;
}

async function showProducts(ctx, categoryId) {
  const products = await getProducts(categoryId);
  if (!products.length) return ctx.reply('لا توجد منتجات متاحة في هذا القسم حاليًا.', backHome());

  for (const p of products) {
    const options = await getProductOptions(p.id);
    const selectedIds = getSelectedOptions(ctx, p.id);
    const quantity = getProductQuantity(ctx, p.id);
    const caption = productCaption(p, options, selectedIds, quantity);
    const keyboard = productKeyboard(p.id, quantity, options, selectedIds);

    if (p.image_url) {
      await ctx.replyWithPhoto(p.image_url, { caption, parse_mode: 'HTML', ...keyboard });
    } else {
      await ctx.reply(caption, { parse_mode: 'HTML', ...keyboard });
    }
  }
}

async function refreshProductMessage(ctx, productId) {
  const product = await getProduct(productId);
  if (!product || !ctx.callbackQuery?.message) return;

  const options = await getProductOptions(productId);
  const selectedIds = getSelectedOptions(ctx, productId);
  const quantity = getProductQuantity(ctx, productId);
  const caption = productCaption(product, options, selectedIds, quantity);
  const keyboard = productKeyboard(productId, quantity, options, selectedIds);

  try {
    if (ctx.callbackQuery.message.photo) {
      return await ctx.editMessageCaption(caption, { parse_mode: 'HTML', ...keyboard });
    }
    return await ctx.editMessageText(caption, { parse_mode: 'HTML', ...keyboard });
  } catch (err) {
    return;
  }
}

async function refreshProductQuantity(ctx, productId) {
  return refreshProductMessage(ctx, productId);
}

function cartText(cart) {
  if (!cart.length) return '🛒 السلة فارغة.';
  let total = 0;
  const lines = cart.map((item, i) => {
    const unitPrice = Number(item.product.price) + (item.options || []).reduce((sum, option) => sum + Number(option.price_delta || 0), 0);
    const line = unitPrice * item.quantity;
    total += line;
    const optionText = (item.options || []).length ? `\n   ↳ ${item.options.map(option => option.name).join('، ')}` : '';
    return `${i + 1}. ${item.product.name} × ${item.quantity}${optionText} = ${money(line)}`;
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
  console.log('START_RECEIVED', String(ctx.from?.id || 'unknown'));
  try {
    await upsertCustomer(ctx.from);
    return await ctx.reply(
      `أهلًا بك في ${config.restaurantName} 👋\nاختر ما تريد من القائمة.`,
      mainMenu()
    );
  } catch (err) {
    console.error('START_ERROR', err);
    return ctx.reply(
      `أهلًا بك في ${config.restaurantName} 👋\nحدث خطأ بسيط أثناء تجهيز حسابك، لكن يمكنك المتابعة من المنيو.`,
      mainMenu()
    ).catch(() => {});
  }
});


function isAdmin(ctx) {
  return config.adminIds.includes(String(ctx.from?.id));
}
function adminOrderKeyboard(orderId, status) {
  const next = { pending: ['confirmed'], confirmed: ['preparing'], preparing: ['ready'], ready: ['out_for_delivery'], out_for_delivery: ['delivered'] }[status] || [];
  return Markup.inlineKeyboard([
    ...next.map(s => [Markup.button.callback('تحديث: ' + s, 'admin:status:' + orderId + ':' + s)]),
    [Markup.button.callback('❌ إلغاء الطلب', 'admin:status:' + orderId + ':cancelled')]
  ]);
}
bot.command('orders', async ctx => {
  if (!isAdmin(ctx)) return;
  const orders = await listPendingOrders();
  if (!orders.length) return ctx.reply('لا توجد طلبات قيد المعالجة.');
  for (const o of orders) {
    const customer = o.customer_id ? await getCustomerById(o.customer_id) : null;
    await ctx.reply(
      '📦 <b>طلب #' + o.id + '</b>\\nالحالة: ' + o.status + '\\nالعميل: ' + (customer?.name || 'غير معروف') + '\\nالهاتف: ' + (customer?.phone || 'غير مسجل') + '\\nالنوع: ' + (o.delivery_type === 'delivery' ? 'توصيل' : 'استلام') + '\\nالإجمالي: ' + money(o.total),
      { parse_mode: 'HTML', ...adminOrderKeyboard(o.id, o.status) }
    );
  }
});
bot.action(/^admin:status:(\d+):(.+)$/, async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('غير مصرح');
  const orderId = Number(ctx.match[1]);
  const status = ctx.match[2];
  const allowed = ['confirmed','preparing','ready','out_for_delivery','delivered','cancelled'];
  if (!allowed.includes(status)) return ctx.answerCbQuery('حالة غير صالحة');
  try {
    const order = await updateOrderStatus(orderId, status);
    const customer = order.customer_id ? await getCustomerById(order.customer_id) : null;
    if (customer?.external_user_id) {
      const labels = { confirmed:'تم تأكيد طلبك', preparing:'بدأ تحضير طلبك', ready:'طلبك جاهز', out_for_delivery:'طلبك خرج للتوصيل', delivered:'تم تسليم طلبك', cancelled:'تم إلغاء طلبك' };
      await bot.telegram.sendMessage(customer.external_user_id, '📦 الطلب #' + order.id + ': ' + (labels[status] || status));
    }
    await ctx.answerCbQuery('تم تحديث حالة الطلب');
    return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  } catch (err) {
    console.error('ADMIN_STATUS_ERROR', err);
    return ctx.answerCbQuery('تعذر تحديث الطلب');
  }
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
  try {
    const customer = await getCustomer(ctx.from);
    if (!customer) return ctx.reply('📦 لا توجد طلبات سابقة حتى الآن.', backHome());
    const orders = await listCustomerOrders(customer.id);
    if (!orders.length) return ctx.reply('📦 لا توجد طلبات سابقة حتى الآن.', backHome());
    const statusMap = {
      pending: 'قيد المراجعة', confirmed: 'تم التأكيد', preparing: 'قيد التحضير',
      ready: 'جاهز', out_for_delivery: 'خرج للتوصيل', delivered: 'تم التسليم',
      cancelled: 'ملغى', rejected: 'مرفوض'
    };
    const text = orders.map(o =>
      `#${o.id} — ${statusMap[o.status] || o.status}\n${money(o.total)} — ${o.delivery_type === 'delivery' ? 'توصيل' : 'استلام'}\nالدفع: ${o.payment_method === 'cash' ? 'عند الاستلام' : 'إلكتروني'}`
    ).join('\n\n');
    return ctx.reply(`📦 <b>طلباتي</b>\n\n${text}`, { parse_mode: 'HTML', ...backHome() });
  } catch (err) {
    console.error('ORDERS_ERROR', err);
    return ctx.reply('تعذر تحميل الطلبات حاليًا. حاول مرة أخرى.', backHome());
  }
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

bot.action(/^opt:(.+)$/, async ctx => {
  const optionId = ctx.match[1];
  const option = await getProductOption(optionId);
  if (!option) return ctx.answerCbQuery('الإضافة غير متاحة حاليًا');

  toggleProductOption(ctx, option.product_id, option);
  await ctx.answerCbQuery('تم تحديث الإضافات');
  return refreshProductMessage(ctx, option.product_id);
});

bot.action(/^add:(.+)$/, async ctx => {
  const product = await getProduct(ctx.match[1]);
  if (!product) {
    await ctx.answerCbQuery('المنتج غير موجود');
    return ctx.reply('تعذر العثور على المنتج.', backHome());
  }

  const quantity = getProductQuantity(ctx, product.id);
  const options = await getProductOptions(product.id);
  const selectedIds = getSelectedOptions(ctx, product.id);
  const selectedOptions = options.filter(option => selectedIds.includes(option.id));
  const unitPrice = productUnitPrice(product, options, selectedIds);
  const lineTotal = unitPrice * quantity;

  const cart = ctx.session.cart || (ctx.session.cart = []);
  const optionKey = selectedOptions.map(option => option.id).sort().join(',');
  const existing = cart.find(i =>
    String(i.product.id) === String(product.id) &&
    (i.options || []).map(option => option.id).sort().join(',') === optionKey
  );

  if (existing) existing.quantity += quantity;
  else cart.push({
    product,
    quantity,
    options: selectedOptions,
    lineTotal
  });

  setProductQuantity(ctx, product.id, 1);
  ctx.session.productOptions = ctx.session.productOptions || {};
  ctx.session.productOptions[product.id] = [];

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
  return ctx.reply('📍 أرسل عنوان التوصيل كتابةً:');
});

bot.action(/^zone:(.+)$/, async ctx => {
  const checkout = ctx.session.checkout;
  if (!checkout || checkout.deliveryType !== 'delivery') return ctx.answerCbQuery();
  const zones = await getDeliveryZones();
  const zone = zones.find(z => String(z.id) === String(ctx.match[1]));
  if (!zone) return ctx.answerCbQuery('منطقة التوصيل غير متاحة');
  checkout.deliveryZoneId = zone.id;
  checkout.deliveryFee = Number(zone.fee || 0);
  checkout.step = 'location';
  await ctx.answerCbQuery();
  return ctx.reply('📍 شارك موقعك لتحديد مكان التوصيل بدقة، أو اختر التخطي:', Markup.inlineKeyboard([
    [Markup.button.callback('تخطي الموقع', 'checkout:location:skip')],
    [Markup.button.callback('🛒 العودة للسلة', 'cart:show')]
  ]));
});

bot.action('checkout:location:skip', async ctx => {
  if (!ctx.session.checkout || ctx.session.checkout.deliveryType !== 'delivery') return ctx.answerCbQuery();
  ctx.session.checkout.latitude = null;
  ctx.session.checkout.longitude = null;
  ctx.session.checkout.step = 'phone';
  await ctx.answerCbQuery('يمكن متابعة الطلب بدون مشاركة الموقع');
  return ctx.reply('📱 أرسل رقم الهاتف للتواصل معك:', Markup.inlineKeyboard([
    [Markup.button.callback('🛒 العودة للسلة', 'cart:show')]
  ]));
});

bot.action('checkout:pickup', async ctx => {
  ctx.session.checkout = { step: 'phone', deliveryType: 'pickup' };
  await ctx.answerCbQuery();
  return ctx.reply('📱 أرسل رقم الهاتف للتواصل معك:', Markup.inlineKeyboard([
    [Markup.button.callback('🛒 العودة للسلة', 'cart:show')]
  ]));
});

bot.action('pay:cash', async ctx => finishCheckout(ctx, 'cash'));

bot.action('pay:online', async ctx => {
  await ctx.answerCbQuery();
  return ctx.reply('الدفع الإلكتروني جاهز للربط بمزود الدفع، لكن لن نفعل أي بوابة قبل تحديد المزود وواجهته رسميًا.');
});

bot.on('contact', async ctx => {
  const checkout = ctx.session.checkout;
  if (!checkout) return;
  if (checkout.step === 'phone') {
    checkout.phone = ctx.message.contact.phone_number;
    checkout.step = 'payment';
    return ctx.reply('اختر طريقة الدفع:', Markup.inlineKeyboard([
      [Markup.button.callback('💵 دفع عند الاستلام', 'pay:cash'), Markup.button.callback('💳 دفع إلكتروني', 'pay:online')]
    ]));
  }
});

bot.on('location', async ctx => {
  const checkout = ctx.session.checkout;
  if (!checkout || checkout.step !== 'location') return;
  checkout.latitude = ctx.message.location.latitude;
  checkout.longitude = ctx.message.location.longitude;
  checkout.step = 'phone';
  return ctx.reply('✅ تم استلام موقعك.\n📱 أرسل رقم الهاتف للتواصل معك:', Markup.inlineKeyboard([
    [Markup.button.callback('🛒 العودة للسلة', 'cart:show')]
  ]));
});

bot.on('text', async ctx => {
  const checkout = ctx.session.checkout;
  if (!checkout) return;

  if (checkout.step === 'address') {
    checkout.address = ctx.message.text;
    const zones = await getDeliveryZones();
    if (zones.length) {
      checkout.step = 'zone';
      return ctx.reply('📍 اختر منطقة التوصيل:', Markup.inlineKeyboard([
        ...zones.map(z => [Markup.button.callback(z.name + ' — ' + money(z.fee), 'zone:' + z.id)]),
        [Markup.button.callback('🛒 العودة للسلة', 'cart:show')]
      ]));
    }
    checkout.step = 'location';
    return ctx.reply('📍 شارك موقعك لتحديد مكان التوصيل بدقة، أو اختر التخطي:', Markup.inlineKeyboard([
      [Markup.button.callback('تخطي الموقع', 'checkout:location:skip')],
      [Markup.button.callback('🛒 العودة للسلة', 'cart:show')]
    ]));
  }

  if (checkout.step === 'phone') {
    checkout.phone = ctx.message.text.trim();
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

  const customer = await upsertCustomer(ctx.from, {
    phone: ctx.session.checkout?.phone,
    address: ctx.session.checkout?.address,
    latitude: ctx.session.checkout?.latitude,
    longitude: ctx.session.checkout?.longitude
  });
  const subtotal = cart.reduce((sum, item) => sum + (Number(item.product.price) + (item.options || []).reduce((s, o) => s + Number(o.price_delta || 0), 0)) * item.quantity, 0);
  const deliveryFee = ctx.session.checkout?.deliveryType === 'delivery' ? Number(ctx.session.checkout?.deliveryFee ?? config.defaultDeliveryFee) : 0;

  let order;
  try {
    order = await createOrder({
    customerId: customer.id,
    items: cart,
    deliveryType: ctx.session.checkout?.deliveryType || 'pickup',
    address: ctx.session.checkout?.address,
    latitude: ctx.session.checkout?.latitude,
    longitude: ctx.session.checkout?.longitude,
    paymentMethod,
    subtotal,
    tax: 0,
    deliveryFee,
    total: subtotal + deliveryFee
  });
  } catch (err) {
    console.error('CREATE_ORDER_ERROR', err);
    return ctx.reply('تعذر تسجيل الطلب حاليًا. لم يتم حذف السلة، حاول مرة أخرى.', backHome());
  }

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
  if (config.webhookDomain && req.url?.split('?')[0] === config.webhookPath) {
    console.log('WEBHOOK_REQUEST', req.method, req.url);
    const callback = bot.webhookCallback(config.webhookPath, {
      secretToken: config.webhookSecret || undefined
    });
    return callback(req, res);
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Restaurant bot is running.');
});
server.listen(port, '0.0.0.0', () => console.log(`HTTP health server listening on ${port}`));

if (config.webhookDomain) {
  bot.telegram.setWebhook(`${config.webhookDomain}${config.webhookPath}`, {
    secret_token: config.webhookSecret || undefined,
    drop_pending_updates: true
  }).then(() => console.log('Telegram webhook configured')).catch(err => console.error('WEBHOOK_SETUP_ERROR', err));
} else {
  bot.launch();
}

process.once('SIGINT', () => { bot.stop('SIGINT'); server.close(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); server.close(); });
