#!/bin/bash
# Double-click to start CVV Outpass on a Mac.
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python)
if [ -z "$PY" ]; then
  echo "Python 3 is not installed. Get it from https://www.python.org/downloads/ and try again."
  read -p "Press Enter to close"; exit 1
fi
"$PY" -c "import flask" 2>/dev/null || "$PY" -m pip install --user -r requirements.txt
( sleep 2; open "http://localhost:8000" ) &
"$PY" app.py
