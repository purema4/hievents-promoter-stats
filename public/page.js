// Promoters' public pages: the share buttons. Opens the phone's share sheet where there is one,
// otherwise copies the link. No service worker and nothing stored: visitors are not app users.
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-share-page]');
  if (!button) return;
  const url = button.dataset.sharePage;
  if (navigator.share) {
    navigator.share({ title: button.dataset.shareTitle || document.title, url }).catch(() => {});
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    window.prompt('Copy this link', url);
    return;
  }
  const label = button.querySelector('span');
  if (!label || button.classList.contains('copied')) {
    button.classList.add('copied');
    setTimeout(() => button.classList.remove('copied'), 1600);
    return;
  }
  const before = label.textContent;
  label.textContent = 'Link copied';
  button.classList.add('copied');
  setTimeout(() => {
    label.textContent = before;
    button.classList.remove('copied');
  }, 1600);
});
