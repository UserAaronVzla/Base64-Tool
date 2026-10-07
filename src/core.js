/* Base64 Tool core: pure functions, no DOM. Browser global `B64`, Node `module.exports`. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.B64 = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  // Char code -> sextet value; accepts both alphabets. -1 = invalid.
  const LOOKUP = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) {
    LOOKUP[STD_ALPHABET.charCodeAt(i)] = i;
    LOOKUP[URL_ALPHABET.charCodeAt(i)] = i;
  }

  class Base64Error extends Error {
    constructor(message, position = null, char = null) {
      super(message);
      this.name = 'Base64Error';
      this.position = position;
      this.char = char;
    }
  }

  function splitLines(s, width, sep) {
    if (s.length <= width) return s;
    const parts = [];
    for (let i = 0; i < s.length; i += width) parts.push(s.slice(i, i + width));
    return parts.join(sep);
  }

  function encodeBytes(bytes, opts = {}) {
    const alphabet = opts.urlSafe ? URL_ALPHABET : STD_ALPHABET;
    const len = bytes.length;
    let s = '';
    let i = 0;
    for (; i + 2 < len; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      s += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + alphabet[(n >> 6) & 63] + alphabet[n & 63];
    }
    const rem = len - i;
    if (rem === 1) {
      const n = bytes[i] << 16;
      s += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + (opts.urlSafe ? '' : '==');
    } else if (rem === 2) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      s += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + alphabet[(n >> 6) & 63] + (opts.urlSafe ? '' : '=');
    }
    return opts.mimeSplit ? splitLines(s, 76, '\r\n') : s;
  }

  function charAt(text, i) {
    return String.fromCodePoint(text.codePointAt(i));
  }

  // Decode `text`; `offset` is added to reported positions so they refer to the caller's original input.
  function decodeClean(text, offset) {
    const vals = new Uint8Array(text.length);
    let count = 0;
    let padSeen = false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12) continue;
      if (c === 61) { padSeen = true; continue; }
      if (padSeen) {
        throw new Base64Error(`Unexpected data after padding at position ${i + offset}`, i + offset, charAt(text, i));
      }
      const v = c < 128 ? LOOKUP[c] : -1;
      if (v < 0) {
        const ch = charAt(text, i);
        throw new Base64Error(`Invalid character '${ch}' at position ${i + offset}`, i + offset, ch);
      }
      vals[count++] = v;
    }
    const rem = count % 4;
    if (rem === 1) {
      throw new Base64Error(`Invalid Base64 length: ${count} characters (the last group has only one character)`);
    }
    const out = new Uint8Array(Math.floor(count / 4) * 3 + (rem === 0 ? 0 : rem - 1));
    let o = 0;
    let j = 0;
    for (; j + 3 < count; j += 4) {
      const n = (vals[j] << 18) | (vals[j + 1] << 12) | (vals[j + 2] << 6) | vals[j + 3];
      out[o++] = (n >> 16) & 255;
      out[o++] = (n >> 8) & 255;
      out[o++] = n & 255;
    }
    if (rem === 2) {
      const n = (vals[j] << 18) | (vals[j + 1] << 12);
      out[o++] = (n >> 16) & 255;
    } else if (rem === 3) {
      const n = (vals[j] << 18) | (vals[j + 1] << 12) | (vals[j + 2] << 6);
      out[o++] = (n >> 16) & 255;
      out[o++] = (n >> 8) & 255;
    }
    return out;
  }

  // `opts.urlSafe` is accepted for symmetry; decoding always accepts both alphabets.
  function decodeToBytes(input, opts = {}) {
    const text = String(input);
    const pem = detectPem(text);
    if (pem) return decodeClean(pem.body, pem.start);
    // An unpaired armor line (truncated paste, mismatched labels) would otherwise decode as data.
    const orphan = ARMOR_LINE_RE.exec(text);
    if (orphan) {
      throw new Base64Error(
        `PEM armor line without a matching BEGIN/END pair at position ${orphan.index} (truncated paste or mismatched labels?)`,
        orphan.index, '-');
    }
    return decodeClean(text, 0);
  }

  // Non-fatal hints about input that decodes but probably not as intended.
  function decodeWarnings(input) {
    const text = String(input);
    const pem = detectPem(text);
    const lines = splitInputLines(pem ? pem.body : text);
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].trim().split(/\s+/);
      if (parts.length > 1) {
        const second = parts[1].length > 8 ? parts[1].slice(0, 8) + '…' : parts[1];
        return [`Line ${i + 1} contains a space between "${parts[0]}" and "${second}"; both were decoded together. ` +
          'Remove any prefix such as "Basic " or "Bearer " if the output looks wrong.'];
      }
    }
    return [];
  }

  // Text of a dropped/picked file: honours UTF-8/UTF-16 BOMs and BOM-less UTF-16LE
  // (Windows PowerShell 5.1 `>` / Out-File writes UTF-16LE).
  function fileBytesToText(bytes) {
    let charset = 'utf-8';
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) charset = 'utf-16le';
    else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) charset = 'utf-16be';
    else if (bytes.length >= 2 && bytes[0] !== 0 && bytes[1] === 0) charset = 'utf-16le';
    return new TextDecoder(charset).decode(bytes);
  }

  // ---- charsets

  const ENCODE_CHARSETS = ['utf-8', 'utf-16le', 'utf-16be', 'iso-8859-1'];
  const DECODE_CHARSETS = [
    'utf-8', 'utf-16le', 'utf-16be', 'windows-1252',
    'iso-8859-2', 'iso-8859-3', 'iso-8859-4', 'iso-8859-5', 'iso-8859-6', 'iso-8859-7', 'iso-8859-8',
    'iso-8859-10', 'iso-8859-13', 'iso-8859-14', 'iso-8859-15', 'iso-8859-16',
    'windows-1250', 'windows-1251', 'windows-1253', 'windows-1254', 'windows-1255', 'windows-1256',
    'windows-1257', 'windows-1258', 'windows-874', 'koi8-r', 'koi8-u', 'ibm866', 'macintosh',
    'shift_jis', 'euc-jp', 'iso-2022-jp', 'euc-kr', 'gbk', 'gb18030', 'big5',
  ];

  function makeDecoder(charset) {
    try {
      return new TextDecoder(charset);
    } catch (e) {
      throw new Error(`Unsupported charset: ${charset}`);
    }
  }

  function supportedDecodeCharsets() {
    return DECODE_CHARSETS.filter((cs) => {
      try { new TextDecoder(cs); return true; } catch (e) { return false; }
    });
  }

  function textToBytes(str, charset = 'utf-8') {
    const cs = String(charset).toLowerCase();
    if (cs === 'utf-8') return new TextEncoder().encode(str);
    if (cs === 'utf-16le' || cs === 'utf-16be') {
      const be = cs === 'utf-16be';
      const out = new Uint8Array(str.length * 2);
      for (let i = 0; i < str.length; i++) {
        const u = str.charCodeAt(i);
        out[2 * i] = be ? u >> 8 : u & 255;
        out[2 * i + 1] = be ? u & 255 : u >> 8;
      }
      return out;
    }
    if (cs === 'iso-8859-1') {
      const out = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        const u = str.charCodeAt(i);
        if (u > 255) {
          throw new Error(`Character '${charAt(str, i)}' at position ${i} cannot be encoded as ISO-8859-1`);
        }
        out[i] = u;
      }
      return out;
    }
    throw new Error(`Encoding to ${charset} is not supported (supported: ${ENCODE_CHARSETS.join(', ')})`);
  }

  function bytesToText(bytes, charset = 'utf-8') {
    return makeDecoder(charset).decode(bytes);
  }

  function splitInputLines(s) {
    return String(s).split(/\r?\n/);
  }

  function encodeText(str, opts = {}) {
    const charset = opts.charset || 'utf-8';
    if (opts.perLine) {
      return splitInputLines(str)
        .map((line) => encodeBytes(textToBytes(line, charset), { urlSafe: opts.urlSafe }))
        .join('\n');
    }
    return encodeBytes(textToBytes(str, charset), { urlSafe: opts.urlSafe, mimeSplit: opts.mimeSplit });
  }

  function decodeText(b64, opts = {}) {
    const decoder = makeDecoder(opts.charset || 'utf-8');
    if (opts.perLine) {
      return splitInputLines(b64)
        .map((line, idx) => {
          if (line.trim() === '') return '';
          try {
            return decoder.decode(decodeToBytes(line));
          } catch (e) {
            return `[line ${idx + 1}: ${e.message}]`;
          }
        })
        .join('\n');
    }
    return decoder.decode(decodeToBytes(b64));
  }

  // ---- PEM

  const PEM_RE = /-----BEGIN ([^\r\n-][^\r\n]*?)-----([\s\S]*?)-----END \1-----/;
  const PEM_RE_ALL = new RegExp(PEM_RE.source, 'g');
  const ARMOR_LINE_RE = /-----(BEGIN|END) [^\r\n]*?-----/;

  // First PEM block in `text`, plus `count` = number of PEM blocks present.
  function detectPem(text) {
    const s = String(text);
    const m = PEM_RE.exec(s);
    if (!m) return null;
    return {
      label: m[1],
      body: m[2],
      start: m.index + '-----BEGIN '.length + m[1].length + '-----'.length,
      count: s.match(PEM_RE_ALL).length,
    };
  }

  function stripPem(text) {
    const pem = detectPem(text);
    return pem ? pem.body : text;
  }

  function wrapPem(b64, label = 'CERTIFICATE') {
    const body = String(b64).replace(/\s+/g, '');
    return `-----BEGIN ${label}-----\n${splitLines(body, 64, '\n')}\n-----END ${label}-----\n`;
  }

  // ---- binary helpers

  function looksBinary(bytes, charset = 'utf-8') {
    const sample = bytes.subarray(0, 4096);
    if (sample.length === 0) return false;
    let text;
    try {
      text = new TextDecoder(charset).decode(sample);
    } catch (e) {
      return true;
    }
    let total = 0;
    let bad = 0;
    for (const ch of text) {
      const c = ch.codePointAt(0);
      if (c === 0) return true;
      total++;
      if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127 || c === 0xfffd) bad++;
    }
    return bad / total > 0.1;
  }

  function hexDump(bytes, maxBytes = 65536) {
    const n = Math.min(bytes.length, maxBytes);
    const lines = [];
    for (let off = 0; off < n; off += 16) {
      const end = Math.min(off + 16, n);
      let hex = '';
      let ascii = '';
      for (let k = 0; k < 16; k++) {
        if (off + k < end) {
          const b = bytes[off + k];
          hex += b.toString(16).padStart(2, '0') + ' ';
          ascii += b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
        } else {
          hex += '   ';
        }
        if (k === 7) hex += ' ';
      }
      lines.push(`${off.toString(16).padStart(8, '0')}  ${hex} |${ascii}|`);
    }
    return { text: lines.join('\n'), truncated: bytes.length > maxBytes };
  }

  return {
    Base64Error,
    encodeBytes, decodeToBytes,
    ENCODE_CHARSETS, DECODE_CHARSETS, supportedDecodeCharsets,
    textToBytes, bytesToText, encodeText, decodeText,
    detectPem, stripPem, wrapPem, decodeWarnings, fileBytesToText,
    looksBinary, hexDump,
  };
});
