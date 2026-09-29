'use strict';
/* ============================================================
   Dashboard: instrument-cluster styles, map + stack, and an editable
   widget grid. Every reading comes from something the phone really
   knows (GPS, route, motion sensors, clock, weather, player). Nothing
   about the car itself (gear, rpm, tyres) is shown, because a phone
   can't read it. Loaded after modes.js; uses app.js globals.
   ============================================================ */

/* ---------- Sensors: phone tilt, G-force and altitude history ---------- */
const Sensors = {
  live: false, roll: 0, pitch: 0, gx: 0, gy: 0, peakRoll: 0, peakPitch: 0, alt: [],
  zero: store.get('tiltZero', { roll: 0, pitch: 0 }),
  async enable() {
    const E = window.DeviceMotionEvent?.requestPermission ? DeviceMotionEvent : window.DeviceOrientationEvent;
    try { if (typeof E?.requestPermission === 'function' && await E.requestPermission() !== 'granted') throw new Error('denied'); }
    catch { toast('Motion access is off. Allow it for this site in Safari settings'); return; }
    this.listen(); store.set('motionOn', true); Dash.update(true);
  },
  listen() {
    if (this.listening) return;
    this.listening = true;
    addEventListener('deviceorientation', e => {
      if (e.beta == null || e.gamma == null) return;
      const b = rad(e.beta), g = rad(e.gamma), a = rad(screen.orientation?.angle ?? window.orientation ?? 0);
      const u = [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];  // world up in device coords
      const sx = u[0] * Math.cos(a) - u[1] * Math.sin(a), sy = u[0] * Math.sin(a) + u[1] * Math.cos(a); // in screen coords
      const roll = deg(Math.atan2(sx, sy)) - this.zero.roll, pitch = deg(Math.asin(Math.max(-1, Math.min(1, u[2])))) - this.zero.pitch;
      this.roll += (roll - this.roll) * 0.2; this.pitch += (pitch - this.pitch) * 0.2;
      this.peakRoll = Math.max(this.peakRoll, Math.abs(this.roll)); this.peakPitch = Math.max(this.peakPitch, Math.abs(this.pitch));
      this.raw = { roll: roll + this.zero.roll, pitch: pitch + this.zero.pitch };
      this.live = true;
    });
    addEventListener('devicemotion', e => {
      const acc = e.acceleration; if (!acc || acc.x == null) return;
      const a = rad(screen.orientation?.angle ?? window.orientation ?? 0);
      const lat = (acc.x * Math.cos(a) - acc.y * Math.sin(a)) / 9.81, lon = -acc.z / 9.81; // phone upright, facing the driver
      this.gx += (lat - this.gx) * 0.1; this.gy += (lon - this.gy) * 0.1;
    });
  },
  zeroTilt() {
    if (!this.raw) return toast('Turn on motion sensors first');
    this.zero = { ...this.raw }; store.set('tiltZero', this.zero);
    this.roll = this.pitch = this.peakRoll = this.peakPitch = 0; toast('Level set');
  },
  sampleAlt() {
    if (loc.alt == null || loc.source === 'none') return;
    this.alt.push(loc.alt); if (this.alt.length > 90) this.alt.shift(); // 90 × 20 s = 30 min
  },
};
setInterval(() => Sensors.sampleAlt(), 20000);
if (store.get('motionOn') && !window.DeviceMotionEvent?.requestPermission) Sensors.listen(); // iPhone needs a tap each visit

/* ---------- SVG gauge toolkit (0° = up, clockwise) ---------- */
const G = {
  pt: (c, r, a) => [c + r * Math.sin(rad(a)), c - r * Math.cos(rad(a))],
  arc(c, r, a0, a1) {
    const [x0, y0] = G.pt(c, r, a0), [x1, y1] = G.pt(c, r, a1);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  },
  ticks(c, r, len, a0, a1, n, cls = 'tk') {
    let s = '';
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n, [x0, y0] = G.pt(c, r, a), [x1, y1] = G.pt(c, r - len, a);
      s += `<line class="${cls}" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`;
    }
    return s;
  },
  labels(c, r, a0, a1, vals, cls = 'lb') {
    return vals.map((v, i) => { const [x, y] = G.pt(c, r, a0 + (a1 - a0) * i / (vals.length - 1));
      return `<text class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${v}</text>`; }).join('');
  },
};
const speedMax = () => imperial() ? 140 : 220;

