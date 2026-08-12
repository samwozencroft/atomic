<p align="center">
  <img src="assets/icon.svg" width="128" height="128" alt="Atomic Logo" />
</p>

# Atomic

A lightweight, modern text editor built on Electron 30 and Node 20. Atomic utilizes the Monaco Editor engine (the same technology powering VS Code) to deliver an incredibly fast and robust coding experience without the heavy legacy baggage.

## Features
- ** Lightning Fast**: Powered by the Monaco Editor engine (the same technology inside VS Code) for robust, high-performance code editing.
- ** Integrated TTY Terminal**: Fully interactive native terminal panel at the bottom supporting shell selection, tab autocompletion, TTY curses editors (`nano`, `vim`), and automated styling.
- ** Workspace Search**: Global workspace search to find files and query text within files instantly.
- ** Unified Git Panel**: GitHub Desktop-style Changes list with checkbox commit selections, interactive Monaco side-by-side Diff Viewer, branch creation/checkout/merges, blame, history logs, and remote push/pull counters.
- ** Theme Customization**: Pre-built themes (One Dark, Light, etc.) with custom live editing and style sheet overrides.
- ** Auto-Updating**: Seamlessly self-updates via GitHub Release automation.

---

## Showcase

### Advanced Git Panel & Monaco Diff Viewer
Atomic features a comprehensive Git Dashboard built with checkbox selections for selective commits, visual logs, and a full side-by-side diff view.
<p align="center">
  <img width="843" alt="Git Panel and Diff Viewer" src="https://github.com/user-attachments/assets/bc515da7-3586-4724-af62-6523e5c4e8a4" />
</p>

### Integrated Native TTY Terminal
An interactive terminal panel at the bottom, dynamically tracking workspace directories with shell customization (PowerShell/zsh/bash).
<p align="center">
  <img width="776" alt="Integrated Terminal" src="https://github.com/user-attachments/assets/7487bbb0-beab-4a88-bfb8-6faff92af3f4" />
</p>

### File Trees & Orchestration
Recursive file tree system with context menus, directory creation, search filters, and layout orchestration.
<p align="center">
  <img width="246" alt="File Trees & Workspace Orchestration" src="https://github.com/user-attachments/assets/d523955f-2a2e-45ee-ab93-3f473b79936f" />
</p>

### Live Theme Customization & Explorer
Instantly preview and customize editor themes or browse the marketplace without restarting.
<p align="center">
  <img width="490" alt="Theme Customization and Explorer" src="https://github.com/user-attachments/assets/ab9d21da-4981-4349-8002-4068edcf555c" />
</p>

---

## 🧩 Community Plugin Marketplace & Ecosystem

Atomic features a secure, community-driven plugin ecosystem allowing developers to build custom sidebar views, multi-cloud tools, editor extensions, and UI integrations.

### 1. Authoring a Plugin

A plugin consists of a manifest (`plugin.json`) and an entry script (`plugin.js`):

**`plugin.json`**:
```json
{
  "id": "my-cloud-explorer",
  "name": "My Cloud Explorer",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "Browse and manage cloud resources directly from Atomic.",
  "icon": "☁️",
  "entry": "plugin.js"
}
```

**`plugin.js`**:
```javascript
exports.onActivate = function(context) {
  // Add a dedicated sidebar view with interactive DOM rendering
  context.addSidebarView({
    title: 'Cloud Explorer',
    render: function(container) {
      container.innerHTML = `
        <div style="padding: 10px;">
          <h3>My Cloud Explorer</h3>
          <button id="load-btn" class="btn">Load Resources</button>
        </div>
      `;
      container.querySelector('#load-btn').onclick = () => {
        const editor = context.getEditor();
        editor.setValue('// Loaded from plugin');
      };
    }
  });
};

exports.onDeactivate = function() {
  // Clean up any listeners or background timers
};
```

### 1.1 Host APIs

Plugins receive a namespaced `context` API for integrating with the editor and workbench:

```javascript
exports.onActivate = function(context) {
  const command = context.commands.register({
    id: 'format',
    title: 'Format Current File',
    keybinding: 'CmdOrCtrl+Shift+F',
    handler: () => context.notify('Formatting requested')
  });

  context.statusBar.addItem({ text: 'Cloud: ready', alignment: 'right' });
  context.menus.addContextMenuItem({
    id: 'inspect',
    label: 'Inspect with Cloud Tool',
    onClick: ({ path }) => context.openFile(path, path.split('/').pop())
  });

  context.editor.addDecorations({
    decorations: [{
      range: new monaco.Range(1, 1, 1, 1),
      options: { isWholeLine: true, className: 'plugin-highlight' }
    }]
  });

  context.settings.set('region', 'eu-west-1');
  context.secrets.set('apiToken', 'token-value');

  context.tabs.add({
    title: 'Cloud Resources',
    render: (container) => { container.textContent = 'Resources'; }
  });
};
```

