// node worker-eval.cjs "<js>", run inside a StudioGen Worker container started with --remote-debugging-port=9222 (tests/tandem/journeys.mjs, act “worker”): evaluates in its page
const js = process.argv[2];
(async () => { const l = await (await fetch('http://127.0.0.1:9222/json')).json(); const t = l.find(x => x.type === 'page' && x.url.includes('index.html'));
const s = new WebSocket(t.webSocketDebuggerUrl);
s.onopen = () => s.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: js, awaitPromise: true, returnByValue: true } }));
s.onmessage = m => { const d = JSON.parse(m.data); if (d.id !== 1) return; console.log(JSON.stringify(d.result?.result?.value ?? d.result?.exceptionDetails?.exception?.description ?? d)); process.exit(0); }; })();
