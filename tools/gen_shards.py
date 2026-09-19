#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""lib.midicn.com 数据分片 + 分面生成器

从 meta/catalog.json 生成按需加载的分片（显著改善首屏）：
  data/summary.json        分类概览（约 5 KB）—— 首屏只加载这个
  data/cat-<cat>-<n>.json  各分类曲目分片（点分类才加载，500 条/片）
  data/facets-<cat>.json   各分类分面（作曲家 / 地域，选中分类时懒加载）
  data/search-lite.json    全库轻量搜索索引（输入搜索时才懒加载）

用法（部署流水线中调用）：
  python tools/gen_shards.py     # 需在站点根目录（含 meta/catalog.json）执行
"""
from __future__ import annotations

import json
import re
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
    "maestro": "钢琴演奏 · Piano Performance",
    "emopia": "流行钢琴 · Pop Piano",
    "classical-traditional": "古典与传统（研究/学习）· Classical & Traditional (Study)",
    "folk-china": "中国民歌（研究/学习）· Chinese Folk Songs (Study)",
    "piano-performance": "钢琴演奏（可商用）· Piano Performance",
    "hymn": "赞美诗曲调 · Hymn Tunes",
}

# 播放器需要的字段（catalog 完整字段中的子集，减小体积）
KEEP = ("id", "t", "c", "cn", "g", "p", "r", "i", "z", "l", "v", "f", "opus", "no")

# ── 地域名清洗：上游 Essen/Norbeck 等源残留 LaTeX 转义（{\"aa} / \"o 等） ──
_LATEX = (
    ("{\\aa}", "å"), ("{\\AA}", "Å"), ("{\\o}", "ø"), ("{\\O}", "Ø"),
    ("\\\"o", "ö"), ("\\\"a", "ä"), ("\\\"u", "ü"),
    ("\\\"O", "Ö"), ("\\\"A", "Ä"), ("\\\"U", "Ü"),
    ("\\'e", "é"), ("\\'a", "á"), ("\\`e", "è"), ("\\ss", "ß"),
)


def clean_region(v):
    """把 LaTeX 转义还原成正常字符：Sm{\\aa}land → Småland，H\\"alsingland → Hälsingland。"""
    if not v:
        return v
    s = str(v)
    for a, b in _LATEX:
        s = s.replace(a, b)
    s = s.replace("{", "").replace("}", "").replace("\\", "")
    s = re.sub(r"\s+", " ", s).strip()
    return s or v


def disp_title(t: dict):
    """无标题曲目的可分辨显示名：作曲家 · Op. 编号（如 aria 上游无标题、仅有编号体系）。"""
    tt = str(t.get("t") or "").strip()
    if tt:
        return tt
    cn = str(t.get("cn") or "").strip()
    op, no = t.get("opus"), t.get("no")
    if cn and op:
        s = f"{cn} · Op. {op}"
        if no not in (None, ""):
            s += f" No. {no}"
        return s
    if cn:
        return cn
    return None


def slim(t: dict) -> dict:
    out = {k: t.get(k) for k in KEEP if t.get(k) not in (None, "")}
    # catalog 的时长/音符数在顶层（v1.3+），之前误从嵌套 midi 字段读 → 分片一直缺 du/nn
    if t.get("du"):
        out["du"] = int(t["du"])
    if t.get("nn"):
        out["nn"] = int(t["nn"])
    if out.get("r"):
        out["r"] = clean_region(out["r"])
    # 无标题曲目（如 aria）合成「作曲家 · Op. 编号」显示名，保证每首可分辨
    tt = disp_title(t)
    if tt:
        out["t"] = tt
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
    loc = {}          # id -> [cat, chunkIdx]：详情页直链兜底定位
    for cat, items in sorted(by_cat.items(), key=lambda kv: -len(kv[1])):
        n_chunks = max(1, (len(items) + CHUNK - 1) // CHUNK)
        for i in range(n_chunks):
            part = items[i * CHUNK:(i + 1) * CHUNK]
            (out / f"cat-{cat}-{i}.json").write_text(
                json.dumps(part, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            for it in part:
                loc[it["id"]] = [cat, i]

        srcs = sorted({i["id"].split("-")[0] for i in items})
        periods = sorted({i["p"] for i in items if i.get("p")})
        has_region = any(i.get("r") for i in items)
        summary_cats.append({
            "id": cat, "name": CAT_NAMES.get(cat, cat), "count": len(items),
            "chunks": n_chunks, "sources": srcs, "periods": periods,
            "facets": bool(has_region) or len({i.get("c") for i in items if i.get("c")}) > 1,
        })
        print(f"  cat-{cat}: {len(items):,} 条 / {n_chunks} 片", flush=True)

        # ── 分面：作曲家（含显示名）+ 地域 ──
        comp = defaultdict(int)
        disp = {}
        reg = defaultdict(int)
        for i in items:
            if i.get("c"):
                comp[i["c"]] += 1
                if i.get("cn"):
                    disp[i["c"]] = i["cn"]
            if i.get("r"):
                reg[i["r"]] += 1
        facets = {
            "c": [[k, disp.get(k, k), n] for k, n in sorted(comp.items(), key=lambda kv: (-kv[1], kv[0]))],
            "r": [[k, n] for k, n in sorted(reg.items(), key=lambda kv: (-kv[1], kv[0]))],
        }
        (out / f"facets-{cat}.json").write_text(
            json.dumps(facets, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 搜索索引（极简：id + 标题（无标题时用合成名）+ 作曲家 + 分类）
    search = [[t["id"], disp_title(t) or "", t.get("cn") or "", t["f"].split("/")[1]] for t in tracks]
    (out / "search-lite.json").write_text(
        json.dumps(search, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 曲目定位表（详情页直链兜底：id -> [分类, 分片号]）
    (out / "loc.json").write_text(
        json.dumps(loc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

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
