# Base64 Tool

An offline, single-file Base64 encoder/decoder modelled on base64decode.org.
Open `dist/base64-tool.html` by double-clicking it. Nothing you paste or drop is sent anywhere:
the page has no external resources, and its Content-Security-Policy (`default-src 'none'`)
blocks all network requests.

## Features

- **Decode:** Base64 → text in any common charset (UTF-8, UTF-16LE/BE, Windows-125x, ISO-8859-x, Shift_JIS, GBK, …).
  - Lenient: accepts whitespace, missing padding, and both the standard and URL-safe alphabets.
  - Errors show the exact character and its position.
  - PEM armor (`-----BEGIN …-----`) is detected and stripped automatically.
  - Binary output is shown as a hex dump and can be downloaded as raw bytes.
- **Encode:** text → Base64 as UTF-8, UTF-16LE/BE or ISO-8859-1, with options for URL-safe, 76-char MIME lines and PEM wrapping.
- **Both modes:** live mode, and *Each line separately*.
- **File:** encode any file to Base64/PEM, or decode a Base64/PEM file back to its original bytes.

Tip: PowerShell `-EncodedCommand` payloads are UTF-16LE. Pick that charset when decoding them.

## Development

Requires Node 18+ (developed on Node 24). No npm install; there are no dependencies.

```bash
node --test        # unit tests (core logic + build checks)
node build.mjs     # writes dist/base64-tool.html
```

Source layout:

| Path | Role |
|---|---|
| `src/core.js` | Pure encode/decode logic (browser global `B64`, Node module) |
| `src/ui.js` | DOM wiring |
| `src/index.html`, `src/style.css` | Page template and styles |
| `build.mjs` | Inlines CSS/JS into the template to produce the single HTML file |

Rebuild and commit `dist/base64-tool.html` after changing anything in `src/`.
