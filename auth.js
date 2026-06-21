// ========================================
// 認証・ロール管理
// ========================================
// パスワードの確認は認証API(Vercel)に任せる（このファイルは秘密情報を持たない）。
// ログイン情報(パスワード除く)は sessionStorage に保存（タブを閉じれば消える）。
// 将来課題: HttpOnly Cookie 等でのセッション管理、画面アクセスのサーバー側検証。
// ========================================

const AUTH_SESSION_KEY  = "buyimono_auth";
const ASSIGNED_REGION_KEY = "buyimono_assigned_region";  // ログイン後に選んだ「今日の担当地区」

const ROLE_LABELS = {
    customer:     "お客様",
    meito:        "メートくん",
    headquarters: "本部"
};

function getAuth() {
    try {
        const v = sessionStorage.getItem(AUTH_SESSION_KEY);
        return v ? JSON.parse(v) : null;
    } catch { return null; }
}

function setAuth(user) {
    if (!user) {
        sessionStorage.removeItem(AUTH_SESSION_KEY);
        sessionStorage.removeItem(ASSIGNED_REGION_KEY);
        return;
    }
    // パスワードはセッションに保存しない（PoC でも念のため）
    const safe = {
        id: user.id,
        role: user.role,
        name: user.name,
        regions: user.regions || []
    };
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(safe));
}

function isLoggedIn() { return getAuth() !== null; }

function getRole() {
    const a = getAuth();
    return a ? a.role : "customer";   // 未ログインはお客様扱い
}

function setAssignedRegion(regionId) {
    sessionStorage.setItem(ASSIGNED_REGION_KEY, regionId);
    // 現在地区も同期（cart/orders/price がこの地区になる）
    if (typeof setCurrentRegion === "function") setCurrentRegion(regionId);
}

function getAssignedRegion() {
    return sessionStorage.getItem(ASSIGNED_REGION_KEY);
}

function logout() {
    setAuth(null);
    sessionStorage.removeItem(ASSIGNED_REGION_KEY);
    location.href = "login.html";
}

// 認証APIの場所。
//   ・ローカル(自分のPC)でテストするとき … http://localhost:3000/api/login
//   ・本番(GitHub Pages)で動かすとき     … VercelのURL（フェーズ2で本物に差し替える）
// location.hostname を見て自動で切り替える（同じコードのまま両方で動く）。
const AUTH_API_URL =
    (location.hostname === "localhost" || location.hostname === "127.0.0.1")
        ? "http://localhost:3000/api/login"
        : "https://kaimono-api.vercel.app/api/login"; // ★フェーズ2で本物のURLに変更する

// 認証APIに問い合わせてログインを試行する。
// パスワードの判定はすべてサーバー(Vercel)側。このファイル(公開側)は秘密情報を持たない。
async function attemptLogin(id, password) {
    try {
        const res = await fetch(AUTH_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, password })
        });
        // サーバーの返事は {ok:true, user:{...}} か {ok:false, message:"..."}。
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
            return { ok: false, message: json.message || "ID または パスワードが違います。" };
        }
        setAuth(json.user);
        return { ok: true, user: json.user };
    } catch (err) {
        console.error("ログイン失敗:", err);
        return { ok: false, message: "サーバーに接続できませんでした。時間をおいて試してください。" };
    }
}

// ========================================
// 画面アクセス制御
// ========================================
// 各ページの先頭で呼ぶ。
//   requireAuth("customer")  ← 誰でもOK（未ログインは customer 扱い）
//   requireAuth("meito")     ← meito または headquarters のみ
//   requireAuth("headquarters") ← headquarters のみ
//   要件を満たさない場合は login.html に飛ばす。
function requireAuth(minRole) {
    const a = getAuth();
    const role = a ? a.role : "customer";

    const ranks = { customer: 0, meito: 1, headquarters: 2 };
    const have = ranks[role] ?? -1;
    const need = ranks[minRole] ?? 0;

    if (have < need) {
        // 必要権限が不足 → ログイン画面へ
        const returnTo = location.pathname.split("/").pop() || "index.html";
        sessionStorage.setItem("buyimono_login_return", returnTo);
        location.replace("login.html");
        return false;
    }

    // メートくん／本部は地区が選ばれている必要がある（customerは不要）
    if (need >= 1 && !getAssignedRegion() && location.pathname.indexOf("select-region.html") < 0) {
        location.replace("select-region.html");
        return false;
    }

    return true;
}

// ========================================
// ヘッダーに「ログイン中ユーザー」と「ログアウト」ボタンを注入
// ========================================
function injectAuthBadge() {
    if (document.getElementById("authBadge")) return;
    const a = getAuth();
    if (!a) return;   // 未ログイン（=お客様）は出さない

    const badge = document.createElement("div");
    badge.id = "authBadge";
    badge.className = "auth-badge";
    badge.innerHTML = `
        <span class="auth-badge-icon">${a.role === 'headquarters' ? '🏢' : '🧑‍💼'}</span>
        <span class="auth-badge-info">
            <span class="auth-badge-role">${ROLE_LABELS[a.role] || a.role}</span>
            <span class="auth-badge-name">${a.name}</span>
        </span>
        <button class="auth-badge-logout" id="authBadgeLogout" title="ログアウト">⎋</button>
    `;
    document.body.appendChild(badge);
    document.getElementById("authBadgeLogout").addEventListener("click", () => {
        if (window.confirm("ログアウトしますか？")) logout();
    });
}
