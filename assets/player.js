/* ═══════════════════════════════════════════════════════════════════════
   midicn-lib · player.js
   共享播放引擎，**双路径**：

     ① 采样音源（主路径 · 最高质量）
        FluidSynth (WASM) + GeneralUser GS SoundFont
        —— 用 MIDI 文件自带的乐器信息（program change）逐轨还原音色，
           打击乐走 GM 鼓组，速度/表情按文件原样演奏。
     ② 合成器（兜底 · 秒出声）
        Tone.js PolySynth
        —— 音源未就绪/加载失败时使用，保证任何情况下点得响。

   设计要点
     · **渐进增强**：首次点播放立刻用合成器出声，同时在后台取音源；
       就绪后 badge 变为「采样音源」，之后的播放自动走 FluidSynth。
       不在播放中途切换（会有咔哒声且丢位置）。
     · 任何第三方 API 都先做 typeof 检查再调用 —— 库版本差异不应导致播放失败
     · 解析出错不吞异常：把原因写到状态回调，便于页面向用户说明
     · 对外只暴露 init / play / toggle / stop / next / prev / seek / setVolume / setLoop / isPlaying

   ⚠️ FluidSynth 接入的三个必要条件（js-synthesizer 1.13）
     1. **两个 worklet 模块都要 `audioWorklet.addModule()`**（libfluidsynth + worklet）；
        只加载主线程的 js-synthesizer.min.js 不足以使用合成器。
     2. 调用顺序：`init(sampleRate)` → `createAudioNode(ctx)` → 其它方法。
        `init` 的参数是 **sampleRate 数字**，不是 AudioContext 对象。
     3. 装载 MIDI 用 `addSMFDataToPlayer(arrayBuffer)`；本版本没有 `playNewMIDI`。
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ── 合成器路径的状态 ── */
  var syn = null, bass = null, perc = null, ready = false;
  var part = null, uiTimer = null;
  var playing = false, looping = false;
  var curTotal = 0, curTrack = null, curIdx = -1, queue = [];
  var vol = 70, hooks = {};
  var graph = 'none', lastError = '';

  /* ── 采样音源路径的状态 ── */
  var ENG = 'soundfont/engine/';
  var SF_URL_GZ = 'soundfont/GeneralUser-GS.sf2.gz';   /* 29.2 MB（首选） */
  var SF_URL_RAW = 'soundfont/GeneralUser-GS.sf2';     /* 32.3 MB（兜底·无 DecompressionStream 时） */
  var sf = null, sfNode = null, sfReady = false, sfLoading = false, sfFailed = false;
  var sfCurTotalTick = 0, sfPausedTick = null, sfEngine = 'none';
  var sfStage = '', sfError = '', sfTries = 0, sfLastTick = 0;
  /* ── 音色库来源（用户可选）───────────────────────────────────────
     { kind:'bundled' }                    内置 GeneralUser GS（我们托管）
     { kind:'url', url, gz }               其它在线音色（须许可允许分发）
     { kind:'local', name, size }          用户自选的本地 .sf2（存 Cache API，不上传） */
  var SF_SRC_DEF = { kind: 'bundled' };
  var sfSource = SF_SRC_DEF;
  var SF_LS = 'midicn-sfont-src';            /* localStorage 记选择 */
  var SF_LOCAL = 'midicn-sfont-local';       /* Cache API 存用户本地文件 */
  var SF_LOCAL_KEY = '/__midicn_local_sf2__';
  var SF_CACHE = 'midicn-sfont';
  var sfAC = null;                     /* **原生** AudioContext —— FluidSynth 独立使用 */        /* 自己缓存音源，不依赖 SW 是否已接管页面 */

  function $(id) { return document.getElementById(id); }

  /* ── 音色选择：读写 ───────────────────────────────────────────── */
  function loadSfChoice() {
    try {
      var j = JSON.parse(global.localStorage.getItem(SF_LS) || 'null');
      if (j && j.kind) sfSource = j;
    } catch (e) { /* 隐私模式等 → 用默认 */ }
  }
  function saveSfChoice() {
    safe(function () { global.localStorage.setItem(SF_LS, JSON.stringify(sfSource)); });
  }
  /* 关掉现有引擎，让下次播放用新音色重建 */
  function resetEngine() {
    sfReady = false; sfFailed = false; sfTries = 0; sfError = ''; sfStage = '';
    sfCurTotalTick = 0; sfLastTick = 0; sfPausedTick = null;
    sfEngine = 'none'; sfLoading = false;
    safe(function () { sf && sf.close(); });
    sf = null; sfNode = null;
    safe(function () { sfAC && sfAC.state !== 'closed' && sfAC.close(); });
    sfAC = null;
  }
  function fmt(s) {
    s = Math.max(0, Math.round(s || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function safe(fn) { try { return fn(); } catch (e) { return null; } }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

  /* ── 状态回调（页面自行决定怎么显示）─────────────────────────────── */
  function badge(text) { if (hooks.onBadge) safe(function () { hooks.onBadge(text); }); }
  function status(text) { if (hooks.onStatus) safe(function () { hooks.onStatus(text); }); }

  /* ═══════════════════════════════════════════════════════════════════
     路径 ① 采样音源（FluidSynth + SoundFont）
     ═══════════════════════════════════════════════════════════════════ */

  /* 解 gzip（整块解压，比流式 pipe 更稳） */
  async function gunzip(buf) {
    if (!buf) return null;
    var head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    /* 魔数不是 1f 8b → 服务器可能已解压（或传的是 .sf2），原样返回 */
    if (!(head[0] === 0x1f && head[1] === 0x8b)) return buf;
    if (!global.DecompressionStream) return null;
    var st = new global.DecompressionStream('gzip');
    return await new Response(new Blob([buf]).stream().pipeThrough(st)).arrayBuffer();
  }

  /* 取音源字节。按来源分派：
       · local   → 从 Cache API 读用户自选的本地 .sf2（裸 SF2，不解压）
       · bundled / url → 先查我们自己的 Cache API，再下载（可 gz + 解压） */
  async function fetchSoundFont() {
    if (sfSource.kind === 'local') {
      var cl = await caches.open(SF_LOCAL);
      var hit = await cl.match(SF_LOCAL_KEY);
      if (!hit) throw new Error('本地音色文件已失效，请重新选择');
      return await hit.arrayBuffer();
    }

    var gzUrl = sfSource.kind === 'url' ? sfSource.url : SF_URL_GZ;
    var rawUrl = sfSource.kind === 'url' ? (sfSource.raw || sfSource.url) : SF_URL_RAW;
    var wantGz = sfSource.kind === 'url' ? !!sfSource.gz : true;

    var cached = null;
    try {
      var c = await caches.open(SF_CACHE);
      cached = await c.match(gzUrl) || await c.match(rawUrl);
    } catch (e) { /* 无 Cache API（隐私模式）→ 走网络 */ }
    if (cached) {
      sfStage = 'decode';
      badge('音源解压…');
      var un = await gunzip(await cached.arrayBuffer());
      if (un) return un;
    }

    sfStage = 'download';
    if (!wantGz) {
      /* 未压缩的在线音色（音色站托管的 .sf2 就是这种）：
         ⚠️ 以前这里**不写缓存** —— 每次重建引擎/刷新页面都要重下几 MB～几十 MB。
         现在与 gz 路径一样：流式读 + 显示进度 + 写进 Cache API（下次秒开）。 */
      var res0 = await fetch(rawUrl, { cache: 'no-store' });
      if (!res0.ok) throw new Error('音源 HTTP ' + res0.status);
      var ab0 = await readWithProgress(res0);
      try {
        var c0 = await caches.open(SF_CACHE);
        await c0.put(rawUrl, new Response(ab0.slice(0),
          { headers: { 'Content-Type': 'application/octet-stream' } }));
      } catch (e) { /* 缓存失败不影响播放 */ }
      return ab0;
    }

    var res = await fetch(gzUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error('音源 HTTP ' + res.status);
    var buf = await readWithProgress(res);
    try {
      var c2 = await caches.open(SF_CACHE);
      await c2.put(gzUrl, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/gzip' } }));
    } catch (e) { /* 缓存失败不影响播放 */ }

    sfStage = 'decode';
    badge('音源解压…');
    var out = await gunzip(buf);
    if (out) return out;
    var rr = await fetch(rawUrl, { cache: 'force-cache' });
    if (!rr.ok) throw new Error('音源 HTTP ' + rr.status);
    return await rr.arrayBuffer();
  }

  /* 流式读取 + 百分比进度（拿不到 Content-Length 时退化为整块读） */
  async function readWithProgress(res) {
    var total = Number(res.headers.get('Content-Length')) || 0;
    if (!(res.body && res.body.getReader && total)) {
      badge('音源下载中…');
      return await res.arrayBuffer();
    }
    var reader = res.body.getReader(), chunks = [], got = 0, last = 0;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      chunks.push(r.value); got += r.value.length;
      var pct = Math.floor(got / total * 100);
      if (pct >= last + 5) { last = pct; badge('音源 ' + pct + '%'); }
    }
    var buf = new Uint8Array(got), off = 0;
    for (var k = 0; k < chunks.length; k++) { buf.set(chunks[k], off); off += chunks[k].length; }
    return buf.buffer;
  }

  /* 后台加载采样音源。
     · **失败不永久锁定**：允许重试（最多 3 次，每次由新的播放动作触发）
     · 每步记录 sfStage —— 失败时把**阶段 + 原因**显示出来，便于定位
       （否则只能看到「合成音源」，无法判断卡在哪一步） */
  async function ensureSoundFont() {
    if (sfReady || sfLoading) return;
    if (sfTries >= 3) return;                    /* 连续失败 3 次后不再打扰 */
    if (!global.Tone || !global.JSSynth) {
      sfError = global.Tone ? 'JSSynth 未加载' : 'Tone.js 未加载';
      sfTries++; reportFail(); return;
    }
    sfLoading = true;
    sfTries++;
    badge('音源加载中…');
    try {
      /* ⚠️ 必须用**原生** AudioContext。
         Tone.js v14 的 `Tone.getContext().rawContext` 返回的是**包装对象**（非原生）：
         它的 `audioWorklet.addModule()` 能转发成功，但
         `new AudioWorkletNode(它, ...)` 会因品牌校验失败抛
         `TypeError: parameter 1 is not of type 'BaseAudioContext'`。
         FluidSynth 本就不需要 Tone，自建原生上下文最稳，也天然满足「直连输出」。 */
      var Ctor = global.AudioContext || global.webkitAudioContext;
      if (!Ctor) throw new Error('浏览器不支持 AudioContext');
      if (!sfAC || sfAC.state === 'closed') sfAC = new Ctor();
      var AC = sfAC;
      if (!AC.audioWorklet) throw new Error('AudioWorklet 不可用');
      if (AC.state === 'suspended') safe(function () { AC.resume(); });

      /* ① 两个 worklet 模块 —— 只加载主线程脚本是不够的 */
      sfStage = 'module:fluidsynth';
      await AC.audioWorklet.addModule(ENG + 'libfluidsynth-2.3.0.js');
      sfStage = 'module:worklet';
      await AC.audioWorklet.addModule(ENG + 'js-synthesizer.worklet.min.js');

      /* ② createAudioNode 才是真正的初始化（本版 init 是空函数） */
      sfStage = 'createNode';
      sf = new JSSynth.AudioWorkletNodeSynthesizer();
      sf.init(AC.sampleRate);
      sfNode = sf.createAudioNode(AC);
      sfNode.connect(AC.destination);            /* 直连输出：不经低通/混响，保真优先 */

      /* ③ 音源 */
      sfStage = 'sfont';
      var sfBuf = await fetchSoundFont();
      sfStage = 'loadSFont';
      await sf.loadSFont(sfBuf);

      safe(function () { sf.setInterpolation(4); });   /* 最高插值质量 */
      applyVolume();

      sfReady = true; sfFailed = false; sfError = ''; sfStage = '';
      sfEngine = 'soundfont';
      badge('采样音源');
    } catch (e) {
      sfFailed = true;
      sf = null; sfNode = null;
      sfError = (e && e.message) || String(e);
      reportFail();
    }
    sfLoading = false;
  }

  /* 失败时把原因短暂显示在角标上（用户不必开 DevTools 也能反馈），随后回到「合成音源」 */
  function reportFail() {
    var msg = '音源失败：' + (sfStage ? sfStage + ' · ' : '') + sfError;
    badge(msg.slice(0, 120));
    if (global.console && console.warn) console.warn('[player] ' + msg);
    setTimeout(function () { if (!sfReady) badge('合成音源'); }, 9000);
  }

  /* 用采样音源播放：把原始 MIDI 交给 FluidSynth —— 乐器/鼓组/速度都由文件决定。
     ⚠️ 必须先 resetPlayer()：底层 `fluid_player_add_mem` 是**往播放列表追加**，
        若不清空，换曲只会往同一个播放器里再加一首，playPlayer() 仍从列表第一首播
        （表现为「点了别的作品，页面标题变了但音乐不变」）。
        resetPlayer() 会关闭并重建 player，等价于清空播放列表。 */
  async function playWithSoundFont(track, buf) {
    await sf.resetPlayer();
    await sf.addSMFDataToPlayer(buf);
    sfPausedTick = null;
    await sf.playPlayer();
    /* 总 tick 必须在**开始播放后**读：FluidSynth 在 play 时才算出 total_ticks，
       播放前读会得到 0（会导致进度条不动）。读不到也没关系 —— tick() 里会惰性补读。 */
    sfCurTotalTick = num(await sf.retrievePlayerTotalTicks()) || 0;
    playing = true;
    sfEngine = 'soundfont';
    if (hooks.onState) safe(function () { hooks.onState(true); });
    if (hooks.onTime) safe(function () { hooks.onTime(0, curTotal); });
    badge('采样音源');
  }

  /* ═══════════════════════════════════════════════════════════════════
     路径 ② 合成器（Tone.js）
     ═══════════════════════════════════════════════════════════════════ */
  function initAudio() {
    if (ready) return true;
    if (!global.Tone) { lastError = 'Tone.js 未加载'; return false; }
    try {
      var verb = new Tone.Reverb({ decay: 3.0, preDelay: .015, wet: .26 }).connect(Tone.Destination);
      var filt = new Tone.Filter({ type: 'lowpass', frequency: 5200, rolloff: -12 }).connect(verb);
      var comp = new Tone.Compressor({ threshold: -20, ratio: 2.6, attack: .01, release: .25 }).connect(filt);
      syn = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'amtriangle', harmonicity: 2.02, modulationType: 'sine' },
        envelope: { attack: .004, decay: 1.35, sustain: .1, release: 2.0 }, volume: -9
      }).connect(comp);
      bass = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: .012, decay: 1.1, sustain: .16, release: 1.6 }, volume: -11
      }).connect(comp);
      perc = new Tone.PolySynth(Tone.MembraneSynth || Tone.Synth, { volume: -6 }).connect(comp);
      graph = 'full';
    } catch (e) {
      safe(function () { syn && syn.dispose(); });
      try {
        syn = new Tone.PolySynth(Tone.Synth, { volume: -8 }).toDestination();
        bass = syn; perc = syn; graph = 'minimal';
        lastError = '效果链不可用（已降级）：' + ((e && e.message) || e);
      } catch (e2) {
        lastError = '合成器初始化失败：' + ((e2 && e2.message) || e2);
        return false;
      }
    }
    applyVolume();
    ready = true;
    if (graph === 'minimal') badge('简易音源');
    return true;
  }

  function applyVolume() {
    if (global.Tone) safe(function () { Tone.getDestination().volume.value = (vol / 100) * 12 - 12; });
    if (sfReady && sf) safe(function () { sf.setGain((vol / 100) * 1.15); });
  }

  /* ═══════════════════════════════════════════════════════════════════
     公共控制
     ═══════════════════════════════════════════════════════════════════ */
  function stop() {
    if (uiTimer) { clearInterval(uiTimer); uiTimer = null; }
    if (part) safe(function () { part.stop(); part.dispose(); }), part = null;
    safe(function () { if (global.Tone) { Tone.Transport.stop(); Tone.Transport.cancel(); } });
    if (ready && syn) safe(function () { syn.releaseAll(); bass.releaseAll(); perc.releaseAll(); });
    if (sf && sfReady) safe(function () { sf.stopPlayer(); });
    sfPausedTick = null;
    playing = false;
    if (hooks.onState) safe(function () { hooks.onState(false); });
  }

  /* 进度：采样音源用 ticks 比例换算到秒；合成器用 Transport.seconds */
  function tick() {
    if (uiTimer) clearInterval(uiTimer);
    uiTimer = setInterval(function () {
      if (!playing) return;
      if (sfEngine === 'soundfont' && sf && sfReady) {
        /* 惰性补读总 tick（首次播放后才会有效） */
        if (!sfCurTotalTick) {
          safe(function () {
            var t = sf.retrievePlayerTotalTicks();
            if (t && t.then) t.then(function (v) { sfCurTotalTick = num(v) || sfCurTotalTick; })['catch'](function () {});
          });
        }
        /* ⚠️ retrievePlayerCurrentTick() 返回的是 **Promise**，
           不能先 num() 再判 —— num(Promise) 恒为 null，会导致进度永远不动。 */
        var cur = safe(function () { return sf.retrievePlayerCurrentTick(); });
        if (cur && cur.then) cur.then(function (v) {
          var c = num(v) || 0;
          sfLastTick = c;
          var pos = sfCurTotalTick ? (c / sfCurTotalTick) * curTotal : 0;
          if (hooks.onTime) safe(function () { hooks.onTime(pos, curTotal); });
          if (sfCurTotalTick && c >= sfCurTotalTick - 2) onEnded();
        })['catch'](function () {});
        return;
      }
      if (!ready) return;
      var p = safe(function () { return Tone.Transport.seconds; }) || 0;
      if (hooks.onTime) safe(function () { hooks.onTime(p, curTotal); });
      if (p >= curTotal) onEnded();
    }, 250);
  }

  function onEnded() {
    if (looping && curTrack) { play(curTrack, curIdx); return; }
    stop();
    if (hooks.onEnd) safe(function () { hooks.onEnd(); });
  }

  async function play(track, idx, list) {
    try {
      return await _play(track, idx, list);
    } catch (e) {
      playing = false;
      if (hooks.onState) safe(function () { hooks.onState(false); });
      status('播放失败：' + ((e && e.message) || e));
    }
  }

  async function _play(track, idx, list) {
    stop();
    curTrack = track;
    if (typeof idx === 'number') curIdx = idx;
    if (Array.isArray(list)) queue = list;
    if (!track || typeof track.f !== 'string' || !track.f) { status('该条目缺少文件路径'); return; }

    if (!initAudio()) { status('Tone.js 未加载'); return; }
    safe(function () { Tone.start(); });
    if (global.Tone && Tone.start && Tone.start().catch) safe(function () { Tone.start()['catch'](function () {}); });
    /* 手势内恢复 FluidSynth 的独立上下文（自动播放策略要求） */
    if (sfAC && sfAC.state === 'suspended') safe(function () { sfAC.resume(); });

    /* 音源预热：放在取音频**之前**，与网络请求并行。
       也让「音频抓取失败」不至于连带放弃音源加载。 */
    if (!sfReady && !sfFailed) ensureSoundFont();

    try {
      status((track.t || track.id) + ' · 读取中');
      var res = await fetch(track.f, { cache: 'force-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var buf = await res.arrayBuffer();

      /* ── 主路径：采样音源（就绪时）────────────────────────────── */
      if (sfReady && sf) {
        try {
          /* 时长仍用 Midi.js 算（进度用 ticks 比例换算，不必做 tempo 数学） */
          curTotal = durationOf(buf, track) || 1;
          await playWithSoundFont(track, buf);
          status((track.t || track.id) + ' · ' + fmt(curTotal));
          tick();
          return;
        } catch (e) {
          /* 采样音源这一首失败 → 落到合成器，不影响可播性 */
          lastError = '采样音源播放失败（回退合成器）：' + ((e && e.message) || e);
          safe(function () { sf.stopPlayer(); });
        }
      }

      /* ── 兜底路径：合成器 ─────────────────────────────────────── */
      if (!global.Midi) { status('Midi.js 未加载'); return; }
      var midi = new Midi(buf);
      var notes = [];
      midi.tracks.forEach(function (tr) {
        tr.notes.forEach(function (n) {
          notes.push({ time: n.time, name: n.name, dur: Math.max(n.duration, .05),
                       vel: n.velocity, pitch: n.midi });
        });
      });
      if (!notes.length) { status('该文件无可播放音符'); return; }

      var isPerc = (track.g === 'drum') || /drum|perc/i.test(track.i || '');
      Tone.Transport.stop(); Tone.Transport.cancel(); Tone.Transport.position = 0;
      part = new Tone.Part(function (time, n) {
        var v = Math.min(1, Math.max(.15, n.vel || .7));
        if (isPerc) perc.triggerAttackRelease(n.pitch < 50 ? 'C1' : 'G2', .12, time, v * .9);
        else if (n.pitch < 48) bass.triggerAttackRelease(n.name, n.dur, time, v * .85);
        else syn.triggerAttackRelease(n.name, n.dur, time, v);
      }, notes);
      part.start(0);
      curTotal = Math.round(midi.duration) || 1;
      part.stop(curTotal + 1.5);
      Tone.Transport.start('+0.08');
      playing = true;
      sfEngine = 'tone';
      if (hooks.onState) safe(function () { hooks.onState(true); });
      if (hooks.onTime) safe(function () { hooks.onTime(0, curTotal); });
      badge(sfLoading ? '合成音源（音源加载中…）' : '合成音源');
      status((track.t || track.id) + ' · ' + fmt(curTotal));
      tick();

    } catch (e) {
      playing = false;
      if (hooks.onState) safe(function () { hooks.onState(false); });
      status('播放失败：' + ((e && e.message) || e));
    }
  }

  /* 只取时长（FluxSynth 路径的进度换算需要），失败返回 0 */
  function durationOf(buf, track) {
    if (!global.Midi) return 0;
    try {
      var m = new Midi(buf);
      return Math.round(m.duration) || 0;
    } catch (e) { return 0; }
  }

  function toggle() {
    if (!playing) {
      /* 恢复：采样音源需要 seek 回暂停点再播（FluidSynth player 无原生暂停） */
      if (sfEngine === 'soundfont' && sf && sfReady) {
        if (sfPausedTick) safe(function () { sf.seekPlayer(sfPausedTick); });
        var p = safe(function () { return sf.playPlayer(); });
        if (p && p.then) p.then(function () { playing = true; tick(); })['catch'](function () {});
        else { playing = true; tick(); }
        if (hooks.onState) safe(function () { hooks.onState(true); });
        return;
      }
      if (!global.Tone) return;
      safe(function () { Tone.Transport.start(); });
      playing = true;
      if (hooks.onState) safe(function () { hooks.onState(true); });
      return;
    }
    /* 暂停 */
    if (sfEngine === 'soundfont' && sf && sfReady) {
      safe(function () {
        var c = sf.retrievePlayerCurrentTick();
        if (c && c.then) c.then(function (v) { sfPausedTick = num(v) || 0; })['catch'](function () {});
      });
      safe(function () { sf.stopPlayer(); });
    } else if (global.Tone) {
      safe(function () { Tone.Transport.pause(); });
    }
    playing = false;
    if (hooks.onState) safe(function () { hooks.onState(false); });
  }

  function next() { if (curIdx >= 0 && queue[curIdx + 1]) play(queue[curIdx + 1], curIdx + 1); }
  function prev() { if (curIdx > 0 && queue[curIdx - 1]) play(queue[curIdx - 1], curIdx - 1); }

  function seek(frac) {
    if (!curTotal) return;
    var f = Math.max(0, Math.min(0.999, frac));
    if (sfEngine === 'soundfont' && sf && sfReady && sfCurTotalTick) {
      safe(function () { sf.seekPlayer(Math.round(f * sfCurTotalTick)); });
      if (hooks.onTime) safe(function () { hooks.onTime(f * curTotal, curTotal); });
      return;
    }
    if (!ready) return;
    safe(function () { Tone.Transport.seconds = f * curTotal; });
  }


  /* ═══════════════════════════════════════════════════════════════════
     音色库选择器（自动挂载在 #sfbadge 之后，无需页面改 HTML）
     ═══════════════════════════════════════════════════════════════════ */
  function mountPicker() {
    var badge = $('sfbadge');
    if (!badge || !badge.parentNode || $('sfpick')) return;

    var wrap = document.createElement('span');
    wrap.id = 'sfpick';
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px';

    var sel = document.createElement('select');
    sel.id = 'sfsrc';
    sel.title = '音色库（可自选）';
    sel.style.cssText = 'background:transparent;color:inherit;border:1px solid currentColor;'
      + 'border-radius:999px;padding:1px 6px;font:inherit;font-size:12px;opacity:.85;cursor:pointer';

    var file = document.createElement('input');
    file.type = 'file';
    file.accept = '.sf2,.sf3,audio/x-soundfont';
    file.style.display = 'none';

    function render() {
      sel.innerHTML = '';
      sel.add(new Option('音色：内置 GeneralUser GS', 'bundled'));
      if (sfSource.kind === 'local') {
        var n = (sfSource.name || '本地音色');
        sel.add(new Option('音色：本地 · ' + short(n), 'local'));
      }
      if (sfSource.kind === 'url') {
        var m = (sfSource.name || '音色库音色');
        sel.add(new Option('音色：音色库 · ' + short(m), 'current-url'));
      }
      sel.add(new Option('选择本地音色文件…', 'pick'));
      sel.add(new Option('从音色库获取音色 →', 'gallery'));
      sel.value = sfSource.kind === 'local' ? 'local'
                : (sfSource.kind === 'url' ? 'current-url' : 'bundled');
    }
    function short(s) { return s.length > 22 ? s.slice(0, 20) + '…' : s; }

    sel.addEventListener('change', async function () {
      var v = sel.value;
      if (v === 'pick') { file.click(); render(); return; }
      if (v === 'gallery') { global.open(SF_GALLERY, '_blank'); render(); return; }
      if (v === 'current-url') { render(); return; }          /* 已在使用中 */
      try {
        await global.Player.setSoundFont({ kind: v });
        status('已切换到' + (v === 'local' ? '本地音色' : '内置音色') + '，下次播放生效');
      } catch (e) { status('切换失败：' + ((e && e.message) || e)); }
      render();
    });

    file.addEventListener('change', async function () {
      var f = file.files && file.files[0];
      if (!f) return;
      status('正在载入本地音色：' + f.name + ' …');
      try {
        await global.Player.setSoundFont({ kind: 'file', file: f });
        status('已使用本地音色「' + f.name + '」（' + (f.size / 1048576).toFixed(1) + ' MB），下次播放生效');
      } catch (e) {
        status('载入失败：' + ((e && e.message) || e));
      }
      file.value = '';
      render();
    });

    wrap.appendChild(sel);
    wrap.appendChild(file);
    badge.parentNode.insertBefore(wrap, badge.nextSibling);
    render();
    global.Player._renderPicker = render;
  }

  /* ═══════════════════════════════════════════════════════════════════
     音色站深链（?sf=<uid> / ?sfurl=<url>）—— 「选音色即播」那条路
     ───────────────────────────────────────────────────────────────────
     音色站（sf.midicn.com）每条已托管的音色都给出
        https://lib.midicn.com/?sf=<uid>
     本函数据此从音色站台账取到该音色的**站点直链**，自动装进播放器。

     ⚠️ 为什么必须走音色站的站点源、而不能用它的 Release 地址：
        GitHub Release 资产**不带 `Access-Control-Allow-Origin`** → 浏览器 fetch 不到；
        GitHub Pages（sf.midicn.com）带 `ACAO: *`，所以托管的 .sf2 由站点源提供。
     ═══════════════════════════════════════════════════════════════════ */
  var SF_GALLERY = 'https://sf.midicn.com/';
  var SF_CATALOG = 'https://sf.midicn.com/data/hosted.json';
  var pendingLink = null;

  function readDeepLink() {
    var q = safe(function () { return new global.URLSearchParams(global.location.search); });
    if (!q) return;
    var uid = q.get('sf');
    var u = q.get('sfurl');
    if (uid) pendingLink = { uid: uid };
    else if (u) pendingLink = { url: u };
  }

  /* 拉音色站台账，取某个 uid 的托管信息 */
  async function fetchCatalogEntry(uid) {
    var res = await fetch(SF_CATALOG, { cache: 'no-store' });
    if (!res.ok) throw new Error('音色台账 HTTP ' + res.status);
    var doc = await res.json();
    var it = (doc && doc.files && doc.files[uid]) || null;
    if (!it) throw new Error('音色库里没有「' + uid + '」这一条（可能未托管）');
    return it;
  }

  async function runDeepLink() {
    var req = pendingLink;
    if (!req) return null;
    pendingLink = null;                                  /* 只处理一次 */
    try {
      if (req.uid) {
        status('正在从音色库取音色…');
        var it = await fetchCatalogEntry(req.uid);
        var nm = it.name + (it.author ? '（' + it.author + '）' : '');
        await global.Player.setSoundFont({
          kind: 'url', url: it.url, raw: it.url, gz: false,
          name: nm, bytes: it.bytes, license: it.license, fromSf: true, uid: req.uid
        });
        status('音色已装好：' + nm + ' · ' + (it.bytes / 1048576).toFixed(1) + ' MB · ' +
               (it.license || '') + ' —— 点任意曲目即可试听');
      } else if (req.url) {
        if (!/^https:\/\//i.test(req.url)) throw new Error('只接受 https 音色地址');
        if (!/\.sf2(\?|$)/i.test(req.url)) throw new Error('只接受 .sf2 地址（浏览器只吃 .sf2）');
        status('正在载入外部音色…');
        await global.Player.setSoundFont({ kind: 'url', url: req.url, raw: req.url, gz: false,
                                           name: req.url.split('/').pop() });
        status('已使用外部音色：' + req.url.split('/').pop() + ' —— 点任意曲目即可试听');
      }
    } catch (e) {
      status('音色加载失败：' + ((e && e.message) || e));
    }
    if (global.Player && global.Player._renderPicker) safe(global.Player._renderPicker);
    return sfSource;
  }

  readDeepLink();

  loadSfChoice();

  global.Player = {
    init: function (opts) {
      hooks = opts || {};
      /* 深链要等 hooks（状态栏）就绪后再跑，否则提示无处可显 */
      safe(function () { runDeepLink(); });
    },
    play: play, toggle: toggle, stop: stop, next: next, prev: prev, seek: seek,
    setVolume: function (v) { vol = v; applyVolume(); },
    setLoop: function (on) { looping = !!on; },
    isPlaying: function () { return playing; },
    /* ── 音色库选择（供页面 UI 调用）────────────────────────────────
       可选值：
         Player.setSoundFont({kind:'bundled'})          内置（默认）
         Player.setSoundFont({kind:'url', url, gz})     其它在线音色
         Player.setSoundFont({kind:'file', file: File}) 用户本地 .sf2（存本机，不上传）
       返回 Promise；失败时 reject 带原因。切换后会重建引擎，**下次播放生效**。 */
    setSoundFont: async function (src) {
      if (!src || !src.kind) throw new Error('缺少音色来源描述');
      if (src.kind === 'file') {
        var f = src.file;
        if (!f) throw new Error('未选择文件');
        var ab = await f.arrayBuffer();
        var h = new Uint8Array(ab, 0, Math.min(12, ab.byteLength));
        if (h[0] !== 0x52 || h[1] !== 0x49 || h[2] !== 0x46 || h[3] !== 0x46 ||          /* RIFF */
            h[8] !== 0x73 || h[9] !== 0x66 || h[10] !== 0x62 || h[11] !== 0x6b) {         /* sfbk */
          throw new Error('不是合法 SoundFont（需要 .sf2 / RIFF+sfbk 头）');
        }
        var c = await caches.open(SF_LOCAL);
        await c.put(SF_LOCAL_KEY, new Response(ab));
        sfSource = { kind: 'local', name: f.name, size: ab.byteLength };
      } else if (src.kind === 'url' || src.kind === 'bundled') {
        sfSource = src.kind === 'bundled' ? { kind: 'bundled' }
                                          : { kind: 'url', url: src.url, raw: src.raw, gz: !!src.gz,
                                              name: src.name, bytes: src.bytes,
                                              license: src.license, fromSf: !!src.fromSf,
                                              uid: src.uid };
      } else {
        throw new Error('未知的音色来源类型：' + src.kind);
      }
      saveSfChoice();
      resetEngine();
      return sfSource;
    },
    /* 当前音色来源（含本地文件的名字/体积） */
    soundFont: function () { return sfSource; },
    /* ── 音色站直连（页面 UI 与深链都可调）────────────────────────
        Player.loadCatalogSoundFont('<uid>')  从 sf.midicn.com 台账取音色并装上
        Player.catalogURL()                   音色站地址（用于「获取更多音色」入口）
        Player.deepLink()                     当前 URL 是否带 ?sf= / ?sfurl=（返回描述或 null） */
    loadCatalogSoundFont: async function (uid) {
      var it = await fetchCatalogEntry(uid);
      var nm = it.name + (it.author ? '（' + it.author + '）' : '');
      await global.Player.setSoundFont({
        kind: 'url', url: it.url, raw: it.url, gz: false,
        name: nm, bytes: it.bytes, license: it.license, fromSf: true, uid: uid
      });
      if (global.Player._renderPicker) safe(global.Player._renderPicker);
      return it;
    },
    catalogURL: function () { return SF_GALLERY; },
    deepLink: function () { return pendingLink; },
    /* 清除用户自选的本地音色（释放 Cache API 空间） */
    /* 重新渲染选择器（切换来源后由内部调用；页面一般无需自己调） */
    _renderPicker: null,
    clearLocalSoundFont: async function () {
      try { var c = await caches.open(SF_LOCAL); await c.delete(SF_LOCAL_KEY); } catch (e) {}
      if (sfSource.kind === 'local') { sfSource = SF_SRC_DEF; saveSfChoice(); resetEngine(); }
      if (global.Player._renderPicker) safe(global.Player._renderPicker);
    },

    /* 诊断用：当前音源类型、就绪状态与**失败原因**
       —— 在控制台执行 `Player.engine()` 即可看到卡在哪一步 */
    engine: function () {
      return { kind: sfEngine, soundfontReady: sfReady, soundfontFailed: sfFailed,
               stage: sfStage, error: sfError, tries: sfTries,
               /* 音频侧诊断：播放器当前曲目的总 tick 数与已播 tick。
                  换曲后若 totalTick 不变，说明播放列表没被重置（换曲不生效）。 */
               totalTick: sfCurTotalTick, curTick: sfLastTick, playing: playing,
               acState: sfAC ? sfAC.state : null,
               acNative: !!(sfAC && sfAC instanceof (global.AudioContext || global.webkitAudioContext)) };
    },
    fmt: fmt
  };
  /* 页面就绪后自动挂载选择器 */
  safe(function () {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { safe(mountPicker); });
    } else { safe(mountPicker); }
  });
})(window);
