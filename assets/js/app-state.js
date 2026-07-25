/* ClackOS app state — opt-in persistence for application pages.
 *
 * An app that includes this script can have its state remembered by the
 * desktop: ClackOS saves it with the rest of the session (browser storage, no
 * server) and hands it back when the window is restored or opened from a
 * shared desktop link.
 *
 *   <script src="../../assets/js/app-state.js"></script>
 *   ClackOSAppState.connect({ controls: true });                 // every form control
 *   ClackOSAppState.connect({ save, restore });                  // or your own shape
 *
 * Options:
 *   controls  true, or a function returning the elements to track. Values of
 *             inputs, selects and textareas with an id are saved and applied.
 *   dispatch  fire input/change on restored controls so the app recalculates
 *             (default true). Turn it off when an app recomputes everything
 *             itself and re-entrant handlers would undo the restore.
 *   save      () => extra state, stored alongside the controls.
 *   restore   (extra, state) => void, called once the controls are applied.
 *
 * Opening the page directly, outside the desktop, is a no-op: there is nobody
 * to report to and nothing to restore. */
(() => {
  /* Integrated apps are mounted into a shadow root and their scripts run in
   * the host document, so the root is published for the length of setup.
   * Iframe apps are an ordinary document talking to their parent. */
  const root = window.ClackOSMountRoot || document;
  const host = root === document ? null : root.host;
  const framed = !host && window.parent !== window;
  const connected = !!host || framed;

  const asArray = value => (Array.isArray(value) ? value : [...value]);

  function send(message) {
    if (host) host.dispatchEvent(new CustomEvent('clackos-message', {
      bubbles: true, composed: true, detail: message
    }));
    else if (framed) window.parent.postMessage(message, location.origin);
  }

  function onDesktopMessage(handler) {
    if (host) host.addEventListener('clackos-state-restore', event => handler(event.detail));
    else if (framed) window.addEventListener('message', event => {
      if (event.origin === location.origin) handler(event.data);
    });
  }

  function connect(options = {}) {
    if (!connected) return { report() {}, schedule() {} };

    const dispatch = options.dispatch !== false;
    const listControls = () => {
      if (typeof options.controls === 'function') return asArray(options.controls());
      if (!options.controls) return [];
      return [...root.querySelectorAll('input[id], select[id], textarea[id]')]
        /* file inputs cannot be set programmatically and passwords are never
         * something to write into storage or a link */
        .filter(el => el.type !== 'file' && el.type !== 'password');
    };

    const readControls = () => {
      const values = {};
      for (const el of listControls())
        values[el.id] = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
      return values;
    };

    const writeControls = values => {
      const touched = [];
      for (const el of listControls()) {
        if (!(el.id in values)) continue;
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!values[el.id];
        else el.value = values[el.id];
        touched.push(el);
      }
      /* values first, events afterwards: a handler that reads its siblings
       * then sees the whole restored form rather than a half-applied one */
      if (dispatch) for (const el of touched) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };

    const capture = () => {
      const state = {};
      if (options.controls) state.controls = readControls();
      if (options.save) {
        const extra = options.save();
        if (extra !== undefined) state.app = extra;
      }
      return state;
    };

    let reportTimer = 0;
    let applying = false;
    const report = () => {
      if (applying) return;
      send({ type: 'clackos-state', state: capture() });
    };
    const scheduleReport = () => {
      if (applying) return;
      clearTimeout(reportTimer);
      reportTimer = setTimeout(report, 300);
    };

    const apply = state => {
      if (!state || typeof state !== 'object') return;
      applying = true;
      try {
        if (options.controls && state.controls) writeControls(state.controls);
        if (options.restore) options.restore(state.app, state);
      } catch (error) {
        console.warn('Could not restore the saved app state:', error);
      } finally {
        applying = false;
      }
    };

    let restored = false;
    onDesktopMessage(message => {
      if (message?.type !== 'clackos-state-restore' || restored) return;
      restored = true;
      apply(message.state);
    });

    if (options.controls) {
      root.addEventListener('input', scheduleReport, true);
      root.addEventListener('change', scheduleReport, true);
    }
    window.addEventListener('pagehide', report);
    document.addEventListener('visibilitychange', () => { if (document.hidden) report(); });

    /* Ask for whatever this window was restored with. The desktop always
     * answers, with null when there is nothing saved. */
    send({ type: 'clackos-request-state' });

    return { report, schedule: scheduleReport, capture, apply };
  }

  window.ClackOSAppState = { connect, connected };
})();
