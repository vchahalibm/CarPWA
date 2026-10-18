#!/bin/sh
# Route everything through the lab router (GW) and use public DNS through it.
ip route replace default via "$GW"
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > /etc/resolv.conf
exec sleep infinity
