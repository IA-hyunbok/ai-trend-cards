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
