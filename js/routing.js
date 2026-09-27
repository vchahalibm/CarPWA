'use strict';
/* ============================================================
   Routing, place search and nearby places.
   Every provider returns the same normalised shape so the rest of
   the app never cares where the data came from.

   Route = {
     provider, coords: [[lat, lon]…], cum: [m…], tcum: [s…],
     distance (m), duration (s), trafficDelay (s | null),
     segLimit: [km/h | null per segment],
     steps: [{ at (m along route), icon, text, street }]
   }
   ============================================================ */
const Routing = (() => {
  const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';
  const TOMTOM_URL = 'https://api.tomtom.com/routing/1/calculateRoute/';
  const PHOTON_URL = 'https://photon.komoot.io/api/';
  const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

  const R = 6371000, toRad = d => d * Math.PI / 180;
  function dist(a, b) {
    const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const cumulative = coords => coords.reduce((acc, p, i) => (acc.push(i ? acc[i - 1] + dist(coords[i - 1], p) : 0), acc), []);

  async function getJSON(url, opts = {}, ms = 12000) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(timer); }
  }

  /* ---------- Instruction text ---------- */
  const ORD = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  function iconFor(modifier, type) {
    if (type === 'arrive') return 'flag';
    if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') return 'roundabout';
    if (type === 'merge') return 'merge';
    return ({ 'uturn': 'uturn', 'sharp right': 'turnRight', 'right': 'turnRight', 'slight right': 'slightRight',
      'straight': 'straight', 'slight left': 'slightLeft', 'left': 'turnLeft', 'sharp left': 'turnLeft' })[modifier] || 'straight';
  }
  function osrmStep(s) {
    const m = s.maneuver || {}, type = m.type, mod = m.modifier || 'straight';
    const street = s.name || s.ref || '';
    const onto = street ? ` onto ${street}` : '';
    const side = mod.includes('left') ? 'left' : mod.includes('right') ? 'right' : '';
    const turn = { 'uturn': 'Make a U-turn', 'sharp right': 'Turn sharp right', 'right': 'Turn right', 'slight right': 'Bear right',
      'straight': 'Continue straight', 'slight left': 'Bear left', 'left': 'Turn left', 'sharp left': 'Turn sharp left' }[mod] || 'Continue';
    let text;
    switch (type) {
      case 'depart': text = `Head out${street ? ' on ' + street : ''}`; break;
      case 'arrive': text = 'Arrive at your destination'; break;
      case 'merge': text = `Merge${side ? ' ' + side : ''}${onto}`; break;
      case 'on ramp': text = `Take the ramp${side ? ' on the ' + side : ''}${onto}`; break;
      case 'off ramp': text = `Take the exit${side ? ' on the ' + side : ''}${onto}`; break;
      case 'fork': text = `Keep ${side || 'straight'}${onto}`; break;
      case 'roundabout': case 'rotary': case 'roundabout turn':
        text = m.exit ? `At the roundabout, take the ${ORD(m.exit)} exit${onto}` : `Enter the roundabout${onto}`; break;
      case 'continue': text = mod === 'straight' ? `Continue${street ? ' on ' + street : ''}` : turn + onto; break;
      default: text = turn + onto; // turn, end of road, new name, notification
    }
    return { icon: iconFor(mod, type), text, street: street || (type === 'arrive' ? 'Destination' : '') };
  }

  /* ---------- OSRM (free, no key, no live traffic) ---------- */
  async function osrm(from, to) {
    const url = `${OSRM_URL}${from.lon},${from.lat};${to.lon},${to.lat}` +
      '?overview=full&geometries=geojson&steps=true&annotations=duration,maxspeed&alternatives=false';
    const j = await getJSON(url);
    if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.message || 'No route');
    const rt = j.routes[0], leg = rt.legs[0];
    const coords = rt.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    const cum = cumulative(coords);
    // Per-segment travel time gives an accurate "time left" at any point along the route.
    const segDur = leg.annotation?.duration;
    let tcum;
    if (segDur && segDur.length === coords.length - 1) tcum = segDur.reduce((a, d, i) => (a.push(a[i] + d), a), [0]);
    else tcum = cum.map(d => d / cum.at(-1) * rt.duration);
    const segLimit = (leg.annotation?.maxspeed || []).map(m => m && m.speed ? (m.unit === 'mph' ? m.speed * 1.609344 : m.speed) : null);
    let at = 0;
    const steps = leg.steps.map(s => { const st = { at, ...osrmStep(s) }; at += s.distance; return st; });
    return { provider: 'osrm', coords, cum, tcum, distance: rt.distance, duration: rt.duration, trafficDelay: null, segLimit, steps };
  }

  /* ---------- TomTom (live traffic; needs a free API key) ---------- */
  const TT = {
    ARRIVE: 'flag', ARRIVE_LEFT: 'flag', ARRIVE_RIGHT: 'flag', DEPART: 'straight', STRAIGHT: 'straight', FOLLOW: 'straight',
    KEEP_RIGHT: 'slightRight', BEAR_RIGHT: 'slightRight', TURN_RIGHT: 'turnRight', SHARP_RIGHT: 'turnRight',
    KEEP_LEFT: 'slightLeft', BEAR_LEFT: 'slightLeft', TURN_LEFT: 'turnLeft', SHARP_LEFT: 'turnLeft',
    MAKE_UTURN: 'uturn', TRY_MAKE_UTURN: 'uturn', ENTER_MOTORWAY: 'merge', ENTER_FREEWAY: 'merge', ENTER_HIGHWAY: 'merge',
    ENTRANCE_RAMP: 'merge', TAKE_EXIT: 'slightRight', MOTORWAY_EXIT_LEFT: 'slightLeft', MOTORWAY_EXIT_RIGHT: 'slightRight',
    ROUNDABOUT_CROSS: 'roundabout', ROUNDABOUT_RIGHT: 'roundabout', ROUNDABOUT_LEFT: 'roundabout', ROUNDABOUT_BACK: 'roundabout',
  };
  async function tomtom(from, to, key) {
    const url = `${TOMTOM_URL}${from.lat},${from.lon}:${to.lat},${to.lon}/json?key=${encodeURIComponent(key)}` +
      '&traffic=true&travelMode=car&routeType=fastest&instructionsType=text&language=en-US&sectionType=speedLimit&routeRepresentation=polyline';
    const j = await getJSON(url);
    const rt = j.routes?.[0]; if (!rt) throw new Error('No route');
    const coords = rt.legs.flatMap(l => l.points.map(p => [p.latitude, p.longitude]));
    const cum = cumulative(coords), total = cum.at(-1), sum = rt.summary;
    const ins = rt.guidance?.instructions || [];
    // Instruction offsets carry cumulative travel time (traffic-aware); interpolate between them.
    const marks = ins.map(i => [i.routeOffsetInMeters, i.travelTimeInSeconds]).filter(m => m[0] != null && m[1] != null);
    if (!marks.length || marks[0][0] > 0) marks.unshift([0, 0]);
    if (marks.at(-1)[0] < total) marks.push([total, sum.travelTimeInSeconds]);
    let k = 0;
    const tcum = cum.map(d => {
      while (k < marks.length - 2 && marks[k + 1][0] < d) k++;
      const [d0, t0] = marks[k], [d1, t1] = marks[k + 1];
      return d1 > d0 ? t0 + (t1 - t0) * (d - d0) / (d1 - d0) : t0;
    });
    const segLimit = new Array(Math.max(0, coords.length - 1)).fill(null);
    for (const s of rt.sections || []) if (s.sectionType === 'SPEED_LIMIT' && s.maxSpeedLimitInKmh)
      for (let i = s.startPointIndex; i < s.endPointIndex && i < segLimit.length; i++) segLimit[i] = s.maxSpeedLimitInKmh;
    const steps = ins.map(i => ({
      at: i.routeOffsetInMeters || 0, icon: TT[i.maneuver] || 'straight',
      text: (i.message || '').replace(/<[^>]+>/g, '') || 'Continue',
      street: i.street || i.roadNumbers?.[0] || (/^ARRIVE/.test(i.maneuver) ? 'Destination' : ''),
    }));
    if (!steps.length || steps.at(-1).icon !== 'flag') steps.push({ at: total, icon: 'flag', text: 'Arrive at your destination', street: 'Destination' });
    return { provider: 'tomtom', coords, cum, tcum, distance: sum.lengthInMeters, duration: sum.travelTimeInSeconds,
      trafficDelay: sum.trafficDelayInSeconds ?? null, segLimit, steps };
  }

  /* ---------- Offline fallback: a path with rough timing ---------- */
  function approx(path, destName) {
    const coords = path.map(p => [...p]), cum = cumulative(coords), total = cum.at(-1), v = 13;
    const steps = [{ at: 0, icon: 'straight', text: 'Head out', street: '' }];
    if (total > 600) steps.push({ at: total * 0.3, icon: 'turnRight', text: 'Turn right', street: '' },
      { at: total * 0.7, icon: 'turnLeft', text: 'Turn left', street: '' });
    steps.push({ at: total, icon: 'flag', text: 'Arrive at your destination', street: destName || 'Destination' });
    return { provider: 'approx', coords, cum, tcum: cum.map(d => d / v), distance: total, duration: total / v,
      trafficDelay: null, segLimit: [], steps };
  }

  /** Best available route: TomTom when a key is set, else OSRM. Throws when every provider fails. */
  async function route(from, to, opts = {}) {
    if (opts.provider === 'tomtom' && opts.tomtomKey) {
      try { return await tomtom(from, to, opts.tomtomKey); } catch (e) { console.warn('TomTom routing failed, falling back to OSRM', e); }
    }
    return osrm(from, to);
  }

  /* ---------- Place search (Photon, OpenStreetMap data) ---------- */
  async function search(q, near) {
    const u = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=8&lang=en` + (near ? `&lat=${near.lat.toFixed(4)}&lon=${near.lon.toFixed(4)}` : '');
    const j = await getJSON(u, {}, 8000);
    return (j.features || []).map((f, i) => {
      const p = f.properties || {}, [lon, lat] = f.geometry.coordinates;
      const street = [p.housenumber, p.street].filter(Boolean).join(' ');
      const sub = [street !== p.name ? street : '', p.city || p.county, p.state].filter(Boolean).join(', ');
      return { id: 'ph' + (p.osm_id || i), name: p.name || street || 'Dropped pin', sub: sub || p.country || '', lat, lon, icon: 'pin', color: '#ff375f', remote: true };
    });
  }

  /* ---------- Nearby places by category (Overpass, OpenStreetMap data) ---------- */
  const OSM_CAT = {
    'Gas': '["amenity"="fuel"]', 'Parking': '["amenity"="parking"]', 'EV Chargers': '["amenity"="charging_station"]',
    'Coffee': '["amenity"="cafe"]', 'Food': '["amenity"~"^(restaurant|fast_food)$"]',
  };
  async function nearby(cat, near, radius = 3000) {
    const q = `[out:json][timeout:15];nwr${OSM_CAT[cat]}(around:${radius},${near.lat},${near.lon});out center 40;`;
    const j = await getJSON(OVERPASS_URL, { method: 'POST', body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 15000);
    return (j.elements || []).map(e => {
      const t = e.tags || {}, lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
      const addr = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
      return { id: 'op' + e.id, name: t.name || t.brand || t.operator || cat, sub: addr || cat, lat, lon, remote: true };
    }).filter(p => p.lat != null);
  }

  return { route, osrm, tomtom, approx, search, nearby, cumulative, dist };
})();
