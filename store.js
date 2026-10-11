const crypto = require('crypto');
const QRCode = require('qrcode');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder,
  ChannelType,
} = require('discord.js');

const DEFAULT_CATEGORIES = ['Techwear', 'Essentials', 'Footwear', 'Accessories'];
const DEFAULT_PRODUCTS = [
  { id: '1', name: 'Void Runner', category: 'Techwear', price: 289.9, tag: 'NEW DROP', tone: 'violet', code: '01', visual: 'jacket', description: 'Uma camada utilitária para atravessar o ruído. Corte arquitetônico, presença silenciosa e detalhes que respondem ao seu movimento.' },
  { id: '2', name: 'Neon Core', category: 'Essentials', price: 149.9, tag: 'BEST SELLER', tone: 'cyan', code: '02', visual: 'hoodie', description: 'O essencial, mas nunca óbvio. Uma base confortável com a energia visual da próxima frequência.' },
  { id: '3', name: 'Rift 01', category: 'Footwear', price: 399.9, tag: 'LIMITED', tone: 'orange', code: '03', visual: 'shoe', description: 'Um tênis projetado para mudar de direção. Volume expressivo, sola responsiva e acabamento de edição limitada.' },
  { id: '4', name: 'Signal Pack', category: 'Accessories', price: 119.9, tag: 'IN STOCK', tone: 'pink', code: '04', visual: 'bag', description: 'Tudo o que você precisa, em uma frequência compacta. Compartimentos inteligentes e identidade forte.' },
  { id: '5', name: 'Ghost Layer', category: 'Techwear', price: 239.9, tag: 'NEW DROP', tone: 'lime', code: '05', visual: 'jacket', description: 'Leve, modular e pronto para a cidade. Ghost Layer foi pensado para camadas e possibilidades.' },
  { id: '6', name: 'Pulse Tee', category: 'Essentials', price: 89.9, tag: 'IN STOCK', tone: 'blue', code: '06', visual: 'tee', description: 'Uma camiseta limpa com um pulso próprio. O primeiro sinal de qualquer look.' },
  { id: '7', name: 'Arc Shell', category: 'Techwear', price: 329.9, tag: 'LIMITED', tone: 'purple', code: '07', visual: 'jacket', description: 'Proteção com geometria. Arc Shell entrega uma silhueta precisa para dias em alta velocidade.' },
  { id: '8', name: 'Mono Utility', category: 'Accessories', price: 159.9, tag: 'NEW DROP', tone: 'yellow', code: '08', visual: 'bag', description: 'Acessório essencial para quem carrega apenas o que importa — e faz isso com estilo.' },
];
const COMMAND_NAMES = new Set([
  'produto-adicionar',
  'produto-editar',
  'produto-remover',
  'produto-listar',
  'config-categorias',
  'config-cupom',
  'config-site',
  'config-categoria-pedidos',
  'config-pix',
  'gerarpix',
  'pedido-pendentes',
  'pedido-aceitar',
  'pedido-recusar',
]);

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 52);
}

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/[<>]/g, '').trim().slice(0, max);
}

function emvField(id, value) {
  const text = String(value ?? '');
  const length = Buffer.byteLength(text, 'utf8');
  if (length > 99) throw new Error(`Campo Pix ${id} excede 99 bytes.`);
  return `${id}${String(length).padStart(2, '0')}${text}`;
}

