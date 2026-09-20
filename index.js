require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { Client, GatewayIntentBits, Partials, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder, ChannelType, RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, NoSubscriberBehavior, StreamType } = require('@discordjs/voice');
const play = require('play-dl');
const ytdl = require('youtube-dl-exec');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'config.json');
const DEFAULT_ADMIN_ROLE_ID = '1533477047144419612';
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ guilds: {}, memory: {} }, null, 2));
const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
const getGuild = (id) => { db.guilds[id] ||= { enabled: true, iaChangedAt: new Date().toISOString(), adminRoleId: process.env.ADMIN_ROLE_ID || DEFAULT_ADMIN_ROLE_ID, aiRoleId: '', ticketParentChannelId: '', ticketBannerUrl: '', ticketEmojis: {}, adminChannelId: '', qaChannelIds: [], blockedUserIds: [], ticketCategoryId: process.env.TICKET_CATEGORY_ID || '', ticketLogChannelId: process.env.TICKET_LOG_CHANNEL_ID || '', tickets: {}, knowledge: [], memory: [], products: {}, quickReplies: {}, orders: {}, ratings: [], warnings: {}, giveaway: null }; const cfg = db.guilds[id]; cfg.adminRoleId ||= process.env.ADMIN_ROLE_ID || DEFAULT_ADMIN_ROLE_ID; cfg.aiRoleId ||= ''; cfg.ticketParentChannelId ||= ''; cfg.ticketBannerUrl ||= ''; cfg.ticketEmojis ||= {}; cfg.iaChangedAt ||= new Date().toISOString(); cfg.tickets ||= {}; cfg.knowledge ||= []; cfg.products ||= {}; cfg.quickReplies ||= {}; cfg.orders ||= {}; cfg.ratings ||= []; cfg.warnings ||= {}; return cfg; };
const clean = (s) => String(s || '').replace(/<@!?(\d+)>/g, '').trim();
const hasAdmin = (member, cfg) => { const roleId = cfg.adminRoleId || process.env.ADMIN_ROLE_ID || DEFAULT_ADMIN_ROLE_ID; return Boolean(member && roleId && ((member.roles?.cache?.has(roleId)) || (Array.isArray(member._roles) && member._roles.includes(roleId)))); };
const isMentioned = (message) => message.mentions.users.has(client.user.id) && !message.mentions.everyone;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent], partials: [Partials.Channel] });
const slashCommands = [];
const voiceSessions = new Map();
const MUSIC_ONE_URL = 'https://youtu.be/BNLTYUaktWo?si=NzugKVCLOaeoNvog';
slashCommands.push(new SlashCommandBuilder().setName('1').setDescription('Entrar na sua call e tocar a música 1').toJSON());
slashCommands.push(new SlashCommandBuilder().setName('pix').setDescription('Exibir as instruções seguras de ativação e abrir atendimento').toJSON());
slashCommands.push(new SlashCommandBuilder().setName('aceitar').setDescription('Aprovar manualmente uma solicitação no ticket atual').toJSON());
slashCommands.push(new SlashCommandBuilder().setName('recusar').setDescription('Recusar manualmente uma solicitação no ticket atual').toJSON());
const PIX_KEY = 'c52cf65e-27ae-46d0-972e-578f6890e4fb';
const PAYMENT_STAFF_ROLE_ID = '1518349199110967568';

function sessionFor(guildId) { if (!voiceSessions.has(guildId)) { const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } }); const session = { player, connection: null, channelId: null, queue: [] }; player.on(AudioPlayerStatus.Idle, () => playNext(guildId).catch(console.error)); voiceSessions.set(guildId, session); } return voiceSessions.get(guildId); }
async function joinVoice(guild, channel) {
  if (!channel || !channel.isVoiceBased()) throw new Error('Você precisa estar em uma chamada de voz.');
  const session = sessionFor(guild.id); session.channelId = channel.id;
  if (session.connection) session.connection.destroy();
  session.connection = joinVoiceChannel({ channelId: channel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: false, selfMute: false });
  session.connection.subscribe(session.player);
  session.connection.on(VoiceConnectionStatus.Disconnected, async () => { setTimeout(() => joinVoice(guild, channel).catch(() => {}), 2500); });
  return session;
}
async function playNext(guildId) {
  const session = voiceSessions.get(guildId); if (!session || !session.queue.length) return;
  const url = session.queue.shift();
  try { const args = [...ytdl.args({ extractAudio: true, audioFormat: 'opus', audioQuality: 0, output: '-', quiet: true, noWarnings: true, extractorArgs: 'youtube:player_client=android' }), '--', url]; const proc = spawn(ytdl.constants.YOUTUBE_DL_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] }); proc.stderr?.on('data', data => console.error('yt-dlp:', data.toString().trim())); proc.on('error', err => console.error('yt-dlp:', err.message)); proc.on('close', code => { if (code && session.player.state.status === AudioPlayerStatus.Playing) console.error(`yt-dlp encerrou com código ${code}`); }); session.player.play(createAudioResource(proc.stdout, { inputType: StreamType.OggOpus, inlineVolume: true })); } catch (err) { console.error('YouTube:', err.message); playNext(guildId); }
}
async function queueYouTube(message, url) {
  url = url.trim().replace(/^<|>$/g, '').replace(/[),.!?]+$/g, '');
  const session = voiceSessions.get(message.guild.id); const memberChannel = message.member?.voice?.channel;
  if (!session?.connection || !session.channelId) return message.reply({ content: 'Use `!entra` primeiro para eu entrar na sua call.', allowedMentions: { repliedUser: false } });
  if (!memberChannel || memberChannel.id !== session.channelId) return message.reply({ content: 'Entre na mesma call que o Rynex para adicionar uma música.', allowedMentions: { repliedUser: false } });
  if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) return message.reply({ content: 'Envie um link válido do YouTube.', allowedMentions: { repliedUser: false } });
  const sessionData = sessionFor(message.guild.id); sessionData.queue.push(url); if (sessionData.player.state.status !== AudioPlayerStatus.Playing && sessionData.player.state.status !== AudioPlayerStatus.Buffering) await playNext(message.guild.id); return message.reply({ content: `Música adicionada à fila. Posição: ${sessionData.queue.length + 1}`, allowedMentions: { repliedUser: false } });
}
async function playFixedMusic(interaction) {
  const channel = interaction.member?.voice?.channel;
  if (!channel) return interaction.reply({ content: 'Entre em uma chamada de voz primeiro; depois use `/1`.', ephemeral: true });
  await joinVoice(interaction.guild, channel);
  const session = sessionFor(interaction.guild.id); session.queue.push(MUSIC_ONE_URL); if (session.player.state.status !== AudioPlayerStatus.Playing && session.player.state.status !== AudioPlayerStatus.Buffering) await playNext(interaction.guild.id);
  return interaction.reply({ content: 'Entrei na sua call e coloquei a música na fila.', ephemeral: true });
}
async function autoJoinBotOnline(guild) { const channel = guild.channels.cache.find(c => c.isVoiceBased() && c.name.toLowerCase().replace(/[-_]/g, ' ') === 'bot online'); if (channel) await joinVoice(guild, channel).catch(() => {}); }

