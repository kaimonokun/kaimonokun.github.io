// ========================================
// 買い物かご（全ページ共通）
// localStorage でページ間の状態を共有
// ストレージキーは地区ごとに独立（_<region> サフィックス）
// ========================================

// ベースキー（地区ごとにサフィックスを付ける）
const CART_KEY_BASE             = "buyimono_cart";
const ORDERS_KEY_BASE           = "buyimono_orders";
const ORDER_COUNTER_KEY_BASE    = "buyimono_order_counter";
const PRICE_OVERRIDES_KEY_BASE  = "buyimono_price_overrides";

// 地区別キーを返すヘルパー
function rsKey(base) {
    const region = (typeof getCurrentRegion === "function") ? getCurrentRegion() : "nara";
    return `${base}_${region}`;
}

// 既存コード互換のため変数として保持（getter として動的に解決）
Object.defineProperty(window, "CART_STORAGE_KEY",    { get: () => rsKey(CART_KEY_BASE) });
Object.defineProperty(window, "ORDERS_STORAGE_KEY",  { get: () => rsKey(ORDERS_KEY_BASE) });
Object.defineProperty(window, "ORDER_COUNTER_KEY",   { get: () => rsKey(ORDER_COUNTER_KEY_BASE) });
Object.defineProperty(window, "PRICE_OVERRIDES_KEY", { get: () => rsKey(PRICE_OVERRIDES_KEY_BASE) });

// 古いキー（地区サフィックス無し）が残っていれば、現在地区へ一度だけ移行
(function migrateLegacyStorageKeys() {
    const legacyKeys = [
        ["buyimono_cart",            CART_KEY_BASE],
        ["buyimono_orders",          ORDERS_KEY_BASE],
        ["buyimono_order_counter",   ORDER_COUNTER_KEY_BASE],
        ["buyimono_price_overrides", PRICE_OVERRIDES_KEY_BASE]
    ];
    const region = (typeof getCurrentRegion === "function") ? getCurrentRegion() : "nara";
    legacyKeys.forEach(([legacy, base]) => {
        // base 名そのままが旧キーなので、地区サフィックスの無い同名キーを移行
        const value = localStorage.getItem(legacy);
        const newKey = `${base}_${region}`;
        if (value !== null && localStorage.getItem(newKey) === null) {
            localStorage.setItem(newKey, value);
            localStorage.removeItem(legacy);
        }
    });
})();

// 注文一覧の表示モード "product"（商品別） / "order"（注文別）
let ordersView = "product";

// 金額調整の編集中セル { orderNumber, itemId } | null
let editingOrderItem = null;

// 価格設定モーダルの現在カテゴリ
let priceSettingsCat = "all";

// ========================================
// 価格オーバーライド（管理者が変更した値段）
// products 配列を読み込み時に書き換えて、全画面で同じ価格を見せる
// ========================================
function loadPriceOverrides() {
    try { return JSON.parse(localStorage.getItem(PRICE_OVERRIDES_KEY) || "{}"); }
    catch { return {}; }
}

function savePriceOverrides(overrides) {
    localStorage.setItem(PRICE_OVERRIDES_KEY, JSON.stringify(overrides));
}

function setProductPrice(productId, newPrice) {
    const ov = loadPriceOverrides();
    if (newPrice === null || newPrice === undefined) {
        delete ov[productId];
    } else {
        ov[productId] = newPrice;
    }
    savePriceOverrides(ov);
    applyPriceOverridesToProducts();
}

function resetAllPriceOverrides() {
    localStorage.removeItem(PRICE_OVERRIDES_KEY);
    applyPriceOverridesToProducts();
}

// products 配列に価格オーバーライドを適用（originalPrice にオリジナルを保持）
function applyPriceOverridesToProducts() {
    if (typeof products === "undefined") return;
    const overrides = loadPriceOverrides();
    products.forEach(p => {
        if (p.originalPrice === undefined) p.originalPrice = p.price;
        p.price = (overrides[p.id] !== undefined && overrides[p.id] !== null)
                ? overrides[p.id]
                : p.originalPrice;
    });
    if (typeof onPricesChanged === "function") onPricesChanged();
}

// データロード後に1回適用（products がフェッチで埋まってから）
if (typeof dataReady !== "undefined") {
    dataReady.then(() => applyPriceOverridesToProducts()).catch(() => {});
}

// ========================================
// 価格ヘルパー（量り売り商品は「約」を前置し調整額を反映）
// ========================================
function approxMark(byWeight) { return byWeight ? "約 " : ""; }

// 単位文字列からグラム数を取得（"200g" → 200、"300g" → 300、"1本" → null）
function parseGramsFromUnit(unit) {
    const m = /^(\d+)\s*g$/.exec(String(unit || "").trim());
    return m ? parseInt(m[1], 10) : null;
}

// 2段表示用の価格文字列
// 量り売り：メインに「約 XXX円 / 約 200g」、サブに「100gあたり 約 YYY円」
// 通常商品：メインのみ「XXX円 / 単位」
function buildPriceLines(item) {
    const byW   = !!item.byWeight;
    const grams = parseGramsFromUnit(item.unit);

    if (!byW) {
        return {
            main: `${item.price.toLocaleString()}円 / ${item.unit}`,
            sub:  null
        };
    }

    // 量り売り：グラム単位にも「約」を付ける
    const unitDisplay = (grams !== null) ? `約 ${item.unit}` : item.unit;
    const main = `約 ${item.price.toLocaleString()}円 / ${unitDisplay}`;

    // 100gあたり価格（グラム単位商品のみ）
    let sub = null;
    if (grams !== null && grams > 0) {
        const per100 = Math.round(item.price * 100 / grams);
        sub = `100gあたり 約 ${per100.toLocaleString()}円`;
    }
    return { main, sub };
}

// 2段の価格表示HTML（span 要素で返す）
function priceLinesHtml(item) {
    const { main, sub } = buildPriceLines(item);
    return `<span class="price-main-line">${main}</span>` +
           (sub ? `<span class="price-sub-line">${sub}</span>` : "");
}

