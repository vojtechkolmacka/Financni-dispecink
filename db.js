// Správa lokálního úložiště IndexedDB, tichého zrcadlení a výchozí data
const DB_NAME = 'KolobeznikDispecinkDB';
const DB_VERSION = 6;

let dbInstance = null;

const Money = {
  toCents: (czk) => Math.round(Number(czk) * 100),
  toCzk: (cents) => (cents / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kč',
  toCzkInt: (cents) => Math.round(cents / 100).toLocaleString('cs-CZ') + ' Kč'
};

const CLOUD_CONFIG = {
  tokenKey: 'dispecink_gh_token',
  gistKey: 'dispecink_gist_id'
};

function initDB() {
  return new Promise((resolve, reject) => {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const stores = ['settings', 'templates', 'entries', 'goals', 'debts', 'energy', 'meter_readings', 'investments', 'gold_bars'];
      
      stores.forEach(s => {
        if (!db.objectStoreNames.contains(s)) {
          if (s === 'settings') {
            db.createObjectStore(s, { keyPath: 'key' });
          } else {
            const os = db.createObjectStore(s, { keyPath: 'id', autoIncrement: true });
            if (s === 'entries') {
              os.createIndex('monthYear', 'monthYear', { unique: false });
            }
          }
        }
      });
    };

    request.onsuccess = async (event) => {
      dbInstance = event.target.result;
      try {
        const restored = await autoRestoreFromCloud();
        if (!restored) {
          await seedInitialData();
        }
      } catch (e) {
        console.warn('Init error:', e);
      }
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('Chyba při otevírání IndexedDB:', event.target.error);
      reject(event.target.error);
    };
  });
}

