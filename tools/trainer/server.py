#!/usr/bin/env python3
"""DriveDeck Trainer: a local tool to label pictures, capture your web pages as labeled data, train an object detector
on this computer (the Mac's GPU through PyTorch MPS) and export it as ONNX for DriveDeck.

    cd tools/trainer && pip install -r requirements.txt && python3 server.py      → http://127.0.0.1:8765

Everything stays on this computer: data/ holds the datasets, runs/ the trained models. Only listens on 127.0.0.1."""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import shutil
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')  # a few detection ops (NMS) run on the CPU on a Mac

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from trainer.datasets import UI_CLASSES, Datasets, safe_name  # noqa: E402
from trainer.engines import ENGINES  # noqa: E402
from trainer.harvest import VIEWPORTS, harvest  # noqa: E402
from trainer.jobs import Jobs  # noqa: E402

DATA, RUNS, UI = HERE / 'data', HERE / 'runs', HERE / 'ui'
ds, jobs = Datasets(DATA), Jobs()
RUNS.mkdir(exist_ok=True)


def runs() -> list[dict]:
    out = []
    for r in sorted(RUNS.iterdir(), reverse=True):
        if not (r / 'meta.json').exists():
            continue
        meta = json.loads((r / 'meta.json').read_text())
        hist = json.loads((r / 'history.json').read_text()) if (r / 'history.json').exists() else []
        ex = r / 'export'
        out.append({'id': r.name, **{k: meta.get(k) for k in ('engine', 'arch', 'model', 'dataset', 'classes', 'imgsz', 'train', 'val')},
                    'epochs': len(hist), 'best_map50': max([h.get('map50', 0) for h in hist] or [0]), 'last': hist[-1] if hist else None,
                    'hasModel': (r / 'best.pt').exists(), 'exported': sorted(f.name for f in ex.iterdir()) if ex.is_dir() else []})
    return out


def run_dir(rid: str) -> Path:
    if not re.fullmatch(r'[\w.-]+', rid or '') or not (RUNS / rid / 'meta.json').exists():
        raise FileNotFoundError(f'No run {rid}')
    return RUNS / rid


