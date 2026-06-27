let editor;
let currentFilePath = null;
let openTabs = [];
let currentWorkspace = null;

const modifiedFiles = new Set();
let isSaving = false;

require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});

require(['vs/editor/editor.main'], function() {
    monaco.editor.defineTheme('atom-one-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { background: '282c34' }
        ],
        colors: {
            'editor.background': '#282c34',
            'editor.lineHighlightBackground': '#2c313c',
            'editorCursor.foreground': '#528bff',
            'editor.selectionBackground': '#3e4451'
        }
    });

    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: '',
        language: 'javascript',
        theme: 'atom-one-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        fontFamily: "'SF Mono', Monaco, Menlo, Courier, monospace"
    });

    editor.onDidChangeModelContent(() => {
        if (!currentFilePath || isSaving || isSettingValue) return;
        if (!modifiedFiles.has(currentFilePath)) {
            modifiedFiles.add(currentFilePath);
            renderTabs();
            // Update tree view as well
            if (currentWorkspace) {
                const node = document.querySelector(`.tree-item[data-path="${currentFilePath.replace(/\\/g, '\\\\')}"]`);
                if (node) node.classList.add('is-modified');
            }
        }
    });
});

async function saveCurrentFile() {
    if (!currentFilePath) return;
    
    isSaving = true;
    const content = editor.getValue();
    await window.electronAPI.writeFile(currentFilePath, content);
    
    modifiedFiles.delete(currentFilePath);
    renderTabs();
    
    if (currentWorkspace) {
        const node = document.querySelector(`.tree-item[data-path="${currentFilePath.replace(/\\/g, '\\\\')}"]`);
        if (node) node.classList.remove('is-modified');
    }
    isSaving = false;
}

// Native Menu handles Cmd+S now


document.getElementById('open-folder-btn').addEventListener('click', async () => {
    const dirPath = await window.electronAPI.openDirectory();
    if (dirPath) {
        document.getElementById('welcome-screen').classList.remove('active');
        document.getElementById('editor-container').style.display = 'block';
        currentWorkspace = dirPath;
        loadDirectory(dirPath);
    }
});

async function loadDirectory(dirPath) {
    const treeContainer = document.getElementById('file-tree');
    treeContainer.innerHTML = ''; // Clear previous
    await renderTree(dirPath, treeContainer, 0);
}

async function renderTree(path, container, indent) {
    const entries = await window.electronAPI.readDir(path);
    
    for (const entry of entries) {
        const node = document.createElement('div');
        node.className = 'tree-node';
        
        const item = document.createElement('div');
        item.className = `tree-item ${entry.isDirectory ? 'directory' : 'file'}`;
        if (!entry.isDirectory && modifiedFiles.has(entry.path)) {
            item.classList.add('is-modified');
        }
        item.textContent = entry.name;
        item.style.paddingLeft = `${indent * 15 + 10}px`;
        item.dataset.path = entry.path;
        item.dataset.isDirectory = entry.isDirectory;
        
        node.appendChild(item);
        
        let childrenContainer = null;
        if (entry.isDirectory) {
            childrenContainer = document.createElement('div');
            childrenContainer.className = 'tree-children';
            node.appendChild(childrenContainer);
        }
        
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (entry.isDirectory) {
                const isOpen = item.classList.contains('open');
                if (isOpen) {
                    item.classList.remove('open');
                    childrenContainer.classList.remove('open');
                } else {
                    item.classList.add('open');
                    if (childrenContainer.innerHTML === '') {
                        await renderTree(entry.path, childrenContainer, indent + 1);
                    }
                    childrenContainer.classList.add('open');
                }
            } else {
                openFile(entry.path, entry.name);
            }
        });
        
        // Right click context menu
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e.pageX, e.pageY, entry.path, entry.isDirectory);
        });
        
        container.appendChild(node);
    }
}

// Context Menu Logic
const contextMenu = document.getElementById('context-menu');
let contextTarget = null;

function showContextMenu(x, y, targetPath, isDir) {
    contextTarget = { path: targetPath, isDirectory: isDir };
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.add('active');
}

document.addEventListener('click', () => {
    contextMenu.classList.remove('active');
});

