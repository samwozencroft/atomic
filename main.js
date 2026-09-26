const { app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, safeStorage, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile, spawn } = require('node:child_process');
const { webcrypto } = require('node:crypto');
const { fileURLToPath, pathToFileURL } = require('node:url');
const pty = require('node-pty');
const util = require('node:util');
const { isValidPluginId } = require('./security-utils');
const execFileAsync = util.promisify(execFile);

const approvedPathsBySender = new Map();
const expectedRendererPath = path.resolve(__dirname, 'index.html');

function isPathWithin(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function canonicalizePath(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.length === 0 || inputPath.includes('\0')) {
    throw new Error('Invalid path');
  }

  let probe = path.resolve(inputPath);
  const missingSegments = [];
  while (true) {
    try {
      const realPath = await fs.realpath(probe);
      return path.join(realPath, ...missingSegments.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(probe);
      if (parent === probe) throw error;
      missingSegments.push(path.basename(probe));
      probe = parent;
    }
  }
}

function senderPermissions(event) {
  const senderId = event.sender.id;
  if (!approvedPathsBySender.has(senderId)) {
    approvedPathsBySender.set(senderId, { roots: new Set(), files: new Set() });
  }
  return approvedPathsBySender.get(senderId);
}

async function approveRoot(event, rootPath) {
  senderPermissions(event).roots.add(await canonicalizePath(rootPath));
}

async function approveFile(event, filePath) {
  senderPermissions(event).files.add(await canonicalizePath(filePath));
}

async function assertApprovedPath(event, targetPath) {
  const canonicalTarget = await canonicalizePath(targetPath);
  const permissions = senderPermissions(event);
  if (permissions.files.has(canonicalTarget)) return canonicalTarget;
  if ([...permissions.roots].some(rootPath => isPathWithin(rootPath, canonicalTarget))) return canonicalTarget;
  throw new Error('Path is outside the folders approved for this window');
}

function isTrustedIpcSender(event) {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  try {
    const senderUrl = new URL(event.senderFrame.url);
    return senderUrl.protocol === 'file:' && path.resolve(fileURLToPath(senderUrl)) === expectedRendererPath;
  } catch (error) {
    return false;
  }
}

async function authorizeIpcPath(channel, event, args) {
  const payload = args[0];
  if (channel.startsWith('fs:') && channel !== 'fs:searchWorkspace') {
    const paths = channel === 'fs:rename' ? [args[0], args[1]] : [args[0]];
    for (const targetPath of paths) {
      const canonicalTarget = await assertApprovedPath(event, targetPath);
      if ((channel === 'fs:delete' || channel === 'fs:rename') && senderPermissions(event).roots.has(canonicalTarget)) {
        throw new Error('Cannot delete or rename an approved workspace root');
      }
    }
    return;
  }

  if (channel === 'fs:searchWorkspace') {
    await assertApprovedPath(event, payload?.dirPath);
    return;
  }

  if (channel.startsWith('git:')) {
    const dirPath = typeof payload === 'string' ? payload : payload?.dirPath;
    const canonicalRoot = await assertApprovedPath(event, dirPath);
    const relativePaths = [payload?.filePath, ...(Array.isArray(payload?.files) ? payload.files : [])].filter(Boolean);
    for (const relativePath of relativePaths) {
      if (path.isAbsolute(relativePath) || !isPathWithin(canonicalRoot, path.resolve(canonicalRoot, relativePath))) {
        throw new Error('Git path escapes the approved workspace');
      }
    }
    return;
  }

  if (channel === 'terminal:exec' || channel === 'terminal:spawnPty') {
    if (payload?.cwd) await assertApprovedPath(event, payload.cwd);
    return;
  }

  if (channel === 'lsp:start' && payload?.rootPath) {
    await assertApprovedPath(event, payload.rootPath);
  }
}

function handleTrusted(channel, listener) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedIpcSender(event)) throw new Error('Untrusted IPC sender');
    await authorizeIpcPath(channel, event, args);
    return listener(event, ...args);
  });
}

function onTrusted(channel, listener) {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedIpcSender(event)) return;
    listener(event, ...args);
  });
}

const developerKeyPath = () => path.join(app.getPath('userData'), 'developer-signing-key.enc');

async function persistDeveloperKeyPair(keyData) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential storage is unavailable');
  const encrypted = safeStorage.encryptString(JSON.stringify(keyData));
  await fs.writeFile(developerKeyPath(), encrypted, { mode: 0o600 });
}

async function readDeveloperKeyData() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential storage is unavailable');
  try {
    const encrypted = await fs.readFile(developerKeyPath());
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function getOrCreateDeveloperKeyData() {
  const existing = await readDeveloperKeyData();
  if (existing) return existing;

  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const keyData = {
    publicKeyJwk: await webcrypto.subtle.exportKey('jwk', keyPair.publicKey),
    privateKeyJwk: await webcrypto.subtle.exportKey('jwk', keyPair.privateKey)
  };
  await persistDeveloperKeyPair(keyData);
  return keyData;
}

async function validateDeveloperKeyData(keyData) {
  if (!keyData?.publicKeyJwk || !keyData?.privateKeyJwk) return false;
  const privateKey = await webcrypto.subtle.importKey(
    'jwk', keyData.privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const publicKey = await webcrypto.subtle.importKey(
    'jwk', keyData.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
  );
  const message = Buffer.from('atomic-key-validation');
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, message);
  return webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, message);
}