// 注文明細1行の金額を取得（実金額があればそれ、なければ price×qty）
function getItemActualTotal(item) {
    if (item.actualTotal !== undefined && item.actualTotal !== null) {
        return item.actualTotal;
    }
    return item.price * item.qty;
}

function isItemAdjusted(item) {
    return item.actualTotal !== undefined && item.actualTotal !== null;
}

// 注文の合計（調整を含む）
function getOrderCurrentTotal(order) {
    return order.items.reduce((sum, it) => sum + getItemActualTotal(it), 0);
}

// ========================================
// 注文番号・注文履歴
// ========================================
// 購入順で自動採番（個人情報は保存しない）
function getNextOrderNumber() {
    const current = parseInt(localStorage.getItem(ORDER_COUNTER_KEY) || "0", 10);
    const next = current + 1;
    localStorage.setItem(ORDER_COUNTER_KEY, String(next));
    return next;
}

function saveOrderHistory(orderData) {
    const orders = JSON.parse(localStorage.getItem(ORDERS_STORAGE_KEY) || "[]");
    orders.push(orderData);
    // 番号順（昇順）＝購入順
    orders.sort((a, b) => a.number - b.number);
    localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));
}

function getOrderHistory() {
    return JSON.parse(localStorage.getItem(ORDERS_STORAGE_KEY) || "[]");
}

function writeOrderHistory(orders) {
    localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));
}

function formatOrderNumber(n) {
    return `${n}番`;
}

// ========================================
// 日付ヘルパー
// ========================================
function pad2(n) { return String(n).padStart(2, "0"); }

// ファイル名用 "2026-04-25_143015"
function nowFilenameStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}_`
         + `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

