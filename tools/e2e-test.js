/* midicn-lib 端到端回归 v11.4（TheSession 条款披露）*/
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
  const [arch, plr, css] = await Promise.all([
    grab('assets/archive.js'), grab('assets/player.js'), grab('assets/style.css')]);
  return html
    .replace(/<script[^>]*src="vendor\/[^"]+"[^>]*><\/script>/g, '')
    .replace(/<script[^>]*src="soundfont\/[^"]+"[^>]*><\/script>/g, '')
    .replace(/<script[^>]*src="assets\/archive\.js"[^>]*><\/script>/g,
      arch ? '<script>' + arch + '</script>' : '')
    .replace(/<script[^>]*src="assets\/player\.js"[^>]*><\/script>/g,
      plr ? '<script>' + plr + '</script>' : '')
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
       若不监听就会"零错误却零渲染"（本轮 bug 正是如此藏了三轮）*/
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
     固定延时在慢网/大分片下会产生假失败（本轮 52/56 的 4 项失败即因此）*/
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
  ok('首页与其他页同一容器（doc wide）', /<main class="doc wide">/.test(html) && !/app-grid|class="app"/.test(html));
  ok('无嵌套滚动容器（无拖拉框）', !/overflow-y:\s*auto/.test(styleTxt) && !/overflow-y:\s*auto/.test(html));
  ok('采用墨·纸·朱砂令牌', /--vermilion/.test(html) || /--vermilion/.test(styleTxt));
  ok('衬线标题字体已定义', /--serif/.test(html) || /--serif/.test(styleTxt));
  ok('触控尺寸采用 44px 令牌', /var\(--tap\)/.test(html) || /--tap:\s*44px/.test(html) || (cacheData['assets/style.css'] || '').includes('--tap:44px'));
  ok('去苹果风：无模糊/光晕', !/backdrop-filter/.test(html) && !/backdrop-filter/.test(styleTxt));

  /* 【6】导航与页脚 */
  console.log('\n【6】导航与页脚');
  const nav = [...d.querySelectorAll('.nav a')].map(a=>a.getAttribute('href'));
  ok('导航含四页', ['./','download.html','sources.html','licenses.html'].every(h=>nav.includes(h)), nav.join(' '));
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
    ['licenses.html', [/C1/, /署名|attribution/i, /下架|takedown/i, /48/, /CC BY-SA/i, /禁止用于大语言模型|LLM/]],
    ['download.html', [/by source|按来源/i, /by usage|按使用方式/i, /VER = 'v1\.19'/, /meta\.zip/]],
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

  /* 【10】引擎解耦：渲染路径不依赖音频引擎（本轮真因修复的回归防线）*/
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
    ok('19 个来源地址与真实采集来源一致', miss.length === 0,
       miss.length ? '不符: ' + miss.map(([i])=>i).join(' ') : '');
    /* 已知错误 / 无关地址不得复现 */
    const FORBIDDEN = ['lucasnata','lucasnfe','www.ihchina.cn','EMOPIA/EMOPIA','jukedeck/nottingham',
                       'www.wikifonia.org','web.mit.edu/music21','kernscores','openscore.cc','aria-midi.org'];
    const back = FORBIDDEN.filter(b => arch.includes(b));
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
    ok('站内台账页存在且含 19 张来源卡', ncards === 19, ncards ? ncards + ' 张' : '（未找到）');
    ok('台账页含三条规则与 180 天复核周期', /三条规则/.test(pv) && /180 天复核周期/.test(pv));
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
