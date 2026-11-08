// Served from the app itself: the CSP allows no inline scripts.

// Sign-in links land on a page with a form; real browsers continue straight away, mail scanners do not run this.
const signIn = document.querySelector('form[data-auto-submit]');
if (signIn) signIn.submit();

// "Check your email" page: ask the server whether the link was opened (here, in the browser, or on
// another device), and continue as soon as it was. Checks again right away when the app comes back
// to the foreground, since phones pause background pages.
const waiting = document.querySelector('[data-wait-login]');
if (waiting) {
  const stopAt = Date.now() + 30 * 60 * 1000;
  const check = async () => {
    if (Date.now() > stopAt) return;
    try {
      const res = await fetch('/login/wait', { method: 'POST', credentials: 'same-origin' });
      const answer = res.ok ? await res.json() : {};
      if (answer.signedIn || answer.twoFactor) {
        location.href = answer.twoFactor ? '/login/2fa' : '/';
        return;
      }
    } catch {}
    setTimeout(check, 2500);
  };
  setTimeout(check, 2500);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
}

// City fields: suggest Canadian places as people type, from a list the app serves (no outside service).
// Loaded on first focus; anything else can still be typed.
document.querySelectorAll('input[data-places]').forEach((input, i) => {
  const load = async () => {
    input.removeEventListener('focus', load);
    try {
      const places = await (await fetch(input.dataset.places)).json();
      const list = document.createElement('datalist');
      list.id = `places-${i}`;
      for (const [name, province] of places) {
        const option = document.createElement('option');
        option.value = `${name}, ${province}`;
        list.append(option);
      }
      document.body.append(list);
      input.setAttribute('list', list.id);
    } catch {}
  };
  input.addEventListener('focus', load);
});

// Payout form: cash goes in round steps, so picking cash switches the amount to the most available in cash.
const payout = document.querySelector('form[data-payout-form]');
if (payout) {
  const method = payout.querySelector('select[name=method]');
  const amount = payout.querySelector('input[name=amount]');
  method.addEventListener('change', () => {
    amount.value = method.value === method.dataset.cashMethod ? amount.dataset.cashAvailable : amount.dataset.available;
  });
}

// Notifications page: subscribe this device to push, or turn it off again.
const pushBox = document.querySelector('[data-push-key]');
if (pushBox && 'serviceWorker' in navigator && 'PushManager' in window) {
  const button = pushBox.querySelector('[data-push-toggle]');
  const status = pushBox.querySelector('[data-push-status]');
  const toKey = (b64) => {
    const raw = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
  };
  const post = (path, body) =>
    fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const show = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    button.hidden = false;
    if (Notification.permission === 'denied') {
      status.textContent = 'Notifications are blocked for this site in your browser settings.';
      button.hidden = true;
    } else if (sub) {
      status.textContent = 'On for this device.';
      button.textContent = 'Turn off';
    } else {
      button.textContent = 'Turn on';
    }
  };
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await post('/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      } else if ((await Notification.requestPermission()) === 'granted') {
        const created = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(pushBox.dataset.pushKey) });
        await post('/push/subscribe', created.toJSON());
      }
    } catch (err) {
      status.textContent = 'Could not change notifications on this device.';
    }
    button.disabled = false;
    show();
  });
  show();
}
if ('setAppBadge' in navigator && document.querySelector('.bell') && !document.querySelector('.bell-count')) {
  navigator.clearAppBadge().catch(() => {});
}

// Install banner: only outside the installed app, and not again for 14 days after "Not now".
// Running as the installed app (any display mode other than a browser tab, or iOS home screen).
const runningInstalled =
  ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((m) => matchMedia(`(display-mode: ${m})`).matches) ||
  navigator.standalone === true ||
  document.referrer.startsWith('android-app://');
// Tell the server, so the install banner stops showing for this promoter on every device. The banner
// is only on the page while the server does not know yet, so this is sent once per promoter.
const rememberInstalled = () => fetch('/account/app-installed', { method: 'POST' }).catch(() => {});

