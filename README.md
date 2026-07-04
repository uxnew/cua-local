# cua-local

Use ChatGPT with MCP to control your local Mac, similar to Computer Use.

`cua-local` is a small local bridge that lets ChatGPT, or another MCP-compatible AI client, observe and operate your own Mac in a controlled loop:

```txt
observe -> act -> observe
```

It can expose basic tools for reading app/screen state, moving the mouse, clicking, typing, scrolling, dragging, pressing keys, and opening URLs. Everything runs locally on macOS, while the AI assistant connects through MCP.

## How it works

`cua-local` uses native macOS capabilities:

- AppleScript / Apple Events for app control
- System Events for keyboard input
- `screencapture` for screen observation
- Swift + CGEvent for mouse movement, clicks, scroll, and drag

In other words: it gives ChatGPT a local Computer Use-like control layer for your Mac through MCP. It is inspired by the Computer Use idea, but it is not an official Computer Use client and not a full desktop automation product.

## Quick start

Requirements:

```txt
macOS
Node.js >= 20
Xcode Command Line Tools
```

Run:

```bash
npm run doctor
npm run check
npm run smoke
npm run demo
```

`npm run doctor` prints a ready-to-copy MCP config for the current checkout.

## MCP config

Use absolute paths on the target machine:

```json
{
  "mcpServers": {
    "computer-use-local": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/cua-local/cua-local.mjs"],
      "cwd": "/ABSOLUTE/PATH/TO/cua-local"
    }
  }
}
```

## Scripts

```bash
npm run start      # start MCP server over stdio
npm run doctor     # check dependencies and macOS permissions
npm run check      # syntax-check project scripts
npm run smoke      # lightweight core validation
npm run demo       # safe observe -> move pointer -> observe sample
```

## Tools

- `list_apps`
- `get_app_state`
- `get_screen_state`
- `health_check`
- `open_url`
- `type_text`
- `press_key`
- `move_mouse`
- `click`
- `scroll`
- `drag`
- `set_value`

## Safety

This tool can operate the local computer. Only connect it to MCP hosts you trust.

`click` blocks common high-risk labels such as Buy, Purchase, Pay, Delete, Remove, Send, Submit, Publish, Share, Update, and Install unless `confirm_risk_action=true` is explicitly provided.

Do not expose this server to the public internet.

## Local files not to commit

```txt
cua-local.mcp.json
.env
traces/
/tmp/cua-local-*
~/.cua-local/
```

## Limitations

- Native app support is partial and app-specific.
- Chrome webpage DOM exposure is limited by macOS Accessibility.
- Multi-display screenshot stitching still needs hardening.
- Trace writing is opt-in via `CUA_LOCAL_TRACE=1` or `CUA_LOCAL_TRACE_DIR=...`.

## License

MIT. See `LICENSE`.
