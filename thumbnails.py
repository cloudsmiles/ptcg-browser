"""从固定卡图仓库生成 WebP 缩略图，缓存与原始数据版本绑定。"""
from io import BytesIO
from pathlib import Path
import re
import logging
import threading
import time
from contextlib import contextmanager
from concurrent.futures import Future, ThreadPoolExecutor
from urllib.request import Request, urlopen
from PIL import Image, ImageOps

CACHE = Path(__file__).resolve().parent / '.cache' / 'thumbnails'
PATTERN = re.compile(r'^/thumbnails/(?:v2/)?([a-f0-9]{40})/(240|480|960)/(\d{1,6})/(\d{1,6})\.webp$')
LOCKS = [threading.Lock() for _ in range(64)]
DOWNLOAD_SLOTS = threading.BoundedSemaphore(4)
MAX_BYTES = 12 * 1024 * 1024
QUEUE_TIMEOUT = 1
DOWNLOAD_TIMEOUT = 16


ORIGINAL_PATTERN = re.compile(r'^/originals/([a-f0-9]{40})/(\d{1,6})/(\d{1,6})\.png$')
ORIGINAL_SLOTS = threading.BoundedSemaphore(16)
ORIGINAL_WAIT_TIMEOUT = 26
ORIGINAL_QUEUE_TIMEOUT = 6
ORIGINAL_INFLIGHT = {}
ORIGINAL_GUARD = threading.Lock()


ORIGINAL_WORKERS = ThreadPoolExecutor(max_workers=8, thread_name_prefix='card-image')
ORIGINAL_JOBS = {}
ORIGINAL_JOBS_GUARD = threading.Lock()
MAX_ORIGINAL_JOBS = 128


def _background_original(request_path):
    try:
        return get_original(request_path)
    except OSError as error:
        logging.warning('原图后台下载失败 %s: %r，原因: %r', request_path, error, error.__cause__)
        raise


def request_original(request_path):
    """冷图交给后台下载，返回 None 表示尚未就绪，由页面稍后重试。"""
    match = ORIGINAL_PATTERN.fullmatch(request_path)
    if not match:
        raise ValueError('原图路径无效')
    revision, set_id, number = match.groups()
    target = CACHE / 'originals' / revision / set_id / f'{number}.png'
    if target.is_file():
        return target.read_bytes()
    now = time.monotonic()
    with ORIGINAL_JOBS_GUARD:
        # 已完成任务清理后可重新提交；失败请求至少间隔 2 秒再试。
        for key, (future, submitted) in list(ORIGINAL_JOBS.items()):
            if future.done() and now - submitted >= 2:
                ORIGINAL_JOBS.pop(key)
        if request_path not in ORIGINAL_JOBS and len(ORIGINAL_JOBS) < MAX_ORIGINAL_JOBS:
            ORIGINAL_JOBS[request_path] = (ORIGINAL_WORKERS.submit(_background_original, request_path), now)
    return None


def request_thumbnail(request_path):
    """仅后台生成压缩缩略图，不将浏览器重定向到原图。"""
    match = PATTERN.fullmatch(request_path)
    if not match:
        raise ValueError('缩略图路径无效')
    revision, width, set_id, number = match.groups()
    target = CACHE / 'v2' / revision / width / set_id / f'{number}.webp'
    if target.is_file():
        return target.read_bytes()
    now = time.monotonic()
    # 三种尺寸共用同一个任务，一次生成列表及详情压缩图。
    key = ('thumbnail', revision, set_id, number)
    with ORIGINAL_JOBS_GUARD:
        for old_key, (future, submitted) in list(ORIGINAL_JOBS.items()):
            if future.done() and now - submitted >= 2:
                ORIGINAL_JOBS.pop(old_key)
        if key not in ORIGINAL_JOBS and len(ORIGINAL_JOBS) < MAX_ORIGINAL_JOBS:
            ORIGINAL_JOBS[key] = (ORIGINAL_WORKERS.submit(_background_thumbnail, request_path), now)
    return None


def _background_thumbnail(request_path):
    try:
        return get_thumbnail(request_path)
    except OSError as error:
        logging.warning('缩略图后台生成失败 %s: %r', request_path, error)
        raise


