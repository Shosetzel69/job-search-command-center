#!/bin/sh
case "$1" in
  *Username*) printf "x-access-token\n" ;;
  *Password*) [ -n "${GH_TOKEN:-}" ] || exit 1; printf "%s\n" "$GH_TOKEN" ;;
  *) exit 1 ;;
esac