The available API groups are `commands`, `statusBar`, `menus`, `editor`, `notifications`, `terminal`, `files`, `settings`, `secrets`, and `tabs`. The shorter aliases `addCommand`, `addStatusBarItem`, `addContextMenuItem`, `addEditorDecorations`, `createTerminal`, `registerFileProvider`, `addTab`, `createWebview`, and `notify` are also available. Registrations return disposable handles and are cleaned up when a plugin is disabled. Secrets are encrypted through the operating system credential store; they are not written to the plugin manifest or renderer storage.

File providers can register virtual URI schemes such as `cloud://bucket/file.txt` with `context.files.registerProvider('cloud', { read, write })`. `context.tabs.createWebview({ title, url })` supports remote HTTP(S) pages in a sandboxed custom tab.

## Language Server Protocol

Atomic includes an LSP client for diagnostics, autocomplete, hover documentation, go-to-definition, and references. Language servers run as separate stdio processes and are started only when a matching file is opened. If a server is not installed, the normal Monaco editor remains available and the status bar reports that the server is unavailable.

The built-in mappings are:

| Language | Server command |
| --- | --- |
| JavaScript / TypeScript | `typescript-language-server --stdio` |
| Python | `pyright-langserver --stdio` |
| Go | `gopls serve` |
| Rust | `rust-analyzer` |
| Bash | `bash-language-server start` |
| YAML | `yaml-language-server --stdio` |
| JSON | `vscode-json-language-server --stdio` |

Install the server you need globally, or install it in the opened workspace. Atomic adds `<workspace>/node_modules/.bin` to the server search path:

```sh
npm install --save-dev typescript typescript-language-server
npm install --save-dev bash-language-server yaml-language-server vscode-langservers-extracted
pip install pyright
go install golang.org/x/tools/gopls@latest
rustup component add rust-analyzer
```

The LSP transport is implemented in Electron’s main process, with Monaco providers registered in the renderer. Documents use full-text synchronization for compatibility across servers, and diagnostics are rendered as native Monaco markers.

### 2. Publishing a Plugin
1. Open Atomic and navigate to **Preferences** (⚙️) &rarr; **Community Plugins**.
2. Switch to the **Submit New Plugin** tab.
3. Fill in your plugin ID, name, version, icon, and paste your JavaScript code.
4. Click **Sign & Submit Plugin For Approval**.
5. Atomic will automatically generate an **ECDSA P-256 Cryptographic Keypair** in your client and sign your submission to prove author identity.
6. The submission is sent to the Slack moderation channel for verification. Once approved, it is published globally to the community catalog on Google Cloud Storage.

### 3. Maintaining & Updating Plugins
1. Open **Preferences** &rarr; **Community Plugins** &rarr; **My Plugins**.
2. Your published plugins will be displayed with a **Verified Author 🛡️** badge and live community ratings.
3. Click **Publish New Version**:
   - The patch version is automatically incremented (e.g. `1.0.0` &rarr; `1.0.1`).
   - Enter your release notes in the **Changelog** field.
   - Paste your updated code.
4. Click **Sign & Submit Update For Review**. The backend cryptographically verifies your signature against your registered author key.
5. Once approved in Slack, installed users will automatically receive an **"Update Available"** banner and a one-click in-app update button.

### 4. Managing & Deleting Plugins
- **Enable / Disable**: In the **Installed** tab, use the toggle checkbox to enable or disable plugins on the fly.
- **Uninstall Locally**: Click **Uninstall** on any plugin card in the **Installed** tab to remove it from your machine.
- **Unpublish from Community**: To request deletion or deprecation of a published plugin from the public catalog, contact the maintainers in the Slack review channel or submit an issue on GitHub.

---

## ⚠️ macOS Troubleshooting: "App is damaged" Error

Because Atomic is currently in an unsigned preview state, downloading the `.dmg` or `.zip` release via a web browser on a Mac will trigger Apple's Gatekeeper security.

macOS will flag the file as coming from an unidentified developer, attach a hidden quarantine tag, and display a warning saying **"Atomic.app is damaged and can't be opened. You should move it to the Bin."**

**The app is not actually damaged.** To bypass this warning and strip the quarantine tag, open your Terminal and run the following command (adjusting the path if you moved the app out of your Downloads folder):

```bash
xattr -cr ~/Downloads/Atomic.app
```
*(If you installed it to your Applications folder, run `xattr -cr /Applications/Atomic.app` instead).*

After running the command, simply double-click `Atomic.app` to launch it safely!

---

## 🛡️ Windows Troubleshooting: SmartScreen Warning

When downloading and installing the `.exe` setup on Windows, Windows Defender SmartScreen will display a blue and white warning box stating **"Windows protected your PC"** because the application binary is currently unsigned.

**To run the app:**
1. Click **"More info"** on the blue SmartScreen popup window.
2. Click the **"Run anyway"** button that appears at the bottom right.

---

## Local Development

To run the application locally from source:

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the application:
   ```bash
   npm start
   ```

---

## Credits

- **Logo & Icon Design**: Created by [@elisehindes](https://github.com/elisehindes).

---

## Support the Developer

If you find Atomic useful and want to support its ongoing development, consider buying me a coffee! It helps keep the lights on and the updates flowing.

<a href="https://www.buymeacoffee.com/samwozencroft" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>
