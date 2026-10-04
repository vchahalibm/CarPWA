"""Labeled pictures from YOUR web pages, with no drawing by hand: each page is opened in a headless browser at a few
screen sizes and themes, screenshotted, and every visible control is labeled from the page itself (a <button> is a
button, an <a href> a link…). Use it on pages you own or are allowed to capture.

Needs: pip install playwright && playwright install chromium   (or set CHROMIUM_PATH to a Chromium/Chrome binary)."""
from __future__ import annotations

import os
import re
import time
from urllib.parse import urlparse

from .datasets import UI_CLASSES

# Runs in the page: every visible control with its class and box (in the viewport's CSS pixels).
FIND = r"""(classes) => {
  const out = [], W = innerWidth, H = innerHeight, seen = new Set();
  const cls = el => {
    const t = el.tagName.toLowerCase(), r = (el.getAttribute('role') || '').toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
    if (['checkbox', 'radio', 'switch'].includes(r) || (t === 'input' && ['checkbox', 'radio'].includes(type))) return 'checkbox';
    if (t === 'select' || ['combobox', 'listbox'].includes(r)) return 'select';
    if (r === 'tab') return 'tab';
    if (t === 'button' || r === 'button' || (t === 'input' && ['button', 'submit', 'reset', 'image'].includes(type)) || t === 'summary') return 'button';
    if (t === 'textarea' || (t === 'input' && !['hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'range', 'color', 'file'].includes(type)) || el.isContentEditable && el.getAttribute('contenteditable') !== null) return 'input';
    if ((t === 'a' && el.hasAttribute('href')) || r === 'link') return 'link';
    if (t === 'img' || t === 'svg' || t === 'canvas' || t === 'video' || r === 'img') {
      const b = el.getBoundingClientRect(); return Math.max(b.width, b.height) <= 64 ? 'icon' : 'image';
    }
    return null;
  };
  const all = document.querySelectorAll('a,button,input,select,textarea,summary,img,svg,canvas,video,[role],[contenteditable]');
  for (const el of all) {
    const c = cls(el); if (!c || !classes.includes(c)) continue;
    if (c === 'icon' && el.closest('button,a,[role=button],[role=tab],[role=link]')) continue; // the control around it is what you click
    const b = el.getBoundingClientRect();
    if (b.width < 6 || b.height < 6 || b.right <= 0 || b.bottom <= 0 || b.left >= W || b.top >= H) continue;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity < 0.1) continue;
    // Not hidden under something else (a menu, a dialog): what's at its centre is it or inside it.
    const cx = Math.min(W - 1, Math.max(0, b.left + b.width / 2)), cy = Math.min(H - 1, Math.max(0, b.top + b.height / 2)), top = document.elementFromPoint(cx, cy);
    if (!top || !(el === top || el.contains(top) || top.contains(el))) continue;
    const box = [Math.max(0, b.left), Math.max(0, b.top), Math.min(W, b.right), Math.min(H, b.bottom)], k = box.map(Math.round).join(',');
    if (seen.has(k)) continue; seen.add(k);
    out.push({ c, box });
  }
  return { w: W, h: H, items: out };
}"""

VIEWPORTS = {'desktop': (1280, 800), 'tablet': (1024, 768), 'phone': (390, 844), 'tv': (1920, 1080)}


def harvest(job, ds, name: str, urls: list[str], viewports: list[str], themes: list[str], screens: int = 2, wait_ms: int = 800):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise RuntimeError('Web capture needs Playwright: pip install playwright && playwright install chromium')
    classes = ds.classes(name)
    unknown = [c for c in UI_CLASSES if c not in classes]
    if len(unknown) == len(UI_CLASSES):
        raise ValueError(f'This dataset’s classes ({", ".join(classes)}) aren’t screen elements: make a dataset with the default classes')
    urls = [u.strip() for u in urls if u.strip()]
    for u in urls:
        if urlparse(u).scheme not in ('http', 'https', 'file'):
            raise ValueError(f'{u}: use an http(s) address or a file:// path')
    shots = boxes = 0
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
        except Exception as e:
            raise RuntimeError(f'Couldn’t start Chromium ({str(e).splitlines()[0]}). Run: playwright install chromium (or set CHROMIUM_PATH)')
        try:
            for u in urls:
                for vp in viewports:
                    for theme in themes:
                        if job.stopping:
                            return {'pictures': shots, 'boxes': boxes}
                        w, h = VIEWPORTS.get(vp, VIEWPORTS['desktop'])
                        ctx = browser.new_context(viewport={'width': w, 'height': h}, color_scheme=theme, device_scale_factor=1)
                        page = ctx.new_page()
                        try:
                            page.goto(u, wait_until='networkidle', timeout=30000)
                        except Exception as e:
                            job.log(f'{u}: {str(e).splitlines()[0]}')
                            ctx.close(); continue
                        page.wait_for_timeout(wait_ms)
                        for k in range(screens):
                            if k:
                                moved = page.evaluate('() => { const y = scrollY; scrollBy(0, innerHeight * 0.9); return scrollY !== y; }')
                                if not moved:
                                    break
                                page.wait_for_timeout(400)
                            found = page.evaluate(FIND, classes)
                            png = page.screenshot(type='png')
                            stem = re.sub(r'[^\w]+', '_', urlparse(u).netloc + urlparse(u).path)[:60].strip('_') or 'page'
                            fname = ds.add_image(name, f'{stem}_{vp}_{theme}_{k}.png', png)
                            W, H = found['w'], found['h']
                            labels = [{'c': classes.index(it['c']), 'x': (it['box'][0] + it['box'][2]) / 2 / W, 'y': (it['box'][1] + it['box'][3]) / 2 / H,
                                       'w': (it['box'][2] - it['box'][0]) / W, 'h': (it['box'][3] - it['box'][1]) / H} for it in found['items']]
                            ds.set_labels(name, fname, labels)
                            shots += 1; boxes += len(labels)
                            job.emit({'type': 'shot', 'file': fname, 'boxes': len(labels), 'url': u, 'viewport': vp, 'theme': theme})
                        ctx.close()
        finally:
            browser.close()
    job.log(f'Captured {shots} pictures with {boxes} labeled elements')
    return {'pictures': shots, 'boxes': boxes}
