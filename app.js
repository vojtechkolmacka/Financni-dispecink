if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('PWA Service Worker úspěšně zaregistrován:', reg.scope))
      .catch(err => console.log('Registrace Service Workeru selhala:', err));
  });
}

let currentDate = new Date(2026, 10, 1);
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btnInstall = document.getElementById('btn-install-pwa');
  if (btnInstall) btnInstall.style.display = 'block';
});

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initDB();
    setupNavigation();
    setupMonthSelector();
    setupPaymentsModal();
    setupGoalsModal();
    setupDebtTxModal();
    setupApplianceModal();
    setupMeterReadingModal();
    setupSettingsAndBackup();
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
      } else if (targetTab === 'debts') {
        await renderDebts();
      } else if (targetTab === 'energy') {
        await renderEnergy();
      } else if (targetTab === 'settings') {
        await renderSettings();
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
  const initialCapital = initCapRecord ? initCapRecord.value : 5100000;

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

// 5. Vykreslení plateb
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

// 6. Modální okno plateb
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

// 7. Modul Cíle
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

    card.querySelector('.btn-toggle-pause').addEventListener('click', async () => {
      goal.paused = !goal.paused;
      await dbSet('goals', goal);
      await renderGoals();
    });

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

// 8. Modul Dluhy & Pohledávky
async function renderDebts() {
  const debts = await dbGetAll('debts');
  const recContainer = document.getElementById('receivables-list');
  const payContainer = document.getElementById('payables-list');

  recContainer.innerHTML = '';
  payContainer.innerHTML = '';

  debts.forEach(d => {
    const card = document.createElement('div');
    card.className = 'debt-card';

    if (d.type === 'receivable') {
      card.innerHTML = `
        <div class="debt-card-header">
          <span class="debt-name">${d.name}</span>
          <span class="debt-total receivable">${Money.toCzk(d.total)}</span>
        </div>
        <div class="debt-sub-info">${d.note || 'Pohledávka'}</div>
        <div class="debt-actions-row">
          <button class="debt-btn btn-pay" data-id="${d.id}" data-action="repay">− Zadat úhradu (+ účet)</button>
          <button class="debt-btn btn-lend" data-id="${d.id}" data-action="lend">+ Půjčit / Přičíst</button>
        </div>
      `;

      card.querySelectorAll('.debt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          openDebtTxModal(d, btn.dataset.action);
        });
      });

      recContainer.appendChild(card);
    } else {
      card.innerHTML = `
        <div class="debt-card-header">
          <span class="debt-name">${d.name}</span>
          <span class="debt-total payable">${Money.toCzk(d.total)}</span>
        </div>
        <div class="debt-sub-info">Měsíční splátka: ${Money.toCzk(d.monthly)} (k ${d.day}. dni)</div>
        <div class="debt-actions-row">
          <button class="debt-btn btn-pay" data-id="${d.id}">Potvrdit splátku (${Money.toCzkInt(d.monthly)})</button>
        </div>
      `;

      card.querySelector('.debt-btn').addEventListener('click', async () => {
        if (d.total <= 0) return;
        const payAmount = Math.min(d.total, d.monthly);
        d.total -= payAmount;
        await dbSet('debts', d);

        const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        await dbAdd('entries', {
          monthYear: monthKey,
          title: `Splátka dluhu: ${d.name}`,
          amount: payAmount,
          category: 'Závazky',
          day: new Date().getDate(),
          isIncome: false,
          paid: true
        });

        await loadMonthData();
        await renderDebts();
      });

      payContainer.appendChild(card);
    }
  });
}

function openDebtTxModal(debt, action) {
  const modal = document.getElementById('modal-debt-tx');
  const title = document.getElementById('modal-debt-tx-title');
  const idInput = document.getElementById('debt-tx-id');
  const actionInput = document.getElementById('debt-tx-action');
  const form = document.getElementById('form-debt-tx');

  form.reset();
  idInput.value = debt.id;
  actionInput.value = action;

  title.textContent = (action === 'repay') 
    ? `Úhrada od: ${debt.name} (přičte se na účet)`
    : `Půjčit / přičíst pro: ${debt.name}`;

  modal.classList.remove('hidden');
}

