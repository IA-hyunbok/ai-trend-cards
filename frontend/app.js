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
  item("평균 화제도", `${m.average}건`, "num");
  item("최신", `${m.latest.date} · ${m.latest.value}건`);
  item("최근 추세", s.trend, trendCls);
}

/* ---------- 카드 ---------- */
async function loadCards() {
  const list = $("cards");
  try {
    const c = await api("/api/cards/latest");
    $("cards-date").textContent = `${c.date} 발행 · HN ${c.source_day} 인기 글`;
    list.replaceChildren(...c.items.map((it, i) => el("li", { className: "card" },
      el("a", { href: it.url, target: "_blank", rel: "noopener noreferrer", textContent: `${i + 1}. ${it.title_ko}` }),
      it.summary_ko ? el("p", { textContent: it.summary_ko }) : null,
      el("p", { className: "orig", textContent: it.title, title: it.title }),
      el("span", { className: "stats", textContent: `▲ ${it.points} · 댓글 ${it.comments ?? 0}` }),
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
      el("p", { textContent: "저장된 HN 화제도 데이터를 바탕으로 답해요." }),
      el("div", { className: "suggest" }, ...SUGGESTIONS.map((q) => el("button", { className: "btn", type: "button", textContent: q, onclick: () => send(q) }))),
    ));
    return;
  }
  box.replaceChildren(...state.messages.map((m) => el("div", { className: `msg ${m.role}${m.typing ? " typing" : ""}`, textContent: m.content })));
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
    state.messages.splice(-1, 1, { role: "assistant", content: r.reply });
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
  $("data-count").textContent = `최근 ${state.data.length}건`;
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
}

init();
