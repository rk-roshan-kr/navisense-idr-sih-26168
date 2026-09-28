"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
[STANDALONE RESEARCH SPIKE - NOT PART OF BASE V2.2 PRODUCTION ARCHITECTURE]
================================================================================
File: neural_dr_v3/visualization/serve_maps.py
Purpose: Lightweight HTTP server for NaviSense Neural DR v3 Interactive Map
         Inspector. Serves the Leaflet UI, trajectory comparison datasets,
         and live simulation telemetry on port 8080 (or custom port).
================================================================================
"""

import sys
import os
import argparse
import json
import mimetypes
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn

# Base paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SUBPROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
RESULTS_DIR = os.path.join(SUBPROJECT_ROOT, "results")
HTML_FILE = os.path.join(SCRIPT_DIR, "index.html")
DATA_FILE = os.path.join(RESULTS_DIR, "map_visualization_data.json")


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Multi-threaded HTTP server to prevent UI stutter during large JSON fetches."""
    daemon_threads = True
    allow_reuse_address = True


class NeuralDRMapHandler(SimpleHTTPRequestHandler):
    """
    Custom HTTP request handler serving:
    - '/' -> neural_dr_v3/visualization/index.html
    - '/api/episodes' -> neural_dr_v3/results/map_visualization_data.json
    - Static assets (PNG charts, benchmarks, etc.)
    """

    def end_headers(self):
        # Enable CORS for local cross-port interaction
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        # Clean path
        path = self.path.split("?")[0].rstrip("/")
        if not path:
            path = "/"

        if path in ("/", "/index.html"):
            if not os.path.exists(HTML_FILE):
                self.send_error(404, f"File index.html not found at {HTML_FILE}")
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            with open(HTML_FILE, "rb") as f:
                content = f.read()
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        elif path == "/api/episodes":
            if not os.path.exists(DATA_FILE):
                self.send_error(404, f"Data file not found at {DATA_FILE}")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            file_size = os.path.getsize(DATA_FILE)
            self.send_header("Content-Length", str(file_size))
            self.end_headers()
            
            # Stream in chunks to handle the 6.7MB payload efficiently
            with open(DATA_FILE, "rb") as f:
                while True:
                    chunk = f.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            return

        elif path.startswith("/results/"):
            rel_file = path[len("/results/"):]
            full_path = os.path.join(RESULTS_DIR, rel_file)
            if os.path.exists(full_path) and os.path.isfile(full_path):
                mime, _ = mimetypes.guess_type(full_path)
                self.send_response(200)
                self.send_header("Content-Type", mime or "application/octet-stream")
                self.send_header("Content-Length", str(os.path.getsize(full_path)))
                self.end_headers()
                with open(full_path, "rb") as f:
                    while True:
                        chunk = f.read(64 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                return

        # Fallback to standard handler
        super().do_GET()

    def log_message(self, format, *args):
        # Compact access log
        sys.stderr.write(f"[NeuralDR Map Server] {self.address_string()} - {format % args}\n")


def main():
    parser = argparse.ArgumentParser(description="NaviSense Neural DR v3 Visual Map Server")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default: 8080)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host address (default: 127.0.0.1)")
    args = parser.parse_args()

    server_address = (args.host, args.port)
    httpd = ThreadedHTTPServer(server_address, NeuralDRMapHandler)

    print("=" * 80)
    print(" NAVISENSE NEURAL DR V3 — VISUAL MAP INSPECTOR SERVER")
    print(" [STANDALONE RESEARCH SUBPROJECT — EXPERIMENTAL TESTBED]")
    print("=" * 80)
    print(f" Web UI URL       : http://localhost:{args.port}/")
    print(f" Loopback URL     : http://{args.host}:{args.port}/")
    print(f" Episodes API     : http://{args.host}:{args.port}/api/episodes")
    print(f" Serving UI from  : {HTML_FILE}")
    print(f" Data Source      : {DATA_FILE} ({os.path.getsize(DATA_FILE) / 1024 / 1024:.2f} MB)")
    print("=" * 80)
    print("Press Ctrl+C to stop.")
    print("=" * 80)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping map server...")
        httpd.server_close()


if __name__ == "__main__":
    main()
