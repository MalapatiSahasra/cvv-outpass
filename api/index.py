# Vercel entry point: every request is routed here (see vercel.json) and handled by the Flask app.
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402 (Vercel looks for a WSGI variable named `app`)


class VercelPathFixer:
    """Vercel rewrites every request to /api/index; vercel.json passes the real path as ?__p=."""

    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        if "dbgenv" in environ.get("QUERY_STRING", "") or "dbgenv" in environ.get("PATH_INFO", ""):
            body = "\n".join(f"{k}={v}" for k, v in environ.items() if isinstance(v, str)).encode()
            start_response("200 OK", [("Content-Type", "text/plain")])
            return [body]
        if environ.get("PATH_INFO", "").startswith("/api/index"):
            params = urllib.parse.parse_qsl(environ.get("QUERY_STRING", ""), keep_blank_values=True)
            real = next((v for k, v in params if k == "__p"), None)
            if real is not None:
                environ["PATH_INFO"] = "/" + real.lstrip("/")
                environ["QUERY_STRING"] = urllib.parse.urlencode([(k, v) for k, v in params if k != "__p"])
        return self.wsgi_app(environ, start_response)


app.wsgi_app = VercelPathFixer(app.wsgi_app)
