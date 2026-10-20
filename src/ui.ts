/** Tiny DOM / UX helpers. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text) n.textContent = text;
  return n;
}

export function toast(msg: string, ms = 2600): void {
  document.querySelectorAll('.rw-toast').forEach((t) => t.remove());
  const t = el('div', 'rw-toast', msg);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

/** Bottom sheet container. Returns {sheet, close}. */
export function openSheet(title: string): { sheet: HTMLElement; close: () => void } {
  const overlay = el('div', 'sheet-overlay');
  const sheet = el('div', 'sheet');
  const handle = el('div', 'sheet-handle');
  const head = el('div', 'sheet-head');
  head.append(handle, el('h2', '', title));
  const closeBtn = el('button', 'sheet-close', '✕');
  closeBtn.setAttribute('aria-label', 'Close');
  head.appendChild(closeBtn);
  const body = el('div', 'sheet-body');
  sheet.append(head, body);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 250);
  };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  requestAnimationFrame(() => overlay.classList.add('open'));
  return { sheet: body, close };
}

export async function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const { sheet, close } = openSheet('Please confirm');
    sheet.append(el('p', 'confirm-msg', message));
    const row = el('div', 'btn-row');
    const cancel = el('button', 'btn btn-ghost', 'Cancel');
    const ok = el('button', 'btn btn-danger', 'Confirm');
    cancel.addEventListener('click', () => {
      close();
      resolve(false);
    });
    ok.addEventListener('click', () => {
      close();
      resolve(true);
    });
    row.append(cancel, ok);
    sheet.appendChild(row);
  });
}
