let editor;
let editorRight;
let activeEditorPane = 'left';
let currentFilePath = null;
let currentFilePathRight = null;
let openTabsLeft = [];
let openTabsRight = [];
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

    editorRight = monaco.editor.create(document.getElementById('editor-container-right'), {
        value: '',
        language: 'javascript',
        theme: 'atom-one-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        fontFamily: "'SF Mono', Monaco, Menlo, Courier, monospace"
    });

    editor.onDidFocusEditorText(() => { activeEditorPane = 'left'; });
    editorRight.onDidFocusEditorText(() => { activeEditorPane = 'right'; });

    // Add drop zones to editors
    const edContainer = document.getElementById('editor-container');
    const edRightContainer = document.getElementById('editor-container-right');

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        e.currentTarget.classList.add('drag-over');
    };
    
    const handleDragLeave = (e) => {
        e.currentTarget.classList.remove('drag-over');
    };

    const handleDrop = (e, pane) => {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        const draggedPath = e.dataTransfer.getData('text/plain');
        if (draggedPath) {
            activeEditorPane = pane;
            const name = draggedPath.split('/').pop();
            openFile(draggedPath, name, pane);
        }
    };

    edContainer.addEventListener('dragover', handleDragOver);
    edContainer.addEventListener('dragleave', handleDragLeave);
    edContainer.addEventListener('drop', (e) => handleDrop(e, 'left'));

    edRightContainer.addEventListener('dragover', handleDragOver);
    edRightContainer.addEventListener('dragleave', handleDragLeave);
    edRightContainer.addEventListener('drop', (e) => handleDrop(e, 'right'));

    editor.onDidChangeModelContent(() => {
        if (!currentFilePath || isSaving || isSettingValue) return;
        if (!modifiedFiles.has(currentFilePath)) {
            modifiedFiles.add(currentFilePath);
            renderTabs();
            if (currentWorkspace) {
                const node = document.querySelector(`.tree-item[data-path="${activePath.replace(/\\/g, '\\\\')}"]`);
                if (node) node.classList.add('is-modified');
            }
        }
    });

    editorRight.onDidChangeModelContent(() => {
        if (!currentFilePathRight || isSaving || isSettingValue) return;
        if (!modifiedFiles.has(currentFilePathRight)) {
            modifiedFiles.add(currentFilePathRight);
            renderTabs();
            if (currentWorkspace) {
                const node = document.querySelector(`.tree-item[data-path="${currentFilePathRight.replace(/\\/g, '\\\\')}"]`);
                if (node) node.classList.add('is-modified');
            }
        }
    });
});

