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
    return decodeClean(String(input), 0);
  }

  return {
    Base64Error,
    encodeBytes, decodeToBytes,
  };
});
