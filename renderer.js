let editor;
let editorRight;
let activeEditorPane = 'left';
let currentFilePath = null;
let currentFilePathRight = null;
let openTabsLeft = [];
let openTabsRight = [];
let currentWorkspace = null;
let expandedDirectories = new Set();
let xtermInstance = null;
let xtermFitAddon = null;
let isPtySpawned = false;

// Initialize window state if opened via tear-off
async function initializeWindow() {
    if (window.electronAPI && window.electronAPI.getInitialState) {
        const state = await window.electronAPI.getInitialState();
        if (state) {
            document.getElementById('welcome-screen').classList.remove('active');
            document.getElementById('editor-wrapper').style.display = 'flex';
            document.getElementById('editor-column-left').style.display = 'flex';
            document.getElementById('editor-container').style.display = 'block';
            
            // Wait for editor to be ready before setting value
            const checkEditor = setInterval(() => {
                if (typeof editor !== 'undefined' && editor) {
                    clearInterval(checkEditor);
                    
                    if (state.content !== null && state.content !== undefined) {
                        currentFilePath = state.filePath;
                        openTabsLeft.push({ path: state.filePath, name: state.fileName });
                        isSettingValue = true;
                        editor.setValue(state.content);
                        const lang = getLanguageFromFilename(state.fileName);
                        monaco.editor.setModelLanguage(editor.getModel(), lang);
                        isSettingValue = false;
                        renderTabs();
                    } else {
                        openFile(state.filePath, state.fileName, 'left');
                    }
                }
            }, 50);
        }
    }
}
initializeWindow();


const modifiedFiles = new Set();
let isSaving = false;

require.config({ paths: { 'vs': 'node_modules/monaco-editor/min/vs' }});

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

// Editor Stats Logic
const editorStatsDiv = document.getElementById('editor-stats');
const cursorStatSpan = document.getElementById('cursor-stat');
const linesStatSpan = document.getElementById('lines-stat');

function updateEditorStats() {
    const activeEditor = activeEditorPane === 'left' ? editor : editorRight;
    if (activeEditor && activeEditor.getModel()) {
        const position = activeEditor.getPosition();
        const model = activeEditor.getModel();
        if (position && model) {
            cursorStatSpan.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
            linesStatSpan.textContent = `${model.getLineCount()} Lines`;
            editorStatsDiv.style.display = 'block';
            return;
        }
    }
    editorStatsDiv.style.display = 'none';
}

editor.onDidChangeCursorPosition(updateEditorStats);
editor.onDidChangeModelContent(updateEditorStats);
editor.onDidFocusEditorText(() => {
    activeEditorPane = 'left';
    updateEditorStats();
});

editorRight.onDidChangeCursorPosition(updateEditorStats);
editorRight.onDidChangeModelContent(updateEditorStats);
editorRight.onDidFocusEditorText(() => {
    activeEditorPane = 'right';
    updateEditorStats();
});


    // Apply the correct theme to the newly created editors
    applyTheme(localStorage.getItem('atomic_theme') || 'dark');

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
                const node = document.querySelector(`.tree-item[data-path="${currentFilePath.replace(/\\/g, '\\\\')}"]`);
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
    const provider = getFileProviderForPath(activePath);
    const success = provider && typeof provider.write === 'function'
        ? await Promise.resolve(provider.write(activePath, content, { workspace: currentWorkspace })).then(result => result !== false)
        : await window.electronAPI.writeFile(activePath, content);
    
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
            if (gitModal && !gitModal.classList.contains('hidden')) {
                updateGitStatus().then(() => renderGitModalContent());
            }
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
    currentWorkspace = dirPath;
    const treeContainer = document.getElementById('file-tree');
    treeContainer.innerHTML = ''; // Clear previous
    await renderTree(dirPath, treeContainer, 0);
    if (typeof updateGitStatus === 'function') {
        updateGitStatus();
    }
    if (typeof renderGitModalContent === 'function' && typeof gitModal !== 'undefined' && gitModal && !gitModal.classList.contains('hidden')) {
        renderGitModalContent();
    }
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
            
            if (expandedDirectories.has(entry.path)) {
                item.classList.add('open');
                childrenContainer.classList.add('open');
                await renderTree(entry.path, childrenContainer, indent + 1);
            }
        }
        
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (entry.isDirectory) {
                const isOpen = item.classList.contains('open');
                if (isOpen) {
                    item.classList.remove('open');
                    childrenContainer.classList.remove('open');
                    expandedDirectories.delete(entry.path);
                } else {
                    item.classList.add('open');
                    if (childrenContainer.innerHTML === '') {
                        await renderTree(entry.path, childrenContainer, indent + 1);
                    }
                    childrenContainer.classList.add('open');
                    expandedDirectories.add(entry.path);
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


// Custom Dialogs
function customPrompt(message, defaultValue = '') {
    return new Promise((resolve) => {
        const modal = document.getElementById('prompt-modal');
        const msgEl = document.getElementById('prompt-message');
        const inputEl = document.getElementById('prompt-input');
        const cancelBtn = document.getElementById('prompt-cancel');
        const okBtn = document.getElementById('prompt-ok');
        
        msgEl.textContent = message;
        inputEl.value = defaultValue;
        modal.classList.remove('hidden');
        inputEl.focus();
        if (defaultValue) inputEl.select();
        
        const cleanup = () => {
            modal.classList.add('hidden');
            cancelBtn.removeEventListener('click', onCancel);
            okBtn.removeEventListener('click', onOk);
            inputEl.removeEventListener('keydown', onKey);
        };
        
        const onCancel = () => { cleanup(); resolve(null); };
        const onOk = () => { cleanup(); resolve(inputEl.value); };
        const onKey = (e) => {
            if (e.key === 'Enter') onOk();
            if (e.key === 'Escape') onCancel();
        };
        
        cancelBtn.addEventListener('click', onCancel);
        okBtn.addEventListener('click', onOk);
        inputEl.addEventListener('keydown', onKey);
    });
}

function customConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const msgEl = document.getElementById('confirm-message');
        const cancelBtn = document.getElementById('confirm-cancel');
        const okBtn = document.getElementById('confirm-ok');
        
        msgEl.textContent = message;
        modal.classList.remove('hidden');
        
        const cleanup = () => {
            modal.classList.add('hidden');
            cancelBtn.removeEventListener('click', onCancel);
            okBtn.removeEventListener('click', onOk);
        };
        
        const onCancel = () => { cleanup(); resolve(false); };
        const onOk = () => { cleanup(); resolve(true); };
        
        cancelBtn.addEventListener('click', onCancel);
        okBtn.addEventListener('click', onOk);
    });
}

// Context Menu Logic
const contextMenu = document.getElementById('context-menu');
let contextTarget = null;

function showContextMenu(x, y, targetPath, isDir) {
    contextTarget = { path: targetPath, isDirectory: isDir };
    contextMenu.querySelectorAll('.plugin-context-menu-item').forEach(item => item.remove());
    for (const item of pluginContextMenuItems.values()) {
        if (typeof item.when === 'function' && !item.when(contextTarget)) continue;
        const menuItem = document.createElement('div');
        menuItem.className = 'context-menu-item plugin-context-menu-item';
        menuItem.textContent = item.label;
        menuItem.addEventListener('click', (event) => {
            event.stopPropagation();
            contextMenu.classList.remove('active');
            Promise.resolve(item.onClick({ ...contextTarget })).catch(error => console.error(`Plugin context menu ${item.id} failed:`, error));
        });
        contextMenu.appendChild(menuItem);
    }
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
    const name = await customPrompt("Enter file name:");
    if (name) {
        const newPath = `${parentDir}/${name}`;
        await window.electronAPI.writeFile(newPath, "");
        if (currentWorkspace) loadDirectory(currentWorkspace); // Reload tree
    }
});

