'use strict';

/* ---------- 設定 ---------- */
const DEFAULTS = { openaiModel: 'gpt-image-1', geminiModel: 'imagen-4.0-generate-001' };
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d = '') { try { return localStorage.getItem('afi.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('afi.' + k, v); } catch {} },
};

/* ---------- IndexedDB（画像の保存） ---------- */
const db = (() => {
  let p;
  const open = () => p ??= new Promise((res, rej) => {
    const r = indexedDB.open('afi', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('images', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction('images', mode);
      const req = fn(t.objectStore('images'));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    all: () => tx('readonly', (s) => s.getAll()),
    put: (v) => tx('readwrite', (s) => s.put(v)),
    del: (id) => tx('readwrite', (s) => s.delete(id)),
    clear: () => tx('readwrite', (s) => s.clear()),
  };
})();

/* ---------- 各サービスの呼び出し ---------- */
const b64ToBlob = (b64, type = 'image/png') => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
};

async function errorText(res) {
  try { const j = await res.json(); return j.error?.message || JSON.stringify(j); }
  catch { return `${res.status} ${res.statusText}`; }
}

const providers = {
  async pollinations({ prompt, aspect, count }) {
    const [w, h] = { '1:1': [1024, 1024], '3:4': [864, 1152], '9:16': [720, 1280], '4:3': [1152, 864], '16:9': [1280, 720] }[aspect];
    const jobs = Array.from({ length: count }, async () => {
      const seed = Math.floor(Math.random() * 1e9);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(await errorText(res));
      return res.blob();
    });
    return Promise.all(jobs);
  },

  async openai({ prompt, aspect, count }) {
    const key = store.get('openaiKey');
    if (!key) throw new Error('設定で OpenAI APIキーを入力してください');
    const size = aspect === '1:1' ? '1024x1024' : ['3:4', '9:16'].includes(aspect) ? '1024x1536' : '1536x1024';
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: store.get('openaiModel', DEFAULTS.openaiModel), prompt, size, n: count }),
    });
    if (!res.ok) throw new Error(await errorText(res));
    const json = await res.json();
    return json.data.map((d) => b64ToBlob(d.b64_json));
  },

  async gemini({ prompt, aspect, count }) {
    const key = store.get('geminiKey');
    if (!key) throw new Error('設定で Gemini APIキーを入力してください');
    const model = store.get('geminiModel', DEFAULTS.geminiModel);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: count, aspectRatio: aspect } }),
    });
    if (!res.ok) throw new Error(await errorText(res));
    const json = await res.json();
    const preds = json.predictions || [];
    if (!preds.length) throw new Error('画像が返されませんでした（安全フィルタの可能性があります）');
    return preds.map((p) => b64ToBlob(p.bytesBase64Encoded, p.mimeType || 'image/png'));
  },
};

/* ---------- UI ---------- */
let aspect = store.get('aspect', '1:1');
let items = [];
let current = null;
const urls = new Map();
const urlFor = (it) => { if (!urls.has(it.id)) urls.set(it.id, URL.createObjectURL(it.blob)); return urls.get(it.id); };

function setStatus(msg, isError = false) {
  $('status').textContent = msg;
  $('status').classList.toggle('error', isError);
}

function render(pending = 0) {
  const g = $('gallery');
  g.replaceChildren();
  for (let i = 0; i < pending; i++) {
    const ph = document.createElement('button');
    ph.className = 'placeholder';
    ph.textContent = '生成中…';
    ph.disabled = true;
    g.append(ph);
  }
  for (const it of items) {
    const b = document.createElement('button');
    const img = document.createElement('img');
    img.src = urlFor(it);
    img.alt = it.prompt;
    img.loading = 'lazy';
    b.append(img);
    b.onclick = () => openViewer(it);
    g.append(b);
  }
  $('empty').hidden = items.length + pending > 0;
}

async function generate() {
  const prompt = $('prompt').value.trim();
  if (!prompt) { setStatus('プロンプトを入力してください', true); $('prompt').focus(); return; }
  const provider = $('provider').value;
  const count = Number($('count').value);
  $('generate').disabled = true;
  setStatus('生成中…（数十秒かかることがあります）');
  render(count);
  const started = Date.now();
  try {
    const blobs = await providers[provider]({ prompt, aspect, count });
    const now = Date.now();
    const created = blobs.map((blob, i) => ({ id: `${now}-${i}`, prompt, provider, aspect, createdAt: now, blob }));
    for (const it of created) await db.put(it);
    items = [...created, ...items];
    setStatus(`${created.length}枚 生成しました（${((Date.now() - started) / 1000).toFixed(1)}秒）`);
  } catch (e) {
    setStatus('エラー: ' + (e.message || e), true);
  } finally {
    $('generate').disabled = false;
    render();
  }
}

function openViewer(it) {
  current = it;
  $('viewerImg').src = urlFor(it);
  $('viewerPrompt').textContent = it.prompt;
  $('vShare').hidden = !navigator.canShare;
  $('viewer').showModal();
}

const fileFor = (it) => new File([it.blob], `afi-${it.id}.${(it.blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: it.blob.type });

$('vShare').onclick = async () => {
  const file = fileFor(current);
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: current.prompt });
    else $('vSave').click();
  } catch (e) { if (e.name !== 'AbortError') alert(e.message); }
};
$('vSave').onclick = () => {
  const a = document.createElement('a');
  a.href = urlFor(current);
  a.download = fileFor(current).name;
  a.click();
};
$('vReuse').onclick = () => {
  $('prompt').value = current.prompt;
  $('viewer').close();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
$('vDelete').onclick = async () => {
  if (!confirm('この画像を削除しますか？')) return;
  await db.del(current.id);
  URL.revokeObjectURL(urls.get(current.id));
  urls.delete(current.id);
  items = items.filter((x) => x.id !== current.id);
  $('viewer').close();
  render();
};
$('vClose').onclick = () => $('viewer').close();

$('clearAll').onclick = async () => {
  if (!items.length || !confirm('すべての画像を削除しますか？')) return;
  await db.clear();
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
  items = [];
  render();
};

// 縦横比
for (const chip of $('aspect').children) {
  chip.classList.toggle('active', chip.dataset.v === aspect);
  chip.onclick = () => {
    aspect = chip.dataset.v;
    store.set('aspect', aspect);
    for (const c of $('aspect').children) c.classList.toggle('active', c === chip);
  };
}

// 前回の選択を復元
$('provider').value = store.get('provider', 'pollinations');
$('count').value = store.get('count', '1');
$('prompt').value = store.get('draft');
$('provider').onchange = () => store.set('provider', $('provider').value);
$('count').onchange = () => store.set('count', $('count').value);
$('prompt').oninput = () => store.set('draft', $('prompt').value);
$('generate').onclick = generate;
$('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); });

// 設定
const settingKeys = ['openaiKey', 'openaiModel', 'geminiKey', 'geminiModel'];
$('openSettings').onclick = () => {
  for (const k of settingKeys) $(k).value = store.get(k, DEFAULTS[k] || '');
  $('settings').showModal();
};
$('settings').addEventListener('close', () => {
  if ($('settings').returnValue !== 'save') return;
  for (const k of settingKeys) store.set(k, $(k).value.trim() || DEFAULTS[k] || '');
  setStatus('設定を保存しました');
});

// 起動
db.all().then((all) => { items = all.sort((a, b) => b.createdAt - a.createdAt); render(); })
  .catch(() => { setStatus('この環境では履歴を保存できません', true); render(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