const LSP_SERVER_CONFIGS = {
  javascript: { command: 'typescript-language-server', args: ['--stdio'], label: 'TypeScript Language Server' },
  typescript: { command: 'typescript-language-server', args: ['--stdio'], label: 'TypeScript Language Server' },
  javascriptreact: { command: 'typescript-language-server', args: ['--stdio'], label: 'TypeScript Language Server' },
  typescriptreact: { command: 'typescript-language-server', args: ['--stdio'], label: 'TypeScript Language Server' },
  python: { command: 'pyright-langserver', args: ['--stdio'], label: 'Pyright' },
  go: { command: 'gopls', args: ['serve'], label: 'gopls' },
  rust: { command: 'rust-analyzer', args: [], label: 'Rust Analyzer' },
  shell: { command: 'bash-language-server', args: ['start'], label: 'Bash Language Server' },
  yaml: { command: 'yaml-language-server', args: ['--stdio'], label: 'YAML Language Server' },
  json: { command: 'vscode-json-language-server', args: ['--stdio'], label: 'JSON Language Server' }
};

function pathToLspUri(filePath) {
  try { return pathToFileURL(filePath).href; } catch (e) { return `file://${filePath}`; }
}

function uriToLspPath(uri) {
  try { return fileURLToPath(uri); } catch (e) { return uri; }
}


let mainWindow; // Keep reference to first window for legacy checks if any, though we should try to avoid it
const windowStates = new Map();

function createWindow(initialState = null, approvedInitialFile = null) {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    title: "Atomic",
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  const webContentsId = win.webContents.id;

  if (initialState) {
    windowStates.set(win.id, initialState);
  }
  if (approvedInitialFile) {
    approvedPathsBySender.set(webContentsId, { roots: new Set(), files: new Set([approvedInitialFile]) });
  }

  win.loadFile('index.html');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      if (path.resolve(fileURLToPath(navigationUrl)) === expectedRendererPath) return;
    } catch (error) {}
    event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[Renderer ${win.id}] ${message}`);
  });

  win.on('closed', () => {
    windowStates.delete(win.id);
    approvedPathsBySender.delete(webContentsId);
    stopLspServersForWindow(win.id);
  });
  
  if (!mainWindow) mainWindow = win;
  
  // Native Menu Template
  const isMac = process.platform === 'darwin';
  const sendMenuAction = (action) => {
    const focusedWin = BrowserWindow.getFocusedWindow() || win;
    if (focusedWin && !focusedWin.isDestroyed()) {
      focusedWin.webContents.send('menu:action', action);
    }
  };
const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('open-file')
        },
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => sendMenuAction('open-folder')
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('save')
        },
        { type: 'separator' },
        {
          label: 'Close Active Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendMenuAction('close-active')
        },
        {
          label: 'Close Other Tabs',
          click: () => sendMenuAction('close-others')
        },
        {
          label: 'Close All Tabs',
          click: () => sendMenuAction('close-all')
        },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          {
            label: 'Speech',
            submenu: [
              { role: 'startSpeaking' },
              { role: 'stopSpeaking' }
            ]
          }
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ])
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette...',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => sendMenuAction('command-palette')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Auto Updater Logic
  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('update-available', () => {
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('update_available'));
  });

  autoUpdater.on('update-downloaded', () => {
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('update_downloaded'));
  });
}

// IPC handler for restarting the app after update download
onTrusted('restart_app', () => {
  if (process.platform === 'darwin') {
    require('electron').shell.openExternal('https://github.com/samwozencroft/atomic/releases/latest');
  } else {
    autoUpdater.quitAndInstall();
  }
});

onTrusted('app:reportIssue', () => {
  require('electron').shell.openExternal('https://github.com/samwozencroft/atomic/issues');
});

handleTrusted('app:getVersion', () => {
  return app.getVersion();
});

handleTrusted('app:getNativeTheme', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

handleTrusted('app:getCustomThemePath', async (event) => {
  const themePath = path.join(app.getPath('userData'), 'custom-theme.css');
  await approveFile(event, themePath);
  return themePath;
});

handleTrusted('app:initCustomTheme', async () => {
  const themePath = path.join(app.getPath('userData'), 'custom-theme.css');
  try {
    await fs.access(themePath);
  } catch {
    const template = `/* Atomic Custom Theme */
/* Modify these variables to customize your editor's appearance */
/* Press Cmd+S to see your changes instantly applied */

[data-theme="custom"] {
  --bg-dark: #282c34;
  --bg-darker: #21252b;
  --bg-darkest: #181a1f;
  --text-normal: #abb2bf;
  --text-muted: #5c6370;
  --border-color: #181a1f;
  --accent-blue: #61afef;
  --accent-purple: #c678dd;
  --hover-bg: #2c313a;
  --active-bg: #323842;
  --tab-bg: #21252b;
  --tab-active-bg: #282c34;
  --menu-bg: #2c313a;
  --menu-hover: #3e4451;
}
`;
    await fs.writeFile(themePath, template, 'utf-8');
  }
  return true;
});

handleTrusted('app:resetCustomTheme', async () => {
  const themePath = path.join(app.getPath('userData'), 'custom-theme.css');
  const template = `/* Atomic Custom Theme */
/* Modify these variables to customize your editor's appearance */
/* Press Cmd+S to see your changes instantly applied */

