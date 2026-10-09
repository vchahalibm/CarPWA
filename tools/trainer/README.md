# DriveDeck Trainer

A local tool to train your **own object detector** (for DriveDeck: a model that finds buttons, links, fields, tabs… on a
screen) on your Mac: an HTML page on top of a small Python server. Everything stays on your computer.

```bash
cd tools/trainer
python3 -m venv .venv && source .venv/bin/activate     # optional, keeps it tidy
pip install -r requirements.txt
playwright install chromium                            # for Capture web pages
python3 server.py                                      # → open http://127.0.0.1:8765
```

On a Mac with Apple silicon (M-series), PyTorch trains on the GPU (MPS) by itself; the page shows the device in use.
The server only listens on 127.0.0.1 and refuses changes asked for by other sites.

## The tabs

1. **Datasets**: make one (the default classes are screen elements: button, link, input, checkbox, select, tab, icon,
   image), see how many pictures and boxes each class has, download it as a zip, change the classes.
2. **Label**: add pictures (or a zip in YOLO layout), then draw boxes. Drag to draw, 1–9 picks the class, click to select,
   drag to move, Delete removes, ← → next/previous (saves). **Pre-label with a model** fills in boxes from a model you
   trained already: check them, fix the misses, save. Each round of training makes the next round of labeling faster.
3. **Capture web pages**: give it addresses of **your own** pages (e.g. DriveDeck's `samples/demo-page.html` served
   locally) and it screenshots them at the screen sizes and themes you pick and labels every visible control from the
   page itself. Hundreds of labeled pictures in minutes; add a few hand-labeled screenshots of other apps for variety.
4. **Train**: pick the dataset and the engine:
   - **torchvision** (BSD-3-Clause, the default): **SSDLite MobileNetV3** (small and fast, the one to run in a browser)
     or **Faster R-CNN MobileNetV3** (better on small elements, slower). Starts from ImageNet weights (downloaded once).
   - **Ultralytics YOLO** (optional, `pip install ultralytics`): very good results quickly, but **AGPL-3.0**: models
     trained with it are AGPL too, unless you buy their licence.
   A live chart shows the loss and mAP50 (how many boxes it finds, at 50% overlap); Stop keeps the best model so far.
5. **Models**: every run, its chart and per-class accuracy; **test** it on any picture with a confidence slider; **export**
   it as `model.onnx` (+ an 8-bit `model.int8.onnx`, about a third the size) and `model.json` (classes, input, outputs).
   The export is checked against PyTorch with onnxruntime.

## The exported model

`model.onnx` from the torchvision engine takes **one picture** as `images` `[3, height, width]`, RGB 0..1, any size (it
resizes inside), and returns `boxes` (x0, y0, x1, y1 in the picture's pixels), `scores` and `labels` (1 = the first class
in `model.json`), already filtered (non-maximum suppression inside). onnxruntime-web runs it in a browser worker.

**In DriveDeck** (the Mac app): Settings › Scripts › Screen-element model › choose `model.onnx` (or `model.int8.onnx`)
and `model.json`. When a recorded web step's element can't be found any more (renamed or moved), DriveDeck screenshots
the web widget, finds a control of the same kind (button, link, input…) near where it was and about the same size, and
clicks it. Keep the class names (`button`, `link`, `input`, `checkbox`, `select`, `tab`, `icon`, `image`) so it can tell
what kind of control a step needs.

## Tips

- 300–1000 labeled screenshots with a few thousand boxes give a useful screen-element detector; capture your pages at
  several sizes and both themes, and add screenshots of the other apps you'll demo.
- Picture size 512–640 for screens (elements are small); batch 8 on a Mac is a good start; 60–100 epochs.
- Folders: `data/<dataset>/` (images, labels, classes.txt) and `runs/<run>/` (best.pt, history, export/); both are
  ignored by git.
