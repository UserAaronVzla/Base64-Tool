# Base64 Tool — Design

Date: 2026-10-07
Status: Approved in brainstorming, pending written-spec review

## Purpose

A local, offline recreation of https://www.base64decode.org/ (encode and decode).

- **Offline / convenience:** no internet, no ads.
- **Privacy:** content being encoded/decoded (certificates, payloads, tokens) must never leave the machine.
- **Audience:** personal use by the author; not polished for distribution.

## Success criteria

1. A single file, `dist/base64-tool.html`, opens by double-click from disk and works with no network.
2. The page cannot make network requests (enforced by a Content-Security-Policy meta tag).
3. Supports text encode/decode, file encode/decode, the site's options, PEM handling, and hex view (details below).
4. Core logic is covered by automated tests that pass with `node --test`.

## Constraints

- No runtime dependencies, no CDN, fonts, or external assets.
- Build and test use only Node built-ins (Node v24 available). No `package.json` dependencies.
- Browsers can **decode** many charsets via `TextDecoder`, but can only **encode** UTF-8 natively.
  Encode charsets are therefore limited to: UTF-8, UTF-16LE, UTF-16BE, ISO-8859-1 (Latin-1).
  Decode charsets: the WHATWG list supported by `TextDecoder` (UTF-8, UTF-16LE/BE, windows-1252,
  ISO-8859-x, Shift_JIS, GBK, etc.).

## Architecture

Source tree with a no-dependency build step that inlines everything into one HTML file.

```
Base64-Tool/
  src/
    core.js      pure functions, no DOM; works in browser (global B64) and Node (module.exports)
    ui.js        DOM wiring only; calls B64.*
    style.css
    index.html   template containing <!-- inline:style.css -->, <!-- inline:core.js -->, <!-- inline:ui.js -->
  test/
    core.test.js node --test
    build.test.js node --test (verifies built output)
  build.mjs      inlines css/js into the template -> dist/base64-tool.html
  dist/base64-tool.html   the deliverable (committed so it is usable without building)
  README.md
```

`build.mjs` fails (non-zero exit) if any `<!-- inline:... -->` marker is left unresolved or names a missing file.

## Core API (`src/core.js`)

All Base64 conversion is hand-rolled over `Uint8Array` (not `btoa`/`atob`) so it is binary-safe.

| Function | Behaviour |
|---|---|
| `encodeBytes(bytes, {urlSafe, mimeSplit})` | `Uint8Array` → Base64 string. `urlSafe` uses `-_` and omits padding. `mimeSplit` inserts `\r\n` every 76 chars. |
| `encodeText(str, {charset, urlSafe, mimeSplit, perLine})` | Text → bytes in `charset` → Base64. `perLine` encodes each input line independently (lines joined with `\n`; `mimeSplit` ignored when `perLine`). |
| `decodeToBytes(b64, {urlSafe})` | Base64 → `Uint8Array`. Lenient: strips PEM armor and all whitespace, accepts both `+/` and `-_` alphabets regardless of `urlSafe`, tolerates missing padding. Throws `Base64Error` with `position` and `char` on invalid characters, on `=` followed by non-`=` data, and on length ≡ 1 (mod 4) after cleanup. `urlSafe` is accepted for symmetry and has no effect on decoding. |
| `decodeText(b64, {charset, perLine})` | `decodeToBytes` then `TextDecoder(charset)`. `perLine`: each non-empty line decoded independently; a failing line renders as `[line N: <message>]` while others still decode. Throws on an unsupported charset with a clear message. |
| `textToBytes(str, charset)` | UTF-8 via `TextEncoder`; UTF-16LE/BE hand-written (surrogate pairs preserved as code units); ISO-8859-1 throws if any code point > 0xFF. |
| `looksBinary(bytes, charset = 'utf-8')` | Decodes the first 4096 bytes with `charset` (non-fatal) and returns true if the decoded text contains U+0000, or > 10% of its chars are control chars (other than `\t \n \r`) or U+FFFD. Charset-aware so UTF-16LE text (full of NUL bytes) and windows-1252 text are not misclassified. |
| `hexDump(bytes, maxBytes = 65536)` | Lines of `offset(8 hex)  16 hex bytes  |ascii|`. Returns `{text, truncated}`. |
| `detectPem(text)` | Returns `{label, body}` for the first `-----BEGIN X-----…-----END X-----` block, else `null`. |
| `stripPem(text)` | Body of the PEM block if present, otherwise the input unchanged. |
| `wrapPem(b64, label = 'CERTIFICATE')` | `-----BEGIN label-----`, body in 64-char lines, `-----END label-----` (RFC 7468). |
| `ENCODE_CHARSETS`, `DECODE_CHARSETS` | Arrays of charset names for the UI dropdowns. |

