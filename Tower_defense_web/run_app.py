# run_app.py

import sys
import os
import threading
import webbrowser
from app import app


if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    base = sys._MEIPASS
    tpl = os.path.join(base, "templates")
    static = os.path.join(base, "static")
    try:
        app.template_folder = tpl
        app.static_folder = static
        from jinja2 import FileSystemLoader
        app.jinja_loader = FileSystemLoader(tpl)
    except Exception:
        pass


def _open_browser():
    try:
        webbrowser.open("http://127.0.0.1:5000/", new=2)
    except Exception:
        pass


if __name__ == "__main__":
    threading.Timer(0.6, _open_browser).start()
    app.run(host="127.0.0.1", port=5000, debug=False)