// 注文の表示用日付（年月日 時:分）
// savedAt（ISO文字列）が無い古いデータは time フィールドにフォールバック
function formatOrderFullDate(order) {
    if (order.savedAt) {
        const d = new Date(order.savedAt);
        if (!isNaN(d.getTime())) {
            return `${d.getFullYear()}/${pad2(d.getMonth()+1)}/${pad2(d.getDate())} `
                 + `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
        }
    }
    return order.time || "";
}

// 実金額で調整
function adjustOrderItem(orderNumber, itemId, newTotal) {
    const orders = getOrderHistory();
    const order = orders.find(o => o.number === orderNumber);
    if (!order) return;
    const item = order.items.find(i => i.id === itemId);
    if (!item) return;
    item.actualTotal = newTotal;
    order.total = getOrderCurrentTotal(order);
    writeOrderHistory(orders);
}

// 調整を解除（目安価格に戻す）
function resetOrderItemAdjustment(orderNumber, itemId) {
    const orders = getOrderHistory();
    const order = orders.find(o => o.number === orderNumber);
    if (!order) return;
    const item = order.items.find(i => i.id === itemId);
    if (!item) return;
    delete item.actualTotal;
    order.total = getOrderCurrentTotal(order);
    writeOrderHistory(orders);
}

// ========================================
// 注文履歴 CSV エクスポート（削除前の保存用）
// ========================================
function csvEscape(value) {
    const s = String(value == null ? "" : value);
    return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildOrdersCsv(orders) {
    const header = [
        "注文日時", "注文番号", "商品名", "絵文字",
        "単価(円)", "単位", "数量", "量り売り",
        "もとの金額(円)", "変更後の金額(円)", "金額差(円)", "備考",
        "注文合計(円)"
    ];
    const rows = [header];

    orders.forEach(order => {
        const dateStr   = formatOrderFullDate(order);
        const orderTotal = getOrderCurrentTotal(order);
        const orderEst   = order.items.reduce((s, it) => s + it.price * it.qty, 0);
        const orderAdj   = order.items.some(isItemAdjusted);

        order.items.forEach((item, idx) => {
            const est       = item.price * item.qty;
            const adjusted  = isItemAdjusted(item);
            const actual    = adjusted ? item.actualTotal : "";
            const diff      = adjusted ? (item.actualTotal - est) : "";
            const note      = adjusted
                ? (item.byWeight ? "実金額に調整済み" : "金額を変更済み")
                : (item.byWeight ? "（量り売り・目安）" : "");

            rows.push([
                dateStr,
                `${order.number}番`,
                item.name,
                item.emoji,
                item.price,
                item.unit,
                item.qty,
                item.byWeight ? "○" : "",
                est,
                actual,
                diff,
                note,
                idx === 0 ? orderTotal : ""
            ]);
        });

        // 注文合計のサマリ行（複数明細のときのみ）
        if (order.items.length > 1) {
            rows.push([
                dateStr,
                `${order.number}番 合計`,
                "", "", "", "", "", "",
                orderEst,
                orderAdj ? orderTotal : "",
                orderAdj ? (orderTotal - orderEst) : "",
                orderAdj ? "（調整あり）" : "",
                orderTotal
            ]);
        }
    });

    return rows.map(r => r.map(csvEscape).join(",")).join("\r\n");
}

function exportOrdersCsv() {
    const orders = getOrderHistory();
    if (orders.length === 0) {
        window.alert("保存する注文履歴がありません。");
        return;
    }

    const csv = buildOrdersCsv(orders);
    // UTF-8 BOM を付けて Excel で文字化けしないように
    const bom  = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `買い物くん_注文履歴_${nowFilenameStamp()}.csv`;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 200);

    showGlobalToast(`${orders.length}件の注文履歴を保存しました`);
}

// ========================================
// カートデータ
// ========================================
function loadCart() {
    try {
        const json = localStorage.getItem(CART_STORAGE_KEY);
        return json ? JSON.parse(json) : [];
    } catch { return []; }
}

function saveCart() {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

let cart = loadCart();

function addToCart(product, qty) {
    const existing = cart.find(item => item.id === product.id);
    if (existing) {
        existing.qty += qty;
    } else {
        cart.push({
            id: product.id, name: product.name,
            emoji: product.emoji, price: product.price,
            unit: product.unit, qty,
            byWeight: !!product.byWeight
        });
    }
    saveCart();
    updateCartCount();
}

function clearCart() {
    cart = [];
    saveCart();
    updateCartCount();
}

function updateCartCount() {
    const count = cart.reduce((sum, item) => sum + item.qty, 0);
    const el = document.getElementById("cartCount");
    if (el) el.textContent = count;
}

// ========================================
// カートモーダル表示
// ========================================
function renderCart() {
    const container = document.getElementById("cartItems");
    const totalEl   = document.getElementById("totalPrice");
    const orderBtn  = document.getElementById("orderBtn");
    if (!container) return;

    if (cart.length === 0) {
        container.innerHTML = `<div class="cart-empty">買い物かごは空です<br>商品を選んでください</div>`;
        totalEl.textContent = "0円";
        orderBtn.disabled = true;
        return;
    }

    const hasByWeight = cart.some(item => item.byWeight);

    container.innerHTML = cart.map(item => {
        const bwBadge = item.byWeight ? `<span class="cart-item-bw-badge" title="重さで値段が変わる商品">約</span>` : "";
        return `
            <div class="cart-item" data-id="${item.id}">
                <div class="cart-item-emoji">${item.emoji}</div>
                <div class="cart-item-info">
                    <div class="cart-item-name">${bwBadge}${item.name}</div>
                    <div class="cart-item-price">${priceLinesHtml(item)}</div>
                </div>
                <div class="cart-item-qty">
                    <button class="cart-qty-btn" data-action="minus" data-id="${item.id}">-</button>
                    <span class="cart-qty-val">${item.qty}</span>
                    <button class="cart-qty-btn" data-action="plus"  data-id="${item.id}">+</button>
                </div>
                <button class="cart-remove-btn" data-action="remove" data-id="${item.id}">削除</button>
            </div>
        `;
    }).join("") + (hasByWeight ? `
        <div class="cart-byweight-note">
            <span class="cart-byweight-note-icon">ℹ</span>
            <span>「約」が付いた商品は、実際の重さで<br>お値段が少し変わることがあります。</span>
        </div>
    ` : "");

    const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const totalPrefix = hasByWeight ? "約 " : "";
    totalEl.textContent = `${totalPrefix}${total.toLocaleString()}円`;
    orderBtn.disabled = false;

    container.querySelectorAll("[data-action]").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.dataset.id);
            const action = btn.dataset.action;
            const item = cart.find(i => i.id === id);
            if (!item) return;
            if (action === "plus")  item.qty++;
            else if (action === "minus" && item.qty > 1) item.qty--;
            else if (action === "remove") cart = cart.filter(i => i.id !== id);
            saveCart();
            updateCartCount();
            renderCart();
        });
    });
}

// ========================================
// 地区インジケータ（右上）と切替モーダル
// ========================================
function injectRegionIndicator() {
    if (document.getElementById("regionIndicator")) return;

    const current = getCurrentRegion();
    const indicator = document.createElement("button");
    indicator.id = "regionIndicator";
    indicator.className = "region-indicator";
    indicator.innerHTML = `
        <span class="region-indicator-icon">📍</span>
        <span class="region-indicator-label">地区</span>
        <span class="region-indicator-name" id="regionIndicatorName">${getRegionName(current)}</span>
        <span class="region-indicator-chevron">▾</span>
    `;
    document.body.appendChild(indicator);
    indicator.addEventListener("click", openRegionSwitcher);

    // 切替モーダル
    if (!document.getElementById("regionSwitcherModal")) {
        const modal = document.createElement("div");
        modal.id = "regionSwitcherModal";
        modal.className = "modal";
        const cur = getCurrentRegion();
        const buttons = AVAILABLE_REGIONS.map(r => `
            <button class="region-option ${r.id === cur ? 'active' : ''}" data-region="${r.id}">
                <span class="region-option-icon">${r.id === cur ? '📍' : '○'}</span>
                <span class="region-option-name">${r.name}</span>
                ${r.id === cur ? '<span class="region-option-current">現在の地区</span>' : ''}
            </button>
        `).join("");

        modal.innerHTML = `
            <div class="modal-content region-switcher-content">
                <button class="modal-close" id="regionSwitcherClose">×</button>
                <h3 class="modal-title">地区を切り替える</h3>
                <div class="region-switcher-lead">
                    地区を切り替えると、その地区の商品・注文に表示が変わります。<br>
                    買い物かごの中身も切り替わります。
                </div>
                <div class="region-options">
                    ${buttons}
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById("regionSwitcherClose").addEventListener("click", closeRegionSwitcher);
        modal.addEventListener("click", e => { if (e.target.id === "regionSwitcherModal") closeRegionSwitcher(); });

        modal.querySelectorAll(".region-option[data-region]").forEach(btn => {
            btn.addEventListener("click", () => {
                const r = btn.dataset.region;
                if (r === getCurrentRegion()) {
                    closeRegionSwitcher();
                    return;
                }
                const name = getRegionName(r);
                const ok = window.confirm(
                    `地区を「${name}」に切り替えます。\n` +
                    `この地区の商品データに切り替わります。\n` +
                    `（買い物かご・注文履歴・価格設定は地区ごとに別管理）\n\nよろしいですか？`
                );
                if (!ok) return;
                setCurrentRegion(r);
                location.reload();
            });
        });
    }
}

function openRegionSwitcher() {
    const modal = document.getElementById("regionSwitcherModal");
    if (modal) modal.classList.add("show");
}

function closeRegionSwitcher() {
    const modal = document.getElementById("regionSwitcherModal");
    if (modal) modal.classList.remove("show");
}

// ========================================
// 動的注入：注文番号バッジ・注文一覧FAB・モーダル
// （個人情報保護のため、お名前・番号入力欄は廃止）
// ========================================
function injectOrderElements() {

    // 0. 地区インジケータ（右上）※地区変更は本部のみ（お客様・メートくんは固定）
    if ((typeof getRole === "function" ? getRole() : "customer") === "headquarters") {
        injectRegionIndicator();
    }

    // ロール判定：customer は注文一覧/価格設定にアクセス不可
    const role = (typeof getRole === "function") ? getRole() : "customer";
    const isStaff = role !== "customer";

    // 1. 注文完了モーダルに番号バッジを追加
    const completeIcon = document.querySelector(".complete-icon");
    if (completeIcon && !document.getElementById("orderNumberBadge")) {
        completeIcon.insertAdjacentHTML("afterend", `
            <div class="order-number-badge" id="orderNumberBadge">
                <div class="order-number-label">お客様番号</div>
                <div class="order-number-value" id="orderNumberDisplay">-</div>
                <div class="order-number-hint">この番号でお呼びします</div>
            </div>
        `);
    }

    // 2. 注文一覧 FAB（左下）※ staff のみ
    if (isStaff && !document.getElementById("ordersFab")) {
        const fab = document.createElement("button");
        fab.id = "ordersFab";
        fab.className = "orders-fab";
        fab.innerHTML = `
            <span class="orders-fab-icon">📋</span>
            <span class="orders-fab-label">注文一覧</span>
        `;
        document.body.appendChild(fab);
        fab.addEventListener("click", openOrdersModal);
    }

    // 2b. 価格設定 FAB（注文一覧FABの上）※ staff のみ
    if (isStaff && !document.getElementById("priceSettingsFab")) {
        const fab = document.createElement("button");
        fab.id = "priceSettingsFab";
        fab.className = "price-settings-fab";
        fab.innerHTML = `
            <span class="price-settings-fab-icon">⚙</span>
            <span class="price-settings-fab-label">価格設定</span>
        `;
        document.body.appendChild(fab);
        fab.addEventListener("click", openPriceSettings);
    }

    // 3. 注文一覧モーダル ※ staff のみ
    if (isStaff && !document.getElementById("ordersModal")) {
        const modal = document.createElement("div");
        modal.id = "ordersModal";
        modal.className = "modal";
        modal.innerHTML = `
            <div class="modal-content orders-modal-content">
                <button class="modal-close" id="ordersModalClose">×</button>
                <div class="orders-modal-header">
                    <h3 class="modal-title">注文一覧</h3>
                    <div class="orders-count-badge" id="ordersCountBadge"></div>
                </div>
                <div class="orders-view-tabs" id="ordersViewTabs">
                    <button class="orders-view-tab active" data-view="product">
                        <span class="orders-view-tab-icon">📦</span>
                        <span>商品ごとに見る</span>
                    </button>
                    <button class="orders-view-tab" data-view="order">
                        <span class="orders-view-tab-icon">🧾</span>
                        <span>注文ごとに見る</span>
                    </button>
                </div>
                <div class="orders-list" id="ordersList"></div>
                <div class="orders-footer">
                    <button class="orders-save-btn" id="ordersSaveBtn">
                        <span>💾</span><span>日付入りで保存（CSV）</span>
                    </button>
                    <button class="orders-clear-btn" id="ordersClearBtn">
                        <span>🗑</span><span>履歴をすべて削除</span>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById("ordersModalClose").addEventListener("click", closeOrdersModal);
        modal.addEventListener("click", e => { if (e.target.id === "ordersModal") closeOrdersModal(); });

        // CSV 保存
        document.getElementById("ordersSaveBtn").addEventListener("click", exportOrdersCsv);

        // 履歴削除（削除前に保存をおすすめ）
        document.getElementById("ordersClearBtn").addEventListener("click", () => {
            const orders = getOrderHistory();
            if (orders.length === 0) {
                if (window.confirm("番号カウンターをリセットしますか？\n（次の注文は1番から始まります）")) {
                    localStorage.removeItem(ORDER_COUNTER_KEY);
                    showGlobalToast("番号をリセットしました");
                }
                return;
            }
            const ok = window.confirm(
                `注文履歴 ${orders.length}件 と番号をすべて削除します。\n` +
                `削除前に「💾 日付入りで保存」で記録を残しましたか？\n\n` +
                `（OK＝削除する／キャンセル＝やめる）\n` +
                `次の注文は1番から始まります。`
            );
            if (ok) {
                localStorage.removeItem(ORDERS_STORAGE_KEY);
                localStorage.removeItem(ORDER_COUNTER_KEY);
                renderOrdersList();
                showGlobalToast("注文履歴を削除しました");
            }
        });

        // ビュー切替タブ
        modal.querySelectorAll(".orders-view-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                ordersView = tab.dataset.view;
                editingOrderItem = null;
                modal.querySelectorAll(".orders-view-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                renderOrdersList();
            });
        });
    }

    // 4. 価格設定モーダル ※ staff のみ
    if (isStaff && !document.getElementById("priceSettingsModal")) {
        // カテゴリタブを生成（"all" + categories から daily/seasoning などを取り込み）
        const cats = (typeof categories !== "undefined" && Array.isArray(categories))
            ? categories
            : [{ id: "all", name: "すべて" }];

        const tabsHtml = cats.map(c => `
            <button class="ps-cat-btn ${c.id === 'all' ? 'active' : ''}" data-category="${c.id}">
                ${c.name}
            </button>
        `).join("");

        const modal = document.createElement("div");
        modal.id = "priceSettingsModal";
        modal.className = "modal";
        modal.innerHTML = `
            <div class="modal-content price-settings-content">
                <button class="modal-close" id="priceSettingsClose">×</button>
                <div class="price-settings-header">
                    <h3 class="modal-title">⚙ 価格設定</h3>
                    <div class="price-settings-subtitle">
                        商品の値段を変更できます。<br>
                        変更したお値段は全画面に反映されます。
                    </div>
                </div>
                <div class="ps-cat-tabs" id="psCatTabs">
                    ${tabsHtml}
                </div>
                <div class="ps-list" id="psList"></div>
                <div class="ps-footer">
                    <span class="ps-footer-info" id="psOverrideCount"></span>
                    <button class="ps-reset-all-btn" id="psResetAllBtn">
                        <span>↺</span><span>すべて元に戻す</span>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById("priceSettingsClose").addEventListener("click", closePriceSettings);
        modal.addEventListener("click", e => { if (e.target.id === "priceSettingsModal") closePriceSettings(); });

        // カテゴリ切替
        modal.querySelectorAll(".ps-cat-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                priceSettingsCat = btn.dataset.category;
                modal.querySelectorAll(".ps-cat-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                renderPriceSettings();
            });
        });

        // すべて元に戻す
        document.getElementById("psResetAllBtn").addEventListener("click", () => {
            const ov = loadPriceOverrides();
            const n = Object.keys(ov).length;
            if (n === 0) {
                showGlobalToast("変更されている商品はありません");
                return;
            }
            const ok = window.confirm(
                `${n}件の価格変更をすべて元に戻します。\nよろしいですか？`
            );
            if (!ok) return;
            resetAllPriceOverrides();
            renderPriceSettings();
            showGlobalToast(`${n}件の価格を元に戻しました`);
        });
    }
}

