#!/bin/bash

npackages=$(find packages -iname \*.ts)

while [ $(grep '"done"' tasks.json | grep false | wc -l) -gt 0 ]; do
    claude --dangerously-skip-permissions "$(cat Ralph.md)"
    pnpm test && echo "✅"
done
