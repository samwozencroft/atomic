# Atomic

A lightweight, modern text editor built on Electron 30 and Node 20. Atomic utilizes the Monaco Editor engine (the same technology powering VS Code) to deliver an incredibly fast and robust coding experience without the heavy legacy baggage.

## Features
- **Lightning Fast**: Built on modern web technologies.
- **Auto-Updating**: Seamlessly patches itself using GitHub Releases.
- **One Dark Theme**: Beautiful, native-feeling UI with recursive file trees and custom context menus.

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
