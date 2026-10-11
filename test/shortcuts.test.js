const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadShortcutHandler() {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const start = source.indexOf("win.webContents.on('before-input-event'");
  const end = source.indexOf('  const sendMenuAction', start);
  let handler;
  const sent = [];
  vm.runInNewContext(source.slice(start, end), {
    win: { webContents: {
      on: (name, callback) => { handler = callback; },
      send: (channel, action) => sent.push({ channel, action })
    } }
  });
  return { handler, sent };
}

test('Cmd and Ctrl dispatch file shortcuts once before editor handling', () => {
  const shortcuts = { n: 'new-file', o: 'open-file', s: 'save', w: 'close-active', f: 'find' };
  for (const modifier of ['meta', 'control']) {
    for (const [key, action] of Object.entries(shortcuts)) {
      const { handler, sent } = loadShortcutHandler();
      let prevented = 0;
      handler({ preventDefault: () => prevented++ }, { type: 'keyDown', key, [modifier]: true });
      assert.equal(prevented, 1);
      assert.deepEqual(sent, [{ channel: 'menu:action', action }]);
    }
  }
});

test('shortcuts preserve unrelated keys and prevent repeated dialogs', () => {
  const { handler, sent } = loadShortcutHandler();
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  for (const input of [
    { type: 'keyDown', key: 'n' },
    { type: 'keyUp', key: 'n', meta: true },
    { type: 'keyDown', key: 's', control: true, alt: true },
    { type: 'keyDown', key: 'w', meta: true, shift: true },
    { type: 'keyDown', key: 'c', control: true }
  ]) handler(event, input);
  assert.equal(prevented, 0);
  assert.deepEqual(sent, []);

  handler(event, { type: 'keyDown', key: 'O', control: true, shift: true });
  handler(event, { type: 'keyDown', key: 'P', meta: true, shift: true });
  handler(event, { type: 'keyDown', key: 'o', meta: true, isAutoRepeat: true });
  assert.equal(prevented, 3);
  assert.deepEqual(sent.map(item => item.action), ['open-folder', 'command-palette']);
});

test('menu actions reach new, find, save, and the active pane for open and close', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
  const start = source.indexOf('window.electronAPI.onMenuAction(');
  const end = source.indexOf('// --- Theme Marketplace Logic ---', start);
  let handler;
  const calls = [];
  const activePath = '/workspace/file"with-quotes.js';
  vm.runInNewContext(source.slice(start, end), {
    window: { electronAPI: {
      onMenuAction: callback => { handler = callback; },
      openFile: async () => ({ path: '/workspace/open.js', name: 'open.js' })
    } },
    activeEditorPane: 'right',
    currentFilePath: '/workspace/left.js',
    currentFilePathRight: activePath,
    createNewUntitledFile: async () => calls.push('new'),
    searchInCurrentFile: () => calls.push('find'),
    saveCurrentFile: async () => calls.push('save'),
    openFile: async (...args) => calls.push(args),
    document: { getElementById: id => {
      if (id === 'tabs-right') return { querySelectorAll: () => [{
        dataset: { path: activePath },
        querySelector: () => ({ click: () => calls.push('close-right') })
      }] };
      if (id.startsWith('tabs-')) throw new Error('Wrong pane');
      return { classList: { remove() {} }, style: {} };
    } }
  });
  for (const action of ['new-file', 'find', 'save', 'open-file', 'close-active']) await handler(action);
  assert.deepEqual(calls, ['new', 'find', 'save', ['/workspace/open.js', 'open.js', 'right'], 'close-right']);
});
