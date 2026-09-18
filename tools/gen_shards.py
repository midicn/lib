#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""lib.midicn.com 数据分片生成器

从 meta/catalog.json 生成按需加载的分片（显著改善首屏）：
  data/summary.json        分类概览（约 5 KB）—— 首屏只加载这个
  data/cat-<cat>.json      各分类曲目（点分类才加载）
  data/search-lite.json    全库轻量搜索索引（输入搜索时才懒加载）

用法（部署流水线中调用）：
  python tools/gen_shards.py     # 需在站点根目录（含 meta/catalog.json）执行
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

CAT_NAMES = {
    "folk-ireland": "爱尔兰传统 · Irish Traditional",
    "folk-world": "世界民谣 · World Folk",
    "classical-open": "古典（开放许可）· Classical (Open)",
    "klezmer-balkan": "克莱兹梅尔 / 巴尔干 · Klezmer & Balkan",
    "drum": "鼓点节奏 · Drum Patterns",
    "folk-british": "英美民谣 · British & American Folk",
    "game": "游戏音乐 · Game Music",
    "piano": "古典钢琴（非商用）· Classical Piano (NC)",
    "classical-traditional": "古典与传统（研究/学习）· Classical & Traditional (Study)",
}

# 播放器需要的字段（catalog 完整字段中的子集，减小体积）
KEEP = ("id", "t", "c", "cn", "g", "p", "r", "i", "z", "l", "v", "f")


def slim(t: dict) -> dict:
    out = {k: t.get(k) for k in KEEP if t.get(k) not in (None, "")}
    midi = t.get("midi") or {}
    if midi.get("duration_sec"):
        out["du"] = int(midi["duration_sec"])
    if midi.get("note_count"):
        out["nn"] = midi["note_count"]
    return out


def main() -> int:
    root = Path(".")
    cat_file = root / "meta" / "catalog.json"
    if not cat_file.exists():
        print(f"[shards] 未找到 {cat_file}", flush=True)
        return 1
    catalog = json.loads(cat_file.read_text(encoding="utf-8"))
    tracks = catalog["tracks"]
    print(f"[shards] 读入 {len(tracks):,} 条", flush=True)

    out = root / "data"
    out.mkdir(exist_ok=True)

    by_cat = defaultdict(list)
    by_source = defaultdict(int)
    for t in tracks:
        f = t.get("f") or ""
        parts = f.split("/")
        cat = parts[1] if len(parts) > 2 else "misc"
        by_cat[cat].append(slim(t))
        by_source[t["id"].split("-")[0]] += 1

    # 分类分片（类内按 500 条切片——首屏更快）
    CHUNK = 500
    summary_cats = []
    for cat, items in sorted(by_cat.items(), key=lambda kv: -len(kv[1])):
        n_chunks = max(1, (len(items) + CHUNK - 1) // CHUNK)
        for i in range(n_chunks):
            part = items[i * CHUNK:(i + 1) * CHUNK]
            (out / f"cat-{cat}-{i}.json").write_text(
                json.dumps(part, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        srcs = sorted({i["id"].split("-")[0] for i in items})
        periods = sorted({i["p"] for i in items if i.get("p")})
        summary_cats.append({
            "id": cat, "name": CAT_NAMES.get(cat, cat), "count": len(items),
            "chunks": n_chunks, "sources": srcs, "periods": periods,
        })
        print(f"  cat-{cat}: {len(items):,} 条 / {n_chunks} 片", flush=True)

    # 搜索索引（极简：id + 标题 + 作曲家 + 分类）
    search = [[t["id"], t.get("t") or "", t.get("cn") or "", t["f"].split("/")[1]] for t in tracks
              if True]
    (out / "search-lite.json").write_text(
        json.dumps(search, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 概览
    summary = {
        "version": catalog.get("version"),
        "total": len(tracks),
        "categories": summary_cats,
        "sources": dict(sorted(by_source.items(), key=lambda kv: -kv[1])),
        "zones": {"main": sum(1 for t in tracks if t["z"] == "main"),
                  "piano-special": sum(1 for t in tracks if t["z"] == "piano-special")},
    }
    (out / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    for f in sorted(out.glob("*.json")):
        print(f"  {f.name}: {f.stat().st_size/1024:.0f} KB", flush=True)
    print("[shards] 完成", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
