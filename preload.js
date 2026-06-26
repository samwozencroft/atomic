const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  mkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', dirPath),
  rename: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  deletePath: (targetPath) => ipcRenderer.invoke('fs:delete', targetPath),
  onUpdateAvailable: (callback) => ipcRenderer.on('update_available', (_event, ...args) => callback(...args)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update_downloaded', (_event, ...args) => callback(...args)),
  restartApp: () => ipcRenderer.send('restart_app')
});
