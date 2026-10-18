# Connection tests across networks

The plan is in [docs/connection-tests.html](../../docs/connection-tests.html). Three tools here:

## 1. The network lab (Docker)

`node tests/net/lab.mjs [smoke|full]`

StudioGen's link side (the app with `?linktest=host`) and DriveGen run in headless Chromium, each in its own container behind its
own Linux router container, on a lab "internet" that also has a STUN/TURN server (coturn) and the app's web server. The relays
are the real public ones, reached through the routers. Router profiles (`router/router.sh`):

| Profile | What it does | Stands for |
|---|---|---|
| `home` | NAT keeping ports (MASQUERADE) | most home routers |
| `strict` | NAT with a new port per destination (`--random-fully`) | strict routers, many mobile carriers |
| `noudp` | no UDP out except DNS | office firewalls |
| `webonly` | only TCP 80/443 out | strict office networks |
| `BLOCK=host,…` | drops traffic to those hosts | a broker blocked on one side |
| `NETEM="delay 300ms loss 5%"` | a bad link | weak mobile signal |

Each scenario pairs the two, waits for them to see each other, lets a direct link form (or not), times a 200-row request and
compares the outcome (direct / turn / relay / fail) with what it should be. `smoke` (10 scenarios) takes a few minutes, `full`
adds every pair of profiles. The report: `tests/net/out/report.html` and `report.json`.

Images: `tests/net/build.sh` (`APK_MIRROR=https://mirrors.aliyun.com/alpine tests/net/build.sh` when the default Alpine mirror is
slow from your network; `-f` rebuilds). Needs Docker (OrbStack or Docker Desktop).

## 2. Real internet, every night

`.github/workflows/net-nightly.yml` runs `tests/net/remote.mjs` on GitHub's machines: a host (StudioGen's link side) on Linux and
guests (DriveGen) on Linux and macOS, different networks, pairing through a seed both derive from the run id and the `NET_SEED`
secret. Optional: `HOME_PAIR_CODE` (a pairing code made by your own StudioGen) also tests against your Mac. Results go to the run
summary. Locally: `CDP=9341 node tests/net/remote.mjs host SEED 2` and, in another terminal, `CDP=9342 node tests/net/remote.mjs guest SEED`
(with `python3 -m http.server 8811` in the repository).

## 3. On real devices

Settings › Connections › **Test the connection** in DriveGen and StudioGen: this network's router type, every relay, the link
to the other app, a verdict, and a JSON report to copy. The field checklist is in the plan (section 7).
