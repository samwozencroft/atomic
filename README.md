<p align="center">
  <img src="assets/icon.svg" width="128" height="128" alt="Atomic Logo" />
</p>

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