/* Ring gauge: thin track, glowing value arc, big number in the middle. */
function ring({ val = 'speedF', big = 'speed', unit = 'unit', sub = '', subHtml = '', cls = '' }) {
  return `<div class="ring ${cls}"><svg viewBox="0 0 200 200" aria-hidden="true">
      ${G.ticks(100, 96, 5, -135, 135, 54, 'tk faint')}
      <path class="trk" d="${G.arc(100, 84, -135, 135)}"/>
      <path class="val" pathLength="100" d="${G.arc(100, 84, -135, 135)}" data-arc="${val}"/></svg>
    <div class="ring-c"><b class="num" data-t="${big}"></b><span data-t="${unit}"></span>${sub ? `<small data-t="${sub}"></small>` : ''}${subHtml}</div></div>`;
}
/* Analog dial with needle and numerals. */
function dial({ max = speedMax(), step = imperial() ? 20 : 40, minor = 4, val = 'speedRot', big = 'speed', unit = 'unit', sub = '' }) {
  const labels = []; for (let v = 0; v <= max; v += step) labels.push(v);
  return `<div class="dial"><svg viewBox="0 0 240 240" aria-hidden="true">
      <circle class="bezel" cx="120" cy="120" r="116"/>
      ${G.ticks(120, 108, 5, -135, 135, max / step * minor, 'tk')}${G.ticks(120, 108, 12, -135, 135, max / step, 'tk major')}
      ${G.labels(120, 82, -135, 135, labels)}
      <g class="needle" data-rot="${val}"><line x1="120" y1="132" x2="120" y2="26"/><circle cx="120" cy="120" r="7"/></g></svg>
    <div class="dial-c"><b class="num" data-t="${big}"></b><span data-t="${unit}"></span>${sub ? `<small data-t="${sub}"></small>` : ''}</div></div>`;
}
/* Small needle gauge (sub-dial): 240° sweep with end labels and a readout. */
function sdial({ val, labels = ['', ''], text = '', sub = '' }) {
  return `<div class="sdial"><svg viewBox="0 0 200 200" aria-hidden="true">
      <circle class="bezel" cx="100" cy="100" r="96"/>${G.ticks(100, 88, 6, -120, 120, 24, 'tk')}${G.ticks(100, 88, 12, -120, 120, 4, 'tk major')}
      ${G.labels(100, 66, -120, 120, labels, 'lb end')}
      <g class="needle" data-rot="${val}"><line x1="100" y1="112" x2="100" y2="30"/><circle cx="100" cy="100" r="7"/></g></svg>
    <div class="sdial-c">${text ? `<b data-t="${text}"></b>` : ''}${sub ? `<small>${sub}</small>` : ''}</div></div>`;
}
function clockFace(numbers = true) {
  return `<svg viewBox="0 0 200 200" class="clockface" aria-hidden="true">
    ${G.ticks(100, 94, 5, 0, 354, 59, 'tk faint')}${G.ticks(100, 94, 11, 0, 330, 11, 'tk major')}
    ${numbers ? G.labels(100, 70, 30, 360, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'lb big') : ''}
    <g class="hand h" data-rot="clockH"><line x1="100" y1="106" x2="100" y2="52"/></g>
    <g class="hand m" data-rot="clockM"><line x1="100" y1="108" x2="100" y2="24"/></g>
    <g class="hand s" data-rot="clockS"><line x1="100" y1="118" x2="100" y2="18"/></g><circle class="pin" cx="100" cy="100" r="4"/></svg>`;
}
function compassFace() {
  return `<svg viewBox="0 0 200 200" class="compass" aria-hidden="true"><g data-rot="compassRot">
      ${G.ticks(100, 94, 6, 0, 355, 71, 'tk faint')}${G.ticks(100, 94, 12, 0, 330, 11, 'tk')}
      ${G.labels(100, 72, 0, 270, ['N', 'E', 'S', 'W'], 'lb card')}</g>
    <path class="lubber" d="M100 4l7 14h-14z"/></svg>`;
}
function gMeter() {
  return `<svg viewBox="0 0 200 200" class="gmeter" aria-hidden="true">
    <circle class="trk" cx="100" cy="100" r="90"/><circle class="trk faint" cx="100" cy="100" r="60"/><circle class="trk faint" cx="100" cy="100" r="30"/>
    <line class="tk faint" x1="10" y1="100" x2="190" y2="100"/><line class="tk faint" x1="100" y1="10" x2="100" y2="190"/>
    <circle class="gdot" cx="100" cy="100" r="9" data-tf="gDot"/></svg>`;
}
/* Tick strip that slides under a fixed marker: heading in degrees. */
function tape() {
  let s = '';
  for (let d = -360; d <= 720; d += 10) {
    const n = ((d % 360) + 360) % 360, lab = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n] ?? (n % 30 === 0 ? n + '°' : '');
    s += `<i class="${n % 30 ? '' : 'maj'}" style="left:${(d + 360) * 3}px">${lab ? `<em>${lab}</em>` : ''}</i>`;
  }
  return `<div class="tape"><div class="tape-strip" data-tf="tapeX">${s}</div><b class="tape-mark"></b></div>`;
}
const bars = (key, cls = '') => `<div class="tbar ${cls}"><i data-w="${key}"></i></div>`;           // tick "barcode" bar
const line = (key, cls = '') => `<div class="lbar ${cls}"><i data-w="${key}"></i></div>`;           // smooth progress bar
const CAR_REAR = '<path d="M-34 14v-18c0-6 3-9 8-11l6-15c1-3 4-5 7-5h26c3 0 6 2 7 5l6 15c5 2 8 5 8 11v18z"/><rect x="-34" y="12" width="12" height="10" rx="3"/><rect x="22" y="12" width="12" height="10" rx="3"/><path class="glass" d="M-17-28h34l5 13h-44z"/>';
const CAR_SIDE = '<path d="M-44 10v-10c0-5 3-8 8-9l12-3 12-12c2-2 5-3 8-3h18c4 0 7 2 9 5l7 10 10 2c4 1 6 4 6 8v12z"/><circle cx="-26" cy="12" r="8"/><circle cx="26" cy="12" r="8"/><path class="glass" d="M-8-21l-9 10h22v-12h-8zM9-23v12h17l-7-10c-1-1-2-2-4-2z"/>';
function tiltGauge(which) {
  const car = which === 'roll' ? CAR_REAR : CAR_SIDE;
  return `<div class="tilt"><svg viewBox="-100 -100 200 200" aria-hidden="true">
      ${G.ticks(0, 90, 12, -70, 70, 28, 'tk acc')}
      <g class="tilt-car" data-rot="${which}Rot"><g transform="translate(0 14) scale(1.55)">${car}</g></g></svg></div>`;
}

