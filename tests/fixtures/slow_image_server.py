"""浏览器回归夹具：真实延迟图片响应，占用 HTTP 连接以暴露索引排队问题。"""
import base64
from http.server import ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from serve import Handler

IMAGE = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+XcAAAAASUVORK5CYII=')


class SlowImages(Handler):
    def send_head(self):
        if self.path.startswith('/thumbnails/'):
            time.sleep(2)
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(IMAGE)))
            self.end_headers()
            return BytesIO(IMAGE)
        return super().send_head()

    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), SlowImages)
print(server.server_address[1], flush=True)
server.serve_forever()