function setupDebtTxModal() {
  const modal = document.getElementById('modal-debt-tx');
  const btnCancel = document.getElementById('btn-cancel-debt-tx');
  const form = document.getElementById('form-debt-tx');

  btnCancel.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = parseInt(document.getElementById('debt-tx-id').value, 10);
    const action = document.getElementById('debt-tx-action').value;
    const amountCzk = parseFloat(document.getElementById('debt-tx-amount').value);
    const note = document.getElementById('debt-tx-note').value.trim();

    if (isNaN(amountCzk) || amountCzk <= 0) return;

    const amountCents = Money.toCents(amountCzk);
    const debt = await dbGet('debts', id);

    if (!debt) return;

    const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

    if (action === 'repay') {
      debt.total = Math.max(0, debt.total - amountCents);
      await dbSet('debts', debt);

      await dbAdd('entries', {
        monthYear: monthKey,
        title: `Úhrada dluhu: ${debt.name}${note ? ' (' + note + ')' : ''}`,
        amount: amountCents,
        category: 'Příjmy',
        day: new Date().getDate(),
        isIncome: true,
        paid: true
      });
    } else {
      debt.total += amountCents;
      if (note) {
        debt.note = debt.note ? `${debt.note}, ${note} (+${amountCzk} Kč)` : note;
      }
      await dbSet('debts', debt);
    }

    modal.classList.add('hidden');
    await loadMonthData();
    await renderDebts();
  });
}

// 9. Modul Energie, Křivka spotřeby domu & Spotřebiče
async function renderEnergy() {
  const kwhRecord = await dbGet('settings', 'kwh_price');
  const kwhPriceCents = kwhRecord ? kwhRecord.value : 650;
  const kwhPriceCzk = kwhPriceCents / 100;

  document.getElementById('disp-kwh-price').textContent = `${(kwhPriceCzk).toFixed(2).replace('.', ',')} Kč / kWh`;

  const templates = await dbGetAll('templates');
  const cez = templates.find(t => t.title.toLowerCase().includes('čez') || t.title.toLowerCase().includes('cez'));
  const cezDepositCents = cez ? cez.amount : 300000;
  document.getElementById('disp-cez-deposit').textContent = Money.toCzkInt(cezDepositCents);

  // Vykreslíme křivku celkové spotřeby domu
  await drawEnergyConsumptionChart();

  // Načteme spotřebiče
  const appliances = await dbGetAll('energy');
  const container = document.getElementById('appliances-list');
  container.innerHTML = '';

  let totalMonthlyCostCents = 0;

  appliances.forEach(app => {
    const kwhPerHour = app.power / 1000;
    const kwhPerDay = kwhPerHour * app.hours;
    const kwhPerMonth = kwhPerDay * 30;

    const costHourCents = Math.round(kwhPerHour * kwhPriceCents);
    const costDayCents = Math.round(kwhPerDay * kwhPriceCents);
    const costMonthCents = Math.round(kwhPerMonth * kwhPriceCents);

    totalMonthlyCostCents += costMonthCents;

    let warrantyHtml = '';
    if (app.purchaseDate && app.warrantyMonths) {
      const pDate = new Date(app.purchaseDate);
      const expiryDate = new Date(pDate.setMonth(pDate.getMonth() + parseInt(app.warrantyMonths, 10)));
      const now = new Date();
      const diffTime = expiryDate - now;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) {
        warrantyHtml = `<span class="warranty-badge expired">⚠️ Záruka vypršela</span>`;
      } else if (diffDays <= 60) {
        warrantyHtml = `<span class="warranty-badge warning">⏳ Záruka končí za ${diffDays} dní</span>`;
      } else {
        warrantyHtml = `<span class="warranty-badge ok">🛡️ Záruka OK (${diffDays} dní)</span>`;
      }
    } else {
      warrantyHtml = `<span class="warranty-badge">Bez evidence záruky</span>`;
    }

    const card = document.createElement('div');
    card.className = 'appliance-card';
    card.innerHTML = `
      <div class="appliance-header">
        <span class="appliance-name">${app.name}</span>
        <span class="appliance-specs">${app.power} W • ${app.hours} h/den</span>
      </div>

      <div class="appliance-costs-grid">
        <div class="cost-col">
          <span class="c-lbl">Hodina</span>
          <span class="c-val">${(costHourCents / 100).toFixed(2).replace('.', ',')} Kč</span>
        </div>
        <div class="cost-col">
          <span class="c-lbl">Den</span>
          <span class="c-val">${(costDayCents / 100).toFixed(2).replace('.', ',')} Kč</span>
        </div>
        <div class="cost-col">
          <span class="c-lbl">Měsíc</span>
          <span class="c-val">${Money.toCzkInt(costMonthCents)}</span>
        </div>
      </div>

      <div class="appliance-footer">
        ${warrantyHtml}
        <button class="btn-delete-appliance" data-id="${app.id}">🗑️ Smazat</button>
      </div>
    `;

    card.querySelector('.btn-delete-appliance').addEventListener('click', async () => {
      const tx = dbInstance.transaction('energy', 'readwrite');
      tx.objectStore('energy').delete(app.id);
      tx.oncomplete = () => renderEnergy();
    });

    container.appendChild(card);
  });

  document.getElementById('disp-expected-energy-cost').textContent = Money.toCzkInt(totalMonthlyCostCents);

  const diffCents = cezDepositCents - totalMonthlyCostCents;
  const diffDisplay = document.getElementById('disp-energy-diff');

  if (diffCents >= 0) {
    diffDisplay.textContent = `Přeplatek cca +${Money.toCzkInt(diffCents)} / měsíc`;
    diffDisplay.style.color = 'var(--accent-green)';
  } else {
    diffDisplay.textContent = `Nedoplatek cca ${Money.toCzkInt(diffCents)} / měsíc`;
    diffDisplay.style.color = 'var(--accent-red)';
  }
}

