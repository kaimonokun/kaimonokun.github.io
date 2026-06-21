// ========================================
// セットで選ぶページ
// ========================================

let currentSet = null;
let currentIngredients = []; // [{productId, qty}]
let pickerCategory = "all";

document.addEventListener("DOMContentLoaded", async () => {
    // データロード完了を待ってから初期化
    try { await dataReady; } catch { return; }
    renderSetGrid();
    setupSetDetailEvents();
    setupProductPickerEvents();
    setupSetConfirmEvents();
});

// 価格設定が変わったときの再描画（cart.js からコールバック）
function onPricesChanged() {
    // セット一覧（合計価格）を再描画
    const grid = document.getElementById("setsGrid");
    if (grid) renderSetGrid();

    // セット詳細が開いていれば材料リスト＆合計を再描画
    const detailModal = document.getElementById("setDetailModal");
    if (detailModal && detailModal.classList.contains("show") && currentSet) {
        renderIngredients();
    }

    // 商品ピッカーが開いていれば再描画
    const pickerModal = document.getElementById("productPickerModal");
    if (pickerModal && pickerModal.classList.contains("show")) {
        renderPickerList();
    }

    // セット追加確認モーダルが開いていれば再描画
    const confirmModal = document.getElementById("setConfirmModal");
    if (confirmModal && confirmModal.classList.contains("show")) {
        openSetConfirm();
    }
}

// ========================================
// セット一覧
// ========================================
function renderSetGrid() {
    const grid = document.getElementById("setsGrid");
    grid.innerHTML = mealSets.map(set => {
        const total = calcSetTotal(set.ingredients);
        return `
            <div class="set-card" data-id="${set.id}">
                <div class="set-card-top">
                    <div class="set-card-emoji">${set.emoji}</div>
                    <div class="set-card-servings-badge">${set.servings}</div>
                </div>
                <div class="set-card-name">${set.name}</div>
                <div class="set-card-desc">${set.description}</div>
                <div class="set-card-footer">
                    <div class="set-card-items">${set.ingredients.length}品目</div>
                    <div class="set-card-price">約 ${total.toLocaleString()}円</div>
                </div>
                <div class="set-card-tap">タップして中身を見る ▶</div>
            </div>
        `;
    }).join("");

    grid.querySelectorAll(".set-card").forEach(card => {
        card.addEventListener("click", () => openSetDetail(card.dataset.id));
    });
}

function calcSetTotal(ingredients) {
    return ingredients.reduce((sum, ing) => {
        const p = getProduct(ing.productId);
        return sum + (p ? p.price * ing.qty : 0);
    }, 0);
}

// ========================================
// セット詳細
// ========================================
function openSetDetail(setId) {
    const set = mealSets.find(s => s.id === setId);
    if (!set) return;
    currentSet = set;
    currentIngredients = set.ingredients.map(ing => ({ ...ing }));

    document.getElementById("setDetailEmoji").textContent = set.emoji;
    document.getElementById("setDetailTitle").textContent = set.name;
    document.getElementById("setDetailServings").textContent = set.servings;
    document.getElementById("setDetailDesc").textContent = set.description;

    renderIngredients();
    document.getElementById("setDetailModal").classList.add("show");
}

function renderIngredients() {
    const container = document.getElementById("setIngredients");

    if (currentIngredients.length === 0) {
        container.innerHTML = `<div class="set-ingredients-empty">
            お買い物リストが空です。<br>
            「他の商品を追加する」で追加してください。
        </div>`;
    } else {
        container.innerHTML = currentIngredients.map(ing => {
            const p = getProduct(ing.productId);
            if (!p) return "";
            const subtotal = p.price * ing.qty;
            const pfx = p.byWeight ? "約 " : "";
            return `
                <div class="set-ingredient" data-pid="${p.id}">
                    <div class="set-ingredient-emoji">${p.emoji}</div>
                    <div class="set-ingredient-info">
                        <div class="set-ingredient-name">
                            ${p.byWeight ? `<span class="bw-badge">量り売り</span>` : ""}
                            ${p.name}
                        </div>
                        <div class="set-ingredient-price">${priceLinesHtml(p)}</div>
                    </div>
                    <div class="set-ingredient-controls">
                        <div class="set-ingredient-qty">
                            <button class="ing-qty-btn" data-act="minus" data-pid="${p.id}">-</button>
                            <span class="ing-qty-val">${ing.qty}</span>
                            <button class="ing-qty-btn" data-act="plus" data-pid="${p.id}">+</button>
                        </div>
                        <div class="set-ingredient-subtotal">${pfx}${subtotal.toLocaleString()}円</div>
                    </div>
                    <button class="ing-remove-btn" data-pid="${p.id}" title="削除">×</button>
                </div>
            `;
        }).join("");

        container.querySelectorAll(".ing-qty-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const pid = parseInt(btn.dataset.pid);
                const ing = currentIngredients.find(i => i.productId === pid);
                if (!ing) return;
                if (btn.dataset.act === "plus") ing.qty++;
                else if (btn.dataset.act === "minus" && ing.qty > 1) ing.qty--;
                renderIngredients();
            });
        });

        container.querySelectorAll(".ing-remove-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const pid = parseInt(btn.dataset.pid);
                currentIngredients = currentIngredients.filter(i => i.productId !== pid);
                renderIngredients();
            });
        });
    }

    const total = calcSetTotal(currentIngredients);
    const hasBW = currentIngredients.some(ing => {
        const p = getProduct(ing.productId);
        return p && p.byWeight;
    });
    const totalPfx = hasBW ? "約 " : "";
    document.getElementById("setTotalPrice").textContent = `${totalPfx}${total.toLocaleString()}円`;

    // カートに入れるボタンの有効/無効
    const addBtn = document.getElementById("setAddToCartBtn");
    addBtn.disabled = currentIngredients.length === 0;
}

