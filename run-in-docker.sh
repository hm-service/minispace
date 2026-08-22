#!/bin/bash
set -euo pipefail

docker build -t minispace:temp . \
    && docker run --rm -it -p 5080:8080 -v ./data:/data minispace:temp