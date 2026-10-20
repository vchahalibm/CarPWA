#!/bin/sh
# Builds desktop/speech/bin/sg-speech: Apple's speech recognizer for StudioGen, for Apple silicon and Intel in one file,
# with its permission texts inside (Info.plist), ad-hoc signed. Run by `npm run speech` and before `npm run dist` (CI).
set -e
cd "$(dirname "$0")"; mkdir -p bin
PL="-Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist"
for a in arm64 x86_64; do swiftc -O -target $a-apple-macos13 $PL main.swift -o bin/sg-speech-$a; done
lipo -create bin/sg-speech-arm64 bin/sg-speech-x86_64 -output bin/sg-speech; rm bin/sg-speech-arm64 bin/sg-speech-x86_64
codesign -s - -f -i io.github.vchahalibm.studiogen.speech bin/sg-speech
echo "built $(pwd)/bin/sg-speech"