def get_original(request_path):
    match = ORIGINAL_PATTERN.fullmatch(request_path)
    if not match:
        raise ValueError('原图路径无效')
    revision, set_id, number = match.groups()
    target = CACHE / 'originals' / revision / set_id / f'{number}.png'
    if target.is_file():
        return target.read_bytes()
    # 所有尺寸及详情共用同图下载；等待者不会另占下载槽位。
    key = match.groups()
    with ORIGINAL_GUARD:
        pending = ORIGINAL_INFLIGHT.get(key)
        owner = pending is None
        if owner:
            pending = Future()
            ORIGINAL_INFLIGHT[key] = pending
    if not owner:
        return pending.result(timeout=ORIGINAL_WAIT_TIMEOUT)
    try:
        # 注册下载任务期间，另一个请求可能已经完成缓存。
        if target.is_file():
            body = target.read_bytes()
        else:
            with bounded_slot(ORIGINAL_SLOTS, timeout=ORIGINAL_QUEUE_TIMEOUT):
                body = download_original(revision, set_id, number)
                with Image.open(BytesIO(body)) as image:
                    if image.format != 'PNG' or image.width * image.height > 20_000_000:
                        raise OSError('原图格式或尺寸无效')
                    image.verify()
                target.parent.mkdir(parents=True, exist_ok=True)
                temporary = target.with_suffix('.tmp')
                temporary.write_bytes(body)
                temporary.replace(target)
        pending.set_result(body)
        return body
    except BaseException as error:
        pending.set_exception(error)
        raise
    finally:
        with ORIGINAL_GUARD:
            ORIGINAL_INFLIGHT.pop(key, None)


@contextmanager
def bounded_slot(slot, timeout=None):
    if not slot.acquire(timeout=QUEUE_TIMEOUT if timeout is None else timeout):
        raise OSError("图片处理繁忙")
    try:
        yield
    finally:
        slot.release()


def download_original(revision, set_id, number):
    sources = [
        f'https://raw.githubusercontent.com/duanxr/PTCG-CHS-Datasets/{revision}/img/{set_id}/{number}.png',
        f'https://gcore.jsdelivr.net/gh/duanxr/PTCG-CHS-Datasets@{revision}/img/{set_id}/{number}.png',
        f'https://cdn.jsdelivr.net/gh/duanxr/PTCG-CHS-Datasets@{revision}/img/{set_id}/{number}.png',
    ]
    last_error = None
    deadline = time.monotonic() + DOWNLOAD_TIMEOUT
    for url in sources:
        try:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise OSError('原图下载超时')
            request = Request(url, headers={'User-Agent': 'PTCG-Thumbnail/1.0'})
            with urlopen(request, timeout=min(4, remaining)) as response:
                chunks = []
                length = 0
                while length <= MAX_BYTES:
                    if time.monotonic() >= deadline:
                        raise OSError('原图下载超时')
                    chunk = response.read1(min(65536, MAX_BYTES + 1 - length))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    length += len(chunk)
                body = b''.join(chunks)
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
    target = CACHE / 'v2' / revision / width / set_id / f'{number}.webp'
    if target.is_file():
        return target.read_bytes()
    source_key = (revision, set_id, number)
    # 同一原图的三种尺寸共用锁，并在一次下载中生成，避免重复访问 CDN。
    with bounded_slot(LOCKS[hash(source_key) % len(LOCKS)]):
        if target.is_file():
            return target.read_bytes()
        with bounded_slot(DOWNLOAD_SLOTS):
            original = get_original(f'/originals/{revision}/{set_id}/{number}.png')
            with Image.open(BytesIO(original)) as image:
                if image.width * image.height > 20_000_000:
                    raise OSError('卡图像素数超过处理限制')
                image = ImageOps.exif_transpose(image).convert('RGB')
                for size in (240, 480, 960):
                    thumbnail = image.copy()
                    thumbnail.thumbnail((size, size * 2), Image.Resampling.LANCZOS)
                    body = BytesIO()
                    thumbnail.save(body, 'WEBP', quality=60 if size == 960 else 45, method=6)
                    destination = CACHE / 'v2' / revision / str(size) / set_id / f'{number}.webp'
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    temporary = destination.with_suffix('.tmp')
                    temporary.write_bytes(body.getvalue())
                    temporary.replace(destination)
    return target.read_bytes()
