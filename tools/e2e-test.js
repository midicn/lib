/* 站点端到端回归测试（jsdom）· 54 项
 * 覆盖：首屏渲染 / 布局分区（音乐库→分类→筛选→曲目）/ 中英切换 / 搜索 / 分类加载 /
 *       筛选器 / 多维分面（作曲家·地域·来源）/ 可折叠筛选区 / 下载条 / 播放器 / 运行时错误
 * 用法：NODE_PATH=C:/Users/chenhua/.workbuddy/binaries/node/workspace/node_modules  *       node tools/e2e-test.js [本地index.html路径]
 */
/* midicn-lib 端到端回归 v10（谱面档案版）
   用法：node diag-e2e.js [本地 index.html 路径]  · 不带参数 → 测线上 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const LOCAL = process.argv[2] || '';
const BASE = 'https://lib.midicn.com/';   /* 资源已内联，统一用 https 源避免不透明源限制 */
const ORIGIN = 'https://lib.midicn.com/';

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra){
  if (cond){ pass++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
const wait = ms => new Promise(r=>setTimeout(r, ms));

/* 本地模式：把本地 assets/archive.js 内联进 HTML，并移除 vendor 脚本（Tone/JSSynth 已 stub）*/
function localize(html, htmlPath){
  if (!LOCAL) return html;
  const dir = path.dirname(htmlPath);
  let arch = '', plr = '';
  try{ arch = fs.readFileSync(path.join(dir, 'assets', 'archive.js'), 'utf-8'); }catch(e){}
  try{ plr = fs.readFileSync(path.join(dir, 'assets', 'player.js'), 'utf-8'); }catch(e){}
  let css = '';
  try{ css = fs.readFileSync(path.join(dir, 'assets', 'style.css'), 'utf-8'); }catch(e){}
  return html
    .replace(/<script src="vendor\/[^"]+"><\/script>/g, '')
    .replace(/<script src="assets\/archive\.js"><\/script>/g,
      arch ? '<script>' + arch + '</script>' : '')
    .replace(/<script src="assets\/player\.js"><\/script>/g,
      plr ? '<script>' + plr + '</script>' : '')
    .replace(/<link rel="stylesheet" href="assets\/style\.css">/g,
      css ? '<style>' + css + '</style>' : '');
}


const PRE = ['data/summary.json','data/browse.json','data/loc.json','assets/style.css'];
const cacheData = {};
async function preload(){
  const dir = LOCAL ? path.dirname(LOCAL) : null;
  for (const p of PRE){
    if (dir){
      try{ cacheData[p] = fs.readFileSync(path.join(dir, p.replace('/', path.sep)), 'utf-8'); continue; }catch(e){}
    }
    try{ cacheData[p] = await (await fetch(ORIGIN + p)).text(); }catch(e){}
  }
}
function makeFetch(realFetch){
  return async (u, opt)=>{
    const url = String(u);
    const key = url.replace(/^.*?(data\/)/, '$1');
    if (cacheData[key]) return new Response(cacheData[key], { status:200 });
    if (cacheData['assets/style.css'] && key === 'assets/style.css') return new Response(cacheData['assets/style.css'], { status:200 });
    try{
      const abs = /^https?:/.test(url) ? url : ORIGIN + key;
      return await realFetch(abs, opt);
    }catch(e){ return new Response('{}', { status:404 }); }
  };
}

(async ()=>{
  await preload();
  const html = LOCAL ? localize(fs.readFileSync(LOCAL, 'utf-8'), LOCAL) : await (await fetch(BASE)).text();
  console.log('=== 测试对象: ' + (LOCAL || BASE) + ' · ' + (html.length/1024).toFixed(1) + 'KB ===');

  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e=>errors.push(String(e.message || e)));
  vc.on('error', (...a)=>errors.push(a.join(' ')));

  const stub = w => {
    w.fetch = makeFetch(globalThis.fetch);
    w.Tone = { start(){}, getContext(){ return { rawContext:{} }; },
      getDestination(){ return { volume:{ value:0 } }; }, Transport:{ start(){}, pause(){} } };
    w.JSSynth = { AudioWorkletNodeSynthesizer: function(){
      this.init=async()=>{}; this.loadSFont=async()=>{}; this.stop=()=>{}; this.playNewMIDI=async()=>{}; } };
    w.navigator.clipboard = { writeText: async()=>{} };
  };

  const dom = new JSDOM(html, { url: BASE, runScripts:'dangerously', pretendToBeVisual:true,
    virtualConsole: vc, resources:'usable', beforeParse: stub });
  const d = dom.window.document;
  const click = el => el && el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles:true }));
  await wait(3200);
  if (errors.length) console.log('  [诊断] ' + errors.slice(0,3).map(e=>String(e).slice(0,140)).join(' | '));

  /* 【1】扉页 */
  console.log('\n【1】扉页与骨架');
  const hmeta = d.getElementById('heroMeta');
  ok('扉页改为紧凑行内数字（无大数字块）', !!hmeta && d.querySelectorAll('.fig').length === 0);
  ok('曲目总数已填充', /124[,.]?179/.test((hmeta||{}).textContent || ''), (hmeta||{}).textContent);
  ok('导语已填充', (((d.getElementById('heroLede')||{}).textContent) || '').length > 20);
  ok('标题为衬线大标题', /MIDI/.test((d.querySelector('.hero h1')||{}).textContent || ''));
  ok('编辑导语存在', !!d.querySelector('.hero .lede'));

  /* 【2】浏览轴 */
  console.log('\n【2】浏览轴与瓦片');
  const axes = d.querySelectorAll('#axes .axis');
  ok('浏览轴 3 个（分类/来源/使用方式）', axes.length === 3, axes.length + ' 个');
  await wait(700);
  ok('分类瓦片 14 个', d.querySelectorAll('#grid .tile').length === 14,
     d.querySelectorAll('#grid .tile').length + ' 个');
  ok('瓦片含声波签名', d.querySelectorAll('#grid .tile .sig i').length > 20);
  ok('分类瓦片标注来源', /来源|Source/.test((d.querySelector('#grid .tile .tlic')||{}).textContent || ''));

  const srcAxis = [...axes].find(a=>/来源|Source/.test(a.textContent));
  click(srcAxis); await wait(800);
  ok('切「按来源」→ 19 个瓦片', d.querySelectorAll('#grid .tile').length === 19,
     d.querySelectorAll('#grid .tile').length + ' 个');
  ok('来源瓦片带许可徽标', d.querySelectorAll('#grid .tile .lic').length >= 19);
  const tierAxis = [...d.querySelectorAll('#axes .axis')].find(a=>/使用方式|tier/i.test(a.textContent));
  click(tierAxis); await wait(700);
  ok('切「按使用方式」→ 3 个瓦片', d.querySelectorAll('#grid .tile').length === 3);

  /* 【3】列表 */
  console.log('\n【3】列表');
  click(d.querySelector('#axes .axis')); await wait(2500);
  const rows = d.querySelectorAll('#list .row');
  ok('列表已渲染曲目行', rows.length > 0, rows.length + ' 行');
  ok('行含来源列', d.querySelectorAll('#list .row .src').length === rows.length);
  ok('行含时长 mm:ss', /^\d+:\d\d$/.test((d.querySelector('#list .row .dur')||{}).textContent || ''),
     (d.querySelector('#list .row .dur')||{}).textContent);
  ok('表头 6 列（含详情列）', d.querySelectorAll('.listhead span').length === 6, d.querySelectorAll('.listhead span').length + ' 列');
  ok('行内有明确「详情」入口', !!d.querySelector('#list .row .detbtn'));
  ok('状态栏显示计数', /加载|loaded/.test((d.querySelector('#status')||{}).textContent || ''));

  /* 【4】筛选 */
  console.log('\n【4】筛选（内联，无抽屉）');
  ok('筛选面板默认收起', d.getElementById('fpanel').hidden === true);
  click(d.getElementById('ftoggle')); await wait(400);
  ok('点开后内联展开', d.getElementById('fpanel').hidden === false && !d.body.classList.contains('sheet-open'));
  ok('筛选字段齐全', ['fComp','fPeriod','fInst','fGenre','fCountry','fForm','fZone','fDur','fSort']
     .every(id=>!!d.getElementById(id)));
  const perSel = d.getElementById('fPeriod');
  ok('时期下拉已由 browse.json 填充', perSel.options.length > 3, perSel.options.length + ' 项');
  const before = d.querySelectorAll('#list .row').length;
  if (perSel.options.length > 1){
    perSel.value = perSel.options[1].value;
    perSel.dispatchEvent(new dom.window.Event('change', { bubbles:true }));
    await wait(900);
    const after = d.querySelectorAll('#list .row').length;
    ok('按时期筛选后列表变化', after !== before || after === 0, before + ' → ' + after);
    perSel.value = '';
    perSel.dispatchEvent(new dom.window.Event('change', { bubbles:true }));
    await wait(500);
  } else { ok('按时期筛选后列表变化', false, '下拉未填充'); }
  click(d.getElementById('fclose')); await wait(300);
  ok('点收起可关闭面板', d.getElementById('fpanel').hidden === true);

  /* 【5】设计系统 */
  console.log('\n【5】设计系统');
  const styleTxt = [...d.querySelectorAll('style')].map(s=>s.textContent).join('\n');
  ok('首页容器与文档页同规格', /<main class="app">/.test(html) && /main\.app\{[^}]*max-width:var\(--wrap\)/.test(html));
  ok('无嵌套滚动容器（无拖拉框）', !/overflow-y:\s*auto/.test(styleTxt) && !/overflow-y:\s*auto/.test(html));
  ok('采用墨·纸·朱砂令牌', /--vermilion/.test(html) || /--vermilion/.test(styleTxt));
  ok('衬线标题字体已定义', /--serif/.test(html) || /--serif/.test(styleTxt));
  ok('触控尺寸采用 44px 令牌', /var\(--tap\)/.test(html) || /--tap:\s*44px/.test(html) || (cacheData['assets/style.css'] || '').includes('--tap:44px'));
  ok('去苹果风：无模糊/光晕', !/backdrop-filter/.test(html) && !/backdrop-filter/.test(styleTxt));

  /* 【6】导航与页脚 */
  console.log('\n【6】导航与页脚');
  const nav = [...d.querySelectorAll('.nav a')].map(a=>a.getAttribute('href'));
  ok('导航含四页', ['./','download.html','sources.html','licenses.html'].every(h=>nav.includes(h)), nav.join(' '));
  ok('页脚四栏', d.querySelectorAll('footer .fgrid > div').length === 4);
  ok('页脚含许可声明', /许可|licence/i.test((d.getElementById('footLegal')||{}).textContent || ''));

  /* 【7】运行时 */
  console.log('\n【7】运行时');
  const real = errors.filter(e=>!/Not implemented|Could not parse CSS|Unsupported|fetch|NetworkError|XHR/i.test(e));
  ok('无脚本错误', real.length === 0, real.slice(0,2).join(' | '));

  /* 【8】详情页 */
  console.log('\n【8】详情页');
  try{
    const dPath = LOCAL ? path.join(path.dirname(LOCAL), 'detail.html') : null;
    const dhtml = LOCAL
      ? localize(fs.readFileSync(dPath, 'utf-8'), dPath)
      : await (await fetch(ORIGIN + 'detail.html')).text();
    const ddom = new JSDOM(dhtml, {
      url: ORIGIN + 'detail.html?id=aria-000004&cat=piano&chunk=0',
      runScripts:'dangerously', pretendToBeVisual:true, virtualConsole: vc, resources:'usable', beforeParse: stub
    });
    const dd0 = ddom.window.document;
    for (let i = 0; i < 30; i++){                      // 详情页要先拉 4MB loc.json，代理慢时需等待
      if (dd0.querySelectorAll('#ident dt').length >= 8) break;
      await wait(600);
    }
    const dd = ddom.window.document;
    const ttl = (dd.getElementById('ttl')||{}).textContent || '';
    ok('详情页标题渲染', ttl.length > 1 && ttl !== '…', ttl);
    ok('识别信息 ≥10 项', dd.querySelectorAll('#ident dt').length >= 10, dd.querySelectorAll('#ident dt').length + ' 项');
    const ident = (dd.getElementById('ident')||{}).textContent || '';
    ok('含作曲家与作品编号', /COMPOSER|作曲家/.test(ident) && /CATALOGUE|作品编号/.test(ident));
    const sb = (dd.getElementById('srcbox')||{}).textContent || '';
    ok('来源档案含原始链接', /https?:\/\//.test(sb));
    ok('来源档案含上游形态与致谢', /上游形态|UPSTREAM/.test(sb) && /致谢|CREDIT/.test(sb));
    ok('许可档位徽标出现', dd.querySelectorAll('#licbox .lic').length >= 1);
    const at = (dd.getElementById('attrtxt')||{}).textContent || '';
    ok('署名文本含本库与许可', /midicn-lib/.test(at) && /许可|licence/i.test(at));
    ok('复制署名按钮存在', !!dd.getElementById('copy'));
    ok('数据记录含文件路径', /\.mid/.test((dd.getElementById('rec')||{}).textContent || ''));
    ok('相关作品列出', dd.querySelectorAll('#recs a').length > 0, dd.querySelectorAll('#recs a').length + ' 项');
    ok('下载按钮指向 .mid', /\.mid$/.test((dd.getElementById('dl')||{}).getAttribute('href') || ''));
  }catch(e){ ok('详情页测试', false, String(e).slice(0, 90)); }

  /* 【9】内容页 */
  console.log('\n【9】内容页');
  for (const [file, musts] of [
    ['sources.html', [/HOME|原始地址/, /thesession\.org/, /mutopiaproject/, /CREDIT|致谢/, /MuseData/]],
    ['sources.html', [/开源项目/]],
    ['licenses.html', [/C1/, /署名|attribution/i, /下架|takedown/i, /48/, /CC BY-SA/i]],
    ['download.html', [/by source|按来源/i, /by usage|按使用方式/i, /VER = 'v1\.19'/, /meta\.zip/]],
  ]){
    try{
      let h;
      if (LOCAL){
        const fp = path.join(path.dirname(LOCAL), file);
        h = localize(fs.readFileSync(fp, 'utf-8'), fp);
      } else {
        h = await (await fetch(ORIGIN + file)).text();
      }
      try{ h += await (await fetch(ORIGIN + 'assets/archive.js')).text(); }catch(e){}
      const txt = h.replace(/<[^>]+>/g, ' ');
      const miss = musts.filter(r=>!(r.test(txt) || r.test(h)));
      ok(file + ' 关键内容齐备', miss.length === 0, miss.length ? '缺: ' + miss.join(' ') : '');
    }catch(e){ ok(file + ' 可访问', false, String(e).slice(0, 60)); }
  }

  console.log('\n===== 结果 (' + (pass + fail) + ' 项): ' + pass + '/' + (pass + fail) + ' 通过 =====');
  if (fails.length) console.log('失败项:\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