// ========================================
// 価格設定モーダル
// ========================================
function openPriceSettings() {
    renderPriceSettings();
    document.getElementById("priceSettingsModal").classList.add("show");
}

function closePriceSettings() {
    document.getElementById("priceSettingsModal").classList.remove("show");
}

function renderPriceSettings() {
    const list = document.getElementById("psList");
    if (!list || typeof products === "undefined") return;

    const overrides = loadPriceOverrides();

    let visible = (priceSettingsCat === "all")
        ? products
        : products.filter(p => p.category === priceSettingsCat);

    // カテゴリ→名前順
    visible = visible.slice().sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return a.name.localeCompare(b.name, "ja");
    });

    if (visible.length === 0) {
        list.innerHTML = `<div class="ps-empty">このカテゴリには商品がありません</div>`;
    } else {
        list.innerHTML = visible.map(p => {
            const orig = (p.originalPrice !== undefined) ? p.originalPrice : p.price;
            const isOverridden = overrides[p.id] !== undefined && overrides[p.id] !== null;
            const currentPrice = p.price;
            return `
                <div class="ps-item ${isOverridden ? 'ps-item-overridden' : ''}" data-pid="${p.id}">
                    <div class="ps-item-emoji">${p.emoji}</div>
                    <div class="ps-item-info">
                        <div class="ps-item-name">
                            ${p.byWeight ? `<span class="bw-badge">量り売り</span>` : ""}
                            ${escapeHtml(p.name)}
                        </div>
                        <div class="ps-item-meta">
                            <span class="ps-item-unit">${escapeHtml(p.unit)}</span>
                            <span class="ps-item-orig">
                                元の値段: ${orig.toLocaleString()}円
                            </span>
                            ${isOverridden ? `<span class="ps-item-changed-flag">変更中</span>` : ""}
                        </div>
                    </div>
                    <div class="ps-item-controls">
                        <div class="ps-price-inputwrap">
                            <input type="number"
                                   class="ps-price-input"
                                   data-pid="${p.id}"
                                   min="0" max="999999" step="1"
                                   value="${currentPrice}"
                                   inputmode="numeric">
                            <span class="ps-price-suffix">円</span>
                        </div>
                        <button class="ps-reset-btn ${isOverridden ? '' : 'ps-reset-btn-disabled'}"
                                data-pid="${p.id}"
                                ${isOverridden ? "" : "disabled"}>
                            戻す
                        </button>
                    </div>
                </div>
            `;
        }).join("");

        // 入力で価格を保存（フォーカスアウト or Enter）
        list.querySelectorAll(".ps-price-input").forEach(input => {
            const commit = () => {
                const pid = parseInt(input.dataset.pid, 10);
                const product = products.find(pp => pp.id === pid);
                if (!product) return;
                const orig = (product.originalPrice !== undefined) ? product.originalPrice : product.price;
                const raw = input.value.trim();
                const val = parseInt(raw, 10);
                if (raw === "" || isNaN(val) || val < 0) {
                    input.classList.add("input-shake");
                    setTimeout(() => input.classList.remove("input-shake"), 400);
                    input.value = product.price;
                    return;
                }
                if (val === product.price) return;          // 変化なし

                if (val === orig) {
                    setProductPrice(pid, null);             // 元に戻す
                    showGlobalToast(`${product.name} を元の値段に戻しました`);
                } else {
                    setProductPrice(pid, val);
                    showGlobalToast(`${product.name} の値段を ${val.toLocaleString()}円 に変更しました`);
                }
                renderPriceSettings();
            };
            input.addEventListener("blur", commit);
            input.addEventListener("keydown", e => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    input.blur();
                }
            });
            // フォーカス時に全選択（編集しやすく）
            input.addEventListener("focus", () => {
                setTimeout(() => input.select(), 0);
            });
        });

        // 個別「戻す」
        list.querySelectorAll(".ps-reset-btn").forEach(btn => {
            if (btn.disabled) return;
            btn.addEventListener("click", () => {
                const pid = parseInt(btn.dataset.pid, 10);
                const product = products.find(pp => pp.id === pid);
                if (!product) return;
                setProductPrice(pid, null);
                renderPriceSettings();
                showGlobalToast(`${product.name} を元の値段に戻しました`);
            });
        });
    }

    // 変更件数の表示
    const overrideCount = Object.keys(loadPriceOverrides()).length;
    const info = document.getElementById("psOverrideCount");
    if (info) {
        info.textContent = overrideCount === 0
            ? "変更中の商品はありません"
            : `現在 ${overrideCount} 件の商品の値段を変更中`;
        info.className = "ps-footer-info" + (overrideCount > 0 ? " ps-footer-info-active" : "");
    }
}

