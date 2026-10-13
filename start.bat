@echo off
cd /d "%~dp0"
python -c "import flask" 2>nul || python -m pip install -r requirements.txt
start "" http://localhost:8000
python app.py
pause
