#!/bin/sh
# StudioGen Worker (worker/README.md): a virtual screen nobody looks at, then StudioGen in it. Extra arguments go to StudioGen.
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 # left by the last run (docker restart)
Xvfb :99 -screen 0 1440x900x24 -nolisten tcp &
export DISPLAY=:99
i=0; while [ ! -e /tmp/.X11-unix/X99 ] && [ $i -lt 100 ]; do sleep 0.1; i=$((i+1)); done
exec /app/desktop/node_modules/.bin/electron /app/desktop --no-sandbox "$@"
