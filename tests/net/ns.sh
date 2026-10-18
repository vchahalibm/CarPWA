#!/bin/sh
# The network lab inside one privileged container, with Linux network namespaces (no Docker networking in the way):
#   root namespace = "the internet": bridge wan0 172.31.0.1/24, coturn (STUN/TURN) and the web server on it, and NAT out to the
#   real internet (for the public relays);  per scenario i and side x (a = StudioGen, b = DriveGen):
#     namespace rXi: the router, veth on wan0 (172.31.0.<10+2i+side>) and a LAN 10.<i>.<side>.1/24, NAT/firewall profile
#     namespace pXi: the device, 10.<i>.<side>.10, default route via its router; headless Chromium runs here.
#   ns.sh init                                   once: the internet side
#   ns.sh up <i> <profile-a> <profile-b> [blockA] [blockB]
#   ns.sh down <i>
#   ns.sh peer <ns> start <url> | eval '<js>'    the agent inside a device namespace
set -e
cmd=$1; shift
case "$cmd" in
init)
  sysctl -w net.ipv4.ip_forward=1 >/dev/null
  ip link show wan0 >/dev/null 2>&1 || { ip link add wan0 type bridge; ip addr add 172.31.0.1/24 dev wan0; ip link set wan0 up; }
  OUT=$(ip route | awk '/^default/ {print $5; exit}')
  iptables -t nat -C POSTROUTING -s 172.31.0.0/24 -o "$OUT" -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 172.31.0.0/24 -o "$OUT" -j MASQUERADE
  pgrep turnserver >/dev/null || turnserver -n --listening-ip=172.31.0.1 --listening-port=3478 --fingerprint --lt-cred-mech --user=lab:lab --realm=lab --no-tls --no-dtls --no-cli --allow-loopback-peers --log-file=/tmp/turn.log >/dev/null 2>&1 &
  pgrep -f "web.mjs" >/dev/null || (node /app/tests/net/web.mjs >/tmp/web.log 2>&1 &)
  sleep 1; echo "internet ready ($OUT)" ;;
up)
  i=$1 pa=$2 pb=$3 ba=$4 bb=$5
  side() { # x side-number profile block
    x=$1 s=$2 prof=$3 block=$4 r="r$x$i" p="p$x$i" wanip="172.31.0.$((10 + 2 * i + s))" lan="10.$i.$s"
    ip netns add "$r"; ip netns add "$p"
    ip link add "w$x$i" type veth peer name "wr$x$i"; ip link set "w$x$i" master wan0 up; ip link set "wr$x$i" netns "$r"
    ip link add "l$x$i" type veth peer name "lp$x$i"; ip link set "l$x$i" netns "$r"; ip link set "lp$x$i" netns "$p"
    ip -n "$r" addr add "$wanip/24" dev "wr$x$i"; ip -n "$r" link set "wr$x$i" up; ip -n "$r" link set lo up
    ip -n "$r" addr add "$lan.1/24" dev "l$x$i"; ip -n "$r" link set "l$x$i" up; ip -n "$r" route add default via 172.31.0.1
    ip -n "$p" addr add "$lan.10/24" dev "lp$x$i"; ip -n "$p" link set "lp$x$i" up; ip -n "$p" link set lo up; ip -n "$p" route add default via "$lan.1"
    mkdir -p "/etc/netns/$p"; printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > "/etc/netns/$p/resolv.conf"
    ip netns exec "$r" sysctl -w net.ipv4.ip_forward=1 >/dev/null
    W="wr$x$i" L="l$x$i" R="ip netns exec $r iptables"
    case "$prof" in strict) $R -t nat -A POSTROUTING -o "$W" -j MASQUERADE --random-fully ;; *) $R -t nat -A POSTROUTING -o "$W" -j MASQUERADE ;; esac
    [ "$prof" = home ] && $R -t nat -A PREROUTING -i "$W" -p udp -j DNAT --to-destination "$lan.10"   # easy NAT: unsolicited UDP to the device
    case "$prof" in
      noudp)   $R -A FORWARD -i "$L" -p udp --dport 53 -j ACCEPT; $R -A FORWARD -i "$L" -p udp -j DROP ;;
      webonly) $R -A FORWARD -i "$L" -p udp --dport 53 -j ACCEPT; $R -A FORWARD -i "$L" -p tcp -m multiport --dports 80,443 -j ACCEPT
               $R -A FORWARD -i "$L" -d 172.31.0.1 -p tcp --dport 8000 -j ACCEPT; $R -A FORWARD -i "$L" -j DROP ;;
    esac
    for h in $(echo "$block" | tr ',' ' '); do for a in $(getent ahostsv4 "$h" | awk '{print $1}' | sort -u); do $R -I FORWARD -i "$L" -d "$a" -j DROP; done; done
  }
  side a 1 "$pa" "$ba"; side b 2 "$pb" "$bb"; echo "scenario $i up: $pa / $pb" ;;
down)
  i=$1
  # (the space after the name: pa1 must not also match pa10…)
  for x in a b; do pkill -f "user-data-dir=/tmp/prof-p$x$i " 2>/dev/null || true; ip netns del "r$x$i" 2>/dev/null || true; ip netns del "p$x$i" 2>/dev/null || true; ip link del "w$x$i" 2>/dev/null || true; rm -rf "/etc/netns/p$x$i" "/tmp/prof-p$x$i"; done ;;
peer)
  ns=$1; shift; exec ip netns exec "$ns" env PROFILE_DIR="/tmp/prof-$ns" node /agent.mjs "$@" ;;
esac
