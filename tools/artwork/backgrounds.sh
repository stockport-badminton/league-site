#!/usr/bin/env bash
# Regenerate the division backgrounds.
#
# The generator is RANDOM, so the --seed values are the whole point of this file: they are
# what makes a chosen background reproducible rather than a lucky render nobody can get
# back. Change a seed and you get a different picture, not a slightly different one.
#
# Premier and Division 1 are generated because their original layers are unusable --
# "div 1 background" has the white footer fade baked in and "Prem background" has the
# player baked in too. Divisions 2 and 3 are RECOVERED from social-Premier.xcf and are not
# regenerated here. Whether all four should be, so the set reads as one league, was left
# with the owner when HARD-37 closed (25 Sep 2026); this script is where that would start.
#
# Deliberately no fade and no division letter. Both are layout decisions for whatever is
# drawn on top, and baking them in is what made the 2024 artwork impossible to compose
# with.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=static/beta/images/bg/divisions

node tools/artwork/lowpolybg.js "$OUT/Premier.png" \
  --palette '#2ecc40,#ffdc00,#ff851b,#f012be,#7fdbff' --cell 170 --seed 8

node tools/artwork/lowpolybg.js "$OUT/Division-1.png" \
  --palette dusk --cell 190 --seed 62 --saturate 1.3

echo "  divisions 2 and 3 are recovered artwork, not generated -- left alone"
