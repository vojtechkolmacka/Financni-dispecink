// Stav aplikace
let currentDate = new Date(2026, 10, 1); // Listopad 2026 (měsíce jsou 0-indexované: 10 = listopad)

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initDB();
    setupNavigation();
    setupMonthSelector();
    await loadMonthData();
  } catch (err) {
    console.error('Inicializace selhala:', err);
  }
});

// 1. Spodní navigace mezi záložkami
function setupNavigation() {
  const navItems = document.querySelectorAll('.bottom-nav .nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.dataset.tab;
      
      navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.remove('active');
      });

      const activePanel = document.getElementById(`tab-${targetTab}`);
      if (activePanel) {
        activePanel.classList.add('active');
        document.getElementById('app-title').textContent = item.querySelector('.label').textContent;
      }
    });
  });
}

// 2. Přepínání měsíců v hlavičce
function setupMonthSelector() {
  const display = document.getElementById('current-month-display');
  const btnPrev = document.getElementById('prev-month');
  const btnNext = document.getElementById('next-month');

  function updateMonthLabel() {
    const monthNames = [
      'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
      'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'
    ];
    display.textContent = `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  }

  btnPrev.addEventListener('click', async () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    updateMonthLabel();
    await loadMonthData();
  });

  btnNext.addEventListener('click', async () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    updateMonthLabel();
    await loadMonthData();
  });

  updateMonthLabel();
}

// 3. Načtení a výpočty pro aktivní měsíc
async function loadMonthData() {
  const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  
  // Načteme všechny položky pro daný měsíc
  const allEntries = await dbGetAll('entries');
  let currentMonthEntries = allEntries.filter(e => e.monthYear === monthKey);

  // Pokud je měsíc prázdný, vygenerujeme ho z aktivních šablon
  if (currentMonthEntries.length === 0) {
    const templates = await dbGetAll('templates');
    for (const t of templates) {
      if (t.active) {
        const newEntry = {
          monthYear: monthKey,
          title: t.title,
          amount: t.amount,
          category: t.category,
          day: t.day,
          isIncome: false,
          paid: false
        };
        await dbAdd('entries', newEntry);
      }
    }
    const refreshed = await dbGetAll('entries');
    currentMonthEntries = refreshed.filter(e => e.monthYear === monthKey);
  }

  calculateOverview(currentMonthEntries);
}

// 4. Výpočet metrik na nástěnce a bezpečné kapesné
async function calculateOverview(entries) {
  const initCapRecord = await dbGet('settings', 'initial_capital');
  const paydayRecord = await dbGet('settings', 'payday');
  
  const initialCapital = initCapRecord ? initCapRecord.value : 0;
  const payday = paydayRecord ? paydayRecord.value : 10;

  let totalIncome = 0;
  let totalPaid = 0;
  let totalRemaining = 0;

  entries.forEach(e => {
    if (e.isIncome) {
      totalIncome += e.amount;
    } else {
      if (e.paid) {
        totalPaid += e.amount;
      } else {
        totalRemaining += e.amount;
      }
    }
  });

  // Reálný zůstatek na účtu = Výchozí vklad + Příjmy - Zaplacené výdaje
  const currentBalance = initialCapital + totalIncome - totalPaid;

  // Zobrazení hodnot na nástěnce
  document.getElementById('disp-account-balance').textContent = Money.toCzk(currentBalance);
  document.getElementById('metric-income').textContent = Money.toCzkInt(totalIncome);
  document.getElementById('metric-paid').textContent = Money.toCzkInt(totalPaid);
  document.getElementById('metric-remaining').textContent = Money.toCzkInt(totalRemaining);

  // Výpočet: Kolik můžeš bezpečně utratit do výplaty
  calculateSafeSpend(currentBalance, totalRemaining, payday);
}

function calculateSafeSpend(balance, unpaidBills, paydayDay) {
  const now = new Date();
  const currentDay = now.getDate();
  let daysUntilPayday = 0;

  if (currentDay < paydayDay) {
    daysUntilPayday = paydayDay - currentDay;
  } else {
    // Pokud už po výplatě v tomto měsíci bylo, počítáme do výplaty příští měsíc
    const daysInCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    daysUntilPayday = (daysInCurrentMonth - currentDay) + paydayDay;
  }

  // Volné peníze = to, co je na účtu mínus dosud nezaplacené nutné platby tohoto měsíce
  const freeMoney = balance - unpaidBills;
  const safeDaily = daysUntilPayday > 0 ? Math.floor(freeMoney / daysUntilPayday) : 0;

  const display = document.getElementById('disp-safe-daily');
  if (freeMoney <= 0) {
    display.textContent = 'Pozor: Zůstatek nepokrývá zbývající nutné platby!';
    display.style.color = 'var(--accent-red)';
  } else {
    display.textContent = `Do výplaty (${daysUntilPayday} dní): bezpečně ${Money.toCzkInt(safeDaily)} / den`;
    display.style.color = 'var(--accent-blue)';
  }
}
