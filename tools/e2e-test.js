/* midicn-lib 端到端回归 v11.8（v1.23 断言同步）*/
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

/* 把共享模块内联进 HTML，并移除 vendor 引擎脚本（Tone/JSSynth 已 stub）。
   本地模式读盘；在线模式从源站抓取 —— 两路统一，测试不再受 CDN 抖动影响 */
async function inlineAssets(html, htmlPath){
  const dir = htmlPath ? path.dirname(htmlPath) : null;
  const grab = async rel => {
    if (dir){
      try{ return fs.readFileSync(path.join(dir, rel.replace('/', path.sep)), 'utf-8'); }catch(e){}
    }
    try{ return await (await fetch(ORIGIN + rel)).text(); }catch(e){}
    return '';
  };
  const [arch, plr, css, shell] = await Promise.all([
    grab('assets/archive.js'), grab('assets/player.js'), grab('assets/style.css'),
    grab('assets/shell.js')]);
  return html
    .replace(/<script[^>]*src="vendor\/[^"]+"[^>]*><\/script>/g, '')
    .replace(/<script[^>]*src="soundfont\/[^"]+"[^>]*><\/script>/g, '')
    .replace(/<script[^>]*src="assets\/archive\.js"[^>]*><\/script>/g,
      arch ? '<script>' + arch + '</script>' : '')
    .replace(/<script[^>]*src="assets\/player\.js"[^>]*><\/script>/g,
      plr ? '<script>' + plr + '</script>' : '')
    // 三站共享外壳脚本：必须内联，否则 jsdom 会去网络抓 → 假「脚本错误」
    .replace(/<script[^>]*src="assets\/shell\.js"[^>]*><\/script>/g,
      shell ? '<script>' + shell + '</script>' : '')
    .replace(/<link[^>]*href="assets\/style\.css"[^>]*>/g,
      css ? '<style>' + css + '</style>' : '');
}


/* 取静态资源文本：本地模式读盘（避免误测线上旧版），否则走源站 */
async function assetText(rel){
  if (LOCAL){
    try{ return fs.readFileSync(path.join(path.dirname(LOCAL), rel.replace('/', path.sep)), 'utf-8'); }catch(e){}
  }
  try{ return await (await fetch(ORIGIN + rel)).text(); }catch(e){}
  return '';
}

const PRE = ['data/summary.json','data/browse.json','data/loc.json','data/works.json','assets/style.css'];
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
  const dir = LOCAL ? path.dirname(LOCAL) : null;
  return async (u, opt)=>{
    const url = String(u);
    const key = url.replace(/^.*?(data\/)/, '$1');
    if (cacheData[key]) return new Response(cacheData[key], { status:200 });
    if (cacheData['assets/style.css'] && key === 'assets/style.css') return new Response(cacheData['assets/style.css'], { status:200 });
    /* 本地模式：**任何 data/ 文件都按需从磁盘读**，不要走网络。
       原先只预读了 summary/browse/loc，详情页要的分片（如 data/cat-piano-0.json）
       无处命中 → 落到 realFetch 去抓线上 → 网络一慢就失败（假回归的根因）。 */
    if (dir && key.startsWith('data/')){
      try{
        return new Response(fs.readFileSync(path.join(dir, key.replace('/', path.sep)), 'utf-8'), { status:200 });
      }catch(e){ return new Response('{}', { status:404 }); }
    }
    try{
      const abs = /^https?:/.test(url) ? url : ORIGIN + key;
      return await realFetch(abs, opt);
    }catch(e){ return new Response('{}', { status:404 }); }
  };
}