/* ---------- Live values, recomputed on every GPS/demo tick ---------- */
const CARD_FULL = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' };
function currentStreet() {
  const v = nav?.view; if (!v) return '';
  const past = nav.route.steps.filter(s => s.at <= v.along + 5);
  return past.at(-1)?.street || '';
}
function vals() {
  const none = loc.source === 'none', v = speedVal(loc.speed), max = speedMax(), lim = settings.speedLimit ? limitVal() : null;
  const h = loc.heading || 0, s = navSummary(), now = new Date(), w = wx || mockWeather(), [cond, wic] = wxInfo(w.cur.code);
  const altM = loc.alt, altStr = altM == null || none ? '—' : imperial() ? Math.round(altM * 3.28084).toLocaleString() : Math.round(altM).toLocaleString();
  const sec = now.getSeconds(), min = now.getMinutes() + sec / 60, hr = (now.getHours() % 12) + min / 60;
  const other = imperial() ? `${Math.round(loc.speed * 3.6)} km/h` : `${Math.round(loc.speed * 2.23694)} mph`;
  const ev = EVENTS.filter(e => +e.at > Date.now() - 15 * 60e3);
  const tiltOk = Sensors.live, gMag = Math.hypot(Sensors.gx, Sensors.gy);
  const altRange = Sensors.alt.length ? [Math.min(...Sensors.alt), Math.max(...Sensors.alt)] : null;
  return {
    speed: none ? '—' : v, unit: speedUnit(), speedF: Math.min(1, v / max), speedRot: -135 + 270 * Math.min(1, v / max), other: none ? '' : other,
    limit: lim ?? '', hasLimit: lim != null, limitTxt: lim != null ? `Limit ${lim}` : 'No limit data', limitF: lim ? Math.min(1, v / lim) : 0,
    over: lim != null && v > lim,
    hdg: none ? '—' : Math.round(h) + '°', card: none ? '—' : cardinal(h), cardFull: none ? 'no heading' : CARD_FULL[cardinal(h)],
    hdgLine: none ? 'No location' : `${Math.round(h)}° ${cardinal(h)}`, tapeX: `translateX(${-(h + 360) * 3}px)`, compassRot: -h,
    clockH: hr * 30, clockM: min * 6, clockS: sec * 6, time: fmtClock(now).replace(/\s?[AP]M/i, ''), ampm: (fmtClock(now).match(/[AP]M/i) || [''])[0],
    date: now.toLocaleDateString([], { month: 'short', day: 'numeric' }), weekday: now.toLocaleDateString([], { weekday: 'long' }), dayNum: now.getDate(),
    secF: sec / 60,
    alt: altStr, altUnit: imperial() ? 'ft' : 'm', altF: altRange && altRange[1] > altRange[0] ? (altM - altRange[0]) / (altRange[1] - altRange[0]) : 0.5,
    tripDist: distStr(trip.dist).replace(/^(50|10) (ft|m)$/, trip.dist < 5 ? '0 $2' : '$&'), tripTime: fmtDur((Date.now() - trip.start) / 1000),
    avg: `${speedVal(trip.moving ? trip.dist / trip.moving : 0)} ${speedUnit()}`, maxSp: `${speedVal(trip.max)} ${speedUnit()}`,
    nav: !!s, noNav: !s, turnIcon: svg(s ? s.icon : 'search'), turnDist: s ? s.dist : 'Where to?', turnText: s ? s.text : 'Search a place or pick a favourite',
    eta: s ? s.eta : '--:--', left: s ? s.left : '—', remain: s ? s.remain : '—', prog: s ? s.progress : 0, street: currentStreet(), hasStreet: !!currentStreet(),
    dest: nav?.dest?.name || '',
    progLabel: s ? `${Math.round(s.progress * 100)}% driven` : 'No route',
    temp: Math.round(w.cur.temp) + '°', cond, wicon: svg(wic), hilo: `H:${Math.round(w.daily[0].hi)}°  L:${Math.round(w.daily[0].lo)}°`,
    place: loc.source === 'demo' ? DEMO_CITY.name : 'My Location',
    ev1: ev[0] ? `${fmtClock(ev[0].at)} · ${ev[0].title}` : 'No more events today', ev1loc: ev[0]?.loc || '',
    ev2: ev[1] ? `${fmtClock(ev[1].at)} · ${ev[1].title}` : '', ev2loc: ev[1]?.loc || '', evMore: ev.length > 2 ? `${ev.length - 2} more…` : '',
    tiltOk, tiltOff: !tiltOk, roll: tiltOk ? `${Math.round(Sensors.roll)}°` : '—', pitch: tiltOk ? `${Math.round(Sensors.pitch)}°` : '—',
    rollRot: tiltOk ? Math.max(-60, Math.min(60, Sensors.roll)) : 0, pitchRot: tiltOk ? Math.max(-60, Math.min(60, -Sensors.pitch)) : 0,
    rollMax: `Max ${Math.round(Sensors.peakRoll)}°`, pitchMax: `Max ${Math.round(Sensors.peakPitch)}°`,
    gDot: `translate(${Math.max(-80, Math.min(80, Sensors.gx * 160))}px,${Math.max(-80, Math.min(80, -Sensors.gy * 160))}px)`,
    gMag: tiltOk ? gMag.toFixed(2) + ' g' : '— g',
    src: { gps: 'GPS', demo: 'DEMO', none: 'OFF' }[loc.source], gpsCls: loc.source, moving: loc.speed > 1 ? 'Driving' : 'Parked',
    elev: elevBars(),
    // Chronograph: speed dial tops out lower so every 10 gets a numeral; sub-dials sweep −120…120°.
    speedRotC: -135 + 270 * Math.min(1, v / (imperial() ? 120 : 200)),
    progRot: -120 + 240 * (s ? s.progress : 0), leftRot: -120 + 240 * (s ? 1 - s.progress : 0),
    altRot: -120 + 240 * (altRange && altRange[1] > altRange[0] ? (altM - altRange[0]) / (altRange[1] - altRange[0]) : 0.5),
    tempRot: -120 + 240 * Math.max(0, Math.min(1, imperial() ? (w.cur.temp - 14) / 99 : (w.cur.temp + 10) / 55)),
    moveRot: -120 + 240 * Math.min(1, v / (imperial() ? 80 : 130)),
    leftBig: s ? s.left : '—',
  };
}
function elevBars() {
  const a = Sensors.alt; if (a.length < 2) return '<div class="empty">Collecting altitude…</div>';
  const lo = Math.min(...a), hi = Math.max(...a), span = Math.max(3, hi - lo);
  return `<svg viewBox="0 0 ${a.length * 4} 60" preserveAspectRatio="none">${a.map((v, i) => { const h = 6 + (v - lo) / span * 52;
    return `<rect x="${i * 4}" y="${60 - h}" width="2.4" height="${h}" rx="1"/>`; }).join('')}</svg>`;
}

