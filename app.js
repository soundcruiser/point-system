import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc, addDoc, setDoc, collection, query, where, getDocs, serverTimestamp, increment, orderBy, limit } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
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
window.hideSections = function() {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById('menu').classList.remove('hidden');
    if (scanner && scanner.isScanning) {
        scanner.stop().catch(() => {});
    }
};

window.stopScanner = function() {
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

// --- 利用者管理機能 ---
window.viewUsers = async function() {
    const list = document.getElementById('user-list');
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('user-admin-section').classList.remove('hidden');
    list.innerHTML = "読み込み中...";
    try {
        const snap = await getDocs(collection(db, "users"));
        if (snap.empty) {
            list.innerHTML = "登録された利用者はいません";
            return;
        }
        let html = "<table style='width:100%; border-collapse: collapse; font-size: 14px;'>";
        html += "<tr style='background:#eee;'><th>ID</th><th>名前</th><th>pt</th></tr>";
        snap.forEach(doc => {
            const u = doc.data();
            html += `<tr style='border-bottom:1px solid #ddd;'>
                <td style='padding:8px;'>${doc.id}</td>
                <td style='padding:8px;'>${u.name || '---'}</td>
                <td style='padding:8px; text-align:right;'>${u.points}pt</td>
            </tr>`;
        });
        html += "</table>";
        list.innerHTML = html;
    } catch (e) { list.innerHTML = "読み込みエラー"; }
};

window.addUser = async function() {
    const id = document.getElementById('new-user-id').value.trim();
    const name = document.getElementById('new-user-name').value.trim();
    if(!id || !name) return addLog("入力してください");
    try {
        await setDoc(doc(db, "users", id), {
            name: name,
            points: 0,
            createdAt: serverTimestamp()
        });
        addLog("登録完了！");
        document.getElementById('new-user-id').value = "";
        document.getElementById('new-user-name').value = "";
        window.viewUsers(); 
    } catch (e) { addLog("登録失敗"); }
};

// --- 履歴表示 ---
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
            html += `<div style="border-bottom:1px solid #eee; padding:10px; font-size:14px;">${d.userId}: ${d.type === 'attendance' ? '出席(+10)' : (d.item || '交換') + '(' + d.points + ')'}</div>`;
        });
        list.innerHTML = html;
    } catch (e) { list.innerHTML = "エラー: " + e.message; }
}

// --- QR処理 ---
function initScanner() {
    if (!scanner) scanner = new Html5Qrcode("reader");
    scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (text) => {
        window.stopScanner();
        if (currentMode === 'attendance') processAttendance(text);
        if (currentMode === 'redeem') processRedeem(text);
    }).catch(() => addLog("カメラ起動失敗"));
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
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerText = msg;
    log.prepend(div);
    setTimeout(() => div.remove(), 5000);
}

// --- ボタン初期設定 ---
window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-attendance').onclick = () => startProcess('attendance');
    document.getElementById('btn-items').onclick = () => showItems();
    document.getElementById('btn-history').onclick = () => viewHistory();
    document.getElementById('btn-user-admin').onclick = () => window.viewUsers();
});
