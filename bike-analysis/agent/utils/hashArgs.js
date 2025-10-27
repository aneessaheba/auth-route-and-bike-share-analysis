const crypto = require('crypto');

function hashArgs(args) {
  const json = JSON.stringify(args, Object.keys(args).sort());
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
}

module.exports = { hashArgs };
