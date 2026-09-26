const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml, isValidPluginId } = require('../security-utils');

const projectRoot = path.resolve(__dirname, '..');

test('escapes executable markup from untrusted content', () => {
  const payload = '<img src=x onerror="window.__atomic_test = true">';
  const escaped = escapeHtml(payload);
  assert.equal(escaped, '&lt;img src=x onerror=&quot;window.__atomic_test = true&quot;&gt;');
  assert.equal(escaped.includes('<img'), false);
});

test('accepts normal plugin IDs and rejects path traversal', () => {
  for (const pluginId of ['word-counter', 'vendor.plugin_2', 'a']) {
    assert.equal(isValidPluginId(pluginId), true, pluginId);
  }
  for (const pluginId of ['../escape', '../../escape', '/absolute', '.', '..', 'a/b', 'a\\b', '']) {
    assert.equal(isValidPluginId(pluginId), false, pluginId);
  }
});

test('renderer policy blocks eval and inline event handlers', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /unsafe-eval|\son\w+=/i);
  assert.doesNotMatch(renderer, /\bnew Function\s*\(|\beval\s*\(/);
});

test('main process enables sandboxing and validates IPC registration', () => {
  const main = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /will-navigate/);
  assert.match(main, /function isTrustedIpcSender/);
  assert.doesNotMatch(main.replace(/ipcMain\.(?:handle|on)\(channel,/g, ''), /ipcMain\.(?:handle|on)\(/);
});
