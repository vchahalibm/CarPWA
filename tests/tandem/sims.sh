#!/bin/sh
# iPhone simulators with Xcode's DeviceHub (Simulator.app before Xcode 27), for the tandem tests or by hand.
#   tests/tandem/sims.sh list                 the iPhone simulators installed, and which are running
#   tests/tandem/sims.sh start [n] [url]      start n iPhones (default 2), show them, open url (default: DriveGen online)
#   tests/tandem/sims.sh open <url>           open a page on every running iPhone
#   tests/tandem/sims.sh paste <text>         put text on every running iPhone's clipboard (a pairing code, an invite)
#   tests/tandem/sims.sh shot [dir]           a screenshot of every running iPhone
#   tests/tandem/sims.sh stop                 shut them all down
set -e
URL_DEFAULT="https://vchahalibm.github.io/CarPWA/"
XC=$(dirname "$(xcode-select -p)")
show() { for a in "$XC/Developer/Applications/Simulator.app" "$XC/Applications/DeviceHub.app"; do [ -d "$a" ] && { open "$a"; return; }; done; echo "No simulator window app found in $XC"; }
booted() { xcrun simctl list devices booted | sed -n 's/.*(\([0-9A-F-]\{36\}\)) (Booted).*/\1/p'; }
case "${1:-list}" in
list) xcrun simctl list devices available | grep -E "iPhone|-- iOS" ;;
start)
  n=${2:-2}; url=${3:-$URL_DEFAULT}
  for u in $(xcrun simctl list devices available | grep iPhone | sed -n 's/.*(\([0-9A-F-]\{36\}\)).*/\1/p' | head -n "$n"); do
    xcrun simctl boot "$u" 2>/dev/null || true
  done
  show
  for u in $(booted); do xcrun simctl bootstatus "$u" -b >/dev/null; xcrun simctl openurl "$u" "$url"; done
  echo "Running: $(booted | wc -l | tr -d ' ') iPhone(s), showing $url" ;;
open) for u in $(booted); do xcrun simctl openurl "$u" "$2"; done ;;
paste) for u in $(booted); do printf %s "$2" | xcrun simctl pbcopy "$u"; done; echo "On the clipboard of $(booted | wc -l | tr -d ' ') iPhone(s)" ;;
shot) d=${2:-.}; for u in $(booted); do xcrun simctl io "$u" screenshot --type=png "$d/iphone-$u.png" >/dev/null 2>&1; done; echo "Saved in $d" ;;
stop) xcrun simctl shutdown all; echo "All simulators shut down" ;;
*) sed -n 2,8p "$0" ;;
esac