(async ()=>{
  await preload();
  const RAW = LOCAL ? fs.readFileSync(LOCAL, 'utf-8') : await (await fetch(BASE)).text();
  const html = await inlineAssets(RAW, LOCAL || null);
  console.log('=== 测试对象: ' + (LOCAL || BASE) + ' · ' + (html.length/1024).toFixed(1) + 'KB ===');

  const vc = new VirtualConsole();
  const errors = [];
  const asyncErrs = [];
  vc.on('jsdomError', e=>errors.push(String(e.message || e)));
  vc.on('error', (...a)=>errors.push(a.join(' ')));

  const stub = w => {
    w.fetch = makeFetch(globalThis.fetch);
    /* 异步异常必须被捕获：async boot() 里的 throw 只会变成 unhandledrejection，
       若不监听就会"零错误却零渲染"（曾因此连续三轮零报错却零渲染）*/
    w.addEventListener('unhandledrejection', e => {
      const r = e.reason;
      asyncErrs.push('unhandledrejection: ' + ((r && (r.stack || r.message)) || String(r)));
    });
    w.addEventListener('error', e => {
      asyncErrs.push('error: ' + (e.message || (e.error && e.error.stack) || '?'));
    });
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
  /* 首屏要拉分片数据（可能几百 KB）→ 轮询等瓦片与曲目行就绪。
     固定延时在慢网/大分片下会产生假失败（曾造成 4 项假失败）*/
  await wait(800);
  for (let i = 0; i < 40; i++){
    if (d.querySelectorAll('#grid .tile').length && d.querySelectorAll('.row').length) break;
    await wait(500);
  }
  if (errors.length) console.log('  [诊断] ' + errors.slice(0,3).map(e=>String(e).slice(0,140)).join(' | '));

  /* 【1】扉页 */
  console.log('\n【1】扉页与骨架');
  const hmeta = d.getElementById('heroMeta');
  ok('扉页改为紧凑行内数字（无大数字块）', !!hmeta && d.querySelectorAll('.fig').length === 0);
  ok('曲目总数已填充', /133[,.]?667/.test((hmeta||{}).textContent || ''), (hmeta||{}).textContent);
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
  ok('切「按来源」→ 21 个瓦片', d.querySelectorAll('#grid .tile').length === 21,
     d.querySelectorAll('#grid .tile').length + ' 个');
  ok('来源瓦片带许可徽标', d.querySelectorAll('#grid .tile .lic').length >= 21);
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
    ok('列表窗口化（上下占位）', d.querySelectorAll('#list .vsp').length === 2,
       d.querySelectorAll('#list .vsp').length + ' 个');
    ok('DOM 精简（窗口行 ≤ 60）', (() => { const n = d.querySelectorAll('#list .row').length; return n > 0 && n <= 60; })(),
       d.querySelectorAll('#list .row').length + ' 行');
    ok('总数标注 aria-rowcount', d.getElementById('list').getAttribute('aria-rowcount') === '500',
       d.getElementById('list').getAttribute('aria-rowcount'));
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
  ok('首页与其他页同一容器（doc wide）', /<main class="doc wide">/.test(html) && !/app-grid|class="app"/.test(html));
  ok('无嵌套滚动容器（无拖拉框）', !/overflow-y:\s*auto/.test(styleTxt) && !/overflow-y:\s*auto/.test(html));
  ok('采用墨·纸·朱砂令牌', /--vermilion/.test(html) || /--vermilion/.test(styleTxt));
  ok('衬线标题字体已定义', /--serif/.test(html) || /--serif/.test(styleTxt));
  ok('触控尺寸采用 44px 令牌', /var\(--tap\)/.test(html) || /--tap:\s*44px/.test(html) || (cacheData['assets/style.css'] || '').includes('--tap:44px'));
  ok('去苹果风：无模糊/光晕', !/backdrop-filter/.test(html) && !/backdrop-filter/.test(styleTxt));

  /* 【6】导航与页脚 */
  console.log('\n【6】导航与页脚');
  const nav = [...d.querySelectorAll('.nav a')].map(a=>a.getAttribute('href'));
  // v1.23：三站统一导航（六项，跨站用绝对 URL）——「详细校验」见【12】
  ok('导航含姊妹站与关键页',
     ['https://lib.midicn.com/', 'https://mid.midicn.com/', 'https://zip.midicn.com/']
       .every(h => nav.some(a => a === h)) &&
     ['sources.html', 'lyrics.html', 'licenses.html']
       .every(h => nav.some(a => a.endsWith(h))),
     nav.join(' '));
  ok('页脚为紧凑两行（链接 + 声明）', !!d.querySelector('footer .fbar') && !!d.querySelector('footer .fnote'));
  ok('页脚含许可声明', /许可|licence/i.test((d.getElementById('footLegal')||{}).textContent || ''));

  /* 【7】运行时 */
  console.log('\n【7】运行时');
  const real = errors.filter(e=>!/Not implemented|Could not parse CSS|Unsupported|fetch|NetworkError|XHR/i.test(e));
  ok('无脚本错误', real.length === 0, real.slice(0,2).join(' | '));
  const realAsync = asyncErrs.filter(e=>!/Not implemented|Could not parse CSS|Unsupported|fetch|NetworkError|XHR|load_engine|音频引擎/i.test(e));
  ok('无未捕获的异步异常', realAsync.length === 0, realAsync.slice(0,2).join(' | ').slice(0,220));

  /* 【8】详情页 */
  console.log('\n【8】详情页');
  try{
    const dPath = LOCAL ? path.join(path.dirname(LOCAL), 'detail.html') : null;
    const dhtml = await inlineAssets(LOCAL ? fs.readFileSync(dPath, 'utf-8')
      : await (await fetch(ORIGIN + 'detail.html')).text(), LOCAL ? dPath : null);
    const ddom = new JSDOM(dhtml, {
      url: ORIGIN + 'detail.html?id=aria-000004&cat=piano&chunk=0',
      runScripts:'dangerously', pretendToBeVisual:true, virtualConsole: vc, resources:'usable', beforeParse: stub
    });
    const dd0 = ddom.window.document;
    // 详情页要先拉 4.7MB loc.json —— 高负载（构建/上传并行）时可能超过 18 秒，
    // 造成「11 项全挂」的假回归。这里放宽到 60 次（36 秒），并加一次短退避重试。
    for (let i = 0; i < 60; i++){
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
    /* TheSession 附加条款*/
    try {
      const sdom = new JSDOM(dhtml, { url: ORIGIN + 'detail.html?id=thesession-000000',
        runScripts:'dangerously', pretendToBeVisual:true, virtualConsole: vc, resources:'usable', beforeParse: stub });
      let slic = '';
      for (let i = 0; i < 30; i++){        // 同样放宽（原 16 次在高负载下会假失败）
        await wait(600);
        slic = (sdom.window.document.getElementById('licbox')||{textContent:''}).textContent || '';
        if (slic.includes('附加条款')) break;
      }
      ok('thesession 详情含 LLM 附加条款', slic.includes('禁止用于大语言模型'), slic.slice(0,60));
    } catch (e) { ok('thesession 详情含 LLM 附加条款', false, String(e).slice(0,60)); }
  }catch(e){ ok('详情页测试', false, String(e).slice(0, 90)); }

  /* 【9】内容页 */
  console.log('\n【9】内容页');
  for (const [file, musts] of [
    ['sources.html', [/HOME|原始地址/, /thesession\.org/, /mutopiaproject/, /CREDIT|致谢/, /MuseData/]],
    ['sources.html', [/开源项目/]],
    ['licenses.html', [/C1/, /署名|attribution/i, /下架|takedown/i, /48/, /CC BY-SA/i, /禁止用于大语言模型|LLM/]],
    ['licenses.html', [/内嵌歌词|Embedded lyrics/]],                 // F3 独立权利层
    // v1.23：包入口统一到 zip 站 → 本页改为「总览 + 跳转」，断言随之改写（N4）
    ['download.html', [/zip\.midicn\.com/, /用途包|usage pack/i, /维度包|dimension pack/i, /400\+/]],
    ['download.html', [/VER = 'v1\.23'/, /meta\.zip|目录与索引|Catalogue/i]],
    ['download.html', [/歌词|lyrics/i]],                              // F2 歌词不随包分发
    // F2：歌词库仅站内展示 —— 页必须显著声明「仅研究/学习」且不提供下载
    ['lyrics.html', [/歌词检索|Lyrics search/, /仅限研究|study use only|研究、教学与学习/, /独立于曲目的另一层权利对象|separate rights object/, /不主张著作权|claims no copyright/]],
  ]){
    try{
      let h;
      if (LOCAL){
        const fp = path.join(path.dirname(LOCAL), file);
        h = await inlineAssets(fs.readFileSync(fp, 'utf-8'), fp);
      } else {
        h = await inlineAssets(await (await fetch(ORIGIN + file)).text(), null);
      }
      h += await assetText('assets/archive.js');
      const txt = h.replace(/<[^>]+>/g, ' ');
      const miss = musts.filter(r=>!(r.test(txt) || r.test(h)));
      ok(file + ' 关键内容齐备', miss.length === 0, miss.length ? '缺: ' + miss.join(' ') : '');
    }catch(e){ ok(file + ' 可访问', false, String(e).slice(0, 60)); }
  }

  /* 【10】引擎解耦：渲染路径不依赖音频引擎 */
  console.log('\n【10】引擎解耦（渲染不依赖音频引擎）');
  try{
    ok('引擎脚本使用 defer（不阻塞解析）', /<script defer src="vendor\/Tone\.js">/.test(RAW));
    ok('存在按需加载入口 loadEngine/withEngine',
       /function loadEngine\(/.test(html) && /withEngine\(/.test(html));
    /* 剥掉全部引擎脚本，只留共享模块与页面脚本 → 仍须渲染出瓦片与曲目行 */
    let noEng = html
      .replace(/<script[^>]*src="vendor\/[^"]+"[^>]*><\/script>/g, '')
      .replace(/<script[^>]*src="soundfont\/[^"]+"[^>]*><\/script>/g, '')
      .replace(/<script[^>]*src="assets\/player\.js"[^>]*><\/script>/g, '');
    const eDom = new JSDOM(await inlineAssets(noEng, LOCAL || null), {
      url: BASE, runScripts:'dangerously', pretendToBeVisual:true,
      virtualConsole: vc, resources:'usable', beforeParse: stub });
    const ed = eDom.window.document;
    /* 数据分片可能几百 KB → 轮询等待（不用固定延时，避免抖动误报）*/
    for (let i = 0; i < 30; i++){
      if (ed.querySelectorAll('#grid .tile').length && ed.querySelectorAll('.row').length) break;
      await wait(500);
    }
    const tiles = ed.querySelectorAll('#grid .tile').length;
    const rows  = ed.querySelectorAll('.row').length;
    ok('引擎缺席时分类瓦片仍渲染', tiles > 0, tiles + ' 个');
    ok('引擎缺席时列表仍渲染', rows > 0, rows + ' 行');
    ok('引擎缺席时状态栏不报错', !/引擎加载失败|Error/i.test((ed.getElementById('status')||{}).textContent || ''),
       (ed.getElementById('status')||{}).textContent || '');
    /* 点播放：应给出可见提示而不是静默失败或未捕获异常 */
    const before = asyncErrs.length;
    const firstRow = ed.querySelector('.row');
    if (firstRow){
      firstRow.dispatchEvent(new eDom.window.MouseEvent('click', { bubbles:true }));
      await wait(1200);
    }
    ok('引擎缺席时点播放只提示、不抛未捕获异常', asyncErrs.length === before,
       asyncErrs.slice(before, before+1).join(' ').slice(0,150));
  }catch(e){ ok('引擎解耦测试', false, String(e).slice(0, 90)); }

  /* 【12】三站统一外壳 + SEO
     三站的页头/页脚/图标/互链必须一致；每页必须带全套 SEO 要素。 */
  console.log('\n【12】统一外壳与 SEO');
  {
    const files = ['index.html','download.html','sources.html','lyrics.html',
                   'licenses.html','provenance.html','detail.html','404.html'];
    const NAVKEYS = ['音乐库','维度浏览','包下载','数据来源','歌词检索','许可与法律'];
    const base = path.dirname(LOCAL);
    let navOK = 0, seoOK = 0, shellOK = 0, extOK = 0;
    for (const f of files){
      const fp = path.join(base, f);
      if (!fs.existsSync(fp)) continue;
      const s = fs.readFileSync(fp, 'utf-8');
      // 主导航必含 6 项且互链到姊妹站
      const navBlock = (s.match(/<nav class="nav"[\s\S]*?<\/nav>/) || [''])[0];
      const hasAll = NAVKEYS.every(k => navBlock.includes(k));
      if (hasAll) navOK++;
      // 跨站互链存在
      if (s.includes('https://mid.midicn.com/') && s.includes('https://zip.midicn.com/')) extOK++;
      // SEO 要素
      const seo = ['rel="canonical"', 'property="og:title"', 'name="twitter:card"',
                   'application/ld+json', 'rel="icon"', 'hreflang="zh-CN"', 'og:image'];
      if (seo.every(x => s.includes(x)) && (s.match(/<!-- SEO:BEGIN/g) || []).length === 1) seoOK++;
      // 共享外壳脚本
      if (s.includes('assets/shell.js')) shellOK++;
    }
    const n = files.filter(f => fs.existsSync(path.join(base, f))).length;
    ok('主导航六项齐全', navOK === n, `${navOK}/${n} 页`);
    ok('跨站互链（mid + zip）', extOK === n, `${extOK}/${n} 页`);
    ok('SEO 要素齐全（canonical/og/twitter/JSON-LD/icon/hreflang）', seoOK === n, `${seoOK}/${n} 页`);
    ok('共享外壳脚本已注入', shellOK === n, `${shellOK}/${n} 页`);
    ok('robots.txt + sitemap.xml 齐备',
       fs.existsSync(path.join(base, 'robots.txt')) && fs.existsSync(path.join(base, 'sitemap.xml')));
    ok('OG 分享图存在', fs.existsSync(path.join(base, 'assets', 'og.png')));
  }

  /* 说明：公开内容卫生（内部路径/脚本名/未完成标记、中英混排）不在此重复实现——
     规则单一真源在 tools/audit_public.py，由 preflight 强制门执行。 */

  /* 【15】播放引擎接线（守住三个已踩过的坑：方法名 / 调用顺序 / 音源资产） */
  console.log('\n【15】播放引擎接线');
  {
    const dir = path.dirname(LOCAL);
    const pjRaw = fs.readFileSync(path.join(dir, 'assets/player.js'), 'utf-8');
    /* 剥掉注释再判：否则「说明里提到某个不存在的方法」会被误判为「代码里在调它」 */
    const pj = pjRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    /* ① 方法名必须用 addSMFDataToPlayer —— js-synthesizer 1.13 **没有** playNewMIDI，
          历史上正是调了个不存在的方法 + catch 吞异常，导致音源从未生效。 */
    ok('用 addSMFDataToPlayer（非 playNewMIDI）',
       /addSMFDataToPlayer/.test(pj) && !/playNewMIDI/.test(pj));
    /* ② 两个 worklet 模块都要 addModule（只加载主线程脚本不够） */
    ok('注册 libfluidsynth + worklet 两个模块',
       /libfluidsynth[^'"]*\.js/.test(pj) && /js-synthesizer\.worklet[^'"]*\.js/.test(pj));
    /* ③ init 收 sampleRate 数字；且必须先 createAudioNode */
    ok('init(sampleRate) + createAudioNode 顺序正确',
       /init\(AC\.sampleRate\)|\.sampleRate\)/.test(pj) && /createAudioNode/.test(pj));
    /* ④ 必须用**原生** AudioContext —— Tone.js v14 的 getContext().rawContext
          返回的是包装对象（非原生），它的 addModule 能转发成功，但
          new AudioWorkletNode(它, ...) 会抛
          "TypeError: parameter 1 is not of type 'BaseAudioContext'"。
          这是线上「一直显示合成音源」的真正根因，必须锁住。 */
    ok('用原生 AudioContext（非 Tone 包装对象）',
       /global\.AudioContext|global\.webkitAudioContext|new\s+AudioContext/.test(pj)
       && !/Tone\.getContext\(\)\.rawContext/.test(pj));
    /* ④b 换曲必须先 resetPlayer —— 底层 add_mem 是「追加到播放列表」，
          不重置会导致「页面标题变了但音乐不变」。 */
    ok('换曲前 resetPlayer()（清空播放列表）',
       /resetPlayer\(\)/.test(pj)
       && pj.indexOf('resetPlayer()') < pj.indexOf('addSMFDataToPlayer('));
    /* ④c 不得对返回 Promise 的 API 先 num() —— num(Promise) 恒为 null，
          曾导致进度条永远不动。总 tick 必须在 playPlayer() 之后读。 */
    ok('进度 API 按 Promise 处理（无 num() 误用）',
       !/num\(\s*sf\.retrieve/.test(pj)
       && pj.indexOf('retrievePlayerTotalTicks') > pj.indexOf('playPlayer()'));
    /* ⑤ 音源预热在取音频之前（并行；音频 404 也不放弃音源） */
    ok('音源预热与音频抓取并行',
       pj.indexOf('ensureSoundFont()') < pj.indexOf("fetch(track.f"));
    /* ⑥ 质量与进度 API 在位 */
    /* 音源体积哨兵：gz 应在 24–32 MB（全量 GeneralUser GS）。
       骤减说明文件被截断或被误换成子集。
       ⚠️ 子集化曾丢过 `pmod`/`imod` 调制器表（449+1809 条 → 各 1 条）导致音色变差，
       故此处只认「全量区间」；要启用子集必须先修好调制器保真并用 --verify 覆盖到它。 */
    {
      const gzPath = path.join(dir, 'soundfont/GeneralUser-GS.sf2.gz');
      const mb = fs.existsSync(gzPath) ? fs.statSync(gzPath).size / 1048576 : 0;
      ok('音源体积在全量区间（24–32 MB）', mb >= 24 && mb <= 32, mb.toFixed(1) + ' MB');
    }
        ok('含质量/进度 API（setInterpolation / retrievePlayerTotalTicks）',
       /setInterpolation/.test(pj) && /retrievePlayerTotalTicks/.test(pj));
    /* ⑤ 音源资产：.gz 能解成合法 SF2（RIFF + 'sfbk'） */
    const zlib = require('zlib');
    const gz = path.join(dir, 'soundfont/GeneralUser-GS.sf2.gz');
    const raw = path.join(dir, 'soundfont/GeneralUser-GS.sf2');
    ok('音源文件齐备（.sf2 + .gz）', fs.existsSync(gz) && fs.existsSync(raw),
       fs.existsSync(gz) && fs.existsSync(raw) ? (fs.statSync(gz).size/1048576).toFixed(1) + ' MB(gz)'
                                                : '缺失');
    if (fs.existsSync(gz)){
      try {
        const buf = zlib.gunzipSync(fs.readFileSync(gz)).subarray(0, 12);
        ok('gz 解出合法 SoundFont（RIFF/sfbk）',
           buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'sfbk');
      } catch(e){ ok('gz 解出合法 SoundFont（RIFF/sfbk）', false, e.message); }
    }
    /* ⑥ SW 对音源做 cache-first（只下一次） */
    const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf-8');
    ok('SW 对 .sf2/.sf2.gz 做 cache-first', /\.sf2/.test(sw) && /cache/i.test(sw));
  }

  /* 【14】未收录源清单与目录同步（防止站点与 SOURCE-CATALOG.md 漂移） */
  console.log('\n【14】未收录源清单');
  {
    const arch = fs.readFileSync(path.join(path.dirname(LOCAL), 'assets/archive.js'), 'utf-8');
    const m = arch.match(/const EXCLUDED = \[([\s\S]*?)\n\];/);
    const n = m ? (m[1].match(/id:'/g) || []).length : 0;
    const cats = m ? (m[1].match(/cat:'[ABCD]'/g) || []).length : 0;
    ok('未收录源清单已填写（≥30 条）', n >= 30, n + ' 条');
    ok('每条都带分类标记 A/B/C/D', cats === n, cats + '/' + n);
    // 若本地存在目录文档，则核对数量一致（线上运行时跳过）
    /* 目录规范化后：文档真源在 lib/work/docs/（站点仓是 lib/site/）——
       路径改动会让这条断言**静默不跑**，所以跳过时要显式打印出来。 */
    const catPath = path.resolve(path.dirname(LOCAL), '..', 'work', 'docs', 'SOURCE-CATALOG.md');
    if (!fs.existsSync(catPath)) console.log('    · 未找到 ' + catPath + '（公开克隆场景下正常，跳过目录比对）');
    if (fs.existsSync(catPath)){
      const doc = fs.readFileSync(catPath, 'utf-8');
      const dm = doc.match(/\|\s*未收录源\s*\|\s*(\d+)/);
      const declared = dm ? Number(dm[1]) : null;
      ok('与 SOURCE-CATALOG.md 的数量一致', declared === n, '文档 ' + declared + ' / 站点 ' + n);
    }
  }

  /* 【11】来源地址核验（每个地址都必须对得上真实采集来源，不得臆造）*/
  console.log('\n【11】来源地址核验');
  try{
    const arch = await assetText('assets/archive.js');
    const SRC_URLS = {
      aria:'https://github.com/loubbrad/aria-midi',
      thesession:'https://github.com/adactio/TheSession-data',
      cyberhymnal:'https://www.hymntime.com/tch/',
      chinafolk:'https://github.com/m-july/Anthology-of-Chinese-Folk-Songs',
      essen:'https://www.esac-data.org/',
      giantmidi:'https://github.com/bytedance/GiantMIDI-Piano',
      lakh:'https://colinraffel.com/projects/lmd/',
      norbeck:'https://norbeck.nu/abc/',
      m21:'https://github.com/cuthbertLab/music21',
      mutopia:'https://www.mutopiaproject.org/',
      abcmisc:'http://trillian.mit.edu/~jc/music/abc/',
      openscore:'https://github.com/OpenScore/Lieder',
      maestro:'https://magenta.tensorflow.org/datasets/maestro',
      groove:'https://magenta.tensorflow.org/datasets/groove',
      emopia:'https://zenodo.org/records/5257995',
      nottingham:'https://ifdo.ca/~seymour/nottingham/',
      wikifonia:'http://www.synthzone.com/files/Wikifonia/Wikifonia.zip',
      oga:'https://opengameart.org/',
      musicnet:'https://zenodo.org/records/5120004',
    };
    const miss = Object.entries(SRC_URLS).filter(([id,u]) => !arch.includes("url:'" + u + "'"));
    ok('21 个来源地址与真实采集来源一致', miss.length === 0,
       miss.length ? '不符: ' + miss.map(([i])=>i).join(' ') : '');
    /* 已知错误 / 无关地址不得复现 —— **只在「已收录」来源里查**。
       注意：`EXCLUDED`（考察后未收录）里出现这些名字是**正确**的
       （例如 kernscores 正是我们考察后决定不收的源），不能算违规。 */
    const FORBIDDEN = ['lucasnata','lucasnfe','www.ihchina.cn','EMOPIA/EMOPIA','jukedeck/nottingham',
                       'www.wikifonia.org','web.mit.edu/music21','kernscores','openscore.cc','aria-midi.org'];
    const srcOnly = (arch.match(/SOURCES = \[[\s\S]*?\n\];/) || [''])[0];
    const back = FORBIDDEN.filter(b => srcOnly.includes(b));
    ok('无臆造/无关地址复现', back.length === 0, back.join(' '));
    /* 不再保留多余的「站点」链接（只要一个原始地址）*/
    ok('来源条目仅保留原始地址（无 site 字段）', !/\bsite:'/.test(arch));
    /* 可复核：来源页须给出核验日期与台账入口，且台账文件必须真实存在 */
    const sc = await assetText('sources.html');
    ok('来源页标注核验日期与台账入口', /id="prov"/.test(sc) && /SRC_VERIFIED/.test(sc) && /PROV_DOC/.test(sc));
    ok('核验日期已填且台账指向 PROVENANCE.md',
       /SRC_VERIFIED\s*=\s*'\d{4}-\d{2}-\d{2}'/.test(arch) && /PROVENANCE\.md/.test(arch));
    /* 站内台账页（不依赖 GitHub 的自证入口）*/
    const pv = await assetText('provenance.html');
    const ncards = (pv.match(/class="panel pc"/g) || []).length;
    ok('站内台账页存在且含 21 张来源卡', ncards === 21, ncards ? ncards + ' 张' : '（未找到）');
    ok('台账页含三条规则与可复核性说明', /三条规则/.test(pv) && /可复核性/.test(pv));
    ok('台账页给出整包校验值', /MD5/.test(pv) && /d26e22562e67eb7d37535e96cc5eebba/.test(pv));
    ok('来源页指向站内台账页', /PROV_PAGE/.test(sc) && /PROV_PAGE\s*=\s*'provenance\.html'/.test(arch));
    /* 分区与许可须与发布 catalog 一致 */
    ok('lakh 标注为 C3 学习研究（zone=study）', /id:'lakh'[\s\S]{0,220}?zone:'study'/.test(arch));
    ok('emopia 标注为 C2 非商用（CC BY-NC-SA）',
       /id:'emopia'[\s\S]{0,220}?zone:'piano'[\s\S]{0,80}?license:'CC BY-NC-SA 4\.0'/.test(arch));
  }catch(e){ ok('来源地址核验', false, String(e).slice(0, 90)); }

  console.log('\n===== 结果 (' + (pass + fail) + ' 项): ' + pass + '/' + (pass + fail) + ' 通过 =====');
  if (fails.length) console.log('失败项:\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
