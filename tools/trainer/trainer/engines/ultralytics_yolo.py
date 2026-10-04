"""Ultralytics YOLO (optional): the quickest route to a good detector, if you accept its licence. Ultralytics' code is
AGPL-3.0 and so, by their terms, are models trained with it, unless you buy their enterprise licence. Install with
`pip install ultralytics` to enable it here."""
from __future__ import annotations

import json
import shutil
import time
from pathlib import Path


class UltralyticsEngine:
    id = 'ultralytics'
    name = 'Ultralytics YOLO (optional)'
    license = 'AGPL-3.0'
    note = 'AGPL-3.0: models you train with it are AGPL too. Best accuracy for the effort.'
    params = {'model': 'yolo11n.pt', 'epochs': 80, 'imgsz': 640, 'batch': 16, 'lr': 0.01, 'val': 0.15, 'conf': 0.3}
    choices = {'model': {'yolo11n.pt': 'YOLO11 nano (fastest)', 'yolo11s.pt': 'YOLO11 small', 'yolov8n.pt': 'YOLOv8 nano'}}

    def available(self):
        try:
            import ultralytics
            return True, f'ultralytics {ultralytics.__version__}'
        except ImportError:
            return False, 'pip install ultralytics (AGPL-3.0)'

    def train(self, job, ds, name, p, run: Path):
        from ultralytics import YOLO
        import torch
        classes = ds.classes(name)
        train, val = ds.split(name, float(p.get('val', 0.15)))
        if not train:
            raise ValueError('No labeled pictures yet: label some (or capture web pages) first')
        y = ds.write_yaml(name, train, val, run / 'split')
        dev = 'mps' if torch.backends.mps.is_available() else (0 if torch.cuda.is_available() else 'cpu')
        (run / 'meta.json').write_text(json.dumps({'engine': self.id, 'model': p.get('model'), 'imgsz': int(p.get('imgsz', 640)), 'classes': classes, 'dataset': name, 'params': p, 'train': len(train), 'val': len(val)}, indent=2))
        model = YOLO(p.get('model', 'yolo11n.pt'))
        epochs, hist = int(p.get('epochs', 80)), []

        def on_epoch(tr):
            m = tr.metrics or {}
            row = {'epoch': tr.epoch + 1, 'loss': float(sum(tr.tloss)) if tr.tloss is not None else 0.0, 'lr': float(list(tr.lr.values())[0]) if tr.lr else 0.0,
                   'map50': float(m.get('metrics/mAP50(B)', 0)), 'map': float(m.get('metrics/mAP50-95(B)', 0))}
            hist.append(row); job.emit({'type': 'epoch', 'of': epochs, **row})
            (run / 'history.json').write_text(json.dumps(hist))
            if job.stopping:
                tr.stop = True  # finishes this epoch and saves
        model.add_callback('on_fit_epoch_end', on_epoch)
        job.log(f'Ultralytics {p.get("model")} on {dev} · {len(train)} training / {len(val)} validation pictures')
        model.train(data=str(y), epochs=epochs, imgsz=int(p.get('imgsz', 640)), batch=int(p.get('batch', 16)), lr0=float(p.get('lr', 0.01)),
                    device=dev, project=str(run), name='yolo', exist_ok=True, verbose=False, plots=False)
        best = run / 'yolo' / 'weights' / 'best.pt'
        if best.exists():
            shutil.copy(best, run / 'best.pt')
        return {'run': run.name, 'epochs': len(hist), 'best_map50': max([h['map50'] for h in hist] or [0])}

    def predict(self, run: Path, image: Path, conf: float):
        from ultralytics import YOLO
        meta = json.loads((run / 'meta.json').read_text())
        t0 = time.time(); r = YOLO(str(run / 'best.pt')).predict(str(image), conf=conf, imgsz=meta['imgsz'], verbose=False)[0]
        h, w = r.orig_shape
        return {'ms': round((time.time() - t0) * 1000), 'boxes': [{'c': int(c), 'name': meta['classes'][int(c)], 'score': round(float(s), 3),
                'x0': float(b[0]) / w, 'y0': float(b[1]) / h, 'x1': float(b[2]) / w, 'y1': float(b[3]) / h}
                for b, c, s in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), r.boxes.conf.tolist())]}

    def export(self, run: Path, opts: dict):
        from ultralytics import YOLO
        meta = json.loads((run / 'meta.json').read_text())
        out = run / 'export'; out.mkdir(exist_ok=True)
        f = YOLO(str(run / 'best.pt')).export(format='onnx', imgsz=meta['imgsz'], int8=False, simplify=True)
        shutil.copy(f, out / 'model.onnx')
        (out / 'model.json').write_text(json.dumps({'name': opts.get('name') or f"{meta['dataset']} · {meta['model']}", 'engine': self.id, 'license': self.license,
            'classes': meta['classes'], 'input': {'name': 'images', 'shape': [1, 3, meta['imgsz'], meta['imgsz']], 'range': '0..1 RGB, letterboxed'},
            'outputs': 'Ultralytics raw head: [1, 4 + classes, anchors] (cx, cy, w, h, class scores); needs NMS', 'made': time.strftime('%Y-%m-%d %H:%M')}, indent=2))
        return ['model.onnx', 'model.json']
