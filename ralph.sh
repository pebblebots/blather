#!/bin/bash

function npackages() {
    find packages -iname \*.ts | grep -v \*.test.ts | wc -l
}

function num_complete( ) {
    grep 'packages/' reviewed_modules.json  | wc -l
}

total=$(npackages)
while [ $(num_complete) -lt $total ]; do
    hermes chat -q "$(cat Critiq.md)"
    if pnpm test; then
        echo "✅ Ralphed through $(num_complete) / $total"
        exit 0
    fi
    echo "❌ Failed at $(num_complete) / $total"
    exit 1
done
