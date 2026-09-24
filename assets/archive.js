/* 全局错误上报：任何脚本异常都显示在页面状态区（不再静默失败）*/
(function(){
  function show(msg){
    ['status','np','times','ttl'].some(function(id){
      var el = document.getElementById(id);
      if (el){ el.textContent = '脚本错误：' + msg; return true; }
      return false;
    });
  }
  window.addEventListener('error', function(e){
    try{ show((e && e.message) || 'unknown'); }catch(_){}
  });
  window.addEventListener('unhandledrejection', function(e){
    try{ show(((e && e.reason && e.reason.message) || (e && e.reason) || 'promise rejected') + ''); }catch(_){}
  });
})();

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

/* ── 来源档案（21 个已发布来源；按发布量降序）─────────────────────────
   url    原始来源地址（用户可直接访问）
   method 我们如何上游整理与加工
   credit 对该来源方的致谢（许可与法律页、详情页共用）
   ─────────────────────────────────────────────────────────────────── */
const SOURCES = [
  {
    id:'aria', name:{zh:'Aria-MIDI', en:'Aria-MIDI'}, count:32522,
    zone:'piano', license:'CC BY-NC-SA 4.0',
    url:'https://github.com/loubbrad/aria-midi',
    kind:{zh:'古典钢琴演奏转录', en:'Classical piano performance transcriptions'},
    what:{zh:'由资深钢琴家演奏录音自动转录而成的 MIDI，覆盖文艺复兴至当代的古典钢琴文献，含作曲家、作品编号、时期、难度等结构化元数据。',
          en:'MIDI automatically transcribed from virtuoso piano recordings, spanning Renaissance to contemporary literature, with structured metadata.'},
    method:{zh:'上游公开发布 metadata.json 与 MIDI 集；作品名称依 IMSLP 公开作品目录补全（按各作曲家编号体系严格匹配）。',
            en:'The upstream publishes metadata.json and the MIDI set; work titles completed from the public IMSLP catalogue.'},
    credit:{zh:'转录与数据集由 Aria-MIDI 团队制作并开放；演奏录音版权归各演奏者所有。',
            en:'Transcription dataset by the Aria-MIDI team; performance rights remain with the performers.'},
  },
{
    id:'pdmx', name:{zh:'PDMX（公有领域乐谱集）', en:'PDMX'}, count:2893,
    zone:'main', license:'CC0 1.0 / Public Domain',
    url:'https://github.com/pnlong/PDMX',
    kind:{zh:'公有领域钢琴乐谱', en:'Public-domain piano scores'},
    what:{zh:'由公开乐谱（IMSLP 等公有领域来源）自动渲染得到的钢琴 MIDI，覆盖巴洛克至浪漫时期的键盘文献，附作曲家、作品编号、时期等结构化元数据；本库仅收录其中可确证为公有领域的乐谱型子集。',
          en:'Piano MIDI rendered from public-domain scores (IMSLP and similar), spanning Baroque to Romantic keyboard literature, with structured metadata; this library includes only the score-type subset verifiably in the public domain.'},
    method:{zh:'上游于 Zenodo 发布标注记录与 MIDI 包；本库按作曲家卒年与出版状态逐条筛出公有领域子集后入库（CC0 / PD 混合，均无权利限制）。',
            en:'The upstream publishes its annotation record and MIDI bundle on Zenodo; this library filters to the public-domain subset by composer death year and publication status (mixed CC0 / PD, no rights restrictions).'},
    credit:{zh:'乐谱标注与渲染由 PDMX 项目（Long et al., ICASSP 2025）制作并开放；原始乐谱版权状况依 IMSLP 各页标注。',
            en:'Score annotation and rendering by the PDMX project (Long et al., ICASSP 2025); original score copyright status follows the respective IMSLP pages.'},
  },
{
    id:'atepp', name:{zh:'ATEPP（钢琴演奏转写）', en:'ATEPP'}, count:7130,
    zone:'main', license:'CC BY 4.0',
    url:'https://github.com/tangjjbetsy/ATEPP',
    kind:{zh:'古典钢琴演奏转录', en:'Classical piano performance transcriptions'},
    what:{zh:'来自 49 位钢琴家的约 645 小时古典钢琴演奏录音，经自动转写为 MIDI；同一作品往往含多个演奏版本，可对比不同诠释下的力度、速度与触键差异，是演奏研究少见的公开语料。',
          en:'About 645 hours of classical piano performance recordings by 49 pianists, automatically transcribed to MIDI; a single work often has multiple performance versions, enabling comparison of dynamics, tempo and touch — a rare open corpus for performance research.'},
    method:{zh:'上游以 metadata 表与分卷归档发布；本库读取元数据把演奏者、专辑、录音年与对应作品关联，逐曲标注为「演奏版」（version_type=performance）。',
            en:'The upstream publishes a metadata table with split archives; this library joins performers, albums and recording years to their works, marking each track as a performance version.'},
    credit:{zh:'演奏转录与数据集由 ATEPP 团队制作并开放（CC BY 4.0）；演奏录音版权归各演奏者及其唱片方所有。',
            en:'Performance transcriptions and dataset by the ATEPP team, released under CC BY 4.0; performance rights remain with the respective pianists and labels.'},
  },
  {
    id:'thesession', name:{zh:'The Session', en:'The Session'}, count:23250,
    zone:'main', license:'CC BY-SA 4.0', count_note:'附加条款：禁止用于大语言模型（LLM）',
    url:'https://github.com/adactio/TheSession-data',
    kind:{zh:'爱尔兰传统曲调', en:'Irish traditional tunes'},
    what:{zh:'全球最大的爱尔兰传统音乐曲调档案，由社区贡献，每首曲调附调式、拍号、曲式（reel/jig/hornpipe 等）与多条变体。',
          en:"The world's largest community archive of Irish traditional tunes, with key, meter, form and multiple settings per tune."},
    method:    {zh:'上游每周发布的数据转储（官方 GitHub 数据仓 csv/tunes.csv，每曲取首个 setting）；本库仅做 ABC → MIDI 格式转换。',
            en:'Reads the weekly data dump published upstream (the official GitHub data repository, csv/tunes.csv, first setting per tune); this library only performs ABC to MIDI conversion.'},
    credit:{zh:'数据来自 thesession.org 社区（数千名贡献者），经其官方 GitHub 数据仓按周发布，依 CC BY-SA 4.0 共享。',
            en:'Data from the thesession.org community (thousands of contributors), published weekly through its official GitHub data repository under CC BY-SA 4.0.'},
  },
  {
    id:'cyberhymnal', name:{zh:'Cyber Hymnal', en:'Cyber Hymnal'}, count:10945,
    zone:'main', license:'Public Domain',
    url:'https://www.hymntime.com/tch/',
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
    url:'https://github.com/m-july/Anthology-of-Chinese-Folk-Songs',
    kind:{zh:'中国民歌', en:'Chinese folk songs'},
    what:{zh:'《中国民间歌曲集成》各省卷所收民歌的数字化成果，涵盖号子、山歌、小调、儿歌等体裁，标注省份与采录地。',
          en:'Digitised folk songs from the provincial volumes of the Anthology, covering work songs, mountain songs, xiaodiao and children\u2019s songs with province and collection locality.'},
    method:    {zh:'接入上游公开的《中国民间歌曲集成》OMR 数字化项目（14 卷、MIDI 原文，按省份分目录）；region 取省份目录名，标题为中文曲名。',
            en:'Ingested from the public OMR digitisation project of the Anthology (14 volumes of original MIDI filed by province); region from the province folder, title as the Chinese song name.'},
    credit:    {zh:'民歌为中国各民族传统音乐；本库所用 MIDI 由上游 OMR 数字化项目整理，汇编权属《中国民间歌曲集成》原编委会。仅作学习研究用途，商用请循原出版方授权。',
            en:'Traditional music of China; the MIDI used here was digitised by the upstream OMR project, compilation rights belonging to the original anthology editors. Study/research only.'},
  },
  {
    id:'essen', name:{zh:'ESAC 欧洲民歌档案', en:'ESAC Folk Song Archive'}, count:10373,
    zone:'main', license:'Public Domain / Open', count_note:'含少量受限条目',
    url:'https://www.esac-data.org/',
    kind:{zh:'欧洲民歌（德语区为主）', en:'European folk songs'},
    what:{zh:'基于 Essen 联想编码（Essen Associative Code）整理的大型欧洲民歌数据集，源自德国民歌档案与多国采录集，曲目自带地理层级（洲—国—地区）。',
          en:'A large European folk-song corpus in Essen Associative Code, drawn from German and international collections, with per-tune geographic hierarchy.'},
    method:{zh:'解析上游 ABC 记谱；国家由曲目自带的 O: 地理层级字段推导（中国曲目精确到省）。',
            en:'Upstream ABC records parsed; country derived from the per-tune O: geographic hierarchy.'},
    credit:{zh:'数据集由 ESAC / 德国民歌档案研究社群整理并开放。',
            en:'Curated and released by the ESAC / German folk-song archive community.'},
  },
  {
    id:'giantmidi', name:{zh:'GiantMIDI-Piano', en:'GiantMIDI-Piano'}, count:10110,
    zone:'main', license:'CC BY 4.0',
    url:'https://github.com/bytedance/GiantMIDI-Piano',
    kind:{zh:'古典钢琴演奏（大规模）', en:'Large-scale classical piano'},
    what:{zh:'由音频自动转录的大规模古典钢琴 MIDI 数据集（约 1 万首），附作曲家全名、国籍与生卒年。',
          en:'Large-scale classical piano MIDI transcribed from audio, with composer full names, nationalities and life dates.'},
    method:{zh:'上游公开发布 MIDI 与 composers_manually_checked.csv；国籍与生卒年取自该官方表。',
            en:'The upstream publishes MIDI plus composers_manually_checked.csv for nationality and dates.'},
    credit:{zh:'由字节跳动 GiantMIDI-Piano 项目发布，依 CC BY 4.0 共享。',
            en:'Released by the ByteDance GiantMIDI-Piano project under CC BY 4.0.'},
  },
  {
    id:'lakh', name:{zh:'Lakh MIDI Dataset', en:'Lakh MIDI Dataset'}, count:9109,
    zone:'study', license:'CC BY 4.0',
    url:'https://colinraffel.com/projects/lmd/',
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
    url:'https://norbeck.nu/abc/',
    kind:{zh:'爱尔兰 / 瑞典 / 世界民谣', en:'Irish, Swedish and world fiddle tunes'},
    what:{zh:'Henrik Norbeck 整理的 ABC 曲集，以爱尔兰与瑞典民谣为主，兼收北美、布列塔尼、巴尔干等地曲调，标注曲式与地域。',
          en:'Henrik Norbeck\u2019s ABC collections, mostly Irish and Swedish fiddle tunes, plus North American, Breton and Balkan material, with form and region.'},
    method:{zh:'解析上游 ABC 头字段（R: 曲式 / O: 地域）后做格式转换。',
            en:'Upstream ABC header fields (R:, O:) parsed, then format-converted.'},
    credit:{zh:'曲集由 Henrik Norbeck 无偿开放，请保留署名并访问原站。',
            en:'Made freely available by Henrik Norbeck; please keep attribution and visit the original site.'},
  },
  {
    id:'m21', name:{zh:'music21 语料库', en:'music21 Corpus'}, count:3028,
    zone:'main', license:'Public Domain',
    url:'https://github.com/cuthbertLab/music21',
    kind:{zh:'西方古典（教学语料）', en:'Western classical (teaching corpus)'},
    what:{zh:'MIT music21 工具包附带的教学与分析用乐谱语料，含巴赫众赞歌、科雷利、蒙特威尔第等。',
          en:'The teaching and analysis corpus bundled with MIT\u2019s music21 toolkit.'},
    method:    {zh:'取用随 music21 工具包分发的 CoreCorpus（含 kern 与 MusicXML）；转为 MIDI，时期参照作曲家生卒推断，标题规范化（BWV 等）。',
            en:'Uses the CoreCorpus shipped with the music21 toolkit (kern and MusicXML); converted to MIDI, periods inferred from composer dates.'},
    credit:{zh:'语料由 MIT music21 项目维护，各作品依其原始许可。',
            en:'Maintained by the MIT music21 project; individual works retain their original licences.'},
  },
  {
    id:'mutopia', name:{zh:'Mutopia Project', en:'Mutopia Project'}, count:1860,
    zone:'main', license:'Public Domain / CC（逐曲）',
    url:'https://www.mutopiaproject.org/',
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
    url:'http://trillian.mit.edu/~jc/music/abc/',
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
    url:'https://github.com/OpenScore/Lieder',
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
    url:'https://magenta.tensorflow.org/datasets/maestro',
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
    url:'https://magenta.tensorflow.org/datasets/groove',
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
    zone:'piano', license:'CC BY-NC-SA 4.0',
    url:'https://zenodo.org/records/5257995',
    kind:{zh:'带情绪标注的钢琴曲', en:'Emotion-annotated piano'},
    what:{zh:'带四象限情绪标注的钢琴 MIDI 数据集，用于音乐情感识别研究。',
          en:'Piano MIDI with four-quadrant emotion annotations for music emotion recognition.'},
    method:    {zh:'采用上游公开发布的 EMOPIA v2.2 数据包（MIDI 与四象限情绪标注表）。',
            en:'Uses the upstream EMOPIA v2.2 release (MIDI plus four-quadrant emotion annotation table).'},
    credit:    {zh:'由 EMOPIA 研究团队（Academia Sinica / KAIST / Georgia Tech）发布，依 CC BY-NC-SA 4.0 共享，仅限非商业用途。',
            en:'Released by the EMOPIA research team (Academia Sinica / KAIST / Georgia Tech) under CC BY-NC-SA 4.0; non-commercial use only.'},
  },
  {
    id:'nottingham', name:{zh:'Nottingham 数据集', en:'Nottingham Dataset'}, count:1033,
    zone:'main', license:'Open / Free',
    url:'https://ifdo.ca/~seymour/nottingham/',
    kind:{zh:'民谣曲调（ABC）', en:'Folk tunes (ABC)'},
    what:{zh:'Jukedeck 整理的民谣 ABC 曲集，用于符号音乐生成研究，含曲式与调式。',
          en:'A folk ABC collection from Jukedeck, widely used in symbolic music generation research.'},
    method:    {zh:'读取 Nottingham Music Database 的 ABC 校订版（Seymour Shlien 修正缺失拍与反复）；解析 R: 曲式字段后做格式转换。',
            en:'Reads the corrected ABC edition of the Nottingham Music Database (Seymour Shlien\u2019s fixes for missing beats and repeats); R: form field parsed, then converted.'},
    credit:    {zh:'数据库由 Eric Foxley 建立，Seymour Shlien 校订并转为 ABC 记谱公开。',
            en:'Database created by Eric Foxley; the ABC edition was corrected and published by Seymour Shlien.'},
  },
  {
    id:'wikifonia', name:{zh:'Wikifonia', en:'Wikifonia'}, count:445,
    zone:'main', license:'Public Domain（仅传统/民歌子集）',
    url:'http://www.synthzone.com/files/Wikifonia/Wikifonia.zip',
    kind:{zh:'爵士标准曲', en:'Jazz standards'},
    what:{zh:'已归档的爵士与流行标准曲乐谱库，含和弦进行与旋律，是爵士教学常用的开放语料。',
          en:'An archived lead-sheet library of jazz and pop standards with chords and melody.'},
    method:    {zh:'采用公开发布的 Wikifonia 整包（MusicXML lead sheets），仅保留传统/民歌子集，20 世纪流行与爵士标准曲因版权未收。',
            en:'Uses the publicly released Wikifonia archive (MusicXML lead sheets); only the traditional/folk subset is kept, 20th-century pop and jazz standards excluded for copyright.'},
    credit:    {zh:'原站 wikifonia.org 已下线；本库所用为公开发布的 Wikifonia 整包（MD5 校验一致），仅保留其中的公有领域传统曲目。',
            en:'The original wikifonia.org site is offline; this library uses the publicly released Wikifonia archive (MD5-verified) and keeps only its public-domain traditional material.'},
  },
  {
    id:'oga', name:{zh:'OpenGameArt', en:'OpenGameArt'}, count:339,
    zone:'main', license:'逐曲混合（CC0 / CC BY / CC BY-SA / GPL）',
    url:'https://opengameart.org/',
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
    url:'https://zenodo.org/records/5120004',
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
const EXCLUDED_CAT = {
  A:{zh:'不可分发', en:'NOT REDISTRIBUTABLE'},
  B:{zh:'许可未明确', en:'LICENCE UNCLEAR'},
  C:{zh:'待核实', en:'UNDER REVIEW'},
  D:{zh:'待收录', en:'NOT YET INGESTED'},
};

/* 考察过但未收录的源（分四类；与 docs/SOURCE-CATALOG.md 第三节一一对应）
   A 不可分发 · B 许可未明确（不下载，但公开可自取）· C 待核实 · D 许可清晰但尚未抓取 */
const EXCLUDED = [
  { id:'kunstderfuge', cat:'A', name:{zh:'Kunst der Fuge', en:'Kunst der Fuge'}, count:'19,300',
    license:'站点声明「for personal use」', url:'https://www.kunstderfuge.com/',
    why:{zh:'站点声明仅限个人使用，不允许再分发。',
         en:'The site states personal use only; redistribution is not permitted.'} },
  { id:'imslp', cat:'A', name:{zh:'IMSLP「Music files」部分', en:'IMSLP “Music files” (partial)'}, count:'数千（部分）',
    license:'部分附件标注 no redistribution', url:'https://imslp.org/',
    why:{zh:'部分附件明确标注不可再分发；逐曲筛选后仅可收其中允许的一部分，该筛选尚未执行。',
         en:'Some attachments are explicitly marked no-redistribution; only a per-file screening would allow partial inclusion, which has not been carried out.'} },
  { id:'nesmusic', cat:'A', name:{zh:'NES Music Database', en:'NES Music Database'}, count:'5,278',
    license:'研究用途，再分发条款不明', url:'https://www.vgmusic.com/',
    why:{zh:'标注研究用途，再分发条款不明，保守不收。',
         en:'Marked for research use with unclear redistribution terms, so excluded conservatively.'} },
  { id:'pianocore', cat:'A', name:{zh:'PianoCoRe', en:'PianoCoRe'}, count:'250,046 演奏',
    license:'CC BY-NC-SA 4.0 + 「strictly for non-commercial research and educational purposes」', url:'https://github.com/CPJKU/pianocore',
    why:{zh:'许可附加条款严于 NC，限定于非商业研究/教育，超出本库面向公众的服务性质。',
         en:'Its licence is stricter than NC — restricted to non-commercial research and education — which goes beyond a publicly available library.'} },
  { id:'pop909', cat:'A', name:{zh:'POP909', en:'POP909'}, count:'909',
    license:'仓库 MIT 仅覆盖代码；内容为非商业研究/教育限定', url:'https://github.com/music-x-lab/POP909-Dataset',
    why:{zh:'内容为版权流行歌的钢琴改编，改编者无权授权原曲，且限定非商业研究/教育（双重问题）。',
         en:'Piano arrangements of copyrighted pop songs (the arranger cannot license the original) plus a non-commercial research/education restriction.'} },
  { id:'piano-e-competition', cat:'A', name:{zh:'Piano-e-Competition', en:'Piano-e-Competition'}, count:'1,573',
    license:'官网「免费下载」；第三方镜像自述未找到许可信息', url:'https://web.archive.org/web/2020/http://www.piano-e-competition.com/',
    why:{zh:'免费下载不等于允许再分发；第三方镜像亦未找到任何许可信息。',
         en:'Free download does not imply redistribution rights, and third-party mirrors state no licence was found.'} },
  { id:'vgmusic', cat:'A', name:{zh:'VGMdb / vgmusic.com（游戏音乐）', en:'VGMdb / vgmusic.com (game music)'}, count:'28,419',
    license:'以爱好者编配为主', url:'https://www.vgmusic.com/',
    why:{zh:'多为对版权游戏原曲的粉丝编配，编配者无权授权原曲，版权风险明确。',
         en:'Mostly fan arrangements of copyrighted game music; arrangers cannot license the originals — a clear copyright risk.'} },
  { id:'ccmusic', cat:'A', name:{zh:'CCMusic 流行库（M-W / BDoPM）', en:'CCMusic pop collections (M-W / BDoPM)'}, count:'上百首',
    license:'官方声明仅授权签约大学研究使用', url:'http://www.cpjj.org/',
    why:{zh:'官方声明因涉及版权协议，只对签订协议的大学授权研究使用。',
         en:'Officially licensed only to contracted universities for research use.'} },
  { id:'anthology-cn-folk', cat:'A', name:{zh:'Anthology of Chinese Folk Songs（8 卷 OMR）', en:'Anthology of Chinese Folk Songs (8 vols, OMR)'}, count:'5,000+',
    license:'扫描图自述版权受限', url:'https://github.com/m-july/Anthology-of-Chinese-Folk-Songs',
    why:{zh:'与本库 chinafolk 同源（《中国民间歌曲集成》的另一 OMR）；且扫描图自述版权受限，版权链不清。',
         en:'Same underlying collection as our chinafolk source (another OMR of the same anthology); the scans state copyright restrictions and the chain of title is unclear.'} },
  { id:'wjazzd', cat:'A', name:{zh:'Weimar Jazz Database (WJazzD)', en:'Weimar Jazz Database (WJazzD)'}, count:'456',
    license:'学术文献明确版权受限', url:'https://jazzomat.hfm-weimar.de/dbformat/dbcontent.html',
    why:{zh:'学术文献明确指出「版权限制阻止获取音符与上下文标注」，2026-09-22 查证后不收。',
         en:'The academic documentation states copyright restrictions prevent access to note and contextual annotations; assessed and excluded on 2026-09-22.'} },
  { id:'kernscores', cat:'B', name:{zh:'KernScores (CCARH)', en:'KernScores (CCARH)'}, count:'108,703',
    license:'站点声明 for research and teaching；许可专页 404/503', url:'https://kern.ccarh.org/',
    why:{zh:'许可未明确说明是否允许再分发，且首页存在「copyright restricted materials」登录区。',
         en:'The licence does not state whether redistribution is allowed, and the site has a login area for copyright-restricted materials.'} },
  { id:'josquin', cat:'B', name:{zh:'Josquin Research Project', en:'Josquin Research Project'}, count:'~1,000',
    license:'站点无任何许可声明', url:'https://josquin.stanford.edu/',
    why:{zh:'数据可直接下载，但站点无任何许可声明，无法确认再分发授权。',
         en:'Data is directly downloadable, but no licence statement exists, so redistribution rights cannot be confirmed.'} },
  { id:'musedata', cat:'B', name:{zh:'MuseData (CCARH)', en:'MuseData (CCARH)'}, count:'924',
    license:'CCARH 站点无许可声明', url:'https://www.ccarh.org/publications/data/',
    why:{zh:'CCARH 站点无许可声明，原 Stanford 页面已 404；许可条款明确禁止再分发，故不纳入任何下载包。',
         en:'No licence statement on the CCARH site and the original Stanford page is gone; redistribution is forbidden, so it is excluded from every download pack.'} },
  { id:'digitaltradition', cat:'B', name:{zh:'Digital Tradition (Mudcat)', en:'Digital Tradition (Mudcat)'}, count:'数万',
    license:'站点条款未澄清', url:'https://mudcat.org/',
    why:{zh:'站点条款未澄清，无法确认再分发授权。',
         en:'Site terms are not clarified, so redistribution rights cannot be confirmed.'} },
  { id:'midiworld', cat:'B', name:{zh:'MIDIWorld', en:'MIDIWorld'}, count:'数千',
    license:'站方声称 public domain，但无正式许可文本', url:'https://www.midiworld.com/',
    why:{zh:'站方声称公有领域，但无正式许可文本可核实；声明不足以构成许可依据。',
         en:'The site claims public domain but offers no verifiable licence text; a claim alone is not a sufficient basis for licensing.'} },
  { id:'sonatica', cat:'B', name:{zh:'sonatica.fm', en:'sonatica.fm'}, count:'11,000',
    license:'站点许可条款不明确', url:'https://sonatica.fm/',
    why:{zh:'站点许可条款不明确，无法确认再分发授权。',
         en:'The site\'s licence terms are unclear, so redistribution rights cannot be confirmed.'} },
  { id:'piano-midi-de', cat:'B', name:{zh:'piano-midi.de', en:'piano-midi.de'}, count:'332',
    license:'站点许可不明确', url:'https://www.piano-midi.de/',
    why:{zh:'站点许可不明确，无法确认再分发授权。',
         en:'The site\'s licence is unclear, so redistribution rights cannot be confirmed.'} },
  { id:'metamidi', cat:'B', name:{zh:'MetaMIDI', en:'MetaMIDI'}, count:'612,088',
    license:'PDMX 论文（NeurIPS 2024）点名无明确许可信息', url:'https://github.com/jeffreyjohnens/MetaMIDIDataset',
    why:{zh:'PDMX 论文明确点名其「无明确许可信息，版权不安全」。',
         en:'The PDMX paper explicitly names it as having no clear licence information and being copyright-unsafe.'} },
  { id:'mmd', cat:'B', name:{zh:'MMD（Multi-Modal MIDI）', en:'MMD (Multi-Modal MIDI)'}, count:'1,524,557',
    license:'论文点名许可证不清晰', url:'',
    why:{zh:'PDMX 论文点名其许可证不清晰，无法确认再分发授权。',
         en:'Named in the PDMX paper as having an unclear licence, so redistribution rights cannot be confirmed.'} },
  { id:'symphonynet', cat:'B', name:{zh:'SymphonyNet', en:'SymphonyNet'}, count:'46,359',
    license:'论文点名许可证不清晰', url:'',
    why:{zh:'PDMX 论文点名其许可证不清晰，无法确认再分发授权。',
         en:'Named in the PDMX paper as having an unclear licence, so redistribution rights cannot be confirmed.'} },
  { id:'hymnal-net', cat:'B', name:{zh:'Hymnal.net', en:'Hymnal.net'}, count:'3,358',
    license:'站点未提供内容再分发许可声明', url:'https://www.hymnal.net/',
    why:{zh:'站点未提供明确的内容再分发许可声明。',
         en:'The site provides no explicit licence statement for redistributing its content.'} },
  { id:'sourdough', cat:'B', name:{zh:'Sourdough MIDI Dataset', en:'Sourdough MIDI Dataset'}, count:'~5,000,000',
    license:'HuggingFace 公开，许可状态不明', url:'https://huggingface.co/datasets/BreadAi/Sourdough-midi-dataset',
    why:{zh:'平台公开可访问，但许可状态不明。',
         en:'Publicly accessible on a hosting platform, but its licence status is unclear.'} },
  { id:'various-compilations', cat:'B', name:{zh:'各类大汇编（reddit 等）', en:'Various large compilations (Reddit etc.)'}, count:'800,000+',
    license:'无许可文本可核实', url:'',
    why:{zh:'无许可文本可核实，无法确认再分发授权。',
         en:'No verifiable licence text, so redistribution rights cannot be confirmed.'} },
  { id:'internet-archive', cat:'C', name:{zh:'Internet Archive MIDI 集合', en:'Internet Archive MIDI collections'}, count:'数万（需筛）',
    license:'逐集合许可不同', url:'https://archive.org/details/midi',
    why:{zh:'逐集合许可不同，且混有版权内容，需逐一筛选后方可判断。',
         en:'Per-collection licences vary and some contain copyrighted content; each would need individual screening.'} },
  { id:'cipi', cat:'C', name:{zh:'CIPI（中国钢琴作品）', en:'CIPI (Chinese piano works)'}, count:'—',
    license:'全网检索未证实存在', url:'',
    why:{zh:'全网检索未证实该数据集存在（2026-09-22 查证）。',
         en:'An exhaustive search on 2026-09-22 could not confirm that this dataset exists.'} },
  { id:'cpdl', cat:'D', name:{zh:'CPDL ChoralWiki', en:'CPDL ChoralWiki'}, count:'~25,000',
    license:'PD / CPDL License（类 CC BY-NC-SA）', url:'https://www.cpdl.org/',
    why:{zh:'许可清晰（PD / CPDL License），但需逐曲抓取，站点限速约 1,000/天，尚未抓取。',
         en:'Licence is clear (PD / CPDL License) but requires per-piece fetching and the site rate-limits at about 1,000/day; not yet ingested.'} },
  { id:'gregobase', cat:'D', name:{zh:'Gregobase（格里高利圣咏）', en:'Gregobase (Gregorian chant)'}, count:'~6,000',
    license:'CC BY-SA', url:'https://gregobase.selab.ne.jp/',
    why:{zh:'许可清晰（CC BY-SA），官网提供导出，尚未抓取。',
         en:'Licence is clear (CC BY-SA) and the site offers an export; not yet ingested.'} },
  { id:'hymnal-tune', cat:'D', name:{zh:'Hymnal Tune Dataset', en:'Hymnal Tune Dataset'}, count:'1,756',
    license:'PD / 开放', url:'https://hymnary.org/',
    why:{zh:'许可清晰（PD / 开放），可直接下载，尚未抓取。',
         en:'Licence is clear (PD / open) and it is directly downloadable; not yet ingested.'} },
  { id:'hymnary', cat:'D', name:{zh:'Hymnary.org 赞美诗', en:'Hymnary.org hymns'}, count:'数千',
    license:'PD 为主', url:'https://hymnary.org/',
    why:{zh:'许可清晰（以 PD 为主），需抓取，尚未收录。',
         en:'Licence is clear (mostly PD) but requires crawling; not yet ingested.'} },
  { id:'abcnotation', cat:'D', name:{zh:'abcnotation.com 集合', en:'abcnotation.com collections'}, count:'2 万+',
    license:'逐集合', url:'https://abcnotation.com/',
    why:{zh:'许可逐集合而定（本库 ABC Misc 1,487 首并非取自本站，而来自 John Chambers 曲集），尚未逐集合接入。',
         en:'Licences vary per collection (our ABC Misc tracks come from the John Chambers collection, not from this site); per-collection ingestion has not been done.'} },
  { id:'openscore-sq', cat:'D', name:{zh:'OpenScore String Quartets 等', en:'OpenScore String Quartets and others'}, count:'进行中',
    license:'CC0', url:'https://github.com/OpenScore',
    why:{zh:'许可清晰（CC0），但项目仍在进行中，待其稳定后再接入。',
         en:'Licence is clear (CC0) but the projects are still in progress; we will ingest once they stabilise.'} },
  { id:'figshare-cn', cat:'D', name:{zh:'figshare 中国经典 MIDI', en:'figshare Chinese classical MIDI'}, count:'13',
    license:'CC BY 4.0', url:'https://figshare.com/articles/5436022',
    why:{zh:'许可清晰（CC BY 4.0），但我们下载受阻（网络原因），欢迎自取。',
         en:'Licence is clear (CC BY 4.0) but our download was blocked by network conditions; you are welcome to fetch it yourself.'} },
];

/* ── 来源核验（台账：docs/PROVENANCE.md · 机器可读版 docs/provenance.json）──
   规则：每源只登记一个地址，且必须是我们实际取得数据的位置；档位须与发布 catalog 一致。 */
const SRC_VERIFIED = '2026-09-21';
const PROV_DOC = 'https://github.com/midicn/midi-library/blob/main/docs/PROVENANCE.md';
const PROV_PAGE = 'provenance.html';   /* 站内台账页（不依赖 GitHub）*/

/* ── 本库自身许可（供页脚与许可页引用）─────────────── */
const LIB_LICENCE = {
  code:  { id: 'MIT',        text: 'MIT' },
  data:  { id: 'CC BY 4.0',  text: 'CC BY 4.0' },
  zh: '代码 MIT · 元数据 CC BY 4.0 · 素材依各来源许可',
  en: 'Code MIT · metadata CC BY 4.0 · material per source'
};

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
