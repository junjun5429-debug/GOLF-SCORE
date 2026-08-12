'use strict';

/* ============================================================
   ゴルフスコア管理アプリ (PWA)
   - localStorage にデータ保存（サーバー不要 / オフライン動作）
   - オリンピック精算・経費精算(順位割) を自動計算
   ============================================================ */

const STORAGE_KEY = 'golf-score-app:v1';
const DEFAULT_MEMBERS = ['柴谷', '江田', '松田', '吉田'];
const DEFAULT_RATE = 150;
const MEMBER_COLORS = ['var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)'];
const MEMBER_HEX = ['#1b7d3f', '#2f6fd8', '#e08a1e', '#9b3fc0'];

/* ---------- ユーティリティ ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const num = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function excelSerialToISO(serial) {
  // Excel シリアル値(1900日付システム, 1899-12-30 基点) を ISO 日付へ
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${y}.${Number(m)}.${Number(d)}`;
}

function fmtYen(v) {
  const r = Math.round(v);
  return (r > 0 ? '+' : '') + r.toLocaleString('ja-JP');
}

function signClass(v) {
  return v > 0 ? 'pos' : v < 0 ? 'neg' : '';
}

/* ---------- 初期データ（Excel より取り込み） ---------- */
// [シリアル値, コース名, 吉田, 柴谷, 江田, 松田]
const SEED_HISTORY = [
  [41549, '大月ガーデンゴルフクラブ', 127, 99, 101, 114],
  [41631, '西東京ゴルフ倶楽部', 141, 106, 104, 124],
  [41985, 'よみうりゴルフ倶楽部', 125, 104, 97, 112],
  [42337, '花咲カントリー倶楽部', 115, 95, 94, 109],
  [42560, '花咲カントリー倶楽部', 122, 95, 96, 105],
  [42875, '大月ガーデンゴルフクラブ', 119, 103, 102, 116],
  [43028, '花咲カントリー倶楽部', 120, 97, 113, 109],
  [43294, '富士リゾートカントリークラブ', 124, 102, 107, 113],
  [43378, '上野原カントリークラブ', 131, 110, 113, 113],
  [43716, '大月ガーデンゴルフクラブ', 120, 100, 106, 110],
  [44016, 'アクアライン ゴルフクラブ', 143, 119, 112, 130],
  [44474, '中央都留カントリー倶楽部', 129, 108, 102, 113],
  [44995, '大月ガーデンゴルフクラブ', 121, 100, 114, 113],
  [45227, 'ウッドストックカントリークラブ', 124, 110, 108, 113],
  [45478, '大月ガーデンゴルフクラブ', 115, 102, 109, 106],
  [45575, '武蔵野ゴルフクラブ', 112, 89, 100, 130],
  [45730, '太平洋クラブ 大洗シャーウッド', 123, 102, 114, 131],
  [45849, '富士クラシック', 100, 85, 104, 116],
];

// 2025.10.20 は精算まで入力済みのラウンド
const SEED_LAST_ROUND = {
  serial: 45950,
  course: '西東京ゴルフ倶楽部',
  rate: 150,
  // [吉田, 柴谷, 江田, 松田]
  score: { 吉田: 103, 柴谷: 94, 江田: 93, 松田: 118 },
  prev: { 吉田: 100, 柴谷: 85, 江田: 104, 松田: 116 },
  olympic: { 吉田: -1, 柴谷: 3, 江田: 5, 松田: 0 },
  expense: { 吉田: 6500, 柴谷: 680, 江田: 5300, 松田: 460 },
};

function buildSeedData() {
  const members = DEFAULT_MEMBERS.slice();
  const rounds = [];

  SEED_HISTORY.forEach((row) => {
    const [serial, course, yoshida, shibaya, eda, matsuda] = row;
    const scoreMap = { 吉田: yoshida, 柴谷: shibaya, 江田: eda, 松田: matsuda };
    const players = {};
    members.forEach((m) => {
      players[m] = { score: scoreMap[m], prev: null, olympic: null, expense: null };
    });
    rounds.push({
      id: uid(),
      date: excelSerialToISO(serial),
      course,
      rate: DEFAULT_RATE,
      players,
    });
  });

  // 最終ラウンド（精算込み）
  const lr = SEED_LAST_ROUND;
  const lrPlayers = {};
  members.forEach((m) => {
    lrPlayers[m] = {
      score: lr.score[m],
      prev: lr.prev[m],
      olympic: lr.olympic[m],
      expense: lr.expense[m],
    };
  });
  rounds.push({
    id: uid(),
    date: excelSerialToISO(lr.serial),
    course: lr.course,
    rate: lr.rate,
    players: lrPlayers,
  });

  return { members, defaultRate: DEFAULT_RATE, rounds };
}

