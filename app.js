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
    setupInvestmentModal();
    setupSettingsAndBackup();
    await loadMonthData();
  } catch (err) {
    console.error('Inicializace selhala:', err);
  }
});

// 1. Spodní navigace
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

      if (targetTab === 'overview') {
        await loadMonthData();
      } else if (targetTab === 'goals') {
        await renderGoals();
      } else if (targetTab === 'debts') {
        await renderDebts();
      } else if (targetTab === 'invest') {
        await renderInvestments();
      } else if (targetTab === 'energy') {
        await renderEnergy();
      } else if (targetTab === 'settings') {
        await renderSettings();
      }
    });
  });
}

// 2. Přepínání měsíců
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

// 3. Načtení dat měsíce a analytiky
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
  await drawCashflowForecast(currentMonthEntries);
  renderCategoryBreakdown(currentMonthEntries);
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

// 5. Predikce cashflow do konce měsíce
async function drawCashflowForecast(entries) {
  const canvas = document.getElementById('cashflow-forecast-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 160 * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = 160;
  ctx.clearRect(0, 0, width, height);

  const startBalance = await getCalculatedBalance(entries);
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();

  const dailyBalances = [];
  let simBalance = startBalance;

  for (let day = 1; day <= daysInMonth; day++) {
    const dueBills = entries.filter(e => !e.isIncome && !e.paid && e.day === day);
    dueBills.forEach(b => simBalance -= b.amount);

    const dueIncomes = entries.filter(e => e.isIncome && !e.paid && e.day === day);
    dueIncomes.forEach(inc => simBalance += inc.amount);

    dailyBalances.push({ day, balance: simBalance });
  }

  const minBalance = Math.min(...dailyBalances.map(d => d.balance));
  const maxBalance = Math.max(...dailyBalances.map(d => d.balance), startBalance);

  document.getElementById('forecast-min-val').textContent = Money.toCzkInt(minBalance);
  const safetyTag = document.getElementById('forecast-safety-tag');

  if (minBalance >= 1000000) {
    safetyTag.textContent = '🛡️ Rezerva bezpečná';
    safetyTag.style.color = 'var(--accent-green)';
  } else if (minBalance >= 0) {
    safetyTag.textContent = '⚠️ Těsný zůstatek';
    safetyTag.style.color = 'var(--accent-yellow)';
  } else {
    safetyTag.textContent = '🚨 Riziko schodku';
    safetyTag.style.color = 'var(--accent-red)';
  }

  const paddingX = 35;
  const paddingY = 25;
  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;
  const valRange = (maxBalance - Math.min(0, minBalance)) || 1;

  if (minBalance < 0) {
    const zeroY = height - paddingY - ((0 - Math.min(0, minBalance)) / valRange) * chartH;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(paddingX, zeroY);
    ctx.lineTo(width - paddingX, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.beginPath();

  const coords = [];
  dailyBalances.forEach((item, idx) => {
    const x = paddingX + (idx / (daysInMonth - 1)) * chartW;
    const y = height - paddingY - ((item.balance - Math.min(0, minBalance)) / valRange) * chartH;
    coords.push({ x, y, item });

    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.lineTo(coords[coords.length - 1].x, height - paddingY);
  ctx.lineTo(coords[0].x, height - paddingY);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, paddingY, 0, height - paddingY);
  grad.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
  grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('1.', paddingX, height - 8);
  ctx.fillText('15.', paddingX + chartW / 2, height - 8);
  ctx.fillText(`${daysInMonth}.`, width - paddingX, height - 8);
}

// 6. Struktura výdajů podle kategorií
function renderCategoryBreakdown(entries) {
  const container = document.getElementById('category-breakdown-list');
  container.innerHTML = '';

  const catSums = {};
  let totalExpenses = 0;

  entries.forEach(e => {
    if (!e.isIncome) {
      catSums[e.category] = (catSums[e.category] || 0) + e.amount;
      totalExpenses += e.amount;
    }
  });

  if (totalExpenses === 0) {
    container.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted);">Zatím žádné výdaje v tomto měsíci.</span>';
    return;
  }

  const sortedCategories = Object.keys(catSums).sort((a, b) => catSums[b] - catSums[a]);

  const catColors = {
    'Energie': '#f59e0b',
    'Závazky': '#ef4444',
    'Bydlení': '#0ea5e9',
    'Komunikace': '#8b5cf6',
    'Služby': '#ec4899',
    'Jídlo & Drogerie': '#10b981',
    'Zdraví': '#14b8a6',
    'Doprava & Koloběžka': '#f97316',
    'Investice': '#06b6d4',
    'Zvířata': '#84cc16'
  };

  sortedCategories.forEach(cat => {
    const sum = catSums[cat];
    const percent = Math.round((sum / totalExpenses) * 100);
    const color = catColors[cat] || '#64748b';

    const row = document.createElement('div');
    row.className = 'cat-bar-item';
    row.innerHTML = `
      <div class="cat-bar-header">
        <span class="cat-bar-name">${cat} (${percent}%)</span>
        <span class="cat-bar-sum">${Money.toCzkInt(sum)}</span>
      </div>
      <div class="cat-bar-track">
        <div class="cat-bar-fill" style="width: ${percent}%; background-color: ${color};"></div>
      </div>
    `;
    container.appendChild(row);
  });
}

// 7. Vykreslení plateb
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

// 8. Modální okno plateb
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

// 9. Modul Cíle
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

// 10. Modul Dluhy & Pohledávky
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

// 11. Modul Investice & Web výdělky
async function renderInvestments() {
  const investments = await dbGetAll('investments');
  const container = document.getElementById('investments-list');
  container.innerHTML = '';

  let totalInvested = 0;
  let totalCurrent = 0;

  investments.forEach(inv => {
    totalInvested += inv.invested;
    totalCurrent += inv.current;

    const profit = inv.current - inv.invested;
    const percent = inv.invested > 0 ? ((profit / inv.invested) * 100).toFixed(1) : 0;
    const profitClass = profit >= 0 ? 'positive' : 'negative';
    const profitSign = profit >= 0 ? '+' : '';

    const card = document.createElement('div');
    card.className = 'investment-card';
    card.innerHTML = `
      <div class="inv-card-header">
        <span class="inv-card-name">${inv.name}</span>
        <span class="inv-card-profit ${profitClass}">${profitSign}${Money.toCzkInt(profit)} (${profitSign}${percent} %)</span>
      </div>
      <div class="inv-values-grid">
        <div class="inv-val-item">
          <span class="sub-lbl">Vloženo</span>
          <span class="main-val">${Money.toCzkInt(inv.invested)}</span>
        </div>
        <div class="inv-val-item">
          <span class="sub-lbl">Aktuální stav</span>
          <span class="main-val text-blue">${Money.toCzkInt(inv.current)}</span>
        </div>
      </div>
      <div class="inv-card-footer">
        <span>${inv.note || 'Dlouhodobé aktivum'}</span>
        <button class="btn-del-reading" data-id="${inv.id}" title="Smazat">🗑️</button>
      </div>
    `;

    card.querySelector('.btn-del-reading').addEventListener('click', async () => {
      const tx = dbInstance.transaction('investments', 'readwrite');
      tx.objectStore('investments').delete(inv.id);
      tx.oncomplete = () => renderInvestments();
    });

    container.appendChild(card);
  });

  const totalProfit = totalCurrent - totalInvested;
  document.getElementById('disp-total-invested').textContent = Money.toCzkInt(totalInvested);
  document.getElementById('disp-total-current').textContent = Money.toCzkInt(totalCurrent);
  
  const profitDisp = document.getElementById('disp-total-profit');
  profitDisp.textContent = `${totalProfit >= 0 ? '+' : ''}${Money.toCzkInt(totalProfit)}`;
  profitDisp.style.color = totalProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';

  // Zobrazení výdělků z webu za aktuální měsíc
  const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  const allEntries = await dbGetAll('entries');
  const webEntries = allEntries.filter(e => e.monthYear === monthKey && e.isIncome && e.category === 'Web & Projekty');

  const webContainer = document.getElementById('web-earnings-items');
  webContainer.innerHTML = '';
  let webSum = 0;

  if (webEntries.length === 0) {
    webContainer.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted);">V tomto měsíci zatím není zaevidován příjem z webu. Přidej jej v záložce Platby (+ Položka -> Příjem -> Web & Projekty).</span>';
  } else {
    webEntries.forEach(we => {
      webSum += we.amount;
      const row = document.createElement('div');
      row.className = 'web-earn-row';
      row.innerHTML = `
        <span>${we.title} (${we.day}. v měsíci)</span>
        <strong class="text-green">+ ${Money.toCzk(we.amount)}</strong>
      `;
      webContainer.appendChild(row);
    });
  }

  document.getElementById('disp-month-web-earnings').textContent = Money.toCzk(webSum);
}

function setupInvestmentModal() {
  const modal = document.getElementById('modal-investment');
  const btnOpen = document.getElementById('btn-add-investment');
  const btnCancel = document.getElementById('btn-cancel-investment');
  const form = document.getElementById('form-investment');

  btnOpen.addEventListener('click', () => {
    form.reset();
    modal.classList.remove('hidden');
  });

  btnCancel.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('inv-name').value.trim();
    const investedCzk = parseFloat(document.getElementById('inv-invested').value);
    const currentCzk = parseFloat(document.getElementById('inv-current').value);
    const note = document.getElementById('inv-note').value.trim();

    if (!name || isNaN(investedCzk) || isNaN(currentCzk)) return;

    await dbAdd('investments', {
      name,
      invested: Money.toCents(investedCzk),
      current: Money.toCents(currentCzk),
      note
    });

    modal.classList.add('hidden');
    await renderInvestments();
  });
}