async function saveCurrentFile() {
    let activePath = activeEditorPane === 'left' ? currentFilePath : currentFilePathRight;
    const activeEd = activeEditorPane === 'left' ? editor : editorRight;

    if (isSaving) return;
    
    if (!activePath) {
        // "New File" flow
        const defaultPath = currentWorkspace ? currentWorkspace + '/Untitled' : 'Untitled';
        const newPath = await window.electronAPI.showSaveDialog(defaultPath);
        if (!newPath) return; // user canceled
        activePath = newPath;
        
        // Add to tabs so it's formally open
        const filename = newPath.split('/').pop();
        if (activeEditorPane === 'left') {
            currentFilePath = newPath;
            openTabsLeft.push({ path: newPath, name: filename });
        } else {
            currentFilePathRight = newPath;
            openTabsRight.push({ path: newPath, name: filename });
        }
        
        // Update language model
        const lang = getLanguageFromFilename(filename);
        monaco.editor.setModelLanguage(activeEd.getModel(), lang);
    }
    
    isSaving = true;
    const content = activeEd.getValue();
    const success = await window.electronAPI.writeFile(activePath, content);
    
    if (success) {
        modifiedFiles.delete(activePath);
        
        // Remove .is-modified visual indicator from tree
        if (currentWorkspace) {
            const node = document.querySelector(`.tree-item[data-path="${activePath.replace(/\\/g, '\\\\')}"]`);
            if (node) node.classList.remove('is-modified');
        }
        
        // Remove dirty indicator from tab
        const tab = [...openTabsLeft, ...openTabsRight].find(t => t.path === activePath);
        if (tab) {
            const tabEl = document.querySelector(`.tab[data-path="${activePath.replace(/\\/g, '\\\\')}"]`);
            if (tabEl) tabEl.classList.remove('is-modified');
        }
        
        // Live reload if custom theme
        if (activePath.endsWith('custom-theme.css') && localStorage.getItem('atomic_theme') === 'custom') {
            applyTheme('custom');
        }
        
        // Reload tree to show newly saved file if it's in workspace
        if (currentWorkspace && activePath.startsWith(currentWorkspace)) {
            loadDirectory(currentWorkspace);
        }
        
        renderTabs();
    } else {
        alert('Failed to save file');
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
        openTabsLeft = openTabsLeft.map(t => t.path === contextTarget.path ? { path: newPath, name: newName } : t);
        openTabsRight = openTabsRight.map(t => t.path === contextTarget.path ? { path: newPath, name: newName } : t);
        if (currentFilePath === contextTarget.path) currentFilePath = newPath;
        if (currentFilePathRight === contextTarget.path) currentFilePathRight = newPath;
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
        openTabsLeft = openTabsLeft.filter(t => !t.path.startsWith(contextTarget.path));
        openTabsRight = openTabsRight.filter(t => !t.path.startsWith(contextTarget.path));
        if (currentFilePath && currentFilePath.startsWith(contextTarget.path)) {
            editor.setValue('');
            currentFilePath = null;
        }
        if (currentFilePathRight && currentFilePathRight.startsWith(contextTarget.path)) {
            editorRight.setValue('');
            currentFilePathRight = null;
        }
        renderTabs();
        
        if (currentWorkspace) loadDirectory(currentWorkspace); // Reload tree
    }
});

document.getElementById('ctx-open-right').addEventListener('click', () => {
    console.log('ctx-open-right clicked', contextTarget);
    if (!contextTarget) return;
    activeEditorPane = 'right';
    openFile(contextTarget.path, contextTarget.path.split('/').pop(), 'right');
});

document.getElementById('ctx-open-left').addEventListener('click', () => {
    console.log('ctx-open-left clicked', contextTarget);
    if (!contextTarget) return;
    activeEditorPane = 'left';
    openFile(contextTarget.path, contextTarget.path.split('/').pop(), 'left');
});

document.getElementById('ctx-copy').addEventListener('click', async () => {
    if (!contextTarget) return;
    const success = await window.electronAPI.copyFile(contextTarget.path);
    if (success && currentWorkspace) {
        loadDirectory(currentWorkspace); // Reload tree
    } else if (!success) {
        alert('Failed to copy file.');
    }
});

document.getElementById('ctx-open-finder').addEventListener('click', async () => {
    if (!contextTarget) return;
    await window.electronAPI.openInFinder(contextTarget.path);
});


