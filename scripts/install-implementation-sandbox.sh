#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update
sudo apt-get install --yes bubblewrap
# Ubuntu 24.04 can require an AppArmor user namespace profile for bwrap.
if ! bwrap --unshare-user --ro-bind / / -- /usr/bin/true; then
  sudo apt-get install --yes apparmor-profiles
  sudo apparmor_parser --replace /usr/share/apparmor/extra-profiles/bwrap-userns-restrict
  bwrap --unshare-user --ro-bind / / -- /usr/bin/true
fi
