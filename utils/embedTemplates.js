const { EmbedBuilder } = require('discord.js');
const { readConfig, saveConfig } = require('./database');

const getTemplate = (command, key) => {
  const cfg = readConfig();
  return cfg?.meta?.embeds?.[command]?.[key] || null;
};

const renderTemplate = (command, key, vars = {}) => {
  const tpl = getTemplate(command, key);
  if (!tpl) return null;

  const replace = (s) => {
    if (typeof s !== 'string') return s;
    return s.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
  };

  const embed = new EmbedBuilder();
  if (tpl.title) embed.setTitle(replace(tpl.title));
  if (tpl.description) embed.setDescription(replace(tpl.description));
  if (tpl.color) embed.setColor(tpl.color);
  if (tpl.thumbnail) embed.setThumbnail(replace(tpl.thumbnail));
  if (tpl.fields && Array.isArray(tpl.fields)) {
    embed.addFields(tpl.fields.map(f => ({ name: replace(f.name), value: replace(f.value), inline: !!f.inline })));
  }
  return embed;
};

const setTemplate = (command, key, obj) => {
  const cfg = readConfig();
  if (!cfg.meta) cfg.meta = {};
  if (!cfg.meta.embeds) cfg.meta.embeds = {};
  if (!cfg.meta.embeds[command]) cfg.meta.embeds[command] = {};
  cfg.meta.embeds[command][key] = obj;
  saveConfig(cfg);
  return true;
};

module.exports = { getTemplate, renderTemplate, setTemplate };
