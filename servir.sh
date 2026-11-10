#!/bin/sh
cd "$(dirname "$0")"
echo "Abre desde otro dispositivo: http://$(hostname -I 2>/dev/null | awk '{print $1}'):8080"
python3 -m http.server 8080 --bind 0.0.0.0