// ========================================
// 注文一覧モーダル
// ========================================
function openOrdersModal() {
    editingOrderItem = null;
    renderOrdersList();
    document.getElementById("ordersModal").classList.add("show");
}

function closeOrdersModal() {
    document.getElementById("ordersModal").classList.remove("show");
}

function renderOrdersList() {
    const orders = getOrderHistory();
    const container = document.getElementById("ordersList");
    const badge = document.getElementById("ordersCountBadge");
    if (!container) return;

    if (badge) badge.textContent = `計 ${orders.length} 件`;

    if (orders.length === 0) {
        container.innerHTML = `<div class="orders-empty">
            <div class="orders-empty-icon">📋</div>
            <div>まだ注文はありません</div>
        </div>`;
        return;
    }

    container.innerHTML = (ordersView === "product")
        ? renderOrdersByProduct(orders)
        : renderOrdersByOrder(orders);

    // 注文別ビューのイベントを配線
    if (ordersView === "order") {
        wireOrderItemAdjustEvents(container);
    }
}

// --------------------------------------------------------------
// 商品別ビュー：同じ商品をまとめ、「何番の人が何個買ったか」を一目で
// --------------------------------------------------------------
function renderOrdersByProduct(orders) {
    // 商品IDごとに集計
    const byProduct = new Map();
    orders.forEach(order => {
        order.items.forEach(item => {
            if (!byProduct.has(item.id)) {
                byProduct.set(item.id, {
                    id: item.id,
                    name: item.name,
                    emoji: item.emoji,
                    price: item.price,
                    unit: item.unit,
                    byWeight: !!item.byWeight,
                    total: 0,
                    estAmount: 0,    // 目安合計
                    actAmount: 0,    // 実合計（調整あれば反映）
                    anyAdjusted: false,
                    buyers: []       // {number, qty, adjusted}
                });
            }
            const rec = byProduct.get(item.id);
            const est = item.price * item.qty;
            const act = getItemActualTotal(item);
            rec.total     += item.qty;
            rec.estAmount += est;
            rec.actAmount += act;
            if (isItemAdjusted(item)) rec.anyAdjusted = true;
            rec.buyers.push({
                number: order.number,
                qty: item.qty,
                adjusted: isItemAdjusted(item)
            });
        });
    });

    // 合計数量の多い順に並べる（同数は名前順）
    const list = Array.from(byProduct.values())
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ja"));

    // 全体サマリ
    const grandCount  = list.reduce((s, p) => s + p.total, 0);
    const grandActual = list.reduce((s, p) => s + p.actAmount, 0);
    const grandEst    = list.reduce((s, p) => s + p.estAmount, 0);
    const anyAdj      = list.some(p => p.anyAdjusted);

    const summary = `
        <div class="orders-product-summary">
            <span class="orders-product-summary-label">全注文の合計</span>
            <span class="orders-product-summary-count">${list.length}種 / ${grandCount}点</span>
            <span class="orders-product-summary-price">
                ${anyAdj ? "" : ""}${grandActual.toLocaleString()}円
            </span>
        </div>
        ${anyAdj ? `
            <div class="orders-adjustment-diff-summary">
                <span>調整前 ${grandEst.toLocaleString()}円 ⇒ 調整後 <b>${grandActual.toLocaleString()}円</b></span>
                <span class="orders-adjustment-diff ${grandActual - grandEst >= 0 ? 'plus' : 'minus'}">
                    ${grandActual - grandEst >= 0 ? '+' : ''}${(grandActual - grandEst).toLocaleString()}円
                </span>
            </div>
        ` : ""}
    `;

    const rows = list.map(p => {
        const buyers = p.buyers.slice().sort((a, b) => a.number - b.number);
        const prefix = p.byWeight && !p.anyAdjusted ? "約 " : "";
        return `
            <div class="orders-product-item">
                <div class="orders-product-head">
                    <div class="orders-product-emoji">${p.emoji}</div>
                    <div class="orders-product-nameblock">
                        <div class="orders-product-name">
                            ${p.byWeight ? `<span class="bw-badge" title="重さで値段が変わる商品">量り売り</span>` : ""}
                            ${escapeHtml(p.name)}
                        </div>
                        <div class="orders-product-unit">${priceLinesHtml(p)}</div>
                    </div>
                    <div class="orders-product-totals">
                        <span class="orders-product-total-badge">合計 ${p.total}個</span>
                        <span class="orders-product-subtotal">${prefix}${p.actAmount.toLocaleString()}円</span>
                        ${p.anyAdjusted ? `
                            <span class="orders-product-est">${p.byWeight ? "目安" : "もと"} ${p.estAmount.toLocaleString()}円</span>
                        ` : ""}
                    </div>
                </div>
                <div class="orders-product-buyers-label">
                    <span class="orders-product-buyers-label-icon">🙋</span>
                    <span>お買い上げのお客様（${buyers.length}名）</span>
                </div>
                <div class="orders-product-buyers">
                    ${buyers.map(b => `
                        <span class="orders-buyer-chip ${b.adjusted ? 'adjusted' : ''}">
                            <span class="orders-buyer-chip-num">${b.number}番</span>
                            <span class="orders-buyer-chip-qty">${b.qty}個</span>
                            ${b.adjusted ? `<span class="orders-buyer-chip-adj" title="実金額に調整済み">✓</span>` : ""}
                        </span>
                    `).join("")}
                </div>
            </div>
        `;
    }).join("");

    return summary + rows;
}

