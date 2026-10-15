// 두 페이지(index, calendar)가 같이 쓰는 도우미
const API = (window.API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
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

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch (e) {}
}

/* 콜드스타트 대응: 3초 안에 응답 없으면 안내 배너 */
async function wake() {
  const banner = setTimeout(() => ($("wake").hidden = false), 3000);
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

/* ---------- 화면 가이드(투어): 대상만 밝게 비추고 말풍선으로 하나씩 설명 ---------- */
const isMobile = () => matchMedia("(max-width: 900px)").matches;
let tourAll = [], tourKey = "", tourSteps = [], tourAt = 0, tourTab = null;

// steps: [{ sel, title, body, tab?, mobile?, before? }]
//   tab: 모바일(한 번에 한 패널)에서 먼저 열 패널, mobile: 모바일 전용 단계, before: 비추기 전에 할 일
// key: 첫 방문 여부를 기억할 localStorage 키(페이지마다 다르게)
function initTour(steps, key) {
  tourAll = steps;
  tourKey = key;
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
  addEventListener("scroll", placeTour, { passive: true }); // 부드러운 스크롤 중에도 따라간다
}
function startTourIfFirst() {
  let seen = false;
  try { seen = !!localStorage.getItem(tourKey); } catch (e) {}
  if (!seen) startTour();
}

function startTour() {
  tourSteps = tourAll.filter((s) => !s.mobile || isMobile());
  tourTab = document.querySelector(".tabs button[aria-current]")?.dataset.tab; // 끝나면 원래 탭으로
  tourAt = 0;
  $("tour").hidden = false;
  showTourStep();
  $("tour-next").focus();
}
function endTour() {
  $("tour").hidden = true;
  if (tourTab) showTab(tourTab);
  try { localStorage.setItem(tourKey, "1"); } catch (e) {}
}
function showTourStep() {
  const s = tourSteps[tourAt];
  if (isMobile() && s.tab) showTab(s.tab);
  Promise.resolve(s.before?.()).then(placeTour); // 날짜 선택처럼 그리는 데 시간이 걸리는 준비
  const target = document.querySelector(s.sel);
  target.scrollIntoView({ block: "center" });
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
