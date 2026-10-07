/* Base64 Tool UI: DOM wiring only. All conversion goes through the B64 global (core.js). */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LARGE_INPUT = 10 * 1024 * 1024;

  // ---- shared helpers

  function setMsg(el, text) {
    el.textContent = text || '';
    el.hidden = !text;
  }

  function fillCharsets(select, list) {
    for (const cs of list) {
      const opt = document.createElement('option');
      opt.value = cs;
      opt.textContent = cs.toUpperCase();
      select.appendChild(opt);
    }
  }

  function download(data, filename, type) {
    const url = URL.createObjectURL(new Blob([data], { type: type || 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const label = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = label; }, 1200);
  }

  function debounce(fn, ms) {
    let timer;
    return () => {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  function formatSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Notes about PEM armor and suspicious input for a decode (before the size note).
  function decodeNotes(text, pem) {
    const notes = [];
    if (pem) {
      notes.push(pem.count > 1
        ? `PEM: ${pem.count} blocks found, decoded only the first (${pem.label}); paste blocks separately`
        : `PEM: ${pem.label} detected, armor stripped`);
    }
    return notes.concat(B64.decodeWarnings(text));
  }

  // Live mode: re-run on input (debounced) and on option changes; off automatically for huge input.
  function wireLive({ input, live, run, notes, options }) {
    const runLater = debounce(run, 150);
    input.addEventListener('input', () => {
      if (!live.checked) return;
      if (input.value.length > LARGE_INPUT) {
        live.checked = false;
        setMsg(notes, 'Live mode turned off: input is larger than 10 MB. Use the button instead.');
        return;
      }
      runLater();
    });
    for (const el of options) el.addEventListener('change', () => { if (live.checked) run(); });
    live.addEventListener('change', () => { if (live.checked) run(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        run();
      }
    });
  }

  // ---- tabs

  const TABS = ['decode', 'encode', 'file'];
  function showTab(name) {
    for (const t of TABS) {
      $('tab-' + t).setAttribute('aria-selected', String(t === name));
      $('panel-' + t).hidden = t !== name;
    }
  }
  for (const t of TABS) $('tab-' + t).addEventListener('click', () => showTab(t));

  // Dropping a file anywhere outside the drop zone must not navigate away from the page.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // ---- decode tab

  const dec = {
    input: $('dec-input'), charset: $('dec-charset'), live: $('dec-live'), perLine: $('dec-perline'),
    run: $('dec-run'), error: $('dec-error'), notes: $('dec-notes'), output: $('dec-output'),
    asText: $('dec-astext'), asTextWrap: $('dec-astext-wrap'), copy: $('dec-copy'),
    filename: $('dec-filename'), download: $('dec-download'),
  };
  fillCharsets(dec.charset, B64.supportedDecodeCharsets());
  let lastDecoded = null;

  function runDecode() {
    setMsg(dec.error, '');
    setMsg(dec.notes, '');
    dec.asTextWrap.hidden = true;
    lastDecoded = null;
    const text = dec.input.value;
    const charset = dec.charset.value;
    if (text.trim() === '') {
      dec.output.value = '';
      return;
    }
    try {
      if (dec.perLine.checked) {
        dec.output.value = B64.decodeText(text, { charset, perLine: true });
        return;
      }
      const pem = B64.detectPem(text);
      const bytes = B64.decodeToBytes(text);
      lastDecoded = bytes;
      const notes = decodeNotes(text, pem);
      notes.push(`${formatSize(bytes.length)} decoded`);
      const binary = B64.looksBinary(bytes, charset);
      dec.asTextWrap.hidden = !binary;
      if (binary && !dec.asText.checked) {
        const dump = B64.hexDump(bytes);
        dec.output.value = dump.text;
        notes.push('binary data, showing hex dump' + (dump.truncated ? ' (first 64 KB only; Download saves everything)' : ''));
      } else {
        dec.output.value = B64.bytesToText(bytes, charset);
      }
      setMsg(dec.notes, notes.join(' · '));
    } catch (e) {
      dec.output.value = '';
      setMsg(dec.error, e.message);
    }
  }

  dec.run.addEventListener('click', runDecode);
  dec.asText.addEventListener('change', runDecode);
  wireLive({ input: dec.input, live: dec.live, run: runDecode, notes: dec.notes, options: [dec.charset, dec.perLine] });
  dec.copy.addEventListener('click', () => copyText(dec.output.value, dec.copy));
  dec.download.addEventListener('click', () => {
    if (lastDecoded) download(lastDecoded, dec.filename.value.trim() || 'decoded.bin');
    else if (dec.output.value) download(dec.output.value, dec.filename.value.trim() || 'decoded.txt', 'text/plain');
  });

  // ---- encode tab

  const enc = {
    input: $('enc-input'), charset: $('enc-charset'), live: $('enc-live'), perLine: $('enc-perline'),
    urlSafe: $('enc-urlsafe'), mime: $('enc-mime'), pem: $('enc-pem'), pemLabel: $('enc-pemlabel'),
    run: $('enc-run'), error: $('enc-error'), notes: $('enc-notes'), output: $('enc-output'),
    copy: $('enc-copy'), filename: $('enc-filename'), download: $('enc-download'),
  };
  fillCharsets(enc.charset, B64.ENCODE_CHARSETS);

  function runEncode() {
    setMsg(enc.error, '');
    setMsg(enc.notes, '');
    const text = enc.input.value;
    if (text === '') {
      enc.output.value = '';
      return;
    }
    const perLine = enc.perLine.checked;
    const pem = enc.pem.checked;
    try {
      let out = B64.encodeText(text, {
        charset: enc.charset.value,
        perLine,
        urlSafe: enc.urlSafe.checked && !pem,
        mimeSplit: enc.mime.checked && !pem,
      });
      if (pem && !perLine) out = B64.wrapPem(out, enc.pemLabel.value.trim() || 'CERTIFICATE');
      if (pem && perLine) setMsg(enc.notes, 'PEM wrapping is ignored in per-line mode.');
      else if (pem && (enc.urlSafe.checked || enc.mime.checked)) {
        setMsg(enc.notes, 'PEM always uses the standard alphabet and 64-character lines.');
      }
      enc.output.value = out;
    } catch (e) {
      enc.output.value = '';
      setMsg(enc.error, e.message);
    }
  }

  enc.run.addEventListener('click', runEncode);
  wireLive({
    input: enc.input, live: enc.live, run: runEncode, notes: enc.notes,
    options: [enc.charset, enc.perLine, enc.urlSafe, enc.mime, enc.pem, enc.pemLabel],
  });
  enc.pem.addEventListener('change', () => {
    enc.filename.value = enc.pem.checked ? 'encoded.pem' : 'encoded.b64';
  });
  enc.copy.addEventListener('click', () => copyText(enc.output.value, enc.copy));
  enc.download.addEventListener('click', () => {
    if (enc.output.value) download(enc.output.value, enc.filename.value.trim() || 'encoded.b64', 'text/plain');
  });

  // ---- file tab

  const MAX_DISPLAY = 5 * 1024 * 1024;
  const file = {
    drop: $('drop'), pick: $('file-pick'), input: $('file-input'), info: $('file-info'),
    encOpts: $('file-enc-opts'), mime: $('file-mime'), pem: $('file-pem'), pemLabel: $('file-pemlabel'),
    run: $('file-run'), error: $('file-error'), notes: $('file-notes'), output: $('file-output'),
    copy: $('file-copy'), filename: $('file-filename'), download: $('file-download'),
  };
  let currentFile = null;
  let fileResult = null; // { data: string | Uint8Array, type: string }

  function fileMode() {
    return document.querySelector('input[name="file-mode"]:checked').value;
  }

  function resetFileResult() {
    fileResult = null;
    file.output.value = '';
    setMsg(file.error, '');
    setMsg(file.notes, '');
  }

  function suggestFilename() {
    if (!currentFile) return;
    const name = currentFile.name;
    if (fileMode() === 'encode') {
      file.filename.value = name + (file.pem.checked ? '.pem' : '.b64');
    } else {
      const base = name.replace(/\.(b64|base64|pem|txt)$/i, '');
      file.filename.value = base === name ? name + '.bin' : base;
    }
  }

  function setFile(f) {
    currentFile = f;
    resetFileResult();
    file.info.textContent = `${f.name} (${formatSize(f.size)})`;
    suggestFilename();
  }

  async function runFile() {
    resetFileResult();
    if (!currentFile) {
      setMsg(file.error, 'Choose a file first.');
      return;
    }
    // Reads can be slow (large files, endpoint scanning); drop the result if the file or mode changed meanwhile.
    const f = currentFile;
    const mode = fileMode();
    const stale = () => currentFile !== f || fileMode() !== mode;
    file.run.disabled = true;
    setMsg(file.notes, 'Reading file…');
    try {
      const raw = new Uint8Array(await f.arrayBuffer());
      if (stale()) return;
      if (mode === 'encode') {
        const bytes = raw;
        const pem = file.pem.checked;
        let out = B64.encodeBytes(bytes, { mimeSplit: file.mime.checked && !pem });
        if (pem) out = B64.wrapPem(out, file.pemLabel.value.trim() || 'CERTIFICATE');
        fileResult = { data: out, type: 'text/plain' };
        const note = `${formatSize(bytes.length)} → ${formatSize(out.length)} of Base64`;
        if (out.length > MAX_DISPLAY) {
          setMsg(file.notes, `${note} · too large to display, use Download or Copy`);
        } else {
          file.output.value = out;
          setMsg(file.notes, note);
        }
      } else {
        const text = B64.fileBytesToText(raw);
        const pem = B64.detectPem(text);
        const bytes = B64.decodeToBytes(text);
        fileResult = { data: bytes, type: 'application/octet-stream' };
        const dump = B64.hexDump(bytes);
        file.output.value = dump.text;
        const notes = decodeNotes(text, pem);
        notes.push(`${formatSize(bytes.length)} decoded`);
        if (dump.truncated) notes.push('preview shows the first 64 KB');
        setMsg(file.notes, notes.join(' · '));
      }
    } catch (e) {
      if (!stale()) {
        setMsg(file.notes, '');
        setMsg(file.error, e.message);
      }
    } finally {
      file.run.disabled = false;
    }
  }

  ['dragenter', 'dragover'].forEach((ev) => file.drop.addEventListener(ev, (e) => {
    e.preventDefault();
    file.drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => file.drop.addEventListener(ev, (e) => {
    e.preventDefault();
    file.drop.classList.remove('over');
  }));
  file.drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  });
  file.pick.addEventListener('click', () => file.input.click());
  file.input.addEventListener('change', () => {
    if (file.input.files[0]) setFile(file.input.files[0]);
    file.input.value = '';
  });
  for (const radio of document.querySelectorAll('input[name="file-mode"]')) {
    radio.addEventListener('change', () => {
      file.encOpts.hidden = fileMode() !== 'encode';
      resetFileResult();
      suggestFilename();
    });
  }
  file.pem.addEventListener('change', suggestFilename);
  file.run.addEventListener('click', runFile);
  file.copy.addEventListener('click', () => {
    if (fileResult && typeof fileResult.data === 'string') copyText(fileResult.data, file.copy);
    else copyText(file.output.value, file.copy);
  });
  file.download.addEventListener('click', () => {
    if (fileResult) download(fileResult.data, file.filename.value.trim() || 'output', fileResult.type);
  });
})();
