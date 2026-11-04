// Stav aplikace
let currentDate = new Date(2026, 10, 1); // Listopad 2026

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initDB();
    setupNavigation();
    setupMonthSelector();
    setupPaymentsModal();
    setupGoalsModal();
    await loadMonthData();
  } catch (err) {
    console.error('Inicializace selhala:', err);
  }
});

// 1. Spodní navigace mezi záložkami
function setupNavigation() {
  const navItems = document.querySelectorAll('.bottom-nav .nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', async () => {
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

      if (targetTab === 'goals') {
        await renderGoals();
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

  currentMonthEntries.sort((a, b) => (a.day || 0) - (b.day || 0));

  await calculateOverview(currentMonthEntries);
  renderPaymentsList(currentMonthEntries);
}

// 4. Výpočty přehledu a bezpečné kapesné
async function calculateOverview(entries) {
  const currentBalance = await getCalculatedBalance(entries);
  const paydayRecord = await dbGet('settings', 'payday');
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

  document.getElementById('disp-account-balance').textContent = Money.toCzk(currentBalance);
  document.getElementById('metric-income').textContent = Money.toCzkInt(totalIncome);
  document.getElementById('metric-paid').textContent = Money.toCzkInt(totalPaid);
  document.getElementById('metric-remaining').textContent = Money.toCzkInt(totalRemaining);

  calculateSafeSpend(currentBalance, totalRemaining, payday);
}

async function getCalculatedBalance(optionalEntries) {
  const initCapRecord = await dbGet('settings', 'initial_capital');
  const initialCapital = initCapRecord ? initCapRecord.value : 0;

  const entries = optionalEntries || await dbGetAll('entries');
  let totalIncome = 0;
  let totalPaid = 0;

  entries.forEach(e => {
    if (e.isIncome) {
      totalIncome += e.amount;
    } else if (e.paid) {
      totalPaid += e.amount;
    }
  });

  return initialCapital + totalIncome - totalPaid;
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

    row.addEventListener('click', async () => {
      item.paid = !item.paid;
      await dbSet('entries', item);
      await loadMonthData();
    });

    list.appendChild(row);
  });

  document.getElementById('payments-total-exp').textContent = Money.toCzkInt(totalExpenses);
  const percent = totalExpenses > 0 ? Math.round((paidExpenses / totalExpenses) * 100) : 0;
  document.getElementById('payments-progress-fill').style.width = `${percent}%`;
}

// 6. Obsluha modálního okna plateb
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
      recurringWrap.style.display = radio.value === 'income' ? 'none' : 'flex';
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

    await dbAdd('entries', {
      monthYear: monthKey,
      title,
      amount: amountCents,
      category,
      day,
      isIncome,
      paid: isIncome
    });

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

// 7. Modul Cíle: Výpočet prioritního přelévání hotovosti
async function renderGoals() {
  const balance = await getCalculatedBalance();
  document.getElementById('goals-available-disp').textContent = Money.toCzk(balance);

  const goals = await dbGetAll('goals');
  goals.sort((a, b) => a.priority - b.priority);

  const container = document.getElementById('goals-list');
  container.innerHTML = '';

  let pool = balance;

  goals.forEach((goal, index) => {
    let covered = 0;

    if (!goal.paused && pool > 0) {
      if (pool >= goal.target) {
        covered = goal.target;
        pool -= goal.target;
      } else {
        covered = pool;
        pool = 0;
      }
    }

    const percent = Math.min(100, Math.round((covered / goal.target) * 100));
    const card = document.createElement('div');
    card.className = `goal-card ${goal.paused ? 'paused' : ''}`;

    card.innerHTML = `
      <div class="goal-top">
        <div class="goal-header-left">
          <span class="goal-prio-tag">#${goal.priority}</span>
          <span class="goal-name">${goal.title}</span>
        </div>
        <span class="goal-status-badge ${goal.paused ? 'paused' : 'active'}">
          ${goal.paused ? '⏸ Odloženo' : '▶ Aktivní'}
        </span>
      </div>

      <div class="goal-amounts">
        <span>Pokryto: <strong>${Money.toCzkInt(covered)}</strong> (${percent}%)</span>
        <span>Cíl: <strong>${Money.toCzkInt(goal.target)}</strong></span>
      </div>

      <div class="goal-progress-wrap">
        <div class="goal-progress-fill" style="width: ${percent}%;"></div>
      </div>

      <div class="goal-actions">
        <button class="goal-btn btn-toggle-pause">
          ${goal.paused ? '▶ Aktivovat' : '⏸ Odložit'}
        </button>
        <button class="goal-btn btn-prio-up" ${index === 0 ? 'disabled' : ''}>▲ Nahoru</button>
        <button class="goal-btn btn-prio-down" ${index === goals.length - 1 ? 'disabled' : ''}>▼ Dolů</button>
      </div>
    `;

    // Tlačítko odložit / aktivovat
    card.querySelector('.btn-toggle-pause').addEventListener('click', async () => {
      goal.paused = !goal.paused;
      await dbSet('goals', goal);
      await renderGoals();
    });

    // Tlačítko posunout prioritu nahoru
    card.querySelector('.btn-prio-up').addEventListener('click', async () => {
      if (index > 0) {
        const prevGoal = goals[index - 1];
        const temp = goal.priority;
        goal.priority = prevGoal.priority;
        prevGoal.priority = temp;
        await dbSet('goals', goal);
        await dbSet('goals', prevGoal);
        await renderGoals();
      }
    });

    // Tlačítko posunout prioritu dolů
    card.querySelector('.btn-prio-down').addEventListener('click', async () => {
      if (index < goals.length - 1) {
        const nextGoal = goals[index + 1];
        const temp = goal.priority;
        goal.priority = nextGoal.priority;
        nextGoal.priority = temp;
        await dbSet('goals', goal);
        await dbSet('goals', nextGoal);
        await renderGoals();
      }
    });

    container.appendChild(card);
  });
}

// 8. Modální okno pro nový cíl
function setupGoalsModal() {
  const modal = document.getElementById('modal-goal');
  const btnOpen = document.getElementById('btn-add-goal');
  const btnCancel = document.getElementById('btn-cancel-goal');
  const form = document.getElementById('form-goal');

  btnOpen.addEventListener('click', () => {
    form.reset();
    modal.classList.remove('hidden');
  });

  btnCancel.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = document.getElementById('goal-title').value.trim();
    const targetCzk = parseFloat(document.getElementById('goal-target').value);

    if (!title || isNaN(targetCzk) || targetCzk <= 0) return;

    const allGoals = await dbGetAll('goals');
    const nextPriority = allGoals.length > 0 ? Math.max(...allGoals.map(g => g.priority)) + 1 : 1;

    await dbAdd('goals', {
      title,
      target: Money.toCents(targetCzk),
      priority: nextPriority,
      paused: false
    });

    modal.classList.add('hidden');
    await renderGoals();
  });
}
