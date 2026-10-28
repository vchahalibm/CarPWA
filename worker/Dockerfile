# StudioGen Worker (worker/README.md): StudioGen without a screen, in a Linux container.
#   docker build -f worker/Dockerfile -t studiogen-worker .        (from the repo root)
FROM node:22-bookworm-slim
# what Electron (Chromium) needs on Linux, and a virtual screen (Xvfb)
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb tini libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxtst6 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 libcups2 libsecret-1-0 fonts-liberation fonts-noto-color-emoji ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY desktop/package.json desktop/
RUN cd desktop && npm install --no-save --no-audit --no-fund electron@$(node -p "require('./package.json').devDependencies.electron") \
  && node node_modules/electron/install.js && npm cache clean --force   # the binary now, not at the first start
COPY . .
RUN mkdir -p /data && chown node:node /data
USER node
ENV SG_WORKER=1 SG_DATA=/data ELECTRON_DISABLE_SECURITY_WARNINGS=1
VOLUME /data
# a 1440×900 screen nobody looks at, StudioGen in it (worker/start.sh; tini reaps what Chromium leaves). Seen and used from
# your devices (Mesh › See its screen). Arguments after the image name go to StudioGen.
ENTRYPOINT ["/usr/bin/tini", "--", "/app/worker/start.sh"]
