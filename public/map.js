// Promoter maps (admin dashboard, team pages): where promoters are, by city, as a heat map with a pin per
// place showing its number of promoters. Tapping or clicking a place opens its promoters, as does opening it in the list under the map. Leaflet and its heat
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

  // Each place is a pin with its number of promoters, coloured by tier (the legend under the map uses the
  // same tiers). Places closer than a pin's width are merged into one pin with their total; zooming in
  // splits them again.
  const tier = (n) => (n >= 10 ? 4 : n >= 5 ? 3 : n >= 2 ? 2 : 1);
  const size = touch ? 34 : 28;
  const pinFor = (count) => {
    // An element, not an HTML string: the CSP allows no inline styles, and the number is plain text.
    const pin = document.createElement('span');
    pin.textContent = count > 999 ? '999+' : String(count);
    return L.divIcon({ html: pin, className: `map-pin tier-${tier(count)}`, iconSize: [size, size] });
  };

  // Several places in one pin: the list of places, each with its count. Tapping the pin zooms in first.
  const groupPopup = (group) => {
    const box = document.createElement('div');
    box.className = 'map-popup';
    const title = document.createElement('strong');
    title.textContent = `${group.places.length} places · ${plural(group.count)}`;
    const list = document.createElement('ul');
    for (const p of group.places) {
      const item = document.createElement('li');
      item.textContent = `${p.label} · ${p.people.length}`;
      list.append(item);
    }
    box.append(title, list);
    return box;
  };

  const layer = L.layerGroup().addTo(map);
  let markers = new Map();
  const render = () => {
    layer.clearLayers();
    markers = new Map();
    const zoom = map.getZoom();
    const groups = [];
    // Biggest places first, so they anchor the groups.
    for (const p of [...points].sort((a, b) => b.people.length - a.people.length)) {
      const at = map.project([p.lat, p.lng], zoom);
      const near = groups.find((g) => g.at.distanceTo(at) < size * 1.4);
      if (near) {
        near.places.push(p);
        near.count += p.people.length;
      } else groups.push({ at, places: [p], count: p.people.length });
    }
    for (const group of groups) {
      // Placed at the middle of its places, weighted by their promoters.
      const lat = group.places.reduce((sum, p) => sum + p.lat * p.people.length, 0) / group.count;
      const lng = group.places.reduce((sum, p) => sum + p.lng * p.people.length, 0) / group.count;
      const single = group.places.length === 1 ? group.places[0] : null;
      const name = single ? single.label : `${group.places[0].label} and ${group.places.length - 1} more`;
      const marker = L.marker([lat, lng], { icon: pinFor(group.count), title: `${name} · ${plural(group.count)}`, riseOnHover: true })
        .bindPopup(single ? popupFor(single) : groupPopup(group), { maxWidth: 260, minWidth: 160, autoPanPadding: [16, 16] })
        .addTo(layer);
      if (!touch) {
        const tip = document.createElement('span');
        tip.textContent = `${name} · ${plural(group.count)}`;
        marker.bindTooltip(tip, { direction: 'top', offset: [0, -size / 2] });
      }
      if (!single) {
        // Zoom in to split the pin; once it cannot split any further, show its places.
        marker.on('click', () => {
          const bounds = L.latLngBounds(group.places.map((p) => [p.lat, p.lng]));
          if (map.getZoom() < map.getMaxZoom() && map.getBoundsZoom(bounds.pad(0.5)) > map.getZoom()) {
            marker.closePopup();
            map.fitBounds(bounds.pad(0.5));
          }
        });
      }
      // Opening a place on the map marks it in the list too.
      marker.on('popupopen', () => {
        const labels = new Set(group.places.map((p) => p.label));
        places.forEach((d) => d.classList.toggle('selected', labels.has(d.dataset.place)));
      });
      marker.on('popupclose', () => places.forEach((d) => d.classList.remove('selected')));
      for (const p of group.places) markers.set(p.label, single ? marker : null);
    }
  };
  map.on('zoomend', render);

  // Opening a place in the list shows it on the map, zoomed in until it has a pin of its own.
  places.forEach((details, label) => {
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      const p = points.find((x) => x.label === label);
      if (!p) return;
      map.once('moveend', () => markers.get(label)?.openPopup());
      map.setView([p.lat, p.lng], Math.max(map.getZoom(), 9));
    });
  });

  map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])).pad(0.3), { maxZoom: 10 });
  render();
}
