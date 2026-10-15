// 트렌드 캘린더: data 컬렉션(date, value, memo)을 달력으로 보여 주고, 날짜를 눌러 CRUD
const state = { data: [], byDate: {}, month: null, editing: null, selected: null }; // month = "YYYY-MM"
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
  list.replaceChildren(...Array.from({ length: 6 }, () => el("li", { className: "card skeleton-card" })));
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const items = await api(`/api/cards/day/${date}`);
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
    if (state.byDate[d]) { state.month = d.slice(0, 7); selectDay(d); }
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

async function init() {
  $("theme").onclick = toggleTheme;
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
  try { await loadData(); } catch (e) { toast(e.message); }
}

init();
