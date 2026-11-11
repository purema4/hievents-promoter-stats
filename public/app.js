// Served from the app itself: the CSP allows no inline scripts.

// Wording in the page's language (the server sets <html lang>): t('Copied', 'Copié').
const fr = document.documentElement.lang === 'fr';
const t = (en, frText) => (fr ? frText : en);

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
const payout = document.querySelector('[data-payout-form]');
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
      status.textContent = t('Notifications are blocked for this site in your browser settings.', 'Les notifications sont bloquées pour ce site dans les paramètres de ton navigateur.');
      button.hidden = true;
    } else if (sub) {
      status.textContent = t('On for this device.', 'Activées sur cet appareil.');
      button.textContent = t('Turn off', 'Désactiver');
    } else {
      button.textContent = t('Turn on', 'Activer');
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
      status.textContent = t('Could not change notifications on this device.', 'Impossible de changer les notifications sur cet appareil.');
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
  // Accordions: each group stays the way it was left; the one holding the current page is always open.
  const store = (key, value) => {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch {
      return null;
    }
  };
  for (const group of sidebar.querySelectorAll('details[data-nav-group]')) {
    const key = `nav:${group.dataset.navGroup}`;
    if (!group.contains(best) && store(key) === 'closed') group.open = false;
    group.addEventListener('toggle', () => store(key, group.open ? 'open' : 'closed'));
  }
}
// Notices that can be closed stay closed on this device until their text changes.
for (const banner of document.querySelectorAll('[data-banner-key]')) {
  const key = banner.dataset.bannerKey;
  const close = banner.querySelector('[data-banner-close]');
  try {
    if (localStorage.getItem(key)) {
      banner.remove();
      continue;
    }
  } catch {}
  if (!close) continue;
  close.hidden = false;
  close.addEventListener('click', () => {
    try {
      localStorage.setItem(key, '1');
    } catch {}
    banner.remove();
  });
}
// The Advanced toggle comes back to this page.
for (const field of document.querySelectorAll('input[data-back-here]')) field.value = location.pathname + location.search;

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
  button.textContent = t('Copied', 'Copié');
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
// then says exactly what it is and who it is for, and holds the choices: how many, the names for a guest
// list (other rewards are tickets sent to the promoter), this event or the bank (or, for banked rewards,
// which event). The choices are written back
// to the fields in the reward's row, which is what the form sends. Without scripts, the "How many" boxes
// in the rows do the job.
const shop = document.querySelector('form[data-shop]');
if (shop) {
  const promoter = shop.dataset.promoter || t('you', 'toi');
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
  // "Sent to you (Maya Tremblay)", or for a guest list "On the guest list: Ana, Ben"
  const whoOf = (row) => {
    const field = row.querySelector('[data-guests-field]');
    if (!field) return t(`Sent to you (${promoter})`, `Envoyé à toi (${promoter})`);
    const guests = names(field.value);
    return guests.length
      ? t(`On the guest list: ${guests.join(', ')}`, `Sur la liste d’invités : ${guests.join(', ')}`)
      : t('Add the names for the guest list', 'Ajoute les noms pour la liste d’invités');
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

    const minus = el('button', { type: 'button', class: 'step', 'aria-label': t(`One less ${row.dataset.type}`, `Un de moins : ${row.dataset.type}`) }, icon(MINUS));
    const plus = el('button', { type: 'button', class: 'step', 'aria-label': t(`One more ${row.dataset.type}`, `Un de plus : ${row.dataset.type}`) }, icon(PLUS));
    const remove = el('button', { type: 'button', class: 'link', text: t('Remove', 'Retirer') });
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
        const pick = el('select', { 'aria-label': t('For which event', 'Pour quel événement') });
        for (const option of source.options) pick.append(el('option', { value: option.value, text: option.text }));
        pick.value = source.value;
        pick.addEventListener('change', () => {
          source.value = pick.value;
        });
        line.append(el('label', { class: 'cart-field' }, t('For which event', 'Pour quel événement'), pick));
      } else {
        const pick = el('select', { 'aria-label': t('Use them for', 'Les utiliser pour') });
        pick.append(el('option', { value: '', text: `${row.dataset.where}` }), el('option', { value: 'bank', text: t('Save them for a later event', 'Les garder pour un prochain événement') }));
        pick.value = use.value;
        pick.addEventListener('change', () => {
          use.value = pick.value;
          refresh();
        });
        line.append(el('label', { class: 'cart-field' }, t('Use them for', 'Les utiliser pour'), pick));
      }
      if (!banking) {
        const guestsField = row.querySelector('[data-guests-field]');
        const who = el('p', { class: 'who', text: whoOf(row) });
        if (guestsField) {
          const guests = el('input', { maxlength: '200', placeholder: n > 1 ? 'Ana, Ben' : 'Ana Roy', value: guestsField.value, required: '' });
          guests.addEventListener('input', () => {
            guestsField.value = guests.value;
            who.textContent = whoOf(row);
          });
          line.append(
            el(
              'label',
              { class: 'cart-field' },
              n > 1 ? t(`Names on the guest list (${n})`, `Noms sur la liste d’invités (${n})`) : t('Name on the guest list', 'Nom sur la liste d’invités'),
              guests,
            ),
          );
        }
        line.append(who);
      } else {
        line.append(el('p', { class: 'who', text: t(`${n} saved for a later event`, `${n} mis de côté pour un prochain événement`) }));
      }
    } else if (kind === 'merch') {
      const field = row.querySelector('[data-merch-field]');
      const details = el('input', { maxlength: '120', placeholder: t('T-shirt, size L', 'T-shirt, taille L'), value: field.value, required: '' });
      details.addEventListener('input', () => {
        field.value = details.value;
      });
      line.append(el('label', { class: 'cart-field' }, t('Which item and size', 'Quel article et quelle taille'), details));
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
      const inCart = row.querySelector('[data-in-cart]');
      inCart.hidden = n === 0;
      inCart.textContent = ` · ${n} ${inCart.dataset.label}`;
      if (!n) continue;
      total += n;
      lines.append(lineFor(row));
    }
    if (total === 0) lines.append(el('p', { class: 'muted', text: t('Press + next to a reward to add it here.', 'Appuie sur + à côté d’une récompense pour l’ajouter ici.') }));
    send.disabled = total === 0;
    send.textContent = total
      ? t(`Review my request (${total}) →`, `Revoir ma demande (${total}) →`)
      : t('Review my request →', 'Revoir ma demande →');
    if (jump) {
      const label = t(`View cart (${total})`, `Voir le panier (${total})`);
      const changed = jump.textContent !== label;
      jump.hidden = total === 0;
      jump.textContent = label;
      // A little bounce each time the cart changes, so the bar is seen.
      if (changed && total > 0) {
        jump.classList.remove('pop');
        void jump.offsetWidth;
        jump.classList.add('pop');
      }
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
    // The cart asks for guest list names; the box in the row is for when scripts do not run.
    const guestsField = row.querySelector('[data-guests-field]');
    if (guestsField) guestsField.hidden = true;
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
  // "Request →" on an event page: that reward is already in the cart, open and ready to review.
  const wanted = new URLSearchParams(location.search).get('add');
  const preset = wanted && rows.find((row) => row.querySelector('[data-qty]').name === `qty.${wanted}`);
  if (preset && qtyOf(preset) === 0) {
    setQty(preset, 1);
    refresh();
    history.replaceState(null, '', location.pathname + location.hash);
    openSheet();
  }
}

