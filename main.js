const { app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const util = require('node:util');
const execFileAsync = util.promisify(execFile);


let mainWindow; // Keep reference to first window for legacy checks if any, though we should try to avoid it
const windowStates = new Map();

function createWindow(initialState = null) {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    title: "Atomic",
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (initialState) {
    windowStates.set(win.id, initialState);
  }

  win.loadFile('index.html');
  
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[Renderer ${win.id}] ${message}`);
  });

  win.on('closed', () => {
    windowStates.delete(win.id);
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
ipcMain.on('restart_app', () => {
  if (process.platform === 'darwin') {
    require('electron').shell.openExternal('https://github.com/samwozencroft/atomic/releases/latest');
  } else {
    autoUpdater.quitAndInstall();
  }
});

ipcMain.on('app:reportIssue', () => {
  require('electron').shell.openExternal('https://github.com/samwozencroft/atomic/issues');
});

ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});

ipcMain.handle('app:getNativeTheme', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

ipcMain.handle('app:getCustomThemePath', () => {
  return path.join(app.getPath('userData'), 'custom-theme.css');
});

ipcMain.handle('app:initCustomTheme', async () => {
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

ipcMain.handle('app:resetCustomTheme', async () => {
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


ipcMain.on('window:createNew', (event, payload) => {
  createWindow(payload);
});

ipcMain.handle('window:getInitialState', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && windowStates.has(win.id)) {
    const state = windowStates.get(win.id);
    windowStates.delete(win.id);
    return state;
  }
  return null;
});

// Existing IPC Handlers
ipcMain.handle('dialog:openDirectory', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (canceled) {
    return null;
  } else {
    return filePaths[0];
  }
});

ipcMain.handle('dialog:openFile', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile']
  });
  if (canceled) {
    return null;
  } else {
    return {
      path: filePaths[0],
      name: path.basename(filePaths[0])
    };
  }
});

ipcMain.handle('fs:readDir', async (event, dirPath) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      path: path.join(dirPath, entry.name)
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

ipcMain.handle('fs:readFile', async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    console.error('Failed to read file:', error);
    return null;
  }
});

ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return true;
  } catch (error) {
    console.error('Failed to write file:', error);
    return false;
  }
});

ipcMain.handle('fs:mkdir', async (event, dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle('fs:rename', async (event, oldPath, newPath) => {
  try {
    await fs.rename(oldPath, newPath);
    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle('fs:delete', async (event, targetPath) => {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle('fs:copy', async (event, targetPath) => {
  try {
    const parsed = require('path').parse(targetPath);
    const newPath = require('path').join(parsed.dir, `${parsed.name}-copy${parsed.ext}`);
    await fs.copyFile(targetPath, newPath);
    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle('fs:openInFinder', async (event, targetPath) => {
  try {
    require('electron').shell.showItemInFolder(targetPath);
    return true;
  } catch (error) {
    return false;
  }
});

const os = require('os');
let previousCpuInfo = os.cpus();

ipcMain.handle('app:getSystemStats', () => {
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

ipcMain.handle('dialog:showSaveDialog', async (event, defaultPath) => {
  const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    defaultPath,
    properties: ['showOverwriteConfirmation']
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('git:getStatus', async (event, dirPath) => {
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

ipcMain.handle('git:stageFile', async (event, { dirPath, filePath }) => {
  try {
    await execFileAsync('git', ['add', filePath], { cwd: dirPath });
    return true;
  } catch (err) {
    return false;
  }
});

ipcMain.handle('git:unstageFile', async (event, { dirPath, filePath }) => {
  try {
    await execFileAsync('git', ['reset', 'HEAD', filePath], { cwd: dirPath });
    return true;
  } catch (err) {
    return false;
  }
});

ipcMain.handle('git:commit', async (event, { dirPath, message }) => {
  if (!dirPath || !message) return { success: false, error: 'Missing parameter' };
  try {
    await execFileAsync('git', ['add', '-A'], { cwd: dirPath });
    const { stdout } = await execFileAsync('git', ['commit', '-m', message], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('git:getBranches', async (event, dirPath) => {
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

ipcMain.handle('git:checkoutBranch', async (event, { dirPath, branchName }) => {
  if (!dirPath || !branchName) return { success: false, error: 'Missing parameter' };
  try {
    const { stdout } = await execFileAsync('git', ['checkout', branchName], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('git:createBranch', async (event, { dirPath, branchName }) => {
  if (!dirPath || !branchName) return { success: false, error: 'Missing parameter' };
  try {
    const { stdout } = await execFileAsync('git', ['checkout', '-b', branchName], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('git:push', async (event, dirPath) => {
  if (!dirPath) return { success: false, error: 'No workspace opened' };
  try {
    const { stdout } = await execFileAsync('git', ['push'], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('git:pull', async (event, dirPath) => {
  if (!dirPath) return { success: false, error: 'No workspace opened' };
  try {
    const { stdout } = await execFileAsync('git', ['pull'], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('git:fetch', async (event, dirPath) => {
  if (!dirPath) return { success: false, error: 'No workspace opened' };
  try {
    const { stdout } = await execFileAsync('git', ['fetch'], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('git:stash', async (event, { dirPath, message }) => {
  if (!dirPath) return { success: false, error: 'No workspace opened' };
  try {
    const args = message ? ['stash', 'save', message] : ['stash'];
    const { stdout } = await execFileAsync('git', args, { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('git:stashPop', async (event, dirPath) => {
  if (!dirPath) return { success: false, error: 'No workspace opened' };
  try {
    const { stdout } = await execFileAsync('git', ['stash', 'pop'], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('git:merge', async (event, { dirPath, branchName }) => {
  if (!dirPath || !branchName) return { success: false, error: 'Missing parameter' };
  try {
    const { stdout } = await execFileAsync('git', ['merge', branchName], { cwd: dirPath });
    return { success: true, stdout };
  } catch (err) {
    return { success: false, error: err.message };
  }
});


