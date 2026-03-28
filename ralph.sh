#!/bin/bash

function num_todo() {
    jq '.todo | length' to_review.json
}

function num_done() {
    jq '.done | length' to_review.json
}

total=$(( $(num_todo) + $(num_done) ))
while [ $(num_todo) -gt 0 ]; do
    gravel -S "$(cat Critiq.md)"
    if pnpm test; then
        echo "✅ Ralphed through $(num_done) / $total"
        exit 0
    fi
    echo "❌ Failed at $(num_done) / $total"
    exit 1
done
