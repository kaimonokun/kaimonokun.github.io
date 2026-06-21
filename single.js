// ========================================
// 1つずつ選ぶページ（TV通販風）
// ========================================

const PLACEHOLDER_DURATION = 6000;

let currentCategory = "all";
let filteredProducts = [...products];
let currentIndex = 0;
let isPlaying = true;
let isPanelOpen = false;
let selectedQty = 1;
let maxQtyVisible = 5;
let placeholderTimer = null;

document.addEventListener("DOMContentLoaded", async () => {
    // データロード完了を待ってから初期化
    try { await dataReady; } catch { return; }
    applyFilter();
    setupStageEvents();
    setupCategoryButtons();
    setupControlButtons();
    setupPanelEvents();
    renderProgressDots();
    showProduct(0);
});

// カートが開いたら動画停止 / 閉じたら再開（cart.js からコールバック）
function onCartOpen() {
    pauseVideo();
    clearTimeout(placeholderTimer);
}
function onCartClose() {
    if (isPlaying && !isPanelOpen) resumePlaying();
}

// 価格設定が変わったときの再描画（cart.js からコールバック）
function onPricesChanged() {
    if (!filteredProducts || filteredProducts.length === 0) return;
    const product = filteredProducts[currentIndex];
    if (!product) return;

    // オーバーレイの価格を再描画（動画はそのまま）
    const overlayPrice = document.getElementById("overlayPrice");
    if (overlayPrice) {
        overlayPrice.innerHTML =
            priceLinesHtml(product) +
            (product.byWeight ? `<span class="overlay-bw-note">量り売り</span>` : "");
    }

    // 購入パネルが開いていれば、その価格・確認ダイアログ部も更新
    if (isPanelOpen) {
        const panelPrice = document.getElementById("panelPrice");
        if (panelPrice) panelPrice.innerHTML = priceLinesHtml(product);

        // 確認ダイアログが表示中なら合計も再計算
        const confirmDialog = document.getElementById("confirmDialog");
        if (confirmDialog && confirmDialog.classList.contains("show")) {
            const pfx = product.byWeight ? "約 " : "";
            const confirmPrice = document.getElementById("confirmPrice");
            const confirmTotal = document.getElementById("confirmTotal");
            if (confirmPrice) confirmPrice.innerHTML = priceLinesHtml(product);
            if (confirmTotal) confirmTotal.textContent =
                `${pfx}${(product.price * selectedQty).toLocaleString()}円`;
        }
    }
}

// ========================================
// 商品フィルタ
// ========================================
function applyFilter() {
    filteredProducts = currentCategory === "all"
        ? [...products]
        : products.filter(p => p.category === currentCategory);
    currentIndex = 0;
}

// ========================================
// 商品表示
// ========================================
function showProduct(index) {
    if (filteredProducts.length === 0) return;

    currentIndex = (index + filteredProducts.length) % filteredProducts.length;
    const product = filteredProducts[currentIndex];

    document.getElementById("overlayName").textContent = `${product.emoji} ${product.name}`;
    document.getElementById("overlayPrice").innerHTML =
        priceLinesHtml(product) +
        (product.byWeight ? `<span class="overlay-bw-note">量り売り</span>` : "");

    document.getElementById("placeholderEmoji").textContent = product.emoji;
    document.getElementById("placeholderName").textContent = product.name;

    loadVideo(product);
    updateProgressDots();
}

function loadVideo(product) {
    const video = document.getElementById("stageVideo");
    const placeholder = document.getElementById("videoPlaceholder");

    clearTimeout(placeholderTimer);

    video.pause();
    video.removeAttribute("src");
    video.load();

    const src = `videos/product_${product.id}.mp4`;
    video.src = src;

    video.onerror = () => handleVideoUnavailable();
    video.oncanplay = () => {
        placeholder.classList.add("hidden");
        if (isPlaying && !isPanelOpen) {
            video.play().catch(() => {});
        }
    };
    video.onended = () => {
        if (isPlaying && !isPanelOpen) nextProduct();
    };

    placeholder.classList.remove("hidden");
    placeholderTimer = setTimeout(() => {
        if (video.readyState < 2) handleVideoUnavailable();
    }, 800);
}

function handleVideoUnavailable() {
    const video = document.getElementById("stageVideo");
    const placeholder = document.getElementById("videoPlaceholder");
    video.removeAttribute("src");
    placeholder.classList.remove("hidden");

    clearTimeout(placeholderTimer);
    if (isPlaying && !isPanelOpen) {
        placeholderTimer = setTimeout(() => {
            if (isPlaying && !isPanelOpen) nextProduct();
        }, PLACEHOLDER_DURATION);
    }
}

function nextProduct() { showProduct(currentIndex + 1); }
function prevProduct() { showProduct(currentIndex - 1); }

// ========================================
// ステージタップ
// ========================================
function setupStageEvents() {
    const stage = document.getElementById("videoStage");
    stage.addEventListener("click", (e) => {
        if (e.target.closest(".purchase-panel")) return;
        if (e.target.closest(".panel-close")) return;
        if (e.target.closest(".confirm-dialog")) return;
        if (!isPanelOpen) openPurchasePanel();
    });
}

