let editor;
let editorRight;
let activeEditorPane = 'left';
let currentFilePath = null;
let currentFilePathRight = null;
let openTabsLeft = [];
let openTabsRight = [];
let currentWorkspace = null;
let expandedDirectories = new Set();

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

    const content = await window.electronAPI.readFile(filePath);
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
  gitModalBody.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px 0;">Loading repository status...</div>';

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

  // Get branches
  const branchRes = await window.electronAPI.gitGetBranches(currentWorkspace);
  const branches = (branchRes && branchRes.success && branchRes.branches) ? branchRes.branches : [{ name: status.branch, current: true }];

  let branchOptions = branches.map(b => `<option value="${b.name}" ${b.current ? 'selected' : ''}>${b.name}</option>`).join('');
  branchOptions += '<option value="__create_new__">+ Create New Branch...</option>';
  branchOptions += '<option value="__merge_branch__">⚡ Merge Branch into ' + status.branch + '...</option>';

  let html = `
    <div class="setting-item" style="margin-bottom: 15px;">
      <span style="color: var(--text-muted);">Current Branch</span>
      <select id="git-branch-select" style="background: var(--bg-darkest); color: var(--text-normal); border: 1px solid var(--border-color); border-radius: 4px; padding: 4px 8px; font-size: 12px; cursor: pointer;">
        ${branchOptions}
      </select>
    </div>
    <div class="setting-item" style="margin-bottom: 15px;">
      <span style="color: var(--text-muted);">Changed Files</span>
      <span style="font-weight: 500; color: var(--text-normal);">${status.stats.total}</span>
    </div>
  `;

  if (status.files.length === 0) {
    html += '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px 0; border-top: 1px solid var(--border-color);">Working tree clean. No changes detected.</div>';
  } else {
    html += '<div style="border-top: 1px solid var(--border-color); padding-top: 15px;">';
    html += '<div style="font-size: 12px; font-weight: 500; color: var(--text-muted); margin-bottom: 10px;">Changed Files</div>';
    html += '<div class="git-file-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto;">';

    status.files.forEach(file => {
      let badgeLetter = 'M';
      if (file.status === 'added') badgeLetter = 'A';
      else if (file.status === 'deleted') badgeLetter = 'D';
      else if (file.status === 'untracked') badgeLetter = 'U';

      html += `
        <div class="git-file-item" data-path="${file.fullPath}" data-rel="${file.path}">
          <div class="git-file-info">
            <span class="git-file-badge git-badge-${badgeLetter}">${badgeLetter}</span>
            <span style="font-size: 13px; color: var(--text-normal); font-family: monospace;">${file.path}</span>
          </div>
        </div>
      `;
    });

    html += '</div></div>';

    // Commit section
    html += `
      <div style="border-top: 1px solid var(--border-color); margin-top: 15px; padding-top: 15px;">
        <div style="font-size: 12px; font-weight: 500; color: var(--text-muted); margin-bottom: 8px;">Commit Changes</div>
        <input type="text" id="git-commit-input" placeholder="Message (e.g. Update features)..." style="width: 100%; padding: 8px; margin-bottom: 10px; background: var(--bg-darkest); color: var(--text-normal); border: 1px solid var(--border-color); border-radius: 4px; box-sizing: border-box; font-size: 12px;">
        <button id="git-commit-btn" class="btn" style="background: var(--accent-blue); color: #fff; border: none; width: 100%; padding: 8px; font-weight: 500; cursor: pointer;">Commit All Changes</button>
      </div>
    `;
  }

  // Sync & Stash Section
  html += `
    <div style="border-top: 1px solid var(--border-color); margin-top: 15px; padding-top: 15px;">
      <div style="font-size: 12px; font-weight: 500; color: var(--text-muted); margin-bottom: 8px;">Remote Sync & Stash</div>
      <div style="display: flex; gap: 8px; margin-bottom: 8px;">
        <button id="git-fetch-btn" class="btn" style="flex: 1; padding: 6px; font-size: 12px; background: var(--bg-darkest); border: 1px solid var(--border-color); color: var(--text-normal); cursor: pointer;">Fetch</button>
        <button id="git-pull-btn" class="btn" style="flex: 1; padding: 6px; font-size: 12px; background: var(--bg-darkest); border: 1px solid var(--border-color); color: var(--text-normal); cursor: pointer;">Pull</button>
        <button id="git-push-btn" class="btn" style="flex: 1; padding: 6px; font-size: 12px; background: var(--accent-blue); border: none; color: #fff; cursor: pointer; font-weight: 500;">Push</button>
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="git-stash-btn" class="btn" style="flex: 1; padding: 6px; font-size: 12px; background: var(--bg-darkest); border: 1px solid var(--border-color); color: var(--text-normal); cursor: pointer;">Stash Changes</button>
        <button id="git-pop-btn" class="btn" style="flex: 1; padding: 6px; font-size: 12px; background: var(--bg-darkest); border: 1px solid var(--border-color); color: var(--text-normal); cursor: pointer;">Pop Stash</button>
      </div>
    </div>
  `;

  html += `
    <div style="margin-top: 15px; border-top: 1px solid var(--border-color); padding-top: 15px; display: flex; justify-content: center;">
      <button id="refresh-git-btn" class="btn" style="background: transparent; color: var(--text-muted); border: 1px solid var(--border-color); width: 100%;">Refresh Status</button>
    </div>
  `;

  gitModalBody.innerHTML = html;

  const branchSelect = gitModalBody.querySelector('#git-branch-select');
  if (branchSelect) {
    branchSelect.addEventListener('change', async (e) => {
      const selected = e.target.value;
      if (selected === '__create_new__') {
        const newName = prompt('Enter new branch name:');
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
        const targetMerge = prompt(`Branches available to merge into ${status.branch}:\n\n${otherBranches.join('\n')}\n\nEnter branch name to merge:`);
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

  const commitBtn = gitModalBody.querySelector('#git-commit-btn');
  const commitInput = gitModalBody.querySelector('#git-commit-input');
  if (commitBtn && commitInput) {
    commitBtn.addEventListener('click', async () => {
      const msg = commitInput.value.trim();
      if (!msg) {
        alert('Please enter a commit message.');
        return;
      }
      commitBtn.disabled = true;
      commitBtn.textContent = 'Committing...';
      const res = await window.electronAPI.gitCommit({ dirPath: currentWorkspace, message: msg });
      if (res.success) {
        await updateGitStatus();
        await renderGitModalContent();
      } else {
        alert(`Commit failed: ${res.error}`);
        commitBtn.disabled = false;
        commitBtn.textContent = 'Commit All Changes';
      }
    });
  }

  // Attach Sync and Stash listeners
  const fetchBtn = gitModalBody.querySelector('#git-fetch-btn');
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

  const pullBtn = gitModalBody.querySelector('#git-pull-btn');
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

  const pushBtn = gitModalBody.querySelector('#git-push-btn');
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

  const stashBtn = gitModalBody.querySelector('#git-stash-btn');
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

  const popBtn = gitModalBody.querySelector('#git-pop-btn');
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

  const refreshBtn = gitModalBody.querySelector('#refresh-git-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await renderGitModalContent();
      await updateGitStatus();
    });
  }

  const items = gitModalBody.querySelectorAll('.git-file-item');
  items.forEach(item => {
    item.addEventListener('click', () => {
      const fullPath = item.getAttribute('data-path');
      const relPath = item.getAttribute('data-rel');
      if (fullPath) {
        openFile(fullPath, relPath.split('/').pop());
        if (gitModal) gitModal.classList.add('hidden');
      }
    });
  });
}

if (gitBtn) {
  gitBtn.addEventListener('click', async () => {
    if (gitModal) gitModal.classList.remove('hidden');
    await renderGitModalContent();
  });
}

if (closeGitModalBtn) {
  closeGitModalBtn.addEventListener('click', () => {
    if (gitModal) gitModal.classList.add('hidden');
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
