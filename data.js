// ========================================
// データローダー（地区別 JSON を読み込み）
// ========================================
// 各地区のデータは /data/<region>/{products,categories,sets}.json
// dataReady Promise が解決するまで products/categories/mealSets は空配列。
// 既存スクリプトは配列参照を保持しているため、push で中身を差し込む。
// ========================================

const REGION_STORAGE_KEY = "buyimono_region";
const AVAILABLE_REGIONS = [
    { id: "nara",   name: "奈良" },
    { id: "nagoya", name: "名古屋" }
];
const DEFAULT_REGION = "nara";

// 現在の地区（localStorage に保存）
function getCurrentRegion() {
    const v = localStorage.getItem(REGION_STORAGE_KEY);
    if (v && AVAILABLE_REGIONS.some(r => r.id === v)) return v;
    return DEFAULT_REGION;
}

function setCurrentRegion(regionId) {
    if (!AVAILABLE_REGIONS.some(r => r.id === regionId)) return;
    localStorage.setItem(REGION_STORAGE_KEY, regionId);
}

function getRegionName(regionId) {
    const r = AVAILABLE_REGIONS.find(x => x.id === regionId);
    return r ? r.name : regionId;
}

// 配列の参照を保持しておき、フェッチ完了後に中身を差し替える
const products   = [];
const categories = [];
const mealSets   = [];

function getProduct(id) {
    return products.find(p => p.id === id);
}

// ロード Promise（各スクリプトはこれを await してから処理開始する）
const dataReady = (async () => {
    const region = getCurrentRegion();
    try {
        const [p, c, s] = await Promise.all([
            fetch(`data/${region}/products.json`).then(r => {
                if (!r.ok) throw new Error(`products.json ${r.status}`);
                return r.json();
            }),
            fetch(`data/${region}/categories.json`).then(r => {
                if (!r.ok) throw new Error(`categories.json ${r.status}`);
                return r.json();
            }),
            fetch(`data/${region}/sets.json`).then(r => {
                if (!r.ok) throw new Error(`sets.json ${r.status}`);
                return r.json();
            })
        ]);
        products.length = 0;   p.forEach(x => products.push(x));
        categories.length = 0; c.forEach(x => categories.push(x));
        mealSets.length = 0;   s.forEach(x => mealSets.push(x));
    } catch (err) {
        console.error("データ読み込みに失敗しました:", err);
        showDataLoadError(err);
        throw err;
    }
})();

function showDataLoadError(err) {
    if (document.body) {
        const div = document.createElement("div");
        div.style.cssText = "position:fixed;inset:0;background:#fff;display:flex;align-items:center;justify-content:center;font-family:sans-serif;padding:20px;text-align:center;z-index:99999;";
        div.innerHTML = `
            <div style="max-width:480px;">
                <div style="font-size:3rem;margin-bottom:10px;">😢</div>
                <h2 style="color:#c92a2a;">データを読み込めませんでした</h2>
                <p style="line-height:1.7;color:#555;">
                    ブラウザでファイルを直接開いている場合、<br>
                    JSONファイルを読み込めないことがあります。<br><br>
                    ローカルサーバー（例：<code>python -m http.server</code>）<br>
                    で実行してください。
                </p>
                <pre style="background:#f5f5f5;padding:10px;border-radius:8px;text-align:left;font-size:0.85rem;color:#666;overflow:auto;">${err && err.message ? err.message : err}</pre>
            </div>
        `;
        document.body.appendChild(div);
    }
}