[data-theme="custom"] {
  --bg-dark: #282c34;
  --bg-darker: #21252b;
  --bg-darkest: #181a1f;
  --text-normal: #abb2bf;
  --text-muted: #5c6370;
  --border-color: #181a1f;
  --accent-blue: #61afef;
  --accent-purple: #c678dd;
  --hover-bg: #2c313a;
  --active-bg: #323842;
  --tab-bg: #21252b;
  --tab-active-bg: #282c34;
  --menu-bg: #2c313a;
  --menu-hover: #3e4451;
}
`;
  await fs.writeFile(themePath, template, 'utf-8');
  return true;
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();

  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('theme_updated'));
    }
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});


onTrusted('window:createNew', async (event, payload) => {
  const approvedInitialFile = payload?.filePath
    ? await assertApprovedPath(event, payload.filePath)
    : null;
  createWindow(payload, approvedInitialFile);
});

handleTrusted('window:getInitialState', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && windowStates.has(win.id)) {
    const state = windowStates.get(win.id);
    windowStates.delete(win.id);
    return state;
  }
  return null;
});

// Existing IPC Handlers
handleTrusted('dialog:openDirectory', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (canceled) {
    return null;
  } else {
    await approveRoot(event, filePaths[0]);
    return filePaths[0];
  }
});

handleTrusted('dialog:openFile', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile']
  });
  if (canceled) {
    return null;
  } else {
    await approveRoot(event, path.dirname(filePaths[0]));
    return {
      path: filePaths[0],
      name: path.basename(filePaths[0])
    };
  }
});

handleTrusted('fs:readDir', async (event, dirPath) => {
  try {
    const targetDir = (!dirPath || dirPath === '.') ? process.cwd() : dirPath;
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      path: path.join(targetDir, entry.name)
    })).sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    console.error('Failed to read directory:', error);
    return [];
  }
});

handleTrusted('fs:readFile', async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    console.error('Failed to read file:', error);
    return null;
  }
});

handleTrusted('fs:writeFile', async (event, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return true;
  } catch (error) {
    console.error('Failed to write file:', error);
    return false;
  }
});

handleTrusted('fs:mkdir', async (event, dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return true;
  } catch (error) {
    return false;
  }
});

handleTrusted('fs:rename', async (event, oldPath, newPath) => {
  try {
    await fs.rename(oldPath, newPath);
    return true;
  } catch (error) {
    return false;
  }
});

handleTrusted('fs:delete', async (event, targetPath) => {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    return false;
  }
});

handleTrusted('fs:copy', async (event, targetPath) => {
  try {
    const parsed = require('path').parse(targetPath);
    const newPath = require('path').join(parsed.dir, `${parsed.name}-copy${parsed.ext}`);
    await fs.copyFile(targetPath, newPath);
    return true;
  } catch (error) {
    return false;
  }
});

handleTrusted('fs:openInFinder', async (event, targetPath) => {
  try {
    require('electron').shell.showItemInFolder(targetPath);
    return true;
  } catch (error) {
    return false;
  }
});

const os = require('os');
let previousCpuInfo = os.cpus();

handleTrusted('app:getSystemStats', () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = Math.round((usedMem / totalMem) * 100);

  const currentCpuInfo = os.cpus();
  let idleDiff = 0;
  let totalDiff = 0;

  for (let i = 0; i < currentCpuInfo.length; i++) {
    const cpu = currentCpuInfo[i];
    const prevCpu = previousCpuInfo[i];
    
    const prevTotal = Object.values(prevCpu.times).reduce((a, b) => a + b, 0);
    const currTotal = Object.values(cpu.times).reduce((a, b) => a + b, 0);

    idleDiff += cpu.times.idle - prevCpu.times.idle;
    totalDiff += currTotal - prevTotal;
  }

  const cpuPercent = totalDiff === 0 ? 0 : Math.round(100 - (100 * idleDiff / totalDiff));
  previousCpuInfo = currentCpuInfo;

  return { cpu: cpuPercent, memory: memPercent };
});

handleTrusted('dialog:showSaveDialog', async (event, defaultPath) => {
  const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    defaultPath,
    properties: ['showOverwriteConfirmation']
  });
  if (result.canceled) return null;
  await approveRoot(event, path.dirname(result.filePath));
  return result.filePath;
});

handleTrusted('git:getStatus', async (event, dirPath) => {
  if (!dirPath) return { isRepo: false, error: 'No workspace folder opened' };
  try {
    await execFileAsync('git', ['--version']);
  } catch (err) {
    return { isRepo: false, gitInstalled: false, error: 'Git is not installed or not in PATH' };
  }

  try {
    const { stdout: isRepoOut } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dirPath });
    if (isRepoOut.trim() !== 'true') {
      return { isRepo: false, gitInstalled: true };
    }

    let branch = 'HEAD';
    try {
      const { stdout: branchOut } = await execFileAsync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: dirPath });
      branch = branchOut.trim();
    } catch (e) {
      try {
        const { stdout: revOut } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dirPath });
        branch = revOut.trim() || 'DETACHED';
      } catch (e2) {
        branch = 'main';
      }
    }

    const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain=v1', '-u'], { cwd: dirPath });
    const lines = statusOut.split('\n').filter(l => l.length > 0);
    const files = lines.map(line => {
      const x = line[0];
      const y = line[1];
      const filePath = line.substring(3).trim();
      let status = 'modified';
      if (x === '?' && y === '?') status = 'untracked';
      else if (x === 'A' || y === 'A') status = 'added';
      else if (x === 'D' || y === 'D') status = 'deleted';
      else if (x === 'M' || y === 'M') status = 'modified';
      else if (x === 'R' || y === 'R') status = 'renamed';

      return {
        path: filePath,
        fullPath: path.join(dirPath, filePath),
        status,
        indexStatus: x,
        workingTreeStatus: y
      };
    });

    return {
      isRepo: true,
      gitInstalled: true,
      branch,
      files,
      stats: {
        total: files.length,
        modified: files.filter(f => f.status === 'modified').length,
        added: files.filter(f => f.status === 'added').length,
        deleted: files.filter(f => f.status === 'deleted').length,
        untracked: files.filter(f => f.status === 'untracked').length
      }
    };
  } catch (err) {
    return { isRepo: false, gitInstalled: true, error: err.message };
  }
});

handleTrusted('git:getSyncStatus', async (event, dirPath) => {
  if (!dirPath) return { success: false, ahead: 0, behind: 0 };
  try {
    let ahead = 0;
    let behind = 0;
    try {
      const { stdout: aheadOut } = await execFileAsync('git', ['rev-list', '--count', '@{u}..HEAD'], { cwd: dirPath });
      ahead = parseInt(aheadOut.trim()) || 0;
    } catch (e) {}
    try {
      const { stdout: behindOut } = await execFileAsync('git', ['rev-list', '--count', 'HEAD..@{u}'], { cwd: dirPath });
      behind = parseInt(behindOut.trim()) || 0;
    } catch (e) {}
    return { success: true, ahead, behind };
  } catch (err) {
    return { success: false, ahead: 0, behind: 0, error: err.message };
  }
});

handleTrusted('git:stageFile', async (event, { dirPath, filePath }) => {
  try {
    await execFileAsync('git', ['add', filePath], { cwd: dirPath });
    return true;
  } catch (err) {
    return false;
  }
});

handleTrusted('git:unstageFile', async (event, { dirPath, filePath }) => {
  try {
    await execFileAsync('git', ['reset', 'HEAD', filePath], { cwd: dirPath });
    return true;
  } catch (err) {
    return false;
  }
});

handleTrusted('git:commit', async (event, { dirPath, message, files }) => {
  if (!dirPath || !message) return { success: false, error: 'Missing parameter' };
  try {
    // Unstage everything first
    try {
      await execFileAsync('git', ['reset'], { cwd: dirPath });
    } catch (e) {}

    // Stage only the selected files
    if (files && files.length > 0) {
      for (const file of files) {
        await execFileAsync('git', ['add', file], { cwd: dirPath });
      }
    } else {
      // Fallback: stage nothing if empty array passed
      return { success: false, error: 'No files selected for commit' };
    }

    const { stdout } = await execFileAsync('git', ['commit', '-m', message], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:getBranches', async (event, dirPath) => {
  if (!dirPath) return { success: false, error: 'No directory' };
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--list'], { cwd: dirPath });
    const lines = stdout.split('\n').filter(l => l.trim().length > 0);
    const branches = lines.map(l => {
      const current = l.startsWith('*');
      const name = l.replace('*', '').trim();
      return { name, current };
    });
    return { success: true, branches };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:checkoutBranch', async (event, { dirPath, branchName }) => {
  if (!dirPath || !branchName) return { success: false, error: 'Missing parameter' };
  try {
    const { stdout } = await execFileAsync('git', ['checkout', branchName], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:createBranch', async (event, { dirPath, branchName }) => {
  if (!dirPath || !branchName) return { success: false, error: 'Missing parameter' };
  try {
    const { stdout } = await execFileAsync('git', ['checkout', '-b', branchName], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:push', async (event, dirPath) => {
  if (!dirPath) return { success: false, error: 'No workspace opened' };
  try {
    const { stdout } = await execFileAsync('git', ['push'], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:pull', async (event, dirPath) => {
  if (!dirPath) return { success: false, error: 'No workspace opened' };
  try {
    const { stdout } = await execFileAsync('git', ['pull'], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:fetch', async (event, dirPath) => {
  if (!dirPath) return { success: false, error: 'No workspace opened' };
  try {
    const { stdout } = await execFileAsync('git', ['fetch'], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:stash', async (event, { dirPath, message }) => {
  if (!dirPath) return { success: false, error: 'No workspace opened' };
  try {
    const args = message ? ['stash', 'save', message] : ['stash'];
    const { stdout } = await execFileAsync('git', args, { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:stashPop', async (event, dirPath) => {
  if (!dirPath) return { success: false, error: 'No workspace opened' };
  try {
    const { stdout } = await execFileAsync('git', ['stash', 'pop'], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:merge', async (event, { dirPath, branchName }) => {
  if (!dirPath || !branchName) return { success: false, error: 'Missing parameter' };
  try {
    const { stdout } = await execFileAsync('git', ['merge', branchName], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:getHistory', async (event, dirPath) => {
  if (!dirPath) return { success: false, error: 'No workspace folder opened' };
  try {
    const { stdout } = await execFileAsync('git', ['log', '-n', '30', '--pretty=format:%h|%an|%ar|%s'], { cwd: dirPath });
    const commits = stdout.split('\n').filter(Boolean).map(line => {
      const [hash, author, date, message] = line.split('|');
      return { hash, author, date, message };
    });
    return { success: true, commits };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:getGraph', async (event, dirPath) => {
  if (!dirPath) return { success: false, error: 'No workspace folder opened' };
  try {
    const { stdout } = await execFileAsync('git', ['log', '--graph', '--oneline', '--all', '--decorate', '-n', '30'], { cwd: dirPath });
    return { success: true, graph: stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:getFileDiff', async (event, { dirPath, filePath, staged }) => {
  if (!dirPath || !filePath) return { success: false, error: 'Missing parameters' };
  try {
    // Get raw original file from git (show HEAD:file)
    let original = '';
    try {
      const { stdout } = await execFileAsync('git', ['show', `HEAD:${filePath}`], { cwd: dirPath });
      original = stdout;
    } catch (e) {
      // File might be untracked/newly created, so original is empty
    }

    // Get current working version
    const fsSync = require('node:fs');
    const fullPath = path.join(dirPath, filePath);
    let current = '';
    if (fsSync.existsSync(fullPath)) {
      current = fsSync.readFileSync(fullPath, 'utf8');
    }

    return { success: true, original, current };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:stagePath', async (event, { dirPath, filePath }) => {
  if (!dirPath || !filePath) return { success: false, error: 'Missing parameters' };
  try {
    await execFileAsync('git', ['add', filePath], { cwd: dirPath });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:unstagePath', async (event, { dirPath, filePath }) => {
  if (!dirPath || !filePath) return { success: false, error: 'Missing parameters' };
  try {
    await execFileAsync('git', ['reset', 'HEAD', '--', filePath], { cwd: dirPath });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:getBlame', async (event, { dirPath, filePath }) => {
  if (!dirPath || !filePath) return { success: false, error: 'Missing parameters' };
  try {
    const { stdout } = await execFileAsync('git', ['blame', '--porcelain', filePath], { cwd: dirPath });
    return { success: true, blame: stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:getConflicts', async (event, dirPath) => {
  if (!dirPath) return { success: false, error: 'No workspace folder opened' };
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: dirPath });
    const conflicts = stdout.split('\n').filter(Boolean);
    return { success: true, conflicts };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('git:resolveConflict', async (event, { dirPath, filePath, choice }) => {
  if (!dirPath || !filePath || !choice) return { success: false, error: 'Missing parameters' };
  try {
    const mode = choice === 'ours' ? '--ours' : '--theirs';
    await execFileAsync('git', ['checkout', mode, '--', filePath], { cwd: dirPath });
    await execFileAsync('git', ['add', filePath], { cwd: dirPath });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('fs:searchWorkspace', async (event, { dirPath, query }) => {
  if (!dirPath || !query || query.trim().length === 0) return [];
  const results = [];
  const q = query.toLowerCase().trim();
  const maxResults = 60;

  const ignoredDirs = new Set(['node_modules', '.git', '.next', '.cache', 'dist', 'build', 'out', '.output', '.storybook']);
  const binaryExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf', '.zip', '.tar', '.gz', '.7z', '.exe', '.dll', '.so', '.dylib', '.pyc', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.mov', '.lock', '.sqlite', '.db', '.DS_Store']);

  async function walk(currentDir) {
    if (results.length >= maxResults) return;
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        if (ignoredDirs.has(entry.name)) continue;
        
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(dirPath, fullPath);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (binaryExts.has(ext)) continue;

          // 1. Match File Name
          if (entry.name.toLowerCase().includes(q) || relPath.toLowerCase().includes(q)) {
            results.push({
              type: 'file',
              name: entry.name,
              relPath,
              fullPath
            });
          }

          // 2. Match File Text Content
          try {
            const stat = await fs.stat(fullPath);
            if (stat.size < 1000000) { // < 1MB
              const content = await fs.readFile(fullPath, 'utf-8');
              if (content.toLowerCase().includes(q)) {
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (results.length >= maxResults) break;
                  if (lines[i].toLowerCase().includes(q)) {
                    results.push({
                      type: 'text',
                      name: entry.name,
                      relPath,
                      fullPath,
                      lineNumber: i + 1,
                      lineText: lines[i].trim()
                    });
                  }
                }
              }
            }
          } catch (e) {}
        }
      }
    } catch (err) {}
  }

  await walk(dirPath);
  return results;
});

const activeTerminalProcesses = new Map();

handleTrusted('terminal:getShell', () => {
  if (process.platform === 'win32') return { name: 'PowerShell', platform: 'win32' };
  if (process.platform === 'darwin') {
    const sh = process.env.SHELL ? path.basename(process.env.SHELL) : 'zsh';
    return { name: `Terminal (${sh})`, platform: 'darwin' };
  }
  const sh = process.env.SHELL ? path.basename(process.env.SHELL) : 'bash';
  return { name: `Terminal (${sh})`, platform: 'linux' };
});

handleTrusted('terminal:exec', async (event, { command, cwd }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const winId = win ? win.id : 1;

  if (activeTerminalProcesses.has(winId)) {
    try { activeTerminalProcesses.get(winId).kill('SIGINT'); } catch(e){}
  }

  const targetCwd = cwd || process.cwd();
  return new Promise((resolve) => {
    let shell, args;
    if (process.platform === 'win32') {
      shell = 'powershell.exe';
      args = ['-NoProfile', '-Command', command];
    } else {
      shell = process.env.SHELL || '/bin/sh';
      args = ['-c', command];
    }

    const customEnv = { ...process.env, TERM: 'xterm-256color', COLUMNS: '120', LINES: '30' };
    const child = spawn(shell, args, { cwd: targetCwd, env: customEnv });
    activeTerminalProcesses.set(winId, child);

    child.stdout.on('data', (data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('terminal:data', { type: 'stdout', data: data.toString() });
      }
    });

    child.stderr.on('data', (data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('terminal:data', { type: 'stderr', data: data.toString() });
      }
    });

    child.on('error', (err) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('terminal:data', { type: 'stderr', data: err.message + '\n' });
      }
      activeTerminalProcesses.delete(winId);
      resolve({ exitCode: 1 });
    });

    child.on('close', (code) => {
      activeTerminalProcesses.delete(winId);
      if (!event.sender.isDestroyed()) {
        event.sender.send('terminal:exit', { exitCode: code });
      }
      resolve({ exitCode: code });
    });
  });
});

handleTrusted('terminal:writeInput', (event, input) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const winId = win ? win.id : 1;
  const child = activeTerminalProcesses.get(winId);
  if (child && child.stdin && !child.killed) {
    try {
      child.stdin.write(input);
      return true;
    } catch(e){}
  }
  return false;
});

handleTrusted('terminal:kill', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const winId = win ? win.id : 1;
  const child = activeTerminalProcesses.get(winId);
  if (child && !child.killed) {
    try {
      child.kill('SIGINT');
      setTimeout(() => {
        if (activeTerminalProcesses.has(winId)) {
          try { child.kill('SIGKILL'); } catch(e){}
        }
      }, 400);
    } catch(e){}
    activeTerminalProcesses.delete(winId);
    return true;
  }
  return false;
});

const activePtySessions = new Map();

handleTrusted('terminal:spawnPty', (event, { cols, rows, cwd }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const winId = win ? win.id : 1;

  if (activePtySessions.has(winId)) {
    try { activePtySessions.get(winId).kill(); } catch(e){}
    activePtySessions.delete(winId);
  }

  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/zsh');
  const targetCwd = cwd || process.cwd();

  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      try {
        const fsSync = require('node:fs');
        const helperPath = path.join(__dirname, 'node_modules', 'node-pty', 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
        if (fsSync.existsSync(helperPath)) {
          fsSync.chmodSync(helperPath, 0o755);
        }
      } catch (e) {}
    }

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: targetCwd,
      env: process.env
    });

    activePtySessions.set(winId, ptyProcess);

    ptyProcess.onData((data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('terminal:ptyData', data);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      activePtySessions.delete(winId);
      if (!event.sender.isDestroyed()) {
        event.sender.send('terminal:ptyExit', exitCode);
      }
    });

    return true;
  } catch (err) {
    console.error('Failed to spawn PTY:', err);
    return false;
  }
});

handleTrusted('terminal:writePty', (event, data) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const winId = win ? win.id : 1;
  const ptyProcess = activePtySessions.get(winId);
  if (ptyProcess) {
    ptyProcess.write(data);
  }
});

handleTrusted('terminal:resizePty', (event, { cols, rows }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const winId = win ? win.id : 1;
  const ptyProcess = activePtySessions.get(winId);
  if (ptyProcess && cols > 0 && rows > 0) {
    try {
      ptyProcess.resize(cols, rows);
    } catch(e){}
  }
});

handleTrusted('terminal:killPty', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const winId = win ? win.id : 1;
  const ptyProcess = activePtySessions.get(winId);
  if (ptyProcess) {
    try { ptyProcess.kill(); } catch(e){}
    activePtySessions.delete(winId);
  }
});

// --- Language Server Protocol bridge ---
// Language servers run in the main process and communicate over stdio. The
// renderer only sees validated JSON-RPC requests and server notifications.
const lspServers = new Map();
let nextLspServerId = 1;

function lspServerKey(winId, languageId, rootPath) {
  return `${winId}:${languageId}:${rootPath || process.cwd()}`;
}

function sendLspEvent(server, method, params) {
  if (!server.sender || server.sender.isDestroyed()) return;
  server.sender.send('lsp:notification', { sessionId: server.id, method, params });
}

function stopLspServer(server) {
  if (!server) return;
  for (const pending of server.pending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error('Language server stopped'));
  }
  server.pending.clear();
  try { server.process.kill(); } catch (e) {}
  lspServers.delete(server.key);
}

function stopLspServersForWindow(winId) {
  for (const server of [...lspServers.values()]) {
    if (server.winId === winId) stopLspServer(server);
  }
}

function writeLspMessage(server, message) {
  if (!server.process.stdin || server.process.killed) throw new Error('Language server is not running');
  const body = JSON.stringify(message);
  server.process.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

function requestLspServer(server, method, params) {
  const id = server.nextRequestId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.pending.delete(id);
      reject(new Error(`LSP request timed out: ${method}`));
    }, 30000);
    server.pending.set(id, { resolve, reject, timeout });
    try {
      writeLspMessage(server, { jsonrpc: '2.0', id, method, params });
    } catch (error) {
      clearTimeout(timeout);
      server.pending.delete(id);
      reject(error);
    }
  });
}

function notifyLspServer(server, method, params) {
  writeLspMessage(server, { jsonrpc: '2.0', method, params });
}

function handleLspMessage(server, message) {
  if (message.id !== undefined && !message.method) {
    const pending = server.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    server.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || 'LSP server error'));
    else pending.resolve(message.result);
    return;
  }

  if (!message.method) return;

  // A few client requests are required by otherwise standard servers. Answer
  // them in the main process instead of exposing a second IPC round trip.
  if (message.id !== undefined) {
    if (message.method === 'workspace/configuration') {
      const items = Array.isArray(message.params?.items) ? message.params.items : [];
      writeLspMessage(server, { jsonrpc: '2.0', id: message.id, result: items.map(() => ({})) });
      return;
    }
    if (message.method === 'workspace/workspaceFolders') {
      const rootPath = server.rootPath || process.cwd();
      writeLspMessage(server, {
        jsonrpc: '2.0',
        id: message.id,
        result: [{ uri: pathToLspUri(rootPath), name: path.basename(rootPath) }]
      });
      return;
    }
    if (message.method === 'client/registerCapability' || message.method === 'window/workDoneProgress/create') {
      writeLspMessage(server, { jsonrpc: '2.0', id: message.id, result: null });
      return;
    }
    if (message.method === 'workspace/applyEdit') {
      writeLspMessage(server, { jsonrpc: '2.0', id: message.id, result: { applied: false } });
      return;
    }
  }

  sendLspEvent(server, message.method, message.params);
}

async function startLspServer(event, languageId, rootPath) {
  const win = BrowserWindow.fromWebContents(event.sender);
  const winId = win ? win.id : 1;
  const normalizedLanguageId = String(languageId || '').toLowerCase();
  const config = LSP_SERVER_CONFIGS[normalizedLanguageId];
  if (!config) throw new Error(`No language server configured for ${normalizedLanguageId}`);

  const normalizedRoot = rootPath || process.cwd();
  const key = lspServerKey(winId, normalizedLanguageId, normalizedRoot);
  const existing = lspServers.get(key);
  if (existing) {
    await existing.ready;
    return existing;
  }

  const envPath = [
    process.env.PATH,
    path.join(normalizedRoot, 'node_modules', '.bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin'
  ].filter(Boolean).join(path.delimiter);
  const child = spawn(config.command, config.args, {
    cwd: normalizedRoot,
    env: { ...process.env, PATH: envPath },
    shell: process.platform === 'win32'
  });

  const server = {
    id: `lsp-${nextLspServerId++}`,
    key,
    winId,
    sender: event.sender,
    process: child,
    languageId: normalizedLanguageId,
    rootPath: normalizedRoot,
    config,
    pending: new Map(),
    nextRequestId: 1,
    buffer: Buffer.alloc(0),
    capabilities: {},
    ready: null
  };
  lspServers.set(key, server);

  let rejectStartup;
  const startupError = new Promise((resolve, reject) => { rejectStartup = reject; });
  child.once('error', (error) => {
    rejectStartup(error);
    sendLspEvent(server, 'atomic/serverError', { message: `${config.label} unavailable: ${error.message}` });
    stopLspServer(server);
  });

  child.stdout.on('data', (chunk) => {
    server.buffer = Buffer.concat([server.buffer, chunk]);
    while (true) {
      const headerEnd = server.buffer.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEnd < 0) break;
      const headers = server.buffer.slice(0, headerEnd).toString('ascii');
      const lengthMatch = headers.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        server.buffer = server.buffer.slice(headerEnd + 4);
        continue;
      }
      const contentLength = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      if (server.buffer.length - bodyStart < contentLength) break;
      const body = server.buffer.subarray(bodyStart, bodyStart + contentLength).toString('utf8');
      server.buffer = server.buffer.slice(bodyStart + contentLength);
      try { handleLspMessage(server, JSON.parse(body)); }
      catch (error) { sendLspEvent(server, 'atomic/protocolError', { message: error.message }); }
    }
  });

  child.stderr.on('data', (chunk) => {
    sendLspEvent(server, 'window/logMessage', { type: 3, message: chunk.toString('utf8').trim() });
  });
  child.once('close', (code, signal) => {
    sendLspEvent(server, 'atomic/serverExit', { code, signal });
    if (lspServers.get(key) === server) stopLspServer(server);
  });

  server.ready = Promise.race([
    (async () => {
      const result = await requestLspServer(server, 'initialize', {
        processId: process.pid,
        clientInfo: { name: 'Atomic', version: app.getVersion() },
        rootUri: pathToLspUri(normalizedRoot),
        workspaceFolders: [{ uri: pathToLspUri(normalizedRoot), name: path.basename(normalizedRoot) }],
        capabilities: {
          workspace: { configuration: true, workspaceFolders: true },
          textDocument: {
            synchronization: { dynamicRegistration: false, willSave: false, didSave: true, willSaveWaitUntil: false },
            completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] } },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: { linkSupport: true },
            references: {}
          }
        },
        initializationOptions: {}
      });
      server.capabilities = result?.capabilities || {};
      notifyLspServer(server, 'initialized', {});
      return server;
    })(),
    startupError.then(error => { throw error; })
  ]).catch(error => {
    stopLspServer(server);
    throw new Error(`${config.label} failed to start: ${error.message}`);
  });

  await server.ready;
  return server;
}

handleTrusted('lsp:getServers', () => Object.fromEntries(Object.entries(LSP_SERVER_CONFIGS).map(([languageId, config]) => [languageId, {
  label: config.label,
  command: config.command,
  args: config.args
}])));

handleTrusted('lsp:start', async (event, payload = {}) => {
  try {
    const server = await startLspServer(event, payload.languageId, payload.rootPath);
    return { success: true, sessionId: server.id, capabilities: server.capabilities, server: server.config.label };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

handleTrusted('lsp:request', async (event, { sessionId, method, params } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const server = [...lspServers.values()].find(item => item.id === sessionId && item.winId === win?.id);
  if (!server) throw new Error('Language server session not found');
  return requestLspServer(server, method, params);
});

handleTrusted('lsp:notify', (event, { sessionId, method, params } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const server = [...lspServers.values()].find(item => item.id === sessionId && item.winId === win?.id);
  if (!server) return false;
  notifyLspServer(server, method, params);
  return true;
});

handleTrusted('lsp:stop', (event, { sessionId } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const server = [...lspServers.values()].find(item => item.id === sessionId && item.winId === win?.id);
  if (server) stopLspServer(server);
  return true;
});

// --- Developer signing key and plugin management IPC handlers ---
handleTrusted('developer:migrateKey', async (event, keyData) => {
  if (Buffer.byteLength(JSON.stringify(keyData || {}), 'utf8') > 64 * 1024) {
    return { success: false, reason: 'invalid-key' };
  }
  if (await readDeveloperKeyData()) return { success: false, reason: 'already-migrated' };
  if (!await validateDeveloperKeyData(keyData)) return { success: false, reason: 'invalid-key' };
  await persistDeveloperKeyPair(keyData);
  return { success: true };
});

handleTrusted('developer:getPublicKey', async () => {
  const { publicKeyJwk } = await getOrCreateDeveloperKeyData();
  return publicKeyJwk;
});

handleTrusted('developer:sign', async (event, data) => {
  if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('Invalid signing payload');
  }
  const { privateKeyJwk } = await getOrCreateDeveloperKeyData();
  const privateKey = await webcrypto.subtle.importKey(
    'jwk', privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const signature = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    Buffer.from(data, 'utf8')
  );
  return Buffer.from(signature).toString('base64');
});

// --- Plugin Management IPC Handlers ---
async function ensurePluginsDir() {
  const pluginsDir = path.join(app.getPath('userData'), 'plugins');
  try {
    await fs.mkdir(pluginsDir, { recursive: true });
  } catch(e) {}
  return pluginsDir;
}

async function resolvePluginDir(pluginsDir, pluginId) {
  if (!isValidPluginId(pluginId)) throw new Error('Invalid plugin ID');
  const canonicalRoot = await canonicalizePath(pluginsDir);
  const canonicalPluginDir = await canonicalizePath(path.join(pluginsDir, pluginId));
  if (!isPathWithin(canonicalRoot, canonicalPluginDir) || canonicalRoot === canonicalPluginDir) {
    throw new Error('Plugin path escapes the plugin directory');
  }
  return canonicalPluginDir;
}

async function verifyPluginManifestSignature(pluginData, pluginDir) {
  if (typeof pluginData.code !== 'string' || typeof pluginData.version !== 'string' || typeof pluginData.signature !== 'string') {
    return false;
  }

  let verificationJwk = pluginData.publicKeyJwk;
  try {
    const installedManifest = JSON.parse(await fs.readFile(path.join(pluginDir, 'plugin.json'), 'utf-8'));
    verificationJwk = installedManifest.publicKeyJwk;
  } catch (error) {
    if (error.code !== 'ENOENT') return false;
  }
  if (!verificationJwk) return false;

  try {
    const publicKey = await webcrypto.subtle.importKey(
      'jwk', verificationJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    );
    const signedData = Buffer.from(`${pluginData.id}:${pluginData.version}:${pluginData.code}`, 'utf8');
    const signature = Buffer.from(pluginData.signature, 'base64');
    return webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, signedData
    );
  } catch (error) {
    return false;
  }
}

handleTrusted('plugin:getDir', async () => {
  return await ensurePluginsDir();
});

handleTrusted('plugin:getInstalled', async () => {
  const pluginsDir = await ensurePluginsDir();
  const installed = [];
  try {
    const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && isValidPluginId(entry.name)) {
        const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
        try {
          const content = await fs.readFile(manifestPath, 'utf-8');
          const data = JSON.parse(content);
          if (data.id === entry.name && isValidPluginId(data.id)) installed.push(data);
        } catch (e) {}
      }
    }
  } catch (err) {
    console.error('Failed to list installed plugins:', err);
  }
  return installed;
});

handleTrusted('plugin:install', async (event, pluginData) => {
  if (!pluginData || !isValidPluginId(pluginData.id)) return { success: false, error: 'Invalid plugin ID' };
  const serializedPlugin = JSON.stringify(pluginData, null, 2);
  if (Buffer.byteLength(serializedPlugin, 'utf8') > 1024 * 1024) {
    return { success: false, error: 'Plugin manifest exceeds the 1 MB limit' };
  }
  const pluginsDir = await ensurePluginsDir();
  const pluginDir = await resolvePluginDir(pluginsDir, pluginData.id);
  if (!await verifyPluginManifestSignature(pluginData, pluginDir)) {
    return { success: false, error: 'Plugin signature verification failed' };
  }
  try {
    await fs.mkdir(pluginDir, { recursive: true });
    const manifestPath = path.join(pluginDir, 'plugin.json');
    await fs.writeFile(manifestPath, serializedPlugin, { encoding: 'utf-8', mode: 0o600 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

handleTrusted('plugin:uninstall', async (event, pluginId) => {
  if (!isValidPluginId(pluginId)) return { success: false, error: 'Invalid plugin ID' };
  const pluginsDir = await ensurePluginsDir();
  try {
    const pluginDir = await resolvePluginDir(pluginsDir, pluginId);
    await fs.rm(pluginDir, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Plugin secrets are encrypted with the OS credential store. Values never
// need to be exposed through the plugin manifest or persisted in the renderer.
const pluginSecretsPath = () => path.join(app.getPath('userData'), 'plugin-secrets.json');

async function readPluginSecrets() {
  try {
    return JSON.parse(await fs.readFile(pluginSecretsPath(), 'utf-8')) || {};
  } catch (e) {
    return {};
  }
}

async function writePluginSecrets(secrets) {
  await fs.writeFile(pluginSecretsPath(), JSON.stringify(secrets, null, 2), 'utf-8');
}

function validatePluginSecretPayload(payload) {
  return payload && typeof payload.pluginId === 'string' && /^[a-zA-Z0-9._-]+$/.test(payload.pluginId)
    && typeof payload.key === 'string' && payload.key.length > 0 && payload.key.length < 200;
}

handleTrusted('plugin:getSecret', async (event, payload) => {
  if (!validatePluginSecretPayload(payload)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  const secrets = await readPluginSecrets();
  const encrypted = secrets[`${payload.pluginId}:${payload.key}`];
  if (!encrypted) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch (e) {
    console.error('Failed to decrypt plugin secret:', e);
    return null;
  }
});

handleTrusted('plugin:setSecret', async (event, payload) => {
  if (!validatePluginSecretPayload(payload)) return { success: false, error: 'Invalid secret key' };
  if (!safeStorage.isEncryptionAvailable()) return { success: false, error: 'OS credential storage is unavailable' };
  const secrets = await readPluginSecrets();
  const secretId = `${payload.pluginId}:${payload.key}`;
  secrets[secretId] = safeStorage.encryptString(String(payload.value ?? '')).toString('base64');
  await writePluginSecrets(secrets);
  return { success: true };
});

handleTrusted('plugin:deleteSecret', async (event, payload) => {
  if (!validatePluginSecretPayload(payload)) return { success: false, error: 'Invalid secret key' };
  const secrets = await readPluginSecrets();
  delete secrets[`${payload.pluginId}:${payload.key}`];
  await writePluginSecrets(secrets);
  return { success: true };
});
