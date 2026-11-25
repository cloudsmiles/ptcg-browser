"""缩略图使用本地图片夹具验证，不依赖公网。"""
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image
import thumbnails

REVISION = '76c1f5214bcd766a6ae15ef2904fb0adeb4d5a94'


class ThumbnailTest(unittest.TestCase):
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