function getDragAfterElement(container, x) {
    const draggableElements = [...container.querySelectorAll('.tab:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

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

async function openFile(filePath, filename, pane = null) {
    if (!pane) {
        if (currentFilePath === filePath) pane = 'left';
        else if (currentFilePathRight === filePath) pane = 'right';
        else pane = 'left'; // Always default to left pane for new files
    }

    const content = await window.electronAPI.readFile(filePath);
    if (content !== null) {
        if (pane === 'left') {
            currentFilePath = filePath;
            activeEditorPane = 'left';
            document.getElementById('editor-wrapper').style.display = 'flex';
            document.getElementById('editor-column-left').style.display = 'flex';
            document.getElementById('editor-container').style.display = 'block';
            
            if (currentFilePathRight === filePath) {
                currentFilePathRight = null;
                editorRight.setValue('');
                openTabsRight = openTabsRight.filter(t => t.path !== filePath);
            }
            
            if (!openTabsLeft.find(t => t.path === filePath)) {
                openTabsLeft.push({ path: filePath, name: filename });
            }
        } else {
            currentFilePathRight = filePath;
            activeEditorPane = 'right';
            document.getElementById('editor-wrapper').style.display = 'flex';
            document.getElementById('editor-column-right').style.display = 'flex';
            document.getElementById('editor-container-right').style.display = 'block';
            
            if (currentFilePath === filePath) {
                currentFilePath = null;
                editor.setValue('');
                openTabsLeft = openTabsLeft.filter(t => t.path !== filePath);
            }
            
            if (!openTabsRight.find(t => t.path === filePath)) {
                openTabsRight.push({ path: filePath, name: filename });
            }
        }
        
        renderTabs();
        
        const lang = getLanguageFromFilename(filename);
        const ed = pane === 'left' ? editor : editorRight;
        monaco.editor.setModelLanguage(ed.getModel(), lang);
        
        isSettingValue = true;
        ed.setValue(content);
        isSettingValue = false;
        
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        const activeTab = document.querySelector(`#tabs-${pane} .tab[data-path="${filePath.replace(/\\/g, '\\\\')}"]`);
        if (activeTab) activeTab.classList.add('active');

        setTimeout(() => {
            if (editor) editor.layout();
            if (editorRight) editorRight.layout();
        }, 50);
    }
}
let dragTabPath = null;
function renderTabs() {
    ['left', 'right'].forEach(pane => {
        const container = document.getElementById(`tabs-${pane}`);
        if (!container) return;
        
        container.innerHTML = '';
        
        // Add drag over events to container
        container.ondragover = e => {
            e.preventDefault();
            const draggable = document.querySelector('.dragging');
            if (!draggable) return;
            const afterElement = getDragAfterElement(container, e.clientX);
            if (afterElement == null) {
                container.appendChild(draggable);
            } else {
                container.insertBefore(draggable, afterElement);
            }
        };
        
        container.ondrop = e => {
            e.preventDefault();
            const newOrderPaths = Array.from(container.querySelectorAll('.tab')).map(t => t.dataset.path);
            
                        // Allow dragging between panes
            const draggable = document.querySelector('.dragging');
            if (draggable) {
                const p = draggable.dataset.path;
                const n = draggable.dataset.name;
                // remove from both
                openTabsLeft = openTabsLeft.filter(t => t.path !== p);
                openTabsRight = openTabsRight.filter(t => t.path !== p);
                
                let transferContent = null;
                let wasActive = false;
                
                // if it's the current file in the OTHER pane, grab its content and open next tab
                if (pane === 'left' && currentFilePathRight === p) {
                    wasActive = true;
                    transferContent = editorRight.getValue();
                    if (openTabsRight.length > 0) {
                        const next = openTabsRight[openTabsRight.length - 1];
                        currentFilePathRight = null;
                        openFile(next.path, next.name, 'right');
                    } else {
                        currentFilePathRight = null;
                        editorRight.setValue('');
                    }
                } else if (pane === 'right' && currentFilePath === p) {
                    wasActive = true;
                    transferContent = editor.getValue();
                    if (openTabsLeft.length > 0) {
                        const next = openTabsLeft[openTabsLeft.length - 1];
                        currentFilePath = null;
                        openFile(next.path, next.name, 'left');
                    } else {
                        currentFilePath = null;
                        editor.setValue('');
                    }
                }
                
                // Add to current pane openTabs array
                if (pane === 'left') {
                    openTabsLeft.push({path: p, name: n});
                } else {
                    openTabsRight.push({path: p, name: n});
                }
                
                // If it was active in the source, or if destination is empty, make it active here
                const destCurrentPath = pane === 'left' ? currentFilePath : currentFilePathRight;
                if (wasActive || !destCurrentPath) {
                    if (transferContent !== null) {
                        isSettingValue = true;
                        if (pane === 'left') {
                            currentFilePath = p;
                            editor.setValue(transferContent);
                            monaco.editor.setModelLanguage(editor.getModel(), getLanguageFromFilename(n));
                        } else {
                            currentFilePathRight = p;
                            editorRight.setValue(transferContent);
                            monaco.editor.setModelLanguage(editorRight.getModel(), getLanguageFromFilename(n));
                        }
                        isSettingValue = false;
                    } else {
                        // Open from disk since it wasn't loaded in the other pane's buffer
                        openFile(p, n, pane);
                    }
                }
            }
            // Re-sync array based on DOM order
            let allTabs = [...openTabsLeft, ...openTabsRight];
            if (pane === 'left') {
                openTabsLeft = newOrderPaths.map(p => allTabs.find(t => t.path === p)).filter(Boolean);
            } else {
                openTabsRight = newOrderPaths.map(p => allTabs.find(t => t.path === p)).filter(Boolean);
            }
            
            // We just changed state, render again to be safe and set active correctly
            renderTabs();
        };
        
        const tabsArr = pane === 'left' ? openTabsLeft : openTabsRight;
        const currentActivePath = pane === 'left' ? currentFilePath : currentFilePathRight;
        
        if (tabsArr.length === 0 && pane === 'left') {
            const placeholder = document.createElement('div');
            placeholder.className = 'tab active';
            placeholder.innerHTML = `<span>New File</span>`;
            placeholder.style.opacity = '0.5';
            placeholder.style.pointerEvents = 'none';
            container.appendChild(placeholder);
        }
        
        tabsArr.forEach(tab => {
            const el = document.createElement('div');
            el.className = 'tab';
            if (tab.path === currentActivePath) el.classList.add('active');
            if (modifiedFiles.has(tab.path)) el.classList.add('is-modified');
            el.dataset.path = tab.path;
            el.dataset.name = tab.name;
            el.draggable = true;
            
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e.pageX, e.pageY, tab.path, false);
            });

            el.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', tab.path);
                e.dataTransfer.effectAllowed = 'move';
                el.classList.add('dragging');
            });

            el.addEventListener('dragend', () => {
                el.classList.remove('dragging');
            });

            el.innerHTML = `
                <span>${tab.name}</span>
                <span class="tab-close" style="margin-left: 10px;">×</span>
            `;
            
            el.addEventListener('click', () => openFile(tab.path, tab.name, pane));
            
            
            el.querySelector('.tab-close').addEventListener('click', (e) => {
                e.stopPropagation();
                
                const warnOnClose = localStorage.getItem('atomic_warn_close') !== 'false';
                if (modifiedFiles.has(tab.path) && warnOnClose) {
                    const unsavedModal = document.getElementById('unsaved-modal');
                    const cancelBtn = document.getElementById('unsaved-cancel');
                    const discardBtn = document.getElementById('unsaved-discard');
                    const saveBtn = document.getElementById('unsaved-save');
                    const dontRemindCheckbox = document.getElementById('unsaved-dont-remind');
                    
                    unsavedModal.classList.remove('hidden');
                    
                    const closeModal = () => unsavedModal.classList.add('hidden');
                    
                    // Clone to remove old listeners
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
                        closeTab(tab.path, pane);
                        closeModal();
                    });
                    
                    newSaveBtn.addEventListener('click', async () => {
                        if (dontRemindCheckbox.checked) {
                            localStorage.setItem('atomic_warn_close', 'false');
                            document.getElementById('toggle-warn-close').checked = false;
                        }
                        const prevCurrent = pane === 'left' ? currentFilePath : currentFilePathRight;
                        if (pane === 'left') currentFilePath = tab.path;
                        else currentFilePathRight = tab.path;
                        
                        // We must set the activeEd correctly for saveCurrentFile
                        activeEditorPane = pane;
                        await saveCurrentFile();
                        
                        if (pane === 'left') currentFilePath = prevCurrent;
                        else currentFilePathRight = prevCurrent;
                        
                        closeTab(tab.path, pane);
                        closeModal();
                    });
                    
                    return;
                }
                
                closeTab(tab.path, pane);
            });

            
            container.appendChild(el);
        });
        
        // Hide right column if no tabs and nothing active
        if (pane === 'right' && openTabsRight.length === 0 && !currentFilePathRight) {
             document.getElementById('editor-column-right').style.display = 'none';
        }
    });
}