async function seedInitialData() {
  const settings = await dbGet('settings', 'initial_capital');
  if (settings) {
    await ensureUpdatedLoanData();
    return;
  }

  await dbSetInternal('settings', { key: 'initial_capital', value: 5100000 });
  await dbSetInternal('settings', { key: 'bank_capital', value: 4600000 });
  await dbSetInternal('settings', { key: 'cash_capital', value: 500000 });
  await dbSetInternal('settings', { key: 'payday', value: 10 });
  await dbSetInternal('settings', { key: 'kwh_price', value: 650 });

  await dbSetInternal('settings', {
    key: 'itown_data',
    invested: 718116,
    profit: 344302
  });

  const templates = [
    { title: 'ČEZ (elektřina)', amount: 300000, category: 'Energie', day: 15, frequency: 'monthly', dueMonths: [], active: true },
    { title: 'Terapie', amount: 200000, category: 'Zdraví & Lékárna', day: 1, frequency: 'monthly', dueMonths: [], active: true },
    { title: 'Provident (splátka)', amount: 150000, category: 'Závazky', day: 10, frequency: 'monthly', dueMonths: [], active: true },
    { title: 'AvaFin / Crediton (splátka)', amount: 110000, category: 'Závazky', day: 10, frequency: 'monthly', dueMonths: [], active: true },
    { title: 'Investown (pravidelná investice)', amount: 50000, category: 'Investice', day: 10, frequency: 'monthly', dueMonths: [], active: true },
    { title: 'T-Mobile (internet)', amount: 45000, category: 'Komunikace', day: 20, frequency: 'monthly', dueMonths: [], active: true },
    { title: 'Vodafone (telefon)', amount: 26600, category: 'Komunikace', day: 15, frequency: 'monthly', dueMonths: [], active: true },
    { title: 'ChatGPT Go', amount: 20000, category: 'Služby', day: 1, frequency: 'monthly', dueMonths: [], active: true },
    { title: 'Spotify', amount: 18500, category: 'Služby', day: 5, frequency: 'monthly', dueMonths: [], active: true },
    { title: 'Česká televize', amount: 15000, category: 'Služby', day: 15, frequency: 'monthly', dueMonths: [], active: true },
    { title: 'Google AI Pro', amount: 13990, category: 'Služby', day: 8, frequency: 'monthly', dueMonths: [], active: true },
    { title: 'Penzijní příspěvek', amount: 10000, category: 'Investice', day: 15, frequency: 'monthly', dueMonths: [], active: true },
    { title: 'SIPO', amount: 7700, category: 'Bydlení', day: 12, frequency: 'monthly', dueMonths: [], active: true },
    { title: 'Pojištění nemovitosti', amount: 155900, category: 'Bydlení', day: 20, frequency: 'semi-annual', dueMonths: [5, 11], active: true },
    { title: 'Povinné ručení', amount: 65100, category: 'Doprava & Benzín', day: 15, frequency: 'annual', dueMonths: [7], active: true },
    { title: 'Svoz odpadu', amount: 82100, category: 'Bydlení', day: 15, frequency: 'annual', dueMonths: [1], active: true }
  ];
  for (const t of templates) await dbAddInternal('templates', t);

  const goals = [
    { title: 'Brikety na zimu', target: 1100000, priority: 1, paused: false },
    { title: 'Právní výdaje', target: 2000000, priority: 2, paused: false },
    { title: 'Železná finanční rezerva', target: 6000000, priority: 3, paused: false },
    { title: 'Zubní náhrada', target: 3000000, priority: 4, paused: true },
    { title: 'Koloběžka', target: 2500000, priority: 5, paused: true },
    { title: 'Cestování (Itálie, Monako, Nice)', target: 1600000, priority: 6, paused: true }
  ];
  for (const g of goals) await dbAddInternal('goals', g);

  // Detailní rozpis závazků a pohledávek
  const debts = [
    {
      type: 'payable',
      name: 'Provident',
      total: 7732733, // 77 327,33 Kč
      monthly: 150000, // 1 500 Kč
      day: 10,
      contractNumber: 'PRV-2024-88',
      principalLeft: 5800000, // Zbývající jistina
      feeLeft: 1932733, // Úroky a poplatky
      paidSoFar: 2250000, // Již zaplaceno
      items: [
        { label: 'Půjčka / Jistina k doplacení', amount: 5800000 },
        { label: 'Poplatky a úrok', amount: 1932733 }
      ]
    },
    {
      type: 'payable',
      name: 'AvaFin / Crediton',
      total: 1952400, // 19 524,00 Kč
      monthly: 110000, // 1 100 Kč
      day: 10,
      contractNumber: 'CRD-55019',
      principalLeft: 1500000,
      feeLeft: 452400,
      paidSoFar: 880000,
      items: [
        { label: 'Půjčka / Jistina k doplacení', amount: 1500000 },
        { label: 'Poplatky za správu a úrok', amount: 452400 }
      ]
    },
    {
      type: 'receivable',
      name: 'KOV',
      total: 665000,
      items: [
        { id: 'kov_1', label: 'Půjčky', amount: 340000 },
        { id: 'kov_2', label: 'Elektřina a drogerie', amount: 275000 },
        { id: 'kov_3', label: 'Fólie na bazén', amount: 50000 }
      ]
    },
    {
      type: 'receivable',
      name: 'JIŘÍ',
      total: 75000,
      items: [
        { id: 'jiri_1', label: 'Půjčky', amount: 0 },
        { id: 'jiri_2', label: 'Elektřina a drogerie', amount: 25000, note: 'Zaplaceno 1 250 Kč (2026-10-13)' },
        { id: 'jiri_3', label: 'Fólie na bazén', amount: 50000 }
      ]
    },
    {
      type: 'receivable',
      name: 'MAGDA',
      total: 270000,
      items: [
        { id: 'magda_1', label: 'Půjčky', amount: 70000 },
        { id: 'magda_2', label: 'Elektřina a drogerie', amount: 150000 },
        { id: 'magda_3', label: 'Fólie na bazén', amount: 50000 }
      ]
    }
  ];
  for (const d of debts) await dbAddInternal('debts', d);

  const meterReadings = [
    { date: '2026-08-31', value: 12100.0, note: 'Konec léta' },
    { date: '2026-09-30', value: 12480.0, note: 'Začátek podzimu' },
    { date: '2026-10-31', value: 12940.0, note: 'Topná sezóna začala' }
  ];
  for (const m of meterReadings) await dbAddInternal('meter_readings', m);
}

