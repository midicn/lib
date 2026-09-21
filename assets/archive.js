/* ═══════════════════════════════════════════════════════════════════════
   midicn-lib · archive.js
   全站共享层：来源档案（说明 / 原始链接 / 许可 / 上游整理方式 / 致谢）
              + 许可档位定义 + 数据驱动的声波签名生成器
   ═══════════════════════════════════════════════════════════════════════ */

/* ── 许可档位（三区体系）───────────────────────────────────────────── */
const ZONES = {
  main:  { id:'main',  code:'C1', cls:'c1', zh:'可商用',   en:'Commercial OK',
           zhDesc:'许可允许商业使用；使用时须按各来源要求署名。',
           enDesc:'Licenses permit commercial use; attribution per source required.' },
  piano: { id:'piano', code:'C2', cls:'c2', zh:'非商用',   en:'Non-commercial',
           zhDesc:'仅限非商业用途（学习、研究、个人创作）；商用需另行获得授权。',
           enDesc:'Non-commercial use only; commercial use requires separate permission.' },
  study: { id:'study', code:'C3', cls:'c3', zh:'学习研究', en:'Study / Research',
           zhDesc:'仅供学习与研究；不得再分发、不得商用。',
           enDesc:'Study and research only; no redistribution, no commercial use.' },
};

/* ── 来源档案（19 个已发布来源；按发布量降序）─────────────────────────
   url    原始来源地址（用户可直接访问）
   method 我们如何上游整理与加工
   credit 对该来源方的致谢（许可与法律页、详情页共用）
   ─────────────────────────────────────────────────────────────────── */