// --------------------------------------------------------------
// 注文別ビュー：1件ずつの注文として表示＋全商品で金額調整可能
// --------------------------------------------------------------
function renderOrdersByOrder(orders) {
    return orders.map(order => {
        const orderTotal = getOrderCurrentTotal(order);
        const estTotal   = order.items.reduce((s, it) => s + it.price * it.qty, 0);
        const anyAdj     = order.items.some(isItemAdjusted);
        const hasBW      = order.items.some(it => it.byWeight);
        // 量り売り商品が含まれていれば「目安」、なければ「調整前」と表示
        const estBeforeLabel = hasBW ? "目安" : "調整前";

        return `
            <div class="orders-item orders-item-expanded">
                <div class="orders-item-header">
                    <span class="orders-item-number">${formatOrderNumber(order.number)}</span>
                    <span class="orders-item-time">${formatOrderFullDate(order)}</span>
                </div>
                <div class="orders-item-lines">
                    ${order.items.map(item => renderOrderItemLine(order.number, item)).join("")}
                </div>
                <div class="orders-item-totalrow">
                    <span class="orders-item-total-label">合計</span>
                    <div class="orders-item-total-amounts">
                        ${anyAdj ? `<span class="orders-item-total-est">${estBeforeLabel} ${estTotal.toLocaleString()}円</span>` : ""}
                        <span class="orders-item-total">${hasBW && !anyAdj ? "約 " : ""}${orderTotal.toLocaleString()}円</span>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

// 1明細行（全商品で金額調整可能）
function renderOrderItemLine(orderNumber, item) {
    const isBW       = !!item.byWeight;
    const estTotal   = item.price * item.qty;
    const actTotal   = getItemActualTotal(item);
    const adjusted   = isItemAdjusted(item);
    const editing    = editingOrderItem
                       && editingOrderItem.orderNumber === orderNumber
                       && editingOrderItem.itemId === item.id;

    // 量り売り：目安 → 実際の金額／通常品：もとの金額 → 変更後の金額
    const estLabel    = isBW ? "目安金額"   : "もとの金額";
    const newLabel    = isBW ? "実際の金額" : "変更後の金額";
    const resetLabel  = isBW ? "目安に戻す" : "もとの金額に戻す";
    const editBtnLabel = adjusted ? "修正" : (isBW ? "実金額" : "値段変更");
    const editBtnTitle = adjusted
        ? "金額を修正"
        : (isBW ? "実際の金額に調整" : "値段を変更");

    if (editing) {
        return `
            <div class="orders-line editing" data-order="${orderNumber}" data-item="${item.id}">
                <div class="orders-line-main">
                    <span class="orders-line-emoji">${item.emoji}</span>
                    <span class="orders-line-name">${escapeHtml(item.name)} × ${item.qty}</span>
                    ${isBW ? `<span class="bw-badge">量り売り</span>` : ""}
                </div>
                <div class="orders-line-edit">
                    <div class="orders-line-edit-row">
                        <label class="orders-line-edit-label">${estLabel}</label>
                        <span class="orders-line-edit-estimate">${estTotal.toLocaleString()}円</span>
                    </div>
                    <div class="orders-line-edit-row">
                        <label class="orders-line-edit-label" for="adjInput-${orderNumber}-${item.id}">
                            ${newLabel}
                        </label>
                        <div class="orders-line-edit-inputwrap">
                            <input type="number" id="adjInput-${orderNumber}-${item.id}"
                                   class="orders-line-edit-input"
                                   min="0" max="999999" step="1"
                                   value="${actTotal}"
                                   inputmode="numeric">
                            <span class="orders-line-edit-suffix">円</span>
                        </div>
                    </div>
                    <div class="orders-line-edit-actions">
                        ${adjusted ? `
                            <button class="orders-line-edit-btn orders-line-edit-reset"
                                    data-act="reset" data-order="${orderNumber}" data-item="${item.id}">
                                ${resetLabel}
                            </button>
                        ` : ""}
                        <button class="orders-line-edit-btn orders-line-edit-cancel"
                                data-act="cancel">
                            キャンセル
                        </button>
                        <button class="orders-line-edit-btn orders-line-edit-save"
                                data-act="save" data-order="${orderNumber}" data-item="${item.id}">
                            ✓ 保存
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    const diff = actTotal - estTotal;
    return `
        <div class="orders-line ${adjusted ? 'adjusted' : ''}" data-order="${orderNumber}" data-item="${item.id}">
            <div class="orders-line-main">
                <span class="orders-line-emoji">${item.emoji}</span>
                <span class="orders-line-name">${escapeHtml(item.name)} × ${item.qty}</span>
                ${isBW ? `<span class="bw-badge">量り売り</span>` : ""}
            </div>
            <div class="orders-line-amounts">
                ${adjusted ? `
                    <span class="orders-line-est-strike">${estTotal.toLocaleString()}円</span>
                    <span class="orders-line-actual">${actTotal.toLocaleString()}円</span>
                    <span class="orders-line-diff ${diff >= 0 ? 'plus' : 'minus'}">
                        ${diff >= 0 ? '+' : ''}${diff.toLocaleString()}
                    </span>
                ` : `
                    <span class="orders-line-amount">${isBW ? "約 " : ""}${estTotal.toLocaleString()}円</span>
                `}
                <button class="orders-line-adj-btn ${isBW ? '' : 'orders-line-adj-btn-fixed'}"
                        data-act="edit"
                        data-order="${orderNumber}" data-item="${item.id}"
                        title="${editBtnTitle}">
                    ✏ ${editBtnLabel}
                </button>
            </div>
        </div>
    `;
}

function wireOrderItemAdjustEvents(container) {
    container.querySelectorAll("[data-act]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const act = btn.dataset.act;
            const orderNumber = parseInt(btn.dataset.order, 10);
            const itemId      = parseInt(btn.dataset.item, 10);

            if (act === "edit") {
                editingOrderItem = { orderNumber, itemId };
                renderOrdersList();
                // フォーカス＆全選択
                setTimeout(() => {
                    const input = document.getElementById(`adjInput-${orderNumber}-${itemId}`);
                    if (input) { input.focus(); input.select(); }
                }, 0);
            } else if (act === "cancel") {
                editingOrderItem = null;
                renderOrdersList();
            } else if (act === "save") {
                const input = document.getElementById(`adjInput-${orderNumber}-${itemId}`);
                if (!input) return;
                const val = parseInt(input.value, 10);
                if (isNaN(val) || val < 0) {
                    input.classList.add("input-shake");
                    setTimeout(() => input.classList.remove("input-shake"), 400);
                    return;
                }

                // 元の金額と同じ値が入力されたら調整解除（差分0の表示を避ける）
                const ordersChk = getOrderHistory();
                const orderChk  = ordersChk.find(o => o.number === orderNumber);
                const itemChk   = orderChk ? orderChk.items.find(i => i.id === itemId) : null;
                if (itemChk && val === itemChk.price * itemChk.qty) {
                    if (isItemAdjusted(itemChk)) {
                        resetOrderItemAdjustment(orderNumber, itemId);
                        showGlobalToast(
                            `${formatOrderNumber(orderNumber)} の金額を${itemChk.byWeight ? "目安" : "もとの値段"}に戻しました`
                        );
                    }
                    editingOrderItem = null;
                    renderOrdersList();
                    return;
                }

                adjustOrderItem(orderNumber, itemId, val);
                editingOrderItem = null;
                renderOrdersList();
                showGlobalToast(`${formatOrderNumber(orderNumber)} の金額を ${val.toLocaleString()}円 に変更しました`);
            } else if (act === "reset") {
                // 量り売りなら「目安に」、通常品なら「もとの値段に」戻したと知らせる
                const orders = getOrderHistory();
                const order  = orders.find(o => o.number === orderNumber);
                const item   = order ? order.items.find(i => i.id === itemId) : null;
                const wasBW  = !!(item && item.byWeight);
                resetOrderItemAdjustment(orderNumber, itemId);
                editingOrderItem = null;
                renderOrdersList();
                showGlobalToast(
                    `${formatOrderNumber(orderNumber)} の金額を${wasBW ? "目安" : "もとの値段"}に戻しました`
                );
            }
        });
    });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ========================================