document.getElementById('ctx-new-file').addEventListener('click', async () => {
    if (!contextTarget) return;
    const parentDir = contextTarget.isDirectory ? contextTarget.path : contextTarget.path.split('/').slice(0, -1).join('/');
    const name = prompt("Enter file name:");
    if (name) {
        const newPath = `${parentDir}/${name}`;
        await window.electronAPI.writeFile(newPath, "");
        if (currentWorkspace) loadDirectory(currentWorkspace); // Reload tree
    }
});

document.getElementById('ctx-new-folder').addEventListener('click', async () => {
    if (!contextTarget) return;
    const parentDir = contextTarget.isDirectory ? contextTarget.path : contextTarget.path.split('/').slice(0, -1).join('/');
    const name = prompt("Enter folder name:");
    if (name) {
        const newPath = `${parentDir}/${name}`;
        await window.electronAPI.mkdir(newPath);
        if (currentWorkspace) loadDirectory(currentWorkspace); // Reload tree
    }
});

document.getElementById('ctx-rename').addEventListener('click', async () => {
    if (!contextTarget) return;
    const parts = contextTarget.path.split('/');
    const oldName = parts.pop();
    const parentDir = parts.join('/');
    
    const newName = prompt("Rename to:", oldName);
    if (newName && newName !== oldName) {
        const newPath = `${parentDir}/${newName}`;
        await window.electronAPI.rename(contextTarget.path, newPath);
        
        // Update tabs if file was renamed
        openTabs = openTabs.map(t => t.path === contextTarget.path ? { path: newPath, name: newName } : t);
        if (currentFilePath === contextTarget.path) currentFilePath = newPath;
        renderTabs();
        
        if (currentWorkspace) loadDirectory(currentWorkspace); // Reload tree
    }
});

document.getElementById('ctx-delete').addEventListener('click', async () => {
    if (!contextTarget) return;
    const confirmDelete = confirm(`Are you sure you want to delete ${contextTarget.path}?`);
    if (confirmDelete) {
        await window.electronAPI.deletePath(contextTarget.path);
        
        // Remove from tabs if open
        openTabs = openTabs.filter(t => !t.path.startsWith(contextTarget.path));
        if (currentFilePath && currentFilePath.startsWith(contextTarget.path)) {
            editor.setValue('');
            currentFilePath = null;
        }
        renderTabs();
        
        if (currentWorkspace) loadDirectory(currentWorkspace); // Reload tree
    }
});


function getLanguageFromFilename(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    
    // Check exact filenames first
    const exactMatches = {
        'dockerfile': 'dockerfile',
        'makefile': 'shell',
        '.gitignore': 'plaintext',
        '.env': 'shell'
    };
    
    if (exactMatches[filename.toLowerCase()]) {
        return exactMatches[filename.toLowerCase()];
    }

    // Then check extensions
    const map = {
        'js': 'javascript',
        'jsx': 'javascript',
        'ts': 'typescript',
        'tsx': 'typescript',
        'html': 'html',
        'css': 'css',
        'scss': 'scss',
        'less': 'less',
        'json': 'json',
        'md': 'markdown',
        'py': 'python',
        'go': 'go',
        'java': 'java',
        'c': 'c',
        'cpp': 'cpp',
        'cs': 'csharp',
        'php': 'php',
        'rb': 'ruby',
        'rs': 'rust',
        'sh': 'shell',
        'bash': 'shell',
        'zsh': 'shell',
        'yaml': 'yaml',
        'yml': 'yaml',
        'xml': 'xml',
        'sql': 'sql',
        'graphql': 'graphql',
        'ini': 'ini',
        'bat': 'bat'
    };
    return map[ext] || 'plaintext';
}

let isSettingValue = false;

async function openFile(filePath, filename) {
    const content = await window.electronAPI.readFile(filePath);
    if (content !== null) {
        currentFilePath = filePath;
        
        if (!openTabs.find(t => t.path === filePath)) {
            openTabs.push({ path: filePath, name: filename });
            renderTabs();
        }
        
        const lang = getLanguageFromFilename(filename);
        monaco.editor.setModelLanguage(editor.getModel(), lang);
        
        isSettingValue = true;
        editor.setValue(content);
        isSettingValue = false;
        
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        const activeTab = document.querySelector(`.tab[data-path="${filePath.replace(/\\/g, '\\\\')}"]`);
        if (activeTab) activeTab.classList.add('active');
    }
}