function setupSetDetailEvents() {
    document.getElementById("setDetailClose").addEventListener("click", closeSetDetail);
    document.getElementById("setDetailModal").addEventListener("click", (e) => {
        if (e.target.id === "setDetailModal") closeSetDetail();
    });

    document.getElementById("setAddProductBtn").addEventListener("click", openProductPicker);

    // セットから買い物かごへ（確認ダイアログ経由）
    document.getElementById("setAddToCartBtn").addEventListener("click", () => {
        if (currentIngredients.length === 0) return;
        openSetConfirm();
    });
}

function closeSetDetail() {
    document.getElementById("setDetailModal").classList.remove("show");
}

// ========================================
// 商品追加ピッカー
// ========================================
function openProductPicker() {
    pickerCategory = "all";
    document.querySelectorAll(".picker-cat-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.category === "all");
    });
    renderPickerList();
    document.getElementById("productPickerModal").classList.add("show");
}

function closeProductPicker() {
    document.getElementById("productPickerModal").classList.remove("show");
}

function renderPickerList() {
    const list = document.getElementById("pickerList");
    const excluded = new Set(currentIngredients.map(i => i.productId));

    let available = products.filter(p => !excluded.has(p.id));
    if (pickerCategory !== "all") {
        available = available.filter(p => p.category === pickerCategory);
    }

    if (available.length === 0) {
        list.innerHTML = `<div class="picker-empty">追加できる商品がありません</div>`;
        return;
    }

    list.innerHTML = available.map(p => {
        return `
            <div class="picker-item" data-pid="${p.id}">
                <div class="picker-emoji">${p.emoji}</div>
                <div class="picker-info">
                    <div class="picker-name">
                        ${p.byWeight ? `<span class="bw-badge">量り売り</span>` : ""}
                        ${p.name}
                    </div>
                    <div class="picker-price">${priceLinesHtml(p)}</div>
                </div>
                <button class="picker-add-btn" data-pid="${p.id}">
                    <span>＋</span><span>追加</span>
                </button>
            </div>
        `;
    }).join("");

    list.querySelectorAll(".picker-add-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const pid = parseInt(btn.dataset.pid);
            currentIngredients.push({ productId: pid, qty: 1 });
            renderIngredients();
            // 追加した商品はリストから消えるので再描画
            renderPickerList();
        });
    });
}

function setupProductPickerEvents() {
    document.getElementById("productPickerClose").addEventListener("click", closeProductPicker);
    document.getElementById("productPickerModal").addEventListener("click", (e) => {
        if (e.target.id === "productPickerModal") closeProductPicker();
    });

    document.querySelectorAll(".picker-cat-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".picker-cat-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            pickerCategory = btn.dataset.category;
            renderPickerList();
        });
    });
}

// ========================================
// セット追加確認
// ========================================
function openSetConfirm() {
    const list = document.getElementById("setConfirmList");
    const totalEl = document.getElementById("setConfirmTotal");

    const hasBW = currentIngredients.some(ing => {
        const p = getProduct(ing.productId);
        return p && p.byWeight;
    });

    list.innerHTML = currentIngredients.map(ing => {
        const p = getProduct(ing.productId);
        if (!p) return "";
        const pfx = p.byWeight ? "約 " : "";
        return `
            <div class="order-confirm-item">
                <div class="order-confirm-item-emoji">${p.emoji}</div>
                <div class="order-confirm-item-info">
                    <div class="order-confirm-item-name">
                        ${p.byWeight ? `<span class="bw-badge">量り売り</span>` : ""}
                        ${p.name}
                    </div>
                    <div class="order-confirm-item-sub">
                        ${priceLinesHtml(p)}
                        <span class="order-confirm-item-qty">× ${ing.qty}個</span>
                    </div>
                </div>
                <div class="order-confirm-item-price">${pfx}${(p.price * ing.qty).toLocaleString()}円</div>
            </div>
        `;
    }).join("") + (hasBW ? `
        <div class="order-confirm-byweight-note">
            <span class="order-confirm-byweight-note-icon">ℹ</span>
            <span>「量り売り」と書かれた商品は、実際の重さで<br>お値段が少し変わることがあります。</span>
        </div>
    ` : "");

    const total = calcSetTotal(currentIngredients);
    const totalPfx = hasBW ? "約 " : "";
    totalEl.textContent = `${totalPfx}${total.toLocaleString()}円`;

    document.getElementById("setConfirmModal").classList.add("show");
}

function closeSetConfirm() {
    document.getElementById("setConfirmModal").classList.remove("show");
}

function setupSetConfirmEvents() {
    document.getElementById("setConfirmClose").addEventListener("click", closeSetConfirm);
    document.getElementById("setConfirmBack").addEventListener("click", closeSetConfirm);
    document.getElementById("setConfirmModal").addEventListener("click", (e) => {
        if (e.target.id === "setConfirmModal") closeSetConfirm();
    });
    document.getElementById("setConfirmOk").addEventListener("click", () => {
        // 買い物かごへ追加
        currentIngredients.forEach(ing => {
            const p = getProduct(ing.productId);
            if (p) addToCart(p, ing.qty);
        });
        closeSetConfirm();
        closeSetDetail();
        showGlobalToast(`${currentSet.name} の材料を買い物かごに追加しました`);
    });
}
