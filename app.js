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

// --- 画面操作 ---
window.startProcess = (mode) => {
    currentMode = mode;
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('qr-section').classList.remove('hidden');
    document.getElementById('mode-title').innerText = mode === 'attendance' ? "出席QRをスキャン" : "利用者QRをスキャン";
    initScanner();
};

window.showItems = () => {
    const list = document.getElementById('item-list');
    list.innerHTML = items.map(i => `
        <div class="item-card" onclick="selectItem('${i.id}')">
            <span>${i.name}</span>
            <strong>${i.cost}pt</strong>
        </div>
    `).join('');
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('item-section').classList.remove('hidden');
};

window.selectItem = (itemId) => {
    selectedItem = items.find(i => i.id === itemId);
    document.getElementById('item-section').classList.add('hidden');
    startProcess('redeem');
};

window.hideSections = () => {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById('menu').classList.remove('hidden');
};

// --- QRコード処理 ---
function initScanner() {
    scanner = new Html5Qrcode("reader");
    scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (text) => {
            stopScanner();
            if (currentMode === 'attendance') processAttendance(text);
            if (currentMode === 'redeem') processRedeem(text);
        }
    ).catch(err => addLog("カメラの起動に失敗しました"));
}

window.stopScanner = () => {
    if (scanner) {
        scanner.stop().then(() => {
            hideSections();
        });
    }
};

// --- ポイント処理 ---
async function processAttendance(userId) {
    const today = new Date().toISOString().split('T')[0];
    const userRef = doc(db, "users", userId);
    
    try {
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return addLog("エラー: 利用者が登録されていません");

        const q = query(collection(db, "transactions"), 
            where("userId", "==", userId), where("date", "==", today), where("type", "==", "attendance"));
        const history = await getDocs(q);

        if (!history.empty) return addLog("本日は既に付与済みです");

        await updateDoc(userRef, { points: increment(10) });
        await addDoc(collection(db, "transactions"), {
            userId, type: "attendance", points: 10, date: today, timestamp: serverTimestamp()
        });
        addLog(`${userSnap.data().name}さんに10pt付与しました`);
    } catch (e) { addLog("エラーが発生しました"); }
}

async function processRedeem(userId) {
    const userRef = doc(db, "users", userId);
    try {
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return addLog("利用者が見つかりません");
        const data = userSnap.data();

        if (data.points < selectedItem.cost) return addLog("ポイント不足です");

        await updateDoc(userRef, { points: increment(-selectedItem.cost) });
        await addDoc(collection(db, "transactions"), {
            userId, type: "redeem", item: selectedItem.name, points: -selectedItem.cost,
            date: new Date().toISOString().split('T')[0], timestamp: serverTimestamp()
        });
        addLog(`${selectedItem.name}を交換しました（残:${data.points - selectedItem.cost}）`);
    } catch (e) { addLog("通信エラー"); }
}

function addLog(msg) {
    const log = document.getElementById('log-container');
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerText = msg;
    log.prepend(div);
    setTimeout(() => div.remove(), 5000);
}

// ボタンと機能を紐付ける設定
document.getElementById('btn-attendance').addEventListener('click', () => startProcess('attendance'));
document.getElementById('btn-items').addEventListener('click', () => showItems());
document.getElementById('btn-history').addEventListener('click', () => viewHistory());

// キャンセルボタンなどにも必要なら同様に追加します