const SOURCES = [
  {
    id:'aria', name:{zh:'Aria-MIDI', en:'Aria-MIDI'}, count:32522,
    zone:'piano', license:'CC BY-NC-SA 4.0',
    url:'https://github.com/lucasnata/aria-midi',
    site:'https://www.aria-midi.org/',
    kind:{zh:'古典钢琴演奏转录', en:'Classical piano performance transcriptions'},
    what:{zh:'由资深钢琴家演奏录音自动转录而成的 MIDI，覆盖文艺复兴至当代的古典钢琴文献，含作曲家、作品编号、时期、难度等结构化元数据。',
          en:'MIDI automatically transcribed from virtuoso piano recordings, spanning Renaissance to contemporary literature, with structured metadata.'},
    method:{zh:'上游公开发布 metadata.json 与 MIDI 集；作品名称依 IMSLP 公开作品目录补全（按各作曲家编号体系严格匹配）。',
            en:'The upstream publishes metadata.json and the MIDI set; work titles completed from the public IMSLP catalogue.'},
    credit:{zh:'转录与数据集由 Aria-MIDI 团队制作并开放；演奏录音版权归各演奏者所有。',
            en:'Transcription dataset by the Aria-MIDI team; performance rights remain with the performers.'},
  },
  {
    id:'thesession', name:{zh:'The Session', en:'The Session'}, count:23250,
    zone:'main', license:'CC BY-SA 4.0',
    url:'https://thesession.org/', site:'https://thesession.org/tunes',
    kind:{zh:'爱尔兰传统曲调', en:'Irish traditional tunes'},
    what:{zh:'全球最大的爱尔兰传统音乐曲调档案，由社区贡献，每首曲调附调式、拍号、曲式（reel/jig/hornpipe 等）与多条变体。',
          en:"The world's largest community archive of Irish traditional tunes, with key, meter, form and multiple settings per tune."},
    method:{zh:'上游公开 API 提供曲调元数据与 ABC 记谱；本库仅做格式转换为 MIDI。',
            en:'The upstream public API provides metadata and ABC notation; this library only converts the format to MIDI.'},
    credit:{zh:'数据由 The Session 社区数千名贡献者维护，依 CC BY-SA 4.0 共享。',
            en:'Maintained by thousands of The Session contributors under CC BY-SA 4.0.'},
  },
  {
    id:'cyberhymnal', name:{zh:'Cyber Hymnal', en:'Cyber Hymnal'}, count:10945,
    zone:'main', license:'Public Domain',
    url:'https://www.hymntime.com/tch/', site:'https://www.hymntime.com/tch/',
    kind:{zh:'赞美诗（公有领域）', en:'Public-domain hymns'},
    what:{zh:'英语世界最完整的公有领域赞美诗集之一，收录 19 世纪前后数千首圣诗与曲调，附曲调名、作者与年份。',
          en:'One of the most complete public-domain hymn collections, with tune names, authors and years.'},
    method:{zh:'上游公开发布 MIDI 与曲目页元数据；年代由 MIDI 内嵌信息与曲调页交叉校验。',
            en:'The upstream publishes MIDI and tune-page metadata; years cross-checked against embedded MIDI info.'},
    credit:{zh:'由 Cyber Hymnal 项目整理，曲调本身多已进入公有领域。',
            en:'Compiled by the Cyber Hymnal project; most tunes are in the public domain.'},
  },
  {
    id:'chinafolk', name:{zh:'中国民间歌曲集成', en:'Anthology of Chinese Folk Songs'}, count:10473,
    zone:'study', license:'传统音乐 · 学习研究',
    url:'https://www.ihchina.cn/', site:'https://www.ihchina.cn/',
    kind:{zh:'中国民歌', en:'Chinese folk songs'},
    what:{zh:'《中国民间歌曲集成》各省卷所收民歌的数字化成果，涵盖号子、山歌、小调、儿歌等体裁，标注省份与采录地。',
          en:'Digitised folk songs from the provincial volumes of the Anthology, covering work songs, mountain songs, xiaodiao and children\u2019s songs with province and collection locality.'},
    method:{zh:'依 ESAC 数据集中的中国卷 ABC 记谱做格式转换；region 沿用上游标注的采录地。',
            en:'Format-converted from the China volumes of the ESAC ABC corpus; region kept as annotated upstream.'},
    credit:{zh:'民歌为中国各民族传统音乐，整理权属原集成编委会；本库仅作学习研究用途，商用请循原集成出版方授权。',
            en:'Traditional music of China; digitisation rights belong to the original anthology editors. Study/research use only.'},
  },
  {
    id:'essen', name:{zh:'ESAC 欧洲民歌档案', en:'ESAC Folk Song Archive'}, count:10373,
    zone:'main', license:'Public Domain / Open', count_note:'含少量受限条目',
    url:'http://www.esac-data.org/', site:'http://www.esac-data.org/',
    kind:{zh:'欧洲民歌（德语区为主）', en:'European folk songs'},
    what:{zh:'基于 Essen 联想编码（Essen Associative Code）整理的大型欧洲民歌数据集，源自德国民歌档案与多国采录集，曲目自带地理层级（洲—国—地区）。',
          en:'A large European folk-song corpus in Essen Associative Code, drawn from German and international collections, with per-tune geographic hierarchy.'},
    method:{zh:'解析上游 ABC 记谱；国家由曲目自带的 O: 地理层级字段推导（中国曲目精确到省）。',
            en:'Upstream ABC records parsed; country derived from the per-tune O: geographic hierarchy.'},
    credit:{zh:'数据集由 ESAC / 德国民歌档案研究社群整理并开放。',
            en:'Curated and released by the ESAC / German folk-song archive community.'},
  },
  {
    id:'giantmidi', name:{zh:'GiantMIDI-Piano', en:'GiantMIDI-Piano'}, count:10112,
    zone:'main', license:'CC BY 4.0',
    url:'https://github.com/bytedance/GiantMIDI-Piano',
    site:'https://github.com/bytedance/GiantMIDI-Piano',
    kind:{zh:'古典钢琴演奏（大规模）', en:'Large-scale classical piano'},
    what:{zh:'由音频自动转录的大规模古典钢琴 MIDI 数据集（约 1 万首），附作曲家全名、国籍与生卒年。',
          en:'Large-scale classical piano MIDI transcribed from audio, with composer full names, nationalities and life dates.'},
    method:{zh:'上游公开发布 MIDI 与 composers_manually_checked.csv；国籍与生卒年取自该官方表。',
            en:'The upstream publishes MIDI plus composers_manually_checked.csv for nationality and dates.'},
    credit:{zh:'由字节跳动 GiantMIDI-Piano 项目发布，依 CC BY 4.0 共享。',
            en:'Released by the ByteDance GiantMIDI-Piano project under CC BY 4.0.'},
  },
  {
    id:'lakh', name:{zh:'Lakh MIDI Dataset', en:'Lakh MIDI Dataset'}, count:9640,
    zone:'main', license:'CC BY 4.0',
    url:'https://colinraffel.com/projects/lmd/', site:'https://colinraffel.com/projects/lmd/',
    kind:{zh:'多风格 MIDI 合集', en:'Multi-genre MIDI collection'},
    what:{zh:'由百万级 MIDI 语料清洗而成的数据集，涵盖古典、爵士、流行、圣诞、游戏等；作曲家线索来自目录名与文件名。',
          en:'A cleaned subset of a million-MIDI corpus across classical, jazz, pop, Christmas and game music; composer clues come from folder and file names.'},
    method:{zh:'编号（BWV/K./Op.）与作曲家线索由上游文件名解析；乐器由 MIDI program change 事件判定。',
            en:'Catalogue numbers taken from upstream file names; instruments determined from MIDI program changes.'},
    credit:{zh:'由 Colin Raffel 整理发布，依 CC BY 4.0 共享。',
            en:'Compiled by Colin Raffel and released under CC BY 4.0.'},
  },
  {
    id:'norbeck', name:{zh:'Norbeck ABC 曲集', en:'Norbeck ABC Tunes'}, count:3439,
    zone:'main', license:'Open / Free',
    url:'https://norbeck.nu/abc/', site:'https://norbeck.nu/abc/',
    kind:{zh:'爱尔兰 / 瑞典 / 世界民谣', en:'Irish, Swedish and world fiddle tunes'},
    what:{zh:'Henrik Norbeck 整理的 ABC 曲集，以爱尔兰与瑞典民谣为主，兼收北美、布列塔尼、巴尔干等地曲调，标注曲式与地域。',
          en:'Henrik Norbeck\u2019s ABC collections, mostly Irish and Swedish fiddle tunes, plus North American, Breton and Balkan material, with form and region.'},
    method:{zh:'解析上游 ABC 头字段（R: 曲式 / O: 地域）后做格式转换。',
            en:'Upstream ABC header fields (R:, O:) parsed, then format-converted.'},
    credit:{zh:'曲集由 Henrik Norbeck 无偿开放，请保留署名并访问原站。',
            en:'Made freely available by Henrik Norbeck; please keep attribution and visit the original site.'},
  },
  {
    id:'m21', name:{zh:'music21 语料库', en:'music21 Corpus'}, count:3029,
    zone:'main', license:'Mixed / Open',
    url:'https://web.mit.edu/music21/', site:'https://www.music21.org/',
    kind:{zh:'西方古典（教学语料）', en:'Western classical (teaching corpus)'},
    what:{zh:'MIT music21 工具包附带的教学与分析用乐谱语料，含巴赫众赞歌、科雷利、蒙特威尔第等。',
          en:'The teaching and analysis corpus bundled with MIT\u2019s music21 toolkit.'},
    method:{zh:'上游语料中的 MusicXML 转为 MIDI；时期参照作曲家生卒推断，标题规范化（BWV 等）。',
            en:'MusicXML from the upstream corpus converted to MIDI; periods inferred from composer dates.'},
    credit:{zh:'语料由 MIT music21 项目维护，各作品依其原始许可。',
            en:'Maintained by the MIT music21 project; individual works retain their original licences.'},
  },
  {
    id:'mutopia', name:{zh:'Mutopia Project', en:'Mutopia Project'}, count:1860,
    zone:'main', license:'Public Domain / CC（逐曲）',
    url:'https://www.mutopiaproject.org/', site:'https://www.mutopiaproject.org/',
    kind:{zh:'公有领域乐谱（LilyPond）', en:'Public-domain scores (LilyPond)'},
    what:{zh:'由志愿者排版并以 LilyPond 源码发布的公有领域与开放许可乐谱，含歌曲、钢琴、室内乐等。',
          en:'Volunteer-typeset public-domain and openly licensed scores published as LilyPond sources.'},
    method:{zh:'读取上游公开的 .ly 源文件头部（标题 / 作曲家 / 编号 / 乐器 / 年代 / 许可），据此校正元数据。',
            en:'Upstream .ly headers parsed for title, composer, opus, instrument, date and licence.'},
    credit:{zh:'由 Mutopia Project 志愿者社群排版贡献；每曲许可见其 .ly 头。',
            en:'Typeset by Mutopia Project volunteers; per-piece licence in each .ly header.'},
  },
  {
    id:'abcmisc', name:{zh:'ABC 民谣合集', en:'ABC Folk Collections'}, count:1487,
    zone:'main', license:'Open / Free',
    url:'http://trillian.mit.edu/~jc/music/abc/', site:'http://trillian.mit.edu/~jc/music/abc/',
    kind:{zh:'克莱兹梅尔 / 巴尔干 / 以色列', en:'Klezmer, Balkan, Israeli'},
    what:{zh:'John Chambers 整理并公开的多套 ABC 民谣合集：克莱兹梅尔（German Goldenshteyn 曲集）、巴尔干、国际民谣、以色列曲集。',
          en:'ABC collections compiled and shared by John Chambers: klezmer (German Goldenshteyn), Balkan, international and Israeli.'},
    method:{zh:'解析上游 ABC 头字段（T: 标题 / C: 作曲 / R: 曲式）后做格式转换。',
            en:'Upstream ABC headers (T:, C:, R:) parsed, then format-converted.'},
    credit:{zh:'合集由 John Chambers 及原采录者开放；克莱兹梅尔曲集源自 German Goldenshteyn 的传承。',
            en:'Shared by John Chambers and the original collectors; the klezmer set traces to German Goldenshteyn.'},
  },
  {
    id:'openscore', name:{zh:'OpenScore Lieder', en:'OpenScore Lieder'}, count:1438,
    zone:'main', license:'CC0 1.0',
    url:'https://github.com/OpenScore/Lieder', site:'https://openscore.cc/',
    kind:{zh:'艺术歌曲', en:'Art songs (Lieder)'},
    what:{zh:'OpenScore 计划下的艺术歌曲语料，数百位作曲家（舒伯特、勃拉姆斯、雨果·沃尔夫等）的声乐与钢琴伴奏作品。',
          en:'Art-song corpus from the OpenScore initiative, hundreds of composers, voice with piano.'},
    method:{zh:'上游 MuseScore 工程文件转为 MIDI；作曲家人名与生卒用于时期推断。',
            en:'Upstream MuseScore sources converted to MIDI; composer dates used for period inference.'},
    credit:{zh:'由 OpenScore / MuseScore 社区排版贡献，专用于公有领域（CC0）。',
            en:'Typeset by the OpenScore / MuseScore community and dedicated to the public domain (CC0).'},
  },
  {
    id:'maestro', name:{zh:'MAESTRO', en:'MAESTRO'}, count:1276,
    zone:'piano', license:'CC BY-NC-SA 4.0',
    url:'https://magenta.tensorflow.org/datasets/maestro', site:'https://magenta.tensorflow.org/datasets/maestro',
    kind:{zh:'钢琴演奏（对齐 MIDI）', en:'Piano performances (aligned MIDI)'},
    what:{zh:'Google Magenta 发布的钢琴演奏数据集，MIDI 与录音精确对齐，附作曲家、作品名与演奏者。',
          en:'Google Magenta\u2019s piano performance dataset with precisely aligned MIDI, composer, title and performer.'},
    method:{zh:'采用上游公开发布的 MIDI 与元数据（作曲家 / 作品 / 年份）。',
            en:'Uses the MIDI and metadata published by the upstream (composer, title, year).'},
    credit:{zh:'由 Google Magenta 团队发布；演奏者署名见原数据集。',
            en:'Released by Google Magenta; performer credits in the original dataset.'},
  },
  {
    id:'groove', name:{zh:'Groove MIDI Dataset', en:'Groove MIDI Dataset'}, count:1149,
    zone:'main', license:'CC BY 4.0',
    url:'https://magenta.tensorflow.org/datasets/groove', site:'https://magenta.tensorflow.org/datasets/groove',
    kind:{zh:'鼓组演奏', en:'Drum performances'},
    what:{zh:'专业鼓手演奏的鼓组 MIDI 数据集，附速度、拍号、风格与鼓手信息，是节奏研究的基准语料。',
          en:'Studio-recorded drum MIDI with tempo, meter, style and drummer metadata.'},
    method:{zh:'采用上游公开发布的 MIDI 与 info.csv（速度 / 拍号 / 风格）。',
            en:'Uses the MIDI and info.csv published by the upstream.'},
    credit:{zh:'由 Google Magenta 与专业鼓手合作录制发布。',
            en:'Recorded with professional drummers by Google Magenta.'},
  },
  {
    id:'emopia', name:{zh:'EMOPIA', en:'EMOPIA'}, count:1071,
    zone:'main', license:'CC BY 4.0',
    url:'https://github.com/EMOPIA/EMOPIA', site:'https://annahung31.github.io/EMOPIA/',
    kind:{zh:'带情绪标注的钢琴曲', en:'Emotion-annotated piano'},
    what:{zh:'带四象限情绪标注的钢琴 MIDI 数据集，用于音乐情感识别研究。',
          en:'Piano MIDI with four-quadrant emotion annotations for music emotion recognition.'},
    method:{zh:'采用上游公开发布的 MIDI 与情绪标注表。',
            en:'Uses the MIDI and annotation table published by the upstream.'},
    credit:{zh:'由 EMOPIA 研究团队发布，依 CC BY 4.0 共享。',
            en:'Released by the EMOPIA research team under CC BY 4.0.'},
  },
  {
    id:'nottingham', name:{zh:'Nottingham 数据集', en:'Nottingham Dataset'}, count:1033,
    zone:'main', license:'Open / Free',
    url:'https://github.com/jukedeck/nottingham-dataset', site:'https://github.com/jukedeck/nottingham-dataset',
    kind:{zh:'民谣曲调（ABC）', en:'Folk tunes (ABC)'},
    what:{zh:'Jukedeck 整理的民谣 ABC 曲集，用于符号音乐生成研究，含曲式与调式。',
          en:'A folk ABC collection from Jukedeck, widely used in symbolic music generation research.'},
    method:{zh:'解析上游 ABC 曲式字段（R:）后做格式转换。',
            en:'Upstream ABC form field (R:) parsed, then format-converted.'},
    credit:{zh:'由 Jukedeck 整理发布。',
            en:'Compiled and released by Jukedeck.'},
  },
  {
    id:'wikifonia', name:{zh:'Wikifonia', en:'Wikifonia'}, count:445,
    zone:'main', license:'Open / Free',
    url:'https://www.wikifonia.org/', site:'https://www.wikifonia.org/',
    kind:{zh:'爵士标准曲', en:'Jazz standards'},
    what:{zh:'已归档的爵士与流行标准曲乐谱库，含和弦进行与旋律，是爵士教学常用的开放语料。',
          en:'An archived lead-sheet library of jazz and pop standards with chords and melody.'},
    method:{zh:'上游 MusicXML 乐谱转为 MIDI。',
            en:'Upstream MusicXML sources converted to MIDI.'},
    credit:{zh:'原站已下线，语料以存档形式流传；作品版权归原作者。',
            en:'The original site is offline; the corpus circulates as an archive.'},
  },
  {
    id:'oga', name:{zh:'OpenGameArt', en:'OpenGameArt'}, count:340,
    zone:'main', license:'逐曲混合（CC0 / CC BY / GPL）',
    url:'https://opengameart.org/', site:'https://opengameart.org/',
    kind:{zh:'游戏音乐素材', en:'Game music assets'},
    what:{zh:'开源游戏美术与音频素材站的音乐投稿，许可逐曲不同（CC0 / CC BY / CC BY-SA / GPL）。',
          en:'Music submissions from the open game-asset community; licences vary per piece.'},
    method:{zh:'依上游素材页逐曲记录许可，再做格式转换。',
            en:'Per-asset licence recorded from the upstream, then format-converted.'},
    credit:{zh:'素材由 OpenGameArt 社区创作者贡献，请依各素材页许可署名。',
            en:'Contributed by OpenGameArt creators; attribute per each asset page.'},
  },
  {
    id:'musicnet', name:{zh:'MusicNet', en:'MusicNet'}, count:297,
    zone:'main', license:'CC BY 4.0',
    url:'https://zenodo.org/records/5120004', site:'https://zenodo.org/records/5120004',
    kind:{zh:'古典室内乐（对齐标注）', en:'Classical chamber (aligned labels)'},
    what:{zh:'含百万级音符级标注的古典音乐数据集，附作品名、乐章、编制与录音来源。',
          en:'A classical dataset with over a million note-level labels, including work, movement, ensemble and source.'},
    method:{zh:'采用上游公开发布的 musicnet_metadata.csv 与参考 MIDI；作品名与编号取自该表。',
            en:'Uses the musicnet_metadata.csv and reference MIDI published by the upstream.'},
    credit:{zh:'由华盛顿大学团队发布（Thickstun 等），依 CC BY 4.0 共享。',
            en:'Released by the University of Washington team (Thickstun et al.) under CC BY 4.0.'},
  },
];

