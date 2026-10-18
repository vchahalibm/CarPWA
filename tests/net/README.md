# Connection tests across networks

The plan is in [docs/connection-tests.html](../../docs/connection-tests.html). Three tools here:

## 1. The network lab (Docker)

`node tests/net/lab.mjs [smoke|full] [--only=0,3] [--keep]`

Everything runs inside one privileged container (`sglab-netlab`) with Linux network namespaces (`ns.sh`), so Docker's own
networking can't get in the way: the container's root namespace is the lab's "internet" (a bridge, coturn for STUN/TURN, the
app's web server, and NAT out to the real internet for the public relays); each scenario adds, per side, a router namespace with
a NAT/firewall profile and a device namespace where headless Chromium runs the app (StudioGen's link side with `?linktest=host`,
or DriveGen). Router profiles:

| Profile | What it does | Stands for |
|---|---|---|
| `home` | NAT keeping ports; unsolicited UDP goes to the device (endpoint-independent filtering) | most home routers |
| `restricted` | plain Linux NAT: replies only from where it sent | stricter home routers |
| `strict` | NAT with a new port per destination (`--random-fully`) | strict routers, many mobile carriers |
| `noudp` | no UDP out except DNS | office firewalls |
| `webonly` | only TCP 80/443 out | strict office networks |
| `blockA`/`blockB` | drops traffic to chosen hosts | a broker blocked on one side |

Each scenario pairs the two, waits for them to see each other, lets a direct link form (or not), times a 200-row request and
compares the outcome (direct / turn / relay / fail) with what it should be. `smoke` (11 scenarios) takes a few minutes, `full`
adds every pair of profiles. The report: `tests/net/out/report.html` and `report.json`.

The image: `tests/net/build.sh` (`APK_MIRROR=https://mirrors.aliyun.com/alpine tests/net/build.sh` when the default Alpine mirror
is slow from your network; `-f` rebuilds). Needs Docker (OrbStack or Docker Desktop).

Why namespaces: on OrbStack, containers on separate Docker networks could reach each other through the Docker host, behind the
lab routers' backs, which made direct links look possible when they weren't (and broke the NAT of replies).

## 2. Real internet, every night

`.github/workflows/net-nightly.yml` runs `tests/net/remote.mjs` on GitHub's machines: a host (StudioGen's link side) on Linux and
guests (DriveGen) on Linux and macOS, different networks, pairing through a seed both derive from the run id and the `NET_SEED`
secret. Optional: `HOME_PAIR_CODE` (a pairing code made by your own StudioGen) also tests against your Mac. Results go to the run
summary. Locally: `CDP=9341 node tests/net/remote.mjs host SEED 2` and, in another terminal, `CDP=9342 node tests/net/remote.mjs guest SEED`
(with `python3 -m http.server 8811` in the repository).

## 3. On real devices

Settings › Connections › **Test the connection** in DriveGen and StudioGen: this network's router type, every relay, the link
to the other app, a verdict, and a JSON report to copy. The field checklist is in the plan (section 7).