const banner = document.querySelector('[data-install-banner]');
// Once per visit in the installed app, so this device shows as "Installed app" under Security.
let reported = false;
try {
  reported = sessionStorage.getItem('appReported') === '1';
  if (runningInstalled) sessionStorage.setItem('appReported', '1');
} catch {}
if (runningInstalled && !reported && document.querySelector('.bell')) rememberInstalled();
if (banner) {
  const installed = runningInstalled;
  let snoozed = false;
  try {
    snoozed = Number(localStorage.getItem('installSnoozedUntil') || 0) > Date.now();
  } catch {}
  if (!installed && !snoozed) {
    const button = banner.querySelector('[data-install-button]');
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let prompt = null;
    if (ios) {
      banner.querySelector('[data-install-ios]').hidden = false;
      banner.hidden = false;
    }
    // Chrome, Edge and Android offer their own install prompt; it is held until the button is pressed.
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      prompt = event;
      button.hidden = false;
      banner.hidden = false;
    });
    button.addEventListener('click', async () => {
      if (!prompt) return;
      prompt.prompt();
      await prompt.userChoice.catch(() => {});
      prompt = null;
      banner.hidden = true;
    });
    window.addEventListener('appinstalled', () => {
      banner.hidden = true;
      rememberInstalled();
    });
    banner.querySelector('[data-install-done]').addEventListener('click', () => {
      banner.hidden = true;
      rememberInstalled();
    });
    banner.querySelector('[data-install-dismiss]').addEventListener('click', () => {
      try {
        localStorage.setItem('installSnoozedUntil', String(Date.now() + 14 * 24 * 3600 * 1000));
      } catch {}
      banner.hidden = true;
    });
  }
}

// Menu: mark the current page; on phones, close the panel with Escape or after picking a page.
const sidebar = document.getElementById('sidebar');
if (sidebar) {
  const here = location.pathname;
  let best = null;
  for (const link of sidebar.querySelectorAll('a[href^="/"]:not(.nav-cta)')) {
    const path = new URL(link.href).pathname;
    const match = path === here || (path !== '/' && path !== '/admin' && here.startsWith(path + '/')) || (path === '/admin' && here.startsWith('/admin/promoters'));
    if (match && (!best || path.length > new URL(best.href).pathname.length)) best = link;
  }
  if (best) best.setAttribute('aria-current', 'page');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && location.hash === '#sidebar') history.back();
  });
}

// Promoter links: copy to the clipboard, or share through the phone's share sheet where there is one.
const copyText = async (text, button) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older browsers: copy from a temporary selection.
    const field = document.createElement('textarea');
    field.value = text;
    document.body.append(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
  // A second click while it says "Copied" keeps the original content to put back.
  if (button.classList.contains('copied')) return;
  const content = [...button.childNodes];
  button.textContent = 'Copied';
  button.classList.add('copied');
  setTimeout(() => {
    button.replaceChildren(...content);
    button.classList.remove('copied');
  }, 1600);
};
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-copy], [data-copy-text], [data-share]');
  if (!button) return;
  const field = button.closest('.link-field')?.querySelector('input');
  const text = button.dataset.copyText || button.dataset.shareUrl || field?.value;
  if (!text) return;
  if (button.matches('[data-share]')) {
    navigator.share({ title: button.dataset.shareTitle || document.title, url: text }).catch(() => {});
  } else {
    copyText(text, button);
  }
});
if (navigator.share) document.querySelectorAll('[data-share]').forEach((b) => (b.hidden = false));
document.querySelectorAll('.link-field input').forEach((input) => input.addEventListener('focus', () => input.select()));