// カートFAB・モーダル・注文フロー
// ========================================
document.addEventListener("DOMContentLoaded", async () => {
    // データロード完了を待ってから初期化（categories などを使うため）
    try { await dataReady; } catch { return; }
    updateCartCount();
    setupCartFab();
    injectOrderElements();
});

function setupCartFab() {
    const fab = document.getElementById("cartFab");
    if (!fab) return;

    fab.addEventListener("click", () => {
        renderCart();
        document.getElementById("cartModal").classList.add("show");
        if (typeof onCartOpen === "function") onCartOpen();
    });

    document.getElementById("cartModalClose").addEventListener("click", () => {
        document.getElementById("cartModal").classList.remove("show");
        if (typeof onCartClose === "function") onCartClose();
    });

    document.getElementById("cartModal").addEventListener("click", e => {
        if (e.target.id === "cartModal") {
            document.getElementById("cartModal").classList.remove("show");
            if (typeof onCartClose === "function") onCartClose();
        }
    });

    document.getElementById("orderBtn").addEventListener("click", () => {
        if (cart.length === 0) return;
        openOrderConfirm();
    });

    document.getElementById("orderConfirmClose").addEventListener("click", closeOrderConfirm);
    document.getElementById("orderConfirmBack").addEventListener("click", closeOrderConfirm);
    document.getElementById("orderConfirmOk").addEventListener("click", () => {
        document.getElementById("orderConfirmModal").classList.remove("show");
        completeOrder();
    });
    document.getElementById("orderConfirmModal").addEventListener("click", e => {
        if (e.target.id === "orderConfirmModal") closeOrderConfirm();
    });

    document.getElementById("completeBtn").addEventListener("click", () => {
        document.getElementById("completeModal").classList.remove("show");
        // 次のお客様のため「いらっしゃいませ」画面に戻す
        sessionStorage.removeItem("buyimono_welcomed");
        location.href = "index.html";
    });
}

