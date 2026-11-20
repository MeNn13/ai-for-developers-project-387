#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update
sudo apt-get install --yes bubblewrap
# Ubuntu 24.04 can require an AppArmor user namespace profile for bwrap.
if ! bwrap --unshare-user --ro-bind / / -- /usr/bin/true; then
  sudo apt-get install --yes apparmor-profiles
  profile=$(dpkg-query -L apparmor-profiles | awk '/\/bwrap$/ && !found { print; found=1 }')
  sudo apparmor_parser --replace "$profile"
  bwrap --unshare-user --ro-bind / / -- /usr/bin/true
fi