function closeTab(path, pane) {
    modifiedFiles.delete(path);
    if (currentWorkspace) {
        const node = document.querySelector(`.tree-item[data-path="${path.replace(/\\/g, '\\\\')}"]`);
        if (node) node.classList.remove('is-modified');
    }
    
    if (pane === 'left') {
        openTabsLeft = openTabsLeft.filter(t => t.path !== path);
        if (currentFilePath === path) {
            currentFilePath = null;
            editor.setValue('');
        }
    } else {
        openTabsRight = openTabsRight.filter(t => t.path !== path);
        if (currentFilePathRight === path) {
            currentFilePathRight = null;
            editorRight.setValue('');
        }
    }
    
    renderTabs();
    
    const tabsArr = pane === 'left' ? openTabsLeft : openTabsRight;
    if (tabsArr.length > 0 && ((pane === 'left' && !currentFilePath) || (pane === 'right' && !currentFilePathRight))) {
        openFile(tabsArr[tabsArr.length - 1].path, tabsArr[tabsArr.length - 1].name, pane);
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
const themeCards = document.querySelectorAll('.theme-card');
const resetCustomBtn = document.getElementById('reset-custom-theme');
const currentThemeSetting = localStorage.getItem('atomic_theme') || 'dark';

function updateActiveThemeCard(val) {
  themeCards.forEach(card => {
    if (card.dataset.value === val) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });
  if (val === 'custom') {
    resetCustomBtn.classList.add('visible');
  } else {
    resetCustomBtn.classList.remove('visible');
  }
}

updateActiveThemeCard(currentThemeSetting);

themeCards.forEach(card => {
  card.addEventListener('click', async () => {
    const val = card.dataset.value;
    localStorage.setItem('atomic_theme', val);
    updateActiveThemeCard(val);
    await applyTheme(val);
    
    if (val === 'custom') {
      const customPath = await window.electronAPI.getCustomThemePath();
      document.getElementById('welcome-screen').classList.remove('active');
      document.getElementById('editor-container').style.display = 'block';
      openFile(customPath, 'custom-theme.css');
      document.getElementById('settings-modal').classList.add('hidden');
    }
  });
});

if (resetCustomBtn) {
  resetCustomBtn.addEventListener('click', async () => {
    await window.electronAPI.resetCustomTheme();
    if (localStorage.getItem('atomic_theme') === 'custom') {
      await applyTheme('custom');
      
      // If custom-theme.css is currently open in the editor, we need to refresh the editor's contents
      const customPath = await window.electronAPI.getCustomThemePath();
      if (currentFilePath === customPath) {
        const customCss = await window.electronAPI.readFile(customPath);
        isSettingValue = true;
        editor.setValue(customCss || '');
        isSettingValue = false;
        
        modifiedFiles.delete(activePath);
        const tabEl = document.querySelector(`.tab[data-path="${currentFilePath.replace(/\\/g, '\\\\')}"]`);
        if (tabEl) tabEl.classList.remove('is-modified');
        const node = document.querySelector(`.tree-item[data-path="${activePath.replace(/\\/g, '\\\\')}"]`);
        if (node) node.classList.remove('is-modified');
      }
    }
  });
}

async function applyTheme(setting) {
  let actualTheme = setting;
  if (setting === 'system') {
    actualTheme = await window.electronAPI.getNativeTheme();
  }
  
  const customStyleTag = document.getElementById('custom-theme-style');
  
  if (setting === 'custom') {
    document.body.dataset.theme = 'custom';
    await window.electronAPI.initCustomTheme();
    const customPath = await window.electronAPI.getCustomThemePath();
    const customCss = await window.electronAPI.readFile(customPath);
    if (customCss) customStyleTag.textContent = customCss;
    if (window.monaco) monaco.editor.setTheme('atom-one-dark'); // Base theme for custom
  } else {
    customStyleTag.textContent = ''; // Clear custom styles
    if (actualTheme === 'light') {
      document.body.dataset.theme = 'light';
      if (window.monaco) monaco.editor.setTheme('vs');
    } else {
      document.body.removeAttribute('data-theme');
      if (window.monaco) monaco.editor.setTheme('atom-one-dark');
    }
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


// --- Theme Marketplace Logic ---
const browseThemesBtn = document.getElementById('browse-themes-btn');
const marketplaceModal = document.getElementById('theme-marketplace-modal');
const closeMarketplaceBtn = document.getElementById('close-marketplace');
const backToSettingsBtn = document.getElementById('back-to-settings');
const themeList = document.getElementById('theme-list');
const uploadThemeBtn = document.getElementById('upload-theme-btn');
const themeSearch = document.getElementById('theme-search');

const BUCKET_URL = 'https://storage.googleapis.com/atomic-themes/index.json';
const WEBHOOK_URL = 'https://us-central1-atomic-500709.cloudfunctions.net/themeMarketplaceHandler';
let cachedThemes = [];

if (browseThemesBtn) {
  browseThemesBtn.addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
    marketplaceModal.classList.remove('hidden');
    fetchMarketplaceThemes();
  });
}

if (backToSettingsBtn) {
  backToSettingsBtn.addEventListener('click', () => {
    marketplaceModal.classList.add('hidden');
    document.getElementById('settings-modal').classList.remove('hidden');
  });
}

const refreshThemesBtn = document.getElementById('refresh-themes');

if (refreshThemesBtn) {
  refreshThemesBtn.addEventListener('click', () => {
    fetchMarketplaceThemes();
  });
}

if (closeMarketplaceBtn) {
  closeMarketplaceBtn.addEventListener('click', () => {
    marketplaceModal.classList.add('hidden');
  });
}

async function fetchMarketplaceThemes() {
  themeList.innerHTML = '<span style="color: var(--text-muted);">Loading themes...</span>';
  try {
    const response = await fetch(`${BUCKET_URL}?t=${Date.now()}`);
    if (!response.ok) throw new Error('Failed to fetch themes');
    const data = await response.json();
    cachedThemes = data.themes || [];
    renderMarketplaceThemes(cachedThemes);
  } catch (error) {
    themeList.innerHTML = '<span style="color: #e06c75;">Failed to load themes. Ensure bucket is public.</span>';
    console.error(error);
  }
}

function renderMarketplaceThemes(themes) {
  themeList.innerHTML = '';
  if (themes.length === 0) {
    themeList.innerHTML = '<span style="color: var(--text-muted);">No themes found.</span>';
    return;
  }
  
  themes.forEach(theme => {
    const item = document.createElement('div');
    item.className = 'theme-list-item';
    
    const info = document.createElement('div');
    info.className = 'theme-list-item-info';
    info.innerHTML = `
      <span class="theme-list-item-title">${theme.name}</span>
      <span class="theme-list-item-author">by ${theme.author}</span>
    `;
    
    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn';
    applyBtn.textContent = 'Apply';
    applyBtn.onclick = () => downloadAndApplyTheme(theme);
    
    item.appendChild(info);
    item.appendChild(applyBtn);
    themeList.appendChild(item);
  });
}

if (themeSearch) {
  themeSearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = cachedThemes.filter(t => t.name.toLowerCase().includes(query) || t.author.toLowerCase().includes(query));
    renderMarketplaceThemes(filtered);
  });
}

