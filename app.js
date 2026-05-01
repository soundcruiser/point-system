import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc, addDoc, collection, query, where, getDocs, serverTimestamp, increment, orderBy, limit } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let scanner = null;
let currentMode = ''; 
let selectedItem = null;

const items = [
    { id: 'coffee', name: 'コーヒー', cost: 50 },
    { id: 'print', name: 'プリント', cost: 10 },
    { id: 'nikuman', name: '肉まん', cost: 100 }
];

// --- 画面操作（windowに登録してHTMLのonclickから呼べるようにする） ---
window.hideSections = function() {
    console.log("全セクション非表示");
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById('menu').classList.remove('hidden');
    
    // カメラが動いていれば、画面遷移の邪魔をしないよう「後回し」で止める
    if (scanner && scanner.isScanning) {
        scanner.stop().catch(() => {});
    }
};

window.stopScanner = function() {
    console.log("キャンセル実行");
    window.hideSections();
};

function startProcess(mode) {
    currentMode = mode;
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('qr-section').classList.remove('hidden');
    document.getElementById('mode-title').innerText = mode === 'attendance' ? "出席QRをスキャン" : "利用者QRをスキャン";
    initScanner();
}

function showItems() {
    const list = document.getElementById('item-list');
    list.innerHTML = items.map(i => `
        <div class="item-card" id="item-${i.id}" style="cursor:pointer; border:1px solid #ccc; margin:10px; padding:15px; border-radius:8px; background:#fff;">
            <span>${i.name}</span>
            <strong>${i.cost}pt</strong>
        </div>
    `).join('');
    
    items.forEach(i => {
        const el = document.getElementById(`item-${i.id}`);
        if(el) el.onclick = () => {
            selectedItem = i;
            document.getElementById('item-section').classList.add('hidden');
            startProcess('redeem');
        };
    });
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('item-section').classList.remove('hidden');
}

async function viewHistory() {
    const list = document.getElementById('history-list');
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('history-section').classList.remove('hidden');
    list.innerHTML = "読み込み中...";
    try {
        const q = query(collection(db, "transactions"), limit(20));
        const snap = await getDocs(q);
        if (snap.empty) {
            list.innerHTML = "履歴はありません";
            return;
        }
        let html = "";
        snap.forEach(doc => {
            const d = doc.data();
            const date = d.date || "不明";
            html += `<div style="border-bottom:1px solid #eee; padding:10px;">${date} - ${d.userId}: ${d.type === 'attendance' ? '出席(+10)' : (d.item || '交換') + '(' + d.points + ')'}</div>`;
        });
        list.innerHTML = html;
    } catch (e) { 
        console.error(e);
        list.innerHTML = "エラー: " + e.message; 
    }
}

// --- QR処理 ---
function initScanner() {
    if (!scanner) scanner = new Html5Qrcode("reader");
    scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (text) => {
            window.stopScanner(); // 成功時もこれを使う
            if (currentMode === 'attendance') processAttendance(text);
            if (currentMode === 'redeem') processRedeem(text);
        }
    ).catch(err => {
        console.error("カメラ起動エラー:", err);
        addLog("カメラを起動できませんでした");
    });
}

// --- Firebase処理 ---
async function processAttendance(userId) {
    const today = new Date().toISOString().split('T')[0];
    const userRef = doc(db, "users", userId);
    try {
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return addLog("未登録の利用者です");
        const q = query(collection(db, "transactions"), where("userId", "==", userId), where("date", "==", today), where("type", "==", "attendance"));
        const history = await getDocs(q);
        if (!history.empty) return addLog("本日は付与済みです");
        await updateDoc(userRef, { points: increment(10) });
        await addDoc(collection(db, "transactions"), { userId, type: "attendance", points: 10, date: today, timestamp: serverTimestamp() });
        addLog("10pt付与しました！");
    } catch (e) { addLog("通信エラー"); }
}

async function processRedeem(userId) {
    const userRef = doc(db, "users", userId);
    try {
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return addLog("利用者不明");
        const data = userSnap.data();
        if (data.points < selectedItem.cost) return addLog("ポイント不足");
        await updateDoc(userRef, { points: increment(-selectedItem.cost) });
        await addDoc(collection(db, "transactions"), { userId, type: "redeem", item: selectedItem.name, points: -selectedItem.cost, date: new Date().toISOString().split('T')[0], timestamp: serverTimestamp() });
        addLog(selectedItem.name + "と交換しました！");
    } catch (e) { addLog("交換失敗"); }
}

function addLog(msg) {
    const log = document.getElementById('log-container');
    if(!log) return;
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerText = msg;
    log.prepend(div);
    setTimeout(() => div.remove(), 5000);
}

// --- ボタンの初期設定 ---
window.addEventListener('DOMContentLoaded', () => {
    // メインボタン
    document.getElementById('btn-attendance').onclick = () => startProcess('attendance');
    document.getElementById('btn-items').onclick = () => showItems();
    document.getElementById('btn-history').onclick = () => viewHistory();
    
    // 戻るボタン系（念押しでJavaScriptからも紐付け）
    document.getElementById('btn-qr-cancel').onclick = () => window.stopScanner();
    document.getElementById('btn-item-back').onclick = () => window.hideSections();
    document.getElementById('btn-history-back').onclick = () => window.hideSections();
});
