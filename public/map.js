// Promoter maps (admin dashboard, team pages): a heat map of where promoters are, by city. Tapping or
// clicking a place opens its promoters, as does opening it in the list under the map. Leaflet and its heat
// layer are loaded just before this file; the tiles come from OpenStreetMap. Served from the app itself:
// the CSP allows no inline scripts.
const box = document.querySelector('[data-promoter-map]');
if (box && window.L) {
  const points = JSON.parse(box.dataset.promoterMap);
  const touch = L.Browser.mobile;
  // On phones one finger scrolls the page (two fingers pinch to zoom and move the map), so the map never
  // traps the page; the buttons zoom too.
  const map = L.map(box, { scrollWheelZoom: false, dragging: !touch, tapTolerance: 20 });
  // The attribution OpenStreetMap asks for; no Leaflet prefix (its flag icon carries inline styles).
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    // The app sends no referrer by default; OpenStreetMap's tile servers require one (the origin is enough).
    referrerPolicy: 'strict-origin-when-cross-origin',
  }).addTo(map);
  const most = Math.max(...points.map((p) => p.people.length));
  L.heatLayer(
    points.map((p) => [p.lat, p.lng, p.people.length]),
    { radius: 30, blur: 22, max: most, minOpacity: 0.35, maxZoom: 12 },
  ).addTo(map);

  const places = new Map([...document.querySelectorAll('.map-place[data-place]')].map((d) => [d.dataset.place, d]));
  const plural = (n) => (n === 1 ? '1 promoter' : `${n} promoters`);

  // Built as elements, not HTML, so names show as typed; links only to the app's own pages.
  const popupFor = (p) => {
    const box = document.createElement('div');
    box.className = 'map-popup';
    const title = document.createElement('strong');
    title.textContent = `${p.label} · ${plural(p.people.length)}`;
    const list = document.createElement('ul');
    for (const person of p.people) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.textContent = person.name;
      if (person.href.startsWith('/') && !person.href.startsWith('//')) link.href = person.href;
      item.append(link);
      list.append(item);
    }
    box.append(title, list);
    return box;
  };

  const markers = new Map();
  for (const p of points) {
    const marker = L.circleMarker([p.lat, p.lng], {
      radius: touch ? 11 : 8,
      weight: 2,
      color: '#ffffff',
      fillColor: '#1b1b1a',
      fillOpacity: 0.35,
    })
      .bindPopup(popupFor(p), { maxWidth: 260, minWidth: 160, autoPanPadding: [16, 16] })
      .addTo(map);
    if (!touch) {
      const tip = document.createElement('span');
      tip.textContent = `${p.label} · ${plural(p.people.length)}`;
      marker.bindTooltip(tip, { direction: 'top' });
    }
    // Opening a place on the map marks it in the list too.
    marker.on('popupopen', () => {
      places.forEach((d) => d.classList.toggle('selected', d.dataset.place === p.label));
    });
    marker.on('popupclose', () => places.get(p.label)?.classList.remove('selected'));
    markers.set(p.label, marker);
  }

  // Opening a place in the list shows it on the map.
  places.forEach((details, label) => {
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      const marker = markers.get(label);
      if (!marker) return;
      map.setView(marker.getLatLng(), Math.max(map.getZoom(), 9));
      marker.openPopup();
    });
  });

  map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])).pad(0.3), { maxZoom: 10 });
}