// ========================================
// 購入パネル
// ========================================
function openPurchasePanel() {
    const product = filteredProducts[currentIndex];
    if (!product) return;

    isPanelOpen = true;
    selectedQty = 1;
    maxQtyVisible = 5;

    document.getElementById("panelEmoji").textContent = product.emoji;
    document.getElementById("panelName").textContent = product.name;
    document.getElementById("panelDesc").textContent =
        (product.byWeight ? "【量り売り】実際の重さでお値段が少し変わります。\n" : "")
        + product.desc;
    document.getElementById("panelPrice").innerHTML = priceLinesHtml(product);

    renderQtyOptions();

    document.getElementById("purchasePanel").classList.add("show");
    document.getElementById("videoStage").classList.add("tapped");

    pauseVideo();
    clearTimeout(placeholderTimer);
}

function closePurchasePanel() {
    isPanelOpen = false;
    document.getElementById("purchasePanel").classList.remove("show");
    document.getElementById("videoStage").classList.remove("tapped");
    if (isPlaying) resumePlaying();
}

function renderQtyOptions() {
    const container = document.getElementById("panelQtyOptions");
    let html = "";
    for (let i = 1; i <= maxQtyVisible; i++) {
        html += `<button class="qty-option ${i === selectedQty ? 'selected' : ''}" data-qty="${i}">${i}</button>`;
    }
    html += `<button class="qty-option qty-more" id="qtyMoreBtn">それ以上</button>`;
    container.innerHTML = html;

    container.querySelectorAll(".qty-option[data-qty]").forEach(btn => {
        btn.addEventListener("click", () => {
            selectedQty = parseInt(btn.dataset.qty);
            container.querySelectorAll(".qty-option[data-qty]").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
        });
    });

    document.getElementById("qtyMoreBtn").addEventListener("click", () => {
        maxQtyVisible += 5;
        renderQtyOptions();
    });
}

function setupPanelEvents() {
    document.getElementById("panelClose").addEventListener("click", closePurchasePanel);
    document.getElementById("panelCancel").addEventListener("click", closePurchasePanel);

    document.getElementById("panelAdd").addEventListener("click", () => {
        const product = filteredProducts[currentIndex];
        if (!product) return;
        openConfirmDialog(product, selectedQty);
    });

    document.getElementById("confirmNo").addEventListener("click", closeConfirmDialog);
    document.getElementById("confirmYes").addEventListener("click", () => {
        const product = filteredProducts[currentIndex];
        if (!product) return;
        addToCart(product, selectedQty);
        showAddedToast(product, selectedQty);
        closeConfirmDialog();
        closePurchasePanel();
    });
}

function openConfirmDialog(product, qty) {
    const pfx = product.byWeight ? "約 " : "";
    document.getElementById("confirmEmoji").textContent = product.emoji;
    document.getElementById("confirmName").textContent =
        (product.byWeight ? "【量り売り】" : "") + product.name;
    document.getElementById("confirmQty").textContent = `${qty}個`;
    document.getElementById("confirmPrice").innerHTML = priceLinesHtml(product);
    document.getElementById("confirmTotal").textContent =
        `${pfx}${(product.price * qty).toLocaleString()}円`;
    document.getElementById("confirmDialog").classList.add("show");
}

function closeConfirmDialog() {
    document.getElementById("confirmDialog").classList.remove("show");
}

function showAddedToast(product, qty) {
    const toast = document.getElementById("addedToast");
    document.getElementById("toastText").textContent =
        `${product.name} を ${qty}個 追加しました`;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
}

// ========================================
// 再生制御
// ========================================
function pauseVideo() {
    document.getElementById("stageVideo").pause();
}

function resumePlaying() {
    const video = document.getElementById("stageVideo");
    if (video.src && video.readyState >= 2) {
        video.play().catch(() => {});
    } else {
        handleVideoUnavailable();
    }
}

function togglePlay() {
    isPlaying = !isPlaying;
    const icon = document.getElementById("playIcon");
    const label = document.getElementById("playLabel");

    if (isPlaying) {
        icon.textContent = "⏸";
        label.textContent = "一時停止";
        if (!isPanelOpen) resumePlaying();
    } else {
        icon.textContent = "▶";
        label.textContent = "再生";
        pauseVideo();
        clearTimeout(placeholderTimer);
    }
}

function setupControlButtons() {
    document.getElementById("prevBtn").addEventListener("click", () => {
        if (isPanelOpen) closePurchasePanel();
        prevProduct();
    });
    document.getElementById("nextBtn").addEventListener("click", () => {
        if (isPanelOpen) closePurchasePanel();
        nextProduct();
    });
    document.getElementById("playBtn").addEventListener("click", togglePlay);
}

function setupCategoryButtons() {
    document.querySelectorAll(".category-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".category-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentCategory = btn.dataset.category;
            applyFilter();
            renderProgressDots();
            if (isPanelOpen) closePurchasePanel();
            showProduct(0);
        });
    });
}

function renderProgressDots() {
    const container = document.getElementById("progressDots");
    container.innerHTML = filteredProducts.map((_, i) => `
        <span class="progress-dot ${i === currentIndex ? 'active' : ''}" data-idx="${i}"></span>
    `).join("");
    container.querySelectorAll(".progress-dot").forEach(dot => {
        dot.addEventListener("click", () => {
            if (isPanelOpen) closePurchasePanel();
            showProduct(parseInt(dot.dataset.idx));
        });
    });
}

function updateProgressDots() {
    document.querySelectorAll(".progress-dot").forEach((dot, i) => {
        dot.classList.toggle("active", i === currentIndex);
    });
}
