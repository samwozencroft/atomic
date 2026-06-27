let editor;
let currentFilePath = null;
let openTabs = [];
let currentWorkspace = null;

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
        // Handle unsaved changes logic here if needed
    });
});

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
    const map = {
        'js': 'javascript',
        'html': 'html',
        'css': 'css',
        'json': 'json',
        'md': 'markdown',
        'py': 'python',
        'ts': 'typescript'
    };
    return map[ext] || 'plaintext';
}

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
        editor.setValue(content);
        
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
        el.dataset.path = tab.path;
        
        el.innerHTML = `
            <span>${tab.name}</span>
            <span class="tab-close" style="margin-left: 10px;">×</span>
        `;
        
        el.addEventListener('click', () => openFile(tab.path, tab.name));
        
        el.querySelector('.tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            openTabs = openTabs.filter(t => t.path !== tab.path);
            renderTabs();
            if (openTabs.length > 0) {
                openFile(openTabs[openTabs.length - 1].path, openTabs[openTabs.length - 1].name);
            } else {
                editor.setValue('');
                currentFilePath = null;
            }
        });
        
        container.appendChild(el);
    });
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
