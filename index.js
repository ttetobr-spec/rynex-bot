require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client, GatewayIntentBits, Partials, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder, ChannelType, RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'config.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ guilds: {}, memory: {} }, null, 2));
const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
const getGuild = (id) => { db.guilds[id] ||= { enabled: true, adminRoleId: process.env.ADMIN_ROLE_ID || '', adminChannelId: '', qaChannelIds: [], blockedUserIds: [], ticketCategoryId: process.env.TICKET_CATEGORY_ID || '', ticketLogChannelId: process.env.TICKET_LOG_CHANNEL_ID || '', tickets: {}, memory: [] }; const cfg = db.guilds[id]; cfg.tickets ||= {}; cfg.ticketCategoryId ||= process.env.TICKET_CATEGORY_ID || ''; cfg.ticketLogChannelId ||= process.env.TICKET_LOG_CHANNEL_ID || ''; return cfg; };
const clean = (s) => String(s || '').replace(/<@!?(\d+)>/g, '').trim();
const hasAdmin = (member, cfg) => Boolean(member && cfg.adminRoleId && ((member.roles?.cache?.has(cfg.adminRoleId)) || (Array.isArray(member._roles) && member._roles.includes(cfg.adminRoleId))));
const isMentioned = (message) => message.mentions.users.has(client.user.id) && !message.mentions.everyone;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent], partials: [Partials.Channel] });
const slashCommands = [];