/* ---------- Cluster styles (each one fills the same frame differently) ---------- */
const CLUSTERS = {
  twin: { name: 'Twin Dials', accent: 'cyan', map3d: true, html: () => `<div class="cl cl-twin">
      <div class="pane">${ring({ sub: 'other' })}</div>
      <div class="pane map-pane"><div class="map-slot"></div></div>
      <div class="pane">${ring({ val: 'prog', big: 'card', unit: 'hdg', sub: 'tripDist' })}</div></div>` },
  arc: { name: 'Arc', accent: 'khaki', html: () => `<div class="cl cl-arc">
      <div class="pane">${ring({ cls: 'thick', subHtml: '<small class="lim" data-t="limitTxt"></small>' })}</div>
      <div class="pane trip"><h4 data-show="noNav">Trip</h4><h4 data-show="nav">Route</h4>
        <div class="rows" data-show="noNav">
          <div class="r">${svg('pin')}<span>Distance</span><b data-t="tripDist"></b></div>
          <div class="r">${svg('clock')}<span>Time</span><b data-t="tripTime"></b></div>
          <div class="r">${svg('gauge')}<span>Average</span><b data-t="avg"></b></div>
          <div class="r">${svg('bolt')}<span>Top speed</span><b data-t="maxSp"></b></div></div>
        <div class="rows" data-show="nav">
          <div class="r">${svg('flag')}<span>Arrival</span><b data-t="eta"></b></div>
          <div class="r">${svg('clock')}<span>Time left</span><b data-t="left"></b></div>
          <div class="r">${svg('pin')}<span>To go</span><b data-t="remain"></b></div>
          <div class="r"><span data-html="turnIcon"></span><span data-t="turnText"></span><b data-t="turnDist"></b></div></div></div>
      <div class="pane">${ring({ cls: 'thick', val: 'prog', big: 'card', unit: 'hdg', subHtml: '<small><span data-t="alt"></span> <span data-t="altUnit"></span> elevation</small>' })}</div></div>` },
  analog: { name: 'Analog', accent: 'red', html: () => `<div class="cl cl-analog">
      <div class="pane subs"><div class="sub big">${gMeter()}<small data-t="gMag"></small></div>
        <div class="sub">${clockFace(false)}</div><div class="sub">${compassFace()}<small data-t="hdg"></small></div></div>
      <div class="pane">${dial({ sub: 'limitTxt' })}</div>
      <div class="pane subs"><div class="sub big">${ring({ val: 'prog', big: 'left', unit: 'progLabel', cls: 'txt' })}</div>
        <div class="sub txt"><b data-t="alt"></b><span data-t="altUnit"></span><small>elevation</small></div>
        <div class="sub txt"><b data-t="temp"></b><small data-t="cond"></small></div></div></div>` },
  bars: { name: 'Bars', accent: 'yellow', html: () => `<div class="cl cl-bars">
      <div class="pane"><div class="bigrow"><b class="num" data-t="speed"></b><span data-t="unit"></span></div>${line('speedF', 'y')}
        <div class="row2">${svg('gauge')}<b data-t="limitTxt"></b></div>${line('limitF', 't')}</div>
      <div class="pane">${tape()}<div class="row2 r"><b data-t="hdgLine"></b></div>
        <div class="row2"><b data-t="time"></b><b data-t="date"></b></div>${bars('secF', 'y')}</div>
      <div class="pane"><div class="bigrow bdg"><em class="pill" data-t="src"></em><b data-t="moving"></b></div>${line('prog', 'y')}
        <div class="row2"><span data-t="progLabel"></span><b data-t="remain"></b></div>${line('altF', 't dot')}
        <div class="row2"><span>Elevation</span><b><span data-t="alt"></span> <span data-t="altUnit"></span></b></div></div></div>` },
  chrono: { name: 'Chronograph', accent: 'orange', html: () => `<div class="cl cl-chrono">
      <div class="pane subs3"><div class="sub big">${gMeter()}<small data-t="gMag"></small></div>
        <div class="sub">${clockFace(false)}</div>
        <div class="sub">${sdial({ val: 'altRot', labels: ['L', 'H'], text: 'alt', sub: 'elev.' })}</div>
        <div class="sub">${compassFace()}<small data-t="hdg"></small></div></div>
      <div class="pane">${dial({ max: imperial() ? 120 : 200, step: imperial() ? 10 : 20, minor: 5, val: 'speedRotC' })}</div>
      <div class="pane subs3"><div class="sub big">${sdial({ val: 'progRot', labels: ['0', '100'], text: 'leftBig', sub: 'time left' })}</div>
        <div class="sub">${sdial({ val: 'moveRot', labels: ['', ''], text: 'moving' })}</div>
        <div class="sub">${sdial({ val: 'tempRot', labels: ['C', 'H'], text: 'temp', sub: 'outside' })}</div>
        <div class="sub">${sdial({ val: 'leftRot', labels: ['E', 'F'], text: 'remain', sub: 'to go' })}</div></div></div>` },
  band: { name: 'Band', accent: 'wine', html: () => `<div class="cl cl-band"><div class="band">
      <div class="band-l"><div class="limit-slot" data-limit></div><b class="num" data-t="speed"></b><span data-t="unit"></span>
        <div class="row2"><span>${svg('flag')}</span>${line('prog')}<b data-t="remain"></b></div></div>
      <div class="band-c">${clockFace()}</div>
      <div class="band-r"><div class="np-meta"><div class="np-title" data-np="title"></div><div class="np-artist" data-np="artist"></div></div>
        <div class="bar" data-np="barwrap"><i data-np="bar"></i></div><div class="times"><span data-np="elapsed"></span><span data-np="remain"></span></div>
        <div class="art" data-np="art" data-open="music"></div></div></div></div>` },
  telltale: { name: 'Telltale', accent: 'magenta', html: () => `<div class="cl cl-tell">
      <div class="tells"><span class="tt" data-cls="gpsCls">${svg('locate')}</span><span class="tt nav" data-cls="nav">${svg('maps')}</span>
        <span class="tt warn" data-cls="over">${svg('gauge')}</span><span class="tt-temp" data-t="temp"></span>
        <span class="tt turn" data-show="nav" data-html="turnIcon"></span><span class="tt-dist" data-t="turnDist" data-show="nav"></span></div>
      <div class="pane">${ring({ subHtml: '<div class="limit-slot" data-limit></div>' })}</div>
      <div class="pane mid"><div class="bigrow"><b class="num" data-t="hdg"></b><span data-t="cardFull"></span></div>${tape()}</div>
      <div class="pane mid"><div class="bigrow" data-show="nav"><b class="num" data-t="remain"></b><span>to go</span></div>
        <div class="bigrow" data-show="noNav"><b class="num" data-t="alt"></b><span data-t="altUnit"></span></div>
        <div class="seg3" data-show="nav">${line('prog')}</div><div class="seg3" data-show="noNav">${line('altF')}</div>
        <div class="row2 lbls"><span data-show="nav">driven</span><span data-show="nav" data-t="left"></span><span data-show="noNav">elevation, last 30 min</span></div></div></div>` },
  mapfirst: { name: 'Map First', accent: 'cyan', map3d: true, html: () => `<div class="cl cl-mapfirst">
      <div class="map-slot"></div>
      <div class="pills"><div class="gp"><span data-html="turnIcon"></span>${bars('prog')}<b data-t="remain"></b></div>
        <div class="gp big"><b class="num" data-t="speed"></b><span data-t="unit"></span><div class="limit-slot" data-limit></div></div>
        <div class="gp"><b data-t="card"></b>${bars('speedF')}<b data-t="eta"></b></div></div></div>` },
};

