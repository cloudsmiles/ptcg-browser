"""验证真实 HTTP 压缩协商和内容完整性。"""
import gzip
import http.client
import importlib.util
from pathlib import Path
import threading
import tempfile
import unittest
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent.parent


class ServerTest(unittest.TestCase):
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