## UI (`src/ui.js`, `src/index.html`, `src/style.css`)

Three tabs: **Decode**, **Encode**, **File**. Light/dark follows `prefers-color-scheme`.

**Decode / Encode tabs**

- Input textarea → options row → action button → output textarea with **Copy** and **Download** buttons.
- Options: charset dropdown (decode list or encode list), checkboxes *Live mode*, *Each line separately*, *URL-safe*.
- Encode-only options: *Split into 76-char lines (MIME)*, *Wrap as PEM* with a label field (default `CERTIFICATE`).
- Decode: if PEM armor is detected, a badge shows `PEM: <label> detected, armor stripped`.
- Decode: if `looksBinary(bytes, selectedCharset)` on the decoded bytes, output shows a hex dump, with a *Show as text anyway* toggle and a **Download decoded bytes** button (filename editable, default `decoded.bin`).

**File tab**

- Drag-and-drop zone plus file picker. File is read with `FileReader` into memory only.
- **Encode file → Base64**: optional *Wrap as PEM* and *MIME split*; output can be copied or downloaded as `.b64` / `.pem`.
- **Decode Base64/PEM file → bytes**: downloads the original bytes with a user-editable filename.

**Data flow**: `ui.js` reads input + options, calls one `B64` function, renders text / hex / error. The only retained state is the last decoded `Uint8Array` (for download). Live mode re-runs the action on `input` events, debounced ~150 ms.

**Downloads**: `Blob` + temporary `<a download>`; works from `file://`.

**Error handling**

- Invalid Base64: inline red message, e.g. `Invalid character '%' at position 37`; output cleared.
- Per-line mode: errors are inline per line; valid lines still decode.
- Empty input: empty output, no error.
- Unsupported charset: clear message.
- Inputs > 10 MB: live mode disabled automatically with a notice; hex dump capped at 64 KB with a "truncated" note.

**Security**

- `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:">`
- No external URLs anywhere in the built file.

## Testing

`test/core.test.js` (`node --test`):

- RFC 4648 vectors: `""`, `f`, `fo`, `foo`, `foob`, `fooba`, `foobar`.
- Random byte arrays length 0–300 round-trip and match `Buffer.from(bytes).toString('base64')` (and `base64url`).
- Unicode text including emoji round-trips in UTF-8, UTF-16LE, UTF-16BE; Latin-1 round-trip and rejection of > 0xFF.
- Lenient decode: embedded whitespace/newlines, missing padding, `-_` alphabet, mixed alphabets.
- Errors: invalid char reports correct position and char; length ≡ 1 mod 4; data after padding.
- MIME split at 76 chars; per-line encode/decode including one bad line among good ones.
- PEM: wrap → detect → strip returns original body and label.
- PowerShell `-EncodedCommand` sample decodes as UTF-16LE to the expected command.
- `looksBinary` true for DER bytes, false for UTF-8 text, false for UTF-16LE text when charset is `utf-16le`, false for windows-1252 text when charset is `windows-1252`; `hexDump` format and truncation flag.

`test/build.test.js`:

- Runs the build; asserts the output has no unresolved `<!-- inline:` markers, contains the CSP meta tag, and contains no `http://` / `https://` in `src=` / `href=` attributes or `url(...)`.

**Manual browser check** before declaring done: open `dist/base64-tool.html` from disk and verify decode of a real certificate PEM, live-mode encode, a file round-trip, and the error display.

## Out of scope

- Chained/recursive decoding, other encodings (hex input, URL-encoding, gzip), CLI version, distribution packaging.
