"""真实执行转换和 Node 构建，检查同步失败不会替换已发布数据。"""
import json
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import sync_data


def source_payload(count=60):
    return {
        'dict': {},
        'collections': [{
            'id': 1,
            'name': '测试补充包',
            'salesDate': '2026-01-01',
            'cards': [{
                'id': index,
                'name': '测试卡牌' + str(index),
                'image': f'img/1/{index}.png',
                'details': {'cardType': '1', 'collectionNumber': str(index)},
            } for index in range(1, count + 1)],
        }],
    }


class SyncDataTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source.json'
        self.write_source()

    def write_source(self, count=60):
        self.source.write_text(json.dumps(source_payload(count)), encoding='utf-8')

    def run_sync(self, revision='a' * 40, **kwargs):
        return sync_data.sync(self.root / 'state', source_file=self.source,
                              revision=revision, **kwargs)

    def test_publish_skip_and_keep_old_resources(self):
        first = self.run_sync()
        self.assertEqual(first['result'], 'updated')
        self.assertEqual(first['cards'], 60)
        old_index = self.root / 'state' / first['indexUrl']
        old_bytes = old_index.read_bytes()
        with patch('sync_data.build', side_effect=AssertionError('不应重复构建')):
            self.assertEqual(self.run_sync()['result'], 'unchanged')
        second = self.run_sync(revision='b' * 40)
        self.assertNotEqual(first['version'], second['version'])
        self.assertEqual(old_index.read_bytes(), old_bytes)
        with patch('sync_data.build_rules_version', return_value='changed'):
            self.assertEqual(self.run_sync(revision='b' * 40)['result'], 'updated')
        self.assertEqual(self.run_sync(revision='b' * 40, force=True)['result'], 'updated')

    def test_drop_and_invalid_source_keep_published_entry(self):
        self.run_sync()
        entry = self.root / 'state/data/zh-bootstrap.js'
        original = entry.read_bytes()
        self.write_source(10)
        with self.assertRaisesRegex(ValueError, '减少'):
            self.run_sync(revision='b' * 40)
        self.assertEqual(entry.read_bytes(), original)
        status = json.loads((self.root / 'state/status.json').read_text())
        self.assertEqual(status['result'], 'failed')
        self.assertEqual(status['sourceRevision'], 'a' * 40)
        self.assertTrue(status['lastSuccess'])
        self.source.write_text('{"dict":{},"collections":[]}', encoding='utf-8')
        with self.assertRaises(ValueError):
            self.run_sync(revision='c' * 40)
        self.assertEqual(entry.read_bytes(), original)
        self.write_source(10)
        self.assertEqual(self.run_sync(revision='b' * 40, allow_drop=True)['cards'], 10)

    def test_download_failure_and_check_only_do_not_publish(self):
        self.run_sync()
        original = (self.root / 'state/data/zh-bootstrap.js').read_bytes()
        with patch('sync_data.fetch_revision', return_value='b' * 40):
            with patch('sync_data.download_source', side_effect=OSError('下载超时')):
                with self.assertRaises(OSError):
                    sync_data.sync(self.root / 'state')
            result = sync_data.sync(self.root / 'state', check=True)
        self.assertEqual(result['result'], 'available')
        self.assertEqual((self.root / 'state/data/zh-bootstrap.js').read_bytes(), original)

    def test_concurrent_sync_does_not_change_status(self):
        import fcntl
        state = self.root / 'state'
        state.mkdir()
        with (state / 'sync.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(RuntimeError, '正在运行'):
                self.run_sync()
        self.assertFalse((state / 'status.json').exists())

    def test_missing_card_name_is_rejected(self):
        payload = source_payload()
        payload['collections'][0]['cards'][0]['name'] = ''
        self.source.write_text(json.dumps(payload), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, '名称'):
            self.run_sync()
        self.assertFalse((self.root / 'state/data/zh-bootstrap.js').exists())

    def test_download_uses_github_api_raw_response_at_fixed_revision(self):
        body = json.dumps(source_payload()).encode()
        with patch('sync_data.urlopen', return_value=BytesIO(body)) as request:
            sync_data.download_source('a' * 40, self.root / 'download.json')
        sent = request.call_args.args[0]
        self.assertTrue(sent.full_url.startswith('https://api.github.com/'))
        self.assertIn('ref=' + 'a' * 40, sent.full_url)
        self.assertEqual(sent.get_header('Accept'), 'application/vnd.github.raw+json')
        self.assertEqual((self.root / 'download.json').read_bytes(), body)


if __name__ == '__main__':
    unittest.main()
