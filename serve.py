"""提供支持 gzip 的本地静态服务：python3 serve.py。"""
import argparse
import gzip
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
import re
import threading
from urllib.parse import unquote, urlsplit
import thumbnails

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    data_directory = ROOT / 'data'
    public_files = {'/', '/index.html', '/app.js', '/styles.css',
                    '/data-loader.js', '/virtual-grid.js'}
    data_pattern = re.compile(r'^/data/(?:zh(?:-bootstrap|-index)?\.js|'
                              r'zh-index/[a-f0-9]{12}\.js|'
                              r'zh-details/[a-f0-9]{12}/\d+\.json)$')
    # 只保留每个文件的最新压缩结果；多线程共享，避免重复压缩。
    compressed_cache = {}
    compression_lock = threading.Lock()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        request_path = unquote(urlsplit(path).path)
        if self.data_pattern.fullmatch(request_path):
            return str(self.data_directory / request_path.removeprefix('/data/'))
        return super().translate_path(path)

    def accepts_gzip(self):
        for entry in self.headers.get('Accept-Encoding', '').lower().split(','):
            parts = [part.strip() for part in entry.split(';')]
            if parts[0] != 'gzip':
                continue
            quality = 1.0
            for parameter in parts[1:]:
                if parameter.startswith('q='):
                    try:
                        quality = float(parameter[2:])
                    except ValueError:
                        quality = 0.0
            return quality > 0
        return False

    def end_headers(self):
        self.send_header('Vary', 'Accept-Encoding')
        # 允许缓存，但每次重载都校验文件是否更新。
        self.send_header('Cache-Control', getattr(self, 'response_cache_control', 'no-cache'))
        super().end_headers()

    def send_head(self):
        request_path = unquote(urlsplit(self.path).path)
        if request_path.startswith('/originals/'):
            try:
                body = thumbnails.request_original(request_path)
            except ValueError:
                self.send_error(400, 'Invalid original path')
                return None
            if body is None:
                # 320×1 透明图是前端约定的“处理中”标记，不作为真实卡图展示。
                body = b'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="1"></svg>'
                self.response_cache_control = 'no-store'
                self.send_response(202)
                self.send_header('Retry-After', '2')
                self.send_header('Content-Type', 'image/svg+xml')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                return BytesIO(body)
            self.response_cache_control = 'public, max-age=31536000, immutable'
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            return BytesIO(body)
        if request_path.startswith('/thumbnails/'):
            try:
                body = thumbnails.get_thumbnail(request_path)
            except ValueError:
                self.send_error(400, 'Invalid thumbnail path')
                return None
            except OSError:
                self.response_cache_control = 'no-store'
                self.send_response(307)
                self.send_header('Location', thumbnails.original_url(request_path))
                self.send_header('Content-Length', '0')
                self.end_headers()
                return None
            self.response_cache_control = 'public, max-age=31536000, immutable'
            self.send_response(200)
            self.send_header('Content-Type', 'image/webp')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            return BytesIO(body)
        if request_path not in self.public_files and not self.data_pattern.fullmatch(request_path):
            self.send_error(404)
            return None
        path = Path(self.translate_path(self.path))
        if not self.accepts_gzip() or path.suffix not in {'.js', '.css', '.html', '.json'}:
            return super().send_head()
        try:
            stat = path.stat()
            if not path.is_file():
                return super().send_head()
            signature = (stat.st_mtime_ns, stat.st_size)
            with self.compression_lock:
                cached = self.compressed_cache.get(path)
                if cached is None or cached[0] != signature:
                    cached = (signature, gzip.compress(path.read_bytes(), compresslevel=6, mtime=0))
                    self.compressed_cache[path] = cached
            body = cached[1]
        except OSError:
            return super().send_head()
        etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}-gzip"'
        validators = [value.strip() for value in self.headers.get('If-None-Match', '').split(',')]
        if etag in validators or '*' in validators or 'W/' + etag in validators:
            self.send_response(304)
            self.send_header('ETag', etag)
            self.end_headers()
            return None
        self.send_response(200)
        self.send_header('ETag', etag)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Last-Modified', self.date_time_string(stat.st_mtime))
        self.end_headers()
        return BytesIO(body)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='启动卡牌浏览器（支持 gzip 压缩）')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--bind', default='127.0.0.1')
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    parser.add_argument('--cache-dir', type=Path, default=thumbnails.CACHE)
    args = parser.parse_args()
    Handler.data_directory = args.data_dir.resolve()
    thumbnails.CACHE = args.cache_dir.resolve()
    with ThreadingHTTPServer((args.bind, args.port), Handler) as server:
        print(f'访问 http://{args.bind}:{args.port}，按 Ctrl+C 停止', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