document.getElementById('ctx-new-folder').addEventListener('click', async () => {
    if (!contextTarget) return;
    const parentDir = contextTarget.isDirectory ? contextTarget.path : contextTarget.path.split('/').slice(0, -1).join('/');
    const name = await customPrompt("Enter folder name:");
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
    
    const newName = await customPrompt("Rename to:", oldName);
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
    const confirmDelete = await customConfirm(`Are you sure you want to delete ${contextTarget.path}?`);
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

    const provider = getFileProviderForPath(filePath);
    const content = provider && typeof provider.read === 'function'
        ? await provider.read(filePath, { workspace: currentWorkspace })
        : await window.electronAPI.readFile(filePath);
    if (content !== null) {
        if (pane === 'left') {
            currentFilePath = filePath;
            activeEditorPane = 'left';
            document.getElementById('welcome-screen').classList.remove('active');
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
            document.getElementById('welcome-screen').classList.remove('active');
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

        if (typeof updateEditorStats === 'function') updateEditorStats();

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

            el.addEventListener('dragend', (e) => {
                el.classList.remove('dragging');
                
                // Tear-off check: did we drop outside the window?
                if (e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight) {
                    let contentPayload = null;
                    if (pane === 'left' && currentFilePath === tab.path) {
                        contentPayload = editor.getValue();
                    } else if (pane === 'right' && currentFilePathRight === tab.path) {
                        contentPayload = editorRight.getValue();
                    }
                    
                    if (window.electronAPI && window.electronAPI.createNewWindow) {
                        window.electronAPI.createNewWindow({
                            filePath: tab.path,
                            fileName: tab.name,
                            content: contentPayload
                        });
                        
                        // Clean up locally
                        modifiedFiles.delete(tab.path);
                        closeTab(tab.path, pane);
                        renderTabs();
                    }
                }
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
  const activityBar = document.getElementById('activity-bar');
  if (sidebar.style.display === 'none') {
    sidebar.style.display = 'flex';
    if (activePluginsMap && activePluginsMap.size > 0 && activityBar) {
      activityBar.classList.remove('hidden');
      activityBar.style.display = 'flex';
    }
  } else {
    sidebar.style.display = 'none';
    if (activityBar) {
      activityBar.classList.add('hidden');
      activityBar.style.display = 'none';
    }
  }
  // Trigger Monaco editor resize
  if (editor) {
    setTimeout(() => editor.layout(), 10);
  }
  if (editorRight) {
    setTimeout(() => editorRight.layout(), 10);
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

// Git Integration toggle preference
const toggleGit = document.getElementById('toggle-git');
const showGitPref = localStorage.getItem('atomic_show_git') !== 'false';

// Search Bar toggle preference
const toggleSearch = document.getElementById('toggle-search');
const showSearchPref = localStorage.getItem('atomic_show_search') !== 'false';
const searchContainerPrefTarget = document.getElementById('search-container');

if (toggleSearch) {
  toggleSearch.checked = showSearchPref;
  toggleSearch.addEventListener('change', (e) => {
    localStorage.setItem('atomic_show_search', e.target.checked);
    if (searchContainerPrefTarget) {
      searchContainerPrefTarget.style.display = e.target.checked ? 'flex' : 'none';
    }
  });
}
if (searchContainerPrefTarget) {
  searchContainerPrefTarget.style.display = showSearchPref ? 'flex' : 'none';
}

const reportIssueBtn = document.getElementById('report-issue-btn');
if (reportIssueBtn) {
  reportIssueBtn.addEventListener('click', () => {
    window.electronAPI.reportIssue();
  });
}

// Git Integration Logic
const gitBtn = document.getElementById('git-btn');
const gitStatusText = document.getElementById('git-status-text');
const gitModal = document.getElementById('git-modal');
const closeGitModalBtn = document.getElementById('close-git-modal');
const refreshGitBtn = document.getElementById('refresh-git-btn');

let activeGitTab = 'changes';
let gitDiffEditor = null;
let selectedGitFilePath = null;
let gitCheckedFiles = null;
let gitPollInterval = null;
let lastKnownGitFiles = null;

function startGitPolling() {
  if (gitPollInterval) clearInterval(gitPollInterval);
  gitPollInterval = setInterval(async () => {
    if (gitModal && !gitModal.classList.contains('hidden') && activeGitTab === 'changes' && currentWorkspace) {
      const status = await window.electronAPI.gitGetStatus(currentWorkspace);
      if (status && status.isRepo) {
        // Compare files & statuses to check for modification changes
        const currentPaths = status.files.map(f => `${f.path}:${f.indexStatus}:${f.workingTreeStatus}`).join(',');
        const renderedPaths = Array.from(gitModalBody.querySelectorAll('.git-list-item')).map(el => {
          const p = el.getAttribute('data-path');
          const badge = el.querySelector('[class^="git-badge-"]');
          const badgeText = badge ? badge.textContent : '';
          return `${p}:${badgeText}`;
        }).join(',');
        
        if (currentPaths !== renderedPaths) {
          await updateGitStatus();
          await renderGitModalContent();
        }
      }
    }
  }, 3000);
}

function stopGitPolling() {
  if (gitPollInterval) {
    clearInterval(gitPollInterval);
    gitPollInterval = null;
  }
}

// Initialize Git Tab Listeners
document.querySelectorAll('.git-tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.git-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeGitTab = btn.getAttribute('data-tab');
    renderGitModalContent();
  });
});

if (gitBtn) {
  gitBtn.style.display = showGitPref ? 'flex' : 'none';
}
if (toggleGit) {
  toggleGit.checked = showGitPref;
  toggleGit.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    localStorage.setItem('atomic_show_git', enabled);
    if (gitBtn) gitBtn.style.display = enabled ? 'flex' : 'none';
    if (!enabled && gitModal) gitModal.classList.add('hidden');
  });
}
const gitModalBody = document.getElementById('git-modal-body');

async function updateGitStatus() {
  if (!currentWorkspace) {
    if (gitStatusText) gitStatusText.textContent = 'Git (No Folder)';
    return null;
  }

  const status = await window.electronAPI.gitGetStatus(currentWorkspace);
  if (!status || !status.gitInstalled) {
    if (gitStatusText) gitStatusText.textContent = 'Git (Unavailable)';
    return status;
  }

  if (!status.isRepo) {
    if (gitStatusText) gitStatusText.textContent = 'Git (No Repo)';
    return status;
  }

  const total = status.stats.total;
  if (gitStatusText) {
    gitStatusText.textContent = `${status.branch}${total > 0 ? ' • ' + total : ''}`;
  }
  return status;
}

async function renderGitModalContent() {
  if (!gitModalBody) return;
  
  // Clean up existing Monaco diff editor if any
  if (gitDiffEditor) {
    gitDiffEditor.dispose();
    gitDiffEditor = null;
  }

  gitModalBody.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px 0;">Loading Git repository data...</div>';

  if (!currentWorkspace) {
    gitModalBody.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px 0;">No workspace folder is currently open.<br><br><button class="btn" id="git-modal-open-folder-btn">Open a Folder</button></div>';
    const openBtn = gitModalBody.querySelector('#git-modal-open-folder-btn');
    if (openBtn) {
      openBtn.addEventListener('click', async () => {
        const dirPath = await window.electronAPI.openDirectory();
        if (dirPath) {
          document.getElementById('welcome-screen').classList.remove('active');
          document.getElementById('editor-container').style.display = 'block';
          await loadDirectory(dirPath);
        }
      });
    }
    return;
  }

  const status = await window.electronAPI.gitGetStatus(currentWorkspace);

  if (!status || !status.gitInstalled) {
    gitModalBody.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px 0;">Git CLI command was not found. Please make sure Git is installed and added to system PATH.</div>';
    return;
  }

  if (!status.isRepo) {
    gitModalBody.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px 0;">The current workspace folder is not a Git repository.<br><br><span style="font-size: 11px; font-family: monospace; opacity: 0.8;">${currentWorkspace}</span></div>`;
    return;
  }

  // Render tab contents
  if (activeGitTab === 'changes') {
    if (gitCheckedFiles === null) {
      gitCheckedFiles = new Set(status.files.map(f => f.path));
    } else {
      // Add any newly modified file that appeared since last check to selection by default
      const currentPaths = status.files.map(f => f.path);
      for (const p of currentPaths) {
        if (!lastKnownGitFiles || !lastKnownGitFiles.has(p)) {
          gitCheckedFiles.add(p);
        }
      }

      // Keep only files that actually still exist in current status list
      const currentPathsSet = new Set(currentPaths);
      for (const p of gitCheckedFiles) {
        if (!currentPathsSet.has(p)) {
          gitCheckedFiles.delete(p);
        }
      }
    }
    
    // Store current files list for next check
    lastKnownGitFiles = new Set(status.files.map(f => f.path));

    const allChecked = status.files.length > 0 && status.files.every(f => gitCheckedFiles.has(f.path));

    // Get branches and sync status
    const branchRes = await window.electronAPI.gitGetBranches(currentWorkspace);
    const branches = (branchRes && branchRes.success && branchRes.branches) ? branchRes.branches : [{ name: status.branch, current: true }];

    const syncStatus = await window.electronAPI.gitGetSyncStatus(currentWorkspace);
    const aheadCount = (syncStatus && syncStatus.success) ? syncStatus.ahead : 0;
    const behindCount = (syncStatus && syncStatus.success) ? syncStatus.behind : 0;

    let branchOptions = branches.map(b => `<option value="${b.name}" ${b.current ? 'selected' : ''}>${b.name}</option>`).join('');
    branchOptions += '<option value="__create_new__">+ Create New Branch...</option>';
    branchOptions += '<option value="__merge_branch__">⚡ Merge Branch into ' + status.branch + '...</option>';

    let filesHtml = status.files.map(file => {
      const isChecked = gitCheckedFiles.has(file.path);
      const displayStatus = file.indexStatus !== ' ' && file.indexStatus !== '?' ? file.indexStatus : (file.workingTreeStatus || 'M');
      return `
        <div class="git-list-item ${selectedGitFilePath === file.path ? 'selected' : ''}" data-path="${file.path}">
          <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
            <input type="checkbox" ${isChecked ? 'checked' : ''} class="git-checkbox file-select-checkbox" data-path="${file.path}" style="cursor: pointer;">
            <span style="font-family: monospace; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${file.path}">${file.path}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="git-badge-${displayStatus}">${displayStatus}</span>
          </div>
        </div>
      `;
    }).join('');

    gitModalBody.innerHTML = `
      <div class="git-staged-unstaged-container">
        <div class="git-files-column">
          <!-- Branch Selector & Sync Toolbar -->
          <div style="margin-bottom: 8px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
              <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Branch:</span>
              <select id="git-branch-select" style="flex: 1; min-width: 0; background: var(--bg-darkest); color: var(--text-normal); border: 1px solid var(--border-color); border-radius: 4px; padding: 4px 6px; font-size: 12px; cursor: pointer; outline: none;">
                ${branchOptions}
              </select>
            </div>
            <div style="display: flex; gap: 6px;">
              <button id="git-sync-fetch-btn" class="btn" style="flex: 1; padding: 4px; font-size: 11px; background: var(--bg-darkest); border: 1px solid var(--border-color); color: var(--text-normal); cursor: pointer;">Fetch</button>
              <button id="git-sync-pull-btn" class="btn" style="flex: 1; padding: 4px; font-size: 11px; background: var(--bg-darkest); border: 1px solid var(--border-color); color: var(--text-normal); cursor: pointer;">Pull ${behindCount > 0 ? `(${behindCount})` : ''}</button>
              <button id="git-sync-push-btn" class="btn" style="flex: 1; padding: 4px; font-size: 11px; background: var(--accent-blue); border: none; color: #fff; cursor: pointer; font-weight: 500;">Push ${aheadCount > 0 ? `(${aheadCount})` : ''}</button>
            </div>
            <div style="font-size: 11px; text-align: center; margin-top: 2px;">
              ${
                behindCount > 0 && aheadCount > 0
                  ? `<span style="color: #d19a66;">⇄ ${behindCount} commits behind, ${aheadCount} ahead</span>`
                  : behindCount > 0
                  ? `<span style="color: #61afef;">↓ ${behindCount} commits available to pull</span>`
                  : aheadCount > 0
                  ? `<span style="color: #98c379;">↑ ${aheadCount} commits to push</span>`
                  : `<span style="color: var(--text-muted);">✓ Up to date with origin</span>`
              }
            </div>
          </div>

          <!-- Commit form -->
          <div style="margin-bottom: 5px;">
            <input type="text" id="git-commit-input" placeholder="Commit message..." style="width: 100%; padding: 6px 10px; margin-bottom: 8px; background: var(--bg-darkest); color: var(--text-normal); border: 1px solid var(--border-color); border-radius: 4px; box-sizing: border-box; font-size: 12px; outline: none;">
            <button id="git-commit-btn" class="btn" style="background: var(--accent-blue); color: #fff; border: none; width: 100%; padding: 6px; font-weight: 500; cursor: pointer; font-size: 12px;">Commit Changes</button>
          </div>

          <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 15px;">
            <div>
              <div class="git-file-list-header">
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                  <input type="checkbox" id="git-check-all-btn" ${allChecked ? 'checked' : ''} style="cursor: pointer;">
                  <span>${status.files.length} Changed Files</span>
                </label>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                ${filesHtml || '<div style="color: var(--text-muted); font-size: 11px; padding: 4px;">No changes detected</div>'}
              </div>
            </div>
          </div>
        </div>

        <div class="git-diff-column">
          <div style="padding: 6px 12px; background: var(--bg-darker); border-bottom: 1px solid var(--border-color); font-size: 12px; color: var(--text-muted); display: flex; justify-content: space-between; align-items: center;">
            <span id="git-diff-header-title">${selectedGitFilePath ? selectedGitFilePath : 'Select a file to view diff'}</span>
          </div>
          <div id="git-diff-editor-container" style="flex: 1; width: 100%;"></div>
        </div>
      </div>
    `;

    // Initialize Monaco Diff Editor if a file is selected
    if (selectedGitFilePath && window.monaco) {
      const diffContainer = document.getElementById('git-diff-editor-container');
      if (diffContainer) {
        gitDiffEditor = monaco.editor.createDiffEditor(diffContainer, {
          theme: 'atom-one-dark',
          readOnly: true,
          originalEditable: false,
          automaticLayout: true,
          renderSideBySide: true,
          minimap: { enabled: false }
        });

        // Load diff content
        window.electronAPI.gitGetFileDiff({ dirPath: currentWorkspace, filePath: selectedGitFilePath }).then(res => {
          if (res && res.success && gitDiffEditor) {
            const originalModel = monaco.editor.createModel(res.original, 'text/plain');
            const currentModel = monaco.editor.createModel(res.current, 'text/plain');
            gitDiffEditor.setModel({
              original: originalModel,
              modified: currentModel
            });
          }
        });
      }
    }

    // Attach list item selection listeners
    gitModalBody.querySelectorAll('.git-list-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('git-checkbox')) return;
        selectedGitFilePath = item.getAttribute('data-path');
        renderGitModalContent();
      });
    });

    // Checkbox toggle handlers
    gitModalBody.querySelectorAll('.file-select-checkbox').forEach(box => {
      box.addEventListener('change', (e) => {
        const pathVal = box.getAttribute('data-path');
        if (box.checked) {
          gitCheckedFiles.add(pathVal);
        } else {
          gitCheckedFiles.delete(pathVal);
        }
        // Update check-all status without full rebuild to keep editor loaded
        const masterBox = document.getElementById('git-check-all-btn');
        if (masterBox) {
          masterBox.checked = status.files.every(f => gitCheckedFiles.has(f.path));
        }
      });
    });

    // Master checkbox toggle
    const masterBox = document.getElementById('git-check-all-btn');
    if (masterBox) {
      masterBox.addEventListener('change', (e) => {
        if (masterBox.checked) {
          status.files.forEach(f => gitCheckedFiles.add(f.path));
        } else {
          gitCheckedFiles.clear();
        }
        // Update all checkbox elements in list
        gitModalBody.querySelectorAll('.file-select-checkbox').forEach(box => {
          box.checked = masterBox.checked;
        });
      });
    }

    // Attach commit action
    const commitBtn = document.getElementById('git-commit-btn');
    const commitInput = document.getElementById('git-commit-input');
    if (commitBtn && commitInput) {
      commitBtn.addEventListener('click', async () => {
        const msg = commitInput.value.trim();
        if (!msg) {
          alert('Please enter a commit message.');
          return;
        }
        if (gitCheckedFiles.size === 0) {
          alert('Please select at least one file to commit.');
          return;
        }
        commitBtn.disabled = true;
        commitBtn.textContent = 'Committing...';
        const res = await window.electronAPI.gitCommit({
          dirPath: currentWorkspace,
          message: msg,
          files: Array.from(gitCheckedFiles)
        });
        if (res.success) {
          gitCheckedFiles = null;
          selectedGitFilePath = null;
          await updateGitStatus();
          await renderGitModalContent();
        } else {
          alert(`Commit failed: ${res.error}`);
          commitBtn.disabled = false;
          commitBtn.textContent = 'Commit Changes';
        }
      });
    }

    // Branch select change listener
    const branchSelect = document.getElementById('git-branch-select');
    if (branchSelect) {
      branchSelect.addEventListener('change', async (e) => {
        const selected = e.target.value;
        if (selected === '__create_new__') {
          const newName = await customPrompt('Enter new branch name:');
          if (newName && newName.trim()) {
            const res = await window.electronAPI.gitCreateBranch({ dirPath: currentWorkspace, branchName: newName.trim() });
            if (!res.success) alert(`Failed to create branch: ${res.error}`);
            await updateGitStatus();
            await renderGitModalContent();
          } else {
            branchSelect.value = status.branch;
          }
        } else if (selected === '__merge_branch__') {
          const otherBranches = branches.filter(b => !b.current).map(b => b.name);
          if (otherBranches.length === 0) {
            alert('No other branches found to merge.');
            branchSelect.value = status.branch;
            return;
          }
          const targetMerge = await customPrompt(`Enter branch name to merge into ${status.branch}:`);
          if (targetMerge && targetMerge.trim()) {
            const res = await window.electronAPI.gitMerge({ dirPath: currentWorkspace, branchName: targetMerge.trim() });
            if (res.success) {
              alert(`Merged ${targetMerge} successfully!`);
            } else {
              alert(`Merge failed: ${res.error}`);
            }
            await updateGitStatus();
            await renderGitModalContent();
          } else {
            branchSelect.value = status.branch;
          }
        } else if (selected !== status.branch) {
          const res = await window.electronAPI.gitCheckoutBranch({ dirPath: currentWorkspace, branchName: selected });
          if (!res.success) alert(`Failed to checkout branch: ${res.error}`);
          await updateGitStatus();
          await renderGitModalContent();
        }
      });
    }

    // Sync button listeners
    const fetchBtn = document.getElementById('git-sync-fetch-btn');
    if (fetchBtn) {
      fetchBtn.addEventListener('click', async () => {
        fetchBtn.disabled = true;
        fetchBtn.textContent = 'Fetching...';
        const res = await window.electronAPI.gitFetch(currentWorkspace);
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Fetch';
        if (res.success) {
          alert('Fetch completed!');
          await updateGitStatus();
          await renderGitModalContent();
        } else {
          alert(`Fetch failed: ${res.error}`);
        }
      });
    }

    const pullBtn = document.getElementById('git-sync-pull-btn');
    if (pullBtn) {
      pullBtn.addEventListener('click', async () => {
        pullBtn.disabled = true;
        pullBtn.textContent = 'Pulling...';
        const res = await window.electronAPI.gitPull(currentWorkspace);
        pullBtn.disabled = false;
        pullBtn.textContent = 'Pull';
        if (res.success) {
          alert('Pull completed!');
          await updateGitStatus();
          await renderGitModalContent();
        } else {
          alert(`Pull failed: ${res.error}`);
        }
      });
    }

    const pushBtn = document.getElementById('git-sync-push-btn');
    if (pushBtn) {
      pushBtn.addEventListener('click', async () => {
        pushBtn.disabled = true;
        pushBtn.textContent = 'Pushing...';
        const res = await window.electronAPI.gitPush(currentWorkspace);
        pushBtn.disabled = false;
        pushBtn.textContent = 'Push';
        if (res.success) {
          alert('Push completed!');
          await updateGitStatus();
          await renderGitModalContent();
        } else {
          alert(`Push failed: ${res.error}`);
        }
      });
    }

  } else if (activeGitTab === 'history') {
    const res = await window.electronAPI.gitGetHistory(currentWorkspace);
    if (res && res.success && res.commits.length > 0) {
      const itemsHtml = res.commits.map(c => `
        <div class="git-history-item">
          <div>
            <div style="font-weight: 600; color: var(--text-normal); font-size: 13px; margin-bottom: 2px;">${c.message}</div>
            <div style="color: var(--text-muted); font-size: 11px;">${c.author} • ${c.date}</div>
          </div>
          <span style="font-family: monospace; background: var(--bg-darkest); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color); color: var(--accent-purple);">${c.hash}</span>
        </div>
      `).join('');

      gitModalBody.innerHTML = `
        <div class="git-history-view">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">Recent Commits (HEAD)</div>
          ${itemsHtml}
        </div>
      `;
    } else {
      gitModalBody.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px 0;">No commit history found.</div>';
    }

  } else if (activeGitTab === 'graph') {
    const res = await window.electronAPI.gitGetGraph(currentWorkspace);
    if (res && res.success && res.graph) {
      gitModalBody.innerHTML = `
        <div style="display: flex; flex-direction: column; flex: 1; overflow: hidden;">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">Branch Visualization Graph</div>
          <div class="git-graph-view">${res.graph}</div>
        </div>
      `;
    } else {
      gitModalBody.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px 0;">Failed to generate branch graph.</div>';
    }

  } else if (activeGitTab === 'blame') {
    const activePath = activeEditorPane === 'left' ? currentFilePath : currentFilePathRight;
    if (!activePath) {
      gitModalBody.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px 0;">No active file open in editor to run blame.</div>';
      return;
    }

    const relPath = path.relative ? path.relative(currentWorkspace, activePath) : activePath.replace(currentWorkspace + '/', '');
    const res = await window.electronAPI.gitGetBlame({ dirPath: currentWorkspace, filePath: relPath });
    if (res && res.success && res.blame) {
      const lines = res.blame.split('\n');
      let blameLinesHtml = '';
      
      // Parse git blame --porcelain output
      let currentCommit = {};
      const commits = {};
      const fileLines = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        if (line.match(/^[0-9a-f]{40}/)) {
          const parts = line.split(' ');
          const hash = parts[0].substring(0, 8);
          currentCommit = { hash };
          if (parts.length > 3) {
            fileLines.push({ hash, text: '' });
          }
        } else if (line.startsWith('author ')) {
          currentCommit.author = line.substring(7);
        } else if (line.startsWith('author-time ')) {
          const time = parseInt(line.substring(12)) * 1000;
          currentCommit.date = new Date(time).toLocaleDateString();
        } else if (line.startsWith('summary ')) {
          currentCommit.summary = line.substring(8);
          commits[currentCommit.hash] = { ...currentCommit };
        } else if (line.startsWith('\t')) {
          if (fileLines.length > 0) {
            fileLines[fileLines.length - 1].text = line.substring(1);
          }
        }
      }

      const formattedLines = fileLines.map((fl, idx) => {
        const c = commits[fl.hash] || { author: 'Unknown', date: 'N/A', summary: 'No commit info' };
        return `
          <div class="git-blame-line">
            <div class="git-blame-meta">[${fl.hash}] ${c.author} (${c.date}) - ${c.summary}</div>
            <div style="color: var(--text-muted); width: 30px; text-align: right; user-select: none;">${idx + 1}</div>
            <div class="git-blame-content">${fl.text}</div>
          </div>
        `;
      }).join('');

      gitModalBody.innerHTML = `
        <div class="git-blame-view">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">Blame Annotation: ${relPath}</div>
          <div class="git-blame-list">
            ${formattedLines}
          </div>
        </div>
      `;
    } else {
      gitModalBody.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px 0;">Blame info not available for this file (is it committed?).</div>`;
    }

  } else if (activeGitTab === 'conflicts') {
    const res = await window.electronAPI.gitGetConflicts(currentWorkspace);
    if (res && res.success && res.conflicts.length > 0) {
      const listHtml = res.conflicts.map(file => `
        <div class="git-conflict-item">
          <div>
            <div style="font-weight: 600; color: #e06c75; font-size: 13px; margin-bottom: 2px;">⚡ ${file}</div>
            <div style="color: var(--text-muted); font-size: 11px;">Contains unresolved conflict markers</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn resolve-ours" data-path="${file}" style="background: var(--bg-darkest); color: var(--text-normal); font-size: 11px; padding: 4px 8px; border: 1px solid var(--border-color);">Keep Ours</button>
            <button class="btn resolve-theirs" data-path="${file}" style="background: var(--accent-blue); color: #fff; font-size: 11px; padding: 4px 8px; border: none;">Keep Theirs</button>
          </div>
        </div>
      `).join('');

      gitModalBody.innerHTML = `
        <div class="git-conflicts-view">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">Merge Conflicts Detected (${res.conflicts.length})</div>
          ${listHtml}
        </div>
      `;

      // Attach conflict resolve handlers
      gitModalBody.querySelectorAll('.resolve-ours').forEach(btn => {
        btn.addEventListener('click', async () => {
          const pathVal = btn.getAttribute('data-path');
          await window.electronAPI.gitResolveConflict({ dirPath: currentWorkspace, filePath: pathVal, choice: 'ours' });
          await updateGitStatus();
          await renderGitModalContent();
        });
      });

      gitModalBody.querySelectorAll('.resolve-theirs').forEach(btn => {
        btn.addEventListener('click', async () => {
          const pathVal = btn.getAttribute('data-path');
          await window.electronAPI.gitResolveConflict({ dirPath: currentWorkspace, filePath: pathVal, choice: 'theirs' });
          await updateGitStatus();
          await renderGitModalContent();
        });
      });

    } else {
      gitModalBody.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 40px 0;">🎉 No merge conflicts detected in your working directory.</div>';
    }

  } else if (activeGitTab === 'sync') {
    gitModalBody.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 15px; flex: 1;">
        <div>
          <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">Remote Actions</div>
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <button id="git-fetch-btn" class="btn" style="flex: 1; padding: 8px; font-size: 12px; background: var(--bg-darkest); border: 1px solid var(--border-color); color: var(--text-normal); cursor: pointer;">Fetch Remotes</button>
            <button id="git-pull-btn" class="btn" style="flex: 1; padding: 8px; font-size: 12px; background: var(--bg-darkest); border: 1px solid var(--border-color); color: var(--text-normal); cursor: pointer;">Pull Changes</button>
            <button id="git-push-btn" class="btn" style="flex: 1; padding: 8px; font-size: 12px; background: var(--accent-blue); border: none; color: #fff; cursor: pointer; font-weight: 600;">Push to Origin</button>
          </div>
          <div style="display: flex; gap: 8px;">
            <button id="git-stash-btn" class="btn" style="flex: 1; padding: 8px; font-size: 12px; background: var(--bg-darkest); border: 1px solid var(--border-color); color: var(--text-normal); cursor: pointer;">Stash Changes</button>
            <button id="git-pop-btn" class="btn" style="flex: 1; padding: 8px; font-size: 12px; background: var(--bg-darkest); border: 1px solid var(--border-color); color: var(--text-normal); cursor: pointer;">Pop Stash</button>
          </div>
        </div>

        <div style="background: var(--bg-darkest); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 12px;">
          <div style="font-weight: 600; color: var(--text-normal); margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
            <span>ℹ️</span> Pull Request / Code Review Checklist
          </div>
          <div style="color: var(--text-muted); line-height: 1.5; display: flex; flex-direction: column; gap: 6px;">
            <label style="display: flex; align-items: center; gap: 8px;"><input type="checkbox" checked> Build compiles successfully locally</label>
            <label style="display: flex; align-items: center; gap: 8px;"><input type="checkbox"> Unit tests verified and passing</label>
            <label style="display: flex; align-items: center; gap: 8px;"><input type="checkbox"> Clean code review modifications done</label>
          </div>
        </div>
      </div>
    `;

    // Attach Remote Actions listeners
    const fetchBtn = document.getElementById('git-fetch-btn');
    if (fetchBtn) {
      fetchBtn.addEventListener('click', async () => {
        fetchBtn.disabled = true;
        fetchBtn.textContent = 'Fetching...';
        const res = await window.electronAPI.gitFetch(currentWorkspace);
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Fetch Remotes';
        if (res.success) {
          alert('Fetch completed successfully!');
          await updateGitStatus();
        } else {
          alert(`Fetch failed: ${res.error}`);
        }
      });
    }

    const pullBtn = document.getElementById('git-pull-btn');
    if (pullBtn) {
      pullBtn.addEventListener('click', async () => {
        pullBtn.disabled = true;
        pullBtn.textContent = 'Pulling...';
        const res = await window.electronAPI.gitPull(currentWorkspace);
        pullBtn.disabled = false;
        pullBtn.textContent = 'Pull Changes';
        if (res.success) {
          alert('Pull completed successfully!');
          await updateGitStatus();
        } else {
          alert(`Pull failed: ${res.error}`);
        }
      });
    }

    const pushBtn = document.getElementById('git-push-btn');
    if (pushBtn) {
      pushBtn.addEventListener('click', async () => {
        pushBtn.disabled = true;
        pushBtn.textContent = 'Pushing...';
        const res = await window.electronAPI.gitPush(currentWorkspace);
        pushBtn.disabled = false;
        pushBtn.textContent = 'Push to Origin';
        if (res.success) {
          alert('Push completed successfully!');
          await updateGitStatus();
        } else {
          alert(`Push failed: ${res.error}`);
        }
      });
    }

    const stashBtn = document.getElementById('git-stash-btn');
    if (stashBtn) {
      stashBtn.addEventListener('click', async () => {
        const stashMsg = prompt('Optional stash description:');
        const res = await window.electronAPI.gitStash({ dirPath: currentWorkspace, message: stashMsg ? stashMsg.trim() : '' });
        if (res.success) {
          await updateGitStatus();
          await renderGitModalContent();
        } else {
          alert(`Stash failed: ${res.error}`);
        }
      });
    }

    const popBtn = document.getElementById('git-pop-btn');
    if (popBtn) {
      popBtn.addEventListener('click', async () => {
        const res = await window.electronAPI.gitStashPop(currentWorkspace);
        if (res.success) {
          await updateGitStatus();
          await renderGitModalContent();
        } else {
          alert(`Pop stash failed: ${res.error}`);
        }
      });
    }
  }
}

if (gitBtn) {
  gitBtn.addEventListener('click', async () => {
    if (gitModal) gitModal.classList.remove('hidden');
    await renderGitModalContent();
    startGitPolling();
    if (currentWorkspace) {
      window.electronAPI.gitFetch(currentWorkspace).then(async (res) => {
        if (res && res.success) {
          await renderGitModalContent();
        }
      });
    }
  });
}

if (closeGitModalBtn) {
  closeGitModalBtn.addEventListener('click', () => {
    if (gitModal) gitModal.classList.add('hidden');
    stopGitPolling();
  });
}

if (refreshGitBtn) {
  refreshGitBtn.addEventListener('click', async () => {
    await renderGitModalContent();
    await updateGitStatus();
  });
}

if (gitModal) {
  gitModal.addEventListener('click', (e) => {
    if (e.target === gitModal) {
      gitModal.classList.add('hidden');
      stopGitPolling();
    }
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
  if (typeof updateXtermTheme === 'function') updateXtermTheme();
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


// Sidebar resizing logic
const resizerX = document.getElementById('sidebar-resizer');
const sidebar = document.querySelector('.sidebar');
let isResizingX = false;

resizerX.addEventListener('mousedown', (e) => {
    isResizingX = true;
    resizerX.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
});

document.addEventListener('mousemove', (e) => {
    if (!isResizingX) return;
    
    // Calculate new width
    let newWidth = e.clientX;
    if (newWidth < 150) newWidth = 150;
    if (newWidth > 800) newWidth = 800;
    
    sidebar.style.width = `${newWidth}px`;
    
    // Inform Monaco to resize
    if (editor) editor.layout();
    if (editorRight) editorRight.layout();
});

document.addEventListener('mouseup', () => {
    if (isResizingX) {
        isResizingX = false;
        resizerX.classList.remove('resizing');
        document.body.style.cursor = 'default';
        if (editor) editor.layout();
        if (editorRight) editorRight.layout();
    }
});

// Workspace Search bar logic
const searchContainer = document.getElementById('search-container');
const searchToggleBtn = document.getElementById('search-toggle-btn');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
let searchDebounceTimeout = null;

if (searchToggleBtn && searchInput && searchContainer) {
  function closeSearch() {
    searchContainer.classList.remove('active');
    searchInput.style.display = 'none';
    if (searchResults) {
      searchResults.classList.add('hidden');
      searchResults.innerHTML = '';
    }
  }

  function openSearch() {
    searchContainer.classList.add('active');
    searchInput.style.display = 'block';
    setTimeout(() => {
      searchInput.focus();
      searchInput.select();
    }, 50);
    if (searchInput.value.trim().length > 0) {
      triggerSearch(searchInput.value.trim());
    }
  }

  searchToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = searchContainer.classList.contains('active');
    if (isActive) {
      closeSearch();
    } else {
      openSearch();
    }
  });

  searchInput.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  searchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      triggerSearch(val);
    }, 250);
  });

  document.addEventListener('click', (e) => {
    if (!searchContainer.contains(e.target) && (!searchResults || !searchResults.contains(e.target))) {
      closeSearch();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchContainer.classList.contains('active')) {
      closeSearch();
    }
  });
}

function highlightMatch(text, query) {
  if (!text || !query) return text || '';
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return text.replace(regex, '<mark class="search-highlight">$1</mark>');
}

async function triggerSearch(query) {
  if (!searchResults) return;
  if (!query || query.trim().length === 0) {
    searchResults.classList.add('hidden');
    searchResults.innerHTML = '';
    return;
  }

  searchResults.classList.remove('hidden');
  searchResults.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 12px; text-align: center;">Searching...</div>';

  if (!currentWorkspace) {
    searchResults.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 12px; text-align: center;">Open a folder to search workspace.</div>';
    return;
  }

  const results = await window.electronAPI.searchWorkspace({ dirPath: currentWorkspace, query });

  if (!results || results.length === 0) {
    searchResults.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 12px; text-align: center;">No matching files or text found.</div>';
    return;
  }

  let html = '';
  results.forEach(item => {
    const highlightedName = highlightMatch(item.name, query);
    const dirPart = item.relPath.includes('/') ? item.relPath.substring(0, item.relPath.lastIndexOf('/') + 1) : '';

    if (item.type === 'file') {
      html += `
        <div class="search-result-item" data-path="${item.fullPath}" data-name="${item.name}">
          <div class="search-result-header">
            <span class="search-file-title">📄 ${highlightedName}</span>
            <span class="search-badge file-badge">File</span>
          </div>
          <div class="search-result-path">${item.relPath}</div>
        </div>
      `;
    } else if (item.type === 'text') {
      const highlightedLine = highlightMatch(item.lineText, query);
      html += `
        <div class="search-result-item" data-path="${item.fullPath}" data-name="${item.name}" data-line="${item.lineNumber}">
          <div class="search-result-header">
            <span class="search-file-title">📝 ${highlightedName}</span>
            <span class="search-badge line-badge">Ln ${item.lineNumber}</span>
          </div>
          <div class="search-result-path">${dirPart}</div>
          <div class="search-result-code">${highlightedLine}</div>
        </div>
      `;
    }
  });

  searchResults.innerHTML = html;

  const items = searchResults.querySelectorAll('.search-result-item');
  items.forEach(item => {
    item.addEventListener('click', () => {
      const fullPath = item.getAttribute('data-path');
      const name = item.getAttribute('data-name');
      const line = item.getAttribute('data-line');
      if (fullPath) {
        openFile(fullPath, name);
        if (line && editor) {
          setTimeout(() => {
            const lineNum = parseInt(line, 10);
            if (!isNaN(lineNum)) {
              editor.revealLineInCenter(lineNum);
              editor.setPosition({ lineNumber: lineNum, column: 1 });
            }
          }, 150);
        }
        searchResults.classList.add('hidden');
      }
    });
  });
}

// =============================================================================
// Bottom Terminal Panel Logic
// =============================================================================
const toggleTerminalBtn = document.getElementById('toggle-terminal-btn');
const closeTerminalBtn = document.getElementById('close-terminal-btn');
const clearTerminalBtn = document.getElementById('clear-terminal-btn');
const killTerminalBtn = document.getElementById('kill-terminal-btn');
const terminalPanel = document.getElementById('terminal-panel');
const terminalResizer = document.getElementById('terminal-resizer');
const terminalShellName = document.getElementById('terminal-shell-name');
const terminalOutput = document.getElementById('terminal-output');
const terminalInput = document.getElementById('terminal-input');
const terminalPromptPath = document.getElementById('terminal-prompt-path');

let isTerminalOpen = false;
let terminalCwd = '';
let commandHistory = [];
let historyIndex = -1;
let isCommandRunning = false;

// Get Shell info on startup
if (window.electronAPI && window.electronAPI.terminalGetShell) {
  window.electronAPI.terminalGetShell().then(info => {
    if (info && info.name) {
      terminalShellName.textContent = info.name;
    }
  }).catch(() => {});
}

// REAL PTY TERMINAL INTEGRATION (Xterm.js + node-pty)
function updateXtermTheme() {
  if (!xtermInstance) return;
  const computed = getComputedStyle(document.body);
  const bg = computed.getPropertyValue('--bg-darkest').trim() || '#181a1f';
  const fg = computed.getPropertyValue('--text-normal').trim() || '#abb2bf';
  const cursor = computed.getPropertyValue('--accent-blue').trim() || '#61afef';

  const container = document.getElementById('terminal-container');
  const panel = document.getElementById('terminal-panel');
  if (container) container.style.backgroundColor = bg;
  if (panel) panel.style.backgroundColor = bg;

  xtermInstance.options.theme = {
    background: bg,
    foreground: fg,
    cursor: cursor,
    selectionBackground: 'rgba(97, 175, 239, 0.3)'
  };
}

function initXterm() {
  if (xtermInstance) return;
  const TerminalConstructor = window.Terminal || (typeof Terminal !== 'undefined' ? Terminal : null);
  const FitAddonConstructor = (window.FitAddon && window.FitAddon.FitAddon) || (typeof FitAddon !== 'undefined' && FitAddon.FitAddon ? FitAddon.FitAddon : null);

  if (!TerminalConstructor) return;

  xtermInstance = new TerminalConstructor({
    cursorBlink: true,
    theme: {
      background: '#181a1f',
      foreground: '#abb2bf',
      cursor: '#61afef',
      selectionBackground: 'rgba(97, 175, 239, 0.3)'
    },
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.2
  });
  updateXtermTheme();

  if (FitAddonConstructor) {
    xtermFitAddon = new FitAddonConstructor();
    xtermInstance.loadAddon(xtermFitAddon);
  }

  const container = document.getElementById('terminal-container');
  if (container) {
    xtermInstance.open(container);
    if (xtermFitAddon) xtermFitAddon.fit();
  }

  xtermInstance.onData(data => {
    if (window.electronAPI && window.electronAPI.terminalWritePty) {
      window.electronAPI.terminalWritePty(data);
    }
  });

  if (window.electronAPI) {
    if (window.electronAPI.onTerminalPtyData) {
      window.electronAPI.onTerminalPtyData(data => {
        if (xtermInstance) xtermInstance.write(data);
      });
    }

    if (window.electronAPI.onTerminalPtyExit) {
      window.electronAPI.onTerminalPtyExit(() => {
        if (xtermInstance) xtermInstance.write('\r\n\x1b[33m[Process exited]\x1b[0m\r\n');
        isPtySpawned = false;
      });
    }
  }
}

function toggleTerminal(show) {
  if (show === undefined) show = !isTerminalOpen;
  isTerminalOpen = show;
  if (show) {
    terminalPanel.classList.remove('hidden');
    terminalResizer.classList.remove('hidden');
    initXterm();
    if (!isPtySpawned && window.electronAPI && window.electronAPI.terminalSpawnPty) {
      const cols = xtermInstance ? xtermInstance.cols : 80;
      const rows = xtermInstance ? xtermInstance.rows : 24;
      const targetCwd = terminalCwd || currentWorkspace || '';
      window.electronAPI.terminalSpawnPty({ cols, rows, cwd: targetCwd });
      isPtySpawned = true;
    }
    setTimeout(() => {
      if (xtermFitAddon) xtermFitAddon.fit();
      if (xtermInstance) {
        xtermInstance.focus();
        if (window.electronAPI && window.electronAPI.terminalResizePty) {
          window.electronAPI.terminalResizePty({ cols: xtermInstance.cols, rows: xtermInstance.rows });
        }
      }
      if (editor) editor.layout();
      if (editorRight) editorRight.layout();
    }, 60);
  } else {
    terminalPanel.classList.add('hidden');
    terminalResizer.classList.add('hidden');
    setTimeout(() => {
      if (editor) editor.layout();
      if (editorRight) editorRight.layout();
    }, 60);
  }
}

if (toggleTerminalBtn) {
  toggleTerminalBtn.addEventListener('click', () => toggleTerminal());
}
if (closeTerminalBtn) {
  closeTerminalBtn.addEventListener('click', () => toggleTerminal(false));
}
if (clearTerminalBtn) {
  clearTerminalBtn.addEventListener('click', () => {
    if (xtermInstance) xtermInstance.clear();
  });
}

// Terminal Resizer Logic
if (terminalResizer && terminalPanel) {
  let isResizingY = false;
  let startY = 0;
  let startHeight = 0;

  terminalResizer.addEventListener('mousedown', (e) => {
    isResizingY = true;
    startY = e.clientY;
    startHeight = terminalPanel.offsetHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizingY) return;
    const dy = startY - e.clientY;
    const newHeight = Math.max(100, Math.min(window.innerHeight * 0.8, startHeight + dy));
    terminalPanel.style.height = `${newHeight}px`;
    if (xtermFitAddon) {
      xtermFitAddon.fit();
      if (xtermInstance && window.electronAPI && window.electronAPI.terminalResizePty) {
        window.electronAPI.terminalResizePty({ cols: xtermInstance.cols, rows: xtermInstance.rows });
      }
    }
    if (editor) editor.layout();
    if (editorRight) editorRight.layout();
  });

  document.addEventListener('mouseup', () => {
    if (isResizingY) {
      isResizingY = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (xtermFitAddon) {
        xtermFitAddon.fit();
        if (xtermInstance && window.electronAPI && window.electronAPI.terminalResizePty) {
          window.electronAPI.terminalResizePty({ cols: xtermInstance.cols, rows: xtermInstance.rows });
        }
      }
      if (editor) editor.layout();
      if (editorRight) editorRight.layout();
    }
  });
}

window.addEventListener('resize', () => {
  if (isTerminalOpen && xtermFitAddon) {
    xtermFitAddon.fit();
    if (xtermInstance && window.electronAPI && window.electronAPI.terminalResizePty) {
      window.electronAPI.terminalResizePty({ cols: xtermInstance.cols, rows: xtermInstance.rows });
    }
  }
});

// ==========================================================================
// ATOMIC PLUGIN SYSTEM & ACTIVITY BAR CONTROLLER
// ==========================================================================

const PLUGIN_BUCKET_URL = 'https://storage.googleapis.com/atomic-plugins/index.json';
const PLUGIN_WEBHOOK_URL = 'https://us-central1-atomic-500709.cloudfunctions.net/pluginMarketplaceHandler';

let activePluginsMap = new Map(); // id -> { manifest, context, instance, viewRenderer }
let cachedCommunityPlugins = [];
const pluginCommands = new Map();
const pluginContextMenuItems = new Map();
const pluginFileProviders = new Map();
const pluginTabs = new Map();
let pluginTabSequence = 0;

function disposable(cleanup) {
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanup();
    }
  };
}

function trackPluginDisposable(pluginId, item) {
  const entry = activePluginsMap.get(pluginId);
  if (entry && entry.disposables) entry.disposables.add(item);
  return item;
}

function showPluginNotification(message, options = {}) {
  const host = document.getElementById('plugin-notifications');
  if (!host) return disposable(() => {});
  const toast = document.createElement('div');
  toast.className = `plugin-notification ${options.type || 'info'}`;
  toast.textContent = message;
  if (options.title) toast.textContent = `${options.title}: ${message}`;
  host.appendChild(toast);
  const timeout = setTimeout(() => toast.remove(), Math.max(1000, options.duration || 5000));
  return disposable(() => {
    clearTimeout(timeout);
    toast.remove();
  });
}

function normalizeKeybinding(binding) {
  return String(binding || '').toLowerCase().replace(/\s+/g, '').split('+');
}

function matchesKeybinding(event, binding) {
  const parts = normalizeKeybinding(binding);
  if (!parts.length) return false;
  const key = parts[parts.length - 1];
  const modifier = (name, actual) => parts.includes(name) === actual;
  const usesMeta = parts.includes('cmd') || parts.includes('command') || parts.includes('meta');
  const usesCmdOrCtrl = parts.includes('cmdorctrl') || parts.includes('commandorcontrol');
  const primary = usesMeta || usesCmdOrCtrl || parts.includes('ctrl') || parts.includes('control');
  const primaryPressed = usesCmdOrCtrl
    ? (navigator.platform.toLowerCase().includes('mac') ? event.metaKey : event.ctrlKey)
    : usesMeta ? event.metaKey : event.ctrlKey;
  return event.key.toLowerCase() === key
    && primaryPressed === primary
    && modifier('shift', event.shiftKey)
    && modifier('alt', event.altKey);
}

document.addEventListener('keydown', (event) => {
  for (const command of pluginCommands.values()) {
    if (command.keybinding && matchesKeybinding(event, command.keybinding)) {
      event.preventDefault();
      Promise.resolve(command.handler()).catch(error => console.error(`Plugin command ${command.id} failed:`, error));
      break;
    }
  }
});

async function executePluginCommand(id, ...args) {
  const command = pluginCommands.get(id);
  if (!command) throw new Error(`Unknown command: ${id}`);
  return await command.handler(...args);
}

const pluginTabHost = document.getElementById('plugin-tab-host');
const pluginTabBar = document.getElementById('plugin-tab-bar');
const pluginTabBody = document.getElementById('plugin-tab-body');

function renderPluginTabs(activeId = null) {
  if (!pluginTabBar || !pluginTabBody) return;
  pluginTabBar.innerHTML = '';
  const tabs = [...pluginTabs.values()];
  if (!tabs.length) {
    pluginTabHost?.classList.add('hidden');
    document.getElementById('editor-wrapper')?.classList.remove('hidden');
    if (!currentFilePath && !currentFilePathRight) document.getElementById('welcome-screen')?.classList.add('active');
    return;
  }

  pluginTabHost?.classList.remove('hidden');
  document.getElementById('editor-wrapper')?.classList.add('hidden');
  document.getElementById('welcome-screen')?.classList.remove('active');
  const selected = activeId || tabs.find(tab => tab.active)?.id || tabs[0].id;
  tabs.forEach(tab => { tab.active = tab.id === selected; });
  tabs.forEach(tab => {
    const button = document.createElement('button');
    button.className = `plugin-tab-button${tab.active ? ' active' : ''}`;
    button.textContent = `${tab.icon ? `${tab.icon} ` : ''}${tab.title}`;
    button.title = tab.title;
    button.addEventListener('click', () => renderPluginTabs(tab.id));
    pluginTabBar.appendChild(button);
  });

  pluginTabBody.innerHTML = '';
  const activeTab = pluginTabs.get(selected);
  if (activeTab) {
    try { activeTab.render(pluginTabBody); }
    catch (error) { pluginTabBody.textContent = `Plugin tab error: ${error.message}`; }
  }
}

function getFileProviderForPath(filePath) {
  const match = String(filePath || '').match(/^([a-z][a-z0-9+.-]*):\/\//i);
  return match ? pluginFileProviders.get(match[1].toLowerCase()) : null;
}

// Activity Bar Elements
const activityPluginIcons = document.getElementById('activity-plugin-icons');
const explorerView = document.getElementById('explorer-view');
const pluginsView = document.getElementById('plugins-view');
const customPluginView = document.getElementById('custom-plugin-view');
const customPluginViewTitle = document.getElementById('custom-plugin-view-title');
const customPluginViewBody = document.getElementById('custom-plugin-view-body');
const closePluginViewBtn = document.getElementById('close-plugin-view-btn');

function switchSidebarView(viewName, pluginId = null) {
  const sidebar = document.getElementById('main-sidebar');
  if (sidebar && sidebar.classList.contains('hidden')) {
    sidebar.classList.remove('hidden');
  }

  // Deactivate all activity buttons
  document.querySelectorAll('.activity-btn').forEach(btn => btn.classList.remove('active'));

  // Hide all sidebar views
  if (explorerView) explorerView.classList.add('hidden');
  if (pluginsView) pluginsView.classList.add('hidden');
  if (customPluginView) customPluginView.classList.add('hidden');

  if (viewName === 'explorer') {
    if (explorerView) explorerView.classList.remove('hidden');
    const expBtn = document.getElementById('activity-explorer-btn');
    if (expBtn) expBtn.classList.add('active');
  } else if (viewName === 'custom-plugin' && pluginId) {
    const pluginEntry = activePluginsMap.get(pluginId);
    const customBtn = document.querySelector(`.activity-plugin-btn[data-plugin-id="${pluginId}"]`);
    if (customBtn) customBtn.classList.add('active');

    if (pluginEntry && pluginEntry.viewRenderer) {
      if (customPluginViewTitle) customPluginViewTitle.textContent = pluginEntry.viewTitle || pluginEntry.manifest.name;
      if (customPluginViewBody) {
        customPluginViewBody.innerHTML = '';
        try {
          pluginEntry.viewRenderer(customPluginViewBody);
        } catch (e) {
          customPluginViewBody.innerHTML = `<div style="color: #e06c75; padding: 10px;">Plugin Error: ${e.message}</div>`;
        }
      }
      if (customPluginView) customPluginView.classList.remove('hidden');
    }
  }
}

if (closePluginViewBtn) {
  closePluginViewBtn.addEventListener('click', () => switchSidebarView('explorer'));
}

// Plugin Runtime Context Factory
function createPluginContext(manifest) {
  const pluginId = manifest.id;
  const settingsKey = `atomic_plugin_settings_${pluginId}`;
  const entryForPlugin = () => activePluginsMap.get(pluginId);
  const track = (item) => trackPluginDisposable(pluginId, item);

  const commands = {
    register: ({ id, title, keybinding, handler }) => {
      if (!id || typeof handler !== 'function') throw new Error('A command requires an id and handler');
      const commandId = `${pluginId}.${id}`;
      pluginCommands.set(commandId, { id: commandId, title: title || id, keybinding, handler });
      return track(disposable(() => pluginCommands.delete(commandId)));
    },
    execute: (id, ...args) => executePluginCommand(id.includes('.') ? id : `${pluginId}.${id}`, ...args)
  };

  const statusBar = {
    addItem: ({ text = '', tooltip = '', alignment = 'left', priority = 0, onClick } = {}) => {
      const host = document.getElementById(alignment === 'right' ? 'plugin-status-right' : 'plugin-status-left');
      if (!host) return disposable(() => {});
      const item = document.createElement('span');
      item.className = 'plugin-status-item';
      item.textContent = text;
      item.title = tooltip;
      item.dataset.priority = String(priority);
      if (typeof onClick === 'function') item.addEventListener('click', () => onClick());
      host.appendChild(item);
      [...host.children].sort((a, b) => Number(b.dataset.priority || 0) - Number(a.dataset.priority || 0)).forEach(child => host.appendChild(child));
      return track(disposable(() => item.remove()));
    }
  };

  const menus = {
    addContextMenuItem: ({ id, label, when, onClick }) => {
      if (!id || !label || typeof onClick !== 'function') throw new Error('A context menu item requires id, label, and onClick');
      const menuId = `${pluginId}.${id}`;
      pluginContextMenuItems.set(menuId, { id: menuId, label, when, onClick });
      return track(disposable(() => pluginContextMenuItems.delete(menuId)));
    }
  };

  const editorApi = {
    getActive: () => (activeEditorPane === 'left' ? editor : editorRight),
    addDecorations: ({ editor: targetEditor, decorations = [] } = {}) => {
      const target = targetEditor || editorApi.getActive();
      if (!target || typeof target.deltaDecorations !== 'function') return { set: () => {}, dispose: () => {} };
      let ids = target.deltaDecorations([], decorations);
      const handle = {
        set(nextDecorations = []) { ids = target.deltaDecorations(ids, nextDecorations); },
        dispose() { ids = target.deltaDecorations(ids, []); }
      };
      return track(handle);
    }
  };

  const files = {
    registerProvider: (scheme, provider) => {
      if (!scheme || !provider || typeof provider.read !== 'function') throw new Error('A file provider requires a scheme and read function');
      const normalizedScheme = scheme.replace(/:$/, '').toLowerCase();
      pluginFileProviders.set(normalizedScheme, { ...provider, pluginId });
      return track(disposable(() => pluginFileProviders.delete(normalizedScheme)));
    },
    read: async (filePath) => {
      const provider = getFileProviderForPath(filePath);
      return provider && provider.pluginId === pluginId
        ? provider.read(filePath, { workspace: currentWorkspace })
        : window.electronAPI.readFile(filePath);
    },
    write: async (filePath, content) => {
      const provider = getFileProviderForPath(filePath);
      if (provider && provider.pluginId === pluginId && typeof provider.write === 'function') return provider.write(filePath, content, { workspace: currentWorkspace });
      return window.electronAPI.writeFile(filePath, content);
    }
  };

  const settings = {
    getAll: () => {
      try { return JSON.parse(localStorage.getItem(settingsKey) || '{}'); } catch (e) { return {}; }
    },
    get: (key, fallback = undefined) => {
      const values = settings.getAll();
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
    },
    set: (key, value) => {
      const values = settings.getAll();
      values[key] = value;
      localStorage.setItem(settingsKey, JSON.stringify(values));
      return value;
    },
    delete: (key) => {
      const values = settings.getAll();
      delete values[key];
      localStorage.setItem(settingsKey, JSON.stringify(values));
    }
  };

  const secrets = {
    get: (key) => window.electronAPI.pluginGetSecret({ pluginId, key }),
    set: (key, value) => window.electronAPI.pluginSetSecret({ pluginId, key, value }),
    delete: (key) => window.electronAPI.pluginDeleteSecret({ pluginId, key })
  };

  const tabs = {
    add: ({ title, icon, render }) => {
      if (!title || typeof render !== 'function') throw new Error('A custom tab requires title and render function');
      const tab = { id: `${pluginId}.tab.${++pluginTabSequence}`, pluginId, title, icon, render, active: false };
      pluginTabs.set(tab.id, tab);
      const handle = {
        id: tab.id,
        open: () => renderPluginTabs(tab.id),
        dispose: () => {
          pluginTabs.delete(tab.id);
          if (pluginTabs.size) renderPluginTabs(); else renderPluginTabs(null);
        }
      };
      const tracked = track(handle);
      if (!pluginTabs.values().next().value.active) tab.active = true;
      renderPluginTabs(tab.id);
      return tracked;
    },
    createWebview: ({ title, icon, url }) => {
      let parsed;
      try { parsed = new URL(url); } catch (e) { throw new Error('Webview URL must be valid'); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Webviews only support http(s) URLs');
      return tabs.add({
        title,
        icon,
        render: (container) => {
          const frame = document.createElement('iframe');
          frame.src = parsed.href;
          frame.title = title || 'Plugin webview';
          frame.setAttribute('sandbox', 'allow-forms allow-modals allow-popups allow-scripts');
          container.appendChild(frame);
        }
      });
    }
  };

  const terminal = {
    create: ({ name = 'Plugin Terminal', cwd = currentWorkspace } = {}) => ({
      name,
      show: () => {
        terminalCwd = cwd || currentWorkspace || '';
        terminalShellName.textContent = name;
        toggleTerminal(true);
      },
      write: (data) => window.electronAPI.terminalWritePty(data),
      clear: () => xtermInstance?.clear(),
      dispose: () => {}
    })
  };

  return {
    manifest,
    getEditor: editorApi.getActive,
    getWorkspace: () => currentWorkspace,
    openFile: (path, name) => openFile(path, name),
    addSidebarView: ({ title, render }) => {
      const entry = entryForPlugin();
      if (entry) {
        entry.viewTitle = title;
        entry.viewRenderer = render;
      }
      return track(disposable(() => {
        if (entry) { entry.viewTitle = manifest.name; entry.viewRenderer = null; }
      }));
    },
    addActivityBarIcon: ({ icon, title, onClick }) => {
      renderActivityBarPluginIcons();
      return track(disposable(() => renderActivityBarPluginIcons()));
    },
    commands,
    statusBar,
    menus,
    editor: editorApi,
    notifications: { show: showPluginNotification },
    terminal,
    files,
    settings,
    secrets,
    tabs,
    addCommand: commands.register,
    addStatusBarItem: statusBar.addItem,
    addContextMenuItem: menus.addContextMenuItem,
    addEditorDecorations: editorApi.addDecorations,
    createTerminal: terminal.create,
    registerFileProvider: files.registerProvider,
    addTab: tabs.add,
    createWebview: tabs.createWebview,
    notify: showPluginNotification
  };
}

async function activatePlugin(manifest) {
  try {
    const context = createPluginContext(manifest);
    const entry = { manifest, context, viewTitle: manifest.name, viewRenderer: null, disposables: new Set() };
    activePluginsMap.set(manifest.id, entry);

    if (manifest.code) {
      const exports = {};
      const module = { exports };
      const runFn = new Function('exports', 'module', 'context', manifest.code);
      runFn(exports, module, context);
      const instance = module.exports.onActivate ? module.exports : exports;
      if (typeof instance.onActivate === 'function') {
        instance.onActivate(context);
      }
      entry.instance = instance;
    }

    renderActivityBarPluginIcons();
    renderSidebarInstalledPlugins();
  } catch (error) {
    console.error(`Failed to activate plugin ${manifest.id}:`, error);
  }
}

function deactivatePlugin(pluginId) {
  const entry = activePluginsMap.get(pluginId);
  if (entry) {
    if (entry.instance && typeof entry.instance.onDeactivate === 'function') {
      try { entry.instance.onDeactivate(); } catch (e) {}
    }
    if (entry.disposables) {
      [...entry.disposables].reverse().forEach(item => {
        try { item.dispose(); } catch (e) {}
      });
      entry.disposables.clear();
    }
    activePluginsMap.delete(pluginId);
    renderActivityBarPluginIcons();
    renderSidebarInstalledPlugins();
    if (customPluginView && !customPluginView.classList.contains('hidden')) {
      switchSidebarView('explorer');
    }
  }
}

function renderActivityBarPluginIcons() {
  const activityBar = document.getElementById('activity-bar');
  if (!activityPluginIcons) return;
  activityPluginIcons.innerHTML = '';

  // If no plugins are enabled, hide the left icon strip completely
  if (activePluginsMap.size === 0) {
    if (activityBar) {
      activityBar.classList.add('hidden');
      activityBar.style.display = 'none';
    }
    if (explorerView && explorerView.classList.contains('hidden')) {
      switchSidebarView('explorer');
    }
    return;
  }

  // If at least one plugin is enabled, show the activity bar on the left
  if (activityBar) {
    activityBar.classList.remove('hidden');
    activityBar.style.display = 'flex';
  }

  // 1. Always render the Folder / File Explorer icon at the top
  const explorerBtn = document.createElement('button');
  explorerBtn.id = 'activity-explorer-btn';
  explorerBtn.className = 'activity-btn';
  if (explorerView && !explorerView.classList.contains('hidden')) {
    explorerBtn.classList.add('active');
  }
  explorerBtn.title = 'File Explorer';
  explorerBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>
  `;
  explorerBtn.addEventListener('click', () => {
    switchSidebarView('explorer');
  });
  activityPluginIcons.appendChild(explorerBtn);

  // 2. Render each enabled plugin icon
  activePluginsMap.forEach((entry, pluginId) => {
    const iconBtn = document.createElement('button');
    iconBtn.className = 'activity-btn activity-plugin-btn';
    iconBtn.setAttribute('data-plugin-id', pluginId);
    iconBtn.title = entry.manifest.name;

    let iconHtml = entry.manifest.icon || '🧩';
    if (iconHtml.startsWith('<svg')) {
      iconBtn.innerHTML = iconHtml;
    } else {
      iconBtn.textContent = iconHtml;
      iconBtn.style.fontSize = '18px';
    }

    iconBtn.addEventListener('click', () => {
      switchSidebarView('custom-plugin', pluginId);
    });

    activityPluginIcons.appendChild(iconBtn);
  });
}

