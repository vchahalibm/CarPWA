"""Training engines. Each: id, name, license, note, available() -> (ok, why), params (defaults the page offers),
train(job, datasets, dataset_name, params, run_dir) -> summary, predict(run_dir, image_path, conf) -> boxes,
export(run_dir, opts) -> [files]."""
from .torchvision_det import TorchvisionEngine
from .ultralytics_yolo import UltralyticsEngine

ENGINES = {e.id: e for e in (TorchvisionEngine(), UltralyticsEngine())}
