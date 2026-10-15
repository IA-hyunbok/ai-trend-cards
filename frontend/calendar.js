// 트렌드 캘린더: data 컬렉션(date, value, memo)을 달력으로 보여 주고, 날짜를 눌러 CRUD
const state = { data: [], byDate: {}, month: null, editing: null, selected: null, cards: {} }; // cards: 날짜 → 카드(미리 받아 둔 것) // month = "YYYY-MM"
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = iso(new Date());

async function loadData() {
  state.data = await api("/api/data?limit=1000"); // 날짜 내림차순
  state.byDate = Object.fromEntries(state.data.map((d) => [d.date, d]));
  renderChart();
  renderCal();
}

/* ---------- 달력 ---------- */
function monthRange() {
  const first = state.data.at(-1)?.date.slice(0, 7) || today.slice(0, 7);
  return [first, today.slice(0, 7)];
}
function moveMonth(d) {
  const [y, m] = state.month.split("-").map(Number);
  const next = iso(new Date(y, m - 1 + d, 1)).slice(0, 7);
  const [min, max] = monthRange();
  if (next < min || next > max) return;
  state.month = next;
  renderCal();
  prefetchMonth();
}
// 달을 열면 그 달 카드를 한 번에 받아 둔다 → 날짜를 누를 때 서버를 기다리지 않는다
async function prefetchMonth() {
  const [y, m] = state.month.split("-").map(Number);
  const end = `${state.month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  try { Object.assign(state.cards, await api(`/api/cards/days?start=${state.month}-01&end=${end}`)); } catch (e) {}
}
function renderCal() {
  const [y, m] = state.month.split("-").map(Number);
  const [min, max] = monthRange();
  $("month").textContent = `${y}년 ${m}월`;
  $("prev").disabled = state.month <= min;
  $("next").disabled = state.month >= max;

  const vals = state.data.map((d) => d.value), lo = Math.min(...vals), hi = Math.max(...vals); // 전체 기간 최저~최고로 색 진하기
  const lead = new Date(y, m - 1, 1).getDay(), days = new Date(y, m, 0).getDate();
  const cells = Array.from({ length: lead }, () => el("li", { className: "blank", ariaHidden: "true" }));
  for (let day = 1; day <= days; day++) {
    const date = `${state.month}-${String(day).padStart(2, "0")}`, d = state.byDate[date];
    const future = date > today;
    const btn = el("button", { type: "button", className: "cal-cell", disabled: future, onclick: () => (d ? selectDay(date) : openDay(date)) },
      el("span", { className: "cal-day num", textContent: day }),
      d ? el("span", { className: "cal-value num", textContent: `${d.value}개` }) : null,
      el("span", { className: "cal-memo", textContent: d ? d.memo || "(한 줄 없음)" : future ? "" : "기록 없음 · 눌러서 추가" }));
    btn.setAttribute("aria-label", d ? `${date} 인기 글 ${d.value}개. ${d.memo}` : `${date} 기록 없음`);
    if (d) btn.style.setProperty("--heat", ((d.value - lo) / (hi - lo || 1)).toFixed(2));
    if (date === state.selected) btn.setAttribute("aria-pressed", "true");
    cells.push(el("li", { className: d ? "has" : "none" }, btn));
  }
  $("cal").replaceChildren(...cells);
}

/* ---------- 선택한 날짜: 트렌드 한 줄 + 그날 인기 글 카드(3열) ---------- */
async function selectDay(date) {
  const d = state.byDate[date];
  state.selected = d ? date : null;
  renderCal();
  const panel = $("day-panel");
  panel.hidden = !d;
  if (!d) return;
  $("day-h").textContent = `${date} 트렌드`;
  $("day-value").textContent = `인기 글 ${d.value}개`;
  $("day-memo").textContent = d.memo || "(한 줄 없음)";
  const list = $("day-cards");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  if (!state.cards[date]) list.replaceChildren(...Array.from({ length: 6 }, () => el("li", { className: "card skeleton-card" })));
  try {
    const items = state.cards[date] || (state.cards[date] = await api(`/api/cards/day/${date}`));
    if (state.selected !== date) return; // 기다리는 사이 다른 날짜를 눌렀다
    list.replaceChildren(...(items.length ? items.map((it, i) => el("li", { className: "card" },
      el("a", { href: it.url, target: "_blank", rel: "noopener noreferrer", textContent: `${i + 1}. ${it.title_ko}` }),
      it.summary_ko ? el("p", { textContent: it.summary_ko }) : null,
      el("p", { className: "orig", textContent: it.title, title: it.title }),
      el("span", { className: "stats", textContent: `▲ ${it.points} · 댓글 ${it.comments ?? 0}` }),
    )) : [el("li", { className: "empty", textContent: "이 날짜에는 100점 넘은 글이 없어요." })]));
  } catch (e) {
    if (state.selected === date) list.replaceChildren(el("li", { className: "empty", textContent: e.message }));
  }
}

/* ---------- 날짜 상세(추가·수정·삭제) ---------- */
function openDay(date) {
  const d = date && state.byDate[date];
  state.editing = d ? date : null;
  $("day-title").textContent = d ? `${date} 트렌드` : "기록 추가";
  $("day-date-field").hidden = !!d; // 문서 ID가 날짜라 수정 때는 날짜를 바꿀 수 없다
  $("f-date").value = date || "";
  $("f-date").required = !d;
  $("f-memo").value = d?.memo || "";
  $("f-value").value = d ? d.value : "";
  $("day-top").textContent = d?.top ? `그날 1위 글: ${d.top}` : "";
  $("day-del").hidden = !d;
  $("day").showModal();
  (d || date ? $("f-memo") : $("f-date")).focus();
}
async function saveDay(e) {
  e.preventDefault();
  const body = { value: Number($("f-value").value), memo: $("f-memo").value };
  const date = state.editing || $("f-date").value;
  $("day-save").disabled = true;
  try {
    if (state.editing) await api(`/api/data/${date}`, { method: "PUT", body: JSON.stringify(body) });
    else await api("/api/data", { method: "POST", body: JSON.stringify({ date, ...body }) });
    toast(state.editing ? `${date} 수정됨` : `${date} 추가됨`, true);
    $("day").close();
    state.month = date.slice(0, 7); // 추가한 달로 이동해 반영을 보여 준다
    await loadData();
    selectDay(date);
  } catch (err) { toast(err.message); } finally { $("day-save").disabled = false; }
}
async function deleteDay() {
  const date = state.editing;
  if (!confirm(`${date} 기록을 삭제할까요?`)) return;
  try {
    await api(`/api/data/${date}`, { method: "DELETE" });
    toast(`${date} 삭제됨`, true);
    $("day").close();
    await loadData();
    selectDay(date); // 기록이 없어졌으니 패널을 닫는다
  } catch (e) { toast(e.message); }
}

/* ---------- 그래프(SVG) · 내보내기 ---------- */
const SVG_NS = "http://www.w3.org/2000/svg";
function renderChart() {
  const svg = $("chart"), cap = $("chart-cap");
  const rows = [...state.data].reverse(); // 날짜 오름차순
  svg.replaceChildren();
  if (rows.length < 2) return;
  const W = 320, H = 100, vals = rows.map((r) => r.value);
  const max = Math.max(...vals), min = Math.min(...vals);
  const x = (i) => (i / (rows.length - 1)) * W;
  const y = (v) => H - ((v - min) / (max - min || 1)) * H;
  const avg = vals.map((_, i) => { const w = vals.slice(Math.max(0, i - 6), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; });
  const line = (arr, cls) => {
    const p = document.createElementNS(SVG_NS, "polyline");
    p.setAttribute("points", arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" "));
    p.setAttribute("class", cls);
    return p;
  };
  const cursor = document.createElementNS(SVG_NS, "line");
  cursor.setAttribute("class", "cursor");
  cursor.setAttribute("y1", 0); cursor.setAttribute("y2", H);
  cursor.style.display = "none";
  svg.append(line(vals, "daily"), line(avg, "avg"), cursor);
  const defaultCap = '전체 기간 하루 인기 글 수 · <span class="legend-avg">7일 평균</span>';
  // 마우스·터치 위치에서 가장 가까운 날짜의 값과 트렌드를 캡션에 보여 준다
  svg.onpointermove = (e) => {
    const r = svg.getBoundingClientRect();
    const i = Math.min(rows.length - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (rows.length - 1))));
    cursor.setAttribute("x1", x(i)); cursor.setAttribute("x2", x(i));
    cursor.style.display = "";
    cap.textContent = `${rows[i].date} · ${rows[i].value}개 · ${rows[i].memo}`;
  };
  svg.onpointerleave = () => { cursor.style.display = "none"; cap.innerHTML = defaultCap; };
  svg.onclick = () => { // 그래프에서 고른 날짜의 달로 이동
    const d = cap.textContent.slice(0, 10);
    if (state.byDate[d]) { state.month = d.slice(0, 7); prefetchMonth(); selectDay(d); }
  };
}

function download(name, text, type) {
  const a = el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
}
function exportCSV() {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`; // 쉼표·따옴표 대비
  const rows = [...state.data].reverse().map((d) => [d.date, d.value, q(d.memo), q(d.top)].join(","));
  download("hn-trend.csv", "﻿" + ["date,value,memo,top", ...rows].join("\n"), "text/csv;charset=utf-8"); // BOM: 엑셀 한글
}
function exportJSON() {
  download("hn-trend.json", JSON.stringify([...state.data].reverse(), null, 2), "application/json");
}