async function downloadAndApplyTheme(theme) {
  try {
    const response = await fetch(theme.url);
    if (!response.ok) throw new Error('Failed to download theme');
    const cssContent = await response.text();
    
    // Ensure custom theme file exists, then write to it
    await window.electronAPI.initCustomTheme();
    const customPath = await window.electronAPI.getCustomThemePath();
    await window.electronAPI.writeFile(customPath, cssContent);
    
    // Apply custom theme
    localStorage.setItem('atomic_theme', 'custom');
    updateActiveThemeCard('custom');
    await applyTheme('custom');
    
    marketplaceModal.classList.add('hidden');
  } catch (error) {
    console.error('Download failed:', error);
    alert('Failed to download and apply theme.');
  }
}

if (uploadThemeBtn) {
  uploadThemeBtn.addEventListener('click', async () => {
    const customPath = await window.electronAPI.getCustomThemePath();
    const cssContent = await window.electronAPI.readFile(customPath);
    if (!cssContent) {
      alert('You have not created a custom theme yet!');
      return;
    }
    
    const nameInput = document.getElementById('upload-theme-name');
    const authorInput = document.getElementById('upload-theme-author');
    
    const name = nameInput ? nameInput.value.trim() : '';
    const author = authorInput ? authorInput.value.trim() : '';
    
    if (!name || !author) {
      alert('Please provide both a Theme Name and an Author Name.');
      return;
    }
    
    if (WEBHOOK_URL === 'YOUR_WEBHOOK_URL_HERE') {
      alert('Upload failed: Webhook URL is not configured in renderer.js!');
      return;
    }
    
    try {
      uploadThemeBtn.textContent = 'Submitting...';
      uploadThemeBtn.disabled = true;
      const payload = {
        name: name,
        author: author,
        css: cssContent
      };
      
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        alert('Theme submitted for review successfully!');
        if (nameInput) nameInput.value = '';
        if (authorInput) authorInput.value = '';
      } else {
        throw new Error('Webhook failed');
      }
    } catch (error) {
      console.error(error);
      alert('Failed to submit theme. Check webhook configuration.');
    } finally {
      uploadThemeBtn.textContent = 'Upload Your Theme';
      uploadThemeBtn.disabled = false;
    }
  });
}


