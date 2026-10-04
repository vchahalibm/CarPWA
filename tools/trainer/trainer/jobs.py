"""Background jobs (training, web captures, exports): each runs in a thread and keeps a list of events the page reads
as a live stream (Server-Sent Events). One training at a time; the Mac's GPU is shared."""
from __future__ import annotations

import threading
import time
import traceback
import uuid


class Job:
    def __init__(self, kind: str, title: str):
        self.id, self.kind, self.title = uuid.uuid4().hex[:10], kind, title
        self.events: list[dict] = []
        self.state = 'running'  # running | done | failed | stopped
        self.result = None
        self.started = time.time()
        self._stop = threading.Event()
        self._cv = threading.Condition()

    @property
    def stopping(self) -> bool:
        return self._stop.is_set()

    def stop(self):
        self._stop.set()
        self.emit({'type': 'log', 'msg': 'Stopping after this step…'})

    def emit(self, ev: dict):
        with self._cv:
            self.events.append({'t': round(time.time() - self.started, 2), **ev})
            self._cv.notify_all()

    def log(self, msg: str):
        self.emit({'type': 'log', 'msg': msg})

    def wait(self, after: int, timeout: float = 15.0) -> list[dict]:
        with self._cv:
            if len(self.events) <= after and self.state == 'running':
                self._cv.wait(timeout)
            return self.events[after:]

    def summary(self) -> dict:
        return {'id': self.id, 'kind': self.kind, 'title': self.title, 'state': self.state, 'started': self.started,
                'events': len(self.events), 'result': self.result}


class Jobs:
    def __init__(self):
        self.all: dict[str, Job] = {}
        self.lock = threading.Lock()

    def busy(self, kind: str) -> Job | None:
        return next((j for j in self.all.values() if j.kind == kind and j.state == 'running'), None)

    def start(self, kind: str, title: str, fn) -> Job:
        with self.lock:
            if kind == 'train' and self.busy('train'):
                raise RuntimeError('A training is already running: stop it first')
            job = Job(kind, title)
            self.all[job.id] = job

        def run():
            try:
                job.result = fn(job)
                job.state = 'stopped' if job.stopping else 'done'
                job.emit({'type': 'done', 'state': job.state, 'result': job.result})
            except Exception as e:  # reported to the page, with the details for the log
                job.state = 'failed'
                job.emit({'type': 'error', 'msg': str(e), 'trace': traceback.format_exc()[-2000:]})
        threading.Thread(target=run, daemon=True, name=f'{kind}-{job.id}').start()
        return job
