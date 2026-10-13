# Vercel entry point: every request is routed here (see vercel.json) and handled by the Flask app.
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402 (Vercel looks for a WSGI variable named `app`)


class VercelPathFixer:
    """Fixes Vercel rewriting PATH_INFO to '/api/index' instead of the requested URL."""
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        path_info = environ.get("PATH_INFO", "")
        if path_info == "/api/index" or path_info.startswith("/api/index/"):
            raw_uri = (environ.get("RAW_URI")
                       or environ.get("REQUEST_URI")
                       or environ.get("HTTP_X_FORWARDED_URI")
                       or environ.get("HTTP_X_VERCEL_FORWARDED_FOR"))
            if raw_uri and not raw_uri.startswith("/api/index"):
                parsed = urllib.parse.urlparse(raw_uri).path
                if parsed:
                    environ["PATH_INFO"] = parsed
            else:
                # Fallback: strip the /api/index prefix
                sub = path_info[len("/api/index"):]
                environ["PATH_INFO"] = sub if sub else "/"
        return self.wsgi_app(environ, start_response)


app.wsgi_app = VercelPathFixer(app.wsgi_app)
