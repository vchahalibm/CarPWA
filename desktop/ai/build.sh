#!/bin/sh
# Builds desktop/ai/bin/sg-ai: Apple's on-device language model for StudioGen, Apple silicon and Intel in one file
# (the framework is weakly linked: on a Mac before macOS 26 it starts and says it isn't available), ad-hoc signed.
set -e
cd "$(dirname "$0")"; mkdir -p bin
for a in arm64 x86_64; do swiftc -O -target $a-apple-macos13 -Xlinker -weak_framework -Xlinker FoundationModels main.swift -o bin/sg-ai-$a; done
lipo -create bin/sg-ai-arm64 bin/sg-ai-x86_64 -output bin/sg-ai; rm bin/sg-ai-arm64 bin/sg-ai-x86_64
codesign -s - -f -i io.github.vchahalibm.studiogen.ai bin/sg-ai
echo "built $(pwd)/bin/sg-ai"