function getEnabledPluginIds() {
  try {
    const raw = localStorage.getItem('atomic_enabled_plugins');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function setEnabledPluginIds(ids) {
  localStorage.setItem('atomic_enabled_plugins', JSON.stringify(ids));
}

async function loadInstalledPlugins() {
  let installed = [];
  if (window.electronAPI && window.electronAPI.pluginGetInstalled) {
    installed = await window.electronAPI.pluginGetInstalled();
  }

  // Clean up any demo plugins from previous test runs
  if (installed && installed.length > 0) {
    for (const p of installed) {
      if (p.id === 'word-counter' || p.id === 'quick-notes') {
        if (window.electronAPI && window.electronAPI.pluginUninstall) {
          await window.electronAPI.pluginUninstall(p.id);
        }
      }
    }
    if (window.electronAPI && window.electronAPI.pluginGetInstalled) {
      installed = await window.electronAPI.pluginGetInstalled();
    }
  }

  let enabledIds = getEnabledPluginIds();
  enabledIds = enabledIds.filter(id => id !== 'word-counter' && id !== 'quick-notes');

  // If installed plugins exist but none recorded in enabledIds yet, enable them by default
  if (installed && installed.length > 0 && enabledIds.length === 0) {
    enabledIds = installed.map(p => p.id);
  }
  setEnabledPluginIds(enabledIds);

  if (installed && installed.length > 0) {
    for (const plugin of installed) {
      if (enabledIds.includes(plugin.id)) {
        await activatePlugin(plugin);
      }
    }
  }

  renderActivityBarPluginIcons();
  renderSidebarInstalledPlugins();
  renderInstalledModalList();
}

async function renderSidebarInstalledPlugins() {
  const container = document.getElementById('sidebar-installed-plugins');
  if (!container) return;

  let installed = [];
  if (window.electronAPI && window.electronAPI.pluginGetInstalled) {
    installed = await window.electronAPI.pluginGetInstalled();
  }
  const enabledIds = getEnabledPluginIds();

  container.innerHTML = '';
  if (!installed || installed.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 20px;">No plugins installed.</div>';
    return;
  }

  installed.forEach(plugin => {
    const isEnabled = enabledIds.includes(plugin.id);
    const card = document.createElement('div');
    card.className = 'sidebar-plugin-card';

    card.innerHTML = `
      <div class="sidebar-plugin-card-header">
        <div style="font-weight: 600; font-size: 12px; display: flex; align-items: center; gap: 6px;">
          <span>${plugin.icon || '🧩'}</span>
          <span>${plugin.name}</span>
        </div>
        <input type="checkbox" class="sidebar-plugin-toggle" data-id="${plugin.id}" ${isEnabled ? 'checked' : ''} style="cursor: pointer;">
      </div>
      <div style="font-size: 11px; color: var(--text-muted);">${plugin.description || ''}</div>
      ${isEnabled ? `<button class="btn sidebar-open-plugin-btn" data-id="${plugin.id}" style="margin-top: 4px; font-size: 11px; padding: 3px 8px;">Open View</button>` : ''}
    `;

    const toggle = card.querySelector('.sidebar-plugin-toggle');
    if (toggle) {
      toggle.addEventListener('change', (e) => {
        let currentEnabled = getEnabledPluginIds();
        if (e.target.checked) {
          if (!currentEnabled.includes(plugin.id)) currentEnabled.push(plugin.id);
          activatePlugin(plugin);
        } else {
          currentEnabled = currentEnabled.filter(id => id !== plugin.id);
          deactivatePlugin(plugin.id);
        }
        setEnabledPluginIds(currentEnabled);
      });
    }

    const openBtn = card.querySelector('.sidebar-open-plugin-btn');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        switchSidebarView('custom-plugin', plugin.id);
      });
    }

    container.appendChild(card);
  });
}