function renderTabs() {
    const container = document.getElementById('tabs');
    container.innerHTML = '';
    
    openTabs.forEach(tab => {
        const el = document.createElement('div');
        el.className = 'tab';
        if (tab.path === currentFilePath) el.classList.add('active');
        if (modifiedFiles.has(tab.path)) el.classList.add('is-modified');
        el.dataset.path = tab.path;
        
        el.innerHTML = `
            <span>${tab.name}</span>
            <span class="tab-close" style="margin-left: 10px;">×</span>
        `;
        
        el.addEventListener('click', () => openFile(tab.path, tab.name));
        
        el.querySelector('.tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            
            const warnOnClose = localStorage.getItem('atomic_warn_close') !== 'false';
            if (modifiedFiles.has(tab.path) && warnOnClose) {
                // Show Unsaved Modal
                const unsavedModal = document.getElementById('unsaved-modal');
                const cancelBtn = document.getElementById('unsaved-cancel');
                const discardBtn = document.getElementById('unsaved-discard');
                const saveBtn = document.getElementById('unsaved-save');
                const dontRemindCheckbox = document.getElementById('unsaved-dont-remind');
                
                unsavedModal.classList.remove('hidden');
                
                const closeModal = () => unsavedModal.classList.add('hidden');
                
                // Remove old listeners by cloning
                const newCancelBtn = cancelBtn.cloneNode(true);
                const newDiscardBtn = discardBtn.cloneNode(true);
                const newSaveBtn = saveBtn.cloneNode(true);
                cancelBtn.replaceWith(newCancelBtn);
                discardBtn.replaceWith(newDiscardBtn);
                saveBtn.replaceWith(newSaveBtn);
                
                newCancelBtn.addEventListener('click', closeModal);
                
                newDiscardBtn.addEventListener('click', () => {
                    if (dontRemindCheckbox.checked) {
                        localStorage.setItem('atomic_warn_close', 'false');
                        document.getElementById('toggle-warn-close').checked = false;
                    }
                    modifiedFiles.delete(tab.path);
                    closeTab(tab.path);
                    closeModal();
                });
                
                newSaveBtn.addEventListener('click', async () => {
                    if (dontRemindCheckbox.checked) {
                        localStorage.setItem('atomic_warn_close', 'false');
                        document.getElementById('toggle-warn-close').checked = false;
                    }
                    // Temporarily set active to save it
                    const prevCurrent = currentFilePath;
                    currentFilePath = tab.path;
                    await saveCurrentFile();
                    currentFilePath = prevCurrent;
                    closeTab(tab.path);
                    closeModal();
                });
                
                return;
            }
            
            closeTab(tab.path);
        });
        
        container.appendChild(el);
    });
}

function closeTab(path) {
    modifiedFiles.delete(path);
    if (currentWorkspace) {
        const node = document.querySelector(`.tree-item[data-path="${path.replace(/\\/g, '\\\\')}"]`);
        if (node) node.classList.remove('is-modified');
    }
    openTabs = openTabs.filter(t => t.path !== path);
    renderTabs();
    if (openTabs.length > 0) {
        openFile(openTabs[openTabs.length - 1].path, openTabs[openTabs.length - 1].name);
    } else {
        editor.setValue('');
        currentFilePath = null;
    }
}

// Initialize App Version and Stats
window.electronAPI.getVersion().then(version => {
  document.getElementById('app-version-display-status').textContent = `Version ${version}`;
});

setInterval(async () => {
  if (window.electronAPI.getSystemStats) {
    const stats = await window.electronAPI.getSystemStats();
    document.getElementById('cpu-stat').textContent = `CPU: ${stats.cpu}%`;
    document.getElementById('mem-stat').textContent = `Mem: ${stats.memory}%`;
  }
}, 1000);

// Auto Updater UI Logic
const updatePopup = document.getElementById('update-popup');
const updateMessage = document.getElementById('update-message');
const updateRestartBtn = document.getElementById('update-restart-btn');

window.electronAPI.onUpdateAvailable(() => {
  updatePopup.classList.remove('hidden');
  updateMessage.textContent = "A new update is available. Downloading now...";
});

window.electronAPI.onUpdateDownloaded(() => {
  if (window.electronAPI.platform === 'darwin') {
    updateMessage.textContent = "Update Downloaded. Manual installation required on macOS.";
    updateRestartBtn.textContent = "Download Update";
  } else {
    updateMessage.textContent = "Update Downloaded. It will be installed on restart.";
    updateRestartBtn.textContent = "Restart and Install";
  }
  updateRestartBtn.classList.remove('hidden');
});

