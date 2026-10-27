# StudioGBee (bee/README.md): docker build -t studiogbee bee && docker run -d --name studiogbee -p 8840:8840 -v studiogbee:/data studiogbee
FROM node:22-alpine
WORKDIR /bee
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /data && chown node:node /data
COPY server.mjs ./
COPY public ./public
ENV BEE_DATA=/data PORT=8840
VOLUME /data
EXPOSE 8840
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8840/healthz >/dev/null || exit 1
CMD ["node", "server.mjs"]
