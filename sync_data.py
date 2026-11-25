"""固定上游提交，隔离构建并校验后发布；失败时保留已发布入口。"""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
from urllib.request import Request, urlopen

from build_chs import build

ROOT = Path(__file__).resolve().parent
REPOSITORY = 'duanxr/PTCG-CHS-Datasets'
MAX_SOURCE_BYTES = 80 * 1024 * 1024


def now():
    return datetime.now(timezone.utc).isoformat()


def request_bytes(url, limit, accept='application/vnd.github+json'):
    headers = {'User-Agent': 'PTCG-Browser-Sync/1.0'}
    headers['Accept'] = accept
    token = os.environ.get('GITHUB_TOKEN')
    if token and url.startswith('https://api.github.com/'):
        headers['Authorization'] = 'Bearer ' + token
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers=headers), timeout=60) as response:
                body = response.read(limit + 1)
            if len(body) > limit:
                raise ValueError('上游响应超过大小限制')
            return body
        except OSError:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def fetch_revision():
    commits = json.loads(request_bytes(
        f'https://api.github.com/repos/{REPOSITORY}/commits?per_page=1', 1024 * 1024))
    revision = commits[0]['sha']
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('上游提交标识无效')
    return revision


def download_source(revision, destination):
    # 数据文件超过 jsDelivr 的 20 MB 限制；API 原始响应也适用于 Raw 不可达的服务器。
    destination.write_bytes(request_bytes(
        f'https://api.github.com/repos/{REPOSITORY}/contents/ptcg_chs_infos.json?ref={revision}',
        MAX_SOURCE_BYTES, accept='application/vnd.github.raw+json'))


def build_rules_version():
    digest = hashlib.sha256()
    for name in ['build_chs.py', 'scripts/build-browser-data.cjs',
                 'scripts/validate-browser-data.cjs', 'sync_data.py']:
        digest.update(name.encode())
        digest.update((ROOT / name).read_bytes())
    return digest.hexdigest()


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validate_source(source):
    payload = json.loads(source.read_bytes())
    if not isinstance(payload, dict) or not isinstance(payload.get('dict'), dict):
        raise ValueError('上游数据缺少字典结构')
    collections = payload.get('collections')
    if not isinstance(collections, list) or not collections:
        raise ValueError('上游系列数据为空或格式不正确')
    for collection in collections:
        if not isinstance(collection, dict) or collection.get('id') is None:
            raise ValueError('上游系列缺少 ID')
        if not isinstance(collection.get('cards'), list):
            raise ValueError('上游卡牌列表格式不正确')


def validate_cards(payload, previous, allow_drop):
    cards = payload['cards']
    if not cards:
        raise ValueError('卡牌数据为空')
    if not allow_drop and previous.get('cards', 0) * 0.9 > len(cards):
        raise ValueError('卡牌数量减少超过 10%，需人工核对后使用 --allow-drop')
    series = {item['id'] for item in payload['sets']}
    if len(series) != len(payload['sets']):
        raise ValueError('系列 ID 重复')
    for card in cards:
        if not isinstance(card.get('n'), str) or not card['n'].strip():
            raise ValueError('卡牌名称为空')
        if card['s'] not in series:
            raise ValueError('卡牌关联的系列不存在')
        if not re.fullmatch(r'https://cdn\.jsdelivr\.net/gh/duanxr/PTCG-CHS-Datasets@'
                            r'[a-f0-9]{40}/img/\d{1,6}/\d{1,6}\.png', card['img']):
            raise ValueError('卡牌图片路径不符合缩略图规则')


def publish(candidate, state_root, previous, report):
    # 不可变资源先完整写入；最后仅替换首屏入口，旧页面可继续读取旧资源。
    for folder in ['zh-index', 'zh-details']:
        for source in (candidate / 'data' / folder).rglob('*'):
            if source.is_file():
                target = state_root / 'data' / folder / source.relative_to(candidate / 'data' / folder)
                if target.exists():
                    if target.read_bytes() != source.read_bytes():
                        raise ValueError('同版本资源内容不一致，拒绝覆盖')
                else:
                    atomic_write(target, source.read_bytes())
    current = state_root / 'data/zh-bootstrap.js'
    if current.exists():
        atomic_write(state_root / 'previous-bootstrap.js', current.read_bytes())
        atomic_write(state_root / 'previous-status.json', json.dumps(previous).encode())
    # 独立保存版本的发布统计，入口切换后即便状态写入中断也可追溯来源。
    atomic_write(state_root / 'releases' / (report['version'] + '.json'),
                 json.dumps(report, ensure_ascii=False, indent=2).encode())
    atomic_write(current, (candidate / 'data/zh-bootstrap.js').read_bytes())


