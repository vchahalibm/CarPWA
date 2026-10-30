# StudioGen Worker

StudioGen without a screen, in a Linux container. It is one of your own StudioGens: it keeps its own sign-ins (for example a WhatsApp or a work account you don't want on your Mac), runs tasks for your devices, and shares what you share with the mesh. You set it up and use it from your other devices. Design: [docs/studiogbee.html](../docs/studiogbee.html) § 8.

**Not there, compared with StudioGen on a Mac:**
- Apple's on-device model. Nothing is needed instead: the Worker uses **your Mac's language model** (gpt-oss, StudioGen › Settings › Assistant › Language model) through the mesh.
- Apple speech, the 3D assistant and the voice.
- AppleScript and Shortcuts.

**Signing in:** only from afar (**Mesh › See its screen / Its agent browser**), since nobody sits at it.

## 1. An invite for it

On your Mac: **StudioGen › Mesh › Invite › One of my own devices**. Copy the text (`SGM…`).

This kind of invite marks the Worker as yours on that Mac, and the Mac as yours on the Worker. Your Mac then tells the Worker which other devices are yours (your iPhone, your iPad), so they can run its tasks.

## 2. A secret for its sign-ins

```
openssl rand -hex 32 > worker/sg_secret.txt
```

This secret locks the sign-ins it keeps. Keep the file: without it, the Worker forgets its sign-ins when it restarts.

## 3. Run it

Fill in `SG_MESH_INVITE` in `worker/docker-compose.yml`, then from the repo root:

```
docker compose -f worker/docker-compose.yml up -d --build
```

Or with plain Docker:

```
docker build -f worker/Dockerfile -t studiogen-worker .
docker run -d --name studiogen-worker --restart unless-stopped --shm-size 1g \
  -e SG_NAME="My Worker" -e SG_MESH_INVITE="SGM…" -e SG_SECRET="$(cat worker/sg_secret.txt)" \
  -v studiogen-worker:/data studiogen-worker
```

It joins your mesh by itself. In a minute it shows in **Mesh › Devices** as yours.

| Setting | What it is |
|---|---|
| `SG_NAME` | Its name in the mesh |
| `SG_MESH_INVITE` | The invite from step 1. It's used once; after that the Worker stays in the mesh. |
| `SG_LLM_PROVIDER` | Only to use another model than your Mac's: `openai` (an OpenAI-compatible server) or `anthropic` (Claude) |
| `SG_LLM_URL`, `SG_LLM_MODEL` | For `openai`: the server and model. Ollama on the Mac running Docker is `http://host.docker.internal:11434/v1`. |
| `SG_LLM_KEY` | For Claude: your Anthropic key |
| `SG_SECRET` or `SG_SECRET_FILE` | Locks its kept sign-ins (step 2) |
| `SG_PRACTICE=1` | Use the practice sites (for trying things out) |

## 4. Sign in and use it

- **Sign in:** on your iPhone, iPad or Mac, open **Mesh › Who's around** (or **Mesh › Devices**) › your Worker › **Its agent browser**. Its page shows live; tap where you would click, type in the box, and sign in to Outlook, WhatsApp (scan its QR code with your phone), Slack, Teams… Tap **Done**.
  - This needs a direct link, so be on the same network as the machine running Docker.
  - While someone is looking, the Worker's own screen shows who it is, with Stop.
- **See and set up the whole app:** **See its screen**. This is how you reach its Settings (containers, tasks to share, and so on).
- **Side by side:** like StudioGen, it runs up to 3 tasks at once (one per site); their cards are all written by your Mac's model.
- **Ask:** your devices find its tasks the same way as your Mac's. For one of its tasks, "unread WhatsApp" goes to the Worker.

## Where its data is

Everything is in the `/data` volume: settings, tasks, the sign-ins (locked with your secret), and its mesh identity. Back that volume up together with `sg_secret.txt`. Removing the volume makes a new device, which needs a new invite.
