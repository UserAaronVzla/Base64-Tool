/* Base64 Tool UI: DOM wiring only. All conversion goes through the B64 global (core.js). */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---- tabs

  const TABS = ['decode', 'encode', 'file'];
  function showTab(name) {
    for (const t of TABS) {
      $('tab-' + t).setAttribute('aria-selected', String(t === name));
      $('panel-' + t).hidden = t !== name;
    }
  }
  for (const t of TABS) $('tab-' + t).addEventListener('click', () => showTab(t));
})();