/* 已考察但未发布的来源（许可不允许分发，用于来源页与许可页的透明说明）*/
const EXCLUDED = [
  { id:'musedata', name:{zh:'MuseData (CCARH)', en:'MuseData (CCARH)'}, count:924,
    license:'CCARH 受限（禁止再分发）',
    url:'https://www.ccarh.org/publications/data/', site:'https://www.ccarh.org/',
    why:{zh:'该数据集许可条款第 4、5 条明确禁止任何形式的再分发，因此我们仅保留考察记录，不纳入任何下载包。',
         en:'Its licence (clauses 4 and 5) explicitly forbids redistribution, so it is excluded from every download pack.'} },
];

/* ── 工具：许可档映射 / 声波签名 / 数字格式化 ─────────────────────── */
function zoneOf(src){ return ZONES[src] || ZONES.main; }

/** 由来源 id 与曲目数生成确定性波形高度（数据即装饰）*/
function waveHeights(seed, bars){
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const out = [];
  for (let i = 0; i < bars; i++){
    h = (h * 1103515245 + 12345) >>> 0;
    const v = ((h >>> 8) % 100) / 100;
    // 阻尼：中间高两侧低，像一段乐句
    const env = Math.sin(Math.PI * (i + 1) / (bars + 1));
    out.push(Math.round(18 + 82 * v * env));
  }
  return out;
}
function sigHTML(seed, bars){
  return '<span class="sig">' + waveHeights(seed, bars || 28)
    .map(h => '<i style="height:' + h + '%"></i>').join('') + '</span>';
}
function fmt(n){ return (n || 0).toLocaleString('en-US'); }
function licClass(lic){
  const l = String(lic || '').toLowerCase();
  if (l.includes('nc')) return 'c2';
  if (l.includes('study') || l.includes('traditional') || l.includes('ccarh')) return 'c3';
  if (l.includes('public') || l.includes('cc0') || l.includes('open') || l.includes('pd')) return 'c1';
  return 'plain';
}
