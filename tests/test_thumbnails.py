"""缩略图使用本地图片夹具验证，不依赖公网。"""
from io import BytesIO
from pathlib import Path
import threading
import concurrent.futures
import time
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image
import thumbnails

REVISION = '76c1f5214bcd766a6ae15ef2904fb0adeb4d5a94'


class ThumbnailTest(unittest.TestCase):
    def test_busy_download_queue_has_bounded_wait(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(thumbnails, 'CACHE', Path(directory)), patch.object(
                thumbnails, 'DOWNLOAD_SLOTS', threading.BoundedSemaphore(0)
            ), patch.object(thumbnails, 'QUEUE_TIMEOUT', 0.01, create=True):
                with self.assertRaisesRegex(OSError, '繁忙'):
                    thumbnails.get_thumbnail(f'/thumbnails/{REVISION}/240/545/16.webp')

    def test_busy_image_lock_has_bounded_wait(self):
        lock = threading.Lock()
        lock.acquire()
        self.addCleanup(lock.release)
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(thumbnails, 'CACHE', Path(directory)), patch.object(
                thumbnails, 'LOCKS', [lock]
            ), patch.object(thumbnails, 'QUEUE_TIMEOUT', 0.01, create=True):
                with self.assertRaisesRegex(OSError, '繁忙'):
                    thumbnails.get_thumbnail(f'/thumbnails/{REVISION}/240/545/16.webp')

    def test_expired_download_budget_does_not_start_request(self):
        with patch.object(thumbnails.time, 'monotonic', side_effect=[0, 17, 18, 19]), patch.object(
            thumbnails, 'urlopen'
        ) as request:
            with self.assertRaisesRegex(OSError, '原图下载失败'):
                thumbnails.download_original(REVISION, '545', '16')
            request.assert_not_called()

    def test_original_is_validated_and_cached(self):
        image = BytesIO()
        Image.new('RGB', (20, 30)).save(image, 'PNG')
        route = f'/originals/{REVISION}/534/47.png'
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(thumbnails, 'CACHE', Path(directory)), patch.object(
                thumbnails, 'download_original', return_value=image.getvalue()
            ) as download:
                self.assertEqual(thumbnails.get_original(route), image.getvalue())
                self.assertEqual(thumbnails.get_original(route), image.getvalue())
                self.assertEqual(download.call_count, 1)
                with self.assertRaises(ValueError):
                    thumbnails.get_original('/originals/../../etc/passwd')

    def test_concurrent_original_requests_join_slow_download(self):
        image = BytesIO()
        Image.new('RGB', (20, 30)).save(image, 'PNG')
        started = threading.Event()

        def slow_download(*args, **kwargs):
            started.set()
            time.sleep(0.15)
            return image.getvalue()

        with tempfile.TemporaryDirectory() as directory:
            with patch.object(thumbnails, 'CACHE', Path(directory)), patch.object(
                thumbnails, 'QUEUE_TIMEOUT', 0.01
            ), patch.object(thumbnails, 'download_original', side_effect=slow_download) as download:
                with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
                    route = f'/originals/{REVISION}/533/32.png'
                    first = pool.submit(thumbnails.get_original, route)
                    self.assertTrue(started.wait(1))
                    followers = [pool.submit(thumbnails.get_original, route) for _ in range(11)]
                    self.assertEqual(first.result(timeout=2), image.getvalue())
                    for request in followers:
                        self.assertEqual(request.result(timeout=2), image.getvalue())
                self.assertEqual(download.call_count, 1)

    def test_thumbnail_and_detail_share_original_cache(self):
        image = BytesIO()
        Image.new('RGB', (20, 30)).save(image, 'PNG')
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(thumbnails, 'CACHE', Path(directory)), patch.object(
                thumbnails, 'download_original', return_value=image.getvalue()
            ) as download:
                thumbnails.get_thumbnail(f'/thumbnails/{REVISION}/240/533/32.webp')
                self.assertEqual(thumbnails.get_original(f'/originals/{REVISION}/533/32.png'), image.getvalue())
                self.assertEqual(download.call_count, 1)

    def test_failed_shared_download_can_retry(self):
        image = BytesIO()
        Image.new('RGB', (20, 30)).save(image, 'PNG')
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(thumbnails, 'CACHE', Path(directory)), patch.object(
                thumbnails, 'download_original', side_effect=[OSError('上游暂时不可用'), image.getvalue()]
            ) as download:
                route = f'/originals/{REVISION}/533/32.png'
                with self.assertRaisesRegex(OSError, '上游暂时不可用'):
                    thumbnails.get_original(route)
                self.assertEqual(thumbnails.ORIGINAL_INFLIGHT, {})
                self.assertEqual(thumbnails.get_original(route), image.getvalue())
                self.assertEqual(download.call_count, 2)

    def test_background_original_returns_pending_then_cached_image(self):
        image = BytesIO()
        Image.new('RGB', (20, 30)).save(image, 'PNG')
        release = threading.Event()
        finished = threading.Event()

        def slow_download(*args):
            release.wait(2)
            finished.set()
            return image.getvalue()

        with tempfile.TemporaryDirectory() as directory:
            route = f'/originals/{REVISION}/533/101.png'
            with patch.object(thumbnails, 'CACHE', Path(directory)), patch.object(
                thumbnails, 'download_original', side_effect=slow_download
            ) as download:
                try:
                    self.assertIsNone(thumbnails.request_original(route))
                    self.assertIsNone(thumbnails.request_original(route))
                finally:
                    release.set()
                self.assertTrue(finished.wait(2))
                # 同步调用加入同一个下载，等待原子缓存写入完成。
                self.assertEqual(thumbnails.get_original(route), image.getvalue())
                self.assertEqual(thumbnails.request_original(route), image.getvalue())
                self.assertEqual(download.call_count, 1)

    def test_background_queue_is_bounded(self):
        pending = concurrent.futures.Future()
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(thumbnails, 'CACHE', Path(directory)), patch.object(
                thumbnails, 'ORIGINAL_JOBS', {'busy': (pending, time.monotonic())}
            ), patch.object(thumbnails, 'MAX_ORIGINAL_JOBS', 1), patch.object(
                thumbnails.ORIGINAL_WORKERS, 'submit'
            ) as submit:
                self.assertIsNone(thumbnails.request_original(f'/originals/{REVISION}/533/101.png'))
                submit.assert_not_called()

    def test_sizes_cache_and_invalid_path(self):
        original = BytesIO()
        Image.new('RGB', (600, 840), '#df4824').save(original, 'PNG')
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(thumbnails, 'CACHE', Path(directory)), patch.object(
                thumbnails, 'download_original', return_value=original.getvalue()
            ) as download:
                small = thumbnails.get_thumbnail(f'/thumbnails/{REVISION}/240/545/16.webp')
                large = thumbnails.get_thumbnail(f'/thumbnails/{REVISION}/480/545/16.webp')
                self.assertEqual(Image.open(BytesIO(small)).size, (240, 336))
                self.assertEqual(Image.open(BytesIO(large)).size, (480, 672))
                self.assertEqual(Image.open(BytesIO(small)).format, 'WEBP')
                self.assertEqual(download.call_count, 1)
                self.assertEqual(thumbnails.get_thumbnail(f'/thumbnails/{REVISION}/240/545/16.webp'), small)
                for path in ['/thumbnails/../../etc/passwd', f'/thumbnails/{REVISION}/9999/545/16.webp', '/thumbnails/https://example.com']:
                    with self.assertRaises(ValueError):
                        thumbnails.get_thumbnail(path)

    def test_v2_thumbnail_ignores_old_compression_cache(self):
        original = BytesIO()
        Image.new('RGB', (600, 840), '#df4824').save(original, 'PNG')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / REVISION / '240' / '545' / '16.webp'
            old.parent.mkdir(parents=True)
            old.write_bytes(b'old-cache')
            with patch.object(thumbnails, 'CACHE', root), patch.object(
                thumbnails, 'download_original', return_value=original.getvalue()
            ):
                body = thumbnails.get_thumbnail(f'/thumbnails/v2/{REVISION}/240/545/16.webp')
                self.assertEqual(Image.open(BytesIO(body)).format, 'WEBP')
                self.assertTrue((root / 'v2' / REVISION / '240' / '545' / '16.webp').is_file())
                self.assertEqual(old.read_bytes(), b'old-cache')

    def test_background_thumbnail_is_compressed_and_cached(self):
        original = BytesIO()
        Image.new('RGB', (1200, 1680), '#df4824').save(original, 'PNG')
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(thumbnails, 'CACHE', Path(directory)), patch.object(
                thumbnails, 'download_original', return_value=original.getvalue()
            ) as download:
                route = f'/thumbnails/v2/{REVISION}/240/545/99.webp'
                self.assertIsNone(thumbnails.request_thumbnail(route))
                with thumbnails.ORIGINAL_JOBS_GUARD:
                    future = thumbnails.ORIGINAL_JOBS[('thumbnail', REVISION, '545', '99')][0]
                future.result(timeout=5)
                body = thumbnails.request_thumbnail(route)
                self.assertEqual(Image.open(BytesIO(body)).size, (240, 336))
                self.assertLess(len(body), len(original.getvalue()) // 4)
                detail = thumbnails.get_thumbnail(f'/thumbnails/v2/{REVISION}/960/545/99.webp')
                self.assertEqual(Image.open(BytesIO(detail)).size, (960, 1344))
                self.assertEqual(Image.open(BytesIO(detail)).format, 'WEBP')
                self.assertEqual(download.call_count, 1)

    def test_failure_does_not_leave_bad_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(thumbnails, 'CACHE', Path(directory)), patch.object(
                thumbnails, 'download_original', return_value=b'not an image'
            ):
                with self.assertRaises(OSError):
                    thumbnails.get_thumbnail(f'/thumbnails/{REVISION}/240/545/16.webp')
                self.assertEqual(list(Path(directory).rglob('*.webp')), [])
