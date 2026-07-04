# Install

Keep it small. Requirements:

```txt
macOS
Node.js >= 20
Xcode Command Line Tools, for /usr/bin/swiftc
```

This project currently has no npm dependencies, so there is no install step before validation.

```bash
npm run doctor
npm run check
npm run smoke
npm run demo
```

Copy the MCP config printed by `npm run doctor` into your trusted MCP host. Chrome is optional for Chrome-specific tools and is not required by the default validation path.

Grant local macOS permissions to the launcher app:

```txt
Accessibility
Screen Recording
Automation when macOS prompts
```

`npm run demo` is a safe real-UI sample: it opens the configured sample app, chooses a safe visible target, moves the pointer to it, and observes again. It does not click, type, submit, or install anything.
