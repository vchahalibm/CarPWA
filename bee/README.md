# StudioGBee

The optional always-on hive for a StudioGen mesh. A team runs one, so that:

- a request for a Mac (or StudioGen) that is offline **waits** there, and the answer comes back when it's online again, even if the asking app was closed;
- a DriveGen that is away gets a **notification**: “your answer is ready”;
- each StudioGen keeps a **backup** of its tasks, scripts and motions there;
- **another team's bee** can be linked, so messages between devices on the two bees are passed along;
- mesh owners see the mesh's activity on a **dashboard**: who is online, what waits, what flowed (never the contents).

It only ever sees sealed messages: who, to whom, what kind, how big, when. It holds no sign-ins and runs no tasks. Without one, the apps work as before. Design: [docs/studiogbee.html](../docs/studiogbee.html).

## Run it (Docker)

```
docker build -t studiogbee bee
docker run -d --name studiogbee --restart unless-stopped -p 8840:8840 -v studiogbee:/data studiogbee
docker logs studiogbee        # shows the admin code
```

Or `docker compose -f bee/docker-compose.yml up -d`. Without Docker: `cd bee && npm install && node server.mjs`.

Settings (environment): `BEE_NAME` (shown in the apps), `BEE_ADMIN_CODE` (otherwise one is made at the first start and kept), `BEE_CONTACT` (a `mailto:` for the push services), `PORT` (8840), `BEE_DATA` (`/data` in Docker).

## Add it to your mesh

In StudioGen (as a mesh owner): **Settings › Connections › StudioGBee › Add a StudioGBee**, with the address (`http://localhost:8840` when it runs on the same Mac) and the admin code. The mesh's other devices connect to it by themselves.

**Phones need https.** DriveGen is served over https, so it can only reach a bee at an `https://` address. Ways to give it one:

- **Tailscale** on the Mac running Docker: `tailscale serve --bg 8840`, then add the bee as `https://<mac-name>.<tailnet>.ts.net`. Only your tailnet's devices can reach it. Use `tailscale funnel` to reach it from anywhere.
- **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:8840` gives a public https address.
- A server with a reverse proxy (Caddy, nginx) and a certificate.

StudioGen on the same Mac can use `http://localhost:8840`. The address a phone uses must be the one in the mesh's list, so add the https one.

## The dashboard

`<bee address>/dashboard`. Sign in with a code from StudioGen (**StudioGBee › Dashboard code**, valid once for 10 minutes). Then **Settings › Add a passkey** lets you sign in with Face ID or Touch ID next time; the code stays as the fallback. Passkeys need https (or localhost).

Tabs: Overview (online, waiting, today, alerts), Live (who is connected and through which bee), Queue (what waits, with Drop), Devices, Activity (searchable), Bees (linked bees: accept, unlink), History (7 days), Settings (how long activity is kept, notifications, passkeys).

## Linking another team's bee

1. Owner A: StudioGBee › **Link another team's bee** gives a code. Send it to owner B.
2. Owner B: StudioGBee › **Paste a link code**. B's bee asks A's to link.
3. Owner A accepts in the dashboard (Bees) or in StudioGen. Until then, nothing is passed between the bees.

Both bees must know the mesh: each team's owner adds their own bee to the same mesh.

## What it keeps

`/data/state.json` (the mesh's roster as signed by its owners, push subscriptions, sealed backups, linked bees, passkeys), `queue.json` (sealed messages waiting, until they expire: at most 7 days), `events.json` (metadata, kept 7 days by default). Back up the `/data` volume to move the bee to another machine.
