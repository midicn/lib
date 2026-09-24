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
  var SF_URL_RAW = 'soundfont/GeneralUser-GS.sf2';     /* 32.3 MB（兜底） */
  var sf = null, sfNode = null, sfReady = false, sfLoading = false, sfFailed = false;
  var sfCurTotalTick = 0, sfPausedTick = null, sfEngine = 'none';

  function $(id) { return document.getElementById(id); }
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

  /* 取音源字节：优先 gzip（省 3 MB）→ 用平台原生 DecompressionStream 解压；
     不支持或失败则退回未压缩 .sf2。两者都由 SW 做 cache-first（只下一次）。 */
  async function fetchSoundFont() {
    if (global.DecompressionStream) {
      try {
        var rg = await fetch(SF_URL_GZ, { cache: 'force-cache' });
        if (rg.ok && rg.body) {
          var stream = rg.body.pipeThrough(new global.DecompressionStream('gzip'));
          return await new Response(stream).arrayBuffer();
        }
      } catch (e) { /* 落到未压缩 */ }
    }
    var rr = await fetch(SF_URL_RAW, { cache: 'force-cache' });
    if (!rr.ok) throw new Error('HTTP ' + rr.status);
    return await rr.arrayBuffer();
  }

  /* 后台加载采样音源（幂等；失败后不再重试，静默留在合成器路径） */
  async function ensureSoundFont() {
    if (sfReady || sfLoading || sfFailed) return;
    if (!global.Tone || !global.JSSynth) { sfFailed = true; return; }
    sfLoading = true;
    badge('音源加载中…');
    try {
      var AC = Tone.getContext().rawContext;
      if (!AC || !AC.audioWorklet) throw new Error('AudioWorklet 不可用');

      /* ① 两个 worklet 模块 —— 只加载主线程脚本是不够的 */
      await AC.audioWorklet.addModule(ENG + 'libfluidsynth-2.3.0.js');
      await AC.audioWorklet.addModule(ENG + 'js-synthesizer.worklet.min.js');

      /* ② init 收 sampleRate 数字；随后必须先 createAudioNode 才能用其它方法 */
      sf = new JSSynth.AudioWorkletNodeSynthesizer();
      sf.init(AC.sampleRate);
      sfNode = sf.createAudioNode(AC);
      sfNode.connect(AC.destination);          /* 直连输出：不经低通/混响，保真优先 */

      /* ③ 音源 + 质量设置 */
      var sfBuf = await fetchSoundFont();
      await sf.loadSFont(sfBuf);
      safe(function () { sf.setInterpolation(4); });   /* 最高插值质量 */
      applyVolume();

      sfReady = true;
      sfEngine = 'soundfont';
      badge('采样音源');
    } catch (e) {
      sfFailed = true;
      sf = null; sfNode = null;
      badge('合成音源');
      lastError = '音源加载失败（已留在合成器路径）：' + ((e && e.message) || e);
    }
    sfLoading = false;
  }

  /* 用采样音源播放：把原始 MIDI 交给 FluidSynth —— 乐器/鼓组/速度都由文件决定 */
  async function playWithSoundFont(track, buf) {
    await sf.addSMFDataToPlayer(buf);
    sfCurTotalTick = num(await sf.retrievePlayerTotalTicks()) || 0;
    sfPausedTick = null;
    sf.seekPlayer(0);
    await sf.playPlayer();
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
        var cur = safe(function () { return num(sf.retrievePlayerCurrentTick()); });
        if (cur && cur.promise) cur.then(function (v) {
          var c = num(v) || 0;
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

      /* 首次播放即**后台**开始取音源：不打断当前播放，下次播放自动升级 */
      if (!sfReady && !sfFailed) ensureSoundFont();
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

  global.Player = {
    init: function (opts) { hooks = opts || {}; },
    play: play, toggle: toggle, stop: stop, next: next, prev: prev, seek: seek,
    setVolume: function (v) { vol = v; applyVolume(); },
    setLoop: function (on) { looping = !!on; },
    isPlaying: function () { return playing; },
    /* 诊断用：当前音源类型（'soundfont' | 'tone'）与就绪状态 */
    engine: function () {
      return { kind: sfEngine, soundfontReady: sfReady, soundfontFailed: sfFailed };
    },
    fmt: fmt
  };
})(window);