// Account menu: close it when clicking elsewhere or pressing Escape.
const accountMenu = document.querySelector('.account-menu');
if (accountMenu) {
  document.addEventListener('click', (e) => {
    if (accountMenu.open && !accountMenu.contains(e.target)) accountMenu.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && accountMenu.open) {
      accountMenu.open = false;
      accountMenu.querySelector('summary').focus();
    }
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Index page editor: drag a row by its handle (mouse or finger), or focus the handle and use the up and
// down arrow keys. The new order is saved as soon as the row is dropped.
const sortable = document.querySelector('[data-sortable]');
if (sortable) {
  const status = document.querySelector('[data-sort-status]');
  const orderOf = () => [...sortable.children].map((row) => row.dataset.id).join(',');
  let saved = orderOf();
  // One save at a time, each sending the order as it is by then, so quick moves cannot land out of order.
  let queue = Promise.resolve();
  const save = () => (queue = queue.then(send));
  const send = async () => {
    const order = orderOf();
    if (order === saved) return;
    status.textContent = 'Saving…';
    try {
      const res = await fetch(sortable.dataset.sortable, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ order }),
      });
      if (!res.ok) throw new Error(String(res.status));
      saved = order;
      status.textContent = 'Order saved.';
    } catch {
      status.textContent = 'The order could not be saved. Reload the page and try again.';
    }
  };

  let dragging = null;
  let scroll = 0;
  const autoScroll = () => {
    if (!dragging || !scroll) return;
    window.scrollBy(0, scroll);
    requestAnimationFrame(autoScroll);
  };
  // Moving the row in the page drops its pointer capture, so the pointer is followed on the whole document.
  const move = (e) => {
    // Before the first row whose middle is below the pointer, or at the end.
    const before = [...sortable.children].find((row) => {
      if (row === dragging) return false;
      const box = row.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });
    if (before) {
      if (dragging.nextElementSibling !== before) sortable.insertBefore(dragging, before);
    } else if (sortable.lastElementChild !== dragging) sortable.appendChild(dragging);
    // Near the top or bottom of the screen, scroll so long lists can be reordered too.
    const edge = 60;
    const next = e.clientY < edge ? -8 : e.clientY > window.innerHeight - edge ? 8 : 0;
    if (next && !scroll) requestAnimationFrame(autoScroll);
    scroll = next;
  };
  const drop = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', drop);
    document.removeEventListener('pointercancel', drop);
    dragging.classList.remove('dragging');
    document.body.classList.remove('sorting');
    dragging = null;
    scroll = 0;
    save();
  };
  sortable.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-drag-handle]');
    if (!handle || e.button > 0 || dragging) return;
    e.preventDefault();
    dragging = handle.closest('li');
    dragging.classList.add('dragging');
    document.body.classList.add('sorting');
    // A short buzz on phones that have it, so a finger feels the row was picked up.
    if (e.pointerType === 'touch') navigator.vibrate?.(10);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', drop);
    document.addEventListener('pointercancel', drop);
  });
  sortable.addEventListener('keydown', (e) => {
    const handle = e.target.closest('[data-drag-handle]');
    if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const row = handle.closest('li');
    if (e.key === 'ArrowUp' && row.previousElementSibling) sortable.insertBefore(row, row.previousElementSibling);
    else if (e.key === 'ArrowDown' && row.nextElementSibling) sortable.insertBefore(row.nextElementSibling, row);
    handle.focus();
    save();
  });
}

// Promoters → Rules: checks the rule about a second after the last key, and shows its problems, the rule
// in words and the preview. Built with textContent only: nothing typed is ever read as HTML.
const ruleForm = document.querySelector('form[data-rule-editor]');
if (ruleForm) {
  const box = ruleForm.querySelector('[data-rule-text]');
  const test = ruleForm.querySelector('[data-rule-test]');
  const status = ruleForm.querySelector('[data-rule-status]');
  const panel = document.getElementById('rule-panel');
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const list = (items, cls) => {
    const ul = el('ul', undefined, cls);
    for (const item of items) ul.append(el('li', item));
    return ul;
  };
  const card = (title, ...children) => {
    const div = el('div', undefined, 'card');
    div.append(el('h3', title), ...children);
    return div;
  };
  const render = (answer) => {
    panel.replaceChildren();
    if (answer.error === 'rules_down') {
      panel.append(el('p', 'The rules engine is not available: the rule cannot be checked or saved right now.', 'flash error'));
      return;
    }
    if (answer.problems.length > 0) {
      panel.append(card('To fix', list(answer.problems.map((p) => `Line ${p.line}: ${p.message}`), 'rule-problems')));
      return;
    }
    if (answer.en.length === 0) return;
    const words = card('In words', list(answer.en));
    words.append(el('h3', 'En français'), list(answer.fr));
    const table = el('table');
    const head = el('tr');
    head.append(el('th', ''), el('th', 'Sold', 'num'), ...answer.outputs.map((o) => el('th', answer.labels[o] ?? o, 'num')));
    const thead = el('thead');
    thead.append(head);
    const tbody = el('tbody');
    for (const row of answer.preview) {
      const tr = el('tr', undefined, row.made_up ? 'made-up' : '');
      tr.append(el('td', row.label), el('td', String(row.tickets), 'num'), ...answer.outputs.map((o) => el('td', row.values[o] ?? '—', 'num')));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    const wrap = el('div', undefined, 'table-wrap');
    wrap.append(table);
    panel.append(words, card('Preview', wrap));
  };
  let timer;
  let asked = 0;
  const check = async () => {
    const mine = ++asked;
    status.hidden = false;
    try {
      const res = await fetch(ruleForm.dataset.check, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: box.value, test: test.value }),
      });
      const answer = await res.json();
      // An older answer arriving late never replaces a newer one.
      if (mine === asked) render(answer);
    } catch {
      // Offline or the page is going away: the server checks again on save.
    } finally {
      if (mine === asked) status.hidden = true;
    }
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(check, 1000);
  };
  box.addEventListener('input', later);
  test.addEventListener('input', later);
}