async function registerCommands() {
  if (!process.env.DISCORD_TOKEN || !client.user) return;
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
  console.log('Comandos slash registrados.');
}
async function answer(message, prompt, cfg) {
  const memory = (cfg.memory || []).slice(-12).map(x => `${x.role}: ${x.content}`).join('\n');
  const promptText = `Você é Rynex, assistente de dúvidas de um servidor Discord. Responda em português, de forma objetiva, educada e natural. Nunca revele tokens, chaves ou dados privados. Não diga que é um robô; apresente-se como Rynex. Memória recente:\n${memory || '(vazia)'}\n\nPergunta do usuário: ${prompt}`;
  if (!process.env.POLLINATIONS_API_KEY) {
    const legacy = await fetch(`https://text.pollinations.ai/${encodeURIComponent(promptText)}`, { headers: { accept: 'text/plain' } });
    if (legacy.ok) return (await legacy.text()).slice(0, 1900);
    return 'O endpoint comunitário gratuito do Pollinations está sem capacidade no momento. Crie uma chave gratuita em enter.pollinations.ai e adicione POLLINATIONS_API_KEY para liberar a IA.';
  }
  const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.POLLINATIONS_API_KEY}` }, body: JSON.stringify({ model: process.env.POLLINATIONS_MODEL || 'openai/gpt-oss-20b', messages: [{ role: 'user', content: promptText }], max_tokens: 500, temperature: 0.5 }) });
  if (!response.ok) { const detail = await response.text(); console.error('Pollinations:', response.status, detail); return 'A IA do Pollinations está temporariamente indisponível ou atingiu o limite gratuito. Tente novamente em instantes.'; }
  const result = await response.json();
  return result.choices?.[0]?.message?.content || 'Não consegui formular uma resposta agora.';
}

async function adminAction(message, text, cfg) {
  const lower = text.toLowerCase();
  const sendMatch = text.match(/(?:diz|mande|manda|envia|envie)\s+(.+?)\s+(?:em|no|na)\s+<#(\d+)>/i);
  if (sendMatch) {
    const target = await message.guild.channels.fetch(sendMatch[2]).catch(() => null);
    if (!target || !target.isTextBased()) return 'Não encontrei um canal de texto válido com esse ID.';
    const content = sendMatch[1].trim().replace(/^um\s+/i, '');
    await target.send({ content: content || 'Olá!', allowedMentions: { parse: [] } });
    return `Mensagem enviada em <#${target.id}>.`;
  }
  if (lower.startsWith('cria um sorteio') || lower.startsWith('criar um sorteio')) {
    const channel = message.channel;
    const embed = new EmbedBuilder().setColor(0x6c5ce7).setTitle('🎉 Sorteio').setDescription(text.replace(/^cria?r? um sorteio[:]?/i, '').trim() || 'Participe do sorteio clicando no botão.').setFooter({ text: 'Rynex • sorteio' });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway:${message.id}`).setLabel('Participar').setStyle(ButtonStyle.Success));
    await channel.send({ embeds: [embed], components: [row] });
    return 'Sorteio criado com sucesso.';
  }
  const roleMatch = text.match(/(?:cria|criar) (?:(?:o|um) )?cargo (?:chamado )?["“]?([^"”]+)["”]?/i);
  if (roleMatch && message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    const role = await message.guild.roles.create({ name: roleMatch[1].trim().slice(0, 90), reason: 'Solicitado no canal administrativo pelo Rynex' });
    return `Cargo criado: <@&${role.id}>`;
  }
  const channelRequest = text.replace(/\s+e\s+diz\s+.*$/i, '').trim();
  const channelMatch = channelRequest.match(/(?:cria|criar) (?:(?:o|um) )?canal(?: chamado )?["“]?([^"”]*)["”]?/i);
  if (channelMatch && message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    const channelName = channelMatch[1].trim() || 'novo-canal';
    const ch = await message.guild.channels.create({ name: channelName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90), reason: 'Solicitado no canal administrativo pelo Rynex' });
    return `Canal criado: ${ch}\nOlá!`;
  }
  const block = text.match(/(?:não responda|nao responda|bloqueie)\s+<@!?(\d+)>/i);
  if (block) { if (!cfg.blockedUserIds.includes(block[1])) cfg.blockedUserIds.push(block[1]); save(); return `Entendido. Não responderei ao usuário <@${block[1]}>.`; }
  if (/ativar a intelig[eê]ncia|ativar a ia|reativar/i.test(lower)) { cfg.enabled = true; save(); return 'A inteligência artificial foi ativada.'; }
  if (/desativar a intelig[eê]ncia|desativar a ia/i.test(lower)) { cfg.enabled = false; save(); return 'A inteligência artificial foi desativada.'; }
  return answer(message, text, cfg);
}

client.on('ready', async () => { console.log(`Rynex conectado como ${client.user.tag}`); try { await registerCommands(); } catch (e) { console.error('Falha ao registrar comandos:', e.message); } });
client.on('error', (err) => console.error('Erro do cliente Discord:', err.message));
const handledMessages = new Set();
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot || message.mentions.everyone) return;
  if (handledMessages.has(message.id)) return;
  handledMessages.add(message.id); setTimeout(() => handledMessages.delete(message.id), 120000);
  const cfg = getGuild(message.guild.id);
  if (message.content.trim().toLowerCase() === '!painel') {
    const freshMember = await message.guild.members.fetch(message.author.id).catch(() => message.member);
    if (!hasAdmin(freshMember, cfg)) return message.reply({ content: `Apenas o cargo autorizado pode abrir o painel. Cargo configurado: ${cfg.adminRoleId}`, allowedMentions: { repliedUser: false } });
    return message.reply({ embeds: [panelEmbed(message.guild, cfg)], components: panelRows(cfg), allowedMentions: { repliedUser: false } });
  }
  if (message.content.trim().toLowerCase() === '!ticket painel') {
    if (!hasAdmin(message.member, cfg)) return message.reply({ content: 'Apenas o cargo autorizado pode publicar o painel de tickets.', allowedMentions: { repliedUser: false } });
    return message.channel.send({ embeds: [ticketPanelEmbed()], components: ticketPanelRows() });
  }
  const adminChannel = cfg.adminChannelId && message.channel.id === cfg.adminChannelId;
  const qaChannel = cfg.qaChannelIds.includes(message.channel.id);
  if (!cfg.enabled || cfg.blockedUserIds.includes(message.author.id)) return;
  if (!isMentioned(message)) return;
  if (adminChannel && !hasAdmin(message.member, cfg)) return;
  const text = clean(message.content);
  if (!text) return;
  try {
    await message.channel.sendTyping();
    const response = adminChannel ? await adminAction(message, text, cfg) : await answer(message, text, cfg);
    cfg.memory ||= []; cfg.memory.push({ role: 'user', content: text }, { role: 'assistant', content: response }); cfg.memory = cfg.memory.slice(-24); save();
    await message.reply({ content: response, allowedMentions: { parse: [] } });
  } catch (err) { console.error(err); await message.reply('Tive um problema temporário ao processar isso.'); }
});
function panelRows(cfg) {
  return [
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('panel:ia').setLabel(cfg.enabled ? 'IA ligada' : 'IA desligada').setEmoji(cfg.enabled ? '🟢' : '🔴').setStyle(cfg.enabled ? ButtonStyle.Success : ButtonStyle.Danger), new ButtonBuilder().setCustomId('panel:qa').setLabel('Usar canal como dúvidas').setEmoji('💬').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('panel:admin').setLabel('Usar canal como ADM').setEmoji('🛡️').setStyle(ButtonStyle.Primary)),
    new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('panel:role').setPlaceholder('Escolha o cargo autorizado')), 
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('panel:create-role').setLabel('Criar cargo').setEmoji('🎭').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('panel:create-channel').setLabel('Criar canal').setEmoji('📁').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('panel:giveaway').setLabel('Criar sorteio').setEmoji('🎉').setStyle(ButtonStyle.Secondary))
  ];
}
function panelEmbed(guild, cfg) {
  return new EmbedBuilder().setColor(0x8b5cf6).setAuthor({ name: 'RYNEX • CENTRAL DE CONFIGURAÇÃO', iconURL: client.user.displayAvatarURL() }).setTitle('Painel de controle').setDescription('Configure tudo por aqui usando os botões abaixo. Apenas administradores ou o cargo autorizado podem usar este painel.').addFields({ name: 'IA', value: cfg.enabled ? '🟢 Ativada' : '🔴 Desativada', inline: true }, { name: 'Cargo autorizado', value: cfg.adminRoleId ? `<@&${cfg.adminRoleId}>` : 'Não configurado', inline: true }, { name: 'Canal ADM', value: cfg.adminChannelId ? `<#${cfg.adminChannelId}>` : 'Não configurado', inline: true }, { name: 'Canais de dúvidas', value: cfg.qaChannelIds.length ? cfg.qaChannelIds.map(id => `<#${id}>`).join(', ') : 'Nenhum', inline: false }).setFooter({ text: `${guild.name} • Rynex` }).setTimestamp();
}
function ticketPanelEmbed() {
  return new EmbedBuilder().setColor(0x7c3aed).setTitle('🎫 Central de Atendimento').setDescription('Precisa de ajuda? Abra um atendimento privado escolhendo uma categoria abaixo.\n\n> **Privacidade:** somente você e a equipe de suporte terão acesso.\n> **Atendimento:** aguarde um membro da equipe assumir seu ticket.').addFields({ name: '📌 Antes de abrir', value: 'Explique seu problema com detalhes e envie provas, IDs ou imagens quando necessário.' }, { name: '🛡️ Segurança', value: 'Nunca envie senhas, tokens ou dados confidenciais.' }).setFooter({ text: 'Rynex Support • Atendimento organizado' }).setTimestamp();
}
function ticketPanelRows() {
  return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket:open').setPlaceholder('Selecione o tipo de atendimento').addOptions({ label: 'Suporte geral', description: 'Dúvidas e ajuda com o servidor', value: 'suporte', emoji: '🛠️' }, { label: 'Compras e pedidos', description: 'Dúvidas sobre produtos ou pedidos', value: 'compras', emoji: '🛒' }, { label: 'Denúncia', description: 'Relatar um problema ou usuário', value: 'denuncia', emoji: '🚨' }, { label: 'Parceria', description: 'Propostas e colaborações', value: 'parceria', emoji: '🤝' }))];
}
function ticketControls() {
  return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:claim').setLabel('Assumir ticket').setEmoji('📥').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('ticket:notify').setLabel('Notificar autor').setEmoji('🔔').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('ticket:close').setLabel('Fechar ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger))];
}
function isSupport(member, cfg) { return hasAdmin(member, cfg); }
function ticketData(cfg, channelId) { return cfg.tickets?.[channelId]; }
async function openTicket(interaction, cfg, type) {
  const existing = Object.entries(cfg.tickets || {}).find(([, t]) => t.userId === interaction.user.id && t.open);
  if (existing) return interaction.reply({ content: `Você já possui um atendimento aberto: <#${existing[0]}>`, ephemeral: true });
  const safe = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 20) || 'usuario';
  const channel = await interaction.guild.channels.create({ name: `ticket-${safe}`, type: ChannelType.GuildText, parent: cfg.ticketCategoryId || undefined, topic: `Ticket de ${interaction.user.tag} • categoria: ${type}`, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] }, ...(cfg.adminRoleId ? [{ id: cfg.adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages] }] : [])], reason: 'Abertura de ticket Rynex' });
  cfg.tickets[channel.id] = { userId: interaction.user.id, type, open: true, claimedBy: null, createdAt: new Date().toISOString() }; save();
  const embed = new EmbedBuilder().setColor(0x8b5cf6).setTitle(`🎫 Atendimento • ${type}`).setDescription(`Olá <@${interaction.user.id}>! Seu ticket foi criado.\n\nExplique aqui como podemos ajudar. Um membro da equipe será avisado quando assumir o atendimento.`).addFields({ name: '👤 Autor', value: `<@${interaction.user.id}>`, inline: true }, { name: '📂 Categoria', value: type, inline: true }, { name: '📌 Status', value: 'Aguardando suporte', inline: true }).setFooter({ text: 'Rynex Support' }).setTimestamp();
  const mention = cfg.adminRoleId ? `<@&${cfg.adminRoleId}>` : '';
  await channel.send({ content: `${mention} novo atendimento aberto por <@${interaction.user.id}>`, embeds: [embed], components: ticketControls(), allowedMentions: { roles: cfg.adminRoleId ? [cfg.adminRoleId] : [], users: [interaction.user.id] } });
  return interaction.reply({ content: `✅ Atendimento criado: ${channel}`, ephemeral: true });
}
client.on('interactionCreate', async (interaction) => {
  try {
  if (interaction.isButton() && interaction.customId.startsWith('giveaway:')) return interaction.reply({ content: 'Você entrou no sorteio! Boa sorte.', ephemeral: true });
  if (!interaction.guild) return;
  const cfg = getGuild(interaction.guild.id); const admin = hasAdmin(interaction.member, cfg);
  if (interaction.isChatInputCommand()) return;
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:open') return openTicket(interaction, cfg, interaction.values[0]);
  const currentTicket = ticketData(cfg, interaction.channelId);
  if (interaction.isButton() && interaction.customId.startsWith('ticket:') && !currentTicket) return interaction.reply({ content: 'Este atendimento não está mais ativo.', ephemeral: true });
  if (interaction.isButton() && interaction.customId === 'ticket:claim') {
    if (!isSupport(interaction.member, cfg)) return interaction.reply({ content: 'Somente a equipe autorizada pode assumir tickets.', ephemeral: true });
    if (currentTicket.claimedBy && currentTicket.claimedBy !== interaction.user.id) return interaction.reply({ content: `Este ticket já foi assumido por <@${currentTicket.claimedBy}>.`, ephemeral: true });
    currentTicket.claimedBy = interaction.user.id; save();
    const embed = new EmbedBuilder().setColor(0x22c55e).setTitle('✅ Atendimento assumido').setDescription(`<@${interaction.user.id}> assumiu este atendimento e responderá você em breve.`).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }
  if (interaction.isButton() && interaction.customId === 'ticket:notify') {
    if (!isSupport(interaction.member, cfg)) return interaction.reply({ content: 'Somente a equipe autorizada pode notificar o autor.', ephemeral: true });
    try { const user = await client.users.fetch(currentTicket.userId); await user.send(`🔔 A equipe respondeu ou atualizou seu atendimento em **${interaction.guild.name}**: <#${interaction.channelId}>`); return interaction.reply({ content: 'Notificação enviada por mensagem privada.', ephemeral: true }); } catch (_) { return interaction.reply({ content: 'Não consegui enviar DM. O usuário pode ter mensagens privadas bloqueadas.', ephemeral: true }); }
  }
  if (interaction.isButton() && interaction.customId === 'ticket:close') {
    if (!isSupport(interaction.member, cfg) && interaction.user.id !== currentTicket.userId) return interaction.reply({ content: 'Somente o autor ou a equipe pode fechar este atendimento.', ephemeral: true });
    await interaction.reply({ content: '🔒 Atendimento encerrado. Este canal será removido em alguns segundos.', ephemeral: true });
    currentTicket.open = false; currentTicket.closedBy = interaction.user.id; currentTicket.closedAt = new Date().toISOString(); save();
    if (cfg.ticketLogChannelId) { const log = await interaction.guild.channels.fetch(cfg.ticketLogChannelId).catch(() => null); if (log?.isTextBased()) await log.send({ embeds: [new EmbedBuilder().setColor(0xef4444).setTitle('📁 Ticket encerrado').addFields({ name: 'Canal', value: `#${interaction.channel.name}`, inline: true }, { name: 'Autor', value: `<@${currentTicket.userId}>`, inline: true }, { name: 'Encerrado por', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Categoria', value: currentTicket.type, inline: true }).setTimestamp()] }); }
    setTimeout(() => interaction.channel.delete('Ticket encerrado pelo Rynex').catch(() => {}), 5000); return;
  }
  if (!admin || (!interaction.isButton() && !interaction.isRoleSelectMenu() && !interaction.isModalSubmit())) return;
  if (interaction.isRoleSelectMenu() && interaction.customId === 'panel:role') { cfg.adminRoleId = interaction.values[0]; save(); return interaction.update({ embeds: [panelEmbed(interaction.guild, cfg)], components: panelRows(cfg) }); }
  if (interaction.isButton() && interaction.customId === 'panel:ia') { cfg.enabled = !cfg.enabled; save(); return interaction.update({ embeds: [panelEmbed(interaction.guild, cfg)], components: panelRows(cfg) }); }
  if (interaction.isButton() && interaction.customId === 'panel:qa') { if (!cfg.qaChannelIds.includes(interaction.channelId)) cfg.qaChannelIds.push(interaction.channelId); save(); return interaction.update({ embeds: [panelEmbed(interaction.guild, cfg)], components: panelRows(cfg) }); }
  if (interaction.isButton() && interaction.customId === 'panel:admin') { cfg.adminChannelId = interaction.channelId; save(); return interaction.update({ embeds: [panelEmbed(interaction.guild, cfg)], components: panelRows(cfg) }); }
  if (interaction.isButton() && ['panel:create-role','panel:create-channel','panel:giveaway'].includes(interaction.customId)) {
    const modal = new ModalBuilder().setCustomId(`${interaction.customId}:modal`).setTitle(interaction.customId === 'panel:create-role' ? 'Criar cargo' : interaction.customId === 'panel:create-channel' ? 'Criar canal' : 'Novo sorteio').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel(interaction.customId === 'panel:giveaway' ? 'Descrição' : 'Nome').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)));
    return interaction.showModal(modal);
  }
  if (interaction.isModalSubmit()) { const value = interaction.fields.getTextInputValue('value'); if (interaction.customId === 'panel:create-role:modal') { const role = await interaction.guild.roles.create({ name: value, reason: 'Painel Rynex' }); return interaction.reply({ content: `Cargo criado: <@&${role.id}>`, ephemeral: true }); } if (interaction.customId === 'panel:create-channel:modal') { const ch = await interaction.guild.channels.create({ name: value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90), type: ChannelType.GuildText, reason: 'Painel Rynex' }); return interaction.reply({ content: `Canal criado: ${ch}`, ephemeral: true }); } if (interaction.customId === 'panel:giveaway:modal') { const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway:${interaction.id}`).setLabel('Participar').setStyle(ButtonStyle.Success)); await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('🎉 Sorteio Rynex').setDescription(value)], components: [row] }); return interaction.reply({ content: 'Sorteio criado.', ephemeral: true }); } }
  } catch (err) { console.error('Interação expirada ou falhou:', err.code || err.message); if (!interaction.replied && !interaction.deferred) { try { await interaction.reply({ content: 'Este painel expirou. Digite `!painel` para abrir um novo.', ephemeral: true }); } catch (_) {} } }
});

const app = express(); app.use(express.json());
const panelKey = process.env.ADMIN_PANEL_KEY || 'troque-esta-chave';
app.get('/', (_, res) => res.send('<h1>Rynex online</h1><p>Bot Discord ativo.</p>'));
app.get('/health', (_, res) => res.json({ ok: true, bot: client.user?.tag || null }));
app.get('/api/config/:guildId', (req, res) => { if (req.headers.authorization !== `Bearer ${panelKey}`) return res.status(401).json({ error: 'unauthorized' }); res.json(getGuild(req.params.guildId)); });
app.post('/api/config/:guildId', (req, res) => { if (req.headers.authorization !== `Bearer ${panelKey}`) return res.status(401).json({ error: 'unauthorized' }); const cfg = getGuild(req.params.guildId); const allowed = ['enabled','adminRoleId','adminChannelId','qaChannelIds','blockedUserIds']; for (const k of allowed) if (req.body[k] !== undefined) cfg[k] = req.body[k]; save(); res.json(cfg); });
const port = Number(process.env.PORT || 3000); app.listen(port, '0.0.0.0', () => console.log(`Painel HTTP na porta ${port}`));
if (!process.env.DISCORD_TOKEN) console.error('DISCORD_TOKEN não configurado.'); else client.login(process.env.DISCORD_TOKEN);
