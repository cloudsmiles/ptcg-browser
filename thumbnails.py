"""从固定卡图仓库生成 WebP 缩略图，缓存与原始数据版本绑定。"""
from io import BytesIO
from pathlib import Path
import re
import threading
from urllib.request import Request, urlopen
from PIL import Image, ImageOps

CACHE = Path(__file__).resolve().parent / '.cache' / 'thumbnails'
PATTERN = re.compile(r'^/thumbnails/([a-f0-9]{40})/(240|480)/(\d{1,6})/(\d{1,6})\.webp$')
LOCKS = [threading.Lock() for _ in range(64)]
DOWNLOAD_SLOTS = threading.BoundedSemaphore(4)
MAX_BYTES = 12 * 1024 * 1024


def download_original(revision, set_id, number):
    sources = [
        f'https://cdn.jsdelivr.net/gh/duanxr/PTCG-CHS-Datasets@{revision}/img/{set_id}/{number}.png',
        f'https://raw.githubusercontent.com/duanxr/PTCG-CHS-Datasets/{revision}/img/{set_id}/{number}.png',
    ]
    last_error = None
    for url in sources:
        try:
            request = Request(url, headers={'User-Agent': 'PTCG-Thumbnail/1.0'})
            with urlopen(request, timeout=6) as response:
                body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise OSError('卡图超过处理大小限制')
            return body
        except OSError as error:
            last_error = error
    raise OSError('原图下载失败') from last_error


def get_thumbnail(request_path):
    match = PATTERN.fullmatch(request_path)
    if not match:
        raise ValueError('缩略图路径无效')
    revision, width, set_id, number = match.groups()
    target = CACHE / revision / width / set_id / f'{number}.webp'
    if target.is_file():
        return target.read_bytes()
    source_key = (revision, set_id, number)
    # 同一原图的两种尺寸共用锁，并在一次下载中生成，避免重复访问 CDN。
    with LOCKS[hash(source_key) % len(LOCKS)]:
        if target.is_file():
            return target.read_bytes()
        with DOWNLOAD_SLOTS:
            original = download_original(revision, set_id, number)
            with Image.open(BytesIO(original)) as image:
                if image.width * image.height > 20_000_000:
                    raise OSError('卡图像素数超过处理限制')
                image = ImageOps.exif_transpose(image).convert('RGB')
                for size in (240, 480):
                    thumbnail = image.copy()
                    thumbnail.thumbnail((size, size * 2), Image.Resampling.LANCZOS)
                    body = BytesIO()
                    thumbnail.save(body, 'WEBP', quality=80, method=4)
                    destination = CACHE / revision / str(size) / set_id / f'{number}.webp'
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    temporary = destination.with_suffix('.tmp')
                    temporary.write_bytes(body.getvalue())
                    temporary.replace(destination)
    return target.read_bytes()
