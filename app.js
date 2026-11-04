// Stav aplikace
let currentDate = new Date(2026, 10, 1); // Listopad 2026

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initDB();
    setupNavigation();
    setupMonthSelector();
    setupPaymentsModal();
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

// 3. Načtení dat měsíce
async function loadMonthData() {
  const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

  const allEntries = await dbGetAll('entries');
  let currentMonthEntries = allEntries.filter(e => e.monthYear === monthKey);

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

  // Seřadíme podle dne v měsíci
  currentMonthEntries.sort((a, b) => (a.day || 0) - (b.day || 0));

  calculateOverview(currentMonthEntries);
  renderPaymentsList(currentMonthEntries);
}

// 4. Výpočty přehledu a bezpečné kapesné
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

  const currentBalance = initialCapital + totalIncome - totalPaid;

  document.getElementById('disp-account-balance').textContent = Money.toCzk(currentBalance);
  document.getElementById('metric-income').textContent = Money.toCzkInt(totalIncome);
  document.getElementById('metric-paid').textContent = Money.toCzkInt(totalPaid);
  document.getElementById('metric-remaining').textContent = Money.toCzkInt(totalRemaining);

  calculateSafeSpend(currentBalance, totalRemaining, payday);
}

function calculateSafeSpend(balance, unpaidBills, paydayDay) {
  const now = new Date();
  const currentDay = now.getDate();
  let daysUntilPayday = 0;

  if (currentDay < paydayDay) {
    daysUntilPayday = paydayDay - currentDay;
  } else {
    const daysInCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    daysUntilPayday = (daysInCurrentMonth - currentDay) + paydayDay;
  }

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

// 5. Vykreslení seznamu plateb
function renderPaymentsList(entries) {
  const list = document.getElementById('payments-list');
  list.innerHTML = '';

  let totalExpenses = 0;
  let paidExpenses = 0;

  entries.forEach(item => {
    if (!item.isIncome) {
      totalExpenses += item.amount;
      if (item.paid) paidExpenses += item.amount;
    }

    const row = document.createElement('div');
    row.className = `entry-item ${item.paid ? 'paid' : ''}`;

    const checkIcon = item.paid ? '✓' : '';
    const sign = item.isIncome ? '+' : '-';
    const amountClass = item.isIncome ? 'income' : 'expense';

    row.innerHTML = `
      <div class="entry-left">
        <div class="check-circle">${checkIcon}</div>
        <div class="entry-info">
          <span class="entry-title">${item.title}</span>
          <div class="entry-sub">
            <span class="entry-badge">${item.category}</span>
            <span>${item.day}. v měsíci</span>
          </div>
        </div>
      </div>
      <div class="entry-amount ${amountClass}">
        ${sign} ${Money.toCzk(item.amount)}
      </div>
    `;

    // Kliknutí pro odškrtnutí/zrušení odškrtnutí
    row.addEventListener('click', async () => {
      item.paid = !item.paid;
      await dbSet('entries', item);
      await loadMonthData();
    });

    list.appendChild(row);
  });

  // Aktualizace souhrnné lišty výdajů
  document.getElementById('payments-total-exp').textContent = Money.toCzkInt(totalExpenses);
  const percent = totalExpenses > 0 ? Math.round((paidExpenses / totalExpenses) * 100) : 0;
  document.getElementById('payments-progress-fill').style.width = `${percent}%`;
}

// 6. Obsluha modálního okna pro přidání položky
function setupPaymentsModal() {
  const modal = document.getElementById('modal-entry');
  const btnOpen = document.getElementById('btn-add-entry');
  const btnCancel = document.getElementById('btn-cancel-entry');
  const form = document.getElementById('form-entry');
  const radioTypes = form.querySelectorAll('input[name="entryType"]');
  const recurringWrap = document.getElementById('wrap-entry-recurring');

  btnOpen.addEventListener('click', () => {
    form.reset();
    recurringWrap.style.display = 'flex';
    modal.classList.remove('hidden');
  });

  btnCancel.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  radioTypes.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'income') {
        recurringWrap.style.display = 'none';
      } else {
        recurringWrap.style.display = 'flex';
      }
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const isIncome = form.querySelector('input[name="entryType"]:checked').value === 'income';
    const title = document.getElementById('entry-title').value.trim();
    const amountCzk = parseFloat(document.getElementById('entry-amount').value);
    const category = document.getElementById('entry-category').value;
    const day = parseInt(document.getElementById('entry-day').value, 10);
    const isRecurring = document.getElementById('entry-recurring').checked;

    if (!title || isNaN(amountCzk) || amountCzk <= 0) return;

    const amountCents = Money.toCents(amountCzk);
    const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

    // Uložíme do aktuálního měsíce
    await dbAdd('entries', {
      monthYear: monthKey,
      title,
      amount: amountCents,
      category,
      day,
      isIncome,
      paid: isIncome // Příjmy jsou rovnou připsány
    });

    // Pokud je zaškrtnuto jako trvalá platba, přidáme do šablon
    if (!isIncome && isRecurring) {
      await dbAdd('templates', {
        title,
        amount: amountCents,
        category,
        day,
        active: true
      });
    }

    modal.classList.add('hidden');
    await loadMonthData();
  });
}
