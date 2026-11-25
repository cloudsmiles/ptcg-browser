"""验证真实 HTTP 压缩协商和内容完整性。"""
import gzip
import http.client
import importlib.util
from pathlib import Path
import threading
import tempfile
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent.parent


class ServerTest(unittest.TestCase):
    def test_thumbnail_failure_redirects_to_original_without_caching(self):
        spec = importlib.util.spec_from_file_location('server', ROOT / 'serve.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        server = ThreadingHTTPServer(('127.0.0.1', 0), module.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(module.thumbnails, 'get_thumbnail', side_effect=OSError('下载繁忙')):
                connection = http.client.HTTPConnection(*server.server_address)
                revision = '76c1f5214bcd766a6ae15ef2904fb0adeb4d5a94'
                connection.request('GET', f'/thumbnails/{revision}/480/545/16.webp')
                response = connection.getresponse()
                response.read()
                self.assertEqual(response.status, 307)
                self.assertEqual(response.getheader('Location'),
                                 f'../../../../originals/{revision}/545/16.png')
                self.assertEqual(response.getheader('Cache-Control'), 'no-store')
                connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_original_response_and_invalid_path(self):
        spec = importlib.util.spec_from_file_location('server', ROOT / 'serve.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        server = ThreadingHTTPServer(('127.0.0.1', 0), module.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = http.client.HTTPConnection(*server.server_address)
            revision = '76c1f5214bcd766a6ae15ef2904fb0adeb4d5a94'
            with patch.object(module.thumbnails, 'download_original') as download:
                connection.request('GET', '/originals/https://example.com/image.png')
                response = connection.getresponse()
                response.read()
                self.assertEqual(response.status, 400)
                download.assert_not_called()
            with patch.object(module.thumbnails, 'request_original', return_value=b'png-content'):
                connection.request('GET', f'/originals/{revision}/534/47.png')
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.getheader('Content-Type'), 'image/png')
                self.assertIsNone(response.getheader('Location'))
                self.assertEqual(response.read(), b'png-content')
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_pending_original_is_retryable_without_error_response(self):
        spec = importlib.util.spec_from_file_location('server', ROOT / 'serve.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        server = ThreadingHTTPServer(('127.0.0.1', 0), module.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(module.thumbnails, 'request_original', return_value=None, create=True), patch.object(
                module.thumbnails, 'get_original', side_effect=OSError('上游暂时超时')
            ):
                connection = http.client.HTTPConnection(*server.server_address)
                connection.request('GET', '/originals/' + 'a' * 40 + '/533/32.png')
                response = connection.getresponse()
                body = response.read()
                self.assertEqual(response.status, 202)
                self.assertEqual(response.getheader('Cache-Control'), 'no-store')
                self.assertEqual(response.getheader('Retry-After'), '2')
                self.assertEqual(response.getheader('Content-Type'), 'image/svg+xml')
                self.assertIn(b'width="320" height="1"', body)
                connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_external_data_and_private_files(self):
        spec = importlib.util.spec_from_file_location('server', ROOT / 'serve.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            data_dir = Path(temporary)
            (data_dir / 'zh-bootstrap.js').write_text('external-data', encoding='utf-8')
            handler = type('ExternalHandler', (module.Handler,), {'data_directory': data_dir})
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                connection = http.client.HTTPConnection(*server.server_address)
                connection.request('GET', '/data/zh-bootstrap.js')
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(), b'external-data')
                for route in ['/sync_data.py', '/.git/config', '/data/',
                              '/data/../serve.py', '/%2e%2e/serve.py', '/requirements.txt']:
                    connection.request('GET', route)
                    response = connection.getresponse()
                    response.read()
                    self.assertEqual(response.status, 404, route)
                connection.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_compression_and_plain_response(self):
        spec = importlib.util.spec_from_file_location('server', ROOT / 'serve.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        server = ThreadingHTTPServer(('127.0.0.1', 0), module.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            original = (ROOT / 'data/zh.js').read_bytes()
            for encoding, compressed in [('gzip', True), ('identity', False), ('gzip;q=0', False)]:
                connection = http.client.HTTPConnection(*server.server_address)
                connection.request('GET', '/data/zh.js', headers={'Accept-Encoding': encoding})
                response = connection.getresponse()
                body = response.read()
                self.assertEqual(response.status, 200)
                if compressed:
                    self.assertEqual(response.getheader('Content-Encoding'), 'gzip')
                    self.assertEqual(gzip.decompress(body), original)
                    self.assertLess(len(body), len(original) // 5)
                else:
                    self.assertIsNone(response.getheader('Content-Encoding'))
                    self.assertEqual(body, original)
                self.assertIn('Accept-Encoding', response.getheader('Vary'))
                connection.close()
            connection = http.client.HTTPConnection(*server.server_address)
            connection.request('HEAD', '/data/zh-index.js', headers={'Accept-Encoding': 'gzip'})
            response = connection.getresponse()
            etag = response.getheader('ETag')
            response.read()
            self.assertTrue(etag)
            connection.request('GET', '/data/zh-index.js', headers={
                'Accept-Encoding': 'gzip', 'If-None-Match': etag,
            })
            response = connection.getresponse()
            self.assertEqual(response.status, 304)
            self.assertEqual(response.read(), b'')
            connection.close()

        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
