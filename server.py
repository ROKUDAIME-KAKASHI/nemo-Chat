import http.server
import socketserver
import webbrowser
import urllib.request
import json
import os

PORT = 3000

# Load .env
env_path = os.path.join(os.path.dirname(__file__), '.env')
config = {}
if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                config[k.strip()] = v.strip()

# Run sync_env to keep env.js updated
try:
    import sync_env
except Exception:
    pass

class NemoHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Disable caching so changes apply immediately
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/config':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store')
            self.end_headers()
            cfg_resp = {
                'configured': bool(config.get('API_KEY') or os.environ.get('API_KEY')),
                'baseUrl': config.get('BASE_URL') or os.environ.get('BASE_URL', 'https://api.aicredits.in/v1'),
                'modelName': config.get('MODEL_NAME') or os.environ.get('MODEL_NAME', 'mistralai/mistral-nemo')
            }
            self.wfile.write(json.dumps(cfg_resp).encode('utf-8'))
            return
        super().do_GET()

    def do_POST(self):
        if self.path == '/api/chat':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)

            try:
                body = json.loads(post_data.decode('utf-8'))
            except Exception as e:
                self.send_error(400, f"Invalid JSON: {e}")
                return

            api_key = (body.get('apiKey') or '').strip() or config.get('API_KEY', '') or os.environ.get('API_KEY', '')
            base_url = (body.get('baseUrl') or config.get('BASE_URL') or os.environ.get('BASE_URL', 'https://api.aicredits.in/v1')).rstrip('/')
            model_name = body.get('model') or config.get('MODEL_NAME') or os.environ.get('MODEL_NAME', 'mistralai/mistral-nemo')
            messages = body.get('messages', [])

            if not api_key:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'API key is missing. Please set API_KEY in your environment or Settings.'}).encode('utf-8'))
                return

            target_url = f"{base_url}/chat/completions"
            payload = json.dumps({
                'model': model_name,
                'messages': messages,
                'stream': True
            }).encode('utf-8')

            req = urllib.request.Request(target_url, data=payload, headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
                'User-Agent': 'NemoChat/1.0'
            })

            upstream_res = None
            try:
                upstream_res = urllib.request.urlopen(req, timeout=60)
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Cache-Control', 'no-cache')
                self.send_header('Connection', 'close')
                self.close_connection = True
                self.end_headers()

                # Stream chunks directly to client
                tail = b''
                while True:
                    chunk = upstream_res.read(256)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
                    tail = (tail + chunk)[-64:]
                    if b'data: [DONE]' in tail:
                        break

            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8', errors='replace')
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': err_body}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
            finally:
                if upstream_res:
                    try:
                        upstream_res.close()
                    except Exception:
                        pass
        else:
            self.send_error(404, "Endpoint not found")

def run():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), NemoHandler) as httpd:
        url = f"http://localhost:{PORT}"
        print(f"\n=======================================================")
        print(f"  Mistral NeMo Chat running at: {url}")
        print(f"=======================================================\n")
        webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")

if __name__ == '__main__':
    run()
