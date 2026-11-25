#!/usr/bin/env python3
"""从 duanxr/PTCG-CHS-Datasets 生成前端可用的 data/zh.js。

数据源：https://github.com/duanxr/PTCG-CHS-Datasets
仅用于非商业、个人学习用途；版权归宝可梦公司及相关权利方所有。
"""
import json
import os
import argparse
import re

SRC = '/tmp/ptcg_chs_infos.json'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'zh.js')
SHA = '76c1f5214bcd766a6ae15ef2904fb0adeb4d5a94'
CDN = 'https://cdn.jsdelivr.net/gh/duanxr/PTCG-CHS-Datasets@' + SHA + '/'
RAW = 'https://raw.githubusercontent.com/duanxr/PTCG-CHS-Datasets/' + SHA + '/'

TYPE = {
    '草': 'Grass', '火': 'Fire', '水': 'Water', '雷': 'Lightning',
    '超': 'Psychic', '斗': 'Fighting', '恶': 'Darkness', '钢': 'Metal',
    '妖': 'Fairy', '龙': 'Dragon', '无色': 'Colorless', '+': 'Colorless'
}
# abilityCost 使用数字代码，而不是中文值
COST = {
    '1': 'Grass', '2': 'Fire', '3': 'Water', '4': 'Lightning',
    '5': 'Psychic', '6': 'Fighting', '7': 'Darkness', '8': 'Metal',
    '9': 'Fairy', '11': 'Colorless', '12': 'Colorless'
}
ST = {'1': 'Pokemon', '2': 'Trainer', '3': 'Energy'}
# 保留原始稀有度代号（SR / SAR / RR ...）用于展示，另存数字等级用于排序
RARITY_RANK = {
    '无标记': 0, 'None': 0, '●': 0, '◆': 0,
    'C': 1, 'U': 2, 'R': 3, 'PR': 3, 'A': 3, 'K': 3, '★': 3,
    'S': 4, '★★': 4,
    'RR': 5, 'CHR': 5,
    'RRR': 6, 'SR': 6, 'AR': 6, 'CSR': 6, '★★★': 6,
    'SAR': 7, 'ACE': 7,
    'SSR': 8, 'UR': 8, 'FUR': 8, 'HR': 8, 'BWR': 8
}


def rarity_rank(code):
    s = (code or '').strip()
    if not s:
        return 0
    if s in RARITY_RANK:
        return RARITY_RANK[s]
    # C★ / U★★ / 无标记✦ 等闪卡变体：基础等级 + 标记数微调
    base = s
    marks = 0
    for ch in '★✦✧◇◆●☆':
        if ch in base:
            marks += base.count(ch)
            base = base.replace(ch, '').strip()
    return RARITY_RANK.get(base, 0) + min(marks, 3) * 0.1


# 稀有度等级：同一等级的不同代号（如 C / C★ / C★★）归入同一类
TIERS = [
    (8, 'UR 级 · 超高稀有（含 BWR）'),
    (7, 'SAR 级 · 特殊艺术稀有'),
    (6, 'SR 级 · 高稀有'),
    (5, 'RR 级 · 双重稀有'),
    (4, 'S 级 · 闪卡稀有'),
    (3, 'R 级 · 稀有'),
    (2, 'U 级 · 非普通'),
    (1, 'C 级 · 普通'),
    (0, '无标记')
]
LEGAL = {'G', 'H', 'I', 'J'}

# 系列分类：按商品名称归类，顺序即前端展示顺序
CATEGORIES = [
    '补充包', '强化包', '宝石包', '预组卡组', '对战派对', '嗨皮组合',
    '收集啦151', '专题包', '活动/奖赏包', '赛事特典', '礼盒周边'
]


def category(name):
    n = (name or '').strip()
    if '嗨皮组合' in n:
        return '嗨皮组合'
    if '宝石包' in n:
        return '宝石包'
    if '补充包' in n:
        return '补充包'
    if '强化包' in n:
        return '强化包'
    if any(k in n for k in ('起始卡组', '卡组构筑', '对战派对组合', '对战学院',
                            '豪华卡组套装', '家庭组合', '进阶礼盒')):
        return '预组卡组'
    if '对战派对' in n:
        return '对战派对'
    if any(k in n for k in ('专题包', '特别包')):
        return '专题包'
    if '收集啦151' in n:
        return '收集啦151'
    if any(k in n for k in ('奖赏包', '活动特别包', '活动包')):
        return '活动/奖赏包'
    if any(k in n for k in ('特典', '大师赛', '世界锦标赛', '城市赛', '超级赛', '高级赛')):
        return '赛事特典'
    if any(k in n for k in ('礼盒', '套装', '展示套', '收藏', '卡册', '卡套')):
        return '礼盒周边'
    return '其他周边'


def en_type(v):
    return TYPE.get(str(v), '')


def cost_list(raw):
    if not raw:
        return []
    out = []
    for part in str(raw).split(','):
        code = part.strip()
        t = COST.get(code) or TYPE.get(code, '')
        if t:
            out.append(t)
    return out


