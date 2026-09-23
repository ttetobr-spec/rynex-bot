const path = require('path');

const RARITY_PROBABILITIES = Object.freeze({
  Comum: 62,
  Raro: 20,
  Épico: 9,
  Lendário: 5,
  Supremo: 2.5,
  Insano: 1.3,
  Limitado: 0.2,
});

const DEFAULT_CARDS = Object.freeze({
  'ceala': {
    name: 'Cealá’',
    rarity: 'Comum',
    price: 0.92,
    image: path.join(__dirname, 'assets', 'cards', 'ceala.png'),
  },
});

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .trim();
}

function ensureCards(cfg) {
  cfg.cards ||= {};
  for (const [key, card] of Object.entries(DEFAULT_CARDS)) {
    cfg.cards[key] ||= { ...card };
    cfg.cards[key].rarity ||= card.rarity;
    cfg.cards[key].price ??= card.price;
    cfg.cards[key].image ||= card.image;
  }
  return cfg.cards;
}

function findCard(cards, name) {
  const normalized = normalizeName(name);
  return Object.values(cards || {}).find(card => normalizeName(card.name) === normalized);
}

function formatPrice(price) {
  return Number(price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

module.exports = {
  DEFAULT_CARDS,
  RARITY_PROBABILITIES,
  ensureCards,
  findCard,
  formatPrice,
  normalizeName,
};
