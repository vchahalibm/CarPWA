'use strict';
/* ============================================================
   More watcher templates (docs/watchers.html § 12, “next”): shopping (Amazon, Flipkart, any shop), travel, work, life,
   news and money, media, and the Mac's own sources (a folder, a file, an app window, a webhook, another watcher's news).
   Each is { id, group, name, about?, inputs: [[key, question, placeholder, type?]], pick?, make(values) → a watcher }.
   type: 'folder' / 'file' (picked in StudioGen), 'window' (an open window), 'watcher' (another one). pick: the page opens
   and you tap the list (sites differ too much to guess). Prices keep a history (record) for the data widget.
   With Agent settings › Use the practice sites, the shop templates open labs/practice/shop.html. Loaded after watch.js.
   ============================================================ */
/** The practice shop instead of the example address, when practising. */
const wtShop = (u, style) => (!u || /…/.test(u)) && Agent.cfg().practice ? new URL(`labs/practice/shop.html?style=${style}`, location.href).href : u;
const wtHost = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u).slice(0, 30); } };
const AMZ_PRICE = '#corePrice_feature_div .a-price-whole||#corePriceDisplay_desktop_feature_div .a-price-whole||#apex_desktop .a-price-whole||.a-price .a-price-whole';
const FK_PRICE = 'div.Nx9bqj.CxhGGd||div._30jeq3._16Jk6d||div.Nx9bqj||div._30jeq3';
const wtPrice = (sel, about) => ({ read: sel, finders: sel.split('||'), extract: { fields: ['price'], about, fallback: true }, detect: { kind: 'value', field: 'price' }, record: true }); /* the model reads the page when the selectors stop working */
WATCH_TEMPLATES.push(
  // Shopping
  { id: 'amazon.price', group: 'Shopping', name: 'Amazon: price drop', inputs: [['url', 'The product’s address', 'https://www.amazon.in/dp/…'], ['cond', 'Tell me when the price… (below 1000, drops 5%, drops)', 'drops']],
    make: v => { const url = wtShop(v.url, 'amazon'); return { name: `Amazon price: ${wtHost(url)}`, url, site: 'Amazon', ready: '#dp||#ppd||body', ...wtPrice(AMZ_PRICE, 'an Amazon product page'), detect: { kind: 'value', field: 'price', cond: v.cond || 'drops' }, every: '1h' }; } },
  { id: 'amazon.stock', group: 'Shopping', name: 'Amazon: back in stock', inputs: [['url', 'The product’s address', 'https://www.amazon.in/dp/…']],
    make: v => { const url = wtShop(v.url, 'amazon'); return { name: `Amazon stock: ${wtHost(url)}`, url, site: 'Amazon', ready: '#dp||#ppd||body', read: '#availability||#outOfStock||#buybox', detect: { kind: 'contains', words: 'in stock||left in stock||add to cart' }, every: '1h' }; } },
  { id: 'flipkart.price', group: 'Shopping', name: 'Flipkart: price drop', inputs: [['url', 'The product’s address', 'https://www.flipkart.com/…'], ['cond', 'Tell me when the price… (below 1000, drops 5%, drops)', 'drops']],
    make: v => { const url = wtShop(v.url, 'flipkart'); return { name: `Flipkart price: ${wtHost(url)}`, url, site: 'Flipkart', ready: 'body', ...wtPrice(FK_PRICE, 'a Flipkart product page'), detect: { kind: 'value', field: 'price', cond: v.cond || 'drops' }, every: '1h' }; } },
  { id: 'flipkart.stock', group: 'Shopping', name: 'Flipkart: back in stock', inputs: [['url', 'The product’s address', 'https://www.flipkart.com/…']],
    make: v => { const url = wtShop(v.url, 'flipkart'); return { name: `Flipkart stock: ${wtHost(url)}`, url, site: 'Flipkart', ready: 'body', read: 'body', extract: { fields: ['in_stock'], about: 'a Flipkart product page' }, detect: { kind: 'contains', field: 'in_stock', words: 'true' }, every: '1h' }; } },
  { id: 'shop.price', group: 'Shopping', name: 'Any shop: price drop', about: 'The language model reads the price from the page, so it works on most shops.', inputs: [['url', 'The product’s address', 'https://…'], ['cond', 'Tell me when the price… (below 1000, drops 5%, drops)', 'drops']],
    make: v => ({ name: `Price: ${wtHost(v.url)}`, url: v.url, read: 'main||[role="main"]||body', extract: { fields: ['price'], about: 'a product page' }, detect: { kind: 'value', field: 'price', cond: v.cond || 'drops' }, record: true, every: '1h' }) },
  { id: 'shop.stock', group: 'Shopping', name: 'Any shop: back in stock', inputs: [['url', 'The product’s address', 'https://…']],
    make: v => ({ name: `In stock: ${wtHost(v.url)}`, url: v.url, read: 'main||[role="main"]||body', extract: { fields: ['in_stock'], about: 'a product page' }, detect: { kind: 'contains', field: 'in_stock', words: 'true' }, every: '1h' }) },
  { id: 'shop.sale', group: 'Shopping', name: 'A sale or coupon appears', inputs: [['url', 'The shop’s page', 'https://…'], ['words', 'Which words? (|| between)', 'sale||% off||coupon||deal of the day']],
    make: v => ({ name: `Sale: ${wtHost(v.url)}`, url: v.url, read: 'body', detect: { kind: 'contains', words: v.words || 'sale||% off||coupon' }, every: '6h' }) },
  { id: 'shop.preorder', group: 'Shopping', name: 'A pre-order opens', inputs: [['url', 'The product’s page', 'https://…']],
    make: v => ({ name: `Pre-order: ${wtHost(v.url)}`, url: v.url, read: 'body', detect: { kind: 'contains', words: 'pre-order now||preorder now||pre order now||book now||add to cart' }, every: '1h' }) },
  // Travel
  { id: 'flight.price', group: 'Travel', name: 'Flight price', about: 'Open your flight search (Google Flights, MakeMyTrip…) and copy its address.', inputs: [['url', 'The search page’s address', 'https://www.google.com/travel/flights/…'], ['cond', 'Tell me when… (below 6000, drops)', 'drops']],
    make: v => ({ name: `Flight price: ${wtHost(v.url)}`, url: v.url, read: 'main||[role="main"]||body', extract: { fields: ['price'], about: 'the cheapest flight on this search page' }, detect: { kind: 'value', field: 'price', cond: v.cond || 'drops' }, record: true, every: '6h' }) },
  { id: 'flight.status', group: 'Travel', name: 'Flight status and gate', inputs: [['url', 'The flight’s status page', 'https://…']],
    make: v => ({ name: `Flight: ${wtHost(v.url)}`, url: v.url, read: 'main||[role="main"]||body', detect: { kind: 'changes' }, filter: { ignore: 'updated||last refreshed' }, every: '15m' }) },
  { id: 'visa.slots', group: 'Travel', name: 'Appointment slots (visa, passport)', inputs: [['url', 'The appointment page', 'https://…'], ['words', 'Words that mean a slot is free (|| between)', 'available||book now||select a date']],
    make: v => ({ name: `Slots: ${wtHost(v.url)}`, url: v.url, read: 'main||[role="main"]||body', detect: { kind: 'contains', words: v.words || 'available' }, every: '30m' }) },
  { id: 'hotel.price', group: 'Travel', name: 'Hotel price', inputs: [['url', 'The hotel page for your dates', 'https://…'], ['cond', 'Tell me when… (below 5000, drops)', 'drops']],
    make: v => ({ name: `Hotel: ${wtHost(v.url)}`, url: v.url, read: 'main||[role="main"]||body', extract: { fields: ['price'], about: 'this hotel’s price for the chosen dates' }, detect: { kind: 'value', field: 'price', cond: v.cond || 'drops' }, record: true, every: '6h' }) },
  { id: 'train.seats', group: 'Travel', name: 'Train seat availability', inputs: [['url', 'The availability page', 'https://…']],
    make: v => ({ name: `Train seats: ${wtHost(v.url)}`, url: v.url, read: 'main||[role="main"]||body', detect: { kind: 'changes' }, every: '1h' }) },
  // Work
  { id: 'cal.changes', group: 'Work', name: 'Calendar: a meeting moved, added or cancelled', inputs: [],
    make: () => ({ name: 'Calendar changes', url: '{outlook}/calendar/view/week', site: 'Outlook', ready: '[role="main"]', rows: '[role="main"] [role="button"][aria-label]||[data-calitemid]', detect: { kind: 'new', gone: true }, every: '15m' }) },
  { id: 'github.assigned', group: 'Work', name: 'GitHub: issues and PRs assigned to me', inputs: [],
    make: () => ({ name: 'GitHub: assigned to me', url: 'https://github.com/issues/assigned', site: 'GitHub', ready: 'main', rows: '[data-testid="list-view-item"]||div[role="list"] [role="listitem"]||.js-issue-row', detect: { kind: 'new' }, every: '15m' }) },
  { id: 'github.failed', group: 'Work', name: 'GitHub: a build failed', inputs: [['repo', 'Which repository? (owner/name)', 'owner/repo']],
    make: v => ({ name: `Builds: ${v.repo}`, url: `https://github.com/${v.repo}/actions`, site: 'GitHub', ready: 'main', rows: '[data-testid="workflow-run-row"]||[data-testid="list-view-item"]||.Box-row', keep: 'failure||failed', detect: { kind: 'new' }, every: '15m' }) },
  { id: 'status.incident', group: 'Work', name: 'A status page shows an incident', inputs: [['url', 'The status page', 'https://www.githubstatus.com']],
    make: v => ({ name: `Status: ${wtHost(v.url)}`, source: 'feed', url: v.url, detect: { kind: 'new' }, every: '15m' }) },
  { id: 'competitor.pricing', group: 'Work', name: 'A competitor’s pricing page changes', inputs: [['url', 'The pricing page', 'https://…']],
    make: v => ({ name: `Pricing: ${wtHost(v.url)}`, url: v.url, read: 'main||[role="main"]||body', detect: { kind: 'changes' }, every: '1d' }) },
  { id: 'reviews.new', group: 'Work', name: 'New reviews (app store, Google, a shop)', pick: true, inputs: [['url', 'The reviews page', 'https://…']], make: v => ({ url: v.url, tip: 'Tap one review' }) },
  { id: 'doc.changed', group: 'Work', name: 'A shared document changed', inputs: [['url', 'Its address (a published or shared view)', 'https://…']],
    make: v => ({ name: `Document: ${wtHost(v.url)}`, url: v.url, read: 'main||[role="main"]||article||body', detect: { kind: 'changes' }, every: '1h' }) },
  // Life
  { id: 'parcel', group: 'Life', name: 'Parcel status', inputs: [['url', 'The tracking page', 'https://…']],
    make: v => ({ name: `Parcel: ${wtHost(v.url)}`, url: v.url, read: 'main||[role="main"]||body', detect: { kind: 'changes' }, every: '1h' }) },
  { id: 'tickets', group: 'Life', name: 'Tickets on sale (or resale)', inputs: [['url', 'The event page', 'https://…'], ['words', 'Words that mean tickets are on sale (|| between)', 'book now||buy tickets||on sale||available']],
    make: v => ({ name: `Tickets: ${wtHost(v.url)}`, url: v.url, read: 'main||[role="main"]||body', detect: { kind: 'contains', words: v.words || 'book now' }, every: '30m' }) },
  { id: 'apartments', group: 'Life', name: 'New apartment listings', pick: true, inputs: [['url', 'Your search’s address (with its filters)', 'https://…']], make: v => ({ url: v.url, tip: 'Tap one listing' }) },
  { id: 'jobs', group: 'Life', name: 'New jobs on a careers page', pick: true, inputs: [['url', 'The careers page', 'https://…']], make: v => ({ url: v.url, tip: 'Tap one job' }) },
  { id: 'notices', group: 'Life', name: 'School or society notices', pick: true, inputs: [['url', 'The notices page', 'https://…']], make: v => ({ url: v.url, tip: 'Tap one notice' }) },
  { id: 'results', group: 'Life', name: 'Results published', inputs: [['url', 'The results page', 'https://…'], ['words', 'Words that mean they’re out (|| between)', 'results declared||result is out||download result']],
    make: v => ({ name: `Results: ${wtHost(v.url)}`, url: v.url, read: 'body', detect: { kind: 'contains', words: v.words || 'results' }, every: '1h' }) },
  // News and money
  { id: 'news.topic', group: 'News and money', name: 'A topic or company in the news', inputs: [['topic', 'Which topic or company?', 'Acme']],
    make: v => ({ name: `News: ${v.topic}`, source: 'feed', url: `https://news.google.com/rss/search?q=${encodeURIComponent(v.topic)}&hl=en-IN&gl=IN&ceid=IN:en`, detect: { kind: 'new' }, every: '30m' }) },
  { id: 'stock.price', group: 'News and money', name: 'A stock crosses a price', inputs: [['symbol', 'Which stock? (its symbol: RELIANCE.NS, AAPL)', 'RELIANCE.NS'], ['cond', 'Tell me when… (above 3000, below 2500, moves 3%)', 'moves 3%']],
    make: v => ({ name: `Stock: ${v.symbol}`, source: 'json', url: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(v.symbol)}?interval=1d&range=1d`, path: 'chart.result.0.meta.regularMarketPrice', detect: { kind: 'value', cond: v.cond || 'moves 3%' }, record: true, every: '15m' }) },
  { id: 'crypto.price', group: 'News and money', name: 'A crypto coin crosses a price', inputs: [['coin', 'Which coin? (bitcoin, ethereum)', 'bitcoin'], ['cur', 'In which money? (inr, usd)', 'inr'], ['cond', 'Tell me when… (above 8000000, moves 5%)', 'moves 5%']],
    make: v => ({ name: `Crypto: ${v.coin}`, source: 'json', url: `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(v.coin.toLowerCase())}&vs_currencies=${encodeURIComponent(v.cur.toLowerCase())}`, path: `${v.coin.toLowerCase()}.${v.cur.toLowerCase()}`, detect: { kind: 'value', cond: v.cond || 'moves 5%' }, record: true, every: '15m' }) },
  { id: 'tender', group: 'News and money', name: 'A government tender or circular', pick: true, inputs: [['url', 'The tenders or circulars page', 'https://…']], make: v => ({ url: v.url, tip: 'Tap one tender or circular' }) },
  { id: 'release', group: 'News and money', name: 'A software release', inputs: [['repo', 'Which GitHub repository? (owner/name)', 'ollama/ollama']],
    make: v => ({ name: `Release: ${v.repo}`, source: 'feed', url: `https://github.com/${v.repo}/releases.atom`, detect: { kind: 'new' }, every: '6h' }) },
  // Media
  { id: 'youtube', group: 'Media', name: 'A YouTube channel’s new videos', inputs: [['url', 'The channel’s address', 'https://www.youtube.com/@…']],
    make: v => ({ name: `YouTube: ${v.url.split('/').filter(Boolean).pop()}`, source: 'feed', url: v.url, detect: { kind: 'new' }, every: '1h' }) },
  { id: 'podcast', group: 'Media', name: 'A podcast’s new episodes', inputs: [['url', 'Its feed (RSS) or website', 'https://…']],
    make: v => ({ name: `Podcast: ${wtHost(v.url)}`, source: 'feed', url: v.url, detect: { kind: 'new' }, every: '6h' }) },
  { id: 'subreddit', group: 'Media', name: 'New posts in a subreddit', inputs: [['sub', 'Which subreddit?', 'LocalLLaMA']],
    make: v => ({ name: `r/${v.sub.replace(/^r\//, '')}`, source: 'feed', url: `https://www.reddit.com/r/${encodeURIComponent(v.sub.replace(/^r\//, ''))}/new/.rss`, detect: { kind: 'new' }, every: '30m' }) },
  { id: 'hn', group: 'Media', name: 'A Hacker News mention', inputs: [['words', 'Which words?', 'StudioGen']],
    make: v => ({ name: `Hacker News: ${v.words}`, source: 'feed', url: `https://hnrss.org/newest?q=${encodeURIComponent(v.words)}`, detect: { kind: 'new' }, every: '30m' }) },
  { id: 'blog', group: 'Media', name: 'A blog’s new posts', inputs: [['url', 'The blog’s address (its feed is found)', 'https://…']],
    make: v => ({ name: `Blog: ${wtHost(v.url)}`, source: 'feed', url: v.url, detect: { kind: 'new' }, every: '6h' }) },
  // On this Mac
  { id: 'mac.folder', group: 'On this Mac', name: 'New or changed files in a folder', inputs: [['path', 'Which folder?', '', 'folder']],
    make: v => ({ name: `Folder: ${String(v.path).split('/').pop()}`, source: 'files', path: v.path, depth: 2, rawIds: true, detect: { kind: 'new' }, every: '5m' }) },
  { id: 'mac.file', group: 'On this Mac', name: 'A file changes', inputs: [['path', 'Which file?', '', 'file']],
    make: v => ({ name: `File: ${String(v.path).split('/').pop()}`, source: 'files', path: v.path, file: true, detect: { kind: 'changes' }, every: '15m' }) },
  { id: 'mac.window', group: 'On this Mac', name: 'An app’s window (words appear, or it changes)', about: 'The screen model reads the window; StudioGen needs Screen Recording (System Settings › Privacy & Security).', inputs: [['window', 'Which window?', '', 'window'], ['words', 'Words to look for (empty: any change; || between)', '']],
    make: v => ({ name: `Window: ${v.window}`, source: 'window', window: v.window, detect: v.words ? { kind: 'contains', words: v.words } : { kind: 'changes' }, every: '5m' }) },
  { id: 'mac.hook', group: 'On this Mac', name: 'A webhook (anything another service sends)', about: 'You get an address; whatever is POSTed to it comes here, through StudioGBee.', inputs: [],
    make: () => ({ name: 'Webhook', source: 'hook', rawIds: true, detect: { kind: 'new' }, every: '1d' }) },
  { id: 'mac.chain', group: 'On this Mac', name: 'When another watcher has news', about: 'Its news become this one’s items: add actions (run a task, start a watcher) in Edit.', inputs: [['from', 'Which watcher?', '', 'watcher']],
    make: v => ({ name: `After: ${Watch.get(v.from)?.name || 'a watcher'}`, source: 'chain', from: v.from, rawIds: true, detect: { kind: 'new' }, every: '1d' }) },
);