def build(source=SRC, output=OUT, revision=SHA):
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('上游版本必须是完整的 40 位提交标识')
    cdn = 'https://cdn.jsdelivr.net/gh/duanxr/PTCG-CHS-Datasets@' + revision + '/'
    raw = 'https://raw.githubusercontent.com/duanxr/PTCG-CHS-Datasets/' + revision + '/'
    with open(source, encoding='utf-8') as f:
        src = json.load(f)
    dic = src['dict']
    attr_map = {x['dictCode']: x['dictValue'] for x in dic.get('attribute', [])}
    weak_map = {x['dictCode']: x['dictValue'] for x in dic.get('weakness_type', [])}
    trainer_map = {x['dictCode']: x['dictValue'] for x in dic.get('trainer_type', [])}
    energy_map = {x['dictCode']: x['dictValue'] for x in dic.get('energy_type', [])}
    pkmn_map = {x['dictCode']: x['dictValue'] for x in dic.get('pokemon_type', [])}

    sets, cards = [], []
    for col in src['collections']:
        cid = str(col['id'])
        cname = col.get('name') or ('补充包 ' + cid)
        sets.append({
            'id': cid,
            'name': cname,
            'cat': category(cname),
            'series': col.get('seriesText') or '',
            'releaseDate': col.get('salesDate') or '',
            'sd': col.get('salesDate') or ''
        })
        for item in col.get('cards') or []:
            d = item.get('details') or {}
            st = ST.get(str(d.get('cardType') or item.get('cardType')) or '', '')
            if not st:
                continue
            img_rel = item.get('image')
            if not img_rel:
                continue
            img_rel = img_rel.replace('\\', '/').lstrip('./')
            if not img_rel.startswith('img/'):
                continue

            c = {
                'id': 'chs-' + str(item.get('id') or d.get('id')),
                'n': item.get('name') or d.get('cardName') or '',
                'st': st,
                'r': d.get('rarityText') or '无标记',
                'rrank': rarity_rank(d.get('rarityText')),
                'tier': int(rarity_rank(d.get('rarityText'))),
                'sn': cname,
                'se': cname,
                's': cid,
                'cat': category(cname),
                'sd': col.get('salesDate') or '',
                'lid': d.get('collectionNumber') or str(item.get('id') or ''),
                'img': cdn + img_rel,
                'altimg': raw + img_rel,
                'std': 'Legal' if d.get('regulationMarkText') in LEGAL else 'Expanded'
            }

            if st == 'Pokemon':
                ty = en_type(attr_map.get(str(d.get('attribute')), ''))
                if ty:
                    c['ty'] = [ty]
                if d.get('hp'):
                    c['hp'] = str(d['hp'])
                subs = [pkmn_map.get(str(d.get('pokemonType')), '')]
                if d.get('evolveText') and d['evolveText'] not in ('基础',):
                    subs.append(d['evolveText'])
                c['sub'] = ' · '.join(x for x in subs if x) or '宝可梦'
                w = en_type(weak_map.get(str(d.get('weaknessType')), ''))
                if w:
                    c['weak'] = [{'t': w, 'v': d.get('weaknessFormula') or '×2'}]
                if d.get('retreatCost') is not None:
                    c['rc'] = d['retreatCost']
            elif st == 'Trainer':
                c['sub'] = trainer_map.get(str(d.get('trainerType')), '') or '训练家'
            else:
                c['sub'] = energy_map.get(str(d.get('energyType')), '') or '能量'

            abi, atk = [], []
            for a in d.get('abilityItemList') or []:
                entry = {'n': a.get('abilityName') or '', 't': a.get('abilityText') or ''}
                dmg = a.get('abilityDamage') or 'none'
                if dmg == 'none':
                    abi.append(entry)
                else:
                    entry['c'] = cost_list(a.get('abilityCost'))
                    entry['d'] = dmg
                    atk.append(entry)
            if abi:
                c['abi'] = abi
            if atk:
                c['atk'] = atk

            ft = (d.get('ruleText') or '').replace('|', '\n').strip()
            if ft:
                c['ft'] = ft
            ill = d.get('illustratorName')
            if isinstance(ill, list):
                ill = ', '.join(str(x) for x in ill)
            if ill:
                c['art'] = ill

            cards.append(c)

    sets.sort(key=lambda s: (CATEGORIES.index(s['cat']) if s['cat'] in CATEGORIES else 99,
                             -(int(s['id']) if s['id'].isdigit() else 0)))
    payload = {
        'label': '简中 简体中文',
        'categories': CATEGORIES,
        'tiers': [{'id': str(i), 'name': n} for i, n in TIERS],
        'sets': sets,
        'cards': cards,
        'source': 'PTCG-CHS-Datasets (duanxr) - 真实简体中文卡图',
        'sourceRevision': revision
    }
    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    with open(output, 'w', encoding='utf-8') as f:
        f.write('window.PTCG_LANG_DATA = window.PTCG_LANG_DATA || {};\n')
        f.write("window.PTCG_LANG_DATA['zh'] = ")
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print('sets:', len(sets), 'cards:', len(cards))
    print('output:', output, round(os.path.getsize(output) / 1048576, 2), 'MB')
    return payload


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='转换中文卡牌数据')
    parser.add_argument('--source', default=SRC)
    parser.add_argument('--output', default=OUT)
    parser.add_argument('--revision', default=SHA)
    args = parser.parse_args()
    build(args.source, args.output, args.revision)
