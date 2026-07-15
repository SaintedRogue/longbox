#!/bin/bash

set -ex; \
  ./scripts/release/utils.sh -w; \
  cargo build --package longbox_server --bin longbox_server --release