// 12. Modul Energie
async function renderEnergy() {
  const kwhRecord = await dbGet('settings', 'kwh_price');
  const kwhPriceCents = kwhRecord ? kwhRecord.value : 650;
  const kwhPriceCzk = kwhPriceCents / 100;

  document.getElementById('disp-kwh-price').textContent = `${(kwhPriceCzk).toFixed(2).replace('.', ',')} Kč / kWh`;

  const templates = await dbGetAll('templates');
  const cez = templates.find(t => t.title.toLowerCase().includes('čez') || t.title.toLowerCase().includes('cez'));
  const cezDepositCents = cez ? cez.amount : 300000;
  document.getElementById('disp-cez-deposit').textContent = Money.toCzkInt(cezDepositCents);

  await drawEnergyConsumptionChart();
  await renderMeterReadingsHistory();

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

async function renderMeterReadingsHistory() {
  const container = document.getElementById('meter-readings-history');
  container.innerHTML = '';

  const readings = await dbGetAll('meter_readings');
  readings.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (readings.length === 0) {
    container.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted);">Zatím nejsou zapsány žádné odečty.</span>';
    return;
  }

  readings.forEach((r, idx) => {
    const row = document.createElement('div');
    row.className = 'meter-history-item';

    let deltaHtml = '';
    if (idx < readings.length - 1) {
      const prev = readings[idx + 1];
      const diff = (r.value - prev.value).toFixed(1);
      deltaHtml = `<span class="m-delta">+${diff} kWh</span>`;
    }

    row.innerHTML = `
      <div class="m-left">
        <span class="m-date">${r.date}</span>
        <span class="m-note">${r.note || 'Pravidelný odečet'}</span>
      </div>
      <div class="m-right">
        ${deltaHtml}
        <span class="m-kwh">${r.value.toLocaleString('cs-CZ')} kWh</span>
        <button class="btn-del-reading" data-id="${r.id}" title="Smazat">🗑️</button>
      </div>
    `;

    row.querySelector('.btn-del-reading').addEventListener('click', async () => {
      const tx = dbInstance.transaction('meter_readings', 'readwrite');
      tx.objectStore('meter_readings').delete(r.id);
      tx.oncomplete = () => renderEnergy();
    });

    container.appendChild(row);
  });
}

