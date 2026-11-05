'use strict';

const { version } = require('../package.json');

function health(_req, res) {
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, uptime: process.uptime(), version });
}

module.exports = { health };
