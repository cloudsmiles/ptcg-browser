#!/usr/bin/env python3
"""Build multi-language PTCG datasets (EN/JA/zh-CN) from the TCGdex GraphQL API."""
import hashlib
import json
import os
import re
import subprocess
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import opencc

OUT_DIR = "/Users/winniehe/WorkBuddy/2026-11-24-11-59-40/ptcg-browser/data"
API = "https://api.tcgdex.net/v2/graphql"
LANGS = {"en": "美版 English", "ja": "日版 日本語", "zh": "简中 简体中文"}
API_LANG = {"en": "en", "ja": "ja", "zh": "zh-cn"}

FIELDS = """
id name localId image category rarity hp types description illustrator dexId
stage evolveFrom regulationMark retreat
legal { standard expanded }
abilities { name type effect }
attacks { name cost damage effect }
weaknesses { type value }
resistances { type value }
set { id }
"""

QUERY = """
query($r: String, $c: String) {
  cards(filters: {rarity: $r, category: $c}) @locale(lang: "__LANG__") {
    %s
  }
}
""" % FIELDS

QUERY_STAGE = """
query($r: String, $c: String, $s: String) {
  cards(filters: {rarity: $r, category: $c, stage: $s}) @locale(lang: "__LANG__") {
    %s
  }
}
""" % FIELDS

IMAGE_QUERY = """
query($r: String, $c: String) {
  cards(filters: {rarity: $r, category: $c}) {
    id localId image set { id }
  }
}
"""

CATEGORIES = ["Pokemon", "Trainer", "Energy"]

converter = opencc.OpenCC("t2s")


CACHE_DIR = "/tmp/ptcg-gql-cache"
os.makedirs(CACHE_DIR, exist_ok=True)


def post(payload, retries=2):
    data = json.dumps(payload, sort_keys=True).encode("utf-8")
    cache_path = os.path.join(CACHE_DIR, hashlib.sha1(data).hexdigest() + ".json")
    if os.path.exists(cache_path):
        try:
            with open(cache_path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    for attempt in range(retries):
        try:
            result = subprocess.run(
                ["curl", "-sS", "--fail", "--max-time", "240",
                 "-X", "POST", "-H", "Content-Type: application/json",
                 "--data-binary", "@-", API],
                input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.decode("utf-8", "ignore")[:200])
            parsed = json.loads(result.stdout.decode("utf-8"))
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(parsed, f, ensure_ascii=False)
            return parsed
        except Exception as exc:
            if attempt == retries - 1:
                print(f"  WARN query failed: {str(exc)[:120]}")
                return {"data": {"cards": []}}
            time.sleep(2 * (attempt + 1))


def get_json(url, retries=4):
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 * (attempt + 1))


def zh(s):
    if not isinstance(s, str):
        return s
    return converter.convert(s)


def clean_text(s, lang):
    if not s:
        return ""
    s = re.sub(r"\s+", " ", str(s)).strip()
    return zh(s) if lang == "zh" else s


def normalize_num(local_id):
    if local_id.isdigit():
        return str(int(local_id))
    return local_id


def img_base_for_en(set_id, local_id):
    sid = set_id.replace(".5", "pt5")
    return f"https://images.pokemontcg.io/{sid}/{normalize_num(local_id)}.png"


def compact_card(c, lang, ja_img_map, set_meta):
    st = c.get("set") or {}
    meta = set_meta.get(st.get("id", "")) or {}
    img = c.get("image") or ""

    img_small = (img + "/low.webp") if img else ""
    img_large = (img + "/high.png") if img else ""

    if lang == "en":
        fast = img_base_for_en(st.get("id", ""), c.get("localId", ""))
        img_small = fast
        img_large = fast
    elif lang == "zh" and not img:
        key = st.get("id", "") + "|" + c.get("localId", "")
        ja_img = ja_img_map.get(key)
        if ja_img:
            img_small = ja_img + "/low.webp"
            img_large = ja_img + "/high.png"

    def atk(a):
        return {
            "n": clean_text(a.get("name"), lang),
            "c": a.get("cost") or [],
            "d": clean_text(a.get("damage"), lang),
            "t": clean_text(a.get("effect"), lang),
        }

    def abi(a):
        return {
            "n": clean_text(a.get("name"), lang),
            "y": clean_text(a.get("type"), lang),
            "t": clean_text(a.get("effect"), lang),
        }

    def wr(w):
        return {"t": clean_text(w.get("type"), lang), "v": clean_text(w.get("value"), lang)}

    return {
        "id": c.get("id"),
        "n": clean_text(c.get("name"), lang),
        "lid": c.get("localId", ""),
        "st": clean_text(c.get("category"), lang),
        "sub": clean_text(c.get("stage"), lang),
        "hp": str(c.get("hp") or ""),
        "ty": c.get("types") or [],
        "r": clean_text(c.get("rarity"), lang),
        "art": clean_text(c.get("illustrator"), lang),
        "ft": clean_text(c.get("description"), lang),
        "dex": c.get("dexId") or [],
        "reg": c.get("regulationMark") or "",
        "std": "Legal" if (c.get("legal") or {}).get("standard") else "",
        "weak": [wr(w) for w in (c.get("weaknesses") or [])],
        "res": [wr(w) for w in (c.get("resistances") or [])],
        "rc": c.get("retreat") or 0,
        "atk": [atk(a) for a in (c.get("attacks") or [])],
        "abi": [abi(a) for a in (c.get("abilities") or [])],
        "evoF": clean_text(c.get("evolveFrom"), lang),
        "s": st.get("id", ""),
        "sn": clean_text(meta.get("name") or st.get("id"), lang),
        "se": clean_text(meta.get("series"), lang),
        "sd": meta.get("releaseDate") or "",
        "sl": meta.get("logo") or "",
        "ssym": meta.get("symbol") or "",
        "img": img_small,
        "big": img_large,
    }


