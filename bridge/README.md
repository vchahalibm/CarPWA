# DriveDeck bridge

`drivedeck-bridge.js` lets DriveDeck **record and replay clicks** on your own web page when it's shown in a DriveDeck
web widget (Settings › Scripts › a step › Record web steps). Add it to your page:

```html
<script src="drivedeck-bridge.js" data-allow="https://vchahalibm.github.io app://drivedeck"></script>
```

- `data-allow`: the DriveDeck addresses allowed to drive the page (the web app's origin, `app://drivedeck` for the Mac
  app). The page's own origin is always allowed; every other site that embeds your page is ignored.
- Pages served from the same address as DriveDeck (like `samples/demo-page.html`) don't need it.
- Your page must allow being shown in a frame by DriveDeck (no `X-Frame-Options: DENY`, or a `frame-ancestors` that
  lists DriveDeck).
- What's recorded: clicks (on buttons, links, tabs… with several ways to find them again: `data-testid`, id, CSS path,
  text, position) and typed values. **Password-like fields are never recorded**; a replay stops there for you to type.
- Tip: give controls a `data-testid` and replays survive layout changes.