// Zajištění podrobných položek u existujících záznamů půjček
async function ensureUpdatedLoanData() {
  const debts = await dbGetAll('debts');
  let changed = false;

  for (const d of debts) {
    if (d.type === 'payable' && (!d.items || d.items.length === 0)) {
      if (d.name.includes('Provident')) {
        d.principalLeft = Math.round(d.total * 0.75);
        d.feeLeft = d.total - d.principalLeft;
        d.items = [
          { label: 'Půjčka / Jistina k doplacení', amount: d.principalLeft },
          { label: 'Poplatky a úrok', amount: d.feeLeft }
        ];
        changed = true;
      } else if (d.name.includes('AvaFin') || d.name.includes('Crediton')) {
        d.principalLeft = Math.round(d.total * 0.77);
        d.feeLeft = d.total - d.principalLeft;
        d.items = [
          { label: 'Půjčka / Jistina k doplacení', amount: d.principalLeft },
          { label: 'Poplatky za správu a úrok', amount: d.feeLeft }
        ];
        changed = true;
      }
      await dbSetInternal('debts', d);
    }
  }

  if (changed) triggerAutoCloudSync();
}

function dbGet(storeName, key) {
  return new Promise((resolve) => {
    if (!dbInstance || !dbInstance.objectStoreNames.contains(storeName)) return resolve(null);
    try {
      const tx = dbInstance.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve) => {
    if (!dbInstance || !dbInstance.objectStoreNames.contains(storeName)) return resolve([]);
    try {
      const tx = dbInstance.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

function dbSetInternal(storeName, val) {
  return new Promise((resolve, reject) => {
    try {
      const tx = dbInstance.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(val);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

function dbAddInternal(storeName, val) {
  return new Promise((resolve, reject) => {
    try {
      const tx = dbInstance.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.add(val);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

async function dbSet(storeName, val) {
  const res = await dbSetInternal(storeName, val);
  triggerAutoCloudSync();
  return res;
}

async function dbAdd(storeName, val) {
  const res = await dbAddInternal(storeName, val);
  triggerAutoCloudSync();
  return res;
}

async function dbDelete(storeName, key) {
  return new Promise((resolve) => {
    try {
      const tx = dbInstance.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => {
        triggerAutoCloudSync();
        resolve(true);
      };
      req.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

let syncTimeout = null;
function triggerAutoCloudSync() {
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    await autoSyncToCloud();
  }, 1000);
}

async function autoSyncToCloud() {
  const tokenRecord = await dbGet('settings', CLOUD_CONFIG.tokenKey);
  const token = tokenRecord ? tokenRecord.value : null;
  if (!token) return;

  const gistRecord = await dbGet('settings', CLOUD_CONFIG.gistKey);
  let gistId = gistRecord ? gistRecord.value : null;

  try {
    const backup = await createFullBackup();
    const payload = {
      description: "Koloběžníkův finanční dispečink - Automatická ochrana dat",
      public: false,
      files: {
        "kolobeznik_dispecink_backup.json": { content: JSON.stringify(backup, null, 2) }
      }
    };

    let url = 'https://api.github.com/gists';
    let method = 'POST';

    if (gistId) {
      url += `/${gistId}`;
      method = 'PATCH';
    }

    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      if (!gistId && data.id) {
        await dbSetInternal('settings', { key: CLOUD_CONFIG.gistKey, value: data.id });
        localStorage.setItem(CLOUD_CONFIG.gistKey, data.id);
      }
    }
  } catch (err) {}
}

async function autoRestoreFromCloud() {
  const localGistId = localStorage.getItem(CLOUD_CONFIG.gistKey);
  const localToken = localStorage.getItem(CLOUD_CONFIG.tokenKey);
  if (!localGistId || !localToken) return false;

  try {
    const res = await fetch(`https://api.github.com/gists/${localGistId}`, {
      headers: { 'Authorization': `Bearer ${localToken}` }
    });
    if (!res.ok) return false;
    const gist = await res.json();
    const raw = gist.files['kolobeznik_dispecink_backup.json']?.content;
    if (raw) {
      const backupData = JSON.parse(raw);
      await restoreFromBackup(backupData);
      await dbSetInternal('settings', { key: CLOUD_CONFIG.tokenKey, value: localToken });
      await dbSetInternal('settings', { key: CLOUD_CONFIG.gistKey, value: localGistId });
      return true;
    }
  } catch (err) {}
  return false;
}