async function registerCommands() {
  if (!process.env.DISCORD_TOKEN || !client.user) return;
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
  console.log('Comandos slash registrados.');
}
async function answer(message, prompt, cfg) {
  const memory = (cfg.memory || []).slice(-12).map(x => `${x.role}: ${x.content}`).join('\n');
  const words = prompt.toLowerCase().split(/\s+/).filter(w => w.length >= 4).slice(0, 8);
  const relevant = (cfg.knowledge || []).filter(x => words.some(w => x.content.toLowerCase().includes(w))).slice(-12).map(x => `[${x.channel}] ${x.author}: ${x.content}`).join('\n');
  const products = Object.entries(cfg.products || {}).map(([name, p]) => `${name}: ${p.price}${p.info ? ` — ${p.info}` : ''}`).join('\n');
  const promptText = `Você é Rynex, assistente de dúvidas de um servidor Discord. Responda em português, de forma objetiva, educada e natural. Priorize o catálogo oficial quando houver correspondência. Use a base de conhecimento abaixo apenas quando for relevante; não invente fatos. Nunca revele tokens, chaves ou dados privados. Não diga que é um robô; apresente-se como Rynex. Catálogo oficial:\n${products || '(vazio)'}\n\nMemória recente:\n${memory || '(vazia)'}\n\nBase de conhecimento:\n${relevant || '(nenhum registro relevante)'}\n\nPergunta do usuário: ${prompt}`;
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

function pixEmbed() {
  return new EmbedBuilder().setColor(0x7c3aed).setTitle('💜 Ativação Rynex Store').setDescription('Para solicitar a ativação do seu pedido, faça um Pix de **R$ 0,50** e envie o comprovante no atendimento privado.\n\nA análise é **manual** e o pagamento não libera acesso automaticamente. **Nunca envie senhas, tokens, códigos de autenticação ou links de recuperação.**').addFields({ name: '💠 Chave Pix', value: `\`${PIX_KEY}\`` }, { name: '📎 Como continuar', value: 'Clique em **Abrir atendimento**, envie a foto do comprovante no ticket e aguarde a equipe responsável.' }, { name: '🛡️ Segurança', value: 'A equipe só orientará procedimentos oficiais. Não acessamos contas de terceiros nem pedimos credenciais.' }).setFooter({ text: 'Rynex Store • Verificação manual' }).setTimestamp();
}
function pixRows() {
  return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('pix:open').setLabel('Abrir atendimento').setEmoji('📎').setStyle(ButtonStyle.Primary))];
}
function paymentControls() {
  return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('payment:accept').setLabel('Aceitar').setEmoji('✅').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('payment:reject').setLabel('Recusar').setEmoji('❌').setStyle(ButtonStyle.Danger))];
}
async function openPixTicket(interaction, cfg) {
  const existing = Object.entries(cfg.tickets || {}).find(([, t]) => t.userId === interaction.user.id && t.open && t.payment);
  if (existing) return interaction.reply({ content: `Você já possui uma solicitação aberta: <#${existing[0]}>`, ephemeral: true });
  const parent = cfg.ticketParentChannelId ? await interaction.guild.channels.fetch(cfg.ticketParentChannelId).catch(() => null) : null;
  if (!parent?.isTextBased() || !parent.threads) return interaction.reply({ content: 'O canal de tickets ainda não foi configurado no painel.', ephemeral: true });
  const safe = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 20) || 'usuario';
  const channel = await parent.threads.create({ name: `💳・ativacao-${safe}`.slice(0, 100), type: ChannelType.PrivateThread, invitable: false, reason: 'Solicitação de ativação Rynex' });
  await channel.members.add(interaction.user.id);
  cfg.tickets[channel.id] = { userId: interaction.user.id, type: 'ativacao', payment: true, paymentStatus: 'aguardando comprovante', open: true, claimedBy: null, parentId: parent.id, createdAt: new Date().toISOString() }; save();
  const staffMention = `<@&${PAYMENT_STAFF_ROLE_ID}>`;
  const embed = pixEmbed().setTitle('📎 Solicitação de ativação').setDescription(`Olá <@${interaction.user.id}>! Envie aqui a foto do comprovante do Pix de **R$ 0,50**.\n\nA equipe vai analisar manualmente e responder neste ticket.\n\n${staffMention}`);
  await channel.send({ content: staffMention, embeds: [embed], components: paymentControls(), allowedMentions: { roles: [PAYMENT_STAFF_ROLE_ID], users: [interaction.user.id] } });
  return interaction.reply({ content: `✅ Atendimento criado: ${channel}`, ephemeral: true });
}
async function setPaymentStatus(interaction, cfg, accepted) {
  const ticket = cfg.tickets?.[interaction.channelId];
  if (!ticket?.open || !ticket.payment) return interaction.reply({ content: 'Este comando só funciona dentro de um ticket de ativação aberto.', ephemeral: true });
  if (!hasAdmin(interaction.member, cfg) && !interaction.member?.roles?.cache?.has(PAYMENT_STAFF_ROLE_ID)) return interaction.reply({ content: 'Somente a equipe autorizada pode analisar solicitações.', ephemeral: true });
  ticket.paymentStatus = accepted ? 'aprovado' : 'recusado'; ticket.reviewedBy = interaction.user.id; ticket.reviewedAt = new Date().toISOString(); save();
  const title = accepted ? '✅ Solicitação aprovada' : '❌ Solicitação recusada';
  const body = accepted ? 'A equipe confirmou sua solicitação. Um atendente continuará o atendimento neste ticket. Não envie credenciais ou códigos de acesso.' : 'A equipe não conseguiu aprovar esta solicitação. Confira o comprovante e fale com um atendente neste ticket.';
  await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(accepted ? 0x22c55e : 0xef4444).setTitle(title).setDescription(`${body}\n\nAnalisado por <@${interaction.user.id}>.`).setTimestamp()] });
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (user) await user.send({ embeds: [new EmbedBuilder().setColor(accepted ? 0x22c55e : 0xef4444).setTitle(title).setDescription(`${body}\nTicket: <#${interaction.channelId}>`).setTimestamp()] }).catch(() => {});
  if (cfg.ticketLogChannelId) { const log = await interaction.guild.channels.fetch(cfg.ticketLogChannelId).catch(() => null); if (log?.isTextBased()) await log.send({ embeds: [new EmbedBuilder().setColor(accepted ? 0x22c55e : 0xef4444).setTitle(`📁 Ativação ${accepted ? 'aprovada' : 'recusada'}`).addFields({ name: 'Usuário', value: `<@${ticket.userId}>`, inline: true }, { name: 'Responsável', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Ticket', value: `<#${interaction.channelId}>`, inline: true }).setTimestamp()] }); }
  return interaction.reply({ content: accepted ? 'A solicitação foi aprovada e o usuário foi notificado.' : 'A solicitação foi recusada e o usuário foi notificado.', ephemeral: true });
}

function ratingRow(ticketId) { return new ActionRowBuilder().addComponents(...[1, 2, 3, 4, 5].map(n => new ButtonBuilder().setCustomId(`rating:${ticketId}:${n}`).setLabel(`${n} estrela${n === 1 ? '' : 's'}`).setStyle(n >= 4 ? ButtonStyle.Success : n >= 3 ? ButtonStyle.Primary : ButtonStyle.Secondary))); }
async function sendTranscript(interaction, cfg, ticket) {
  if (!cfg.ticketLogChannelId) return;
  const log = await interaction.guild.channels.fetch(cfg.ticketLogChannelId).catch(() => null);
  if (!log?.isTextBased()) return;
  const messages = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => null);
  const lines = messages ? [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp).map(m => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content || '[anexo/embed]' }${m.attachments.size ? ` | anexos: ${[...m.attachments.values()].map(a => a.url).join(', ')}` : ''}`) : ['Não foi possível obter as mensagens.'];
  const transcript = Buffer.from(`# Transcript Rynex Store\nAutor: ${ticket.userId}\nCategoria: ${ticket.type}\nAbertura: ${ticket.createdAt}\nFechamento: ${ticket.closedAt}\n\n${lines.join('\n')}`, 'utf8');
  await log.send({ content: `📁 Transcript do ticket <#${interaction.channelId}>`, files: [{ attachment: transcript, name: `transcript-${interaction.channelId}.txt` }] });
}
function reportEmbed(cfg) {
  const tickets = Object.values(cfg.tickets || {}); const open = tickets.filter(t => t.open).length; const claimed = tickets.filter(t => t.open && t.claimedBy).length; const avg = cfg.ratings.length ? (cfg.ratings.reduce((s, r) => s + r.score, 0) / cfg.ratings.length).toFixed(1) : '—';
  return new EmbedBuilder().setColor(0x7c3aed).setTitle('📊 Relatório Rynex Store').addFields({ name: 'Tickets', value: `Abertos: ${open}\nAssumidos: ${claimed}\nRegistrados: ${tickets.length}`, inline: true }, { name: 'Avaliações', value: `Recebidas: ${cfg.ratings.length}\nMédia: ${avg}/5`, inline: true }, { name: 'Catálogo', value: `Produtos: ${Object.keys(cfg.products).length}\nRespostas rápidas: ${Object.keys(cfg.quickReplies).length}`, inline: true }).setTimestamp();
}
function userReportEmbed(cfg, userId) {
  const messages = (cfg.knowledge || []).filter(x => x.userId === userId).slice(-12);
  const tickets = Object.entries(cfg.tickets || {}).filter(([, t]) => t.userId === userId);
  const content = messages.length ? messages.map(x => `• **${x.channel}** — ${x.content.slice(0, 180)}`).join('\n') : 'Nenhuma mensagem registrada com este ID.';
  const ticketText = tickets.length ? tickets.map(([id, t]) => `• <#${id}> — ${t.type} — ${t.open ? 'aberto' : 'fechado'}`).join('\n') : 'Nenhum ticket registrado.';
  return new EmbedBuilder().setColor(0x7c3aed).setTitle(`👤 Relatório do usuário`).setDescription(`ID: \`${userId}\`\n\n**Mensagens registradas**\n${content}\n\n**Tickets**\n${ticketText}`).setFooter({ text: 'O relatório mostra apenas mensagens que o bot conseguiu registrar no servidor; não acessa DMs privadas.' }).setTimestamp();
}
function logsEmbed(cfg) {
  const logs = (cfg.adminActions || []).slice(-15).reverse();
  return new EmbedBuilder().setColor(0x475569).setTitle('📁 Logs administrativos').setDescription(logs.length ? logs.map(x => `• <t:${Math.floor(new Date(x.at).getTime() / 1000)}:f> — <@${x.by}> — ${x.action}`).join('\n') : 'Nenhuma ação administrativa registrada ainda.').setFooter({ text: 'Rynex Store • histórico do painel' }).setTimestamp();
}
async function recordAdminAction(cfg, guild, by, action) {
  cfg.adminActions ||= []; cfg.adminActions.push({ by, action, at: new Date().toISOString() }); cfg.adminActions = cfg.adminActions.slice(-200); save();
  if (cfg.ticketLogChannelId) { const log = await guild.channels.fetch(cfg.ticketLogChannelId).catch(() => null); if (log?.isTextBased()) await log.send({ content: `🛡️ <@${by}> — ${action}`, allowedMentions: { users: [by] } }).catch(() => {}); }
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

client.on('ready', async () => { client.user.setPresence({ activities: [], status: 'online' }); for (const guild of client.guilds.cache.values()) await autoJoinBotOnline(guild); console.log(`Rynex conectado como ${client.user.tag} • status online`); try { await registerCommands(); } catch (e) { console.error('Falha ao registrar comandos:', e.message); } });
client.on('voiceStateUpdate', async (oldState, newState) => { if (oldState.member?.id !== client.user?.id || newState.channelId) return; const session = voiceSessions.get(oldState.guild.id); if (!session) return; const channel = oldState.guild.channels.cache.get(session.channelId) || oldState.guild.channels.cache.find(c => c.isVoiceBased() && c.name.toLowerCase().replace(/[-_]/g, ' ') === 'bot online'); if (channel) setTimeout(() => joinVoice(oldState.guild, channel).catch(() => {}), 2500); });
client.on('error', (err) => console.error('Erro do cliente Discord:', err.message));
const handledMessages = new Set();
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot || message.mentions.everyone) return;
  if (handledMessages.has(message.id)) return;
  handledMessages.add(message.id); setTimeout(() => handledMessages.delete(message.id), 120000);
  const cfg = getGuild(message.guild.id);
  const raw = message.content.trim();
  if (raw && !raw.toLowerCase().startsWith('!painel') && !raw.toLowerCase().startsWith('!ticket painel')) {
    const safe = raw.replace(/(?:sk-[A-Za-z0-9_-]{20,}|sk_[A-Za-z0-9_-]{20,}|token\s*[:=]\s*\S+|senha\s*[:=]\s*\S+)/gi, '[dado privado removido]').slice(0, 1800);
    if (safe && !safe.includes('[dado privado removido]')) { cfg.knowledge.push({ userId: message.author.id, author: message.author.username, channel: message.channel.name, content: safe, at: new Date().toISOString() }); cfg.knowledge = cfg.knowledge.slice(-10000); save(); }
  }
  const command = message.content.trim().toLowerCase();
  if (command === '!entra' || /^(entra|entre)\s+(a[ií]|aqui)$/i.test(command)) { try { const member = await message.guild.members.fetch(message.author.id).catch(() => message.member); const channel = member?.voice?.channel; await joinVoice(message.guild, channel); return message.reply({ content: `Entrei na chamada **${channel.name}**.`, allowedMentions: { repliedUser: false } }); } catch (err) { return message.reply({ content: err.message, allowedMentions: { repliedUser: false } }); } }
  const youtube = message.content.trim().match(/^!\s*(https?:\/\/\S+)/i);
  if (youtube) return queueYouTube(message, youtube[1]);
  if (command === '!painelguloso') {
    return message.reply({ embeds: [panelEmbed(message.guild, cfg)], components: panelRows(cfg), allowedMentions: { repliedUser: false } });
  }
  if (command === '!painel') {
    const freshMember = await message.guild.members.fetch({ user: message.author.id, force: true }).catch(() => message.member);
    if (freshMember?.roles?.fetch) await freshMember.roles.fetch().catch(() => {});
    if (!hasAdmin(freshMember, cfg)) return message.reply({ content: `Apenas o cargo autorizado pode abrir o painel. Cargo configurado: ${cfg.adminRoleId}`, allowedMentions: { repliedUser: false } });
    return message.reply({ embeds: [panelEmbed(message.guild, cfg)], components: panelRows(cfg), allowedMentions: { repliedUser: false } });
  }
  if (message.content.trim().toLowerCase() === '!ticket painel') {
    if (!hasAdmin(message.member, cfg)) return message.reply({ content: 'Apenas o cargo autorizado pode publicar o painel de tickets.', allowedMentions: { repliedUser: false } });
    return message.channel.send({ embeds: [ticketPanelEmbed(cfg)], components: ticketPanelRows(cfg) });
  }
  const adminChannel = cfg.adminChannelId && message.channel.id === cfg.adminChannelId;
  const qaChannel = cfg.qaChannelIds.includes(message.channel.id);
  const ticket = cfg.tickets[message.channel.id];
  if (!cfg.enabled || cfg.blockedUserIds.includes(message.author.id)) return;
  if (ticket?.open && ticket.payment && message.attachments.size) {
    const log = cfg.ticketLogChannelId ? await message.guild.channels.fetch(cfg.ticketLogChannelId).catch(() => null) : null;
    if (log?.isTextBased()) {
      const files = [...message.attachments.values()].map(file => ({ attachment: file.url, name: file.name || 'comprovante' }));
      await log.send({ content: `<@&${PAYMENT_STAFF_ROLE_ID}> novo comprovante no ticket <#${message.channel.id}>`, embeds: [new EmbedBuilder().setColor(0xf59e0b).setTitle('📎 Comprovante recebido').setDescription(`Usuário: <@${message.author.id}>\nTicket: <#${message.channel.id}>\n\nAprovação deve ser feita manualmente com \/aceitar ou pelo botão.`).setTimestamp()], files, allowedMentions: { roles: [PAYMENT_STAFF_ROLE_ID], users: [] } });
    }
    ticket.paymentStatus = 'comprovante recebido'; ticket.lastProofAt = new Date().toISOString(); save();
    await message.reply({ content: '📎 Comprovante recebido. A equipe foi notificada e fará a análise manual.', allowedMentions: { repliedUser: false } });
    return;
  }
  if (ticket?.open && !ticket.claimedBy && !ticket.aiStopped) { const text = clean(message.content); if (!text) return; try { await message.channel.sendTyping(); const response = await answer(message, text, cfg); ticket.lastActivityAt = new Date().toISOString(); cfg.memory ||= []; cfg.memory.push({ role: 'user', content: text }, { role: 'assistant', content: response }); cfg.memory = cfg.memory.slice(-24); save(); return message.reply({ content: response, allowedMentions: { parse: [] } }); } catch (err) { console.error(err); return message.reply('Tive um problema temporário ao processar isso.'); } }
  if (!isMentioned(message)) return;
  if (!ticket && cfg.aiRoleId) { const member = await message.guild.members.fetch(message.author.id).catch(() => message.member); if (!member?.roles?.cache?.has(cfg.aiRoleId)) return; }
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
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('panel:ia').setLabel(cfg.enabled ? 'Desligar IA' : 'Ligar IA').setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success), new ButtonBuilder().setCustomId('panel:tickets').setLabel('Publicar tickets').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('panel:join').setLabel('Entrar na call').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('panel:refresh').setLabel('Atualizar painel').setStyle(ButtonStyle.Secondary)),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('panel:admin').setLabel('Definir canal ADM').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('panel:qa').setLabel('Adicionar canal de dúvidas').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('panel:ticket-config').setLabel('Configurar tickets e IA').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('panel:ticket-visual').setLabel('Banner e emojis').setStyle(ButtonStyle.Secondary)),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('panel:create-role').setLabel('Criar cargo').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('panel:create-channel').setLabel('Criar canal').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('panel:giveaway').setLabel('Criar sorteio').setStyle(ButtonStyle.Secondary)),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('panel:report-user').setLabel('Relatório por ID').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('panel:logs').setLabel('Ver logs').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('panel:send-dm').setLabel('Enviar DM').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('panel:send-channel').setLabel('Enviar no canal').setStyle(ButtonStyle.Primary)),
    new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('panel:role').setPlaceholder('Selecione o cargo autorizado'))
  ];
}
function panelEmbed(guild, cfg) {
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(cfg.iaChangedAt).getTime()) / 60000));
  const openTickets = Object.values(cfg.tickets || {}).filter(t => t.open).length;
  const totalTickets = Object.keys(cfg.tickets || {}).length;
  return new EmbedBuilder().setColor(0x6d28d9).setAuthor({ name: 'RYNEX  •  CONTROL CENTER', iconURL: client.user.displayAvatarURL() }).setTitle('⚡ Painel de gerenciamento').setDescription('**Central administrativa do servidor**\n\nConfigure a IA, atendimento, dúvidas, permissões, canais, relatórios e mensagens administrativas. O painel é atualizado pelos próprios botões.').addFields({ name: '🤖 IA • STATUS', value: cfg.enabled ? `🟢 **Ligada**\n⏱️ Há ${elapsed} minuto(s)\nResponde quando mencionada` : `🔴 **Desligada**\n⏱️ Há ${elapsed} minuto(s)\nNão responderá mensagens`, inline: true }, { name: '🛡️ ADMINISTRADOR', value: `Cargo: ${cfg.adminRoleId ? `<@&${cfg.adminRoleId}>` : 'não definido'}\nCanal ADM: ${cfg.adminChannelId ? `<#${cfg.adminChannelId}>` : 'não definido'}`, inline: true }, { name: '🎫 TICKETS', value: `Abertos: **${openTickets}**\nTotal registrados: **${totalTickets}**\nCategoria: ${cfg.ticketCategoryId ? `<#${cfg.ticketCategoryId}>` : 'padrão'}`, inline: true }, { name: '💡 DÚVIDAS', value: `Canais ativos: **${cfg.qaChannelIds.length}**\nMensagens registradas: **${(cfg.knowledge || []).length}**`, inline: true }, { name: '📁 LOGS E ATIVIDADE', value: `Canal: ${cfg.ticketLogChannelId ? `<#${cfg.ticketLogChannelId}>` : 'não definido'}\nAções no painel: **${(cfg.adminActions || []).length}**`, inline: true }, { name: '⚙️ AÇÕES DISPONÍVEIS', value: 'IA • Tickets • Relatório por ID • Ver logs • Enviar DM • Enviar no canal • Banner • Cargos • Canais', inline: true }).setFooter({ text: `${guild.name}  •  Rynex Support System` }).setTimestamp();
}
function customEmoji(cfg, key, fallback) { const value = cfg.ticketEmojis?.[key]; return value && (/^<a?:[A-Za-z0-9_]+:\d+>$/.test(value) || /\p{Extended_Pictographic}/u.test(value)) ? value : fallback; }
function ticketPanelEmbed(cfg = {}) {
  const embed = new EmbedBuilder().setColor(0x7c3aed).setTitle('🎫 Rynex Store • Central de Atendimento').setDescription('Atendimento disponível **24 horas por dia**.\n\nClique no menu abaixo para ver as opções e abrir um atendimento privado.\n\n> **Privacidade:** somente você e a equipe terão acesso.\n> **Aguarde:** um staff será notificado e poderá assumir seu ticket.').addFields({ name: '📌 Como funciona', value: 'Escolha Suporte, Dúvidas, Denúncias ou Reembolso e explique o que aconteceu com detalhes.' }, { name: '🛡️ Segurança', value: 'Nunca envie senhas, tokens ou dados confidenciais.' }).setFooter({ text: 'Rynex Store • Atendimento organizado 24/7' }).setTimestamp();
  if (cfg.ticketBannerUrl) embed.setImage(cfg.ticketBannerUrl); return embed;
}
function ticketPanelRows(cfg = {}) {
  return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket:open').setPlaceholder('Clique aqui para ver as opções').addOptions({ label: 'Suporte', description: 'Ajuda com o servidor', value: 'suporte', emoji: customEmoji(cfg, 'suporte', '🛠️') }, { label: 'Dúvidas', description: 'Tire suas dúvidas', value: 'duvidas', emoji: customEmoji(cfg, 'duvidas', '❓') }, { label: 'Denúncias', description: 'Relate um problema', value: 'denuncias', emoji: customEmoji(cfg, 'denuncias', '🚨') }, { label: 'Reembolso', description: 'Solicitações de reembolso', value: 'reembolso', emoji: customEmoji(cfg, 'reembolso', '💰') }))];
}
function ticketControls() {
  return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:claim').setLabel('Assumir ticket').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('ticket:notify').setLabel('Notificar autor').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('ticket:close').setLabel('Fechar ticket').setStyle(ButtonStyle.Danger)), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:add').setLabel('Adicionar membro').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('ticket:rename').setLabel('Renomear').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('ticket:call').setLabel('Criar call').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('ticket:help').setLabel('Pedir ajuda').setStyle(ButtonStyle.Secondary))];
}
function isSupport(member, cfg) { return hasAdmin(member, cfg); }
function ticketData(cfg, channelId) { return cfg.tickets?.[channelId]; }
async function openTicket(interaction, cfg, type) {
  const existing = Object.entries(cfg.tickets || {}).find(([, t]) => t.userId === interaction.user.id && t.open);
  if (existing) return interaction.reply({ content: `Você já possui um atendimento aberto: <#${existing[0]}>`, ephemeral: true });
  const parent = cfg.ticketParentChannelId ? await interaction.guild.channels.fetch(cfg.ticketParentChannelId).catch(() => null) : null;
  if (!parent?.isTextBased() || !parent.threads) return interaction.reply({ content: 'O canal de tickets ainda não foi configurado. Um administrador deve usar “Configurar tickets e IA” no painel.', ephemeral: true });
  const safe = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 20) || 'usuario';
  const channel = await parent.threads.create({ name: `🕒・${type}-${safe}`.slice(0, 100), type: ChannelType.PrivateThread, invitable: false, reason: 'Abertura de ticket Rynex' });
  await channel.members.add(interaction.user.id);
  cfg.tickets[channel.id] = { userId: interaction.user.id, type, open: true, claimedBy: null, parentId: parent.id, createdAt: new Date().toISOString() }; save();
  const queuePosition = Object.values(cfg.tickets).filter(t => t.open && !t.claimedBy).length;
  const embed = new EmbedBuilder().setColor(0x8b5cf6).setTitle(`🎫 Rynex Store • ${type}`).setDescription(`Oiii <@${interaction.user.id}>! Como posso te ajudar hoje?\n\nSeu atendimento foi criado com sucesso. Explique aqui o que aconteceu com o máximo de detalhes; um membro da equipe será avisado e poderá assumir o ticket.`).addFields({ name: '👤 Autor', value: `<@${interaction.user.id}>`, inline: true }, { name: '📂 Categoria', value: type, inline: true }, { name: '📌 Status', value: '🕒 Aguardando atendimento', inline: true }, { name: '📋 Fila', value: `Posição atual: **${queuePosition}**`, inline: true }).setFooter({ text: 'Rynex Store • Central de Atendimento' }).setTimestamp();
  if (cfg.ticketBannerUrl) embed.setImage(cfg.ticketBannerUrl);
  const mention = cfg.adminRoleId ? `<@&${cfg.adminRoleId}>` : '';
  await channel.send({ content: `${mention} novo atendimento aberto por <@${interaction.user.id}>`, embeds: [embed], components: ticketControls(), allowedMentions: { roles: cfg.adminRoleId ? [cfg.adminRoleId] : [], users: [interaction.user.id] } });
  return interaction.reply({ content: `✅ Atendimento criado: ${channel}`, ephemeral: true });
}
client.on('interactionCreate', async (interaction) => {
  try {
  if (interaction.isButton() && interaction.customId.startsWith('giveaway:')) return interaction.reply({ content: 'Você entrou no sorteio! Boa sorte.', ephemeral: true });
  if (!interaction.guild) return;
  const cfg = getGuild(interaction.guild.id); const admin = hasAdmin(interaction.member, cfg);
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === '1') return playFixedMusic(interaction);
    if (interaction.commandName === 'pix') return interaction.reply({ embeds: [pixEmbed()], components: pixRows(), allowedMentions: { parse: [] } });
    if (interaction.commandName === 'aceitar') return setPaymentStatus(interaction, cfg, true);
    if (interaction.commandName === 'recusar') return setPaymentStatus(interaction, cfg, false);
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('rating:')) {
    const [, ticketId, scoreText] = interaction.customId.split(':'); const score = Number(scoreText); if (!cfg.ratings.some(r => r.ticketId === ticketId && r.userId === interaction.user.id)) { cfg.ratings.push({ ticketId, userId: interaction.user.id, score, at: new Date().toISOString() }); save(); } return interaction.update({ content: 'Obrigado pela avaliação do atendimento.', embeds: [], components: [] });
  }
  if (interaction.isButton() && interaction.customId === 'pix:open') return openPixTicket(interaction, cfg);
  if (interaction.isButton() && (interaction.customId === 'payment:accept' || interaction.customId === 'payment:reject')) return setPaymentStatus(interaction, cfg, interaction.customId === 'payment:accept');
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:open') return openTicket(interaction, cfg, interaction.values[0]);
  const currentTicket = ticketData(cfg, interaction.channelId);
  if (interaction.isButton() && interaction.customId.startsWith('ticket:') && !currentTicket) return interaction.reply({ content: 'Este atendimento não está mais ativo.', ephemeral: true });
  if (interaction.isButton() && interaction.customId === 'ticket:claim') {
    if (!isSupport(interaction.member, cfg)) return interaction.reply({ content: 'Somente a equipe autorizada pode assumir tickets.', ephemeral: true });
    if (currentTicket.claimedBy && currentTicket.claimedBy !== interaction.user.id) return interaction.reply({ content: `Este ticket já foi assumido por <@${currentTicket.claimedBy}>.`, ephemeral: true });
    currentTicket.claimedBy = interaction.user.id; currentTicket.aiStopped = true; save();
    const embed = new EmbedBuilder().setColor(0x22c55e).setTitle('✅ Atendimento assumido').setDescription(`<@${interaction.user.id}> assumiu este atendimento e responderá você em breve.`).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }
  if (interaction.isButton() && ['ticket:add', 'ticket:rename'].includes(interaction.customId)) {
    if (!isSupport(interaction.member, cfg)) return interaction.reply({ content: 'Somente a equipe autorizada pode usar este controle.', ephemeral: true });
    const field = interaction.customId === 'ticket:add' ? new TextInputBuilder().setCustomId('memberId').setLabel('ID do usuário para adicionar').setPlaceholder('123456789012345678').setStyle(TextInputStyle.Short).setRequired(true) : new TextInputBuilder().setCustomId('newName').setLabel('Novo nome do ticket').setPlaceholder('suporte-cliente').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(90);
    return interaction.showModal(new ModalBuilder().setCustomId(`${interaction.customId}:modal`).setTitle(interaction.customId === 'ticket:add' ? 'Adicionar participante' : 'Renomear ticket').addComponents(new ActionRowBuilder().addComponents(field)));
  }
  if (interaction.isButton() && interaction.customId === 'ticket:help') {
    if (!isSupport(interaction.member, cfg)) return interaction.reply({ content: 'Somente a equipe autorizada pode pedir ajuda.', ephemeral: true });
    return interaction.reply({ content: `${cfg.adminRoleId ? `<@&${cfg.adminRoleId}>` : 'Equipe autorizada'}, o staff <@${interaction.user.id}> pediu ajuda neste ticket: <#${interaction.channelId}>`, allowedMentions: { roles: cfg.adminRoleId ? [cfg.adminRoleId] : [], users: [interaction.user.id] } });
  }
  if (interaction.isButton() && interaction.customId === 'ticket:call') {
    if (!isSupport(interaction.member, cfg)) return interaction.reply({ content: 'Somente a equipe autorizada pode criar uma call.', ephemeral: true });
    const call = await interaction.guild.channels.create({ name: `call-${interaction.channel.name}`.slice(0, 90), type: ChannelType.GuildVoice, reason: 'Call privada criada pelo painel de staff' }).catch(() => null);
    return interaction.reply({ content: call ? `🔊 Call criada: ${call}` : 'Não consegui criar a call. Verifique a permissão Gerenciar canais.', ephemeral: true });
  }
  if (interaction.isButton() && interaction.customId === 'ticket:notify') {
    if (!isSupport(interaction.member, cfg)) return interaction.reply({ content: 'Somente a equipe autorizada pode notificar o autor.', ephemeral: true });
    try { const user = await client.users.fetch(currentTicket.userId); await user.send(`🔔 A equipe respondeu ou atualizou seu atendimento em **${interaction.guild.name}**: <#${interaction.channelId}>`); return interaction.reply({ content: 'Notificação enviada por mensagem privada.', ephemeral: true }); } catch (_) { return interaction.reply({ content: 'Não consegui enviar DM. O usuário pode ter mensagens privadas bloqueadas.', ephemeral: true }); }
  }
  if (interaction.isButton() && interaction.customId === 'ticket:close') {
    if (!isSupport(interaction.member, cfg) && interaction.user.id !== currentTicket.userId) return interaction.reply({ content: 'Somente o autor ou a equipe pode fechar este atendimento.', ephemeral: true });
    await interaction.reply({ content: '🔒 Atendimento encerrado. Este canal será removido em alguns segundos.', ephemeral: true });
    currentTicket.open = false; currentTicket.closedBy = interaction.user.id; currentTicket.closedAt = new Date().toISOString(); save();
    await sendTranscript(interaction, cfg, currentTicket).catch(err => console.error('Transcript:', err.message));
    const closedUser = await client.users.fetch(currentTicket.userId).catch(() => null);
    if (closedUser) await closedUser.send({ content: `Seu atendimento **${currentTicket.type}** foi encerrado por <@${interaction.user.id}>. Como foi o atendimento?`, components: [ratingRow(interaction.channelId)] }).catch(() => {});
    if (cfg.ticketLogChannelId) { const log = await interaction.guild.channels.fetch(cfg.ticketLogChannelId).catch(() => null); if (log?.isTextBased()) await log.send({ embeds: [new EmbedBuilder().setColor(0xef4444).setTitle('📁 Ticket encerrado').addFields({ name: 'Canal', value: `#${interaction.channel.name}`, inline: true }, { name: 'Autor', value: `<@${currentTicket.userId}>`, inline: true }, { name: 'Encerrado por', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Categoria', value: currentTicket.type, inline: true }, { name: 'Assumido por', value: currentTicket.claimedBy ? `<@${currentTicket.claimedBy}>` : 'Não assumido', inline: true }).setTimestamp()] }); }
    setTimeout(() => interaction.channel.delete('Ticket encerrado pelo Rynex').catch(() => {}), 5000); return;
  }
  if (interaction.isModalSubmit() && interaction.customId === 'ticket:add:modal') {
    if (!isSupport(interaction.member, cfg)) return interaction.reply({ content: 'Somente a equipe autorizada pode adicionar participantes.', ephemeral: true });
    const memberId = interaction.fields.getTextInputValue('memberId').trim(); const member = await interaction.guild.members.fetch(memberId).catch(() => null); if (!member) return interaction.reply({ content: 'Não encontrei esse usuário no servidor.', ephemeral: true });
    await interaction.channel.members.add(member.id).catch(() => null); return interaction.reply({ content: `✅ <@${member.id}> foi adicionado ao ticket.`, allowedMentions: { users: [member.id] } });
  }
  if (interaction.isModalSubmit() && interaction.customId === 'ticket:rename:modal') {
    if (!isSupport(interaction.member, cfg)) return interaction.reply({ content: 'Somente a equipe autorizada pode renomear tickets.', ephemeral: true });
    const name = interaction.fields.getTextInputValue('newName').trim().replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').slice(0, 90); await interaction.channel.setName(name || 'ticket').catch(() => null); return interaction.reply({ content: `✅ Ticket renomeado para **${name || 'ticket'}**.`, ephemeral: true });
  }
  const panelInteraction = (interaction.isButton() || interaction.isRoleSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith('panel:');
  if ((!admin && !panelInteraction) || (!interaction.isButton() && !interaction.isRoleSelectMenu() && !interaction.isModalSubmit())) return;
  if (interaction.isRoleSelectMenu() && interaction.customId === 'panel:role') { cfg.adminRoleId = interaction.values[0]; save(); return interaction.update({ embeds: [panelEmbed(interaction.guild, cfg)], components: panelRows(cfg) }); }
  if (interaction.isButton() && interaction.customId === 'panel:ia') { cfg.enabled = !cfg.enabled; cfg.iaChangedAt = new Date().toISOString(); save(); return interaction.update({ embeds: [panelEmbed(interaction.guild, cfg)], components: panelRows(cfg) }); }
  if (interaction.isButton() && interaction.customId === 'panel:refresh') return interaction.update({ embeds: [panelEmbed(interaction.guild, cfg)], components: panelRows(cfg) });
  if (interaction.isButton() && interaction.customId === 'panel:logs') { if (!admin) return interaction.reply({ content: 'Somente a equipe autorizada pode ver os logs.', ephemeral: true }); return interaction.reply({ embeds: [logsEmbed(cfg)], ephemeral: true }); }
  if (interaction.isButton() && interaction.customId === 'panel:report-user') { if (!admin) return interaction.reply({ content: 'Somente a equipe autorizada pode consultar relatórios.', ephemeral: true }); const modal = new ModalBuilder().setCustomId('panel:report-user:modal').setTitle('Relatório por usuário').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('userId').setLabel('ID do usuário').setPlaceholder('Cole o ID do Discord').setStyle(TextInputStyle.Short).setRequired(true))); return interaction.showModal(modal); }
  if (interaction.isButton() && interaction.customId === 'panel:send-dm') { if (!admin) return interaction.reply({ content: 'Somente a equipe autorizada pode enviar DMs.', ephemeral: true }); const modal = new ModalBuilder().setCustomId('panel:send-dm:modal').setTitle('Enviar mensagem privada').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('userId').setLabel('ID do usuário').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('message').setLabel('Mensagem').setStyle(TextInputStyle.Paragraph).setMaxLength(1900).setRequired(true))); return interaction.showModal(modal); }
  if (interaction.isButton() && interaction.customId === 'panel:send-channel') { if (!admin) return interaction.reply({ content: 'Somente a equipe autorizada pode enviar mensagens em canais.', ephemeral: true }); const modal = new ModalBuilder().setCustomId('panel:send-channel:modal').setTitle('Enviar mensagem no canal').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channelId').setLabel('ID do canal').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('message').setLabel('Mensagem').setStyle(TextInputStyle.Paragraph).setMaxLength(1900).setRequired(true))); return interaction.showModal(modal); }
  if (interaction.isButton() && interaction.customId === 'panel:join') { try { await joinVoice(interaction.guild, interaction.member?.voice?.channel); return interaction.reply({ content: 'Entrei na sua chamada de voz.', ephemeral: true }); } catch (err) { return interaction.reply({ content: err.message, ephemeral: true }); } }
  if (interaction.isButton() && interaction.customId === 'panel:tickets') { await interaction.channel.send({ embeds: [ticketPanelEmbed(cfg)], components: ticketPanelRows(cfg) }); return interaction.reply({ content: '✅ Central de tickets publicada neste canal.', ephemeral: true }); }
  if (interaction.isButton() && interaction.customId === 'panel:qa') { if (!cfg.qaChannelIds.includes(interaction.channelId)) cfg.qaChannelIds.push(interaction.channelId); save(); return interaction.update({ embeds: [panelEmbed(interaction.guild, cfg)], components: panelRows(cfg) }); }
  if (interaction.isButton() && interaction.customId === 'panel:admin') { cfg.adminChannelId = interaction.channelId; save(); return interaction.update({ embeds: [panelEmbed(interaction.guild, cfg)], components: panelRows(cfg) }); }
  if (interaction.isButton() && interaction.customId === 'panel:ticket-config') { const modal = new ModalBuilder().setCustomId('panel:ticket-config:modal').setTitle('Configurar tickets e IA').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ticketParentChannelId').setLabel('ID do canal dos tópicos').setPlaceholder('ID do canal de tickets').setStyle(TextInputStyle.Short).setRequired(false)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('aiRoleId').setLabel('ID do cargo que pode usar IA fora dos tickets').setPlaceholder('ID do cargo da IA').setStyle(TextInputStyle.Short).setRequired(false))); return interaction.showModal(modal); }
  if (interaction.isButton() && interaction.customId === 'panel:ticket-visual') { const field = (id, label, placeholder) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300)); const modal = new ModalBuilder().setCustomId('panel:ticket-visual:modal').setTitle('Banner e emojis dos tickets').addComponents(field('bannerUrl', 'URL do banner', 'https://.../banner.png'), field('emojiSuporte', 'Emoji de suporte', '<:suporte:ID>'), field('emojiDuvidas', 'Emoji de dúvidas', '<:interrogao:ID>'), field('emojiDenuncias', 'Emoji de denúncias', '<:exclamao:ID>'), field('emojiReembolso', 'Emoji de reembolso', '<:reembolso:ID>')); return interaction.showModal(modal); }
  if (interaction.isButton() && ['panel:create-role','panel:create-channel','panel:giveaway'].includes(interaction.customId)) {
    const modal = new ModalBuilder().setCustomId(`${interaction.customId}:modal`).setTitle(interaction.customId === 'panel:create-role' ? 'Criar cargo' : interaction.customId === 'panel:create-channel' ? 'Criar canal' : 'Novo sorteio').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel(interaction.customId === 'panel:giveaway' ? 'Descrição' : 'Nome').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)));
    return interaction.showModal(modal);
  }
  if (interaction.isModalSubmit() && interaction.customId === 'panel:report-user:modal') { const userId = interaction.fields.getTextInputValue('userId').trim(); await recordAdminAction(cfg, interaction.guild, interaction.user.id, `consultou o relatório de ${userId}`); return interaction.reply({ embeds: [userReportEmbed(cfg, userId)], ephemeral: true }); }
  if (interaction.isModalSubmit() && interaction.customId === 'panel:send-dm:modal') { const userId = interaction.fields.getTextInputValue('userId').trim(); const text = interaction.fields.getTextInputValue('message').trim(); const user = await client.users.fetch(userId).catch(() => null); if (!user) return interaction.reply({ content: 'Não encontrei esse usuário.', ephemeral: true }); try { await user.send({ content: text, allowedMentions: { parse: [] } }); await recordAdminAction(cfg, interaction.guild, interaction.user.id, `enviou uma DM para ${userId}`); return interaction.reply({ content: '✅ DM enviada com sucesso.', ephemeral: true }); } catch (_) { return interaction.reply({ content: 'Não consegui enviar a DM. O usuário pode ter mensagens privadas bloqueadas.', ephemeral: true }); } }
  if (interaction.isModalSubmit() && interaction.customId === 'panel:send-channel:modal') { const channelId = interaction.fields.getTextInputValue('channelId').trim(); const text = interaction.fields.getTextInputValue('message').trim(); const target = await interaction.guild.channels.fetch(channelId).catch(() => null); if (!target?.isTextBased()) return interaction.reply({ content: 'Não encontrei um canal de texto válido.', ephemeral: true }); await target.send({ content: text, allowedMentions: { parse: [] } }); await recordAdminAction(cfg, interaction.guild, interaction.user.id, `enviou mensagem no canal ${channelId}`); return interaction.reply({ content: `✅ Mensagem enviada em <#${channelId}>.`, ephemeral: true }); }
  if (interaction.isModalSubmit()) { if (interaction.customId === 'panel:ticket-config:modal') { cfg.ticketParentChannelId = interaction.fields.getTextInputValue('ticketParentChannelId').trim(); cfg.aiRoleId = interaction.fields.getTextInputValue('aiRoleId').trim(); save(); return interaction.reply({ content: 'Configuração de tickets e cargo da IA salva.', ephemeral: true }); } if (interaction.customId === 'panel:ticket-visual:modal') { cfg.ticketBannerUrl = interaction.fields.getTextInputValue('bannerUrl').trim(); cfg.ticketEmojis = { suporte: interaction.fields.getTextInputValue('emojiSuporte').trim(), duvidas: interaction.fields.getTextInputValue('emojiDuvidas').trim(), denuncias: interaction.fields.getTextInputValue('emojiDenuncias').trim(), reembolso: interaction.fields.getTextInputValue('emojiReembolso').trim() }; save(); return interaction.reply({ content: 'Banner e emojis dos tickets salvos. Publique a central novamente para aplicar.', ephemeral: true }); } const value = interaction.fields.getTextInputValue('value'); if (interaction.customId === 'panel:create-role:modal') { const role = await interaction.guild.roles.create({ name: value, reason: 'Painel Rynex' }); return interaction.reply({ content: `Cargo criado: <@&${role.id}>`, ephemeral: true }); } if (interaction.customId === 'panel:create-channel:modal') { const ch = await interaction.guild.channels.create({ name: value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90), type: ChannelType.GuildText, reason: 'Painel Rynex' }); return interaction.reply({ content: `Canal criado: ${ch}`, ephemeral: true }); } if (interaction.customId === 'panel:giveaway:modal') { const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway:${interaction.id}`).setLabel('Participar').setStyle(ButtonStyle.Success)); await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('🎉 Sorteio Rynex').setDescription(value)], components: [row] }); return interaction.reply({ content: 'Sorteio criado.', ephemeral: true }); } }
  } catch (err) { console.error('Interação expirada ou falhou:', err.code || err.message); if (!interaction.replied && !interaction.deferred) { try { await interaction.reply({ content: 'Este painel expirou. Digite `!painel` para abrir um novo.', ephemeral: true }); } catch (_) {} } }
});

const app = express(); app.use(express.json());
const panelKey = process.env.ADMIN_PANEL_KEY || 'troque-esta-chave';
app.get('/', (_, res) => res.send('<h1>Rynex online</h1><p>Bot Discord ativo.</p>'));
app.get('/health', (_, res) => res.json({ ok: true, bot: client.user?.tag || null }));
app.get('/api/config/:guildId', (req, res) => { if (req.headers.authorization !== `Bearer ${panelKey}`) return res.status(401).json({ error: 'unauthorized' }); res.json(getGuild(req.params.guildId)); });
app.post('/api/config/:guildId', (req, res) => { if (req.headers.authorization !== `Bearer ${panelKey}`) return res.status(401).json({ error: 'unauthorized' }); const cfg = getGuild(req.params.guildId); const allowed = ['enabled','adminRoleId','adminChannelId','qaChannelIds','blockedUserIds']; for (const k of allowed) if (req.body[k] !== undefined) cfg[k] = req.body[k]; save(); res.json(cfg); });
const port = Number(process.env.PORT || 3000); app.listen(port, '0.0.0.0', () => console.log(`Painel HTTP na porta ${port}`));
async function loginWithRetry() {
  if (!process.env.DISCORD_TOKEN) return console.error('DISCORD_TOKEN não configurado.');
  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    console.error(`Falha ao conectar ao Discord (${err.code || err.message}). Nova tentativa em 10 segundos.`);
    setTimeout(loginWithRetry, 10000);
  }
}
loginWithRetry();
