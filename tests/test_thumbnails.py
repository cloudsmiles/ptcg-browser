"""缩略图使用本地图片夹具验证，不依赖公网。"""
from io import BytesIO
from pathlib import Path
import threading
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
        with patch.object(thumbnails.time, 'monotonic', side_effect=[0, 13, 14]), patch.object(
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

    def test_failure_does_not_leave_bad_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(thumbnails, 'CACHE', Path(directory)), patch.object(
                thumbnails, 'download_original', return_value=b'not an image'
            ):
                with self.assertRaises(OSError):
                    thumbnails.get_thumbnail(f'/thumbnails/{REVISION}/240/545/16.webp')
                self.assertEqual(list(Path(directory).rglob('*.webp')), [])
