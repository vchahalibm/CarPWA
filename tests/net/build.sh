#!/bin/sh
# Builds the lab images by installing packages in a running container and committing it (BuildKit's RUN network can stall
# on some Docker setups; plain containers don't). Same result as the Dockerfiles in router/, peer/, stun/.
# APK_MIRROR=https://mirrors.aliyun.com/alpine ./build.sh   when the default Alpine mirror is slow from your network.
set -e
cd "$(dirname "$0")"
mk() { # name base packages entrypoint files...
  name=$1 base=$2 pkgs=$3 entry=$4; shift 4
  docker rm -f sglab-build >/dev/null 2>&1 || true
  docker run -d --name sglab-build "$base" sleep 3600 >/dev/null
  [ -n "$APK_MIRROR" ] && docker exec sglab-build sed -i "s#https\?://dl-cdn.alpinelinux.org/alpine#$APK_MIRROR#" /etc/apk/repositories
  docker exec sglab-build sh -c "apk add --no-cache $pkgs >/dev/null"
  for f in "$@"; do docker cp "$f" sglab-build:/; done
  docker commit -c "ENTRYPOINT $entry" -c 'CMD []' sglab-build "sglab-$name" >/dev/null
  docker rm -f sglab-build >/dev/null; echo "built sglab-$name"
}
[ "$1" = "-f" ] || [ -z "$(docker images -q sglab-router)" ] && mk router alpine:3.20 "iptables iproute2 bind-tools" '["/bin/sh","/router.sh"]' router/router.sh
[ "$1" = "-f" ] || [ -z "$(docker images -q sglab-stun)" ] && mk stun alpine:3.20 "coturn" '["turnserver","-n","--listening-port=3478","--fingerprint","--lt-cred-mech","--user=lab:lab","--realm=lab","--no-tls","--no-dtls","--no-cli","--log-file=stdout","--allow-loopback-peers"]'
[ "$1" = "-f" ] || [ -z "$(docker images -q sglab-peer)" ] && mk peer node:22-alpine "chromium font-noto iproute2" '["/bin/sh","/peer.sh"]' peer/agent.mjs peer/peer.sh
true