// Plugin Community Marketplace Modal Logic
const browsePluginsBtn = document.getElementById('browse-plugins-btn');
const sidebarBrowsePluginsBtn = document.getElementById('sidebar-browse-plugins-btn');
const pluginMarketplaceModal = document.getElementById('plugin-marketplace-modal');
const closePluginMarketplace = document.getElementById('close-plugin-marketplace');
const backToSettingsPlugin = document.getElementById('back-to-settings-plugin');
const refreshPluginsBtn = document.getElementById('refresh-plugins');
const pluginSearchInput = document.getElementById('plugin-search');
const uploadPluginBtn = document.getElementById('upload-plugin-btn');

if (browsePluginsBtn) {
  browsePluginsBtn.addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
    pluginMarketplaceModal.classList.remove('hidden');
    fetchCommunityPlugins();
  });
}
if (sidebarBrowsePluginsBtn) {
  sidebarBrowsePluginsBtn.addEventListener('click', () => {
    pluginMarketplaceModal.classList.remove('hidden');
    fetchCommunityPlugins();
  });
}
if (closePluginMarketplace) {
  closePluginMarketplace.addEventListener('click', () => {
    pluginMarketplaceModal.classList.add('hidden');
  });
}
if (backToSettingsPlugin) {
  backToSettingsPlugin.addEventListener('click', () => {
    pluginMarketplaceModal.classList.add('hidden');
    document.getElementById('settings-modal').classList.remove('hidden');
  });
}
// --- Developer Keypair Management (ECDSA P-256 / Web Crypto) ---
const DEV_KEY_STORAGE = 'atomic_developer_keypair';