updateRestartBtn.addEventListener('click', () => {
  window.electronAPI.restartApp();
});

// Sidebar Toggle Logic
document.getElementById('toggle-sidebar-btn').addEventListener('click', () => {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar.style.display === 'none') {
    sidebar.style.display = 'flex';
  } else {
    sidebar.style.display = 'none';
  }
  // Trigger Monaco editor resize
  if (editor) {
    setTimeout(() => editor.layout(), 10);
  }
});

// Settings Modal and Stats Toggle Logic
const settingsCog = document.getElementById('settings-cog');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const toggleInsights = document.getElementById('toggle-insights');
const systemStats = document.getElementById('system-stats');

// Load preference
const showInsights = localStorage.getItem('atomic_show_insights') !== 'false';
toggleInsights.checked = showInsights;
if (!showInsights) systemStats.style.display = 'none';

function updateInsightsVisibility(show) {
  systemStats.style.display = show ? 'block' : 'none';
  toggleInsights.checked = show;
  localStorage.setItem('atomic_show_insights', show);
}

settingsCog.addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    settingsModal.classList.add('hidden');
  }
});

toggleInsights.addEventListener('change', (e) => {
  updateInsightsVisibility(e.target.checked);
});

systemStats.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  updateInsightsVisibility(false);
});

// Warn on close setting
const toggleWarnClose = document.getElementById('toggle-warn-close');
const warnOnClosePref = localStorage.getItem('atomic_warn_close') !== 'false';
if (toggleWarnClose) {
  toggleWarnClose.checked = warnOnClosePref;
  toggleWarnClose.addEventListener('change', (e) => {
    localStorage.setItem('atomic_warn_close', e.target.checked);
  });
}

const reportIssueBtn = document.getElementById('report-issue-btn');
if (reportIssueBtn) {
  reportIssueBtn.addEventListener('click', () => {
    window.electronAPI.reportIssue();
  });
}

// Theme Handling
const themeSelector = document.getElementById('theme-selector');
const currentThemeSetting = localStorage.getItem('atomic_theme') || 'dark';
if (themeSelector) {
  themeSelector.value = currentThemeSetting;
  themeSelector.addEventListener('change', (e) => {
    localStorage.setItem('atomic_theme', e.target.value);
    applyTheme(e.target.value);
  });
}

async function applyTheme(setting) {
  let actualTheme = setting;
  if (setting === 'system') {
    actualTheme = await window.electronAPI.getNativeTheme();
  }
  
  if (actualTheme === 'light') {
    document.body.dataset.theme = 'light';
    if (window.monaco) monaco.editor.setTheme('vs');
  } else {
    document.body.removeAttribute('data-theme');
    if (window.monaco) monaco.editor.setTheme('atom-one-dark');
  }
}

// Initial theme application
applyTheme(currentThemeSetting);

window.electronAPI.onThemeUpdated(() => {
  const setting = localStorage.getItem('atomic_theme') || 'dark';
  if (setting === 'system') {
    applyTheme('system');
  }
});

// Native Menu Listeners
window.electronAPI.onMenuAction(async (action) => {
  switch (action) {
    case 'open-file':
      const file = await window.electronAPI.openFile();
      if (file) {
        document.getElementById('welcome-screen').classList.remove('active');
        document.getElementById('editor-container').style.display = 'block';
        openFile(file.path, file.name);
      }
      break;
    case 'open-folder':
      document.getElementById('open-folder-btn').click();
      break;
    case 'save':
      saveCurrentFile();
      break;
    case 'close-active':
      if (currentFilePath) {
        const tabCloseBtn = document.querySelector(`.tab[data-path="${currentFilePath.replace(/\\/g, '\\\\')}"] .tab-close`);
        if (tabCloseBtn) tabCloseBtn.click();
      }
      break;
    case 'close-others':
      if (currentFilePath) {
        const tabsToClose = openTabs.filter(t => t.path !== currentFilePath);
        tabsToClose.forEach(t => {
          const btn = document.querySelector(`.tab[data-path="${t.path.replace(/\\/g, '\\\\')}"] .tab-close`);
          if (btn) btn.click();
        });
      }
      break;
    case 'close-all':
      const allTabs = [...openTabs];
      allTabs.forEach(t => {
        const btn = document.querySelector(`.tab[data-path="${t.path.replace(/\\/g, '\\\\')}"] .tab-close`);
        if (btn) btn.click();
      });
      break;
  }
});