// Payouts & rewards: the rewards shop, by event. "+" adds one of a reward to the cart; each cart line
// then says exactly what it is and who it is for, and holds the choices: how many, "1 of them is for me",
// guest names, this event or the bank (or, for banked rewards, which event). The choices are written back
// to the fields in the reward's row, which is what the form sends. Without scripts, the "How many" boxes
// in the rows do the job.
const shop = document.querySelector('form[data-shop]');
if (shop) {
  const promoter = shop.dataset.promoter || 'you';
  const lines = shop.querySelector('[data-cart-lines]');
  const send = shop.querySelector('[data-cart-send]');
  const jump = shop.querySelector('[data-cart-jump]');
  const rows = [...shop.querySelectorAll('[data-shop-item]')].filter((row) => row.querySelector('[data-qty]'));
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
  };
  // + and − drawn as icons, so they sit in the middle of their round buttons.
  const icon = (d) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', d);
    svg.append(path);
    return svg;
  };
  const PLUS = 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z';
  const MINUS = 'M5 11h14v2H5z';
  const names = (value) => value.split(/[,;]+/).map((g) => g.trim()).filter(Boolean);
  // "1 for you + 1 for a guest (Ana)"
  const whoOf = (row, n) => {
    const me = row.querySelector('[data-me-field]');
    const forMe = me && me.value === '1' ? 1 : 0;
    const others = n - forMe;
    const guests = names(row.querySelector('[data-guests-field]')?.value ?? '');
    const parts = [];
    if (forMe) parts.push('1 for you');
    if (others > 0) parts.push(`${others} for ${others === 1 ? 'a guest' : 'guests'}${guests.length ? ` (${guests.join(', ')})` : ''}`);
    return parts.join(' + ');
  };
  const qtyOf = (row) => Number(row.querySelector('[data-qty]').value);
  const setQty = (row, n) => {
    const qty = row.querySelector('[data-qty]');
    qty.value = String(Math.max(0, Math.min(qty.options.length - 1, n)));
  };

  const lineFor = (row) => {
    const n = qtyOf(row);
    const kind = row.dataset.kind;
    const line = el('div', { class: 'cart-line' });
    const head = el('div', { class: 'cart-line-head' });
    head.append(el('strong', { text: `${n} × ${row.dataset.type}` }));
    if (row.dataset.where) head.append(el('span', { class: 'muted', text: ` · ${row.dataset.where}` }));
    line.append(head);

    const minus = el('button', { type: 'button', class: 'step', 'aria-label': `One less ${row.dataset.type}` }, icon(MINUS));
    const plus = el('button', { type: 'button', class: 'step', 'aria-label': `One more ${row.dataset.type}` }, icon(PLUS));
    const remove = el('button', { type: 'button', class: 'link', text: 'Remove' });
    minus.addEventListener('click', () => {
      setQty(row, n - 1);
      refresh();
    });
    plus.addEventListener('click', () => {
      setQty(row, n + 1);
      refresh();
    });
    plus.disabled = n >= row.querySelector('[data-qty]').options.length - 1;
    remove.addEventListener('click', () => {
      setQty(row, 0);
      refresh();
    });
    line.append(el('div', { class: 'cart-steps' }, minus, el('span', { class: 'cart-n', text: String(n) }), plus, remove));

    if (kind === 'event' || kind === 'bank') {
      const use = row.querySelector('[data-use-field]');
      const banking = use && use.value === 'bank';
      if (kind === 'bank') {
        const source = row.querySelector('[data-event-field]');
        const pick = el('select', { 'aria-label': 'For which event' });
        for (const option of source.options) pick.append(el('option', { value: option.value, text: option.text }));
        pick.value = source.value;
        pick.addEventListener('change', () => {
          source.value = pick.value;
        });
        line.append(el('label', { class: 'cart-field' }, 'For which event', pick));
      } else {
        const pick = el('select', { 'aria-label': 'Use them for' });
        pick.append(el('option', { value: '', text: `${row.dataset.where}` }), el('option', { value: 'bank', text: 'My bank, for a later event' }));
        pick.value = use.value;
        pick.addEventListener('change', () => {
          use.value = pick.value;
          refresh();
        });
        line.append(el('label', { class: 'cart-field' }, 'Use them for', pick));
      }
      if (!banking) {
        const me = row.querySelector('[data-me-field]');
        const box = el('input', { type: 'checkbox' });
        box.checked = me.value === '1';
        box.addEventListener('change', () => {
          me.value = box.checked ? '1' : '';
          refresh();
        });
        const strong = el('strong', { text: '1 of them is for me' });
        line.append(el('label', { class: 'check for-me' }, box, el('span', {}, strong, ` (${promoter})`)));
        if (n - (me.value === '1' ? 1 : 0) > 0) {
          const guestsField = row.querySelector('[data-guests-field]');
          const guests = el('input', { maxlength: '100', placeholder: 'Ana, Ben', value: guestsField.value });
          guests.addEventListener('input', () => {
            guestsField.value = guests.value;
            who.textContent = whoOf(row, qtyOf(row));
          });
          line.append(el('label', { class: 'cart-field' }, 'Guest names (optional)', guests));
        }
        const who = el('p', { class: 'who', text: whoOf(row, n) });
        line.append(who);
      } else {
        line.append(el('p', { class: 'who', text: `${n} into your bank, for a later event` }));
      }
    } else if (kind === 'merch') {
      const field = row.querySelector('[data-merch-field]');
      const details = el('input', { maxlength: '120', placeholder: 'T-shirt, size L', value: field.value, required: '' });
      details.addEventListener('input', () => {
        field.value = details.value;
      });
      line.append(el('label', { class: 'cart-field' }, 'Which item and size', details));
    }
    return line;
  };

  const refresh = () => {
    lines.replaceChildren();
    let total = 0;
    for (const row of rows) {
      const n = qtyOf(row);
      const max = row.querySelector('[data-qty]').options.length - 1;
      row.classList.toggle('in-cart', n > 0);
      // Round "+" while none are in the cart; then the pill (− n +) and "3/4 available".
      const add = row.querySelector('[data-add]');
      const stepper = row.querySelector('[data-stepper]');
      add.hidden = n > 0;
      stepper.hidden = n === 0;
      stepper.querySelector('[data-count]').textContent = String(n);
      stepper.querySelector('[data-plus]').disabled = n >= max;
      row.querySelector('[data-left]').textContent = String(max - n);
      row.querySelector('[data-of]').hidden = n === 0;
      if (!n) continue;
      total += n;
      lines.append(lineFor(row));
    }
    if (total === 0) lines.append(el('p', { class: 'muted', text: 'Press + next to a reward to add it here.' }));
    send.disabled = total === 0;
    send.textContent = total ? `Review my request (${total}) →` : 'Review my request →';
    if (jump) {
      jump.hidden = total === 0;
      jump.textContent = `View cart (${total})`;
    }
    if (total === 0) closeSheet();
  };

  // Phones: the cart is a sheet that slides up from the bottom (styles in .shop.sheet).
  const cart = shop.querySelector('[data-cart]');
  const backdrop = shop.querySelector('[data-cart-backdrop]');
  function openSheet() {
    cart.classList.add('open');
    backdrop.hidden = false;
    cart.querySelector('[data-cart-close]')?.focus();
  }
  function closeSheet() {
    if (!cart.classList.contains('open')) return;
    cart.classList.remove('open');
    backdrop.hidden = true;
  }
  shop.classList.add('sheet');
  jump?.addEventListener('click', openSheet);
  backdrop.addEventListener('click', closeSheet);
  shop.querySelector('[data-cart-close]')?.addEventListener('click', () => {
    closeSheet();
    jump?.focus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });

  for (const row of rows) {
    row.querySelector('[data-qty]').hidden = true;
    const add = row.querySelector('[data-add]');
    add.hidden = false;
    add.addEventListener('click', () => {
      setQty(row, qtyOf(row) + 1);
      refresh();
      row.querySelector('[data-plus]').focus();
    });
    row.querySelector('[data-plus]').addEventListener('click', () => {
      setQty(row, qtyOf(row) + 1);
      refresh();
    });
    row.querySelector('[data-minus]').addEventListener('click', () => {
      setQty(row, qtyOf(row) - 1);
      refresh();
      // Back to the round "+" at 0: keep the focus on the row.
      if (qtyOf(row) === 0) add.focus();
    });
  }
  refresh();
}

// Checkout: the team's note opens in a pop-up; "I understand" ticks the box needed to send.
const notice = document.querySelector('dialog[data-notice-modal]');
if (notice && typeof notice.showModal === 'function') {
  notice.showModal();
  notice.querySelector('[data-notice-ok]').addEventListener('click', () => {
    const ack = document.querySelector('[data-ack]');
    if (ack) ack.checked = true;
    notice.close();
  });
}