def build_lang(lang):
    sources = [API_LANG[lang]]
    if lang == "zh":
        # Simplified-Chinese coverage in TCGdex is small; merge Traditional Chinese
        # catalog and convert everything to Simplified with OpenCC.
        sources.append("zh-tw")

    raw = []
    for api_lang in sources:
        rarities = get_json(f"https://api.tcgdex.net/v2/{api_lang}/rarities")
        try:
            stages = get_json(f"https://api.tcgdex.net/v2/{api_lang}/stages")
        except Exception:
            stages = []
        query = QUERY.replace("__LANG__", api_lang)
        query_stage = QUERY_STAGE.replace("__LANG__", api_lang)

        def fetch_rarity(r, c, s, qlang=api_lang, query=query, query_stage=query_stage):
            if s:
                res = post({"query": query_stage, "variables": {"r": r, "c": c, "s": s}})
            else:
                res = post({"query": query, "variables": {"r": r, "c": c}})
            if res.get("errors"):
                print(f"  ERR {qlang}/{r}/{c}/{s}: {res['errors'][0]['message'][:100]}")
                return []
            cs = (res.get("data") or {}).get("cards") or []
            if cs:
                print(f"  {qlang} {r} / {c} / {s or '-'}: {len(cs)}")
            return cs

        jobs = []
        for r in rarities:
            for c in ["Trainer", "Energy"]:
                jobs.append((r, c, None))
            for s in stages:
                jobs.append((r, "Pokemon", s))
        with ThreadPoolExecutor(max_workers=8) as ex:
            for fut in as_completed([ex.submit(fetch_rarity, r, c, s) for r, c, s in jobs]):
                raw.extend(fut.result())

    seen = set()
    unique = []
    for c in raw:
        if c.get("id") and c["id"] not in seen:
            seen.add(c["id"])
            unique.append(c)

    set_ids = sorted({(c.get("set") or {}).get("id") for c in unique if (c.get("set") or {}).get("id")})
    print(f"  {lang}: fetching metadata for {len(set_ids)} sets")

    def fetch_set(sid):
        for api_lang in reversed(sources):
            try:
                d = get_json(f"https://api.tcgdex.net/v2/{api_lang}/sets/{sid}", retries=3)
                serie = d.get("serie") or {}
                return sid, {
                    "name": d.get("name"),
                    "series": serie.get("name") if isinstance(serie, dict) else serie,
                    "releaseDate": d.get("releaseDate"),
                    "logo": d.get("logo"),
                    "symbol": d.get("symbol"),
                }
            except Exception:
                continue
        return sid, {}

    set_meta = {}
    with ThreadPoolExecutor(max_workers=12) as ex:
        for fut in as_completed([ex.submit(fetch_set, sid) for sid in set_ids]):
            sid, meta = fut.result()
            set_meta[sid] = meta

    ja_img_map = {}
    if lang == "zh":
        # Chinese cards often lack images; reuse Japanese artwork by set + local id.
        ja_rarities = get_json("https://api.tcgdex.net/v2/ja/rarities")
        ja_query = IMAGE_QUERY
        def fetch_ja(r, c):
            res = post({"query": ja_query, "variables": {"r": r, "c": c}})
            return (res.get("data") or {}).get("cards") or []
        ja_jobs = [(r, c) for r in ja_rarities for c in CATEGORIES]
        with ThreadPoolExecutor(max_workers=8) as ex:
            for fut in as_completed([ex.submit(fetch_ja, r, c) for r, c in ja_jobs]):
                for c in fut.result():
                    if c.get("image"):
                        ja_img_map[c["set"]["id"] + "|" + c.get("localId", "")] = c["image"]

    cards = [compact_card(c, lang, ja_img_map, set_meta) for c in unique]
    cards.sort(key=lambda c: (c["sd"], c["s"], c["lid"]))

    set_map = {}
    for c in cards:
        sid = c["s"]
        if not sid:
            continue
        if sid not in set_map:
            set_map[sid] = {
                "id": sid, "name": c["sn"], "series": c["se"],
                "releaseDate": c["sd"], "logo": c["sl"], "symbol": c["ssym"],
            }
    sets = list(set_map.values())
    sets.sort(key=lambda s: s["releaseDate"], reverse=True)

    payload = {
        "label": LANGS[lang],
        "sets": sets,
        "cards": cards,
    }
    path = os.path.join(OUT_DIR, f"{lang}.js")
    with open(path, "w", encoding="utf-8") as f:
        f.write("window.PTCG_LANG_DATA = window.PTCG_LANG_DATA || {};\n")
        f.write(f"window.PTCG_LANG_DATA['{lang}'] = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"WROTE {lang}: {len(cards)} cards / {len(sets)} sets -> {path} ({os.path.getsize(path)//1024} KB)")
    return lang


if __name__ == "__main__":
    for lang in ["en", "ja", "zh"]:
        print(f"=== {lang} ===")
        build_lang(lang)
