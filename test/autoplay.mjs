/* =============================================================================
   골라!  자동 플레이 테스트
   ----------------------------------------------------------------------------
   이 수치는 밸런스 확인용이고 재미의 증거가 아니다.
   재미는 직접 10판 해보고 판단한다. (프로젝트 지침)

   실행:  node test/autoplay.mjs            (기본 8 시드, 상한 120초)
          node test/autoplay.mjs --seeds 20 --max 90
   ============================================================================= */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const SEEDS = arg('--seeds', 8);
const MAX_MS = arg('--max', 120) * 1000;

/* --------------------------------------------------------------------------
   페이지 안에서 도는 봇. 스텝마다 왕복하지 않으려고 통째로 evaluate 한다.
   -------------------------------------------------------------------------- */
function botInPage(cfg){
  const J = window.__judge;
  const FRAME = 1000 / 60;
  J.reset(cfg.seed);

  /* 봇의 오판(5%)용 난수. 게임 로직이 아니라 테스트 쪽 난수다. */
  let rs = (cfg.seed ^ 0x9e3779b9) >>> 0;
  const rnd = () => { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };

  const maxTicks = Math.round(cfg.maxMs / FRAME);
  let seenId = -1, wantId = -1, fireTick = 0;
  let st = J.state();

  while (!st.over && st.tick < maxTicks){
    const a = st.active;
    if (a){
      if (cfg.type === 'perfect'){
        /* 조건 도형이 활성화되는 즉시 탭 = 상한 */
        if (a.color === st.condition) J.tap();
      } else if (cfg.type === 'safe'){
        /* 하단 구역(×1)에서만 탭 */
        if (a.color === st.condition && a.y >= 382) J.tap();   /* ×1 구역 */
      } else {
        /* react(ms): "보고" 나서 ms 뒤에 탭. 5%는 오판. */
        if (a.id !== seenId){
          seenId = a.id;
          const truth = (a.color === st.condition);
          const think = (rnd() < 0.05) ? !truth : truth;
          if (think){ wantId = a.id; fireTick = st.tick + Math.round(cfg.ms / FRAME); }
          else wantId = -1;
        }
        if (wantId === a.id && st.tick >= fireTick){ J.tap(); wantId = -1; }
      }
    }
    st = J.step(1);
  }

  const r = J.lastResult();
  return {
    seed: cfg.seed,
    score: st.score,
    timeMs: st.timeMs,
    over: st.over,
    level: st.level,
    processed: st.processed,
    stats: st.stats,
    replay: r ? { seed: r.seed, inputs: r.inputs, score: r.score } : null,
  };
}

/* -------------------------------------------------------------------------- */
const pad = (s, n, right) => { s = String(s); return right ? s.padStart(n) : s.padEnd(n); };
const f1 = n => (Math.round(n * 10) / 10).toFixed(1);

function summarize(name, runs){
  const n = runs.length;
  const avg = k => runs.reduce((a, r) => a + k(r), 0) / n;
  const s = k => runs.reduce((a, r) => a + k(r), 0);
  return {
    name,
    surv: avg(r => r.timeMs / 1000),
    survMin: Math.min(...runs.map(r => r.timeMs / 1000)),
    survMax: Math.max(...runs.map(r => r.timeMs / 1000)),
    score: avg(r => r.score),
    died: runs.filter(r => r.over).length,
    z4: s(r => r.stats.z4), z3: s(r => r.stats.z3), z2: s(r => r.stats.z2), z1: s(r => r.stats.z1),
    hit: s(r => r.stats.hit), wrong: s(r => r.stats.wrong),
    miss: s(r => r.stats.miss), pass: s(r => r.stats.pass),
  };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(PAGE);
  await page.waitForFunction(() => !!window.__judge);

  const bots = [
    { key: 'perfect',    cfg: { type: 'perfect' } },
    { key: 'react(200)', cfg: { type: 'react', ms: 200 } },
    { key: 'react(300)', cfg: { type: 'react', ms: 300 } },
    { key: 'react(400)', cfg: { type: 'react', ms: 400 } },
    { key: 'safe',       cfg: { type: 'safe' } },
  ];

  const results = {};
  const replayChecks = [];

  for (const b of bots){
    const runs = [];
    for (let i = 0; i < SEEDS; i++){
      const seed = 1000 + i * 7919;
      const r = await page.evaluate(botInPage, Object.assign({ seed, maxMs: MAX_MS }, b.cfg));
      runs.push(r);
      if (r.replay && r.over){
        const v = await page.evaluate(([s, inp]) => window.__judge.replay(s, inp),
          [r.replay.seed, r.replay.inputs]).catch(() => null);
        replayChecks.push({ bot: b.key, seed, orig: r.score, again: v ? v.score : null });
      }
    }
    results[b.key] = summarize(b.key, runs);
  }

  /* ---- 출력 ---- */
  const perfect = results['perfect'];
  console.log('\n골라!  자동 플레이 결과   (시드 ' + SEEDS + '개 · 상한 ' + (MAX_MS / 1000) + '초)');
  console.log('─'.repeat(88));
  console.log(pad('봇', 12) + pad('생존(초) 평균', 15, true) + pad('  [최소~최대]', 16) +
              pad('점수 평균', 11, true) + pad('사망', 6, true) + pad('  ×4/×3/×2/×1', 18) + pad('  hit/wrong/miss/pass', 22));
  console.log('─'.repeat(88));
  for (const b of bots){
    const r = results[b.key];
    console.log(
      pad(r.name, 12) +
      pad(f1(r.surv), 15, true) +
      pad('  [' + f1(r.survMin) + '~' + f1(r.survMax) + ']', 16) +
      pad(Math.round(r.score), 11, true) +
      pad(r.died + '/' + SEEDS, 6, true) +
      pad('  ' + r.z4 + '/' + r.z3 + '/' + r.z2 + '/' + r.z1, 18) +
      pad('  ' + r.hit + '/' + r.wrong + '/' + r.miss + '/' + r.pass, 22)
    );
  }
  console.log('─'.repeat(88));

  const ratio = perfect.score > 0 ? results['safe'].score / perfect.score : 0;
  const perHit = perfect.hit > 0 ? (perfect.score * SEEDS) / perfect.hit : 0;
  console.log('perfect 한 방 평균     : +' + f1(perHit));
  console.log('safe / perfect 점수비  : ' + (ratio * 100).toFixed(1) + '%   (완료 기준: 40% 이하)');

  const ok = [];
  ok.push(['perfect 90초 이상', perfect.survMin >= 90]);
  ok.push(['react(300) 45~75초', results['react(300)'].surv >= 45 && results['react(300)'].surv <= 75]);
  ok.push(['safe ≤ perfect의 40%', ratio <= 0.40]);

  /* 재현성 */
  const bad = replayChecks.filter(c => c.again !== c.orig);
  ok.push(['replay 점수 일치 (' + replayChecks.length + '판)', bad.length === 0]);

  console.log('');
  for (const [label, pass] of ok) console.log((pass ? '  PASS  ' : '  FAIL  ') + label);
  if (bad.length){
    console.log('\n  불일치:');
    for (const c of bad.slice(0, 5)) console.log('    ' + c.bot + ' seed=' + c.seed + '  원본 ' + c.orig + ' / 재현 ' + c.again);
  }
  if (errs.length){ console.log('\n  페이지 오류:'); errs.slice(0, 5).forEach(e => console.log('    ' + e)); }
  console.log('');

  await browser.close();
  process.exit(ok.every(o => o[1]) && !errs.length ? 0 : 1);
})();
