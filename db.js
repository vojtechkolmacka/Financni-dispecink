// Správa lokálního úložiště IndexedDB, tichého zrcadlení a výchozí data
const DB_NAME = 'KolobeznikDispecinkDB';
const DB_VERSION = 4;

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
      navigator.storage.persist().then(persisted => {
        console.log(`Perzistence úložiště: ${persisted ? 'Povolena' : 'Standardní'}`);
      });
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains('templates')) {
        db.createObjectStore('templates', { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains('entries')) {
        const entryStore = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        entryStore.createIndex('monthYear', 'monthYear', { unique: false });
      }

      if (!db.objectStoreNames.contains('goals')) {
        db.createObjectStore('goals', { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains('debts')) {
        db.createObjectStore('debts', { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains('energy')) {
        db.createObjectStore('energy', { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains('meter_readings')) {
        db.createObjectStore('meter_readings', { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains('investments')) {
        db.createObjectStore('investments', { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains('gold_bars')) {
        db.createObjectStore('gold_bars', { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = async (event) => {
      dbInstance = event.target.result;

      const restored = await autoRestoreFromCloud();
      if (!restored) {
        await seedInitialData();
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
    // Aktualizace šablon pokud již existují data
    await ensureUpdatedTemplates();
    return;
  }

  console.log('Inicializace výchozích dat dispečinku...');

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
    // 1. Měsíční mandatorní platby
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

    // 2. Pololetní platby
    // Pojištění nemovitosti: 1 559 Kč v 11 (listopad) a 5 (květen)
    { title: 'Pojištění nemovitosti', amount: 155900, category: 'Bydlení', day: 20, frequency: 'semi-annual', dueMonths: [5, 11], active: true },

    // 3. Roční platby
    // Povinné ručení: 651 Kč v červenci (7)
    { title: 'Povinné ručení', amount: 65100, category: 'Doprava & Benzín', day: 15, frequency: 'annual', dueMonths: [7], active: true },
    // Svoz odpadu: 821 Kč v lednu (1)
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

  const debts = [
    { type: 'payable', name: 'Provident', total: 7732733, monthly: 150000, day: 10 },
    { type: 'payable', name: 'AvaFin / Crediton', total: 1952400, monthly: 110000, day: 10 },
    { type: 'receivable', name: 'KOV', total: 665000, note: 'Půjčky, elektřina, drogerie, bazén' },
    { type: 'receivable', name: 'JIŘÍ', total: 75000, note: 'Elektřina, drogerie, bazén' },
    { type: 'receivable', name: 'MAGDA', total: 270000, note: 'Elektřina, drogerie, půjčky, bazén' }
  ];
  for (const d of debts) await dbAddInternal('debts', d);

  const meterReadings = [
    { date: '2026-08-31', value: 12100.0, note: 'Konec léta' },
    { date: '2026-09-30', value: 12480.0, note: 'Začátek podzimu' },
    { date: '2026-10-31', value: 12940.0, note: 'Topná sezóna začala' }
  ];
  for (const m of meterReadings) await dbAddInternal('meter_readings', m);
}

// Pomocná migrace šablon, pokud uživatel již v IndexedDB šablony má
async function ensureUpdatedTemplates() {
  const templates = await dbGetAll('templates');
  let changed = false;

  // Odstranění původního PVZP 400 Kč měsíčně
  const pvzp = templates.find(t => t.title.includes('PVZP'));
  if (pvzp) {
    await dbDelete('templates', pvzp.id);
    changed = true;
  }

  // Kontrola pojištění nemovitosti (1 559 Kč)
  if (!templates.some(t => t.title.includes('Pojištění nemovitosti'))) {
    await dbAddInternal('templates', {
      title: 'Pojištění nemovitosti',
      amount: 155900,
      category: 'Bydlení',
      day: 20,
      frequency: 'semi-annual',
      dueMonths: [5, 11],
      active: true
    });
    changed = true;
  }

  // Kontrola povinného ručení (651 Kč v červenci)
  if (!templates.some(t => t.title.includes('Povinné ručení'))) {
    await dbAddInternal('templates', {
      title: 'Povinné ručení',
      amount: 65100,
      category: 'Doprava & Benzín',
      day: 15,
      frequency: 'annual',
      dueMonths: [7],
      active: true
    });
    changed = true;
  }

  // Kontrola svozu odpadu (821 Kč v lednu)
  if (!templates.some(t => t.title.includes('Svoz odpadu'))) {
    await dbAddInternal('templates', {
      title: 'Svoz odpadu',
      amount: 82100,
      category: 'Bydlení',
      day: 15,
      frequency: 'annual',
      dueMonths: [1],
      active: true
    });
    changed = true;
  }

  // Nastavení výchozí frekvence u starých šablon
  for (const t of templates) {
    if (!t.frequency) {
      t.frequency = 'monthly';
      t.dueMonths = [];
      await dbSetInternal('templates', t);
      changed = true;
    }
  }

  if (changed) {
    triggerAutoCloudSync();
  }
}

function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbSetInternal(storeName, val) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(val);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbAddInternal(storeName, val) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.add(val);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => {
      triggerAutoCloudSync();
      resolve(true);
    };
    req.onerror = () => reject(req.error);
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
      console.log('⚡ Tiché zrcadlení do cloudu proběhlo úspěšně.');
    }
  } catch (err) {
    console.warn('AutoSync selhal (možná offline):', err);
  }
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
      console.log('⚡ Data byla obnovena ze zrcadla po vymazání paměti prohlížeče.');
      return true;
    }
  } catch (err) {
    console.warn('AutoRestore selhal:', err);
  }
  return false;
}