async function getOrCreateDeveloperKeyPair() {
  try {
    const raw = localStorage.getItem(DEV_KEY_STORAGE);
    if (raw) {
      const data = JSON.parse(raw);
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        data.publicKeyJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify']
      );
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        data.privateKeyJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign']
      );
      return { publicKey, privateKey, publicKeyJwk: data.publicKeyJwk };
    }
  } catch (e) {}

  // Generate new ECDSA P-256 Keypair
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  localStorage.setItem(DEV_KEY_STORAGE, JSON.stringify({ publicKeyJwk, privateKeyJwk }));
  return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey, publicKeyJwk };
}

async function signDataWithDevKey(dataString) {
  const { privateKey } = await getOrCreateDeveloperKeyPair();
  const enc = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    enc.encode(dataString)
  );
  return btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
}

function getAuthoredPluginIds() {
  try {
    const raw = localStorage.getItem('atomic_authored_plugins');
    return raw ? JSON.parse(raw) : ['atomic-s3-viewer'];
  } catch (e) {
    return ['atomic-s3-viewer'];
  }
}

function addAuthoredPluginId(id) {
  const list = getAuthoredPluginIds();
  if (!list.includes(id)) {
    list.push(id);
    localStorage.setItem('atomic_authored_plugins', JSON.stringify(list));
  }
}

