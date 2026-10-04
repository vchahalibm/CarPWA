"""torchvision detectors (BSD-3-Clause code; ImageNet backbone weights): SSDLite MobileNetV3 (small and fast, the
one to run in a browser) or Faster R-CNN MobileNetV3 FPN (slower, better on small screen elements). Trains on the Mac's
GPU (MPS), CUDA, or the CPU, and exports ONNX with the resize and box decoding inside, so a browser only feeds pixels."""
from __future__ import annotations

import json
import math
import random
import time
from pathlib import Path

from ..metrics import evaluate

ARCHS = {
    'ssdlite': 'SSDLite MobileNetV3 (fast, ~3.5M parameters)',
    'fasterrcnn': 'Faster R-CNN MobileNetV3 FPN (more accurate on small elements, slower)',
}


def device():
    import torch
    if torch.backends.mps.is_available():
        return torch.device('mps')
    if torch.cuda.is_available():
        return torch.device('cuda')
    return torch.device('cpu')


def build(arch: str, n_classes: int, imgsz: int, pretrained: bool, log=print):
    """A model for n_classes (+1 background) that resizes its input to imgsz×imgsz itself."""
    import torch
    from torchvision.models.detection import fasterrcnn_mobilenet_v3_large_fpn, ssdlite320_mobilenet_v3_large
    from torchvision.models.detection.transform import GeneralizedRCNNTransform
    make = ssdlite320_mobilenet_v3_large if arch == 'ssdlite' else fasterrcnn_mobilenet_v3_large_fpn
    try:
        m = make(weights=None, weights_backbone='DEFAULT' if pretrained else None, num_classes=n_classes + 1)
    except Exception as e:  # offline: no ImageNet weights to download
        log(f'Couldn’t fetch the pretrained backbone ({e.__class__.__name__}); training from scratch, which needs more data and epochs')
        m = make(weights=None, weights_backbone=None, num_classes=n_classes + 1)
    t = m.transform
    # Screens are wide and their elements small: a square input of imgsz, the whole picture fitted in (no cropping).
    m.transform = GeneralizedRCNNTransform(min_size=imgsz, max_size=imgsz, image_mean=t.image_mean, image_std=t.image_std,
                                           size_divisible=1 if arch == 'ssdlite' else 32, fixed_size=(imgsz, imgsz) if arch == 'ssdlite' else None)
    return m


class Data:
    """Pictures and their boxes as tensors; light augmentation for training."""

    def __init__(self, ds, name, files, train: bool):
        self.ds, self.name, self.files, self.train = ds, name, files, train

    def __len__(self):
        return len(self.files)

    def load(self, i):
        import torch
        from PIL import Image, ImageEnhance
        f = self.files[i]
        img = Image.open(self.ds.image_path(self.name, f)).convert('RGB')
        W, H = img.size
        boxes, labels = [], []
        for b in self.ds.labels(self.name, f):
            x0, y0, x1, y1 = (b['x'] - b['w'] / 2) * W, (b['y'] - b['h'] / 2) * H, (b['x'] + b['w'] / 2) * W, (b['y'] + b['h'] / 2) * H
            if x1 - x0 >= 1 and y1 - y0 >= 1:
                boxes.append([max(0, x0), max(0, y0), min(W, x1), min(H, y1)]); labels.append(b['c'] + 1)
        if self.train:
            if random.random() < 0.5:  # brightness/contrast: dark and light themes, projectors
                img = ImageEnhance.Brightness(img).enhance(random.uniform(0.7, 1.3))
                img = ImageEnhance.Contrast(img).enhance(random.uniform(0.7, 1.3))
            if random.random() < 0.4:  # a crop: elements at other places and scales
                cw, ch = int(W * random.uniform(0.6, 1)), int(H * random.uniform(0.6, 1))
                cx, cy = random.randint(0, W - cw), random.randint(0, H - ch)
                img = img.crop((cx, cy, cx + cw, cy + ch))
                kept = []
                for b, l in zip(boxes, labels):
                    nb = [max(0, b[0] - cx), max(0, b[1] - cy), min(cw, b[2] - cx), min(ch, b[3] - cy)]
                    area, full = (nb[2] - nb[0]) * (nb[3] - nb[1]), (b[2] - b[0]) * (b[3] - b[1])
                    if nb[2] - nb[0] > 2 and nb[3] - nb[1] > 2 and area > 0.6 * full:
                        kept.append((nb, l))
                boxes, labels = [k[0] for k in kept], [k[1] for k in kept]
        x = torch.from_numpy(__import__('numpy').asarray(img, dtype='float32') / 255.0).permute(2, 0, 1).contiguous()
        return x, {'boxes': torch.tensor(boxes, dtype=torch.float32).reshape(-1, 4), 'labels': torch.tensor(labels, dtype=torch.int64)}


