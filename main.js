const { app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs/promises');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.loadFile('index.html');
  
  // Route renderer logs to main process stdout
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[Renderer] ${message}`);
  });
  
  // Native Menu Template
  const isMac = process.platform === 'darwin';
  const sendMenuAction = (action) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('menu:action', action);
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
    mainWindow.webContents.send('update_available');
  });

  autoUpdater.on('update-downloaded', () => {
    mainWindow.webContents.send('update_downloaded');
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
      mainWindow.webContents.send('theme_updated');
    }
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('dialog:openDirectory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (canceled) {
    return null;
  } else {
    return filePaths[0];
  }
});

ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
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
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    properties: ['showOverwriteConfirmation']
  });
  return result.canceled ? null : result.filePath;
});
