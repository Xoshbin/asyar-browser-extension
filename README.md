# Browser

> Search tabs, bookmarks, and history across your paired browsers; open URLs in any paired browser.

`org.asyar.browser` is a Tier 2 Asyar extension (productivity · macOS, Windows, Linux).

## What it does

The extension provides **2 commands**:

| Command | Mode | What it does |
| --- | --- | --- |
| **Open URL** | `background` | Open a URL in a paired browser (or the OS default). |
| **Browser** | `view` | Search tabs, history, bookmarks; open URLs and web searches — the browser command bar. |

## Permissions

```json
"permissions": [
  "browser:tabs.read",
  "browser:tabs.write",
  "browser:bookmarks.read",
  "browser:history.read"
]
```

## Install

Install from the [Asyar Store](https://asyar.org/extensions).

## Develop

```bash
# from this directory
pnpm install
pnpm dev          # vite dev server
pnpm test:run     # vitest
pnpm build        # emits dist/{worker,view}.js + assets
pnpm link         # registers the dev path with the launcher
asyar publish     # builds, packages, GitHub release, store submission
```

## License

[MIT](./LICENSE) © Khoshbin
