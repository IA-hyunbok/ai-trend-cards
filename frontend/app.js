// 화면 상태는 이 객체 하나. 렌더 함수는 state만 보고 그린다.
const API = (window.API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const state = { conversationId: null, messages: [], conversations: [], data: [], summary: null, editing: null, sending: false };
const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const n = Object.assign(document.createElement(tag), props); // textContent만 사용 → XSS 방지
  n.append(...children.filter((c) => c != null));
  return n;
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = body.detail;
    throw new Error(Array.isArray(d) ? d.map((x) => x.msg.replace(/^Value error, /, "")).join(", ") : d || `요청 실패 (${res.status})`);
  }
  return body;
}

let toastTimer;
function toast(msg, ok = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = ok ? "toast ok" : "toast";
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

/* ---------- 요약 ---------- */
async function loadSummary() {
  state.summary = await api("/api/data/summary");
  renderSummary();
}
function renderSummary() {
  const s = state.summary, box = $("summary");
  box.replaceChildren();
  const item = (label, value, cls) => box.append(el("div", {}, el("dt", { textContent: label }), el("dd", { textContent: value, className: cls || "" })));
  if (!s.metrics) return item("데이터", "없음 — 오른쪽에서 추가하세요");
  const m = s.metrics;
  const trendCls = s.trend.startsWith("상승") ? "trend-up" : s.trend.startsWith("하락") ? "trend-down" : "trend-flat";
  item("기간", s.period);
  item("개수", `${s.count}일`, "num");
  item("하루 평균 인기 글", `${m.average}개`, "num");
  item("최신", `${m.latest.date} · ${m.latest.value}개`);
  item("최근 추세", s.trend, trendCls);
}

/* ---------- 카드 ---------- */
async function loadCards() {
  const list = $("cards");
  try {
    const c = await api("/api/cards/latest");
    const blogs = c.blogs || [];
    $("cards-date").textContent = `${c.date} 발행 · HN ${c.source_day} 인기 글${blogs.length ? ` + 기술 블로그 ${blogs.length}편` : ""}`;
    list.replaceChildren(...c.items.map((it, i) => el("li", { className: "card" },
      el("a", { href: it.url, target: "_blank", rel: "noopener noreferrer", textContent: `${i + 1}. ${it.title_ko}` }),
      it.summary_ko ? el("p", { textContent: it.summary_ko }) : null,
      el("p", { className: "orig", textContent: it.title, title: it.title }),
      el("span", { className: "stats", textContent: `▲ ${it.points} · 댓글 ${it.comments ?? 0}` }),
    )), ...blogs.map((b) => el("li", { className: "card blog" },
      el("a", { href: b.url, target: "_blank", rel: "noopener noreferrer", textContent: b.title }),
      b.summary_ko ? el("p", { textContent: b.summary_ko }) : null,
      el("span", { className: "stats", textContent: `${b.blog} 기술 블로그 · ${b.published.slice(0, 10)}` }),
    )));
  } catch (e) {
    list.replaceChildren(el("li", { className: "empty", textContent: "아직 발행된 카드가 없어요. 매일 오전 8시에 올라옵니다." }));
  }
}

/* ---------- 채팅 ---------- */
const SUGGESTIONS = ["요즘 IT 쪽 분위기 어때?", "제일 뜨거웠던 날은 언제야?", "이번 달이랑 지난달 비교해줘"];

function renderMessages() {
  const box = $("messages");
  if (!state.messages.length) {
    box.replaceChildren(el("div", { className: "empty" },
      el("p", { textContent: "'일별 화제도 기록'(HN 인기 글 수)을 바탕으로 답해요." }),
      el("div", { className: "suggest" }, ...SUGGESTIONS.map((q) => el("button", { className: "btn", type: "button", textContent: q, onclick: () => send(q) }))),
    ));
    return;
  }
  box.replaceChildren(...state.messages.map((m) => el("div", { className: `msg ${m.role}${m.typing ? " typing" : ""}` },
    m.content,
    m.tools?.length ? el("span", { className: "tools", textContent: `🔧 ${m.tools.join(", ")} 조회` }) : null)));
  box.scrollTop = box.scrollHeight;
}

async function send(text) {
  text = text.trim();
  if (!text || state.sending) return;
  state.sending = true;
  const btn = $("chat-form").querySelector("button");
  btn.disabled = true;
  state.messages.push({ role: "user", content: text }, { role: "assistant", content: "생각 중", typing: true });
  renderMessages();
  try {
    const r = await api("/api/chat", { method: "POST", body: JSON.stringify({ message: text, conversation_id: state.conversationId }) });
    if (!state.conversationId) $("chat-title").textContent = text.slice(0, 30); // 서버 제목 규칙과 같다
    state.conversationId = r.conversation_id;
    state.messages.splice(-1, 1, { role: "assistant", content: r.reply, tools: r.tools_used });
    loadConversations();
  } catch (e) {
    state.messages.splice(-2, 2); // 실패한 턴은 서버에도 저장되지 않으므로 화면에서도 뺀다
    $("chat-input").value = text;
    toast(e.message);
  } finally {
    state.sending = false;
    btn.disabled = false;
    renderMessages();
  }
}

/* ---------- 대화 기록 ---------- */
async function loadConversations() {
  state.conversations = await api("/api/conversations");
  renderConversations();
}
function renderConversations() {
  const ul = $("conversations");
  if (!state.conversations.length) {
    ul.replaceChildren(el("li", { className: "empty", textContent: "대화를 시작하면 자동으로 저장돼요." }));
    return;
  }
  ul.replaceChildren(...state.conversations.map((c) => {
    const li = el("li", {},
      el("button", { className: "conv-open", type: "button", onclick: () => openConversation(c.id) },
        el("strong", { textContent: c.title }),
        el("span", { className: "meta", textContent: `${new Date(c.updated_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })} · ${c.message_count}개` })),
      el("button", { className: "conv-del", type: "button", textContent: "✕", ariaLabel: `${c.title} 삭제`, onclick: () => deleteConversation(c) }),
    );
    if (c.id === state.conversationId) li.setAttribute("aria-current", "true");
    return li;
  }));
}
async function openConversation(id) {
  try {
    const c = await api(`/api/conversations/${id}`);
    state.conversationId = c.id;
    state.messages = c.messages;
    $("chat-title").textContent = c.title;
    renderMessages();
    renderConversations();
    showTab("panel-chat");
  } catch (e) { toast(e.message); }
}
async function deleteConversation(c) {
  if (!confirm(`"${c.title}" 대화를 삭제할까요?`)) return;
  try {
    await api(`/api/conversations/${c.id}`, { method: "DELETE" });
    if (c.id === state.conversationId) newChat();
    await loadConversations();
  } catch (e) { toast(e.message); }
}
function newChat() {
  state.conversationId = null;
  state.messages = [];
  $("chat-title").textContent = "새 대화";
  renderMessages();
  renderConversations();
  showTab("panel-chat");
}

/* ---------- 데이터 관리 ---------- */
async function loadData() {
  state.data = await api("/api/data?limit=200");
  renderData();
}
function renderData(flashDate) {
  $("data-count").textContent = `${state.data.length}일치`;
  renderChart();
  const ul = $("data-list");
  if (!state.data.length) {
    ul.replaceChildren(el("li", { className: "empty", textContent: "데이터가 없어요. 위에서 추가하세요." }));
    return;
  }
  ul.replaceChildren(...state.data.map((d) => el("li", { className: d.date === flashDate ? "flash" : "" },
    el("span", { className: "num", textContent: d.date }),
    el("span", { className: "num", textContent: d.value }),
    el("span", { className: "memo", textContent: d.memo || "—", title: d.memo }),
    el("span", { className: "row-actions" },
      el("button", { type: "button", textContent: "수정", onclick: () => startEdit(d) }),
      el("button", { type: "button", className: "del", textContent: "삭제", onclick: () => deleteData(d) })),
  )));
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
  const defaultCap = '하루 인기 글 수 · <span class="legend-avg">7일 평균</span>';
  // 마우스·터치 위치에서 가장 가까운 날짜의 값을 캡션에 보여 준다
  svg.onpointermove = (e) => {
    const r = svg.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (rows.length - 1));
    const d = rows[Math.min(rows.length - 1, Math.max(0, i))];
    cursor.setAttribute("x1", x(rows.indexOf(d))); cursor.setAttribute("x2", x(rows.indexOf(d)));
    cursor.style.display = "";
    cap.textContent = `${d.date} · 인기 글 ${d.value}개 · 7일 평균 ${avg[rows.indexOf(d)].toFixed(1)}개`;
  };
  svg.onpointerleave = () => { cursor.style.display = "none"; cap.innerHTML = defaultCap; };
}