class H(BaseHTTPRequestHandler):
    server_version = 'DriveDeckTrainer/1'

    def log_message(self, fmt, *a):
        if os.environ.get('TRAINER_VERBOSE'):
            super().log_message(fmt, *a)

    # ---------- replies ----------
    def send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store'); self.send_header('X-Content-Type-Options', 'nosniff')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)

    def json(self, obj, code=200):
        self.send(code, json.dumps(obj).encode(), 'application/json')

    def body(self) -> bytes:
        n = int(self.headers.get('Content-Length') or 0)
        if n > 2_000_000_000:
            raise ValueError('Too big')
        return self.rfile.read(n) if n else b''

    def jbody(self) -> dict:
        b = self.body()
        return json.loads(b) if b else {}

    # ---------- routing ----------
    def do_GET(self): self.route('GET')
    def do_POST(self): self.route('POST')
    def do_PUT(self): self.route('PUT')
    def do_DELETE(self): self.route('DELETE')

    def route(self, method: str):
        u = urlparse(self.path); q = {k: v[-1] for k, v in parse_qs(u.query).items()}
        parts = [unquote(p) for p in u.path.split('/') if p]
        # Pages from elsewhere mustn't drive this tool through the browser: same-origin requests only for changes.
        if method != 'GET' and self.headers.get('Origin') not in (None, f'http://{self.headers.get("Host")}'):
            return self.json({'error': 'Cross-site request refused'}, 403)
        try:
            if not parts or parts[0] != 'api':
                return self.static(u.path)
            r = self.api(method, parts[1:], q)
            if r is not None:
                self.json(r)
        except FileNotFoundError as e:
            self.json({'error': str(e)}, 404)
        except (ValueError, FileExistsError, RuntimeError) as e:
            self.json({'error': str(e)}, 400)
        except Exception as e:
            traceback.print_exc()
            self.json({'error': f'{e.__class__.__name__}: {e}'}, 500)

    def static(self, path: str):
        f = (UI / (path.strip('/') or 'index.html')).resolve()
        if UI not in f.parents and f != UI / 'index.html' or not f.is_file():
            return self.send(404, b'Not found', 'text/plain')
        self.send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] or 'application/octet-stream')

    def api(self, m: str, p: list[str], q: dict):
        if p == ['status'] and m == 'GET':
            import platform
            return {'python': platform.python_version(), 'machine': platform.machine(), 'system': platform.system(),
                    'engines': [{'id': e.id, 'name': e.name, 'license': e.license, 'note': e.note, 'params': e.params, 'choices': getattr(e, 'choices', {}),
                                 'ok': e.available()[0], 'why': e.available()[1]} for e in ENGINES.values()],
                    'uiClasses': UI_CLASSES, 'viewports': {k: list(v) for k, v in VIEWPORTS.items()}}
        # ----- datasets -----
        if p == ['datasets']:
            if m == 'GET':
                return ds.all()
            if m == 'POST':
                b = self.jbody(); return ds.create(b.get('name', ''), b.get('classes') or None)
        if len(p) >= 2 and p[0] == 'datasets':
            name = p[1]
            if len(p) == 2:
                if m == 'GET':
                    return {**ds.info(name), 'files': [{'file': f, 'boxes': len(ds.labels(name, f))} for f in ds.images(name)]}
                if m == 'DELETE':
                    ds.delete(name); return {'ok': True}
            if p[2:] == ['classes'] and m == 'PUT':
                ds.set_classes(name, self.jbody().get('classes', [])); return ds.info(name)
            if p[2:] == ['files'] and m == 'POST':  # one file per request: a picture, or a zip in YOLO layout
                fn, data = q.get('name', 'upload.png'), self.body()
                if fn.lower().endswith('.zip'):
                    return ds.import_zip(name, data)
                return {'file': ds.add_image(name, fn, data)}
            if p[2:] == ['zip'] and m == 'GET':
                z = ds.export_zip(name)
                return self.send(200, z, 'application/zip', {'Content-Disposition': f'attachment; filename="{safe_name(name)}.zip"'})
            if len(p) == 4 and p[2] == 'image':
                if m == 'GET':
                    f = ds.image_path(name, p[3]); return self.send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] or 'image/png')
                if m == 'DELETE':
                    ds.delete_image(name, p[3]); return {'ok': True}
            if len(p) == 4 and p[2] == 'labels':
                if m == 'GET':
                    return ds.labels(name, p[3])
                if m == 'PUT':
                    ds.set_labels(name, p[3], self.jbody().get('boxes', [])); return {'ok': True}
            if p[2:] == ['harvest'] and m == 'POST':
                b = self.jbody(); ds.path(name)
                job = jobs.start('harvest', f'Capture into {name}', lambda j: harvest(j, ds, name, b.get('urls', []), b.get('viewports') or ['desktop'],
                                                                                      b.get('themes') or ['light'], int(b.get('screens', 2))))
                return job.summary()
        # ----- training -----
        if p == ['train'] and m == 'POST':
            b = self.jbody(); eng = ENGINES.get(b.get('engine', 'torchvision'))
            if not eng:
                raise ValueError('Unknown engine')
            ok, why = eng.available()
            if not ok:
                raise RuntimeError(why)
            name = b.get('dataset', ''); ds.path(name)
            params = {**eng.params, **(b.get('params') or {})}
            rid = time.strftime('%Y%m%d-%H%M%S') + '-' + re.sub(r'[^\w]+', '-', name)[:30]
            rd = RUNS / rid; rd.mkdir(parents=True)
            job = jobs.start('train', f'Train {name} ({eng.name})', lambda j: eng.train(j, ds, name, params, rd))
            return {**job.summary(), 'run': rid}
        # ----- jobs -----
        if p == ['jobs'] and m == 'GET':
            return [j.summary() for j in sorted(jobs.all.values(), key=lambda j: -j.started)]
        if len(p) >= 2 and p[0] == 'jobs':
            job = jobs.all.get(p[1])
            if not job:
                raise FileNotFoundError('No such job')
            if p[2:] == ['stop'] and m == 'POST':
                job.stop(); return job.summary()
            if p[2:] == ['events'] and m == 'GET':
                return self.stream(job, int(q.get('from', 0)))
            return {**job.summary(), 'log': job.events[-200:]}
        # ----- runs -----
        if p == ['runs'] and m == 'GET':
            return runs()
        if len(p) >= 2 and p[0] == 'runs':
            rd = run_dir(p[1]); meta = json.loads((rd / 'meta.json').read_text()); eng = ENGINES[meta['engine']]
            if len(p) == 2 and m == 'GET':
                return {**next(r for r in runs() if r['id'] == p[1]), 'history': json.loads((rd / 'history.json').read_text()) if (rd / 'history.json').exists() else [], 'meta': meta}
            if len(p) == 2 and m == 'DELETE':
                if any(j.state == 'running' and p[1] in j.title for j in jobs.all.values()):
                    raise RuntimeError('Stop its training first')
                shutil.rmtree(rd); return {'ok': True}
            if p[2:] == ['predict'] and m == 'POST':  # a picture in the body, or ?dataset=&file= for one already here
                conf = float(q.get('conf', meta.get('params', {}).get('conf', 0.3)))
                if q.get('dataset'):
                    return eng.predict(rd, ds.image_path(q['dataset'], q['file']), conf)
                tmp = rd / f'_predict{Path(q.get("name", "x.png")).suffix or ".png"}'; tmp.write_bytes(self.body())
                try:
                    return eng.predict(rd, tmp, conf)
                finally:
                    tmp.unlink(missing_ok=True)
            if p[2:] == ['export'] and m == 'POST':
                return {'files': eng.export(rd, self.jbody())}
            if len(p) == 4 and p[2] == 'files':
                f = (rd / 'export' / Path(p[3]).name)
                if not f.is_file():
                    raise FileNotFoundError(p[3])
                return self.send(200, f.read_bytes(), 'application/octet-stream', {'Content-Disposition': f'attachment; filename="{f.name}"'})
        raise FileNotFoundError('Unknown address')

    def stream(self, job, start: int):
        """Server-Sent Events: the job's events as they happen."""
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-store'); self.end_headers()
        n = start
        try:
            while True:
                evs = job.wait(n)
                for e in evs:
                    self.wfile.write(f'id: {n}\ndata: {json.dumps(e)}\n\n'.encode()); n += 1
                if not evs:
                    self.wfile.write(b': keep-alive\n\n')
                self.wfile.flush()
                if job.state != 'running' and n >= len(job.events):
                    return
        except (BrokenPipeError, ConnectionResetError):
            return


def main():
    a = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    a.add_argument('--port', type=int, default=8765)
    a.add_argument('--host', default='127.0.0.1', help='keep 127.0.0.1 unless you know you want it on your network')
    o = a.parse_args()
    srv = ThreadingHTTPServer((o.host, o.port), H)
    print(f'DriveDeck Trainer on http://{o.host}:{o.port}  (data: {DATA}, runs: {RUNS})')
    for e in ENGINES.values():
        print(f'  {e.name}: {"ready" if e.available()[0] else "not installed"} · {e.available()[1]}')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
