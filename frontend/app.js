// 화면 상태는 이 객체 하나. 렌더 함수는 state만 보고 그린다.
const state = { conversationId: null, messages: [], conversations: [], summary: null, sending: false };

/* ---------- 요약 ---------- */
async function loadSummary() {
  state.summary = await api("/api/data/summary");
  renderSummary();
}
function renderSummary() {
  const s = state.summary, box = $("summary");
  box.replaceChildren();
  const item = (label, value, cls) => box.append(el("div", {}, el("dt", { textContent: label }), el("dd", { textContent: value, className: cls || "" })));
  if (!s.metrics) return item("데이터", "없음 — 캘린더에서 추가하세요");
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
      el("p", { textContent: "트렌드 캘린더(날짜별 HN 인기 글 수와 그날의 트렌드)를 바탕으로 답해요." }),
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

/* ---------- 탭(모바일) ---------- */
function showTab(id) {
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === id));
  document.querySelectorAll(".tabs button").forEach((b) =>
    b.dataset.tab === id ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
}
/* ---------- 화면 가이드(투어) ---------- */
// 단계 형식은 common.js의 initTour 참고
const TOUR = [
  { sel: "#summary", title: "요약 줄", body: "저장된 데이터 전체 요약입니다. 평균 화제도는 하루에 100점 넘은 HN 인기 글 수의 평균이고, 최근 추세는 최근 7일 평균을 그 전 28일 평균과 비교한 값입니다. AI 비서도 이 숫자를 보고 답합니다." },
  { sel: "#panel-cards", tab: "panel-cards", title: "오늘의 카드", body: "매일 오전 8시에 바뀌는 카드뉴스입니다. 주황 카드 5장은 어제 Hacker News 인기 글, 옆으로 넘기면 나오는 파랑 카드 3장은 국내 기술 블로그 새 글입니다. 제목을 누르면 원문이 열립니다. 디스코드에도 같은 내용이 올라갑니다." },
  { sel: "#panel-chat", tab: "panel-chat", title: "AI 비서", body: "저장된 데이터를 근거로 답하는 채팅입니다. \"8월 25일부터 27일까지 화제도\"처럼 요약에 없는 걸 물으면 AI가 데이터를 더 꺼내 보고, 답 아래에 🔧 표시가 붙습니다." },
  { sel: "#panel-history", tab: "panel-history", title: "대화 기록", body: "채팅은 답을 받는 순간 자동 저장됩니다. 항목을 누르면 그 대화를 불러와 이어서 물어볼 수 있고, ✕로 지웁니다." },
  { sel: "#cal-link", title: "트렌드 캘린더", body: "날짜별로 그날 HN 인기 글이 몇 개였는지(색이 진할수록 많음)와 AI가 정의한 그날의 트렌드 한 줄을 달력으로 봅니다. 날짜를 눌러 한 줄을 고치거나 지울 수 있고, AI 비서가 이 기록을 보고 답합니다." },
  { sel: ".tabs", mobile: true, title: "화면 전환 탭", body: "휴대폰에서는 한 번에 한 화면만 보입니다. 아래 탭으로 카드·채팅·기록을 오가고, 캘린더는 위의 캘린더 버튼으로 엽니다." },
  { sel: "#tour-btn", title: "가이드 다시 보기", body: "이 ? 버튼을 누르면 언제든 가이드를 다시 볼 수 있습니다. 옆의 ◐ 버튼은 다크 모드입니다." },
];
async function init() {
  $("theme").onclick = toggleTheme;
  $("new-chat").onclick = newChat;
  initTour(TOUR, "tour-done");
  $("chat-form").onsubmit = (e) => { e.preventDefault(); const v = $("chat-input").value; $("chat-input").value = ""; send(v); };
  $("chat-input").onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("chat-form").requestSubmit(); }
  };
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  showTab("panel-chat");
  renderMessages();

  if (!(await wake())) return;
  await Promise.allSettled([loadSummary(), loadCards(), loadConversations()]).then((rs) => {
    const failed = rs.find((r) => r.status === "rejected");
    if (failed) toast(failed.reason.message);
  });
  startTourIfFirst(); // 데이터가 다 그려진 뒤
}

init();
