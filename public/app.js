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
  sortable.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-drag-handle]');
    if (!handle || e.button > 0) return;
    e.preventDefault();
    dragging = handle.closest('li');
    dragging.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });
  sortable.addEventListener('pointermove', (e) => {
    if (!dragging) return;
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
  });
  const drop = () => {
    if (!dragging) return;
    dragging.classList.remove('dragging');
    dragging = null;
    scroll = 0;
    save();
  };
  sortable.addEventListener('pointerup', drop);
  sortable.addEventListener('pointercancel', drop);
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
