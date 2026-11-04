// Správa lokálního úložiště IndexedDB a výchozí data
const DB_NAME = 'KolobeznikDispecinkDB';
const DB_VERSION = 1;

let dbInstance = null;

// Pomocné funkce pro přesnou práci s haléři
const Money = {
  toCents: (czk) => Math.round(Number(czk) * 100),
  toCzk: (cents) => (cents / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kč',
  toCzkInt: (cents) => Math.round(cents / 100).toLocaleString('cs-CZ') + ' Kč'
};

// Otevření a inicializace IndexedDB
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

      // 1. Nastavení aplikace
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // 2. Šablony pravidelných měsíčních plateb
      if (!db.objectStoreNames.contains('templates')) {
        db.createObjectStore('templates', { keyPath: 'id', autoIncrement: true });
      }

      // 3. Konkrétní měsíční položky (výdaje a příjmy)
      if (!db.objectStoreNames.contains('entries')) {
        const entryStore = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        entryStore.createIndex('monthYear', 'monthYear', { unique: false });
      }

      // 4. Finanční cíle
      if (!db.objectStoreNames.contains('goals')) {
        db.createObjectStore('goals', { keyPath: 'id', autoIncrement: true });
      }

      // 5. Dluhy a pohledávky
      if (!db.objectStoreNames.contains('debts')) {
        db.createObjectStore('debts', { keyPath: 'id', autoIncrement: true });
      }

      // 6. Energie a spotřebiče
      if (!db.objectStoreNames.contains('energy')) {
        db.createObjectStore('energy', { keyPath: 'id', autoIncrement: true });
      }

      // 7. Záruky spotřebičů a techniky
      if (!db.objectStoreNames.contains('warranties')) {
        db.createObjectStore('warranties', { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = async (event) => {
      dbInstance = event.target.result;
      await seedInitialData();
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('Chyba při otevírání IndexedDB:', event.target.error);
      reject(event.target.error);
    };
  });
}

// Naplnění výchozími daty při prvním startu
async function seedInitialData() {
  const settings = await dbGet('settings', 'initial_capital');
  if (settings) return; // Data již existují

  console.log('Inicializace výchozích dat dispečinku...');

  // Výchozí kapitál upraven na 51 000 Kč (v haléřích: 5 100 000)
  await dbSet('settings', { key: 'initial_capital', value: 5100000 });
  await dbSet('settings', { key: 'payday', value: 10 });
  await dbSet('settings', { key: 'kwh_price', value: 650 });

  // Šablony pravidelných plateb
  const templates = [
    { title: 'ČEZ (elektřina)', amount: 300000, category: 'Energie', day: 15, active: true },
    { title: 'Terapie', amount: 200000, category: 'Zdraví', day: 1, active: true },
    { title: 'Provident (splátka)', amount: 150000, category: 'Závazky', day: 10, active: true },
    { title: 'AvaFin / Crediton (splátka)', amount: 110000, category: 'Závazky', day: 10, active: true },
    { title: 'Investown (investice)', amount: 50000, category: 'Investice', day: 10, active: true },
    { title: 'T-Mobile (internet)', amount: 45000, category: 'Komunikace', day: 20, active: true },
    { title: 'PVZP (pojištění)', amount: 40000, category: 'Pojištění', day: 20, active: true },
    { title: 'Vodafone (telefon)', amount: 26600, category: 'Komunikace', day: 15, active: true },
    { title: 'ChatGPT Go', amount: 20000, category: 'Služby', day: 1, active: true },
    { title: 'Spotify', amount: 18500, category: 'Zábava', day: 5, active: true },
    { title: 'Česká televize', amount: 15000, category: 'Služby', day: 15, active: true },
    { title: 'Google AI Pro', amount: 13990, category: 'Služby', day: 8, active: true },
    { title: 'Penzijní příspěvek', amount: 10000, category: 'Spoření', day: 15, active: true },
    { title: 'SIPO', amount: 7700, category: 'Bydlení', day: 12, active: true }
  ];
  for (const t of templates) await dbAdd('templates', t);

  // Výchozí cíle
  const goals = [
    { title: 'Brikety na zimu', target: 1100000, priority: 1, paused: false },
    { title: 'Právní výdaje', target: 2000000, priority: 2, paused: false },
    { title: 'Železná finanční rezerva', target: 6000000, priority: 3, paused: false },
    { title: 'Zubní náhrada', target: 3000000, priority: 4, paused: true },
    { title: 'Koloběžka', target: 2500000, priority: 5, paused: true },
    { title: 'Cestování (Itálie, Monako, Nice)', target: 1600000, priority: 6, paused: true }
  ];
  for (const g of goals) await dbAdd('goals', g);

  // Výchozí dluhy a pohledávky
  const debts = [
    { type: 'payable', name: 'Provident', total: 7732733, monthly: 150000, day: 10 },
    { type: 'payable', name: 'AvaFin / Crediton', total: 1952400, monthly: 110000, day: 10 },
    { type: 'receivable', name: 'KOV', total: 665000, note: 'Půjčky, elektřina, drogerie, bazén' },
    { type: 'receivable', name: 'JIŘÍ', total: 75000, note: 'Elektřina, drogerie, bazén' },
    { type: 'receivable', name: 'MAGDA', total: 270000, note: 'Elektřina, drogerie, půjčky, bazén' }
  ];
  for (const d of debts) await dbAdd('debts', d);
}

// CRUD operace pro IndexedDB
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

function dbSet(storeName, val) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(val);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbAdd(storeName, val) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.add(val);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