class TorchvisionEngine:
    id = 'torchvision'
    name = 'torchvision (SSDLite / Faster R-CNN)'
    license = 'BSD-3-Clause'
    note = 'No licence strings attached to your model. SSDLite is the one to run in a browser.'
    params = {'arch': 'ssdlite', 'epochs': 60, 'imgsz': 512, 'batch': 8, 'lr': 0.01, 'val': 0.15, 'pretrained': True, 'conf': 0.3}
    choices = {'arch': ARCHS}

    def available(self):
        try:
            import torch, torchvision  # noqa: F401
            return True, f'torch {torch.__version__}, torchvision {torchvision.__version__}, device {device()}'
        except ImportError as e:
            return False, f'pip install torch torchvision ({e})'

    def train(self, job, ds, name, p, run: Path):
        import torch
        classes = ds.classes(name)
        train, val = ds.split(name, float(p.get('val', 0.15)))
        if not train:
            raise ValueError('No labeled pictures yet: label some (or capture web pages) first')
        dev, arch, imgsz = device(), p.get('arch', 'ssdlite'), int(p.get('imgsz', 512))
        epochs, bs, lr = int(p.get('epochs', 60)), int(p.get('batch', 8)), float(p.get('lr', 0.01))
        job.log(f'{ARCHS.get(arch, arch)} · {len(classes)} classes · {len(train)} training / {len(val)} validation pictures · {dev}')
        m = build(arch, len(classes), imgsz, bool(p.get('pretrained', True)), job.log).to(dev)
        params = [q for q in m.parameters() if q.requires_grad]
        opt = torch.optim.SGD(params, lr=lr, momentum=0.9, weight_decay=4e-5)
        steps_per_epoch = math.ceil(len(train) / bs)
        total, warm = epochs * steps_per_epoch, min(200, steps_per_epoch * 2)
        sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: (s + 1) / warm if s < warm else 0.5 * (1 + math.cos(math.pi * (s - warm) / max(1, total - warm))))
        tr, va = Data(ds, name, train, True), Data(ds, name, val, False)
        (run / 'meta.json').write_text(json.dumps({'engine': self.id, 'arch': arch, 'imgsz': imgsz, 'classes': classes, 'dataset': name, 'params': p, 'train': len(train), 'val': len(val)}, indent=2))
        best, hist = -1.0, []
        for ep in range(1, epochs + 1):
            if job.stopping:
                break
            m.train(); order = list(range(len(tr))); random.shuffle(order)
            t0, tot, n = time.time(), 0.0, 0
            chunks = [order[k:k + bs] for k in range(0, len(order), bs)]
            if len(chunks) > 1 and len(chunks[-1]) == 1:  # batch norm can't train on one picture: join the last to the one before
                chunks[-2] += chunks.pop()
            for chunk in chunks:
                if job.stopping:
                    break
                batch = [tr.load(i) for i in chunk]
                imgs = [b[0].to(dev) for b in batch]
                tg = [{kk: v.to(dev) for kk, v in b[1].items()} for b in batch]
                loss = sum(m(imgs, tg).values())
                if not torch.isfinite(loss):
                    job.log('The loss went to infinity: lower the learning rate'); continue
                opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(params, 10.0); opt.step(); sched.step()
                tot += float(loss); n += 1
            ev = self.evaluate(m, va, dev, float(p.get('conf', 0.3)) * 0.1, len(classes)) if (ep % max(1, epochs // 20) == 0 or ep == epochs) else None
            row = {'epoch': ep, 'loss': tot / max(1, n), 'lr': opt.param_groups[0]['lr'], 'secs': round(time.time() - t0, 1)}
            if ev:
                row.update({'map50': ev['map50'], 'map': ev['map'], 'perClass': {classes[c]: round(a, 3) for c, a in ev['perClass'].items()}})
                if ev['map50'] >= best:
                    best = ev['map50']; torch.save(m.state_dict(), run / 'best.pt')
            hist.append(row); job.emit({'type': 'epoch', 'of': epochs, **row})
            torch.save(m.state_dict(), run / 'last.pt')
            (run / 'history.json').write_text(json.dumps(hist))
        if not (run / 'best.pt').exists() and (run / 'last.pt').exists():
            (run / 'best.pt').write_bytes((run / 'last.pt').read_bytes())
        return {'run': run.name, 'epochs': len(hist), 'best_map50': max(0.0, best)}

    def evaluate(self, m, data, dev, conf, n_classes):
        import torch
        m.eval(); preds, truths = [], []
        with torch.no_grad():
            for i in range(len(data)):
                x, t = data.load(i)
                o = m([x.to(dev)])[0]
                preds.append([(int(l) - 1, b.tolist(), float(s)) for b, l, s in zip(o['boxes'].cpu(), o['labels'].cpu(), o['scores'].cpu()) if s >= conf])
                truths.append([(int(l) - 1, b.tolist()) for b, l in zip(t['boxes'], t['labels'])])
        return evaluate(preds, truths, n_classes)

    def _load(self, run: Path):
        import torch
        meta = json.loads((run / 'meta.json').read_text())
        m = build(meta['arch'], len(meta['classes']), meta['imgsz'], False, lambda *_: None)
        m.load_state_dict(torch.load(run / 'best.pt', map_location='cpu')); m.eval()
        return m, meta

    def predict(self, run: Path, image: Path, conf: float):
        import numpy as np
        import torch
        from PIL import Image
        m, meta = self._load(run)
        img = Image.open(image).convert('RGB'); W, H = img.size
        x = torch.from_numpy(np.asarray(img, dtype='float32') / 255.0).permute(2, 0, 1)
        t0 = time.time()
        with torch.no_grad():
            o = m([x])[0]
        ms = round((time.time() - t0) * 1000)
        return {'ms': ms, 'boxes': [{'c': int(l) - 1, 'name': meta['classes'][int(l) - 1] if 0 < int(l) <= len(meta['classes']) else '?', 'score': round(float(s), 3),
                                     'x0': float(b[0]) / W, 'y0': float(b[1]) / H, 'x1': float(b[2]) / W, 'y1': float(b[3]) / H}
                                    for b, l, s in zip(o['boxes'], o['labels'], o['scores']) if float(s) >= conf]}

    def export(self, run: Path, opts: dict):
        """ONNX with resizing and box decoding inside: input 'images' [3, H, W] float 0..1 (any size), outputs boxes
        (x0, y0, x1, y1 in the input's pixels), scores, labels (1 = the first class)."""
        import torch
        m, meta = self._load(run)
        out = run / 'export'; out.mkdir(exist_ok=True)
        f = out / 'model.onnx'
        # Traced and checked on a real picture from the dataset (random noise gives only ties).
        import numpy as np
        from PIL import Image
        from ..datasets import Datasets
        try:
            dsr = Datasets(run.parent.parent / 'data'); pic = dsr.images(meta['dataset'])[0]
            img = Image.open(dsr.image_path(meta['dataset'], pic)).convert('RGB').resize((640, 480))
            x = torch.from_numpy(np.asarray(img, dtype='float32') / 255.0).permute(2, 0, 1).contiguous()
        except Exception:
            x = torch.rand(3, 480, 640)
        names = ['boxes', 'scores', 'labels'] if meta['arch'] == 'ssdlite' else ['boxes', 'labels', 'scores']
        import inspect
        kw = {'dynamo': False} if 'dynamo' in inspect.signature(torch.onnx.export).parameters else {}  # the classic exporter handles these models
        torch.onnx.export(m, ([x],), f, opset_version=17, input_names=['images'], output_names=names,
                          dynamic_axes={'images': {1: 'height', 2: 'width'}, 'boxes': {0: 'n'}, 'scores': {0: 'n'}, 'labels': {0: 'n'}}, **kw)
        files = [f.name]
        check = None
        try:  # the exported model gives the same boxes as PyTorch
            import onnxruntime as ort
            s = ort.InferenceSession(str(f), providers=['CPUExecutionProvider'])
            r = dict(zip(names, s.run(None, {'images': x.numpy()})))
            with torch.no_grad():
                ref = m([x])[0]
            from ..metrics import iou
            pt = [(b.tolist(), float(s)) for b, s in zip(ref['boxes'], ref['scores']) if s >= 0.2]
            ox = [(b.tolist(), float(s)) for b, s in zip(r['boxes'], r['scores']) if s >= 0.2]
            matched = sum(1 for b, s in pt if any(iou(b, c) > 0.95 and abs(s - t) < 0.02 for c, t in ox))  # the same boxes, whatever their order
            check = {'onnxruntime': ort.__version__, 'boxes_pytorch': len(pt), 'boxes_onnx': len(ox), 'matched': matched, 'ok': matched == len(pt) == len(ox)}
            if opts.get('int8'):
                from onnxruntime.quantization import QuantType, quantize_dynamic
                import logging
                lg = logging.getLogger(); lv = lg.level; lg.setLevel(logging.ERROR)  # it warns about every non-weight tensor
                try:
                    quantize_dynamic(str(f), str(out / 'model.int8.onnx'), weight_type=QuantType.QUInt8)
                finally:
                    lg.setLevel(lv)
                files.append('model.int8.onnx')
        except ImportError:
            check = 'pip install onnxruntime to check the export (and make an 8-bit copy)'
        (out / 'model.json').write_text(json.dumps({
            'name': opts.get('name') or f"{meta['dataset']} · {meta['arch']}", 'engine': self.id, 'arch': meta['arch'], 'license': self.license,
            'classes': meta['classes'], 'input': {'name': 'images', 'shape': ['3', 'height', 'width'], 'range': '0..1 RGB', 'resizedTo': [meta['imgsz'], meta['imgsz']]},
            'outputs': {k: v for k, v in zip(names, ['xyxy pixels of the input' if n == 'boxes' else ('0..1' if n == 'scores' else 'class number, 1 = classes[0]') for n in names])},
            'check': check, 'made': time.strftime('%Y-%m-%d %H:%M')}, indent=2))
        files.append('model.json')
        return files
