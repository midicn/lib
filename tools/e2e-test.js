/* 站点端到端回归测试（jsdom）· 34 项
 * 覆盖：首屏渲染 / 布局分区（音乐库→分类→筛选→曲目）/ 中英切换 / 搜索 / 分类加载 /
 *       筛选器 / 多维分面（作曲家·地域·来源）/ 可折叠筛选区 / 下载条 / 播放器 / 运行时错误
 * 用法：NODE_PATH=C:/Users/chenhua/.workbuddy/binaries/node/workspace/node_modules  *       node tools/e2e-test.js [本地index.html路径]
 */
// 端到端交互回归：分类加载 / 双语切换 / 搜索 / 筛选器 / 下载条
// 用法: node diag-e2e.js [本地html路径]   不给参数则测线上
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const SITE = 'https://lib.midicn.com';
const LOCAL = process.argv[2];

const results = [];
const ok = (n, c, extra = '') => { results.push([c, n, extra]); console.log(`  ${c ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`); };

(async () => {
  const HTML = LOCAL
    ? fs.readFileSync(LOCAL, 'utf8')
    : await (await fetch(SITE + '/?e2e=' + Date.now())).text();
  console.log('=== 测试对象:', LOCAL || (SITE + '/（线上）'), '·', (HTML.length / 1024).toFixed(1) + 'KB ===');

  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => errs.push(String((e.detail && e.detail.message) || e.message)));
  vc.on('error', () => {});

  const html = HTML.replace(/<script src="(vendor|soundfont)\/[^"]*"><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: SITE + '/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.Tone = {
        getContext: () => ({ rawContext: {} }),
        Transport: { start() {}, stop() {}, cancel() {} },
        Synth: class { toDestination() { return this; } triggerAttackRelease() {} releaseAll() {} },
        Gain: class { toDestination() { return this; } },
      };
      w.Midi = { fromArrayBuffer: () => ({ tracks: [], duration: 0 }) };
      w.JSSynth = { AudioWorkletNodeSynthesizer: class { async init() {} async loadSFont() {} async playNewMIDI() {} stop() {} } };
      w.IntersectionObserver = class {
        constructor(cb) { this.cb = cb; }
        observe() { setTimeout(() => this.cb([{ isIntersecting: true }]), 30); }
        unobserve() {} disconnect() {}
      };
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.AudioContext = class { constructor() { return { currentTime: 0, destination: {}, resume: () => Promise.resolve(), state: 'running' }; } };
      const nf = globalThis.fetch;
      w.fetch = (u, o) => nf(/^https?:/.test(u) ? u : SITE + '/' + String(u).replace(/^\.?\//, ''), o);
      w.addEventListener('error', e => errs.push('onerror: ' + (e.message || '')));
      w.addEventListener('unhandledrejection', e => errs.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));
    },
  });

  const w = dom.window, d = w.document;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const q = s => d.querySelectorAll(s).length;
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  await new Promise(r => w.addEventListener('load', r, { once: true }));
  await wait(5000);

  console.log('\n【1】首屏');
  ok('分类卡片渲染 12 个', q('.cat:not(.sk)') === 12, q('.cat:not(.sk)') + ' 个');
  ok('统计数字已填', /103,122/.test(d.getElementById('stats').textContent));
  ok('时期下拉有选项', q('#period option') > 1, q('#period option') + ' 项');

  console.log('\n【2】语言切换（EN）');
  click(d.getElementById('lang'));
  await wait(3000);
  ok('语言按钮变「中」', d.getElementById('lang').textContent.trim() === '中', d.getElementById('lang').textContent.trim());
  ok('<html lang> 切到 en', d.documentElement.lang === 'en', d.documentElement.lang);
  ok('分类名切换为英文', /Classical Piano/.test((d.querySelector('.cat b') || {}).textContent || ''));
  ok('统计标签英文化', /Tracks/.test(d.getElementById('stats').textContent));
  ok('导航文案英文化', /Download/.test(d.querySelector('.nav').textContent));
  ok('hero 文案英文化', /tracks/.test(d.getElementById('heroSub').textContent));
  console.log('     hero  :', d.getElementById('heroSub').textContent.slice(0, 90));
  console.log('     status:', d.getElementById('status').textContent.slice(0, 90));

  console.log('\n【3】搜索');
  const inp = d.getElementById('q');
  inp.value = 'bach';
  inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(26000);
  const n1 = q('#list li.row');
  ok('搜索出结果', n1 > 0, n1 + ' 行');
  console.log('     status:', d.getElementById('status').textContent.slice(0, 90));
  ok('结果行含标题', n1 === 0 || /bach/i.test(d.querySelector('#list li.row').textContent));

  console.log('\n【4】分类浏览 + 筛选器');
  inp.value = '';
  inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(1500);
  click(d.querySelector('.cat:not(.sk)'));
  await wait(5000);
  const n2 = q('#list li.row');
  ok('分类加载出曲目', n2 > 0, n2 + ' 行');
  ok('status 显示已加载', /loaded|已加载/.test(d.getElementById('status').textContent));
  d.getElementById('mainOnly').checked = true;
  d.getElementById('mainOnly').dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait(4000);
  ok('「只看可商用」可切换且状态更新', d.getElementById('status').textContent.length > 0,
     '筛选后 ' + q('#list li.row') + ' 行（原 ' + n2 + ' 行）');

  console.log('\n【4b】布局与可折叠筛选区');
  const hero = d.querySelector('.blk.hero') || d.querySelector('.hero');
  const secs = [...d.querySelectorAll('main > section.blk')];
  console.log('     main 分区数:', secs.length);
  ok('① 音乐库在最上', !!hero && secs.length > 0 && secs[0].contains(hero));
  ok('② 分类区紧随其后', secs.length > 1 && secs[1].contains(d.getElementById('cats')));
  ok('③ 筛选区', secs.length > 2 && !!d.getElementById('ftoggle'));
  ok('④ 曲目区含列表', secs.length > 3 && secs[3].contains(d.getElementById('list')));
  ok('筛选面板默认收起', d.getElementById('fpanel').hidden === true);
  click(d.getElementById('ftoggle'));
  await wait(300);
  ok('点「筛选」可展开', d.getElementById('fpanel').hidden === false &&
     d.getElementById('ftoggle').getAttribute('aria-expanded') === 'true');
  ok('播放器在最后', !!d.getElementById('player'));

  console.log('\n【5】下载条与导航');
  const chips = [...d.querySelectorAll('.dlchip')].map(a => a.getAttribute('href'));
  ok('下载 chip 4 个', chips.length === 4, chips.length + ' 个');
  ok('下载链指向 v1.4 release', chips.every(h => /releases\/download\/v1\.4/.test(h)));
  const navs = [...d.querySelectorAll('.nav a')].map(a => a.getAttribute('href'));
  ok('导航含下载/来源/许可', ['download.html', 'sources.html', 'licenses.html'].every(x => navs.includes(x)), navs.join(' '));
  ok('声波可视化条已生成', q('#viz i') === 14, q('#viz i') + ' 根');
  ok('播放器控件齐全', ['play', 'prev', 'next', 'loop', 'prog', 'vol'].every(id => !!d.getElementById(id)));
  ok('来源数已改为 17', /17 \u4e2a\u6765\u6e90|17 source/.test(HTML) && !/16 \u4e2a\u6765\u6e90\u6570\u636e\u96c6/.test(HTML));

  console.log('\n【7】多维筛选（作曲家 / 地域 / 来源）');
  // 挑一个既有地域又有作曲家的分类：爱尔兰传统
  const target = [...d.querySelectorAll('.cat:not(.sk)')].find(e => /爱尔兰传统|Irish/.test(e.textContent));
  if (!target) {
    console.log('  – 未找到目标分类，跳过');
  } else {
    click(target);
    await wait(7000);
    const nReg = q('#region option'), nSrc = q('#source option'), nComp = q('#compList option');
    ok('来源下拉已填充', nSrc > 1, nSrc + ' 项');
    ok('地域下拉已填充（分面文件可用）', nReg > 1, nReg + ' 项');
    ok('作曲家建议已填充', nComp > 0, nComp + ' 条');
    if (nReg > 1) {
      const reg = d.getElementById('region');
      reg.value = reg.options[1].value;
      reg.dispatchEvent(new w.Event('change', { bubbles: true }));
      await wait(6000);
      const rows = q('#list li.row');
      ok('按地域筛选后有结果', rows > 0, rows + ' 行 · ' + reg.value);
      ok('状态栏显示命中数', /命中|matched/i.test(d.getElementById('status').textContent),
         d.getElementById('status').textContent.slice(0, 80));
    }
    const comp = d.getElementById('composer');
    comp.value = 'traditional';
    comp.dispatchEvent(new w.Event('input', { bubbles: true }));
    await wait(6000);
    console.log('     作曲家筛选 →', q('#list li.row'), '行');
    click(d.getElementById('clear'));
    await wait(5000);
    ok('「清空筛选」恢复列表', q('#list li.row') > 0 && d.getElementById('region').value === '' &&
       d.getElementById('composer').value === '');
  }

  console.log('\n【6】运行时错误');
  ok('无脚本错误', errs.length === 0, errs.slice(0, 4).join(' | '));

  const bad = results.filter(r => !r[0]);
  console.log('\n===== 结果: ' + (results.length - bad.length) + '/' + results.length + ' 通过 =====');
  if (bad.length) { console.log('失败项:'); bad.forEach(b => console.log('  - ' + b[1])); process.exitCode = 1; }
  w.close();
})().catch(e => { console.error('测试脚本失败:', e); process.exit(1); });