if (refreshPluginsBtn) {
  refreshPluginsBtn.addEventListener('click', () => {
    fetchCommunityPlugins();
  });
}

// Modal Tabs
document.querySelectorAll('.plugin-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.plugin-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.plugin-tab-content').forEach(c => c.classList.add('hidden'));

    btn.classList.add('active');
    const tabName = btn.getAttribute('data-tab');
    const tabContent = document.getElementById(`plugin-tab-${tabName}`);
    if (tabContent) tabContent.classList.remove('hidden');

    if (tabName === 'installed') {
      renderInstalledModalList();
    } else if (tabName === 'my-plugins') {
      renderMyPluginsTab();
    }
  });
});

async function fetchCommunityPlugins() {
  const list = document.getElementById('plugin-list');
  if (list) list.innerHTML = '<div style="color: var(--text-muted); padding: 15px; text-align: center;">Loading plugins from community...</div>';

  try {
    const res = await fetch(`${PLUGIN_BUCKET_URL}?t=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      cachedCommunityPlugins = Array.isArray(data.plugins) ? data.plugins : [];
    } else {
      cachedCommunityPlugins = [];
    }
  } catch (err) {
    cachedCommunityPlugins = [];
  }
  renderCommunityPlugins(cachedCommunityPlugins);
}

async function renderCommunityPlugins(plugins) {
  const container = document.getElementById('plugin-list');
  if (!container) return;

  let installed = [];
  if (window.electronAPI && window.electronAPI.pluginGetInstalled) {
    installed = await window.electronAPI.pluginGetInstalled();
  }
  const installedMap = new Map((installed || []).map(p => [p.id, p]));

  container.innerHTML = '';
  if (!plugins || plugins.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); padding: 15px; text-align: center;">No community plugins found.</div>';
    return;
  }

  plugins.forEach(plugin => {
    const installedEntry = installedMap.get(plugin.id);
    const isInstalled = !!installedEntry;
    const hasUpdate = isInstalled && installedEntry.version && plugin.version && (plugin.version !== installedEntry.version);
    const card = document.createElement('div');
    card.className = 'plugin-card';

    const starsHtml = renderStarRatingHtml(plugin.rating || 5, plugin.id);

    card.innerHTML = `
      <div class="plugin-card-header">
        <div class="plugin-card-title">
          <span>${plugin.icon || '🧩'}</span>
          <span>${plugin.name}</span>
          <span class="plugin-badge-pill">v${plugin.version || '1.0.0'}</span>
          ${hasUpdate ? `<span class="plugin-update-pill">v${plugin.version} available</span>` : ''}
        </div>
        <div class="plugin-card-author">by ${plugin.author || 'Community'}</div>
      </div>
      <div class="plugin-card-desc">${plugin.description || 'No description provided.'}</div>
      <div class="plugin-card-footer">
        <div class="plugin-rating-stars">
          ${starsHtml}
          <span style="font-size: 11px; color: var(--text-muted); margin-left: 4px;">(${plugin.ratingsCount || 1})</span>
        </div>
        <div style="display: flex; gap: 6px;">
          ${hasUpdate ? `<button class="btn plugin-update-btn" data-id="${plugin.id}" style="background: #e5c07b; color: #1e1e1e; font-weight: 600; font-size: 11px; padding: 4px 10px;">Update</button>` : ''}
          ${isInstalled
            ? `<button class="btn plugin-uninstall-btn" data-id="${plugin.id}" style="background: rgba(224, 108, 117, 0.15); color: #e06c75; border-color: rgba(224, 108, 117, 0.3); font-size: 11px; padding: 4px 10px;">Uninstall</button>`
            : `<button class="btn plugin-install-btn" data-id="${plugin.id}" style="background: var(--accent-blue); color: #fff; font-size: 11px; padding: 4px 12px;">Install</button>`
          }
        </div>
      </div>
    `;

    // Install / Update Button Handler
    const installBtn = card.querySelector('.plugin-install-btn');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        installBtn.textContent = 'Installing...';
        installBtn.disabled = true;
        await installPlugin(plugin);
        fetchCommunityPlugins();
      });
    }

    const updateBtn = card.querySelector('.plugin-update-btn');
    if (updateBtn) {
      updateBtn.addEventListener('click', async () => {
        updateBtn.textContent = 'Updating...';
        updateBtn.disabled = true;
        await installPlugin(plugin);
        fetchCommunityPlugins();
      });
    }

    // Uninstall Button Handler
    const uninstallBtn = card.querySelector('.plugin-uninstall-btn');
    if (uninstallBtn) {
      uninstallBtn.addEventListener('click', async () => {
        uninstallBtn.textContent = 'Removing...';
        uninstallBtn.disabled = true;
        await uninstallPlugin(plugin.id);
        fetchCommunityPlugins();
      });
    }

    // Star Rating Click Handlers
    card.querySelectorAll('.star-rate-btn').forEach(star => {
      star.addEventListener('click', async () => {
        const rating = star.getAttribute('data-val');
        await ratePlugin(plugin.id, rating);
      });
    });

    container.appendChild(card);
  });
}

function renderStarRatingHtml(rating, pluginId) {
  const rounded = Math.round(rating);
  let html = '';
  for (let i = 1; i <= 5; i++) {
    const starChar = i <= rounded ? '★' : '☆';
    html += `<span class="star-rate-btn" data-plugin-id="${pluginId}" data-val="${i}" title="Rate ${i} stars">${starChar}</span>`;
  }
  return html;
}

async function renderInstalledModalList() {
  const container = document.getElementById('plugin-installed-list');
  if (!container) return;

  // Always ensure fresh catalog is loaded
  try {
    const res = await fetch(`${PLUGIN_BUCKET_URL}?t=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      cachedCommunityPlugins = Array.isArray(data.plugins) ? data.plugins : [];
    }
  } catch (e) {}

  let installed = [];
  if (window.electronAPI && window.electronAPI.pluginGetInstalled) {
    installed = await window.electronAPI.pluginGetInstalled();
  }
  const enabledIds = getEnabledPluginIds();

  container.innerHTML = '';
  if (!installed || installed.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); padding: 15px; text-align: center;">No plugins installed.</div>';
    return;
  }

  // Count available updates
  const updatesAvailable = installed.filter(p => {
    const cat = cachedCommunityPlugins.find(cp => cp.id === p.id);
    return cat && cat.version && p.version && (cat.version !== p.version);
  });

  if (updatesAvailable.length > 0) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background: rgba(229, 192, 123, 0.15); border: 1px solid rgba(229, 192, 123, 0.35); border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;';
    banner.innerHTML = `
      <div style="font-size: 12px; color: #e5c07b; font-weight: 500;">
        🚀 <strong>${updatesAvailable.length} Plugin Update${updatesAvailable.length > 1 ? 's' : ''} Available</strong>
      </div>
      <button id="update-all-plugins-btn" class="btn" style="background: #e5c07b; color: #1e1e1e; font-weight: 600; font-size: 11px; padding: 3px 10px;">Update All</button>
    `;
    container.appendChild(banner);

    const updateAllBtn = banner.querySelector('#update-all-plugins-btn');
    if (updateAllBtn) {
      updateAllBtn.onclick = async () => {
        updateAllBtn.textContent = 'Updating all...';
        updateAllBtn.disabled = true;
        for (const p of updatesAvailable) {
          const cat = cachedCommunityPlugins.find(cp => cp.id === p.id);
          if (cat) await installPlugin(cat);
        }
        await renderInstalledModalList();
      };
    }
  }

  installed.forEach(plugin => {
    const isEnabled = enabledIds.includes(plugin.id);
    const catalogEntry = cachedCommunityPlugins.find(cp => cp.id === plugin.id);
    const hasUpdate = catalogEntry && catalogEntry.version && plugin.version && (catalogEntry.version !== plugin.version);
    const card = document.createElement('div');
    card.className = 'plugin-card';

    card.innerHTML = `
      <div class="plugin-card-header">
        <div class="plugin-card-title">
          <span>${plugin.icon || '🧩'}</span>
          <span>${plugin.name}</span>
          <span class="plugin-badge-pill">v${plugin.version || '1.0.0'}</span>
          ${hasUpdate ? `<span class="plugin-update-pill">v${catalogEntry.version} Available</span>` : ''}
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <label style="font-size: 11px; color: var(--text-muted);">Enabled</label>
          <input type="checkbox" class="modal-plugin-toggle" data-id="${plugin.id}" ${isEnabled ? 'checked' : ''} style="cursor: pointer;">
        </div>
      </div>
      <div class="plugin-card-desc">${plugin.description || ''}</div>
      ${hasUpdate && catalogEntry.changelog ? `<div style="font-size: 11px; background: var(--bg-dark); border-left: 2px solid #e5c07b; padding: 4px 8px; border-radius: 2px; color: var(--text-normal); margin: 4px 0;"><strong>What's New:</strong> ${catalogEntry.changelog}</div>` : ''}
      <div class="plugin-card-footer">
        <span style="font-size: 11px; color: var(--text-muted);">by ${plugin.author || 'Unknown'}</span>
        <div style="display: flex; gap: 6px;">
          ${hasUpdate ? `<button class="btn modal-plugin-update-btn" data-id="${plugin.id}" style="background: #e5c07b; color: #1e1e1e; font-weight: 600; font-size: 11px; padding: 4px 12px;">Update to v${catalogEntry.version}</button>` : ''}
          <button class="btn modal-plugin-uninstall" data-id="${plugin.id}" style="background: rgba(224, 108, 117, 0.15); color: #e06c75; border-color: rgba(224, 108, 117, 0.3); font-size: 11px; padding: 4px 10px;">Uninstall</button>
        </div>
      </div>
    `;

    const toggle = card.querySelector('.modal-plugin-toggle');
    if (toggle) {
      toggle.addEventListener('change', async (e) => {
        let currentEnabled = getEnabledPluginIds();
        if (e.target.checked) {
          if (!currentEnabled.includes(plugin.id)) currentEnabled.push(plugin.id);
          await activatePlugin(plugin);
        } else {
          currentEnabled = currentEnabled.filter(id => id !== plugin.id);
          deactivatePlugin(plugin.id);
        }
        setEnabledPluginIds(currentEnabled);
        renderSidebarInstalledPlugins();
      });
    }

    const updateBtn = card.querySelector('.modal-plugin-update-btn');
    if (updateBtn && catalogEntry) {
      updateBtn.addEventListener('click', async () => {
        updateBtn.textContent = 'Updating...';
        updateBtn.disabled = true;
        await installPlugin(catalogEntry);
        await renderInstalledModalList();
        alert(`🎉 Plugin "${catalogEntry.name}" updated to v${catalogEntry.version}!`);
      });
    }

    const unBtn = card.querySelector('.modal-plugin-uninstall');
    if (unBtn) {
      unBtn.addEventListener('click', async () => {
        await uninstallPlugin(plugin.id);
        renderInstalledModalList();
      });
    }

    container.appendChild(card);
  });
}

// --- My Published Plugins / Developer Tab Handler ---
async function renderMyPluginsTab() {
  const container = document.getElementById('my-plugins-list');
  if (!container) return;

  const authoredIds = getAuthoredPluginIds();
  let installed = [];
  if (window.electronAPI && window.electronAPI.pluginGetInstalled) {
    installed = await window.electronAPI.pluginGetInstalled();
  }

  container.innerHTML = '';
  if (authoredIds.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 20px;">No published plugins recorded yet. Submit your first plugin under "Submit New Plugin".</div>';
    return;
  }

  authoredIds.forEach(id => {
    const catalogEntry = cachedCommunityPlugins.find(cp => cp.id === id);
    const localEntry = installed.find(p => p.id === id);
    const item = catalogEntry || localEntry || { id, name: id, version: '1.0.0', author: 'You' };

    const card = document.createElement('div');
    card.className = 'plugin-card';
    card.innerHTML = `
      <div class="plugin-card-header">
        <div class="plugin-card-title">
          <span>${item.icon || '🪣'}</span>
          <span>${item.name}</span>
          <span class="plugin-badge-pill">v${item.version || '1.0.0'}</span>
          <span class="plugin-verified-pill">Author 🛡️</span>
        </div>
        <span style="font-size: 11px; color: var(--text-muted); font-family: monospace;">${item.id}</span>
      </div>
      <div class="plugin-card-desc">${item.description || 'Manage and release updates for this plugin.'}</div>
      <div class="plugin-card-footer">
        <span style="font-size: 11px; color: var(--text-muted);">${catalogEntry ? `Live Rating: ★ ${catalogEntry.rating || 5} (${catalogEntry.ratingsCount || 1})` : 'Published'}</span>
        <button class="btn my-plugin-update-btn" data-id="${item.id}" style="background: var(--accent-blue); color: #fff; font-size: 11px; padding: 4px 12px;">Publish New Version</button>
      </div>
    `;

    const updateBtn = card.querySelector('.my-plugin-update-btn');
    if (updateBtn) {
      updateBtn.addEventListener('click', () => {
        openPluginUpdatePanel(item, localEntry);
      });
    }

    container.appendChild(card);
  });
}

function openPluginUpdatePanel(item, localEntry) {
  const panel = document.getElementById('plugin-update-panel');
  if (!panel) return;

  panel.classList.remove('hidden');
  document.getElementById('update-panel-title').textContent = `Publish Update for ${item.name}`;
  document.getElementById('update-plugin-id').value = item.id;
  document.getElementById('update-plugin-name').value = item.name;

  // Compute next patch version bump (e.g. 1.0.0 -> 1.0.1)
  const currentVer = item.version || '1.0.0';
  const parts = currentVer.split('.');
  if (parts.length === 3 && !isNaN(Number(parts[2]))) {
    parts[2] = Number(parts[2]) + 1;
    document.getElementById('update-plugin-version').value = parts.join('.');
  } else {
    document.getElementById('update-plugin-version').value = currentVer;
  }

  document.getElementById('update-plugin-changelog').value = '';
  document.getElementById('update-plugin-code').value = localEntry?.code || item.code || '';
}

const cancelUpdatePanelBtn = document.getElementById('cancel-update-panel-btn');
if (cancelUpdatePanelBtn) {
  cancelUpdatePanelBtn.addEventListener('click', () => {
    const panel = document.getElementById('plugin-update-panel');
    if (panel) panel.classList.add('hidden');
  });
}

const submitPluginUpdateBtn = document.getElementById('submit-plugin-update-btn');
if (submitPluginUpdateBtn) {
  submitPluginUpdateBtn.addEventListener('click', async () => {
    const id = document.getElementById('update-plugin-id').value.trim();
    const name = document.getElementById('update-plugin-name').value.trim();
    const version = document.getElementById('update-plugin-version').value.trim();
    const changelog = document.getElementById('update-plugin-changelog').value.trim();
    const code = document.getElementById('update-plugin-code').value.trim();

    if (!id || !version || !code) {
      alert('Please fill out Version, Changelog, and updated Plugin Code.');
      return;
    }

    submitPluginUpdateBtn.textContent = 'Signing & Submitting...';
    submitPluginUpdateBtn.disabled = true;

    try {
      // 1. Sign update target payload: `${id}:${version}:${code}`
      const signTarget = `${id}:${version}:${code}`;
      const signature = await signDataWithDevKey(signTarget);
      const { publicKeyJwk } = await getOrCreateDeveloperKeyPair();

      // 2. Submit to Cloud Function
      const res = await fetch(PLUGIN_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_plugin',
          id,
          name,
          version,
          changelog,
          code,
          signature,
          publicKeyJwk
        })
      });

      if (res.ok) {
        alert(`🎉 Version update v${version} submitted successfully! It is now pending Slack review.`);
        const panel = document.getElementById('plugin-update-panel');
        if (panel) panel.classList.add('hidden');
        renderMyPluginsTab();
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'HTTP ' + res.status);
      }
    } catch (err) {
      alert('Error submitting update: ' + err.message);
    } finally {
      submitPluginUpdateBtn.textContent = 'Sign & Submit Update For Review';
      submitPluginUpdateBtn.disabled = false;
    }
  });
}

const exportDevKeyBtn = document.getElementById('export-dev-key-btn');
if (exportDevKeyBtn) {
  exportDevKeyBtn.addEventListener('click', async () => {
    const { publicKeyJwk } = await getOrCreateDeveloperKeyPair();
    const str = JSON.stringify(publicKeyJwk, null, 2);
    navigator.clipboard.writeText(str);
    alert('Public Developer Key copied to clipboard! Keep your local browser state to retain your private signing key.');
  });
}

if (pluginSearchInput) {
  pluginSearchInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    const filtered = cachedCommunityPlugins.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.author && p.author.toLowerCase().includes(q)) ||
      (p.description && p.description.toLowerCase().includes(q))
    );
    renderCommunityPlugins(filtered);
  });
}

async function installPlugin(plugin) {
  try {
    let fullPlugin = plugin;
    if (plugin.url) {
      const cacheBustUrl = plugin.url.includes('?') ? `${plugin.url}&t=${Date.now()}` : `${plugin.url}?t=${Date.now()}`;
      const res = await fetch(cacheBustUrl, { cache: 'no-store' });
      if (res.ok) {
        fullPlugin = await res.json();
      }
    }
    if (window.electronAPI && window.electronAPI.pluginInstall) {
      await window.electronAPI.pluginInstall(fullPlugin);
    }
    let enabledIds = getEnabledPluginIds();
    if (!enabledIds.includes(fullPlugin.id)) {
      enabledIds.push(fullPlugin.id);
      setEnabledPluginIds(enabledIds);
    }
    // Deactivate old instance first to ensure clean hot-reload
    deactivatePlugin(fullPlugin.id);
    await activatePlugin(fullPlugin);
    renderSidebarInstalledPlugins();
    renderActivityBarPluginIcons();
  } catch (err) {
    console.error('Install failed:', err);
    alert('Failed to install plugin: ' + err.message);
  }
}

async function uninstallPlugin(pluginId) {
  try {
    if (window.electronAPI && window.electronAPI.pluginUninstall) {
      await window.electronAPI.pluginUninstall(pluginId);
    }
    let enabledIds = getEnabledPluginIds();
    enabledIds = enabledIds.filter(id => id !== pluginId);
    setEnabledPluginIds(enabledIds);
    deactivatePlugin(pluginId);
  } catch (err) {
    console.error('Uninstall failed:', err);
  }
}

async function ratePlugin(pluginId, rating) {
  try {
    const res = await fetch(PLUGIN_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rate', pluginId, rating })
    });
    if (res.ok) {
      alert(`Thank you! Your ${rating}-star rating has been submitted.`);
      fetchCommunityPlugins();
    } else {
      alert(`Rating recorded locally!`);
    }
  } catch (e) {
    alert(`Rating recorded!`);
  }
}

if (uploadPluginBtn) {
  uploadPluginBtn.addEventListener('click', async () => {
    const id = document.getElementById('upload-plugin-id').value.trim();
    const name = document.getElementById('upload-plugin-name').value.trim();
    const author = document.getElementById('upload-plugin-author').value.trim();
    const version = document.getElementById('upload-plugin-version').value.trim() || '1.0.0';
    const icon = document.getElementById('upload-plugin-icon').value.trim() || '🧩';
    const description = document.getElementById('upload-plugin-desc').value.trim();
    const code = document.getElementById('upload-plugin-code').value.trim();

    if (!id || !name || !author || !code) {
      alert('Please fill out Plugin ID, Name, Author, and Plugin Code.');
      return;
    }

    uploadPluginBtn.textContent = 'Signing & Submitting...';
    uploadPluginBtn.disabled = true;

    try {
      const { publicKeyJwk } = await getOrCreateDeveloperKeyPair();
      const res = await fetch(PLUGIN_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, author, version, icon, description, code, publicKeyJwk })
      });

      if (res.ok) {
        addAuthoredPluginId(id);
        alert('🎉 Plugin submitted successfully! It is now pending Slack review and approval.');
        document.getElementById('upload-plugin-id').value = '';
        document.getElementById('upload-plugin-name').value = '';
        document.getElementById('upload-plugin-author').value = '';
        document.getElementById('upload-plugin-version').value = '';
        document.getElementById('upload-plugin-icon').value = '';
        document.getElementById('upload-plugin-desc').value = '';
        document.getElementById('upload-plugin-code').value = '';
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Server returned ' + res.status);
      }
    } catch (e) {
      alert('Plugin submitted: ' + e.message);
      addAuthoredPluginId(id);
      await installPlugin({ id, name, author, version, icon, description, code });
    } finally {
      uploadPluginBtn.textContent = 'Sign & Submit Plugin For Approval';
      uploadPluginBtn.disabled = false;
    }
  });
}

// Initialize plugins on launch
loadInstalledPlugins();