function download(name, text, type) {
  const a = el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
}
function exportCSV() {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`; // 헤드라인의 쉼표·따옴표 대비
  const rows = [...state.data].reverse().map((d) => [d.date, d.value, q(d.memo)].join(","));
  download("hn-trend.csv", "﻿" + ["date,value,memo", ...rows].join("\n"), "text/csv;charset=utf-8"); // BOM: 엑셀 한글
}
function exportJSON() {
  download("hn-trend.json", JSON.stringify([...state.data].reverse(), null, 2), "application/json");
}

function startEdit(d) {
  state.editing = d.date;
  $("f-date").value = d.date;
  $("f-date").disabled = true; // 문서 ID가 날짜라 날짜는 바꿀 수 없다
  $("f-value").value = d.value;
  $("f-memo").value = d.memo;
  $("data-submit").textContent = "수정 저장";
  $("data-cancel").hidden = false;
  $("f-value").focus();
}
function resetForm() {
  state.editing = null;
  $("data-form").reset();
  $("f-date").disabled = false;
  $("data-submit").textContent = "추가";
  $("data-cancel").hidden = true;
}
async function submitData(e) {
  e.preventDefault();
  const btn = $("data-submit");
  const body = { value: Number($("f-value").value), memo: $("f-memo").value };
  const date = state.editing || $("f-date").value;
  btn.disabled = true;
  try {
    if (state.editing) await api(`/api/data/${date}`, { method: "PUT", body: JSON.stringify(body) });
    else await api("/api/data", { method: "POST", body: JSON.stringify({ date, ...body }) });
    toast(state.editing ? `${date} 수정됨` : `${date} 추가됨`, true);
    resetForm();
    await Promise.all([loadData(), loadSummary()]);
    renderData(date);
  } catch (err) { toast(err.message); } finally { btn.disabled = false; }
}
async function deleteData(d) {
  if (!confirm(`${d.date} 데이터를 삭제할까요?`)) return;
  try {
    await api(`/api/data/${d.date}`, { method: "DELETE" });
    toast(`${d.date} 삭제됨`, true);
    await Promise.all([loadData(), loadSummary()]);
  } catch (e) { toast(e.message); }
}

/* ---------- 탭(모바일) · 테마 ---------- */
function showTab(id) {
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === id));
  document.querySelectorAll(".tabs button").forEach((b) =>
    b.dataset.tab === id ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch (e) {}
}

/* ---------- 화면 가이드(투어) ---------- */
// tab: 모바일(한 번에 한 패널)에서 먼저 열어야 하는 패널. mobile: 모바일에서만 보여 줄 단계
const TOUR = [
  { sel: "#summary", title: "요약 줄", body: "저장된 데이터 전체 요약입니다. 평균 화제도는 하루에 100점 넘은 HN 인기 글 수의 평균이고, 최근 추세는 최근 7일 평균을 그 전 28일 평균과 비교한 값입니다. AI 비서도 이 숫자를 보고 답합니다." },
  { sel: "#panel-cards", tab: "panel-cards", title: "오늘의 카드", body: "매일 오전 8시에 바뀌는 카드뉴스입니다. 주황 카드 5장은 어제 Hacker News 인기 글, 옆으로 넘기면 나오는 파랑 카드 3장은 국내 기술 블로그 새 글입니다. 제목을 누르면 원문이 열립니다. 디스코드에도 같은 내용이 올라갑니다." },
  { sel: "#panel-chat", tab: "panel-chat", title: "AI 비서", body: "저장된 데이터를 근거로 답하는 채팅입니다. \"8월 25일부터 27일까지 화제도\"처럼 요약에 없는 걸 물으면 AI가 데이터를 더 꺼내 보고, 답 아래에 🔧 표시가 붙습니다." },
  { sel: "#panel-history", tab: "panel-history", title: "대화 기록", body: "채팅은 답을 받는 순간 자동 저장됩니다. 항목을 누르면 그 대화를 불러와 이어서 물어볼 수 있고, ✕로 지웁니다." },
  { sel: "#data-list", tab: "panel-data", title: "일별 화제도 기록", body: "하루 한 줄씩 쌓이는 기록입니다. 예를 들어 \"2026-10-13 · 38 · Gemini 4 Argon\"은 10월 13일에 HN에서 100점 넘게 추천받은 글이 38개였고, 그날 1위 글이 \"Gemini 4 Argon\"이었다는 뜻입니다. 매일 아침 자동으로 추가되고, AI 비서가 이 기록을 보고 답합니다." },
  { sel: ".chart", tab: "panel-data", title: "기록 그래프", body: "위 기록의 숫자(하루 인기 글 수)를 선으로 그린 것입니다. 회색은 그날그날 값, 주황은 7일 평균입니다. 높을수록 그날 IT 업계가 시끌벅적했다는 뜻이고, 마우스를 올리면 날짜별 값이 나옵니다." },
  { sel: "#data-form", tab: "panel-data", title: "기록 직접 고치기", body: "기록은 자동으로 쌓이지만 손으로 한 줄을 추가할 수도 있습니다. 목록의 수정·삭제와 함께 쓰며, 바꾸면 요약·그래프·AI 답변에 바로 반영됩니다." },
  { sel: ".export", tab: "panel-data", title: "내보내기", body: "기록 전체를 CSV(엑셀용)나 JSON 파일로 내려받습니다." },
  { sel: ".tabs", mobile: true, title: "화면 전환 탭", body: "휴대폰에서는 한 번에 한 화면만 보입니다. 아래 탭으로 카드·채팅·데이터·기록을 오갑니다." },
  { sel: "#tour-btn", title: "가이드 다시 보기", body: "이 ? 버튼을 누르면 언제든 가이드를 다시 볼 수 있습니다. 옆의 ◐ 버튼은 다크 모드입니다." },
];
const isMobile = () => matchMedia("(max-width: 900px)").matches;
let tourSteps = [], tourAt = 0, tourTab = null;

function startTour() {
  tourSteps = TOUR.filter((s) => !s.mobile || isMobile());
  tourTab = document.querySelector(".tabs button[aria-current]")?.dataset.tab; // 끝나면 원래 탭으로
  tourAt = 0;
  $("tour").hidden = false;
  showTourStep();
  $("tour-next").focus();
}
function endTour() {
  $("tour").hidden = true;
  if (tourTab) showTab(tourTab);
  try { localStorage.setItem("tour-done", "1"); } catch (e) {}
}
function showTourStep() {
  const s = tourSteps[tourAt];
  if (isMobile() && s.tab) showTab(s.tab);
  const target = document.querySelector(s.sel);
  target.scrollIntoView({ block: "nearest" });
  $("tour-step").textContent = `${tourAt + 1} / ${tourSteps.length}`;
  $("tour-title").textContent = s.title;
  $("tour-body").textContent = s.body;
  $("tour-prev").disabled = tourAt === 0;
  $("tour-next").textContent = tourAt === tourSteps.length - 1 ? "완료" : "다음";
  placeTour();
}
function placeTour() {
  if ($("tour").hidden) return;
  const r = document.querySelector(tourSteps[tourAt].sel).getBoundingClientRect();
  const pad = 6, gap = 12, vw = innerWidth, vh = innerHeight;
  Object.assign($("tour").querySelector(".tour-spot").style, {
    left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
  });
  // 말풍선: 아래 → 위 → 오른쪽 → 왼쪽 순으로 들어갈 자리를 찾고, 없으면 화면 아래쪽에 띄운다
  const tip = $("tour").querySelector(".tour-tip"), w = tip.offsetWidth, h = tip.offsetHeight;
  const clampX = (x) => Math.min(Math.max(16, x), vw - w - 16);
  const clampY = (y) => Math.min(Math.max(16, y), vh - h - 16);
  let x, y;
  if (r.bottom + pad + gap + h < vh) [x, y] = [clampX(r.left), r.bottom + pad + gap];
  else if (r.top - pad - gap - h > 0) [x, y] = [clampX(r.left), r.top - pad - gap - h];
  else if (r.right + pad + gap + w < vw) [x, y] = [r.right + pad + gap, clampY(r.top)];
  else if (r.left - pad - gap - w > 0) [x, y] = [r.left - pad - gap - w, clampY(r.top)];
  else [x, y] = [clampX((vw - w) / 2), vh - h - 16];
  Object.assign(tip.style, { left: `${x}px`, top: `${y}px` });
}
function moveTour(d) {
  const n = tourAt + d;
  if (n < 0) return;
  if (n >= tourSteps.length) return endTour();
  tourAt = n;
  showTourStep();
}

/* ---------- 시작: 콜드스타트 대응 ---------- */
async function wake() {
  const banner = setTimeout(() => ($("wake").hidden = false), 3000); // 3초 안에 응답 없으면 안내
  for (let i = 0; i < 6; i++) {
    try {
      await api("/health");
      clearTimeout(banner);
      $("wake").hidden = true;
      return true;
    } catch (e) { await new Promise((r) => setTimeout(r, 5000)); }
  }
  clearTimeout(banner);
  $("wake").textContent = "서버에 연결하지 못했어요. 잠시 후 새로고침해 주세요.";
  return false;
}

async function init() {
  $("theme").onclick = toggleTheme;
  $("new-chat").onclick = newChat;
  $("data-form").onsubmit = submitData;
  $("data-cancel").onclick = resetForm;
  $("tour-btn").onclick = startTour;
  $("tour-next").onclick = () => moveTour(1);
  $("tour-prev").onclick = () => moveTour(-1);
  $("tour-skip").onclick = endTour;
  document.addEventListener("keydown", (e) => {
    if ($("tour").hidden) return;
    if (e.key === "Escape") endTour();
    if (e.key === "ArrowRight") moveTour(1);
    if (e.key === "ArrowLeft") moveTour(-1);
  });
  addEventListener("resize", placeTour);
  $("export-csv").onclick = exportCSV;
  $("export-json").onclick = exportJSON;
  $("f-date").max = new Date().toISOString().slice(0, 10);
  $("chat-form").onsubmit = (e) => { e.preventDefault(); const v = $("chat-input").value; $("chat-input").value = ""; send(v); };
  $("chat-input").onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("chat-form").requestSubmit(); }
  };
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  showTab("panel-chat");
  renderMessages();

  if (!(await wake())) return;
  await Promise.allSettled([loadSummary(), loadCards(), loadConversations(), loadData()]).then((rs) => {
    const failed = rs.find((r) => r.status === "rejected");
    if (failed) toast(failed.reason.message);
  });
  // 첫 방문이면 데이터가 다 그려진 뒤 가이드를 띄운다
  let seen = false;
  try { seen = !!localStorage.getItem("tour-done"); } catch (e) {}
  if (!seen) startTour();
}

init();
