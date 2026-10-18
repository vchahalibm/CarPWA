# A Linux router for the network lab: NAT and firewall profiles (router.sh), delay/loss with tc.
FROM alpine:3.20
RUN apk add --no-cache iptables iproute2 bind-tools
COPY router.sh /router.sh
ENTRYPOINT ["/bin/sh", "/router.sh"]
