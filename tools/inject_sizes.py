#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 GitHub Release 资产的真实体积／发布日期写入 download.html（构建时执行）。

目的：让页面在无外网、或用户端访问不了 api.github.com 的情况下，
      显示的仍然是 GitHub 上的真实数值（页面里另有客户端实时刷新脚本作为补充）。

用法：
    python tools/inject_sizes.py download.html            # 默认取环境变量 RELEASE_TAG
    RELEASE_TAG=v1.4 python tools/inject_sizes.py site/download.html
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = os.environ.get('GITHUB_REPO', 'midicn/midi-lib')


def fetch_release(tag: str, tries: int = 5, delay: int = 5):
    url = f'https://api.github.com/repos/{REPO}/releases/tags/{tag}'
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'midicn-lib-deploy',
            })
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read() or b'{}')
        except Exception as e:      # noqa: BLE001
            last = e
            print(f'[sizes] 第 {i+1} 次获取失败: {type(e).__name__}', flush=True)
            time.sleep(delay)
    print(f'[sizes] 放弃：{last}')
    return None


def mb(n: int) -> str:
    v = n / 1048576
    return f'{v:.1f} MB' if v < 1024 else f'{v/1024:.2f} GB'


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else 'download.html')
    tag = os.environ.get('RELEASE_TAG', '').strip()
    if not path.exists():
        print(f'[sizes] 文件不存在: {path}')
        return 1
    if not tag:
        # 从页面里已有的 vX.Y 链接推断
        txt0 = path.read_text(encoding='utf-8')
        m = re.search(r'releases/download/(v[\d.]+)/', txt0)
        tag = m.group(1) if m else ''
    if not tag:
        print('[sizes] 未指定 RELEASE_TAG，跳过')
        return 0

    rel = fetch_release(tag)
    if not rel or not rel.get('assets'):
        print('[sizes] 未取到资产，保留页面原值')
        return 0

    sizes = {a['name']: a['size'] for a in rel['assets']}
    total = sum(sizes.values())
    pub = (rel.get('published_at') or rel.get('created_at') or '')[:10]

    txt = path.read_text(encoding='utf-8')
    n = 0
    for name, size in sizes.items():
        pat = re.compile(r'(<span class="sz" data-asset="' + re.escape(name) + r'">)[^<]*(</span>)')
        txt, k = pat.subn(lambda m: m.group(1) + mb(size) + m.group(2), txt)
        n += k
    txt = re.sub(r'(<b id="relTotal")>[^<]*(</b>)', lambda m: m.group(1) + '>' + mb(total) + m.group(2), txt)
    txt = re.sub(r'(<b id="relTotalEn")>[^<]*(</b>)', lambda m: m.group(1) + '>' + mb(total) + m.group(2), txt)
    txt = re.sub(r"(const VER\s*=\s*')[^']*(')",
                 lambda m: m.group(1) + tag + m.group(2), txt)
    if pub:
        txt = re.sub(r'(<b id="relDate")>[^<]*(</b>)', lambda m: f'{m.group(1)}>{pub}{m.group(2)}', txt)
        txt = re.sub(r'(<b id="relDateEn")>[^<]*(</b>)', lambda m: f'{m.group(1)}>{pub}{m.group(2)}', txt)

    path.write_text(txt, encoding='utf-8')
    print(f'[sizes] 已写入 {n} 处体积 · 合计 {mb(total)} · 发布 {pub} -> {path}', flush=True)
    for k, v in sorted(sizes.items()):
        print(f'   {k:38s} {mb(v)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
