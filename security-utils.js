(function initAtomicSecurity(globalScope) {
  'use strict';

  const PLUGIN_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,98}[a-zA-Z0-9])?$/;

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function isValidPluginId(value) {
    return typeof value === 'string'
      && value !== '.'
      && value !== '..'
      && PLUGIN_ID_PATTERN.test(value);
  }

  const api = Object.freeze({ escapeHtml, isValidPluginId });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.AtomicSecurity = api;
})(typeof window !== 'undefined' ? window : globalThis);