// Split drag and drop logic
const editorWrapper = document.getElementById('editor-wrapper');
const splitDropZone = document.getElementById('split-drop-zone');

editorWrapper.addEventListener('dragover', (e) => {
    const rightPaneClosed = openTabsRight.length === 0 && !currentFilePathRight;
    const draggable = document.querySelector('.dragging');
    
    if (draggable && rightPaneClosed) {
        e.preventDefault(); // ALWAYS allow drop
        
        const rect = editorWrapper.getBoundingClientRect();
        if (e.clientX > rect.left + (rect.width / 2)) {
            splitDropZone.style.display = 'block';
        } else {
            splitDropZone.style.display = 'none';
        }
    }
}, true); // Use capture to intercept before Monaco

editorWrapper.addEventListener('dragleave', (e) => {
    if (!editorWrapper.contains(e.relatedTarget)) {
        splitDropZone.style.display = 'none';
    }
}, true);

document.addEventListener('dragend', () => {
    splitDropZone.style.display = 'none';
}, true);

editorWrapper.addEventListener('drop', (e) => {
    const rightPaneClosed = openTabsRight.length === 0 && !currentFilePathRight;
    const draggable = document.querySelector('.dragging');
    
    if (draggable && rightPaneClosed) {
        const rect = editorWrapper.getBoundingClientRect();
        if (e.clientX > rect.left + (rect.width / 2)) {
            e.preventDefault();
            e.stopPropagation(); // prevent Monaco from eating it
            splitDropZone.style.display = 'none';
            
            const p = draggable.dataset.path;
            const n = draggable.dataset.name;
            
            // Remove from left
            openTabsLeft = openTabsLeft.filter(t => t.path !== p);
            let transferContent = null;
            
            if (currentFilePath === p) {
                transferContent = editor.getValue();
                if (openTabsLeft.length > 0) {
                    const next = openTabsLeft[openTabsLeft.length - 1];
                    currentFilePath = null; // force reload
                    openFile(next.path, next.name, 'left');
                } else {
                    currentFilePath = null;
                    editor.setValue('');
                }
            }
            
            // Open on right
            currentFilePathRight = p;
            openTabsRight.push({path: p, name: n});
            
            document.getElementById('editor-column-right').style.display = 'flex';
            document.getElementById('editor-container-right').style.display = 'block';
            
            if (transferContent !== null) {
                isSettingValue = true;
                editorRight.setValue(transferContent);
                monaco.editor.setModelLanguage(editorRight.getModel(), getLanguageFromFilename(n));
                isSettingValue = false;
            } else {
                openFile(p, n, 'right');
            }
            
            renderTabs();
            setTimeout(() => {
                if (editor) editor.layout();
                if (editorRight) editorRight.layout();
            }, 50);
        }
    }
}, true);