/* ---------- ストレージ ---------- */
let state = null;
let chartRange = 'all'; // '5' | '10' | '20' | 'all'

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = JSON.parse(raw);
      if (!state.members || !state.rounds) throw new Error('invalid');
    } else {
      state = buildSeedData();
      saveState();
    }
  } catch (e) {
    state = buildSeedData();
    saveState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function sortedRounds() {
  return state.rounds.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/* ---------- 計算エンジン ---------- */
function computeSettlement(round) {
  const members = state.members;
  const rate = num(round.rate) || DEFAULT_RATE;
  const p = round.players;
  const n = members.length;

  const olySum = members.reduce((s, m) => s + num(p[m].olympic), 0);

  // ハンデ込み順位: (今回 - 前回) の昇順。小さいほど上位(1位)
  const nets = {};
  members.forEach((m) => {
    nets[m] = num(p[m].score) - num(p[m].prev);
  });
  const rank = {};
  members.forEach((m) => {
    rank[m] = 1 + members.filter((x) => nets[x] < nets[m]).length;
  });

  const totalExpense = members.reduce((s, m) => s + num(p[m].expense), 0);
  const weightSum = members.reduce((s, m) => s + (rank[m] - 1), 0);

  const result = {};
  members.forEach((m) => {
    const oly = num(p[m].olympic);
    const olympicSettle = (oly * n - olySum) * rate;
    const share = weightSum > 0 ? ((rank[m] - 1) / weightSum) * totalExpense : 0;
    const expenseSettle = num(p[m].expense) - share;
    result[m] = {
      net: nets[m],
      rank: rank[m],
      olympic: oly,
      olympicSettle,
      expense: num(p[m].expense),
      share,
      expenseSettle,
      total: olympicSettle + expenseSettle,
    };
  });

  return { rate, totalExpense, result };
}

function roundHasSettlement(round) {
  const p = round.players;
  return state.members.some(
    (m) => p[m].olympic != null && p[m].olympic !== '' || p[m].expense != null && p[m].expense !== ''
  );
}

/* ---------- 画面遷移 ---------- */
const views = ['list', 'detail', 'edit', 'settings'];
function showView(name) {
  views.forEach((v) => $('#view-' + v).classList.toggle('hidden', v !== name));
  $('#fab').style.display = name === 'list' ? 'block' : 'none';
  window.scrollTo(0, 0);
}

/* ---------- 一覧画面 ---------- */
function renderList() {
  const rounds = sortedRounds();
  renderStats(rounds);
  renderRangeTabs();
  renderChart(rounds);
  renderRoundList(rounds);
}

function renderRangeTabs() {
  $$('#range-tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.range === chartRange);
  });
}

function renderStats(rounds) {
  const grid = $('#stats-grid');
  grid.innerHTML = '';
  const rangeN = chartRange === 'all' ? null : parseInt(chartRange, 10);
  const label = chartRange === 'all' ? '全試合トータル平均' : `直近${chartRange}試合平均`;
  const title = $('.stats-title');
  if (title) title.innerHTML = `個人スコア <span class="muted">（${label}）</span>`;
  state.members.forEach((m, i) => {
    let scores = rounds.map((r) => num(r.players[m] && r.players[m].score)).filter((s) => s > 0);
    if (rangeN) scores = scores.slice(-rangeN);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const el = document.createElement('div');
    el.className = 'stat';
    el.innerHTML = `
      <div class="name"><span class="dot" style="background:${MEMBER_HEX[i % 4]}"></span>${m}</div>
      <div class="avg">${avg ? avg.toFixed(1) : '-'}</div>
      <div class="sub">${scores.length}試合</div>`;
    grid.appendChild(el);
  });
}

function renderChart(rounds) {
  const legend = $('#chart-legend');
  legend.innerHTML = state.members
    .map(
      (m, i) =>
        `<span class="item"><span class="swatch" style="background:${MEMBER_HEX[i % 4]}"></span>${m}</span>`
    )
    .join('');

  const canvas = $('#chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 320;
  const cssH = 220;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  let withScore = rounds.filter((r) => state.members.some((m) => num(r.players[m].score) > 0));
  if (chartRange !== 'all') {
    withScore = withScore.slice(-parseInt(chartRange, 10));
  }
  if (withScore.length < 2) {
    ctx.fillStyle = '#6b776f';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('データが増えるとグラフが表示されます', cssW / 2, cssH / 2);
    return;
  }

  const padL = 34, padR = 10, padT = 12, padB = 24;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;

  let min = Infinity, max = -Infinity;
  withScore.forEach((r) =>
    state.members.forEach((m) => {
      const s = num(r.players[m].score);
      if (s > 0) {
        min = Math.min(min, s);
        max = Math.max(max, s);
      }
    })
  );
  min = Math.floor((min - 3) / 5) * 5;
  max = Math.ceil((max + 3) / 5) * 5;
  const range = max - min || 1;

  const xFor = (i) => padL + (withScore.length === 1 ? plotW / 2 : (i / (withScore.length - 1)) * plotW);
  const yFor = (v) => padT + plotH - ((v - min) / range) * plotH;

  // グリッド + Y軸ラベル
  ctx.strokeStyle = '#eef1ef';
  ctx.fillStyle = '#9aa5a0';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.lineWidth = 1;
  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const val = min + (range * s) / steps;
    const y = yFor(val);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.stroke();
    ctx.fillText(Math.round(val), padL - 5, y + 3);
  }

  // X軸ラベル（最初/中間/最後）
  ctx.textAlign = 'center';
  ctx.fillStyle = '#9aa5a0';
  const labelIdx = [0, Math.floor((withScore.length - 1) / 2), withScore.length - 1];
  [...new Set(labelIdx)].forEach((i) => {
    ctx.fillText(fmtDate(withScore[i].date), xFor(i), cssH - 8);
  });

  // 各メンバーの折れ線
  state.members.forEach((m, mi) => {
    ctx.strokeStyle = MEMBER_HEX[mi % 4];
    ctx.fillStyle = MEMBER_HEX[mi % 4];
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    withScore.forEach((r, i) => {
      const s = num(r.players[m].score);
      if (s <= 0) return;
      const x = xFor(i), y = yFor(s);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    withScore.forEach((r, i) => {
      const s = num(r.players[m].score);
      if (s <= 0) return;
      ctx.beginPath();
      ctx.arc(xFor(i), yFor(s), 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

function renderRoundList(rounds) {
  const list = $('#round-list');
  $('#round-count').textContent = `${rounds.length} ラウンド`;
  list.innerHTML = '';
  const desc = rounds.slice().reverse();
  if (desc.length === 0) {
    list.innerHTML = '<div class="empty">まだラウンドがありません。<br>右下の＋から追加してください。</div>';
    return;
  }
  desc.forEach((r) => {
    const li = document.createElement('li');
    li.className = 'round-item';
    const settle = roundHasSettlement(r);
    const scoresHtml = state.members
      .map((m) => `<div class="s">${m}<b>${num(r.players[m].score) || '-'}</b></div>`)
      .join('');
    li.innerHTML = `
      <div class="r-main">
        <div class="r-date">${fmtDate(r.date)}${settle ? '<span class="badge">精算あり</span>' : ''}</div>
        <div class="r-course">${r.course || 'コース未設定'}</div>
      </div>
      <div class="r-scores">${scoresHtml}</div>`;
    li.addEventListener('click', () => openDetail(r.id));
    list.appendChild(li);
  });
}

/* ---------- 詳細画面 ---------- */
function openDetail(id) {
  const round = state.rounds.find((r) => r.id === id);
  if (!round) return;
  const c = computeSettlement(round);
  const members = state.members;
  const hasSettle = roundHasSettlement(round);

  const scoreRows = members
    .map((m) => {
      const pl = round.players[m];
      return `<tr>
        <td>${m}</td>
        <td>${num(pl.score) || '-'}</td>
        <td>${pl.prev != null && pl.prev !== '' ? pl.prev : '-'}</td>
        <td>${c.result[m].net >= 0 ? '+' : ''}${c.result[m].net || 0}</td>
        <td>${hasSettle ? c.result[m].rank + '位' : '-'}</td>
      </tr>`;
    })
    .join('');

  let settleHtml = '';
  if (hasSettle) {
    const cards = members
      .map((m) => {
        const rr = c.result[m];
        return `<div class="settle-card">
          <div class="sc-top">
            <div class="sc-name">${m}<span class="rank-pill">${rr.rank}位</span></div>
            <div class="sc-total ${signClass(rr.total)}">${fmtYen(rr.total)}円</div>
          </div>
          <div class="sc-rows">
            <span class="k">オリンピックスコア</span><span class="v">${rr.olympic || 0}</span>
            <span class="k">オリンピック精算</span><span class="v ${signClass(rr.olympicSettle)}">${fmtYen(rr.olympicSettle)}</span>
            <span class="k">経費</span><span class="v">${Math.round(rr.expense).toLocaleString('ja-JP')}</span>
            <span class="k">順位割（負担）</span><span class="v">${Math.round(rr.share).toLocaleString('ja-JP')}</span>
            <span class="k">経費精算</span><span class="v ${signClass(rr.expenseSettle)}">${fmtYen(rr.expenseSettle)}</span>
          </div>
        </div>`;
      })
      .join('');
    settleHtml = `
      <div class="section-title">精算結果（オリンピック精算込）</div>
      <div class="settle-cards">${cards}</div>
      <div class="hint">レート ${c.rate}円 / 経費合計 ${Math.round(c.totalExpense).toLocaleString('ja-JP')}円 ・ オリンピック精算と経費精算の合計は 0 円になります。</div>`;
  }

  $('#view-detail').innerHTML = `
    <div class="back-bar"><button id="d-back">‹ 一覧へ戻る</button></div>
    <div class="detail-head">
      <div class="d-date">${fmtDate(round.date)}</div>
      <div class="d-course">${round.course || 'コース未設定'}</div>
    </div>
    <div class="section-title">スコア</div>
    <div class="result-wrap">
      <table class="result-table">
        <thead><tr><th>メンバー</th><th>今回</th><th>前回</th><th>差</th><th>ハンデ順位</th></tr></thead>
        <tbody>${scoreRows}</tbody>
      </table>
    </div>
    ${settleHtml}
    <div class="btn-row" style="margin-top:18px;">
      <button class="btn btn-secondary" id="d-edit">編集</button>
      <button class="btn btn-danger" id="d-delete">削除</button>
    </div>`;

  $('#d-back').addEventListener('click', () => showView('list'));
  $('#d-edit').addEventListener('click', () => openEdit(round.id));
  $('#d-delete').addEventListener('click', () => {
    if (confirm('このラウンドを削除しますか？')) {
      state.rounds = state.rounds.filter((r) => r.id !== round.id);
      saveState();
      renderList();
      showView('list');
      toast('削除しました');
    }
  });

  showView('detail');
}

/* ---------- 入力画面 ---------- */
function openEdit(id) {
  const isNew = !id;
  const rounds = sortedRounds();
  let round;
  if (isNew) {
    round = {
      id: uid(),
      date: new Date().toISOString().slice(0, 10),
      course: '',
      rate: state.defaultRate || DEFAULT_RATE,
      players: {},
    };
    // 前回スコアを直近ラウンドから自動補完
    const last = rounds[rounds.length - 1];
    state.members.forEach((m) => {
      round.players[m] = {
        score: '',
        prev: last ? num(last.players[m] && last.players[m].score) || '' : '',
        olympic: '',
        expense: '',
      };
    });
  } else {
    round = JSON.parse(JSON.stringify(state.rounds.find((r) => r.id === id)));
  }

  const courseList = [...new Set(state.rounds.map((r) => r.course).filter(Boolean))];
  const val = (v) => (v == null || v === '' ? '' : v);

  const playerRows = state.members
    .map(
      (m) => `<tr>
        <td>${m}</td>
        <td><input type="number" inputmode="numeric" data-m="${m}" data-f="score" value="${val(round.players[m].score)}" /></td>
        <td><input type="number" inputmode="numeric" data-m="${m}" data-f="prev" value="${val(round.players[m].prev)}" /></td>
        <td><input type="number" inputmode="numeric" data-m="${m}" data-f="olympic" value="${val(round.players[m].olympic)}" /></td>
        <td><input type="number" inputmode="numeric" data-m="${m}" data-f="expense" value="${val(round.players[m].expense)}" /></td>
      </tr>`
    )
    .join('');

  $('#view-edit').innerHTML = `
    <div class="back-bar"><button id="e-back">‹ キャンセル</button></div>
    <div class="form-card">
      <div class="field">
        <label>日付</label>
        <input type="date" id="e-date" value="${round.date}" />
      </div>
      <div class="field">
        <label>コース名</label>
        <input type="text" id="e-course" list="course-list" value="${round.course || ''}" placeholder="例）大月ガーデンゴルフクラブ" />
        <datalist id="course-list">${courseList.map((c) => `<option value="${c}">`).join('')}</datalist>
      </div>
      <div class="field">
        <label>オリンピック レート（円）</label>
        <input type="number" inputmode="numeric" id="e-rate" value="${round.rate}" />
      </div>
    </div>
    <div class="section-title">スコア・精算入力</div>
    <div class="form-card">
      <div class="player-input-grid">
        <table class="pin">
          <thead><tr><th>メンバー</th><th>今回</th><th>前回</th><th>オリンピック</th><th>経費</th></tr></thead>
          <tbody>${playerRows}</tbody>
        </table>
      </div>
      <div class="hint">オリンピック・経費が未入力なら精算は計算されず、スコアのみ記録されます。前回スコアは直近ラウンドから自動入力されます。</div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="e-cancel">キャンセル</button>
      <button class="btn btn-primary" id="e-save">保存</button>
    </div>`;

  const back = () => (isNew ? showView('list') : openDetail(id));
  $('#e-back').addEventListener('click', back);
  $('#e-cancel').addEventListener('click', back);
  $('#e-save').addEventListener('click', () => {
    round.date = $('#e-date').value || new Date().toISOString().slice(0, 10);
    round.course = $('#e-course').value.trim();
    round.rate = num($('#e-rate').value) || DEFAULT_RATE;
    $$('#view-edit input[data-m]').forEach((inp) => {
      const m = inp.dataset.m;
      const f = inp.dataset.f;
      round.players[m][f] = inp.value === '' ? '' : num(inp.value);
    });

    if (isNew) {
      state.rounds.push(round);
    } else {
      const idx = state.rounds.findIndex((r) => r.id === id);
      state.rounds[idx] = round;
    }
    saveState();
    renderList();
    openDetail(round.id);
    toast('保存しました');
  });

  showView('edit');
}

/* ---------- 設定画面 ---------- */
function openSettings() {
  const memberInputs = state.members
    .map(
      (m, i) =>
        `<div class="field"><label>メンバー${i + 1}</label><input type="text" data-mi="${i}" value="${m}" /></div>`
    )
    .join('');

  $('#view-settings').innerHTML = `
    <div class="back-bar"><button id="s-back">‹ 一覧へ戻る</button></div>
    <div class="section-title">メンバー名</div>
    <div class="form-card">
      ${memberInputs}
      <div class="hint">名前を変更すると過去データにも反映されます（人数は固定）。</div>
    </div>
    <div class="section-title">既定のオリンピックレート</div>
    <div class="form-card">
      <div class="field"><input type="number" inputmode="numeric" id="s-rate" value="${state.defaultRate || DEFAULT_RATE}" /></div>
    </div>
    <div class="section-title">バックアップ / 引っ越し</div>
    <div class="form-card">
      <div class="btn-row"><button class="btn btn-secondary" id="s-backup">バックアップを保存</button></div>
      <div class="btn-row" style="margin-top:10px;"><button class="btn btn-secondary" id="s-restore">バックアップから復元</button></div>
      <input type="file" id="s-restore-file" accept="application/json,.json" style="display:none" />
      <div class="hint">別のURLや端末（PC↔iPhone）へデータを移すときに使います。移したい端末で「保存」→ 移す先で「復元」してください。</div>
    </div>
    <div class="section-title">データ</div>
    <div class="form-card">
      <div class="btn-row"><button class="btn btn-secondary" id="s-export">CSVエクスポート</button></div>
      <div class="btn-row" style="margin-top:10px;"><button class="btn btn-ghost" id="s-reset">初期データに戻す</button></div>
      <div class="hint">データはこの端末・このURLの中だけに保存されます。</div>
    </div>
    <div class="btn-row" style="margin-top:16px;">
      <button class="btn btn-primary" id="s-save">保存</button>
    </div>`;

  $('#s-back').addEventListener('click', () => showView('list'));
  $('#s-save').addEventListener('click', () => {
    const newNames = $$('#view-settings input[data-mi]').map((i) => i.value.trim() || 'メンバー');
    // 旧名 -> 新名 でプレイヤーキーを移行
    state.rounds.forEach((r) => {
      const np = {};
      state.members.forEach((old, i) => {
        np[newNames[i]] = r.players[old] || { score: '', prev: '', olympic: '', expense: '' };
      });
      r.players = np;
    });
    state.members = newNames;
    state.defaultRate = num($('#s-rate').value) || DEFAULT_RATE;
    saveState();
    renderList();
    showView('list');
    toast('設定を保存しました');
  });
  $('#s-export').addEventListener('click', exportCSV);
  $('#s-backup').addEventListener('click', exportBackup);
  $('#s-restore').addEventListener('click', () => $('#s-restore-file').click());
  $('#s-restore-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importBackup(file);
    e.target.value = '';
  });
  $('#s-reset').addEventListener('click', () => {
    if (confirm('すべてのデータを消して初期データ（Excel取り込み）に戻しますか？')) {
      state = buildSeedData();
      saveState();
      renderList();
      showView('list');
      toast('初期化しました');
    }
  });

  showView('settings');
}

/* ---------- バックアップ（JSON） ---------- */
function exportBackup() {
  const payload = { app: 'golf-score-app', version: 1, exportedAt: new Date().toISOString(), data: state };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `golf-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('バックアップを保存しました');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const data = parsed && parsed.data ? parsed.data : parsed;
      if (!data || !Array.isArray(data.rounds) || !Array.isArray(data.members)) {
        alert('このファイルはバックアップとして読み込めませんでした。');
        return;
      }
      const msg = `バックアップを読み込みます。\n現在のデータ（${state.rounds.length}ラウンド）は、ファイルの内容（${data.rounds.length}ラウンド）に置き換わります。よろしいですか？`;
      if (!confirm(msg)) return;
      state = {
        members: data.members,
        defaultRate: data.defaultRate || DEFAULT_RATE,
        rounds: data.rounds,
      };
      saveState();
      renderList();
      showView('list');
      toast('復元しました');
    } catch (err) {
      alert('ファイルの読み込みに失敗しました。');
    }
  };
  reader.readAsText(file);
}

/* ---------- CSV エクスポート ---------- */
function exportCSV() {
  const members = state.members;
  const header = ['日付', 'コース', 'レート'];
  members.forEach((m) => header.push(`${m}_今回`, `${m}_前回`, `${m}_オリンピック`, `${m}_経費`, `${m}_精算込`));
  const lines = [header.join(',')];

  sortedRounds().forEach((r) => {
    const c = computeSettlement(r);
    const row = [r.date, `"${(r.course || '').replace(/"/g, '""')}"`, r.rate];
    members.forEach((m) => {
      const pl = r.players[m];
      row.push(
        pl.score ?? '',
        pl.prev ?? '',
        pl.olympic ?? '',
        pl.expense ?? '',
        roundHasSettlement(r) ? Math.round(c.result[m].total) : ''
      );
    });
    lines.push(row.join(','));
  });

  const csv = '\uFEFF' + lines.join('\r\n'); // BOM 付きで Excel 文字化け防止
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `golf-scores-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('CSVを書き出しました');
}

/* ---------- トースト ---------- */
let toastTimer = null;
function toast(msg) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------- 起動 ---------- */
function init() {
  loadState();
  renderList();
  showView('list');

  $('#fab').addEventListener('click', () => openEdit(null));
  $('#btn-settings').addEventListener('click', openSettings);
  $('#range-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-range]');
    if (!btn) return;
    chartRange = btn.dataset.range;
    renderRangeTabs();
    renderStats(sortedRounds());
    renderChart(sortedRounds());
  });
  window.addEventListener('resize', () => {
    if (!$('#view-list').classList.contains('hidden')) renderChart(sortedRounds());
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