function crc16Ccitt(text) {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function pixAscii(value, max, label) {
  const text = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 .-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  if (!text) throw new Error(`${label} é obrigatório para montar o QR Pix.`);
  return text;
}

function buildStaticPixPayload({ key, amount, merchantName, city, info, txid }) {
  const pixKey = String(key || '').trim();
  if (!pixKey || Buffer.byteLength(pixKey, 'utf8') > 77 || /[\r\n<>]/.test(pixKey)) throw new Error('Configure uma chave Pix válida antes de gerar a cobrança.');
  const account = emvField('00', 'br.gov.bcb.pix') + emvField('01', pixKey) + (info ? emvField('02', pixAscii(info, 64, 'Descrição')) : '');
  const transactionId = String(txid || '***').replace(/[^A-Za-z0-9*]/g, '').slice(0, 25) || '***';
  const fields = [
    emvField('00', '01'),
    emvField('26', account),
    emvField('52', '0000'),
    emvField('53', '986'),
    ...(amount === undefined || amount === null ? [] : [emvField('54', Number(amount).toFixed(2))]),
    emvField('58', 'BR'),
    emvField('59', pixAscii(merchantName, 25, 'Nome do recebedor')),
    emvField('60', pixAscii(city, 15, 'Cidade do recebedor').toUpperCase()),
    emvField('62', emvField('05', transactionId)),
  ].join('') + '6304';
  return `${fields}${crc16Ccitt(fields)}`;
}

async function buildStaticPixPayment(cfg, amount, description, reference) {
  const key = cfg.paymentPixKey || process.env.PIX_KEY || '';
  const city = cfg.paymentPixCity || process.env.PIX_MERCHANT_CITY || '';
  const merchantName = process.env.PIX_MERCHANT_NAME || cfg.storeSettings?.brandName || 'Rynex';
  if (!key) return { mode: 'static_pix_manual', pixKey: null, copyPaste: null, qrCodeDataUrl: null, instructions: 'A equipe ainda precisa configurar a chave Pix com /config-pix.' };
  if (!city) return { mode: 'static_pix_manual', pixKey: key, copyPaste: null, qrCodeDataUrl: null, instructions: 'A equipe ainda precisa configurar a cidade da conta recebedora com /config-pix.' };
  const txid = `RX${String(reference || crypto.randomBytes(7).toString('hex')).replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`.slice(0, 25);
  const copyPaste = buildStaticPixPayload({ key, amount, merchantName, city, info: description, txid });
  const qrCodeDataUrl = await QRCode.toDataURL(copyPaste, { errorCorrectionLevel: 'M', margin: 2, width: 460 });
  return { mode: 'static_pix_manual', pixKey: key, copyPaste, qrCodeDataUrl, txid, instructions: 'Escaneie ou copie o código Pix. O pagamento será confirmado manualmente por um administrador.' };
}

function redact(value) {
  return cleanText(value, 1900).replace(
    /(?:sk-[A-Za-z0-9_-]{20,}|sk_[A-Za-z0-9_-]{20,}|token\s*[:=]\s*\S+|senha\s*[:=]\s*\S+)/gi,
    '[dado privado removido]',
  );
}

function ensureStore(cfg) {
  cfg.products ||= {};
  if (!Object.keys(cfg.products).length) cfg.products = Object.fromEntries(DEFAULT_PRODUCTS.map(product => [product.id, { ...product }]));
  cfg.storeCategories ||= [...DEFAULT_CATEGORIES];
  cfg.storeSettings ||= {
    brandName: 'Rynex',
    heroTitle: 'Vista seu próximo sinal.',
    supportEmail: '',
    checkoutNote: 'Pagamento manual via Pix. A entrega é feita pela equipe no atendimento.',
  };
  cfg.storeCoupon ||= {
    code: process.env.TEST_COUPON_CODE || 'RYNEX-TEST',
    percent: 100,
    active: true,
  };
  return cfg;
}

function normalizeProduct(key, raw = {}) {
  const id = cleanText(raw.id || key || slugify(raw.name) || `produto-${Date.now()}`, 80);
  return {
    id,
    name: cleanText(raw.name || key || 'Produto sem nome', 100),
    category: cleanText(raw.category || 'Geral', 60),
    price: Math.max(0, Number(raw.price || 0)),
    imageUrl: cleanText(raw.imageUrl || raw.image || '', 500),
    url: cleanText(raw.url || '', 500),
    description: cleanText(raw.description || raw.info || '', 700),
    tag: cleanText(raw.tag || 'IN STOCK', 40),
    tone: cleanText(raw.tone || 'violet', 30),
    visual: cleanText(raw.visual || 'tee', 30),
    code: cleanText(raw.code || String(id).slice(0, 4).toUpperCase(), 20),
    active: raw.active !== false,
  };
}

function publicCatalog(cfg) {
  ensureStore(cfg);
  const products = Object.entries(cfg.products)
    .map(([key, product]) => normalizeProduct(key, product))
    .filter(product => product.active);
  return {
    products,
    categories: cfg.storeCategories,
    settings: cfg.storeSettings,
  };
}

function adminRoleMatches(member, cfg) {
  const roleId = cfg.adminRoleId || process.env.ADMIN_ROLE_ID;
  return Boolean(member && roleId && member.roles?.cache?.has(roleId));
}

function registerStoreCommands(slashCommands) {
  slashCommands.push(
    new SlashCommandBuilder()
      .setName('produto-adicionar')
      .setDescription('Adiciona um produto ao catálogo Rynex')
      .addStringOption(option => option.setName('nome').setDescription('Nome do produto').setRequired(true))
      .addNumberOption(option => option.setName('preco').setDescription('Preço em reais').setRequired(true).setMinValue(0))
      .addStringOption(option => option.setName('categoria').setDescription('Categoria do produto').setRequired(true))
      .addStringOption(option => option.setName('imagem').setDescription('URL da imagem').setRequired(false))
      .addStringOption(option => option.setName('url').setDescription('URL pública do produto').setRequired(false))
      .addStringOption(option => option.setName('descricao').setDescription('Descrição do produto').setRequired(false))
      .setDMPermission(false)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('produto-editar')
      .setDescription('Edita um produto existente')
      .addStringOption(option => option.setName('id').setDescription('ID do produto').setRequired(true))
      .addStringOption(option => option.setName('nome').setDescription('Novo nome').setRequired(false))
      .addNumberOption(option => option.setName('preco').setDescription('Novo preço').setRequired(false).setMinValue(0))
      .addStringOption(option => option.setName('categoria').setDescription('Nova categoria').setRequired(false))
      .addStringOption(option => option.setName('imagem').setDescription('Nova URL da imagem').setRequired(false))
      .addStringOption(option => option.setName('url').setDescription('Nova URL pública').setRequired(false))
      .addStringOption(option => option.setName('descricao').setDescription('Nova descrição').setRequired(false))
      .setDMPermission(false)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('produto-remover')
      .setDescription('Remove um produto do catálogo')
      .addStringOption(option => option.setName('id').setDescription('ID do produto').setRequired(true))
      .setDMPermission(false)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('produto-listar')
      .setDescription('Lista os produtos do catálogo')
      .setDMPermission(false)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('config-categorias')
      .setDescription('Configura as categorias do site')
      .addStringOption(option => option.setName('lista').setDescription('Categorias separadas por vírgula').setRequired(true))
      .setDMPermission(false)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('config-cupom')
      .setDescription('Configura o cupom de teste do site')
      .addStringOption(option => option.setName('codigo').setDescription('Código do cupom').setRequired(true))
      .addNumberOption(option => option.setName('desconto').setDescription('Percentual de desconto, de 0 a 100').setRequired(true).setMinValue(0).setMaxValue(100))
      .addBooleanOption(option => option.setName('ativo').setDescription('Ativar ou desativar o cupom').setRequired(false))
      .setDMPermission(false)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('config-site')
      .setDescription('Configura textos básicos do site')
      .addStringOption(option => option.setName('marca').setDescription('Nome da marca').setRequired(false))
      .addStringOption(option => option.setName('titulo').setDescription('Título principal').setRequired(false))
      .addStringOption(option => option.setName('email').setDescription('E-mail de suporte').setRequired(false))
      .addStringOption(option => option.setName('checkout').setDescription('Aviso no checkout').setRequired(false))
      .setDMPermission(false)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('config-categoria-pedidos')
      .setDescription('Define a categoria do Discord que recebe os canais privados de pedidos')
      .addChannelOption(option => option.setName('categoria').setDescription('Categoria de canais do servidor').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .setDMPermission(false)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('config-pix')
      .setDescription('Configura ou consulta, em resposta privada, a chave e a cidade Pix')
      .addStringOption(option => option.setName('chave').setDescription('Nova chave Pix (opcional para apenas consultar)').setRequired(false))
      .addStringOption(option => option.setName('cidade').setDescription('Cidade da conta recebedora para o QR (até 15 caracteres)').setRequired(false))
      .addBooleanOption(option => option.setName('limpar').setDescription('Remover a chave personalizada e voltar à variável PIX_KEY').setRequired(false))
      .setDMPermission(false)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('gerarpix')
      .setDescription('Gera QR Pix estático e código copia-e-cola para uma cobrança')
      .addNumberOption(option => option.setName('valor').setDescription('Valor em reais').setRequired(true).setMinValue(0.01))
      .addStringOption(option => option.setName('nome').setDescription('Nome do cliente ou referência').setRequired(true).setMaxLength(60))
      .setDMPermission(false)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('pedido-pendentes')
      .setDescription('Lista os pedidos aguardando confirmação manual de pagamento')
      .setDMPermission(false)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('pedido-aceitar')
      .setDescription('Confirma manualmente um pedido e abre o canal privado')
      .addStringOption(option => option.setName('id').setDescription('ID do pedido').setRequired(true))
      .setDMPermission(false)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('pedido-recusar')
      .setDescription('Recusa um pedido pendente')
      .addStringOption(option => option.setName('id').setDescription('ID do pedido').setRequired(true))
      .setDMPermission(false)
      .toJSON(),
  );
}

function createStoreApi({ app, client, db, save, getGuild }) {
  db.users ||= {};
  db.sessions ||= {};
  db.storeOrders ||= {};

  const getStoreGuild = () => {
    const preferred = process.env.DISCORD_GUILD_ID && client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    return preferred || client.guilds.cache.first() || null;
  };

  const getStoreConfig = () => {
    const guild = getStoreGuild();
    return { guild, cfg: ensureStore(getGuild(guild?.id || process.env.DISCORD_GUILD_ID || 'demo')) };
  };

  const sessionUser = req => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const session = token && db.sessions[token];
    if (session?.createdAt && Date.now() - new Date(session.createdAt).getTime() > 30 * 24 * 60 * 60 * 1000) {
      delete db.sessions[token];
      save();
      return null;
    }
    return session?.userId ? db.users[session.userId] || null : null;
  };

  const isAdminApi = req => {
    const key = process.env.ADMIN_PANEL_KEY;
    return Boolean(key && req.headers.authorization === `Bearer ${key}`);
  };

  const sendJsonError = (res, status, error, message) => res.status(status).json({ error, message });
  const authAttempts = new Map();
  const limitAuthAttempts = (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (authAttempts.get(key) || []).filter(time => now - time < 60_000);
    if (recent.length >= 20) return sendJsonError(res, 429, 'rate_limited', 'Muitas tentativas. Aguarde um minuto e tente novamente.');
    recent.push(now);
    authAttempts.set(key, recent);
    next();
  };

  const publicUser = user => ({ id: user.id, name: user.name, username: user.username, email: user.email });

  const findOrder = id => db.storeOrders[String(id)] || null;
  const findOrderByChannel = channelId => Object.values(db.storeOrders).find(order => order.discordChannelId === channelId) || null;

  const authorizedOrder = (req, order) => {
    const user = sessionUser(req);
    if (isAdminApi(req)) return { user, admin: true };
    if (!user || !order || order.userId !== user.id) return null;
    return { user, admin: false };
  };

  const appendMessage = (order, message) => {
    order.messages ||= [];
    order.messages.push({
      id: message.id || crypto.randomUUID(),
      source: message.source || 'site',
      authorId: message.authorId || null,
      authorName: cleanText(message.authorName || 'Cliente', 80),
      content: redact(message.content),
      at: message.at || new Date().toISOString(),
    });
    order.messages = order.messages.slice(-300);
    order.updatedAt = new Date().toISOString();
    save();
  };

  const createDiscordOrderChannel = async order => {
    if (!client.user) return null;
    const guild = getStoreGuild();
    if (!guild) return null;
    const cfg = getGuild(guild.id);
    ensureStore(cfg);
    const parentId = cfg.orderCategoryId || cfg.ticketCategoryId || process.env.ORDER_CATEGORY_ID || '';
    const adminRoleId = cfg.adminRoleId || process.env.ADMIN_ROLE_ID || '';
    const permissionOverwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      {
        id: client.user.id,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels],
      },
    ];
    if (adminRoleId) {
      permissionOverwrites.push({
        id: adminRoleId,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
      });
    }
    if (/^\d{15,22}$/.test(String(order.discordUserId || ''))) {
      permissionOverwrites.push({
        id: order.discordUserId,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
      });
    }
    const baseName = slugify((order.items || []).map(item => item.name).join('-')) || 'pedido';
    const channel = await guild.channels.create({
      name: `pedido-${baseName}-${String(order.id).slice(-6)}`.slice(0, 95),
      type: ChannelType.GuildText,
      parent: parentId || undefined,
      permissionOverwrites,
      reason: `Pedido Rynex ${order.id}`,
    });
    order.discordGuildId = guild.id;
    order.discordChannelId = channel.id;
    order.status = 'awaiting_delivery';
    order.channelCreatedAt = new Date().toISOString();
    save();
    const lines = (order.items || []).map(item => `• ${item.quantity}× ${item.name} — R$ ${Number(item.price).toFixed(2)}`).join('\n');
    const mention = order.discordUserId ? `<@${order.discordUserId}>` : 'cliente pelo site';
    await channel.send({
      content: adminRoleId ? `<@&${adminRoleId}> novo pedido recebido` : 'Novo pedido recebido',
      embeds: [new EmbedBuilder()
        .setColor(order.total === 0 ? 0x22c55e : 0x8b5cf6)
        .setTitle(`🧾 Pedido ${order.id}`)
        .setDescription(`Cliente: **${cleanText(order.customerName, 100)}** (${cleanText(order.customerEmail, 140)})\nContato Discord: ${mention}\n\n${lines || 'Sem itens'}\n\n**Total: R$ ${Number(order.total).toFixed(2)}**\nStatus: **${order.status}**`)
        .setFooter({ text: 'Rynex Store • entrega manual' })
        .setTimestamp()],
      allowedMentions: { roles: adminRoleId ? [adminRoleId] : [], users: order.discordUserId ? [order.discordUserId] : [] },
    });
    return channel;
  };

  const confirmOrder = async (orderId, reviewer = null) => {
    const order = findOrder(orderId);
    if (!order) return { error: 'order_not_found' };
    order.paymentStatus = 'approved';
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    order.reviewedBy = reviewer?.id || reviewer || null;
    save();
    if (!order.discordChannelId) await createDiscordOrderChannel(order).catch(error => console.error('Canal do pedido:', error.message));
    save();
    return order;
  };

  const rejectOrder = orderId => {
    const order = findOrder(orderId);
    if (!order) return null;
    order.paymentStatus = 'rejected';
    order.status = 'payment_rejected';
    order.updatedAt = new Date().toISOString();
    save();
    return order;
  };

  const syncPendingChannels = async () => {
    for (const order of Object.values(db.storeOrders)) {
      if (order.status === 'paid' && !order.discordChannelId) {
        await createDiscordOrderChannel(order).catch(error => console.error(`Canal pendente ${order.id}:`, error.message));
      }
    }
    save();
  };

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = new Set(String(process.env.ALLOWED_SITE_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
    if (!origin) res.setHeader('Access-Control-Allow-Origin', '*');
    else if (allowedOrigins.has(origin) || process.env.CORS_ALLOW_ALL === 'true') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    if (req.method === 'OPTIONS' && origin && !allowedOrigins.has(origin) && process.env.CORS_ALLOW_ALL !== 'true') return res.status(403).end();
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.get('/api/store/health', (_, res) => res.json({ ok: true, bot: client.user?.tag || null }));

  app.get('/api/store/catalog', (req, res) => {
    return res.json(publicCatalog(getStoreConfig().cfg));
  });

  app.post('/api/auth/register', limitAuthAttempts, (req, res) => {
    const name = cleanText(req.body?.name, 100);
    const username = cleanText(req.body?.username, 40).toLowerCase();
    const email = cleanText(req.body?.email, 160).toLowerCase();
    const password = String(req.body?.password || '');
    if (name.length < 2 || username.length < 3 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
      return sendJsonError(res, 400, 'invalid_input', 'Informe nome, usuário, e-mail válido e senha com pelo menos 8 caracteres.');
    }
    if (Object.values(db.users).some(user => user.email === email || user.username === username)) {
      return sendJsonError(res, 409, 'user_exists', 'Já existe uma conta com este e-mail ou nome de usuário.');
    }
    const id = crypto.randomUUID();
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
    db.users[id] = { id, name, username, email, salt, passwordHash, createdAt: new Date().toISOString() };
    const token = crypto.randomBytes(32).toString('hex');
    db.sessions[token] = { userId: id, createdAt: new Date().toISOString() };
    save();
    return res.status(201).json({ token, user: publicUser(db.users[id]) });
  });

  app.post('/api/auth/login', limitAuthAttempts, (req, res) => {
    const email = cleanText(req.body?.email, 160).toLowerCase();
    const password = String(req.body?.password || '');
    const user = Object.values(db.users).find(entry => entry.email === email);
    if (!user) return sendJsonError(res, 401, 'invalid_credentials', 'E-mail ou senha inválidos.');
    const hash = crypto.scryptSync(password, user.salt, 64).toString('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passwordHash, 'hex'))) {
      return sendJsonError(res, 401, 'invalid_credentials', 'E-mail ou senha inválidos.');
    }
    const token = crypto.randomBytes(32).toString('hex');
    db.sessions[token] = { userId: user.id, createdAt: new Date().toISOString() };
    save();
    return res.json({ token, user: publicUser(user) });
  });

  app.get('/api/auth/me', (req, res) => {
    const user = sessionUser(req);
    if (!user) return sendJsonError(res, 401, 'unauthorized', 'Faça login para continuar.');
    return res.json({ user: publicUser(user) });
  });

  app.put('/api/auth/profile', limitAuthAttempts, (req, res) => {
    const user = sessionUser(req);
    if (!user) return sendJsonError(res, 401, 'unauthorized', 'Faça login para editar sua conta.');
    const name = cleanText(req.body?.name, 100);
    const username = cleanText(req.body?.username, 40).toLowerCase();
    const email = cleanText(req.body?.email, 160).toLowerCase();
    if (name.length < 2 || username.length < 3 || !/^\S+@\S+\.\S+$/.test(email)) {
      return sendJsonError(res, 400, 'invalid_input', 'Informe nome, usuário com pelo menos 3 caracteres e e-mail válido.');
    }
    const duplicate = Object.values(db.users).find(entry => entry.id !== user.id && (entry.email === email || entry.username === username));
    if (duplicate) return sendJsonError(res, 409, 'user_exists', 'Este e-mail ou nome de usuário já está em uso.');
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword && newPassword.length < 8) return sendJsonError(res, 400, 'invalid_password', 'A nova senha precisa ter pelo menos 8 caracteres.');
    if (newPassword || email !== user.email) {
      const currentPassword = String(req.body?.currentPassword || '');
      if (!currentPassword) return sendJsonError(res, 400, 'invalid_password', 'Informe sua senha atual para alterar e-mail ou senha.');
      const currentHash = crypto.scryptSync(currentPassword, user.salt, 64).toString('hex');
      if (!crypto.timingSafeEqual(Buffer.from(currentHash, 'hex'), Buffer.from(user.passwordHash, 'hex'))) return sendJsonError(res, 401, 'invalid_password', 'A senha atual está incorreta.');
    }
    if (newPassword) {
      user.salt = crypto.randomBytes(16).toString('hex');
      user.passwordHash = crypto.scryptSync(newPassword, user.salt, 64).toString('hex');
    }
    user.name = name;
    user.username = username;
    user.email = email;
    user.updatedAt = new Date().toISOString();
    save();
    return res.json({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (token && db.sessions[token]) { delete db.sessions[token]; save(); }
    return res.json({ ok: true });
  });

  app.post('/api/store/orders', async (req, res) => {
    const user = sessionUser(req);
    if (!user) return sendJsonError(res, 401, 'unauthorized', 'Faça login para criar um pedido.');
    const { cfg } = getStoreConfig();
    const requestedItems = Array.isArray(req.body?.items) ? req.body.items.slice(0, 30) : [];
    const items = [];
    for (const requested of requestedItems) {
      const key = String(requested?.id ?? '');
      const rawProduct = cfg.products[key];
      if (!rawProduct || rawProduct.active === false) return sendJsonError(res, 400, 'invalid_product', 'Um produto do carrinho não está mais disponível. Atualize a página.');
      const product = normalizeProduct(key, rawProduct);
      const quantity = Math.floor(Number(requested.quantity || 1));
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return sendJsonError(res, 400, 'invalid_quantity', 'Quantidade de produto inválida.');
      items.push({ id: product.id, name: product.name, price: product.price, quantity });
    }
    if (!items.length) return sendJsonError(res, 400, 'empty_order', 'O carrinho está vazio.');
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const couponCode = cleanText(req.body?.coupon, 80).toUpperCase();
    const coupon = cfg.storeCoupon?.active && couponCode && couponCode === String(cfg.storeCoupon.code || '').toUpperCase() ? cfg.storeCoupon : null;
    const discount = coupon ? Math.min(100, Math.max(0, Number(coupon.percent || 0))) : 0;
    const total = Math.round(subtotal * (1 - discount / 100) * 100) / 100;
    const order = {
      id: `RX-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      userId: user.id,
      customerName: user.name,
      customerEmail: user.email,
      discordUserId: cleanText(req.body?.discordUserId, 30),
      items,
      subtotal,
      discountPercent: discount,
      couponCode: coupon ? coupon.code : null,
      total,
      status: total === 0 ? 'paid' : 'awaiting_payment',
      paymentStatus: total === 0 ? 'approved_by_coupon' : 'awaiting_pix',
      paymentMethod: total === 0 ? 'coupon' : 'manual_pix_static',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    let payment = null;
    if (total > 0) {
      try { payment = await buildStaticPixPayment(cfg, total, `Pedido ${order.id}`, order.id); }
      catch (error) { return sendJsonError(res, 400, 'pix_config_invalid', error.message); }
    }
    db.storeOrders[order.id] = order;
    save();
    if (total === 0) await createDiscordOrderChannel(order).catch(error => console.error('Canal do pedido:', error.message));
    return res.status(201).json({ order, payment });
  });

  app.get('/api/store/orders/:id', (req, res) => {
    const order = findOrder(req.params.id);
    if (!authorizedOrder(req, order)) return sendJsonError(res, 403, 'forbidden', 'Você não tem acesso a este pedido.');
    return res.json({ order });
  });

  app.get('/api/store/orders/:id/messages', (req, res) => {
    const order = findOrder(req.params.id);
    if (!authorizedOrder(req, order)) return sendJsonError(res, 403, 'forbidden', 'Você não tem acesso a este pedido.');
    return res.json({ messages: order.messages || [] });
  });

  app.post('/api/store/orders/:id/messages', async (req, res) => {
    const order = findOrder(req.params.id);
    const access = authorizedOrder(req, order);
    if (!access) return sendJsonError(res, 403, 'forbidden', 'Você não tem acesso a este pedido.');
    const content = redact(req.body?.content);
    if (!content) return sendJsonError(res, 400, 'empty_message', 'Escreva uma mensagem.');
    const message = { source: 'site', authorId: access.user?.id || null, authorName: access.user?.name || 'Equipe', content };
    appendMessage(order, message);
    if (order.discordChannelId) {
      const channel = await client.channels.fetch(order.discordChannelId).catch(() => null);
      if (channel?.isTextBased()) await channel.send({ content: `**${message.authorName} (site):** ${content}`, allowedMentions: { parse: [] } }).catch(() => {});
    }
    return res.status(201).json({ message: order.messages.at(-1) });
  });

  async function handleInteraction(interaction, cfg) {
    const command = interaction.commandName;
    if (!COMMAND_NAMES.has(command)) return false;
    ensureStore(cfg);
    if (!adminRoleMatches(interaction.member, cfg)) {
      await interaction.reply({ content: 'Somente o cargo administrador configurado pode usar os comandos da loja.', ephemeral: true });
      return true;
    }
    if (command === 'produto-adicionar') {
      const name = interaction.options.getString('nome', true);
      const id = slugify(name) || `produto-${Date.now()}`;
      const uniqueId = cfg.products[id] ? `${id}-${Date.now().toString().slice(-4)}` : id;
      cfg.products[uniqueId] = normalizeProduct(uniqueId, {
        id: uniqueId,
        name,
        price: interaction.options.getNumber('preco', true),
        category: interaction.options.getString('categoria', true),
        imageUrl: interaction.options.getString('imagem') || '',
        url: interaction.options.getString('url') || '',
        description: interaction.options.getString('descricao') || '',
      });
      save();
      await interaction.reply({ content: `✅ Produto **${cfg.products[uniqueId].name}** adicionado com ID \`${uniqueId}\`.`, ephemeral: true });
      return true;
    }
    if (command === 'produto-editar') {
      const id = interaction.options.getString('id', true);
      if (!cfg.products[id]) {
        await interaction.reply({ content: `Não encontrei o produto \`${id}\`. Use /produto-listar.`, ephemeral: true });
        return true;
      }
      const current = normalizeProduct(id, cfg.products[id]);
      const values = {
        name: interaction.options.getString('nome'),
        price: interaction.options.getNumber('preco'),
        category: interaction.options.getString('categoria'),
        imageUrl: interaction.options.getString('imagem'),
        url: interaction.options.getString('url'),
        description: interaction.options.getString('descricao'),
      };
      Object.keys(values).forEach(key => { if (values[key] !== null) current[key] = values[key]; });
      cfg.products[id] = current;
      save();
      await interaction.reply({ content: `✅ Produto \`${id}\` atualizado.`, ephemeral: true });
      return true;
    }
    if (command === 'produto-remover') {
      const id = interaction.options.getString('id', true);
      if (!cfg.products[id]) {
        await interaction.reply({ content: `Não encontrei o produto \`${id}\`.`, ephemeral: true });
        return true;
      }
      delete cfg.products[id];
      save();
      await interaction.reply({ content: `✅ Produto \`${id}\` removido do catálogo.`, ephemeral: true });
      return true;
    }
    if (command === 'produto-listar') {
      const list = Object.entries(cfg.products).map(([id, value]) => {
        const product = normalizeProduct(id, value);
        return `• \`${id}\` — ${product.name} — R$ ${product.price.toFixed(2)} — ${product.category} — ${product.active ? 'ativo' : 'oculto'}`;
      });
      await interaction.reply({ content: list.length ? `**Catálogo Rynex**\n${list.join('\n').slice(0, 1850)}` : 'O catálogo ainda está vazio.', ephemeral: true });
      return true;
    }
    if (command === 'config-categorias') {
      const categories = interaction.options.getString('lista', true).split(',').map(value => cleanText(value, 50)).filter(Boolean).slice(0, 20);
      cfg.storeCategories = [...new Set(categories)];
      save();
      await interaction.reply({ content: `✅ Categorias salvas: ${cfg.storeCategories.join(', ')}`, ephemeral: true });
      return true;
    }
    if (command === 'config-cupom') {
      cfg.storeCoupon = { code: cleanText(interaction.options.getString('codigo', true), 80).toUpperCase(), percent: interaction.options.getNumber('desconto', true), active: interaction.options.getBoolean('ativo') ?? true };
      save();
      await interaction.reply({ content: `✅ Cupom \`${cfg.storeCoupon.code}\`: ${cfg.storeCoupon.active ? `${cfg.storeCoupon.percent}% de desconto, ativo` : 'desativado'}.`, ephemeral: true });
      return true;
    }
    if (command === 'config-site') {
      const settings = cfg.storeSettings;
      const values = { brandName: interaction.options.getString('marca'), heroTitle: interaction.options.getString('titulo'), supportEmail: interaction.options.getString('email'), checkoutNote: interaction.options.getString('checkout') };
      Object.keys(values).forEach(key => { if (values[key] !== null) settings[key] = cleanText(values[key], 300); });
      save();
      await interaction.reply({ content: '✅ Configuração do site atualizada. O catálogo público lê esses dados pela API.', ephemeral: true });
      return true;
    }
    if (command === 'config-categoria-pedidos') {
      const category = interaction.options.getChannel('categoria', true);
      cfg.orderCategoryId = category.id;
      save();
      await interaction.reply({ content: `✅ Os canais de pedido serão criados em **${category.name}**.`, ephemeral: true });
      return true;
    }
    if (command === 'config-pix') {
      const nextKey = interaction.options.getString('chave');
      const nextCity = interaction.options.getString('cidade');
      const clearKey = interaction.options.getBoolean('limpar') === true;
      if (clearKey) { delete cfg.paymentPixKey; delete cfg.paymentPixCity; save(); }
      else if (nextKey !== null || nextCity !== null) {
        try {
          if (nextKey !== null) cfg.paymentPixKey = cleanText(nextKey, 180);
          if (nextCity !== null) cfg.paymentPixCity = pixAscii(nextCity, 15, 'Cidade');
          save();
        } catch (error) {
          await interaction.reply({ content: error.message, ephemeral: true });
          return true;
        }
      }
      const currentKey = cfg.paymentPixKey || process.env.PIX_KEY || '';
      const currentCity = cfg.paymentPixCity || process.env.PIX_MERCHANT_CITY || '';
      await interaction.reply({ content: currentKey ? `Chave Pix atual: ${currentKey}\nCidade: ${currentCity || 'não configurada'}\nResposta privada para administradores.` : 'Configure chave e cidade com `/config-pix chave:... cidade:...`. O nome do recebedor usa a marca definida em `/config-site`.', ephemeral: true });
      return true;
    }
    if (command === 'gerarpix') {
      const amount = interaction.options.getNumber('valor', true);
      const name = cleanText(interaction.options.getString('nome', true), 60);
      try {
        const payment = await buildStaticPixPayment(cfg, amount, `Cliente ${name}`, `D${Date.now()}${crypto.randomBytes(4).toString('hex')}`);
        if (!payment.copyPaste || !payment.qrCodeDataUrl) {
          await interaction.reply({ content: `${payment.instructions}\nConfigure os dados com \/config-pix chave:... cidade:...`, ephemeral: true });
          return true;
        }
        const image = Buffer.from(payment.qrCodeDataUrl.split(',')[1], 'base64');
        await interaction.reply({
          content: `**Pix Rynex — cobrança para ${name}**\nValor: **R$ ${amount.toFixed(2)}**\nChave Pix: \`${payment.pixKey}\`\n\nPix copia-e-cola:\n\`\`\`\n${payment.copyPaste}\n\`\`\`\nConfirme o recebimento no banco antes de marcar o pedido como pago. Esta cobrança exige confirmação manual.`,
          files: [new AttachmentBuilder(image, { name: `pix-${payment.txid}.png` })],
          ephemeral: true,
        });
      } catch (error) {
        await interaction.reply({ content: `Não consegui montar o Pix: ${error.message}`, ephemeral: true });
      }
      return true;
    }
    if (command === 'pedido-pendentes') {
      const pending = Object.values(db.storeOrders).filter(order => order.status === 'awaiting_payment').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);
      const lines = pending.map(order => `• \`${order.id}\` — ${cleanText(order.customerName, 60)} — R$ ${Number(order.total || 0).toFixed(2)}`);
      await interaction.reply({ content: lines.length ? `**Pedidos aguardando Pix (${lines.length})**\n${lines.join('\n')}` : 'Não há pedidos aguardando confirmação Pix.', ephemeral: true });
      return true;
    }
    if (command === 'pedido-aceitar') {
      const order = await confirmOrder(interaction.options.getString('id', true), interaction.user);
      await interaction.reply({ content: order.error ? 'Pedido não encontrado.' : `✅ Pedido **${order.id}** confirmado. ${order.discordChannelId ? `Canal: <#${order.discordChannelId}>` : 'O canal será criado quando o bot estiver conectado a um servidor.'}`, ephemeral: true });
      return true;
    }
    if (command === 'pedido-recusar') {
      const order = rejectOrder(interaction.options.getString('id', true));
      await interaction.reply({ content: order ? `Pedido **${order.id}** recusado.` : 'Pedido não encontrado.', ephemeral: true });
      return true;
    }
    return true;
  }

  const captureDiscordMessage = (message, order) => {
    if (!order || !message.content?.trim()) return;
    appendMessage(order, {
      id: message.id,
      source: 'discord',
      authorId: message.author.id,
      authorName: message.member?.displayName || message.author.username,
      content: message.content,
      at: new Date(message.createdTimestamp || Date.now()).toISOString(),
    });
  };

  return {
    handleInteraction,
    captureDiscordMessage,
    findOrderByChannel,
    confirmOrder,
    rejectOrder,
    syncPendingChannels,
    ensureStore,
  };
}

module.exports = { createStoreApi, registerStoreCommands, ensureStore, publicCatalog, buildStaticPixPayload };