/* ---------- 화면 가이드(투어). 엔진은 common.js ---------- */
// 보고 있는 달의 가장 최근 기록을 골라 아래 카드 영역을 열어 둔다(카드 단계 시연용)
function selectForTour() {
  if (state.selected) return;
  const d = state.data.find((x) => x.date.startsWith(state.month)) || state.data[0];
  if (!d) return;
  state.month = d.date.slice(0, 7);
  return selectDay(d.date);
}
const TOUR = [
  { sel: ".month-nav", title: "달 이동", body: "‹ › 로 달을 넘깁니다. 기록은 2026년 6월부터 있고, 매일 아침 8시에 이틀 전 날짜가 한 칸씩 채워집니다(HN 점수가 다 쌓인 뒤에 확정하기 때문)." },
  { sel: ".cal-grid .has", title: "칸 읽는 법", body: "맨 위 숫자는 날짜, 주황 숫자는 그날 Hacker News에서 100점 넘게 추천받은 글 수입니다. 많을수록 칸 색이 진합니다. 아래 문장은 그날 인기 글 상위 10개 제목을 보고 AI가 정의한 '그날의 트렌드 한 줄'입니다. 점선 칸은 기록이 없는 날로, 누르면 직접 추가할 수 있습니다." },
  { sel: ".chart", title: "전체 기간 그래프", body: "모든 날의 인기 글 수를 선으로 그렸습니다. 회색은 그날그날 값, 주황은 7일 평균입니다. 마우스를 올리면 날짜별 값과 트렌드가 나오고, 누르면 그 날짜로 이동합니다." },
  { sel: "#day-memo", before: selectForTour, title: "날짜를 누르면", body: "그날의 트렌드 한 줄이 크게 나오고, 오른쪽 위에 그날 인기 글 수가 표시됩니다." },
  { sel: "#day-cards li", before: selectForTour, title: "그날의 인기 글 카드", body: "그날 추천을 가장 많이 받은 HN 글 6개를 한국어 제목과 2~3문장 요약으로 정리한 카드입니다. 제목을 누르면 원문이 열리고, ▲는 추천 수입니다." },
  { sel: ".day-panel .export", before: selectForTour, title: "고치기·지우기", body: "트렌드 한 줄이나 인기 글 수를 직접 고치거나 그날 기록을 지웁니다. 바꾸면 메인 화면의 요약과 AI 비서의 답에 바로 반영됩니다." },
  { sel: ".panel-head .export", title: "내보내기·기록 추가", body: "CSV(엑셀용)·JSON으로 전체 기록을 내려받고, + 기록 추가로 빈 날짜에 직접 한 줄을 넣습니다." },
  { sel: "#tour-btn", title: "가이드 다시 보기", body: "이 ? 버튼으로 언제든 다시 볼 수 있습니다. ← AI 비서는 채팅 화면으로, ◐는 다크 모드입니다." },
];

async function init() {
  $("theme").onclick = toggleTheme;
  initTour(TOUR, "tour-done-cal");
  $("prev").onclick = () => moveMonth(-1);
  $("next").onclick = () => moveMonth(1);
  $("add").onclick = () => openDay(null);
  $("day-form").onsubmit = saveDay;
  $("day-cancel").onclick = () => $("day").close();
  $("day-del").onclick = deleteDay;
  $("day-edit").onclick = () => openDay(state.selected);
  $("day-remove").onclick = () => { state.editing = state.selected; deleteDay(); };
  $("export-csv").onclick = exportCSV;
  $("export-json").onclick = exportJSON;
  $("f-date").max = today;
  state.month = today.slice(0, 7);
  if (!(await wake())) return;
  try { await Promise.all([loadData(), prefetchMonth()]); } catch (e) { return toast(e.message); }
  startTourIfFirst(); // 첫 방문이면 달력이 그려진 뒤
}

init();
