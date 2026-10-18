#!/bin/sh
# PROFILE: home | strict | noudp | webonly; BLOCK: comma-separated hosts to drop; NETEM: tc netem args (e.g. "delay 300ms loss 5%")
# WAN_NET: the wan subnet prefix (e.g. 172.31.0.) to find the wan interface; the other interface is the LAN.
set -e
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
until ip -4 -o addr | grep -q "inet ${WAN_NET}"; do sleep 0.3; done   # wait to be connected to the wan
WAN=$(ip -4 -o addr | awk -v p="$WAN_NET" 'index($4,p)==1 {print $2}')
LAN=$(ip -4 -o addr | awk -v p="$WAN_NET" '$2!="lo" && index($4,p)!=1 {print $2}' | head -1)
ip route replace default via "${WAN_NET}1" dev "$WAN" 2>/dev/null || true
iptables -P FORWARD ACCEPT
case "$PROFILE" in
  strict) iptables -t nat -A POSTROUTING -o "$WAN" -j MASQUERADE --random-fully ;;      # a new public port per destination
  *)      iptables -t nat -A POSTROUTING -o "$WAN" -j MASQUERADE ;;                     # port-preserving
esac
iptables -A FORWARD -i "$WAN" -o "$LAN" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
case "$PROFILE" in
  noudp)   iptables -A FORWARD -i "$LAN" -p udp --dport 53 -j ACCEPT; iptables -A FORWARD -i "$LAN" -p udp -j DROP ;;
  webonly) iptables -A FORWARD -i "$LAN" -p udp --dport 53 -j ACCEPT; iptables -A FORWARD -i "$LAN" -p tcp -m multiport --dports 80,443 -j ACCEPT
           iptables -A FORWARD -i "$LAN" -p tcp -d "${WAN_NET}0/24" --dport 8000 -j ACCEPT; iptables -A FORWARD -i "$LAN" -j DROP ;;
esac
for h in $(echo "$BLOCK" | tr ',' ' '); do for ip in $(dig +short A "$h" | grep -E '^[0-9.]+$'); do iptables -I FORWARD -i "$LAN" -d "$ip" -j DROP; done; done
[ -n "$NETEM" ] && tc qdisc add dev "$WAN" root netem $NETEM
echo "router ready: $PROFILE wan=$WAN lan=$LAN block=$BLOCK"
exec sleep infinity
