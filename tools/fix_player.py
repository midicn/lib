#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修正播放器：Transport 启动（播放核心）+ UX 增强"""
import shutil
from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')
changes = []

# 1) stop() 也停止 Transport
old = """function stop() {
  if (part) { try { part.stop(); part.dispose(); } catch (e) {} part = null; }
  if (ready) { syn.releaseAll(); bass.releaseAll(); perc.releaseAll(); }
  $('stop').disabled = true;
}"""
new = """function stop() {
  if (part) { try { part.stop(); part.dispose(); } catch (e) {} part = null; }
  try { Tone.Transport.stop(); Tone.Transport.cancel(); } catch (e) {}
  if (ready) { syn.releaseAll(); bass.releaseAll(); perc.releaseAll(); }
  $('stop').disabled = true;
}"""
if old in s:
    s = s.replace(old, new); changes.append('stop(): 加 Transport 停止')

# 2) 播放：启动 Transport（Tone.Part 依赖）
old2 = """    const start = Tone.now() + 0.12;
    part = new Tone.Part((time, n) => {"""
new2 = """    Tone.Transport.stop();
    Tone.Transport.cancel();
    Tone.Transport.position = 0;
    part = new Tone.Part((time, n) => {"""
if old2 in s:
    s = s.replace(old2, new2); changes.append('play(): 重置 Transport')

old3 = """    part.start(start);
    const sec = Math.round(midi.duration);
    part.stop('+' + (sec + 1.5));"""
new3 = """    part.start(0);
    const sec = Math.round(midi.duration);
    part.stop(sec + 1.5);
    Tone.Transport.start('+0.1');"""
if old3 in s:
    s = s.replace(old3, new3); changes.append('play(): Part 相对 Transport 启动 + Transport.start')

# 3) 列表行加 ▶ 提示
old4 = """  li.innerHTML = '<span>' + (t.t || '(无题)').slice(0, 60) + ' <span class="m">' + (t.cn || '').slice(0, 24) + '</span></span>' +"""
new4 = """  li.innerHTML = '<span><span style="color:#7F77DD">▶</span> ' + (t.t || '(无题)').slice(0, 60) + ' <span class="m">' + (t.cn || '').slice(0, 24) + '</span></span>' +"""
if old4 in s:
    s = s.replace(old4, new4); changes.append('列表: 加 ▶ 图标')

# 4) 工具栏加随机试听按钮
old5 = """  <label class="chk"><input type="checkbox" id="mainOnly" checked> 只看可商用</label>"""
new5 = """  <label class="chk"><input type="checkbox" id="mainOnly" checked> 只看可商用</label>
  <button id="rand">随机试听</button>"""
if old5 in s:
    s = s.replace(old5, new5); changes.append('工具栏: 随机试听按钮')

# 5) 随机试听逻辑
old6 = """$('mainOnly').onchange = () => { if (currentCat) selectCat(currentCat); };"""
new6 = """$('rand').onclick = async () => {
  const cats = SUMMARY.categories;
  const c = cats[Math.floor(Math.random() * cats.length)];
  const i = Math.floor(Math.random() * c.chunks);
  $('status').textContent = '随机试听：加载 ' + c.name + ' …';
  const arr = await (await fetch('data/cat-' + c.id + '-' + i + '.json')).json();
  const t = arr[Math.floor(Math.random() * arr.length)];
  if (t) play(t);
};
$('mainOnly').onchange = () => { if (currentCat) selectCat(currentCat); };"""
if old6 in s:
    s = s.replace(old6, new6); changes.append('随机试听逻辑')

# 6) 引导文案
s = s.replace("'共 ' + SUMMARY.total.toLocaleString() + ' 首 · 点击上方分类开始浏览，或直接搜索'",
              "'共 ' + SUMMARY.total.toLocaleString() + ' 首 · 点击上方分类浏览，点曲目即可播放'")
s = s.replace('<button id="rand">随机试听</button>',
              '<button id="rand" style="padding:.35rem .8rem;border-radius:8px;border:0.5px solid var(--bd2);background:transparent;color:inherit;cursor:pointer;font-size:.82rem">随机试听</button>')

p.write_text(s, encoding='utf-8')
print('改动:', changes)
shutil.copy2('index.html', '../site-test/index.html')
print('已同步测试环境')
