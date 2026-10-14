#!/usr/bin/env bash
# Regenerates the tiny synthetic test media in public/test-media/ (requires ffmpeg).
# These files only exist so the players can be tested before the real podcasts are hosted.
set -euo pipefail
cd "$(dirname "$0")/../public/test-media"
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=440:duration=30" -f lavfi -i "sine=frequency=660:duration=30" \
  -filter_complex "[0][1]amix=inputs=2,volume=0.4" -ac 1 -ar 22050 -b:a 32k fixture-audio.mp3
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=480x270:rate=10:duration=30" -f lavfi -i "sine=frequency=440:duration=30" \
  -vf "drawtext=text='TEST FIXTURE — not lesson content':fontcolor=white:fontsize=20:box=1:boxcolor=black@0.6:x=(w-tw)/2:y=h-40" \
  -c:v libx264 -preset veryslow -crf 42 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 32k -ac 1 fixture-video.mp4 2>/dev/null \
|| ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=480x270:rate=10:duration=30" -f lavfi -i "sine=frequency=440:duration=30" \
  -c:v libx264 -preset veryslow -crf 42 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 32k -ac 1 fixture-video.mp4
ls -l fixture-*
