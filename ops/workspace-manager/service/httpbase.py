import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from .common import MAX_REQUEST, json_bytes

class BaseHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # No request body or user paths in Cloud Logging.
        pass
    def out(self, status, payload):
        raw = json_bytes(payload)
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
    def body(self):
        if self.headers.get('Transfer-Encoding'):
            raise ValueError('invalid_transfer_encoding')
        try:
            n = int(self.headers.get('Content-Length','-1'))
        except ValueError:
            raise ValueError('invalid_length') from None
        if n < 0 or n > MAX_REQUEST:
            raise ValueError('invalid_length')
        try:
            return json.loads(self.rfile.read(n))
        except Exception:
            raise ValueError('invalid_json') from None

def serve(handler, port):
    server = ThreadingHTTPServer(('0.0.0.0', int(port)), handler)
    server.serve_forever()