// Send a notification: picking a team or a promoter in a list also picks that choice.
for (const select of document.querySelectorAll('select[data-picks]')) {
  select.addEventListener('change', () => {
    const radio = select.form?.querySelector(`input[type=radio][value="${select.dataset.picks}"]`);
    if (radio && !radio.disabled) radio.checked = true;
  });
}

// Checkout: each reward's count as the shop's − n + pill, over the list underneath (sent with the form).
for (const box of document.querySelectorAll('[data-checkout-qty]')) {
  const select = box.querySelector('select');
  const max = select.options.length - 1;
  const svg = (d) => {
    const ns = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(ns, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', '20');
    icon.setAttribute('height', '20');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', d);
    icon.append(path);
    return icon;
  };
  const what = select.getAttribute('aria-label') || '';
  const minus = document.createElement('button');
  minus.type = 'button';
  minus.setAttribute('aria-label', t(`One less (${what})`, `Un de moins (${what})`));
  minus.append(svg('M5 11h14v2H5z'));
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.setAttribute('aria-label', t(`One more (${what})`, `Un de plus (${what})`));
  plus.append(svg('M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z'));
  const count = document.createElement('span');
  count.className = 'stepper-n';
  count.setAttribute('aria-live', 'polite');
  const pill = document.createElement('div');
  pill.className = 'stepper';
  pill.append(minus, count, plus);
  const line = box.closest('.checkout-line');
  const show = () => {
    const n = Number(select.value);
    count.textContent = String(n);
    minus.disabled = n <= 0;
    plus.disabled = n >= max;
    // At 0 the line stays, dimmed: it is left out of the request.
    line?.classList.toggle('off', n === 0);
  };
  const step = (by) => {
    select.value = String(Math.min(max, Math.max(0, Number(select.value) + by)));
    show();
  };
  minus.addEventListener('click', () => step(-1));
  plus.addEventListener('click', () => step(1));
  select.hidden = true;
  box.append(pill);
  show();
}
