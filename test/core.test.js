const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const B64 = require('../src/core.js');

const bytesOf = (s) => new TextEncoder().encode(s);
const asBuf = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);

// ---- Task 1: codec

test('RFC 4648 test vectors encode and decode', () => {
  const vectors = [['', ''], ['f', 'Zg=='], ['fo', 'Zm8='], ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='], ['fooba', 'Zm9vYmE='], ['foobar', 'Zm9vYmFy']];
  for (const [plain, b64] of vectors) {
    assert.equal(B64.encodeBytes(bytesOf(plain)), b64);
    assert.deepEqual(asBuf(B64.decodeToBytes(b64)), Buffer.from(plain));
  }
});

test('random byte arrays round-trip and match Buffer (standard and url-safe)', () => {
  for (let len = 0; len <= 300; len++) {
    const bytes = crypto.randomBytes(len);
    const std = B64.encodeBytes(bytes);
    const url = B64.encodeBytes(bytes, { urlSafe: true });
    assert.equal(std, bytes.toString('base64'), `std len ${len}`);
    assert.equal(url, bytes.toString('base64url'), `url len ${len}`);
    assert.deepEqual(asBuf(B64.decodeToBytes(std)), bytes);
    assert.deepEqual(asBuf(B64.decodeToBytes(url)), bytes);
  }
});

test('decode is lenient: whitespace, missing padding, mixed alphabets', () => {
  assert.equal(asBuf(B64.decodeToBytes(' Zm9v\r\nYmFy \t')).toString(), 'foobar');
  assert.equal(asBuf(B64.decodeToBytes('Zm9vYg')).toString(), 'foob');
  assert.equal(asBuf(B64.decodeToBytes('Zm9vYmE')).toString(), 'fooba');
  const bytes = Uint8Array.from([0xfb, 0xff, 0xbf, 0xfe]);
  assert.deepEqual(B64.decodeToBytes('-_-__g'), bytes);
  assert.deepEqual(B64.decodeToBytes('+/+//g=='), bytes);
  assert.deepEqual(B64.decodeToBytes('-/+_/g'), bytes);
});

test('invalid character reports position in the original input', () => {
  assert.throws(() => B64.decodeToBytes('QUJD\nR%=='), (e) => {
    assert.equal(e.name, 'Base64Error');
    assert.equal(e.position, 6);
    assert.equal(e.char, '%');
    assert.equal(e.message, "Invalid character '%' at position 6");
    return true;
  });
});

test('length of 1 mod 4 is rejected', () => {
  assert.throws(() => B64.decodeToBytes('Zm9vY'), /Invalid Base64 length: 5 characters/);
});

test('data after padding is rejected', () => {
  assert.throws(() => B64.decodeToBytes('Zg==Zg=='), (e) => e.position === 4 && /after padding/.test(e.message));
});

test('MIME split inserts CRLF every 76 characters', () => {
  const out = B64.encodeBytes(new Uint8Array(100), { mimeSplit: true });
  const lines = out.split('\r\n');
  assert.deepEqual(lines.map((l) => l.length), [76, 60]);
  assert.equal(B64.encodeBytes(new Uint8Array(57), { mimeSplit: true }).includes('\r\n'), false);
});

test('large input (5 MB) encodes and decodes without stack overflow', () => {
  const bytes = crypto.randomBytes(5 * 1024 * 1024);
  const b64 = B64.encodeBytes(bytes);
  assert.equal(b64, bytes.toString('base64'));
  assert.ok(asBuf(B64.decodeToBytes(b64)).equals(bytes));
});

// ---- Task 2: charsets and text

test('unicode text round-trips in UTF-8, UTF-16LE, UTF-16BE', () => {
  const text = 'héllo wörld — 日本語 🙂🚀';
  for (const charset of ['utf-8', 'utf-16le', 'utf-16be']) {
    const b64 = B64.encodeText(text, { charset });
    assert.equal(B64.decodeText(b64, { charset }), text, charset);
  }
  assert.equal(B64.encodeText(text, { charset: 'utf-8' }), Buffer.from(text, 'utf8').toString('base64'));
  assert.equal(B64.encodeText(text, { charset: 'utf-16le' }), Buffer.from(text, 'utf16le').toString('base64'));
});

test('ISO-8859-1 round-trips and rejects characters above U+00FF', () => {
  const text = 'café ñ ü ©';
  const b64 = B64.encodeText(text, { charset: 'iso-8859-1' });
  assert.equal(b64, Buffer.from(text, 'latin1').toString('base64'));
  assert.equal(B64.decodeText(b64, { charset: 'iso-8859-1' }), text);
  assert.throws(() => B64.encodeText('price: €5', { charset: 'iso-8859-1' }),
    /Character '€' at position 7 cannot be encoded as ISO-8859-1/);
});

test('unsupported charsets give clear errors', () => {
  assert.throws(() => B64.encodeText('x', { charset: 'shift_jis' }), /Encoding to shift_jis is not supported/);
  assert.throws(() => B64.decodeText('eA==', { charset: 'not-a-charset' }), /Unsupported charset: not-a-charset/);
});

test('every listed decode charset is supported by this runtime', () => {
  assert.deepEqual(B64.supportedDecodeCharsets(), B64.DECODE_CHARSETS);
});

test('PowerShell -EncodedCommand decodes as UTF-16LE', () => {
  assert.equal(
    B64.decodeText('VwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAAnAGgAaQAnAA==', { charset: 'utf-16le' }),
    "Write-Output 'hi'");
});

test('per-line encode handles CRLF and preserves blank lines', () => {
  assert.equal(B64.encodeText('foo\r\n\r\nbar\r\n', { perLine: true }), 'Zm9v\n\nYmFy\n');
});

test('per-line decode keeps good lines when one line is bad, and preserves blank lines', () => {
  const out = B64.decodeText('Zm9v\r\n\r\nYm%y\r\nYmFy', { perLine: true });
  assert.equal(out, "foo\n\n[line 3: Invalid character '%' at position 2]\nbar");
});

test('per-line mode ignores mimeSplit', () => {
  const long = 'x'.repeat(100);
  assert.equal(B64.encodeText(long, { perLine: true, mimeSplit: true }).includes('\r\n'), false);
});