function openOrderConfirm() {
    const list    = document.getElementById("orderConfirmList");
    const totalEl = document.getElementById("orderConfirmTotal");
    const hasByWeight = cart.some(i => i.byWeight);

    list.innerHTML = cart.map(item => {
        const prefix = approxMark(item.byWeight);
        return `
            <div class="order-confirm-item">
                <div class="order-confirm-item-emoji">${item.emoji}</div>
                <div class="order-confirm-item-info">
                    <div class="order-confirm-item-name">
                        ${item.byWeight ? `<span class="bw-badge">量り売り</span>` : ""}
                        ${item.name}
                    </div>
                    <div class="order-confirm-item-sub">
                        ${priceLinesHtml(item)}
                        <span class="order-confirm-item-qty">× ${item.qty}個</span>
                    </div>
                </div>
                <div class="order-confirm-item-price">${prefix}${(item.price * item.qty).toLocaleString()}円</div>
            </div>
        `;
    }).join("") + (hasByWeight ? `
        <div class="order-confirm-byweight-note">
            <span class="order-confirm-byweight-note-icon">ℹ</span>
            <span>「量り売り」と書かれた商品は、実際の重さで<br>お値段が少し変わることがあります。</span>
        </div>
    ` : "");

    const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const totalPrefix = hasByWeight ? "約 " : "";
    totalEl.textContent = `${totalPrefix}${total.toLocaleString()}円`;

    document.getElementById("cartModal").classList.remove("show");
    document.getElementById("orderConfirmModal").classList.add("show");
}

function closeOrderConfirm() {
    document.getElementById("orderConfirmModal").classList.remove("show");
    renderCart();
    document.getElementById("cartModal").classList.add("show");
}

function completeOrder() {
    // 購入順で自動採番
    const orderNumber = getNextOrderNumber();

    const now = new Date();
    const timeStr = `${now.getMonth() + 1}/${now.getDate()} `
                  + `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

    const orderData = {
        number:  orderNumber,
        time:    timeStr,
        savedAt: now.toISOString(),          // 年月日含む完全な日時（CSV出力用）
        items:   cart.map(i => ({ ...i })),  // byWeight も含めてコピー
        total:   cart.reduce((sum, item) => sum + item.price * item.qty, 0)
    };
    saveOrderHistory(orderData);

    // 番号を表示
    const numEl = document.getElementById("orderNumberDisplay");
    if (numEl) numEl.textContent = formatOrderNumber(orderNumber);

    // 明細
    const hasByWeight = orderData.items.some(i => i.byWeight);
    const totalPrefix = hasByWeight ? "約 " : "";
    const summary = document.getElementById("completeSummary");
    summary.innerHTML = orderData.items.map(item => {
        const prefix = approxMark(item.byWeight);
        return `
            <div class="complete-summary-item">
                <span>${item.emoji} ${item.name} × ${item.qty}</span>
                <span>${prefix}${(item.price * item.qty).toLocaleString()}円</span>
            </div>
        `;
    }).join("") + `
        <div class="complete-summary-item" style="font-weight:bold; border-top:2px solid #1e5aa8; margin-top:8px; padding-top:10px;">
            <span>合計</span>
            <span>${totalPrefix}${orderData.total.toLocaleString()}円</span>
        </div>
    ` + (hasByWeight ? `
        <div class="complete-byweight-note">
            「約」印は量り売り商品です。<br>
            実際のお支払い金額はスタッフが確定します。
        </div>
    ` : "");

    clearCart();
    document.getElementById("completeModal").classList.add("show");
}

// ページ間カート同期
window.addEventListener("storage", e => {
    if (e.key === CART_STORAGE_KEY) {
        cart = loadCart();
        updateCartCount();
    }
});

// ========================================
// 簡易トースト（全ページ共通）
// ========================================
function showGlobalToast(text) {
    const existing = document.querySelector(".global-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = "global-toast";
    toast.innerHTML = `<span class="toast-check">✓</span><span>${text}</span>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, 2200);
}
