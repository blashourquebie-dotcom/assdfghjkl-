const queues = new Map();

const withRoleLimitLock = async (guildId, roleId, task) => {
  const key = `${guildId}:${roleId}`;
  const previous = queues.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const current = previous.catch(() => null).then(() => gate);
  queues.set(key, current);
  await previous.catch(() => null);
  try { return await task(); }
  finally {
    release();
    if (queues.get(key) === current) queues.delete(key);
  }
};

module.exports = { withRoleLimitLock };