def sync(state_root, source_file=None, revision=None, force=False, check=False, allow_drop=False):
    state_root = Path(state_root).resolve()
    state_root.mkdir(parents=True, exist_ok=True)
    with (state_root / 'sync.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('已有同步任务正在运行') from error
        status_file = state_root / 'status.json'
        previous = json.loads(status_file.read_text()) if status_file.exists() else {}
        checked = now()
        try:
            revision = revision or fetch_revision()
            if not re.fullmatch(r'[a-f0-9]{40}', revision):
                raise ValueError('上游版本必须是完整的 40 位提交标识')
            rules = build_rules_version()
            current_exists = (state_root / 'data/zh-bootstrap.js').is_file()
            if (not force and current_exists and previous.get('sourceRevision') == revision
                    and previous.get('buildRules') == rules):
                result = {**previous, 'lastCheck': checked, 'result': 'unchanged', 'error': None}
            elif check:
                result = {**previous, 'lastCheck': checked, 'result': 'available',
                          'availableRevision': revision, 'error': None}
            else:
                with tempfile.TemporaryDirectory(prefix='.candidate-', dir=state_root) as temporary:
                    candidate = Path(temporary)
                    source = candidate / 'source.json'
                    if source_file:
                        shutil.copyfile(source_file, source)
                    else:
                        download_source(revision, source)
                    validate_source(source)
                    raw = candidate / 'data/zh.js'
                    payload = build(source, raw, revision)
                    validate_cards(payload, previous, allow_drop)
                    process = subprocess.run([
                        'node', str(ROOT / 'scripts/build-browser-data.cjs'),
                        '--source', str(raw), '--output-root', str(candidate),
                    ], check=True, capture_output=True, text=True, timeout=180)
                    report = json.loads(process.stdout)
                    subprocess.run([
                        'node', str(ROOT / 'scripts/validate-browser-data.cjs'), str(candidate),
                    ], check=True, capture_output=True, text=True, timeout=180)
                    result = {**report, 'sourceRevision': revision, 'buildRules': rules,
                              'lastCheck': checked, 'lastSuccess': now(),
                              'result': 'updated', 'error': None}
                    publish(candidate, state_root, previous, result)
            atomic_write(status_file, json.dumps(result, ensure_ascii=False, indent=2).encode())
            return result
        except Exception as error:
            # 失败信息不改变上次成功来源、数量和版本，下一次任务仍会重试。
            failed = {**previous, 'lastCheck': checked, 'result': 'failed',
                      'error': str(error)}
            atomic_write(status_file, json.dumps(failed, ensure_ascii=False, indent=2).encode())
            raise


def main():
    parser = argparse.ArgumentParser(description='同步中文卡牌数据，校验成功后发布')
    parser.add_argument('--state-dir', type=Path, default=ROOT / '.sync')
    parser.add_argument('--source-file', type=Path, help='离线输入；必须同时指定 --revision')
    parser.add_argument('--revision', help='固定上游提交，默认查询最新版本')
    parser.add_argument('--force', action='store_true', help='即使版本未变化也重新构建')
    parser.add_argument('--check', action='store_true', help='只检查版本，不下载或发布')
    parser.add_argument('--allow-drop', action='store_true', help='人工确认后允许卡牌数量大幅减少')
    args = parser.parse_args()
    if args.source_file and not args.revision:
        parser.error('--source-file 必须同时指定 --revision')
    try:
        result = sync(args.state_dir, args.source_file, args.revision,
                      args.force, args.check, args.allow_drop)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as error:
        parser.exit(1, f'同步失败：{error}\n')


if __name__ == '__main__':
    main()