async function drawEnergyConsumptionChart() {
  const canvas = document.getElementById('energy-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

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
        date: curr.date.slice(5),
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

  const avgY = height - paddingY - (avg / maxVal) * chartH;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(paddingX, avgY);
  ctx.lineTo(width - paddingX, avgY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.beginPath();

  const coords = [];
  points.forEach((pt, idx) => {
    const x = paddingX + (idx / (points.length - 1 || 1)) * chartW;
    const y = height - paddingY - (pt.val / maxVal) * chartH;
    coords.push({ x, y, pt });

    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.lineTo(coords[coords.length - 1].x, height - paddingY);
  ctx.lineTo(coords[0].x, height - paddingY);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, paddingY, 0, height - paddingY);
  grad.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
  grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
  ctx.fillStyle = grad;
  ctx.fill();

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

// 13. Nastavení, Zálohování & Air Bank CSV Parser
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
    reader.readAsText(file, 'windows-1250');
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
    meter_readings: await dbGetAll('meter_readings'),
    investments: await dbGetAll('investments')
  };
}

async function restoreFromBackup(data) {
  const stores = ['settings', 'templates', 'entries', 'goals', 'debts', 'energy', 'meter_readings', 'investments'];
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

async function parseAndImportAirBankCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return 0;

  const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  let importedCount = 0;

  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

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

    // Inteligentní rozpoznání kategorie pro příjem
    let category = isIncome ? 'Příjmy' : 'Ostatní';
    const lowerTitle = title.toLowerCase();
    if (isIncome) {
      if (lowerTitle.includes('web') || lowerTitle.includes('affil') || lowerTitle.includes('reklama') || lowerTitle.includes('kolobeznik')) {
        category = 'Web & Projekty';
      } else if (lowerTitle.includes('investown') || lowerTitle.includes('výnos') || lowerTitle.includes('dividenda')) {
        category = 'Investice';
      } else if (lowerTitle.includes('mzda') || lowerTitle.includes('plat') || lowerTitle.includes('výplata')) {
        category = 'Výplata';
      }
    }

    await dbAdd('entries', {
      monthYear: monthKey,
      title: title.slice(0, 50),
      amount: absAmountCents,
      category,
      day,
      isIncome,
      paid: true
    });

    importedCount++;
  }

  return importedCount;
}
