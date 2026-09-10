/* upload-control.js — the shared behaviour for .mw-upload (register row 189, 2026-09-10).
 *
 * ★ EVERYTHING ESSENTIAL WORKS WITHOUT THIS FILE.
 * The control is a real <input type="file"> with real <label for> elements, so tab order,
 * focus, Space/Enter activation, click-to-open, form association and constraint validation
 * are all native. If this script fails to load, a user can still select a file and submit
 * the form — they just lose the filename readout and the Remove button. That is deliberate,
 * and it is the whole reason the component is built on a native input rather than a
 * <button> driving a hidden one: the failure mode of a JS-driven control is a control that
 * does nothing at all.
 *
 * What this file adds:
 *   - the filename readout, announced via a role="status" live region
 *   - a Remove affordance (a wrong file previously could not be undone without reloading)
 *   - aria-invalid + an error message associated through aria-describedby
 *
 * Same self-invoking convention as site-nav.js / home-motion.js: no page needs to call it.
 */
(function () {
  'use strict';

  var EMPTY_TEXT = 'No file chosen';

  function stateEl(root) { return root.querySelector('.mw-upload-state'); }
  function clearBtn(root) { return root.querySelector('.mw-upload-clear'); }

  function render(root) {
    var input = root.querySelector('.mw-upload-input');
    var state = stateEl(root);
    var clear = clearBtn(root);
    if (!input) return;
    var file = input.files && input.files[0] ? input.files[0] : null;

    if (state) state.textContent = file ? file.name : EMPTY_TEXT;
    root.classList.toggle('has-file', !!file);
    root.classList.toggle('is-empty', !file);
    // `hidden` rather than a CSS class: a display:none button is out of the tab order,
    // so a keyboard user never lands on a dead "Remove" for a file that isn't there.
    if (clear) clear.hidden = !file;
  }

  /* Public: associate an error with the control itself rather than leaving it floating
   * beside it. Sets aria-invalid and appends the error node's id to aria-describedby, so a
   * screen reader reads the problem as part of the field. */
  function setError(root, message) {
    var input = root.querySelector('.mw-upload-input');
    var err = root.querySelector('.mw-upload-error');
    if (!input || !err) return;
    var ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (message) {
      err.textContent = message;
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      if (err.id && ids.indexOf(err.id) === -1) ids.push(err.id);
    } else {
      err.textContent = '';
      err.hidden = true;
      input.removeAttribute('aria-invalid');
      ids = ids.filter(function (id) { return id !== err.id; });
    }
    input.setAttribute('aria-describedby', ids.join(' '));
  }

  function wire(root) {
    if (root.dataset.mwUploadWired === '1') return;
    root.dataset.mwUploadWired = '1';
    var input = root.querySelector('.mw-upload-input');
    var clear = clearBtn(root);
    if (!input) return;

    input.addEventListener('change', function () {
      setError(root, '');
      render(root);
    });

    if (clear) {
      clear.addEventListener('click', function () {
        input.value = '';
        setError(root, '');
        render(root);
        // Focus returns to the control the user was operating, not to the start of the
        // document — otherwise clearing a file strands a keyboard user.
        input.focus();
      });
    }

    render(root);
  }

  function init(scope) {
    var nodes = (scope || document).querySelectorAll('.mw-upload');
    Array.prototype.forEach.call(nodes, wire);
  }

  window.MarketswaveUpload = {
    init: init,
    refresh: render,
    setError: setError,
    /* Reading the real File object beats scraping the rendered filename text, which is what
     * signup.html's own uploadedFileName() used to do — that broke the moment the readout
     * markup changed, and it could not distinguish "no file" from "a file literally named
     * the placeholder text". */
    fileName: function (root) {
      var input = root && root.querySelector('.mw-upload-input');
      return input && input.files && input.files[0] ? input.files[0].name : null;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }
})();