// VYKRESLENÍ KŘIVKY SPOTŘEBY DOMU (HTML5 CANVAS)
async function drawEnergyConsumptionChart() {
  const canvas = document.getElementById('energy-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Nastavení reálného rozlišení canvasu
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 180 * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = 180;

  ctx.clearRect(0, 0, width, height);

  const readings = await dbGetAll('meter_readings');
  readings.sort((a, b) => new Date(a.date) - new Date(b.date));

  if (readings.length < 2) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Pro zobrazení křivky zadej alespoň 2 odečty elektroměru.', width / 2, height / 2);
    return;
  }

  // Výpočet denních spotřeb mezi odečty
  const points = [];
  let totalDailySum = 0;

  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const curr = readings[i];
    const days = (new Date(curr.date) - new Date(prev.date)) / (1000 * 60 * 60 * 24);

    if (days > 0) {
      const kwhDiff = curr.value - prev.value;
      const kwhPerDay = Math.max(0, kwhDiff / days);
      points.push({
        date: curr.date.slice(5), // MM-DD
        val: kwhPerDay
      });
      totalDailySum += kwhPerDay;
    }
  }

  if (points.length === 0) return;

  const avg = totalDailySum / points.length;
  document.getElementById('chart-avg-label').textContent = `⚪ Průměr: ${avg.toFixed(1)} kWh/den`;

  const maxVal = Math.max(...points.map(p => p.val)) * 1.25 || 10;
  const paddingX = 35;
  const paddingY = 25;
  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;

  // Mřížka a průměrná čára
  const avgY = height - paddingY - (avg / maxVal) * chartH;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(paddingX, avgY);
  ctx.lineTo(width - paddingX, avgY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Kreslení křivky spotřeby
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.beginPath();

  const coords = [];
  points.forEach((pt, idx) => {
    const x = paddingX + (idx / (points.length - 1 || 1)) * chartW;
    const y = height - paddingY - (pt.val / maxVal) * chartH;
    coords.push({ x, y, pt });

    if (idx === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  // Vyplnění plochy pod křivkou
  ctx.lineTo(coords[coords.length - 1].x, height - paddingY);
  ctx.lineTo(coords[0].x, height - paddingY);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, paddingY, 0, height - paddingY);
  grad.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
  grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Vykreslení bodů s hodnotami
  coords.forEach(c => {
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${c.pt.val.toFixed(1)}`, c.x, c.y - 8);

    ctx.fillStyle = '#94a3b8';
    ctx.fillText(c.pt.date, c.x, height - 8);
  });
}

function setupMeterReadingModal() {
  const modal = document.getElementById('modal-meter');
  const btnOpen = document.getElementById('btn-add-meter-reading');
  const btnCancel = document.getElementById('btn-cancel-meter');
  const form = document.getElementById('form-meter');

  btnOpen.addEventListener('click', () => {
    form.reset();
    document.getElementById('meter-date').value = new Date().toISOString().slice(0, 10);
    modal.classList.remove('hidden');
  });

  btnCancel.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const date = document.getElementById('meter-date').value;
    const value = parseFloat(document.getElementById('meter-value').value);
    const note = document.getElementById('meter-note').value.trim();

    if (!date || isNaN(value)) return;

    await dbAdd('meter_readings', {
      date,
      value,
      note
    });

    modal.classList.add('hidden');
    await renderEnergy();
  });
}

function setupApplianceModal() {
  const modal = document.getElementById('modal-appliance');
  const btnOpen = document.getElementById('btn-add-appliance');
  const btnCancel = document.getElementById('btn-cancel-appliance');
  const form = document.getElementById('form-appliance');

  btnOpen.addEventListener('click', () => {
    form.reset();
    modal.classList.remove('hidden');
  });

  btnCancel.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('appliance-name').value.trim();
    const power = parseFloat(document.getElementById('appliance-power').value);
    const hours = parseFloat(document.getElementById('appliance-hours').value);
    const purchaseDate = document.getElementById('appliance-warranty-date').value;
    const warrantyMonths = parseInt(document.getElementById('appliance-warranty-months').value, 10) || 24;

    if (!name || isNaN(power) || power <= 0 || isNaN(hours) || hours <= 0) return;

    await dbAdd('energy', {
      name,
      power,
      hours,
      purchaseDate: purchaseDate || null,
      warrantyMonths
    });

    modal.classList.add('hidden');
    await renderEnergy();
  });
}

// 10. Nastavení, Zálohování & Air Bank CSV Parser
async function renderSettings() {
  const initCapRecord = await dbGet('settings', 'initial_capital');
  const paydayRecord = await dbGet('settings', 'payday');
  const kwhRecord = await dbGet('settings', 'kwh_price');

  document.getElementById('set-initial-capital').value = initCapRecord ? initCapRecord.value / 100 : 51000;
  document.getElementById('set-payday').value = paydayRecord ? paydayRecord.value : 10;
  document.getElementById('set-kwh-price').value = kwhRecord ? kwhRecord.value / 100 : 6.5;
}

function setupSettingsAndBackup() {
  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const initCap = parseFloat(document.getElementById('set-initial-capital').value);
    const payday = parseInt(document.getElementById('set-payday').value, 10);
    const kwh = parseFloat(document.getElementById('set-kwh-price').value);

    if (!isNaN(initCap)) await dbSet('settings', { key: 'initial_capital', value: Money.toCents(initCap) });
    if (!isNaN(payday)) await dbSet('settings', { key: 'payday', value: payday });
    if (!isNaN(kwh)) await dbSet('settings', { key: 'kwh_price', value: Money.toCents(kwh) });

    alert('Parametry uloženy!');
    await loadMonthData();
  });

  document.getElementById('btn-export-json').addEventListener('click', async () => {
    const backup = await createFullBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dispecink-zaloha-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('btn-copy-json').addEventListener('click', async () => {
    const backup = await createFullBackup();
    await navigator.clipboard.writeText(JSON.stringify(backup, null, 2));
    alert('Záloha zkopírována do schránky!');
  });

  const fileRestoreInput = document.getElementById('restore-file-input');
  document.getElementById('btn-trigger-restore').addEventListener('click', () => fileRestoreInput.click());

  fileRestoreInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const backupData = JSON.parse(event.target.result);
        await restoreFromBackup(backupData);
        alert('Data byla úspěšně obnovena!');
        window.location.reload();
      } catch (err) {
        alert('Chyba: Neplatný formát souboru.');
      }
    };
    reader.readAsText(file);
  });

  // Inteligentní parser pro Air Bank CSV
  const csvFileInput = document.getElementById('csv-file-input');
  document.getElementById('btn-trigger-csv').addEventListener('click', () => csvFileInput.click());

  csvFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target.result;
      const count = await parseAndImportAirBankCsv(text);
      const status = document.getElementById('csv-import-status');
      status.textContent = `Zpracováno a importováno ${count} plateb z Air Bank!`;
      status.style.color = 'var(--accent-green)';
      await loadMonthData();
    };
    reader.readAsText(file, 'windows-1250'); // české kódování výpisů
  });

  const btnInstall = document.getElementById('btn-install-pwa');
  btnInstall.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        deferredPrompt = null;
        btnInstall.style.display = 'none';
      }
    } else {
      alert('V nabídce prohlížeče klepni na „Přidat na plochu“.');
    }
  });
}

async function createFullBackup() {
  return {
    version: DB_VERSION,
    date: new Date().toISOString(),
    settings: await dbGetAll('settings'),
    templates: await dbGetAll('templates'),
    entries: await dbGetAll('entries'),
    goals: await dbGetAll('goals'),
    debts: await dbGetAll('debts'),
    energy: await dbGetAll('energy'),
    meter_readings: await dbGetAll('meter_readings')
  };
}

async function restoreFromBackup(data) {
  const stores = ['settings', 'templates', 'entries', 'goals', 'debts', 'energy', 'meter_readings'];
  for (const store of stores) {
    if (data[store]) {
      const tx = dbInstance.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      os.clear();
      for (const item of data[store]) {
        os.put(item);
      }
    }
  }
}

// Parser optimalizovaný přímo pro formát CSV Air Bank i univerzální banky
async function parseAndImportAirBankCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return 0;

  const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  let importedCount = 0;

  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  // Klíčové sloupce Air Bank: "Datum provedení", "Částka v měně účtu", "Název protistrany", "Zpráva pro příjemce"
  const dateIdx = headers.findIndex(h => h.includes('datum'));
  const amountIdx = headers.findIndex(h => h.includes('částka') || h.includes('castka') || h.includes('objem'));
  const partyIdx = headers.findIndex(h => h.includes('protistran') || h.includes('název') || h.includes('protiúčet'));
  const msgIdx = headers.findIndex(h => h.includes('zpráva') || h.includes('popis') || h.includes('poznámka'));

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length <= amountIdx) continue;

    const rawAmount = cols[amountIdx].replace(/\s/g, '').replace(',', '.');
    const amountNum = parseFloat(rawAmount);

    if (isNaN(amountNum) || amountNum === 0) continue;

    const isIncome = amountNum > 0;
    const absAmountCents = Math.round(Math.abs(amountNum) * 100);

    let title = '';
    if (partyIdx !== -1 && cols[partyIdx]) title = cols[partyIdx];
    if (msgIdx !== -1 && cols[msgIdx]) title = title ? `${title} (${cols[msgIdx]})` : cols[msgIdx];
    if (!title) title = isIncome ? 'Příchozí platba' : 'Platba kartou / Převod';

    let day = 10;
    if (dateIdx !== -1 && cols[dateIdx]) {
      const parts = cols[dateIdx].split(/[\.\-\/]/);
      if (parts.length >= 1) {
        const parsedDay = parseInt(parts[0], 10);
        if (!isNaN(parsedDay) && parsedDay >= 1 && parsedDay <= 31) day = parsedDay;
      }
    }

    await dbAdd('entries', {
      monthYear: monthKey,
      title: title.slice(0, 50),
      amount: absAmountCents,
      category: isIncome ? 'Příjmy' : 'Ostatní',
      day,
      isIncome,
      paid: true
    });

    importedCount++;
  }

  return importedCount;
}
