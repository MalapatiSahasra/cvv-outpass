# Optional Vercel entry point. Vercel runs app.py directly, so this only re-exports the same app.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402,F401
