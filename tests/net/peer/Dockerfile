# An app in the network lab: headless Chromium driven by agent.mjs (start, eval) behind a lab router.
FROM node:22-alpine
RUN apk add --no-cache chromium font-noto iproute2
COPY agent.mjs /agent.mjs
COPY peer.sh /peer.sh
ENTRYPOINT ["/bin/sh", "/peer.sh"]
