"""Datasets in YOLO format, one folder each under data/:

    data/<name>/classes.txt          one class name per line (the order is the class number)
    data/<name>/images/<file>.png    the pictures (png, jpg, webp)
    data/<name>/labels/<file>.txt    one box per line: "<class> <cx> <cy> <w> <h>", all 0..1 of the picture

The same layout Ultralytics, Roboflow exports and most tools read, so data moves in and out freely.
"""
from __future__ import annotations

import io
import json
import random
import re
import shutil
import zipfile
from pathlib import Path

from PIL import Image

IMAGE_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.bmp'}
# What a web page's controls are, for a screen-element detector (the default for new datasets and web captures).
UI_CLASSES = ['button', 'link', 'input', 'checkbox', 'select', 'tab', 'icon', 'image']
NAME_RE = re.compile(r'^[\w][\w .-]{0,63}$')


def safe_name(name: str) -> str:
    name = (name or '').strip()
    if not NAME_RE.match(name) or '..' in name:
        raise ValueError('Use letters, numbers, spaces, dots, dashes or underscores (up to 64)')
    return name


class Datasets:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    # ---------- folders ----------
    def path(self, name: str) -> Path:
        p = self.root / safe_name(name)
        if not p.is_dir():
            raise FileNotFoundError(f'No dataset called {name}')
        return p

    def create(self, name: str, classes: list[str] | None = None) -> dict:
        p = self.root / safe_name(name)
        if p.exists():
            raise FileExistsError(f'A dataset called {name} already exists')
        (p / 'images').mkdir(parents=True)
        (p / 'labels').mkdir()
        self.set_classes(name, classes or UI_CLASSES)
        return self.info(name)

    def delete(self, name: str):
        shutil.rmtree(self.path(name))

    def classes(self, name: str) -> list[str]:
        f = self.path(name) / 'classes.txt'
        return [c.strip() for c in f.read_text().splitlines() if c.strip()] if f.exists() else []

    def set_classes(self, name: str, classes: list[str]):
        (self.root / safe_name(name) / 'classes.txt').write_text('\n'.join(c.strip() for c in classes if c.strip()) + '\n')

    def images(self, name: str) -> list[str]:
        return sorted(f.name for f in (self.path(name) / 'images').iterdir() if f.suffix.lower() in IMAGE_EXT)

    def info(self, name: str) -> dict:
        imgs = self.images(name)
        labeled, boxes, per = 0, 0, {}
        for f in imgs:
            b = self.labels(name, f)
            labeled += bool(b)
            boxes += len(b)
            for x in b:
                per[x['c']] = per.get(x['c'], 0) + 1
        cls = self.classes(name)
        return {'name': name, 'images': len(imgs), 'labeled': labeled, 'boxes': boxes, 'classes': cls,
                'perClass': {cls[k] if k < len(cls) else str(k): v for k, v in sorted(per.items())}}

    def all(self) -> list[dict]:
        return [self.info(p.name) for p in sorted(self.root.iterdir()) if p.is_dir() and (p / 'images').is_dir()]

    # ---------- files ----------
    def add_image(self, name: str, filename: str, data: bytes) -> str:
        filename = Path(filename).name
        stem, ext = Path(filename).stem, Path(filename).suffix.lower()
        if ext not in IMAGE_EXT:
            raise ValueError(f'{filename}: not a picture (png, jpg, webp)')
        Image.open(io.BytesIO(data)).verify()  # a real picture, not anything else
        stem = re.sub(r'[^\w.-]', '_', stem)[:80] or 'image'
        out, k = self.path(name) / 'images' / f'{stem}{ext}', 1
        while out.exists():
            out, k = self.path(name) / 'images' / f'{stem}_{k}{ext}', k + 1
        out.write_bytes(data)
        return out.name

    def import_zip(self, name: str, data: bytes) -> dict:
        """A zip in YOLO layout (images/, labels/, classes.txt or data.yaml names), at the top or one folder down."""
        added, labeled = 0, 0
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            files = [i for i in z.infolist() if not i.is_dir() and '__MACOSX' not in i.filename]
            cls = next((i for i in files if i.filename.endswith('classes.txt')), None)
            if cls and not self.images(name):
                self.set_classes(name, z.read(cls).decode('utf-8', 'replace').splitlines())
            labels = {Path(i.filename).stem: i for i in files if i.filename.endswith('.txt') and '/labels/' in '/' + i.filename}
            for i in files:
                if Path(i.filename).suffix.lower() not in IMAGE_EXT:
                    continue
                saved = self.add_image(name, Path(i.filename).name, z.read(i))
                added += 1
                lab = labels.get(Path(i.filename).stem)
                if lab:
                    (self.path(name) / 'labels' / (Path(saved).stem + '.txt')).write_bytes(z.read(lab))
                    labeled += 1
        return {'added': added, 'labeled': labeled}

    def export_zip(self, name: str) -> bytes:
        buf, p = io.BytesIO(), self.path(name)
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
            z.write(p / 'classes.txt', 'classes.txt')
            for f in self.images(name):
                z.write(p / 'images' / f, f'images/{f}')
                lab = p / 'labels' / (Path(f).stem + '.txt')
                if lab.exists():
                    z.write(lab, f'labels/{lab.name}')
        return buf.getvalue()

    def image_path(self, name: str, filename: str) -> Path:
        f = self.path(name) / 'images' / Path(filename).name
        if not f.exists():
            raise FileNotFoundError(filename)
        return f

    def delete_image(self, name: str, filename: str):
        self.image_path(name, filename).unlink()
        lab = self.path(name) / 'labels' / (Path(filename).stem + '.txt')
        lab.unlink(missing_ok=True)

    # ---------- labels ----------
    def labels(self, name: str, filename: str) -> list[dict]:
        f = self.path(name) / 'labels' / (Path(filename).stem + '.txt')
        out = []
        if f.exists():
            for line in f.read_text().splitlines():
                p = line.split()
                if len(p) >= 5:
                    try:
                        out.append({'c': int(float(p[0])), 'x': float(p[1]), 'y': float(p[2]), 'w': float(p[3]), 'h': float(p[4])})
                    except ValueError:
                        pass
        return out

    def set_labels(self, name: str, filename: str, boxes: list[dict]):
        self.image_path(name, filename)
        clamp = lambda v: min(1.0, max(0.0, float(v)))
        lines = [f"{int(b['c'])} {clamp(b['x']):.6f} {clamp(b['y']):.6f} {clamp(b['w']):.6f} {clamp(b['h']):.6f}"
                 for b in boxes if float(b['w']) > 0 and float(b['h']) > 0]
        (self.path(name) / 'labels' / (Path(filename).stem + '.txt')).write_text('\n'.join(lines) + ('\n' if lines else ''))

    # ---------- for training ----------
    def split(self, name: str, val: float = 0.15, seed: int = 0) -> tuple[list[str], list[str]]:
        """Labeled pictures, split into training and validation (the same split every time for a dataset)."""
        items = [f for f in self.images(name) if self.labels(name, f)]
        random.Random(seed).shuffle(items)
        n_val = max(1, int(len(items) * val)) if len(items) > 4 else 0
        return items[n_val:], items[:n_val] or items[:1]

    def write_yaml(self, name: str, train: list[str], val: list[str], out: Path) -> Path:
        """A data.yaml for engines that want one (Ultralytics), with list files for the split."""
        p = self.path(name)
        out.mkdir(parents=True, exist_ok=True)
        (out / 'train.txt').write_text('\n'.join(str(p / 'images' / f) for f in train) + '\n')
        (out / 'val.txt').write_text('\n'.join(str(p / 'images' / f) for f in val) + '\n')
        y = out / 'data.yaml'
        y.write_text(f"path: {p}\ntrain: {out / 'train.txt'}\nval: {out / 'val.txt'}\nnames: {json.dumps(self.classes(name))}\n")
        return y
