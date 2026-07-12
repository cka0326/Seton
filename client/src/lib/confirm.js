// In-app replacement for window.confirm(). The Electron shell doesn't support
// the native blocking dialog — confirm() hangs the renderer without ever
// showing anything — so destructive actions await this promise-based modal
// instead. Plain DOM (no React) so any component can call it like confirm().
//
// Enter/Space activate the focused button (native behavior; Cancel holds the
// initial focus so the destructive path always takes a deliberate act);
// Escape, backdrop click, or Cancel resolve false.
export function confirmDialog(message, { confirmLabel = 'Delete' } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop confirm-backdrop';

    const box = document.createElement('div');
    box.className = 'confirm-box';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');

    const msg = document.createElement('p');
    msg.className = 'confirm-msg';
    msg.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'confirm-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.className = 'danger';
    okBtn.textContent = confirmLabel;
    actions.append(cancelBtn, okBtn);

    box.append(msg, actions);
    backdrop.append(box);

    const prevFocus = document.activeElement;
    const done = (result) => {
      window.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (prevFocus?.focus) prevFocus.focus();
      resolve(result);
    };
    // capture phase so Escape settles the dialog even though other global
    // handlers (canvas shortcuts etc.) also listen on window
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        done(false);
      } else if (e.key === 'Tab') {
        // two buttons — just bounce focus between them
        e.preventDefault();
        (document.activeElement === cancelBtn ? okBtn : cancelBtn).focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) done(false);
    });
    cancelBtn.addEventListener('click', () => done(false));
    okBtn.addEventListener('click', () => done(true));

    document.body.append(backdrop);
    cancelBtn.focus();
  });
}
