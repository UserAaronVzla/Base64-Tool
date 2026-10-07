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
    return pem ? decodeClean(pem.body, pem.start) : decodeClean(text, 0);
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

  function detectPem(text) {
    const m = PEM_RE.exec(String(text));
    if (!m) return null;
    return { label: m[1], body: m[2], start: m.index + '-----BEGIN '.length + m[1].length + '-----'.length };
  }

  function stripPem(text) {
    const pem = detectPem(text);
    return pem ? pem.body : text;
  }

  function wrapPem(b64, label = 'CERTIFICATE') {
    const body = String(b64).replace(/\s+/g, '');
    return `-----BEGIN ${label}-----\n${splitLines(body, 64, '\n')}\n-----END ${label}-----\n`;
  }

  return {
    Base64Error,
    encodeBytes, decodeToBytes,
    ENCODE_CHARSETS, DECODE_CHARSETS, supportedDecodeCharsets,
    textToBytes, bytesToText, encodeText, decodeText,
    detectPem, stripPem, wrapPem,
  };
});
