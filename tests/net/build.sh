#!/bin/sh
# Builds the lab image sglab-netlab: a ready-made Alpine Chromium image (zenika/alpine-chrome:with-node), Node 22 copied in for
# the agent (peer/agent.mjs), and iptables, iproute2 and coturn for the namespaces, routers and STUN/TURN of tests/net/ns.sh.
# Done by installing in a running container and committing it (BuildKit's RUN network can stall on some Docker setups).
#   tests/net/build.sh [-f]            APK_MIRROR=https://mirrors.aliyun.com/alpine when the default Alpine mirror is slow for you
set -e
cd "$(dirname "$0")"
[ "$1" = "-f" ] || [ -z "$(docker images -q sglab-netlab)" ] || exit 0
docker pull -q zenika/alpine-chrome:with-node >/dev/null 2>&1 || true; docker pull -q node:22-alpine >/dev/null 2>&1 || true
docker rm -f sglab-build sglab-node >/dev/null 2>&1 || true
docker create --name sglab-node node:22-alpine >/dev/null && docker cp sglab-node:/usr/local/bin/node /tmp/sglab-node22 && docker rm sglab-node >/dev/null
docker run -d --name sglab-build --user root --entrypoint sleep zenika/alpine-chrome:with-node 3600 >/dev/null
docker cp /tmp/sglab-node22 sglab-build:/usr/local/bin/node && rm -f /tmp/sglab-node22
docker cp peer/agent.mjs sglab-build:/agent.mjs
[ -n "$APK_MIRROR" ] && docker exec sglab-build sed -i "s#https\?://dl-cdn.alpinelinux.org/alpine#$APK_MIRROR#" /etc/apk/repositories
docker exec sglab-build sh -c 'ln -sf /usr/local/bin/node /usr/bin/node; apk add --no-cache iptables iproute2 coturn >/dev/null; node -v'
docker commit -c 'USER root' -c 'ENTRYPOINT ["sleep","infinity"]' -c 'CMD []' sglab-build sglab-netlab >/dev/null
docker rm -f sglab-build >/dev/null; echo "built sglab-netlab"