/* ---------- Widgets ---------- */
const W = {
  speed: { name: 'Speed', html: () => `<h5>Speed</h5>${ring({ sub: 'limitTxt' })}` },
  trip: { name: 'Current Trip', html: () => `<h5>Current Trip</h5><div class="rows">
      <div class="r"><span>Distance</span><b data-t="tripDist"></b></div><div class="r"><span>Time</span><b data-t="tripTime"></b></div>
      <div class="r"><span>Avg. speed</span><b data-t="avg"></b></div><div class="r"><span>Top speed</span><b data-t="maxSp"></b></div></div>` },
  route: { name: 'Route', html: () => `<h5>Route</h5><div class="routew" data-show="nav"><div class="w-big num" data-t="left"></div><div class="w-sub"><span data-t="remain"></span> · arrive <span data-t="eta"></span></div>
      ${line('prog', 'acc')}<div class="w-sub" data-t="dest"></div></div>
      <button class="w-cta" data-show="noNav" data-action="where">${svg('search')}Where to?</button>` },
  turn: { name: 'Next Turn', html: () => `<div class="turnw" data-open="maps"><span data-html="turnIcon"></span><b data-t="turnDist"></b><span class="w-sub" data-t="turnText"></span></div>` },
  weather: { name: 'Weather', html: () => `<div data-open="weather" class="wxw"><h5 data-t="place"></h5><div class="w-huge num" data-t="temp"></div>
      <div class="w-sub"><span data-html="wicon"></span><span data-t="cond"></span></div><div class="w-sub" data-t="hilo"></div></div>` },
  calendar: { name: 'Calendar', html: () => `<div class="calw" data-open="calendar"><h5 class="acc" data-t="weekday"></h5><div class="w-huge num" data-t="dayNum"></div>
      <div class="ev e1"><b data-t="ev1"></b><span data-t="ev1loc"></span></div><div class="ev e2"><b data-t="ev2"></b><span data-t="ev2loc"></span></div>
      <div class="w-sub" data-t="evMore"></div></div>` },
  clock: { name: 'Clock', html: () => `<div class="clockw">${clockFace()}</div>` },
  nowPlaying: { name: 'Now Playing', html: () => `<div class="npw"><div class="art" data-np="art" data-open="music"></div>
      <div class="np-title" data-np="title"></div><div class="np-artist" data-np="artist"></div>
      <div class="np-controls"><button class="ctl" data-player="prev" aria-label="Previous"></button><button class="ctl main" data-player="toggle" aria-label="Play/Pause"></button><button class="ctl" data-player="next" aria-label="Next"></button></div></div>` },
  heading: { name: 'Heading', html: () => `<h5>Heading</h5><div class="w-big num" data-t="hdg"></div><div class="w-sub" data-t="cardFull"></div>${tape()}` },
  compass: { name: 'Compass', html: () => `<div class="compw">${compassFace()}<b class="num" data-t="card"></b></div>` },
  roll: { name: 'Roll', html: () => `<h5 class="acc">Roll <b data-t="roll"></b></h5>${tiltGauge('roll')}<div class="w-sub c" data-t="rollMax"></div>
      <button class="w-cta sm" data-show="tiltOff" data-dash="motion">Enable motion</button>` },
  pitch: { name: 'Pitch', html: () => `<h5 class="acc">Pitch <b data-t="pitch"></b></h5>${tiltGauge('pitch')}<div class="w-sub c" data-t="pitchMax"></div>
      <button class="w-cta sm" data-show="tiltOff" data-dash="motion">Enable motion</button>` },
  elevation: { name: 'Elevation', html: () => `<h5 class="acc">Elevation</h5><div class="w-big num"><span data-t="alt"></span> <small data-t="altUnit"></small></div>
      <div class="elev" data-html="elev"></div><div class="w-sub sp"><span>30 min ago</span><span>Now</span></div>` },
  gforce: { name: 'G-Force', html: () => `<h5 class="acc">G-Force <b data-t="gMag"></b></h5><div class="gw">${gMeter()}</div>
      <button class="w-cta sm" data-show="tiltOff" data-dash="motion">Enable motion</button>` },
};
const DEFAULT_WIDGETS = ['trip', 'weather', 'calendar', 'clock', 'nowPlaying', 'roll', 'pitch', 'elevation'];

/* ---------- Layouts & rendering ---------- */
const LAYOUTS = [['cluster', 'Cluster', 'gauge'], ['map', 'Map', 'maps'], ['widgets', 'Widgets', 'grid']];
const ACCENTS = { cyan: '#35c8ff', magenta: '#d63cff', red: '#ff3b30', orange: '#ff7a1a', khaki: '#a89f86', yellow: '#e8e03a', wine: '#b0306a', green: '#30d158' };

