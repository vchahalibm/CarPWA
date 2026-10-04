# PowerPoint viewer (vendored)

Loaded on first use by the Document widget for `.pptx` files (js/media.js `Media.pptxLib`), in this order:

| File | Package | Version | License |
|---|---|---|---|
| `jszip.min.js` | [jszip](https://github.com/Stuk/jszip) | 3.10.2 | MIT (or GPLv3, dual) |
| `chart.umd.min.js` | [chart.js](https://github.com/chartjs/Chart.js) | 4.5.1 | MIT |
| `PptxViewJS.min.js` | [pptxviewjs](https://github.com/gptsci/pptxviewjs) | 1.1.9 | MIT |

Update: `npm pack pptxviewjs jszip chart.js@4`, then copy `dist/PptxViewJS.min.js`, `dist/jszip.min.js` and `dist/chart.umd.min.js` here.
PptxViewJS draws slides on a canvas; it has no animations, transitions, SmartArt or video, and substitutes fonts that aren't on the device.
