"""Detection quality: average precision per class (the area under precision/recall, VOC-style all-point interpolation)
at one or several IoU thresholds. Boxes are [x0, y0, x1, y1] in any one unit per picture."""
from __future__ import annotations


def iou(a, b) -> float:
    ix, iy = max(0.0, min(a[2], b[2]) - max(a[0], b[0])), max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0.0


def average_precision(preds, truths, cls: int, thr: float) -> float | None:
    """preds/truths: per picture, lists of (cls, box[, score]). None if the class never appears."""
    n_true = sum(1 for t in truths for x in t if x[0] == cls)
    if not n_true:
        return None
    dets = sorted(((p[2], i, p[1]) for i, ps in enumerate(preds) for p in ps if p[0] == cls), key=lambda d: -d[0])
    used = [[False] * len(t) for t in truths]
    tp, fp = [], []
    for _, i, box in dets:
        best, bj = 0.0, -1
        for j, t in enumerate(truths[i]):
            if t[0] != cls or used[i][j]:
                continue
            o = iou(box, t[1])
            if o > best:
                best, bj = o, j
        if best >= thr:
            used[i][bj] = True
            tp.append(1); fp.append(0)
        else:
            tp.append(0); fp.append(1)
    # precision/recall curve, then the area under its upper envelope
    rec, prec, ctp, cfp = [], [], 0, 0
    for a, b in zip(tp, fp):
        ctp += a; cfp += b
        rec.append(ctp / n_true); prec.append(ctp / (ctp + cfp))
    mrec, mpre = [0.0] + rec + [1.0], [0.0] + prec + [0.0]
    for k in range(len(mpre) - 2, -1, -1):
        mpre[k] = max(mpre[k], mpre[k + 1])
    return sum((mrec[k + 1] - mrec[k]) * mpre[k + 1] for k in range(len(mrec) - 1))


def evaluate(preds, truths, n_classes: int) -> dict:
    """mAP@0.5, mAP@0.5:0.95 and AP@0.5 per class."""
    per = {}
    for c in range(n_classes):
        ap = average_precision(preds, truths, c, 0.5)
        if ap is not None:
            per[c] = ap
    m50 = sum(per.values()) / len(per) if per else 0.0
    thrs = [0.5 + 0.05 * k for k in range(10)]
    allap = [a for c in per for a in [average_precision(preds, truths, c, t) for t in thrs] if a is not None]
    return {'map50': m50, 'map': sum(allap) / len(allap) if allap else 0.0, 'perClass': per}