const Dash = {
  editing: false, bound: [], wrap: $('#dashMapWrap'),
  get layout() { return settings.dashLayout || 'cluster'; },
  get style() { return CLUSTERS[settings.cluster] ? settings.cluster : 'twin'; },
  widgets() { return (store.get('widgets', DEFAULT_WIDGETS)).filter(id => W[id]); },
  /** Widget columns either side of the cluster: { left: [ids], right: [ids] }. */
  sides() { const s = store.get('clusterSides', { left: [], right: [] }); return { left: (s.left || []).filter(id => W[id]), right: (s.right || []).filter(id => W[id]) }; },
  size(where, id) { const z = store.get('wsizes', {})[`${where}.${id}`]; return Array.isArray(z) ? z : [1, 1]; },
  setSize(where, id, wh) { const z = store.get('wsizes', {}); z[`${where}.${id}`] = wh; store.set('wsizes', z); },
  /** One widget card; `where` is 'grid' or a cluster side. Edit mode adds move/remove buttons and a resize handle. */
  card(id, i, list, where) {
    const [w, h] = this.size(where, id), name = W[id].name, flip = svg('back').replace('<svg', '<svg style="transform:scaleX(-1)"');
    const up = svg('back').replace('<svg', '<svg style="transform:rotate(90deg)"'), down = svg('back').replace('<svg', '<svg style="transform:rotate(-90deg)"');
    let edit = '';
    if (this.editing && where === 'grid') edit = `<div class="wg-edit"><button data-dash="left:${id}" aria-label="Move ${name} earlier" ${i ? '' : 'disabled'}>${svg('back')}</button>
        <button class="x" data-dash="remove:${id}" aria-label="Remove ${name}">${svg('close')}</button>
        <button data-dash="right:${id}" aria-label="Move ${name} later" ${i < list.length - 1 ? '' : 'disabled'}>${flip}</button></div>`;
    else if (this.editing) edit = `<div class="wg-edit two"><button data-dash="sup:${where}:${id}" aria-label="Move ${name} up" ${i ? '' : 'disabled'}>${up}</button>
        <button class="x" data-dash="sremove:${where}:${id}" aria-label="Remove ${name}">${svg('close')}</button>
        <button data-dash="sdown:${where}:${id}" aria-label="Move ${name} down" ${i < list.length - 1 ? '' : 'disabled'}>${down}</button>
        <button data-dash="sswap:${where}:${id}" aria-label="Move ${name} to the other side">${where === 'left' ? flip : svg('back')}</button></div>`;
    if (this.editing) edit += `<div class="wg-rs ${where === 'grid' ? '' : 'v'}" data-rs="${where}:${id}" role="button" aria-label="Drag to resize ${name}">${svg('resize')}</div>`;
    const style = where === 'grid' ? `grid-column:span ${w};grid-row:span ${h}` : `flex-grow:${h}`;
    return `<div class="wg w-${id}" data-wid="${id}" data-cw="${w}" data-ch="${h}" style="${style}">${W[id].html()}${edit}</div>`;
  },

  show() { this.render(); },
  render() {
    const root = $('#dashRoot'); if (!root) return;
    document.documentElement.dataset.accent = settings.accent || CLUSTERS[this.style].accent;
    let html, map3d = false;
    if (this.layout === 'cluster') {
      const sides = this.sides(), col = s => sides[s].length || this.editing ? `<div class="cl-side" data-side="${s}">
          ${sides[s].map((id, i, a) => this.card(id, i, a, s)).join('')}
          ${this.editing ? `<button class="wg add" data-dash="add:${s}">${svg('plus')}<span>Add</span></button>` : ''}</div>` : '';
      html = `<div class="cl-wrap">${col('left')}<div class="cl-main">${CLUSTERS[this.style].html()}</div>${col('right')}</div>`;
      map3d = !!CLUSTERS[this.style].map3d;
    }
    else if (this.layout === 'map') html = `<div class="mapstack">
        <div class="ms-map"><div class="map-slot"></div>
          <div class="ms-turn" data-show="nav" data-open="maps"><span data-html="turnIcon"></span><div><b data-t="turnDist"></b><span data-t="turnText"></span></div></div>
          <div class="ms-street" data-show="hasStreet" data-t="street"></div>
          <div class="ms-eta" data-show="nav"><div><b data-t="eta"></b><span>arrival</span></div><div><b data-t="left"></b><span>left</span></div><div><b data-t="remain"></b><span>to go</span></div></div>
          <div class="ms-speed"><div class="limit-slot" data-limit></div><div class="speed-pill" data-speed-pill><b data-speed>0</b><span data-speed-unit>mph</span></div></div></div>
        <div class="ms-side"><div class="wg">${W.turn.html()}<div class="ms-favs" data-show="noNav">
            <button class="big-btn" data-go="home">${svg('house')}Home</button><button class="big-btn" data-go="work">${svg('briefcase')}Work</button></div></div>
          <div class="wg">${W.nowPlaying.html()}</div></div></div>`;
    else html = `<div class="wgrid ${this.editing ? 'editing' : ''}">${this.widgets().map((id, i, a) => this.card(id, i, a, 'grid')).join('')}
        ${this.editing ? `<button class="wg add" data-cw="1" data-ch="1" data-dash="add:grid">${svg('plus')}<span>Add widget</span></button>` : ''}</div>`;
    $('#mapPark').appendChild(this.wrap); // keep the one shared map alive across re-renders
    root.className = 'dash-root lay-' + this.layout + (this.layout === 'cluster' ? ' st-' + this.style : '') + (this.editing ? ' with-bar editing' : '');
    root.innerHTML = html;
    this.placeMap(map3d);
    this.renderBar();
    this.bound = $$('[data-t],[data-arc],[data-rot],[data-w],[data-tf],[data-show],[data-html],[data-cls]', root);
    shownLimit = ''; renderLimit(); updateSpeedUI(); updatePlayerUI();
    this.update(true);
    this.fitGrid(); Bar.show();
  },
  /** Pick the column count and row height so every widget (with its spans) fits the visible screen; scroll only when cells would get too small. */
  fitGrid() {
    const g = $('#dashRoot .wgrid'); if (!g) return;
    const items = [...g.children], W = g.clientWidth, H = g.clientHeight, gap = 12;
    const spans = items.map(el => [+el.dataset.cw || 1, +el.dataset.ch || 1]);
    const area = spans.reduce((a, [w, h]) => a + w * h, 0);
    const apply = cols => items.forEach((el, k) => el.style.gridColumn = `span ${Math.min(spans[k][0], cols)}`);
    let best = null;
    g.style.gridAutoRows = '10px';
    for (let cols = 1; cols <= Math.max(1, area); cols++) {
      const cw = (W - gap * (cols - 1)) / cols; if (cw < 96) break;
      g.style.gridTemplateColumns = `repeat(${cols},minmax(0,1fr))`; apply(cols);
      const rows = getComputedStyle(g).gridTemplateRows.split(' ').length; // rows the dense packing actually used
      const rh = (H - gap * (rows - 1)) / rows;
      if (cw / rh > 2.6 || rh / cw > 1.9) continue; // keep cells card-shaped
      const score = Math.min(cw, rh);
      if (!best || score > best.score) best = { cols, rh, score };
    }
    if (best && best.score >= 104) {
      g.style.gridTemplateColumns = `repeat(${best.cols},minmax(0,1fr))`; apply(best.cols);
      g.style.gridAutoRows = `${Math.floor(best.rh)}px`; g.dataset.cols = best.cols; g.classList.add('fit');
    } else { // too many to fit: fixed-size cells that scroll
      const cols = Math.max(1, Math.floor((W + gap) / (170 + gap)));
      g.style.gridTemplateColumns = `repeat(${cols},minmax(0,1fr))`; apply(cols); g.style.gridAutoRows = '170px'; g.dataset.cols = cols; g.classList.remove('fit');
    }
  },
  placeMap(map3d) {
    const slot = $('#dashRoot .map-slot');
    if (slot) slot.appendChild(this.wrap);
    maps.dash.threeD = !!(slot && map3d);
    if (!slot) return;
    ensureMap('dash');
    if (maps.dash.map) { requestAnimationFrame(() => { maps.dash.map.resize(); apply3D(maps.dash); updateMaps({ force: true, instant: true }); }); }
  },
  renderBar() {
    $('#dashBar').innerHTML = `<div class="seg-pill">${LAYOUTS.map(([id, name, ic]) =>
      `<button class="${id === this.layout ? 'on' : ''}" data-dash="layout:${id}" aria-label="${name} layout">${svg(ic)}<span>${name}</span></button>`).join('')}</div>
      ${this.layout !== 'map' ? `<button class="bar-btn ${this.editing ? 'on' : ''}" data-dash="edit">${this.editing ? 'Done' : 'Edit'}</button>` : ''}
      <button class="bar-btn icon" data-action="assistant" aria-label="Voice commands">${svg('mic')}</button>
      <button class="bar-btn icon" data-dash="customize" aria-label="Customize">${svg('sliders')}</button>
      <button class="bar-btn icon ${settings.dockHidden ? 'on' : ''}" data-dash="dock" aria-label="${settings.dockHidden ? 'Show' : 'Hide'} the side dock">${svg('expand')}</button>`;
  },
  update(force) {
    if (current !== 'dashboard' && !force) return;
    const V = vals();
    for (const el of this.bound) {
      const d = el.dataset;
      if (d.t) set(el, 't', V[d.t] ?? '', v => el.textContent = v);
      if (d.arc) set(el, 'arc', Math.max(0, Math.min(1, V[d.arc] || 0)).toFixed(3), v => { el.style.strokeDasharray = `${v * 100} 101`; el.style.opacity = v > 0.002 ? 1 : 0; });
      if (d.rot) set(el, 'rot', (+V[d.rot] || 0).toFixed(1), v => el.style.transform = `rotate(${v}deg)`);
      if (d.w) set(el, 'w', Math.max(0, Math.min(1, V[d.w] || 0)).toFixed(3), v => el.style.width = (v * 100) + '%');
      if (d.tf) set(el, 'tf', V[d.tf], v => el.style.transform = v);
      if (d.show) set(el, 'show', !!V[d.show], v => el.hidden = !v);
      if (d.html) set(el, 'html', V[d.html] ?? '', v => el.innerHTML = v);
      if (d.cls) set(el, 'cls', String(V[d.cls]), v => { el.classList.remove('gps', 'demo', 'none', 'on'); el.classList.add(v === 'true' ? 'on' : v); });
    }
    function set(el, k, v, apply) { const key = '_' + k; if (el[key] !== v) { el[key] = v; apply(v); } }
  },
  cmd(v) {
    const [c, arg, arg2] = v.split(':');
    const sides = this.sides(), saveSides = () => { store.set('clusterSides', sides); this.render(); };
    if (c === 'layout') { settings.dashLayout = arg; this.editing = false; store.set('settings', settings); this.render(); }
    else if (c === 'edit') { this.editing = !this.editing; this.render(); }
    else if (c === 'customize') this.customize();
    else if (c === 'dock') { settings.dockHidden = !settings.dockHidden; store.set('settings', settings); applyDock(); this.renderBar(); }
    else if (c === 'style') { settings.cluster = arg; settings.accent = CLUSTERS[arg].accent; settings.dashLayout = 'cluster'; store.set('settings', settings); this.render(); this.customize(); }
    else if (c === 'accent') { settings.accent = arg; store.set('settings', settings); this.render(); this.customize(); }
    else if (c === 'motion') Sensors.enable();
    else if (c === 'level') Sensors.zeroTilt();
    else if (c === 'add') this.addSheet(arg || 'grid');
    else if (c === 'adds') { sides[arg].push(arg2); saveSides(); }
    else if (c === 'sremove') { sides[arg] = sides[arg].filter(id => id !== arg2); saveSides(); }
    else if (c === 'sswap') { sides[arg] = sides[arg].filter(id => id !== arg2); const o = arg === 'left' ? 'right' : 'left'; if (!sides[o].includes(arg2)) sides[o].push(arg2); saveSides(); }
    else if (c === 'sup' || c === 'sdown') {
      const l = sides[arg], i = l.indexOf(arg2), j = i + (c === 'sup' ? -1 : 1);
      if (i < 0 || j < 0 || j >= l.length) return;
      [l[i], l[j]] = [l[j], l[i]]; saveSides();
    }
    else if (c === 'addw') { store.set('widgets', [...this.widgets(), arg]); this.render(); }
    else if (c === 'remove') { store.set('widgets', this.widgets().filter(id => id !== arg)); this.render(); }
    else if (c === 'left' || c === 'right') {
      const list = this.widgets(), i = list.indexOf(arg), j = i + (c === 'left' ? -1 : 1);
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]]; store.set('widgets', list); this.render();
    }
  },
  customize() {
    const cur = settings.accent || CLUSTERS[this.style].accent;
    sheet('Customize', `<div class="cz-title">Cluster style</div>
      <div class="cz-styles">${Object.entries(CLUSTERS).map(([id, c]) =>
        `<button class="cz-style ${id === this.style ? 'on' : ''}" data-dash="style:${id}" style="--sw:${ACCENTS[c.accent]}"><i></i>${c.name}</button>`).join('')}</div>
      <div class="cz-title">Accent</div>
      <div class="cz-acc">${Object.entries(ACCENTS).map(([id, c]) =>
        `<button class="cz-sw ${id === cur ? 'on' : ''}" data-dash="accent:${id}" style="background:${c}" aria-label="${id} accent"></button>`).join('')}</div>
      <div class="cz-title">Motion sensors</div>
      <div class="cz-row"><button class="big-btn" data-dash="motion">${Sensors.live ? 'Motion on' : 'Enable motion'}</button><button class="big-btn" data-dash="level">Set level</button></div>
      <p class="hint">Roll, pitch and G-force use the phone’s sensors, so mount it upright facing you and tap <b>Set level</b> while parked on flat ground.</p>`,
      [['Done']]);
  },
  addSheet(where = 'grid') {
    const have = where === 'grid' ? this.widgets() : this.sides()[where];
    const missing = Object.keys(W).filter(id => !have.includes(id));
    if (!missing.length) return toast('All widgets are already there');
    const title = where === 'grid' ? 'Add widget' : `Add widget · ${where} of the cluster`;
    sheet(title, `<div class="cz-styles">${missing.map(id => `<button class="cz-style" data-dash="${where === 'grid' ? `addw:${id}` : `adds:${where}:${id}`}">${W[id].name}</button>`).join('')}</div>`, [['Done']]);
  },
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-dash]'); if (!b || b.disabled) return;
  e.stopPropagation();
  if (b.closest('#sheet') && /^(addw|adds):/.test(b.dataset.dash)) closeSheet();
  Dash.cmd(b.dataset.dash);
}, true);
// Swipe left/right on the dashboard to change layout.
(() => {
  let x0 = null, y0 = 0;
  const root = $('#view-dashboard');
  root.addEventListener('touchstart', e => { if (Dash.editing) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  root.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > 60 || e.target.closest('.wgrid,.cl-side,.wg-rs')) return;
    const i = LAYOUTS.findIndex(l => l[0] === Dash.layout), n = LAYOUTS.length;
    Dash.cmd('layout:' + LAYOUTS[(i + (dx < 0 ? 1 : -1) + n) % n][0]);
  }, { passive: true });
})();
/* The layout bar slides away after a few seconds so the cluster gets the whole screen; any tap brings it back. */
const Bar = {
  show() {
    $('#view-dashboard').classList.remove('bar-hidden');
    clearTimeout(this.t); this.t = setTimeout(() => this.hide(), 5000);
  },
  hide() {
    if (Dash.editing || !$('#sheet').hidden) return this.show();
    $('#view-dashboard').classList.add('bar-hidden');
  },
};
$('#view-dashboard').addEventListener('pointerdown', () => Bar.show(), true);
addEventListener('resize', () => requestAnimationFrame(() => Dash.fitGrid()));
/* Drag a widget's corner handle to resize it in whole cells; the grid re-packs around it. */
document.addEventListener('pointerdown', e => {
  const hnd = e.target.closest('[data-rs]'); if (!hnd) return;
  e.preventDefault(); e.stopPropagation();
  const [where, id] = hnd.dataset.rs.split(':'), card = hnd.closest('.wg'), box = card.parentElement, r = card.getBoundingClientRect();
  const w0 = +card.dataset.cw || 1, h0 = +card.dataset.ch || 1, grid = where === 'grid';
  const cols = grid ? +box.dataset.cols || 1 : 1, cellW = (r.width + 12) / w0, cellH = grid ? (r.height + 12) / h0 : box.clientHeight / 4;
  const x0 = e.clientX, y0 = e.clientY;
  let nw = w0, nh = h0;
  card.classList.add('resizing'); hnd.setPointerCapture?.(e.pointerId);
  const move = ev => {
    const w = grid ? Math.max(1, Math.min(cols, w0 + Math.round((ev.clientX - x0) / cellW))) : 1;
    const h = Math.max(1, Math.min(3, h0 + Math.round((ev.clientY - y0) / cellH)));
    if (w === nw && h === nh) return;
    nw = w; nh = h; card.dataset.cw = w; card.dataset.ch = h;
    if (grid) { card.style.gridColumn = `span ${w}`; card.style.gridRow = `span ${h}`; } else card.style.flexGrow = h;
  };
  const end = () => {
    hnd.removeEventListener('pointermove', move); card.classList.remove('resizing');
    Dash.setSize(where, id, [nw, nh]); Dash.fitGrid();
  };
  hnd.addEventListener('pointermove', move);
  hnd.addEventListener('pointerup', end, { once: true }); hnd.addEventListener('pointercancel', end, { once: true });
}, true);
listeners.push(() => Dash.update());
setInterval(() => Dash.update(), 1000);
if (current === 'dashboard') Dash.render();
