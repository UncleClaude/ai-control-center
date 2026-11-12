#!/bin/sh
# Launcher for the Arch package: runs the app on the system Electron (electron44).
# Extra Electron flags can go in ~/.config/ai-control-center-flags.conf (one per line).
flags_file="${XDG_CONFIG_HOME:-$HOME/.config}/ai-control-center-flags.conf"
if [ -r "$flags_file" ]; then
  extra=$(grep -v '^\s*#' "$flags_file" | tr '\n' ' ')
fi
# shellcheck disable=SC2086
exec /usr/bin/electron44 --class=ai-control-center $extra /usr/lib/ai-control-center/app.asar "$@"
