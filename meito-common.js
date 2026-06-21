// ========================================
// メートくん用サブページ共通ユーティリティ
// ========================================
// orders は localStorage に地区別で保管されている。
// （cart.js の rsKey と同じ流儀でアクセス）
// ========================================

function meitoLoadOrders() {
    const region = (typeof getCurrentRegion === "function") ? getCurrentRegion() : "nara";
    const key = `buyimono_orders_${region}`;
    try { return JSON.parse(localStorage.getItem(key) || "[]"); }
    catch { return []; }
}

function meitoWriteOrders(orders) {
    const region = (typeof getCurrentRegion === "function") ? getCurrentRegion() : "nara";
    const key = `buyimono_orders_${region}`;
    localStorage.setItem(key, JSON.stringify(orders));
}

// 注文時の合計（実金額があればそれ、なければ price×qty）
function meitoGetItemTotal(item) {
    if (item.actualTotal !== undefined && item.actualTotal !== null) return item.actualTotal;
    return item.price * item.qty;
}

function meitoIsAdjusted(item) {
    return item.actualTotal !== undefined && item.actualTotal !== null;
}

function meitoGetOrderTotal(order) {
    return order.items.reduce((s, it) => s + meitoGetItemTotal(it), 0);
}

function meitoApproxMark(item) {
    return item.byWeight ? "約 " : "";
}

function meitoPad2(n) { return String(n).padStart(2, "0"); }

function meitoFormatDate(order) {
    if (order.savedAt) {
        const d = new Date(order.savedAt);
        if (!isNaN(d.getTime())) {
            return `${d.getFullYear()}/${meitoPad2(d.getMonth()+1)}/${meitoPad2(d.getDate())} `
                 + `${meitoPad2(d.getHours())}:${meitoPad2(d.getMinutes())}`;
        }
    }
    return order.time || "";
}

function meitoFormatToday() {
    const d = new Date();
    return `${d.getFullYear()}/${meitoPad2(d.getMonth()+1)}/${meitoPad2(d.getDate())}`;
}

// 同じヘッダーを共通化（戻るボタン＋タイトル）
function meitoRenderHeader(title) {
    const region = (typeof getCurrentRegion === "function") ? getCurrentRegion() : "nara";
    const regionName = (typeof getRegionName === "function") ? getRegionName(region) : region;
    const auth = (typeof getAuth === "function") ? getAuth() : null;
    return `
        <header class="staff-header">
            <div class="staff-header-inner">
                <div class="staff-header-left">
                    <a href="meito.html" class="staff-back-btn">◀ メニュー</a>
                    <h1 class="staff-logo">${title}</h1>
                </div>
                <div class="staff-header-right">
                    <span class="staff-context-mini">
                        ${auth ? auth.name : ""}・📍 ${regionName}
                    </span>
                </div>
            </div>
        </header>
    `;
}

function meitoEscapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
