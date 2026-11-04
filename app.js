if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('PWA Service Worker zaregistrován:', reg.scope))
      .catch(err => console.log('Registrace Service Workeru selhala:', err));
  });
}

let currentDate = new Date(2026, 10, 1);
let currentPeriod = '30d';
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
    setupTimeframeButtons();
    setupPaymentsModal();
    setupQuickEntryButtons();
    setupTransferModal();
    setupTemplatesManagement();
    setupGoalsModal();
    setupDebtTxModal();
    setupApplianceModal();
    setupMeterReadingModal();
    setupEnergySimulator();
    setupInvestmentModal();
    setupGoldModal();
    setupInvestownSpecifics();
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
    item.addEventListener('click', async (e) => {
      e.preventDefault();
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

  btnPrev.onclick = async () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    updateMonthLabel();
    await loadMonthData();
  };

  btnNext.onclick = async () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    updateMonthLabel();
    await loadMonthData();
  };

  updateMonthLabel();
}

// 3. Přepínač časového okna
function setupTimeframeButtons() {
  const buttons = document.querySelectorAll('.timeframe-bar .tf-btn');
  buttons.forEach(btn => {
    btn.onclick = async () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.tf;
      await loadMonthData();
    };
  });
}

// 4. Načtení dat a podpora periodických plateb
async function loadMonthData() {
  const targetYear = currentDate.getFullYear();
  const targetMonthNum = currentDate.getMonth() + 1;
  const monthKey = `${targetYear}-${String(targetMonthNum).padStart(2, '0')}`;

  const allEntries = await dbGetAll('entries');
  let currentMonthEntries = allEntries.filter(e => e.monthYear === monthKey);

  if (currentMonthEntries.length === 0) {
    const templates = await dbGetAll('templates');

    for (const t of templates) {
      if (!t.active) continue;

      let isDue = false;
      const freq = t.frequency || 'monthly';

      if (freq === 'monthly') {
        isDue = true;
      } else if (freq === 'semi-annual') {
        const dueMonths = (t.dueMonths && t.dueMonths.length > 0) ? t.dueMonths : [5, 11];
        isDue = dueMonths.includes(targetMonthNum);
      } else if (freq === 'annual') {
        const dueMonths = (t.dueMonths && t.dueMonths.length > 0) ? t.dueMonths : [7];
        isDue = dueMonths.includes(targetMonthNum);
      }

      if (isDue) {
        const newEntry = {
          monthYear: monthKey,
          title: t.title,
          amount: t.amount,
          category: t.category,
          day: t.day,
          wallet: 'bank',
          isIncome: false,
          frequency: freq,
          templateId: t.id,
          paid: false
        };
        await dbAdd('entries', newEntry);
      }
    }

    const refreshed = await dbGetAll('entries');
    currentMonthEntries = refreshed.filter(e => e.monthYear === monthKey);
  }

  currentMonthEntries.sort((a, b) => (a.day || 0) - (b.day || 0));

  await calculateBalancesAndGauges(currentMonthEntries);
  renderPaymentsList(currentMonthEntries);
  renderVariableExpensesBreakdown(currentMonthEntries);
  await drawIncomeExpenseTrendChart(allEntries);
  await drawSalaryTrendChart(allEntries);
  await drawCashflowForecastBarChart(allEntries);
  renderCashflowStatsTable(currentMonthEntries);
  renderCategoryBreakdown(currentMonthEntries);
}

// 5. Výpočet zůstatků a tachometrů
async function calculateBalancesAndGauges(entries) {
  const bankCapRecord = await dbGet('settings', 'bank_capital');
  const cashCapRecord = await dbGet('settings', 'cash_capital');
  const initCapRecord = await dbGet('settings', 'initial_capital');

  const initialBank = bankCapRecord ? bankCapRecord.value : (initCapRecord ? initCapRecord.value : 4600000);
  const initialCash = cashCapRecord ? cashCapRecord.value : 500000;

  const allEntries = await dbGetAll('entries');
  let bankIncome = 0, bankExpense = 0;
  let cashIncome = 0, cashExpense = 0;
  let totalRemainingMonth = 0;

  allEntries.forEach(e => {
    const w = e.wallet || 'bank';
    if (e.isIncome) {
      if (w === 'bank') bankIncome += e.amount;
      else cashIncome += e.amount;
    } else if (e.paid) {
      if (w === 'bank') bankExpense += e.amount;
      else cashExpense += e.amount;
    }
  });

  entries.forEach(e => {
    if (!e.isIncome && !e.paid) {
      totalRemainingMonth += e.amount;
    }
  });

  const bankBalance = initialBank + bankIncome - bankExpense;
  const cashBalance = initialCash + cashIncome - cashExpense;
  const totalLiquidity = bankBalance + cashBalance;

  document.getElementById('disp-total-liquidity').textContent = Money.toCzk(totalLiquidity);
  document.getElementById('disp-bank-balance').textContent = Money.toCzkInt(bankBalance);
  document.getElementById('disp-cash-balance').textContent = Money.toCzkInt(cashBalance);

  const paydayRecord = await dbGet('settings', 'payday');
  const payday = paydayRecord ? paydayRecord.value : 10;
  calculateSafeSpend(totalLiquidity, totalRemainingMonth, payday);

  const debts = await dbGetAll('debts');
  const totalDebt = debts.filter(d => d.type === 'payable').reduce((acc, d) => acc + d.total, 0);
  const debtRatio = totalLiquidity > 0 ? Math.min(100, Math.round((totalDebt / totalLiquidity) * 100)) : 100;

  const monthPaid = entries.filter(e => !e.isIncome && e.paid).reduce((acc, e) => acc + e.amount, 0);
  const monthInc = entries.filter(e => e.isIncome).reduce((acc, e) => acc + e.amount, 0);
  const cashFlow = monthInc - monthPaid;
  const forecast7d = totalLiquidity - Math.min(totalLiquidity, totalRemainingMonth);

  document.getElementById('g-val-balance').textContent = Money.toCzkInt(totalLiquidity);
  document.getElementById('g-val-cashflow').textContent = `${cashFlow >= 0 ? '+' : ''}${Money.toCzkInt(cashFlow)}`;
  document.getElementById('gm-val-forecast').textContent = Money.toCzkInt(forecast7d);
  document.getElementById('gm-val-expenses').textContent = Money.toCzkInt(monthPaid);
  document.getElementById('gm-val-debt').textContent = `${debtRatio} %`;

  drawAnalogGauge('gauge-balance', totalLiquidity, 10000000, 130, 90, 7);
  drawAnalogGauge('gauge-cashflow', cashFlow + 5000000, 10000000, 130, 90, 7);
  drawAnalogGauge('gauge-forecast', Math.max(0, forecast7d), 5000000, 70, 50, 4);
  drawAnalogGauge('gauge-expenses', monthPaid, 5000000, 70, 50, 4);
  drawAnalogGauge('gauge-debt', debtRatio, 100, 70, 50, 4);
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

async function getCalculatedBalance() {
  const bankCapRecord = await dbGet('settings', 'bank_capital');
  const cashCapRecord = await dbGet('settings', 'cash_capital');
  const initCapRecord = await dbGet('settings', 'initial_capital');

  const initialBank = bankCapRecord ? bankCapRecord.value : (initCapRecord ? initCapRecord.value : 4600000);
  const initialCash = cashCapRecord ? cashCapRecord.value : 500000;

  const allEntries = await dbGetAll('entries');
  let inc = 0, exp = 0;
  allEntries.forEach(e => {
    if (e.isIncome) inc += e.amount;
    else if (e.paid) exp += e.amount;
  });

  return initialBank + initialCash + inc - exp;
}

function drawAnalogGauge(canvasId, val, maxVal, width, height, lineWidth) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height - 10;
  const r = (width / 2) - 12;

  const startAngle = Math.PI;
  const endAngle = 2 * Math.PI;

  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, startAngle + 0.35 * Math.PI);
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle + 0.35 * Math.PI, startAngle + 0.7 * Math.PI);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle + 0.7 * Math.PI, endAngle);
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  const ratio = Math.max(0, Math.min(1, val / (maxVal || 1)));
  const needleAngle = startAngle + ratio * Math.PI;

  const needleLen = r - 4;
  const nx = cx + needleLen * Math.cos(needleAngle);
  const ny = cy + needleLen * Math.sin(needleAngle);

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(nx, ny);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(2, lineWidth / 2);
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, lineWidth * 0.9, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

// 6. Tendence příjmů a výdajů
async function drawIncomeExpenseTrendChart(allEntries) {
  const canvas = document.getElementById('income-expense-trend-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 170 * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = 170;
  ctx.clearRect(0, 0, width, height);

  const monthNames = ['Led', 'Úno', 'Bře', 'Dub', 'Kvě', 'Čvn', 'Čvc', 'Srp', 'Zář', 'Říj', 'Lis', 'Pro'];
  const months = [];
  const now = new Date(currentDate);

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key: mKey, label: monthNames[d.getMonth()] });
  }

  const points = months.map(m => {
    const monthEnt = allEntries.filter(e => e.monthYear === m.key);
    let inc = 0, exp = 0;
    monthEnt.forEach(e => {
      if (e.isIncome) inc += e.amount;
      else if (e.paid) exp += e.amount;
    });
    return {
      label: m.label,
      inc: inc / 100,
      exp: exp / 100
    };
  });

  const curM = points[points.length - 1];
  const prevM = points[points.length - 2];
  const badge = document.getElementById('income-expense-trend-badge');

  if (curM && prevM) {
    const netDiff = (curM.inc - curM.exp) - (prevM.inc - prevM.exp);
    if (netDiff >= 0) {
      badge.textContent = `📈 Lepší bilance (+${Math.round(netDiff).toLocaleString('cs-CZ')} Kč)`;
      badge.style.color = 'var(--accent-green)';
    } else {
      badge.textContent = `📉 Pokles bilance (${Math.round(netDiff).toLocaleString('cs-CZ')} Kč)`;
      badge.style.color = 'var(--accent-red)';
    }
  }

  const maxVal = Math.max(...points.map(p => Math.max(p.inc, p.exp)), 1000) * 1.25;
  const paddingX = 35;
  const paddingY = 25;
  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;

  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  points.forEach((p, idx) => {
    const x = paddingX + (idx / (points.length - 1)) * chartW;
    const y = height - paddingY - (p.exp / maxVal) * chartH;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 3;
  ctx.beginPath();
  const incCoords = [];
  points.forEach((p, idx) => {
    const x = paddingX + (idx / (points.length - 1)) * chartW;
    const y = height - paddingY - (p.inc / maxVal) * chartH;
    incCoords.push({ x, y, p });
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  incCoords.forEach(c => {
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(c.p.label, c.x, height - 8);
  });
}

// 7. Křivka a monitoring čisté výplaty
async function drawSalaryTrendChart(allEntries) {
  const canvas = document.getElementById('salary-trend-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 170 * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = 170;
  ctx.clearRect(0, 0, width, height);

  const monthNames = ['Led', 'Úno', 'Bře', 'Dub', 'Kvě', 'Čvn', 'Čvc', 'Srp', 'Zář', 'Říj', 'Lis', 'Pro'];
  const months = [];
  const now = new Date(currentDate);

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key: mKey, label: `${monthNames[d.getMonth()]}` });
  }

  const points = months.map(m => {
    const salaryEntries = allEntries.filter(e => e.monthYear === m.key && e.isIncome && (e.category === 'Výplata' || e.title.toLowerCase().includes('výplata') || e.title.toLowerCase().includes('mzda')));
    const total = salaryEntries.reduce((acc, e) => acc + e.amount, 0);
    return {
      label: m.label,
      val: total / 100
    };
  });

  const enteredSalaries = points.filter(p => p.val > 0);
  const avg = enteredSalaries.length > 0 
    ? Math.round(enteredSalaries.reduce((acc, p) => acc + p.val, 0) / enteredSalaries.length)
    : 0;

  document.getElementById('income-trend-badge').textContent = avg > 0 ? `Průměr: ${avg.toLocaleString('cs-CZ')} Kč` : 'Čekám na zadání';
  document.getElementById('salary-avg-legend').textContent = avg > 0 ? `⚪ Průměrná mzda (${avg.toLocaleString('cs-CZ')} Kč)` : '⚪ Zadej výplaty';

  const maxVal = Math.max(...points.map(p => p.val), 35000) * 1.2;
  const paddingX = 35;
  const paddingY = 25;
  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;

  if (avg > 0) {
    const avgY = height - paddingY - (avg / maxVal) * chartH;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(paddingX, avgY);
    ctx.lineTo(width - paddingX, avgY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = '#10b981';
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
  grad.addColorStop(0, 'rgba(16, 185, 129, 0.25)');
  grad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
  ctx.fillStyle = grad;
  ctx.fill();

  coords.forEach(c => {
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    if (c.pt.val > 0) {
      ctx.fillText(`${Math.round(c.pt.val / 1000)}k`, c.x, c.y - 8);
    }

    ctx.fillStyle = '#94a3b8';
    ctx.fillText(c.pt.label, c.x, height - 8);
  });
}

// 8. Cashflow bar chart
async function drawCashflowForecastBarChart(allEntries) {
  const canvas = document.getElementById('cashflow-bar-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 170 * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = 170;
  ctx.clearRect(0, 0, width, height);

  const slots = [];
  const now = new Date(currentDate);

  if (currentPeriod === '7d') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      slots.push({ label: `${d.getDate()}.${d.getMonth() + 1}`, minDay: d.getDate(), maxDay: d.getDate() });
    }
  } else if (currentPeriod === '30d') {
    for (let i = 0; i < 6; i++) {
      slots.push({ label: `${i * 5 + 1}-${i * 5 + 5}`, minDay: i * 5 + 1, maxDay: i * 5 + 5 });
    }
  } else {
    const monthNames = ['Led', 'Úno', 'Bře', 'Dub', 'Kvě', 'Čvn', 'Čvc', 'Srp', 'Zář', 'Říj', 'Lis', 'Pro'];
    for (let i = 5; i >= 0; i--) {
      const m = (now.getMonth() - i + 12) % 12;
      slots.push({ label: monthNames[m] });
    }
  }

  const data = slots.map(slot => {
    let inc = 0;
    let exp = 0;
    allEntries.forEach(e => {
      if (slot.minDay && e.day >= slot.minDay && e.day <= slot.maxDay) {
        if (e.isIncome) inc += e.amount;
        else if (e.paid) exp += e.amount;
      } else {
        if (e.isIncome) inc += e.amount / 6;
        else if (e.paid) exp += e.amount / 6;
      }
    });
    return { label: slot.label, inc: inc / 100, exp: exp / 100 };
  });

  const maxVal = Math.max(...data.map(d => Math.max(d.inc, d.exp)), 1000) * 1.2;
  const paddingX = 30;
  const paddingY = 25;
  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;
  const slotW = chartW / data.length;
  const barW = Math.max(6, (slotW / 3) - 3);

  const zeroY = height - paddingY;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.beginPath();
  ctx.moveTo(paddingX, zeroY);
  ctx.lineTo(width - paddingX, zeroY);
  ctx.stroke();

  data.forEach((d, idx) => {
    const xBase = paddingX + idx * slotW + (slotW / 2);

    const incH = (d.inc / maxVal) * chartH;
    ctx.fillStyle = '#10b981';
    ctx.fillRect(xBase - barW - 2, zeroY - incH, barW, incH);

    const expH = (d.exp / maxVal) * chartH;
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(xBase + 2, zeroY - expH, barW, expH);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.label, xBase, height - 8);
  });
}

// 9. Tabulka statistik Cash Flow
function renderCashflowStatsTable(entries) {
  let countInc = 0;
  let countExp = 0;
  let totalInc = 0;
  let totalExp = 0;

  entries.forEach(e => {
    if (e.isIncome) {
      countInc++;
      totalInc += e.amount;
    } else if (e.paid) {
      countExp++;
      totalExp += e.amount;
    }
  });

  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const avgDayInc = Math.round(totalInc / daysInMonth);
  const avgDayExp = Math.round(totalExp / daysInMonth);
  const net = totalInc - totalExp;

  document.getElementById('cf-count-inc').textContent = countInc;
  document.getElementById('cf-count-exp').textContent = countExp;
  document.getElementById('cf-avg-day-inc').textContent = Money.toCzkInt(avgDayInc);
  document.getElementById('cf-avg-day-exp').textContent = Money.toCzkInt(avgDayExp);
  document.getElementById('cf-total-inc').textContent = Money.toCzkInt(totalInc);
  document.getElementById('cf-total-exp').textContent = Money.toCzkInt(totalExp);

  const netDisp = document.getElementById('cf-net-total');
  netDisp.textContent = `${net >= 0 ? '+' : ''}${Money.toCzkInt(net)}`;
  netDisp.style.color = net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
}

// 10. Rozpad variabilní spotřeby
function renderVariableExpensesBreakdown(entries) {
  const container = document.getElementById('variable-breakdown-list');
  const badgeTotal = document.getElementById('badge-var-total');
  container.innerHTML = '';

  const excludedCategories = ['Bydlení', 'Energie', 'Závazky', 'Komunikace', 'Investice'];
  const varSums = {};
  let totalVarAmount = 0;

  entries.forEach(e => {
    if (!e.isIncome && !excludedCategories.includes(e.category)) {
      varSums[e.category] = (varSums[e.category] || 0) + e.amount;
      totalVarAmount += e.amount;
    }
  });

  badgeTotal.textContent = `${Money.toCzkInt(totalVarAmount)} celkem`;

  if (totalVarAmount === 0) {
    container.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted);">Zatím žádné variabilní nákupy.</span>';
    return;
  }

  const sorted = Object.keys(varSums).sort((a, b) => varSums[b] - varSums[a]);
  const varColors = {
    'Jídlo & Potraviny': '#10b981',
    'Doprava & Benzín': '#f97316',
    'Drogerie & Domácnost': '#38bdf8',
    'Restaurace & Občerstvení': '#fbbf24',
    'Elektro & Nářadí': '#a855f7',
    'Zvířata': '#84cc16',
    'Zdraví & Lékárna': '#14b8a6',
    'Služby': '#ec4899',
    'Ostatní': '#64748b'
  };

  sorted.forEach(cat => {
    const sum = varSums[cat];
    const percent = Math.round((sum / totalVarAmount) * 100);
    const color = varColors[cat] || '#38bdf8';

    const row = document.createElement('div');
    row.className = 'cat-bar-item';
    row.innerHTML = `
      <div class="cat-bar-header">
        <span class="cat-bar-name">${cat} (${percent} %)</span>
        <span class="cat-bar-sum">${Money.toCzkInt(sum)}</span>
      </div>
      <div class="cat-bar-track">
        <div class="cat-bar-fill" style="width: ${percent}%; background-color: ${color};"></div>
      </div>
    `;
    container.appendChild(row);
  });
}

// 11. Celková struktura výdajů
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
    container.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted);">Zatím žádné výdaje.</span>';
    return;
  }

  const sortedCategories = Object.keys(catSums).sort((a, b) => catSums[b] - catSums[a]);
  const catColors = {
    'Energie': '#f59e0b',
    'Závazky': '#ef4444',
    'Bydlení': '#0ea5e9',
    'Komunikace': '#8b5cf6',
    'Služby': '#ec4899',
    'Jídlo & Potraviny': '#10b981',
    'Drogerie & Domácnost': '#06b6d4',
    'Doprava & Benzín': '#f97316',
    'Investice': '#6366f1',
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

// 12. Seznam plateb v měsíci (s možností položku smazat)
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

    const isBank = (item.wallet || 'bank') === 'bank';
    const walletTag = isBank 
      ? `<span class="entry-wallet-tag bank">🏦 Účet</span>`
      : `<span class="entry-wallet-tag cash">💵 Hotovost</span>`;

    let freqTag = '';
    if (item.frequency === 'semi-annual') {
      freqTag = `<span class="entry-freq-tag">Pololetně</span>`;
    } else if (item.frequency === 'annual') {
      freqTag = `<span class="entry-freq-tag">Ročně</span>`;
    }

    row.innerHTML = `
      <div class="entry-left">
        <div class="check-circle">${checkIcon}</div>
        <div class="entry-info">
          <span class="entry-title">${item.title}</span>
          <div class="entry-sub">
            ${walletTag}
            ${freqTag}
            <span class="entry-badge">${item.category}</span>
            <span>${item.day}. v měsíci</span>
          </div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <div class="entry-amount ${amountClass}">
          ${sign} ${Money.toCzk(item.amount)}
        </div>
        <button class="btn-delete-entry" data-id="${item.id}" title="Smazat tuto platbu z měsíce">🗑️</button>
      </div>
    `;

    // Kliknutí pro označení zaplaceno / nezaplaceno
    row.querySelector('.entry-left').onclick = async () => {
      item.paid = !item.paid;
      await dbSet('entries', item);
      await loadMonthData();
    };

    // Smazání konkrétní položky z měsíce
    row.querySelector('.btn-delete-entry').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Opravdu chceš smazat platbu „${item.title}“ z tohoto měsíce?`)) return;
      await dbDelete('entries', item.id);
      await loadMonthData();
    };

    list.appendChild(row);
  });

  document.getElementById('payments-total-exp').textContent = Money.toCzkInt(totalExpenses);
  const percent = totalExpenses > 0 ? Math.round((paidExpenses / totalExpenses) * 100) : 0;
  document.getElementById('payments-progress-fill').style.width = `${percent}%`;
}

// 13. Rychlá tlačítka na ploše & Zadání výplaty
function setupQuickEntryButtons() {
  const modal = document.getElementById('modal-entry');
  const form = document.getElementById('form-entry');

  function openEntryWithType(type, category = null, defaultTitle = '') {
    form.reset();
    form.querySelector(`input[name="entryType"][value="${type}"]`).checked = true;
    document.getElementById('wrap-entry-recurring').style.display = type === 'income' ? 'none' : 'flex';
    document.getElementById('wrap-recurring-frequency').classList.add('hidden');
    document.getElementById('modal-entry-title').textContent = type === 'income' ? 'Nový příjem' : 'Nový výdaj';

    if (category) {
      document.getElementById('entry-category').value = category;
    }
    if (defaultTitle) {
      document.getElementById('entry-title').value = defaultTitle;
    }

    modal.classList.remove('hidden');
  }

  const btnInc = document.getElementById('btn-quick-add-income');
  const btnExp = document.getElementById('btn-quick-add-expense');
  const btnSal = document.getElementById('btn-quick-salary');
  const fabBtn = document.getElementById('fab-add-btn');

  if (btnInc) btnInc.onclick = () => openEntryWithType('income');
  if (btnExp) btnExp.onclick = () => openEntryWithType('expense');
  if (btnSal) btnSal.onclick = () => openEntryWithType('income', 'Výplata', 'Výplata');
  if (fabBtn) fabBtn.onclick = () => openEntryWithType('expense');
}

function setupPaymentsModal() {
  const modal = document.getElementById('modal-entry');
  const btnOpen = document.getElementById('btn-add-entry');
  const btnCancel = document.getElementById('btn-cancel-entry');
  const form = document.getElementById('form-entry');
  const radioTypes = form.querySelectorAll('input[name="entryType"]');
  const recurringWrap = document.getElementById('wrap-entry-recurring');
  const recurringCheck = document.getElementById('entry-recurring');
  const freqWrap = document.getElementById('wrap-recurring-frequency');
  const freqSelect = document.getElementById('entry-frequency');
  const dueMonthsWrap = document.getElementById('wrap-due-months');

  if (btnOpen) {
    btnOpen.onclick = () => {
      form.reset();
      recurringWrap.style.display = 'flex';
      freqWrap.classList.add('hidden');
      dueMonthsWrap.style.display = 'none';
      document.getElementById('modal-entry-title').textContent = 'Nová položka';
      modal.classList.remove('hidden');
    };
  }

  if (btnCancel) {
    btnCancel.onclick = () => modal.classList.add('hidden');
  }

  if (recurringCheck) {
    recurringCheck.onchange = () => {
      if (recurringCheck.checked) freqWrap.classList.remove('hidden');
      else freqWrap.classList.add('hidden');
    };
  }

  if (freqSelect) {
    freqSelect.onchange = () => {
      dueMonthsWrap.style.display = (freqSelect.value === 'monthly') ? 'none' : 'block';
    };
  }

  radioTypes.forEach(radio => {
    radio.onchange = () => {
      recurringWrap.style.display = radio.value === 'income' ? 'none' : 'flex';
      if (radio.value === 'income') freqWrap.classList.add('hidden');
    };
  });

  form.onsubmit = async (e) => {
    e.preventDefault();

    const isIncome = form.querySelector('input[name="entryType"]:checked').value === 'income';
    const wallet = form.querySelector('input[name="entryWallet"]:checked').value;
    const title = document.getElementById('entry-title').value.trim();
    const amountCzk = parseFloat(document.getElementById('entry-amount').value);
    const category = document.getElementById('entry-category').value;
    const day = parseInt(document.getElementById('entry-day').value, 10);
    const isRecurring = recurringCheck.checked;
    const frequency = freqSelect.value;
    const dueMonthsRaw = document.getElementById('entry-due-months').value;

    let dueMonths = [];
    if (frequency !== 'monthly' && dueMonthsRaw) {
      dueMonths = dueMonthsRaw.split(',').map(m => parseInt(m.trim(), 10)).filter(m => !isNaN(m) && m >= 1 && m <= 12);
    }

    if (!title || isNaN(amountCzk) || amountCzk <= 0) return;

    const amountCents = Money.toCents(amountCzk);
    const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

    let createdTemplateId = null;
    if (!isIncome && isRecurring) {
      createdTemplateId = await dbAdd('templates', {
        title,
        amount: amountCents,
        category,
        day,
        frequency,
        dueMonths,
        active: true
      });
    }

    await dbAdd('entries', {
      monthYear: monthKey,
      title,
      amount: amountCents,
      category,
      day,
      wallet,
      isIncome,
      frequency: isRecurring ? frequency : 'single',
      templateId: createdTemplateId,
      paid: isIncome
    });

    modal.classList.add('hidden');
    await loadMonthData();
  };
}

// 14. SPRÁVA STÁLÝCH ŠABLON PLATEB (PŘIDÁVÁNÍ, MAZÁNÍ, PAUZA)
function setupTemplatesManagement() {
  const modal = document.getElementById('modal-templates');
  const btnOpenModal = document.getElementById('btn-manage-templates');
  const btnCloseModal = document.getElementById('btn-close-templates');
  const btnAddNew = document.getElementById('btn-add-new-template');
  const btnAddDirect = document.getElementById('btn-add-template-direct');

  function openNewTemplateForm() {
    modal.classList.add('hidden');
    const entryModal = document.getElementById('modal-entry');
    const form = document.getElementById('form-entry');
    form.reset();
    form.querySelector('input[name="entryType"][value="expense"]').checked = true;
    document.getElementById('wrap-entry-recurring').style.display = 'flex';
    document.getElementById('entry-recurring').checked = true;
    document.getElementById('wrap-recurring-frequency').classList.remove('hidden');
    document.getElementById('modal-entry-title').textContent = 'Nová stálá měsíční platba';
    entryModal.classList.remove('hidden');
  }

  if (btnOpenModal) {
    btnOpenModal.onclick = async () => {
      await renderTemplatesManagementList();
      modal.classList.remove('hidden');
    };
  }

  if (btnCloseModal) {
    btnCloseModal.onclick = () => modal.classList.add('hidden');
  }

  if (btnAddNew) btnAddNew.onclick = openNewTemplateForm;
  if (btnAddDirect) btnAddDirect.onclick = openNewTemplateForm;
}

async function renderTemplatesManagementList() {
  const listModal = document.getElementById('templates-manage-list');
  const listSettings = document.getElementById('settings-templates-list');
  const templates = await dbGetAll('templates');

  function buildListHtml(targetElement) {
    if (!targetElement) return;
    targetElement.innerHTML = '';

    if (templates.length === 0) {
      targetElement.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted);">Zatím nejsou vytvořeny žádné stálé platby.</span>';
      return;
    }

    templates.forEach(t => {
      const row = document.createElement('div');
      row.className = `template-manage-item ${t.active ? '' : 'paused'}`;

      let freqLabel = 'Měsíčně';
      if (t.frequency === 'semi-annual') freqLabel = `Pololetně (měsíce: ${t.dueMonths?.join(', ') || '5, 11'})`;
      else if (t.frequency === 'annual') freqLabel = `Ročně (měsíc: ${t.dueMonths?.join(', ') || '7'})`;

      row.innerHTML = `
        <div class="tmi-left">
          <span class="tmi-title">${t.title}</span>
          <span class="tmi-sub">${freqLabel} • ${t.day}. v měsíci • ${t.category}</span>
        </div>
        <div class="tmi-right">
          <span class="tmi-amount">${Money.toCzkInt(t.amount)}</span>
          <button class="btn-tmi-toggle" data-id="${t.id}" title="${t.active ? 'Pozastavit' : 'Aktivovat'}">
            ${t.active ? '⏸️' : '▶️'}
          </button>
          <button class="btn-tmi-del" data-id="${t.id}" title="Trvale smazat stálou platbu">🗑️</button>
        </div>
      `;

      // Přepnout aktivní / pozastaveno
      row.querySelector('.btn-tmi-toggle').onclick = async () => {
        t.active = !t.active;
        await dbSet('templates', t);
        await renderTemplatesManagementList();
        await loadMonthData();
      };

      // Trvale smazat stálou platbu ze šablon
      row.querySelector('.btn-tmi-del').onclick = async () => {
        if (!confirm(`Opravdu chceš trvale odstranit stálou platbu „${t.title}“ ze všech budoucích měsíců?`)) return;
        await dbDelete('templates', t.id);
        await renderTemplatesManagementList();
        await loadMonthData();
      };

      targetElement.appendChild(row);
    });
  }

  buildListHtml(listModal);
  buildListHtml(listSettings);
}

function setupTransferModal() {
  const modal = document.getElementById('modal-transfer');
  const btnOpen = document.getElementById('btn-quick-transfer');
  const btnCancel = document.getElementById('btn-cancel-transfer');
  const form = document.getElementById('form-transfer');

  if (btnOpen) {
    btnOpen.onclick = () => {
      form.reset();
      modal.classList.remove('hidden');
    };
  }

  if (btnCancel) {
    btnCancel.onclick = () => modal.classList.add('hidden');
  }

  form.onsubmit = async (e) => {
    e.preventDefault();

    const direction = document.getElementById('transfer-direction').value;
    const amountCzk = parseFloat(document.getElementById('transfer-amount').value);

    if (isNaN(amountCzk) || amountCzk <= 0) return;

    const amountCents = Money.toCents(amountCzk);
    const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    const today = new Date().getDate();

    if (direction === 'atm') {
      await dbAdd('entries', {
        monthYear: monthKey,
        title: 'Výběr z bankomatu (do peněženky)',
        amount: amountCents,
        category: 'Ostatní',
        day: today,
        wallet: 'bank',
        isIncome: false,
        paid: true
      });

      await dbAdd('entries', {
        monthYear: monthKey,
        title: 'Vklad hotovosti (z bankomatu)',
        amount: amountCents,
        category: 'Ostatní',
        day: today,
        wallet: 'cash',
        isIncome: true,
        paid: true
      });
    } else {
      await dbAdd('entries', {
        monthYear: monthKey,
        title: 'Vklad na bankovní účet',
        amount: amountCents,
        category: 'Ostatní',
        day: today,
        wallet: 'cash',
        isIncome: false,
        paid: true
      });

      await dbAdd('entries', {
        monthYear: monthKey,
        title: 'Příchozí vklad hotovosti',
        amount: amountCents,
        category: 'Ostatní',
        day: today,
        wallet: 'bank',
        isIncome: true,
        paid: true
      });
    }

    modal.classList.add('hidden');
    await loadMonthData();
  };
}

// 15. Cíle
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
        <button class="goal-btn btn-prio-up" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button class="goal-btn btn-prio-down" ${index === goals.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="goal-btn btn-del-goal" title="Smazat cíl">🗑️</button>
      </div>
    `;

    card.querySelector('.btn-toggle-pause').onclick = async () => {
      goal.paused = !goal.paused;
      await dbSet('goals', goal);
      await renderGoals();
    };

    card.querySelector('.btn-prio-up').onclick = async () => {
      if (index > 0) {
        const prevGoal = goals[index - 1];
        const temp = goal.priority;
        goal.priority = prevGoal.priority;
        prevGoal.priority = temp;
        await dbSet('goals', goal);
        await dbSet('goals', prevGoal);
        await renderGoals();
      }
    };

    card.querySelector('.btn-prio-down').onclick = async () => {
      if (index < goals.length - 1) {
        const nextGoal = goals[index + 1];
        const temp = goal.priority;
        goal.priority = nextGoal.priority;
        nextGoal.priority = temp;
        await dbSet('goals', goal);
        await dbSet('goals', nextGoal);
        await renderGoals();
      }
    };

    card.querySelector('.btn-del-goal').onclick = async () => {
      if (!confirm(`Opravdu chceš smazat cíl „${goal.title}“?`)) return;

      await dbDelete('goals', goal.id);

      const remainingGoals = await dbGetAll('goals');
      remainingGoals.sort((a, b) => a.priority - b.priority);

      for (let i = 0; i < remainingGoals.length; i++) {
        if (remainingGoals[i].priority !== i + 1) {
          remainingGoals[i].priority = i + 1;
          await dbSet('goals', remainingGoals[i]);
        }
      }

      await renderGoals();
    };

    container.appendChild(card);
  });
}

function setupGoalsModal() {
  const modal = document.getElementById('modal-goal');
  const btnOpen = document.getElementById('btn-add-goal');
  const btnCancel = document.getElementById('btn-cancel-goal');
  const form = document.getElementById('form-goal');

  if (btnOpen) {
    btnOpen.onclick = () => {
      form.reset();
      modal.classList.remove('hidden');
    };
  }

  if (btnCancel) {
    btnCancel.onclick = () => modal.classList.add('hidden');
  }

  form.onsubmit = async (e) => {
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
  };
}

// 16. Dluhy: Provident & AvaFin
async function renderDebts() {
  const debts = await dbGetAll('debts');
  const recContainer = document.getElementById('receivables-list');
  const payContainer = document.getElementById('payables-list');

  recContainer.innerHTML = '';
  payContainer.innerHTML = '';

  const monthNames = [
    'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
    'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'
  ];

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
        btn.onclick = () => {
          openDebtTxModal(d, btn.dataset.action);
        };
      });

      recContainer.appendChild(card);
    } else {
      let remainingMonths = 0;
      let endDateStr = 'Splaceno';

      if (d.total > 0 && d.monthly > 0) {
        remainingMonths = Math.ceil(d.total / d.monthly);
        const endD = new Date(currentDate);
        endD.setMonth(endD.getMonth() + remainingMonths);
        endDateStr = `${monthNames[endD.getMonth()]} ${endD.getFullYear()}`;
      }

      card.innerHTML = `
        <div class="debt-card-header">
          <span class="debt-name">${d.name}</span>
          <span class="debt-total payable">${Money.toCzk(d.total)}</span>
        </div>
        <div class="debt-sub-info">Měsíční splátka: <strong>${Money.toCzk(d.monthly)}</strong> (k ${d.day}. dni)</div>
        
        <div class="debt-plan-box">
          <span>Zbývá: <strong>${remainingMonths} měsíců</strong></span>
          <span>Konec splácení: <strong>${endDateStr}</strong></span>
        </div>

        <div class="debt-actions-row">
          <button class="debt-btn btn-pay btn-confirm-monthly">Potvrdit splátku (${Money.toCzkInt(d.monthly)})</button>
          <button class="debt-btn btn-extra btn-open-extra-pay">⚡ Mimořádná splátka</button>
        </div>
      `;

      card.querySelector('.btn-confirm-monthly').onclick = async () => {
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
          wallet: 'bank',
          isIncome: false,
          paid: true
        });

        await loadMonthData();
        await renderDebts();
      };

      card.querySelector('.btn-open-extra-pay').onclick = () => {
        openExtraPayModal(d);
      };

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

  if (btnCancel) {
    btnCancel.onclick = () => modal.classList.add('hidden');
  }

  form.onsubmit = async (e) => {
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
        wallet: 'bank',
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
  };

  const modalExtra = document.getElementById('modal-extra-pay');
  const formExtra = document.getElementById('form-extra-pay');
  const btnCancelExtra = document.getElementById('btn-cancel-extra-pay');

  if (btnCancelExtra) {
    btnCancelExtra.onclick = () => modalExtra.classList.add('hidden');
  }

  if (formExtra) {
    formExtra.onsubmit = async (e) => {
      e.preventDefault();
      const debtId = parseInt(document.getElementById('extra-pay-debt-id').value, 10);
      const extraCzk = parseFloat(document.getElementById('extra-pay-amount').value);

      if (isNaN(extraCzk) || extraCzk <= 0) return;

      const debt = await dbGet('debts', debtId);
      if (!debt) return;

      const extraCents = Money.toCents(extraCzk);
      const actualPay = Math.min(debt.total, extraCents);
      debt.total -= actualPay;
      await dbSet('debts', debt);

      const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
      await dbAdd('entries', {
        monthYear: monthKey,
        title: `Mimořádná splátka: ${debt.name}`,
        amount: actualPay,
        category: 'Závazky',
        day: new Date().getDate(),
        wallet: 'bank',
        isIncome: false,
        paid: true
      });

      modalExtra.classList.add('hidden');
      alert(`Mimořádná splátka ${extraCzk.toLocaleString('cs-CZ')} Kč proběhla. Dluh i datum doplacení byly okamžitě přepočítány.`);
      await loadMonthData();
      await renderDebts();
    };
  }
}

function openExtraPayModal(debt) {
  const modal = document.getElementById('modal-extra-pay');
  const form = document.getElementById('form-extra-pay');
  const title = document.getElementById('modal-extra-pay-title');
  const idInput = document.getElementById('extra-pay-debt-id');

  form.reset();
  idInput.value = debt.id;
  title.textContent = `Mimořádná splátka: ${debt.name}`;
  modal.classList.remove('hidden');
}

// 17. Investice: Investown, Slitky & Ostatní
async function renderInvestments() {
  const investments = await dbGetAll('investments');
  const goldBars = await dbGetAll('gold_bars') || [];
  const container = document.getElementById('investments-list');
  container.innerHTML = '';

  let totalInvested = 0;
  let totalCurrent = 0;

  let itownRecord = await dbGet('settings', 'itown_data');
  if (!itownRecord) {
    itownRecord = {
      key: 'itown_data',
      invested: 718116,
      profit: 344302
    };
    await dbSet('settings', itownRecord);
  }

  const itownTotal = itownRecord.invested + itownRecord.profit;
  const itownRoi = itownRecord.invested > 0 ? ((itownRecord.profit / itownRecord.invested) * 100).toFixed(1) : 0;

  document.getElementById('itown-disp-total').textContent = Money.toCzk(itownTotal);
  document.getElementById('itown-disp-invested').textContent = Money.toCzk(itownRecord.invested);
  document.getElementById('itown-disp-profit').textContent = `+ ${Money.toCzk(itownRecord.profit)}`;
  document.getElementById('itown-disp-roi').textContent = `${itownRoi} % zisk`;

  totalInvested += itownRecord.invested;
  totalCurrent += itownTotal;

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

    card.querySelector('.btn-del-reading').onclick = async () => {
      await dbDelete('investments', inv.id);
      await renderInvestments();
    };

    container.appendChild(card);
  });

  await renderGoldBars(goldBars);
  goldBars.forEach(g => {
    totalInvested += g.bought;
    totalCurrent += g.current;
  });

  const liquidCash = await getCalculatedBalance();
  const netWorth = liquidCash + totalCurrent;
  const investRatio = netWorth > 0 ? Math.round((totalCurrent / netWorth) * 100) : 0;

  document.getElementById('disp-total-networth').textContent = Money.toCzkInt(netWorth);
  document.getElementById('disp-total-current').textContent = Money.toCzkInt(totalCurrent);
  document.getElementById('assets-ratio-text').textContent = `${investRatio}%`;

  drawDonutChart('assets-donut-chart', investRatio);

  const allEntries = await dbGetAll('entries');
  await drawInvestmentTrendChart(totalInvested, totalCurrent);
  await drawWebEarningsTrendChart(allEntries);

  const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  const webEntries = allEntries.filter(e => e.monthYear === monthKey && e.isIncome && e.category === 'Web & Projekty');

  const webContainer = document.getElementById('web-earnings-items');
  webContainer.innerHTML = '';
  let webSum = 0;

  if (webEntries.length === 0) {
    webContainer.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted);">V tomto měsíci zatím není zaevidován příjem z webu.</span>';
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

function setupInvestownSpecifics() {
  const btnDepCustom = document.Pro možnost správy trvalých měsíčních výdajů (šablon) – tedy jejich přidávání, mazání nebo odebrání konkrétního výdaje v daném měsíci – jsme upravili soubory aplikace.

Přímo do záložky **Platby** přibyl přepínač mezi **„Položky měsíce“** a **„Stálé šablony plateb“**:
1. **Odebrání položky z aktuálního měsíce**: U každé platby v seznamu je nyní tlačítko 🗑️, kterým ji můžeš z daného měsíce smazat.
2. **Správa stálých šablon (Trvalé měsíční platby)**:
   - Můžeš přidat novou trvalou platbu s libovolnou periodicitou (měsíční, pololetní, roční).
   - Můžeš kteroukoliv stálou platbu trvale smazat nebo ji dočasně vypnout/zapnout (např. když skončí nějaké předplatné).

---

### 1. `index.html`

V sekci `#tab-payments` přibyl přepínač zobrazení a správa šablon:

```html
<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Koloběžníkův finanční dispečink</title>
  <link rel="manifest" href="manifest.json">
  <meta name="theme-color" content="#0f172a">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="app-header">
    <div class="header-left">
      <span class="logo-badge">⚡ KD</span>
      <h1 id="app-title">Dispečink</h1>
    </div>
    <div class="header-right" id="month-selector-wrap">
      <button id="prev-month" class="nav-btn">◀</button>
      <span id="current-month-display">Listopad 2026</span>
      <button id="next-month" class="nav-btn">▶</button>
    </div>
  </header>

  <main id="app-content">
    <!-- 1. Přehled & Zůstatky -->
    <section id="tab-overview" class="tab-panel active">
      <div class="balances-split-card">
        <div class="split-top-total">
          <span class="card-label">Celková dostupná likvidita</span>
          <div class="balance-amount" id="disp-total-liquidity">0 Kč</div>
          <div class="balance-sub" id="disp-safe-daily">Kapesné na den: počítám...</div>
        </div>

        <div class="split-accounts-grid">
          <div class="account-pill-box">
            <div class="acc-pill-header">
              <span>🏦 Bankovní účet</span>
              <span class="acc-tag">Air Bank</span>
            </div>
            <strong class="acc-pill-val text-blue" id="disp-bank-balance">0 Kč</strong>
          </div>
          <div class="account-pill-box">
            <div class="acc-pill-header">
              <span>💵 Hotovost</span>
              <span class="acc-tag">Peněženka</span>
            </div>
            <strong class="acc-pill-val text-green" id="disp-cash-balance">0 Kč</strong>
          </div>
        </div>

        <div class="quick-entry-row">
          <button id="btn-quick-add-income" class="btn-quick-action green">+ Příjem</button>
          <button id="btn-quick-add-expense" class="btn-quick-action red">− Výdaj</button>
          <button id="btn-quick-transfer" class="btn-quick-action blue">🔄 Převod</button>
        </div>

        <button id="btn-quick-salary" class="btn-quick-salary-banner">
          💰 Zadat výplatu za tento měsíc
        </button>
      </div>

      <!-- TACHOMETRY -->
      <div class="gauges-card">
        <div class="gauge-subhead">Výkonnost za posledních 30 dní a výhled na příštích 7 dní</div>
        
        <div class="gauges-main-row">
          <div class="gauge-box">
            <canvas id="gauge-balance" width="130" height="90"></canvas>
            <span class="g-lbl">ZŮSTATEK</span>
            <strong class="g-val" id="g-val-balance">0 Kč</strong>
          </div>
          <div class="gauge-box">
            <canvas id="gauge-cashflow" width="130" height="90"></canvas>
            <span class="g-lbl">CASH FLOW</span>
            <strong class="g-val" id="g-val-cashflow">0 Kč</strong>
          </div>
        </div>

        <div class="gauges-mini-row">
          <div class="gauge-mini-box">
            <canvas id="gauge-forecast" width="70" height="50"></canvas>
            <span class="gm-lbl">VÝHLED 7D</span>
            <span class="gm-val" id="gm-val-forecast">0 Kč</span>
          </div>
          <div class="gauge-mini-box">
            <canvas id="gauge-expenses" width="70" height="50"></canvas>
            <span class="gm-lbl">VÝDAJE</span>
            <span class="gm-val" id="gm-val-expenses">0 Kč</span>
          </div>
          <div class="gauge-mini-box">
            <canvas id="gauge-debt" width="70" height="50"></canvas>
            <span class="gm-lbl">DLUH %</span>
            <span class="gm-val" id="gm-val-debt">0 %</span>
          </div>
        </div>
      </div>

      <div class="timeframe-bar">
        <button class="tf-btn" data-tf="7d">7D</button>
        <button class="tf-btn active" data-tf="30d">30D</button>
        <button class="tf-btn" data-tf="12w">12T</button>
        <button class="tf-btn" data-tf="6m">6M</button>
        <button class="tf-btn" data-tf="1y">1R</button>
      </div>

      <div class="analytics-card" style="margin-top: 14px;">
        <div class="analytics-header">
          <h3>Tendence příjmů a výdajů</h3>
          <span class="badge-sub" id="income-expense-trend-badge">Vyhodnocení...</span>
        </div>
        <div class="canvas-wrapper">
          <canvas id="income-expense-trend-chart" width="400" height="170"></canvas>
        </div>
        <div class="chart-legend">
          <span>🟢 Křivka příjmů</span>
          <span>🔴 Křivka výdajů</span>
        </div>
      </div>

      <div class="analytics-card" style="margin-top: 14px;">
        <div class="analytics-header">
          <h3>Historie výplat & Měsíční průměr</h3>
          <span class="badge-sub" id="income-trend-badge">Průměr: 0 Kč</span>
        </div>
        <div class="canvas-wrapper">
          <canvas id="salary-trend-chart" width="400" height="170"></canvas>
        </div>
        <div class="chart-legend">
          <span>🟢 Skutečná čistá mzda</span>
          <span id="salary-avg-legend">⚪ Průměr ze zadaných výplat</span>
        </div>
      </div>

      <div class="analytics-card" style="margin-top: 14px;">
        <div class="analytics-header">
          <h3>Vývoj Cash Flow (Trend)</h3>
          <span class="badge-sub" id="cf-trend-net">Bilance: 0 Kč</span>
        </div>
        <div class="canvas-wrapper">
          <canvas id="cashflow-bar-chart" width="400" height="170"></canvas>
        </div>
        <div class="chart-legend">
          <span>🟢 Příjmy</span>
          <span>🔴 Výdaje</span>
          <span>⚪ Peněžní tok</span>
        </div>
      </div>

      <div class="analytics-card" style="margin-top: 14px;">
        <div class="analytics-header">
          <h3>Tabulka Cash Flow</h3>
          <span class="badge-sub">Statistiky</span>
        </div>
        <div class="cf-stats-table">
          <div class="cf-tbl-row header">
            <span>Rychlý přehled</span>
            <span>Příjmy</span>
            <span>Výdaje</span>
          </div>
          <div class="cf-tbl-row">
            <span>Počet transakcí</span>
            <strong id="cf-count-inc">0</strong>
            <strong id="cf-count-exp">0</strong>
          </div>
          <div class="cf-tbl-row">
            <span>Průměr / den</span>
            <strong id="cf-avg-day-inc" class="text-green">0 Kč</strong>
            <strong id="cf-avg-day-exp" class="text-red">0 Kč</strong>
          </div>
          <div class="cf-tbl-row">
            <span>Celkem</span>
            <strong id="cf-total-inc" class="text-green">0 Kč</strong>
            <strong id="cf-total-exp" class="text-red">0 Kč</strong>
          </div>
          <div class="cf-tbl-row footer">
            <span>Čistý peněžní tok:</span>
            <strong id="cf-net-total" class="text-blue" style="grid-column: span 2; text-align: right;">0 Kč</strong>
          </div>
        </div>
      </div>

      <div class="analytics-card" style="margin-top: 14px;">
        <div class="analytics-header">
          <h3>Variabilní útrata (bez stálých plateb)</h3>
          <span class="badge-sub" id="badge-var-total">0 Kč</span>
        </div>
        <div id="variable-breakdown-list" class="category-bars-wrap"></div>
      </div>

      <div class="analytics-card" style="margin-top: 14px;">
        <div class="analytics-header">
          <h3>Celková struktura výdajů</h3>
          <span class="badge-sub">Všechny platby</span>
        </div>
        <div id="category-breakdown-list" class="category-bars-wrap"></div>
      </div>
    </section>

    <!-- 2. Platby: PŘEPÍNAČ POLOŽEK VS. ŠABLON TRVALÝCH PLATEB -->
    <section id="tab-payments" class="tab-panel">
      <!-- PŘEPÍNAČ: POLOŽKY MĚSÍCE VS. STÁLÉ ŠABLONY -->
      <div class="payments-view-toggle">
        <button id="btn-toggle-month-entries" class="view-toggle-btn active">📅 Položky měsíce</button>
        <button id="btn-toggle-templates" class="view-toggle-btn">📋 Trvalé šablony plateb</button>
      </div>

      <!-- Pohled 1: Aktuální měsíc -->
      <div id="view-month-entries">
        <div class="action-bar">
          <button id="btn-add-entry" class="action-btn-main">+ Přidat položku ručně</button>
        </div>

        <div class="payments-summary-card">
          <div class="summary-line">
            <span>Celkové výdaje měsíce:</span>
            <strong id="payments-total-exp">0 Kč</strong>
          </div>
          <div class="summary-progress-bar">
            <div id="payments-progress-fill" style="width: 0%;"></div>
          </div>
        </div>

        <div id="payments-list" class="entries-list"></div>
      </div>

      <!-- Pohled 2: Správa trvalých šablon měsíčních/stálých výdajů -->
      <div id="view-templates" style="display: none;">
        <div class="action-bar">
          <button id="btn-add-template" class="action-btn-main" style="background-color: var(--accent-green); color:#0b0f19;">+ Vytvořit novou stálou platbu</button>
        </div>

        <div class="section-title-wrap">
          <h2>Seznam trvalých měsíčních výdajů</h2>
        </div>
        <div id="templates-list" class="templates-container"></div>
      </div>

      <!-- Modální okno: Položka -->
      <div id="modal-entry" class="modal hidden">
        <div class="modal-content">
          <h2 id="modal-entry-title">Nová položka</h2>
          <form id="form-entry">
            <div class="form-group">
              <label>Typ položky</label>
              <div class="radio-row">
                <label><input type="radio" name="entryType" value="expense" checked> Výdaj</label>
                <label><input type="radio" name="entryType" value="income"> Příjem</label>
              </div>
            </div>

            <div class="form-group">
              <label>Zdroj financí</label>
              <div class="wallet-select-row">
                <label class="wallet-radio-box">
                  <input type="radio" name="entryWallet" value="bank" checked>
                  <span>🏦 Bankovní účet</span>
                </label>
                <label class="wallet-radio-box">
                  <input type="radio" name="entryWallet" value="cash">
                  <span>💵 Hotovost</span>
                </label>
              </div>
            </div>

            <div class="form-group">
              <label for="entry-title">Název / Popis</label>
              <input type="text" id="entry-title" required placeholder="např. Nákup Lidl, Oběd, Výplata">
            </div>

            <div class="form-group">
              <label for="entry-amount">Částka (Kč)</label>
              <input type="number" id="entry-amount" step="0.01" required placeholder="0.00">
            </div>

            <div class="form-group">
              <label for="entry-category">Kategorie</label>
              <select id="entry-category">
                <option value="Výplata">Výplata & Hlavní příjem</option>
                <option value="Web & Projekty">Web & Vedlejší výdělky</option>
                <option value="Jídlo & Potraviny">Jídlo & Potraviny</option>
                <option value="Drogerie & Domácnost">Drogerie & Domácnost</option>
                <option value="Doprava & Benzín">Doprava & Benzín</option>
                <option value="Restaurace & Občerstvení">Restaurace & Občerstvení</option>
                <option value="Elektro & Nářadí">Elektro & Nářadí</option>
                <option value="Zvířata">Zvířata & Chov</option>
                <option value="Zdraví & Lékárna">Zdraví & Lékárna</option>
                <option value="Energie">Energie</option>
                <option value="Bydlení">Bydlení</option>
                <option value="Komunikace">Komunikace</option>
                <option value="Služby">Služby & Předplatné</option>
                <option value="Závazky">Závazky & Splátky</option>
                <option value="Investice">Investice & Slitky</option>
                <option value="Ostatní">Ostatní útrata</option>
              </select>
            </div>

            <div class="form-group">
              <label for="entry-day">Den v měsíci (1–31)</label>
              <input type="number" id="entry-day" min="1" max="31" value="10">
            </div>

            <div class="form-group checkbox-row" id="wrap-entry-recurring">
              <label><input type="checkbox" id="entry-recurring"> Uložit jako trvalou platbu do šablon</label>
            </div>

            <div id="wrap-recurring-frequency" class="recurring-freq-box hidden">
              <div class="form-group">
                <label for="entry-frequency">Periodicita platby</label>
                <select id="entry-frequency">
                  <option value="monthly">Každý měsíc</option>
                  <option value="semi-annual">Pololetně (2× za rok)</option>
                  <option value="annual">Ročně (1× za rok)</option>
                </select>
              </div>
              <div class="form-group" id="wrap-due-months" style="display: none;">
                <label for="entry-due-months">Měsíce splatnosti (čísla oddělená čárkou, např. 5, 11 nebo 7)</label>
                <input type="text" id="entry-due-months" placeholder="např. 1 pro leden, 7 pro červenec, 5, 11 pro květen a listopad">
              </div>
            </div>

            <div class="modal-actions">
              <button type="button" id="btn-cancel-entry" class="btn-secondary">Zrušit</button>
              <button type="submit" class="btn-primary">Uložit položku</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Modální okno: Převod -->
      <div id="modal-transfer" class="modal hidden">
        <div class="modal-content">
          <h2>Převod / Výběr z bankomatu</h2>
          <form id="form-transfer">
            <div class="form-group">
              <label>Směr převodu</label>
              <select id="transfer-direction">
                <option value="atm">Výběr z bankomatu (Účet ➡️ Hotovost)</option>
                <option value="deposit">Vklad na účet (Hotovost ➡️ Účet)</option>
              </select>
            </div>

            <div class="form-group">
              <label for="transfer-amount">Částka (Kč)</label>
              <input type="number" id="transfer-amount" step="1" required placeholder="např. 2000">
            </div>

            <div class="modal-actions">
              <button type="button" id="btn-cancel-transfer" class="btn-secondary">Zrušit</button>
              <button type="submit" class="btn-primary">Provést přesun</button>
            </div>
          </form>
        </div>
      </div>
    </section>

    <!-- 3. Cíle -->
    <section id="tab-goals" class="tab-panel">
      <div class="action-bar">
        <button id="btn-add-goal" class="action-btn-main">+ Přidat nový cíl</button>
      </div>

      <div class="goals-summary-card">
        <div class="summary-line">
          <span>K dispozici pro cíle:</span>
          <strong id="goals-available-disp" class="text-blue">0 Kč</strong>
        </div>
      </div>

      <div id="goals-list" class="goals-container"></div>

      <div id="modal-goal" class="modal hidden">
        <div class="modal-content">
          <h2>Nový cíl</h2>
          <form id="form-goal">
            <div class="form-group">
              <label for="goal-title">Název cíle</label>
              <input type="text" id="goal-title" required placeholder="např. Zlatý slitek 5g, Brikety">
            </div>

            <div class="form-group">
              <label for="goal-target">Cílová částka (Kč)</label>
              <input type="number" id="goal-target" step="1" required placeholder="10000">
            </div>

            <div class="modal-actions">
              <button type="button" id="btn-cancel-goal" class="btn-secondary">Zrušit</button>
              <button type="submit" class="btn-primary">Uložit cíl</button>
            </div>
          </form>
        </div>
      </div>
    </section>

    <!-- 4. Dluhy & Pohledávky -->
    <section id="tab-debts" class="tab-panel">
      <div class="section-title-wrap">
        <h2>Kdo mi dluží (Pohledávky)</h2>
      </div>
      <div id="receivables-list" class="debts-container"></div>

      <div class="section-title-wrap" style="margin-top: 24px;">
        <h2>Moje závazky (Půjčky)</h2>
      </div>
      <div id="payables-list" class="debts-container"></div>

      <div id="modal-debt-tx" class="modal hidden">
        <div class="modal-content">
          <h2 id="modal-debt-tx-title">Upravit pohledávku</h2>
          <form id="form-debt-tx">
            <input type="hidden" id="debt-tx-id">
            <input type="hidden" id="debt-tx-action">

            <div class="form-group">
              <label for="debt-tx-amount">Částka (Kč)</label>
              <input type="number" id="debt-tx-amount" step="1" required placeholder="0">
            </div>

            <div class="form-group">
              <label for="debt-tx-note">Důvod / Poznámka</label>
              <input type="text" id="debt-tx-note" placeholder="např. Část úhrady">
            </div>

            <div class="modal-actions">
              <button type="button" id="btn-cancel-debt-tx" class="btn-secondary">Zrušit</button>
              <button type="submit" class="btn-primary">Potvrdit</button>
            </div>
          </form>
        </div>
      </div>

      <div id="modal-extra-pay" class="modal hidden">
        <div class="modal-content">
          <h2 id="modal-extra-pay-title">Mimořádná splátka půjčky</h2>
          <form id="form-extra-pay">
            <input type="hidden" id="extra-pay-debt-id">

            <div class="form-group">
              <label for="extra-pay-amount">Částka mimořádné splátky (Kč)</label>
              <input type="number" id="extra-pay-amount" step="1" required placeholder="např. 5000">
            </div>

            <p class="settings-desc">Tato částka okamžitě poníží celkový dluh, odečte se z bankovního účtu a ihned zkrátí celkovou dobu splácení.</p>

            <div class="modal-actions">
              <button type="button" id="btn-cancel-extra-pay" class="btn-secondary">Zrušit</button>
              <button type="submit" class="btn-primary">Uhradit mimořádně</button>
            </div>
          </form>
        </div>
      </div>
    </section>

    <!-- 5. Investice, Investown & Zlaté slitky -->
    <section id="tab-invest" class="tab-panel">
      <div class="assets-ring-card">
        <div class="ring-left">
          <canvas id="assets-donut-chart" width="100" height="100"></canvas>
          <div class="ring-center-text" id="assets-ratio-text">0%</div>
        </div>
        <div class="ring-right">
          <span class="ar-lbl">Celková finanční aktiva</span>
          <strong class="ar-val" id="disp-total-networth">0 Kč</strong>
          <span class="ar-lbl" style="margin-top: 6px;">Z toho v investicích & zlatu</span>
          <strong class="ar-subval text-green" id="disp-total-current">0 Kč</strong>
        </div>
      </div>

      <div class="investown-hub-card">
        <div class="inv-hub-top">
          <div class="inv-hub-brand">
            <span class="diamond-icon">💎</span>
            <strong>INVESTOWN</strong>
          </div>
          <span class="inv-rate-pill" id="itown-disp-roi">0 % zisk</span>
        </div>

        <div class="inv-hub-main-amount">
          <span class="ih-lbl">Celková hodnota portfolia (Jistina + Zisk)</span>
          <div class="ih-val" id="itown-disp-total">0 Kč</div>
        </div>

        <div class="inv-hub-metrics-grid">
          <div class="ih-metric">
            <span class="ih-m-lbl">Vložená jistina (vklady)</span>
            <strong class="ih-m-val text-blue" id="itown-disp-invested">0 Kč</strong>
          </div>
          <div class="ih-metric">
            <span class="ih-m-lbl">Celkový zisk (z aplikace)</span>
            <strong class="ih-m-val text-green" id="itown-disp-profit">+ 0 Kč</strong>
          </div>
        </div>

        <div class="itown-actions-row">
          <button id="btn-itown-deposit-custom" class="btn-itown-action green">+ Vložit peníze</button>
          <button id="btn-itown-sell" class="btn-itown-action orange">− Prodej / Výběr</button>
          <button id="btn-itown-quick-sync-profit" class="btn-itown-action blue">📈 Zadat zisk z mobilu</button>
        </div>
      </div>

      <div class="gold-hub-card" style="margin-top: 14px;">
        <div class="gold-hub-top">
          <div class="gold-hub-brand">
            <span class="gold-bar-icon">🪙</span>
            <strong>Fyzické zlato (Slitky)</strong>
          </div>
          <button id="btn-add-gold" class="btn-small-primary" style="background:#eab308; color:#0b0f19;">+ Zapsat slitek</button>
        </div>

        <div class="gold-metrics-grid">
          <div class="gm-col">
            <span class="gm-lbl">Celkem slitků</span>
            <strong class="gm-val" id="disp-gold-grams">0 g</strong>
          </div>
          <div class="gm-col">
            <span class="gm-lbl">Nákupní cena</span>
            <strong class="gm-val" id="disp-gold-bought">0 Kč</strong>
          </div>
          <div class="gm-col">
            <span class="gm-lbl">Aktuální hodnota</span>
            <strong class="gm-val text-yellow" id="disp-gold-current">0 Kč</strong>
          </div>
        </div>

        <div id="gold-bars-list" class="gold-bars-container" style="margin-top: 10px;"></div>
      </div>

      <div class="analytics-card" style="margin-top: 14px;">
        <div class="analytics-header">
          <h3>Křivka růstu portfolia (Investice + Zlato)</h3>
          <span class="badge-sub" id="invest-growth-badge">+0 Kč zisk</span>
        </div>
        <div class="canvas-wrapper">
          <canvas id="invest-trend-chart" width="400" height="170"></canvas>
        </div>
        <div class="chart-legend">
          <span>🔵 Aktuální hodnota (včetně výnosů)</span>
          <span>⚪ Pouze vložený kapitál (přírůstky)</span>
        </div>
      </div>

      <div class="analytics-card" style="margin-top: 14px;">
        <div class="analytics-header">
          <h3>Křivka výdělků z webu & projektů</h3>
          <span class="badge-sub" id="web-trend-badge">Měsíční trend</span>
        </div>
        <div class="canvas-wrapper">
          <canvas id="web-trend-chart" width="400" height="170"></canvas>
        </div>
        <div class="chart-legend">
          <span>🟢 Měsíční příjem z webu</span>
          <span id="web-avg-legend">⚪ Průměr</span>
        </div>
      </div>

      <div class="action-bar" style="margin-top: 16px;">
        <button id="btn-add-investment" class="action-btn-main">+ Přidat další platformu (Portu, ETF...)</button>
      </div>

      <div class="section-title-wrap" style="margin-top: 16px;">
        <h2>Ostatní finanční aktiva</h2>
      </div>
      <div id="investments-list" class="investments-container"></div>

      <div class="analytics-card" style="margin-top: 20px;">
        <div class="analytics-header">
          <h3>Rozpis výdělků z webu v tomto měsíci</h3>
          <span class="badge-sub">Koloběžník & Projekty</span>
        </div>
        <div class="web-earnings-summary">
          <span>Celkový příjem z webu:</span>
          <strong id="disp-month-web-earnings" class="text-green">0 Kč</strong>
        </div>
        <div id="web-earnings-items" class="web-earnings-list" style="margin-top: 10px;"></div>
      </div>

      <div id="modal-itown-deposit-custom" class="modal hidden">
        <div class="modal-content">
          <h2>Vložit peníze na Investown</h2>
          <form id="form-itown-deposit-custom">
            <div class="form-group">
              <label for="itown-deposit-amount-input">Částka vkladu (Kč)</label>
              <input type="number" id="itown-deposit-amount-input" step="1" required placeholder="např. 500 nebo 2500" value="500">
            </div>
            <p class="settings-desc">Tato částka navýší tvou vloženou jistinu na Investownu a odečte se z bankovního účtu.</p>
            <div class="modal-actions">
              <button type="button" id="btn-cancel-itown-deposit-custom" class="btn-secondary">Zrušit</button>
              <button type="submit" class="btn-primary">Vložit</button>
            </div>
          </form>
        </div>
      </div>

      <div id="modal-itown-profit-direct" class="modal hidden">
        <div class="modal-content">
          <h2>Aktualizovat Celkový zisk Investownu</h2>
          <form id="form-itown-profit-direct">
            <div class="form-group">
              <label for="itown-direct-profit-input">Aktuální celkový zisk z mobilu (Kč)</label>
              <input type="number" id="itown-direct-profit-input" step="0.01" required placeholder="např. 3443.02">
            </div>
            <p class="settings-desc">Zadej číslo „Celkový zisk“ z obrazovky Investownu. Celková hodnota portfolia, graf zhodnocení i procentuální výnos se samy okamžitě přepočítají.</p>
            <div class="modal-actions">
              <button type="button" id="btn-cancel-itown-profit-direct" class="btn-secondary">Zrušit</button>
              <button type="submit" class="btn-primary">Uložit a přepočítat</button>
            </div>
          </form>
        </div>
      </div>

      <div id="modal-itown-sell" class="modal hidden">
        <div class="modal-content">
          <h2>Prodej / Výběr z Investownu</h2>
          <form id="form-itown-sell">
            <div class="form-group">
              <label for="itown-sell-amount">Částka k prodeji / výběru (Kč)</label>
              <input type="number" id="itown-sell-amount" step="1" required placeholder="např. 2500">
            </div>
            <p class="settings-desc">Tato částka poníží tvou zainvestovanou jistinu na Investownu a vrátí peníze zpět jako příjem na bankovní účet.</p>
            <div class="modal-actions">
              <button type="button" id="btn-cancel-itown-sell" class="btn-secondary">Zrušit</button>
              <button type="submit" class="btn-primary" style="background:var(--accent-yellow); color:#0b0f19;">Prodat / Vybrat</button>
            </div>
          </form>
        </div>
      </div>

      <div id="modal-gold" class="modal hidden">
        <div class="modal-content">
          <h2>Nový zlatý slitek</h2>
          <form id="form-gold">
            <div class="form-group">
              <label for="gold-name">Název / Rafinér</label>
              <input type="text" id="gold-name" required placeholder="Argor-Heraeus 5g">
            </div>

            <div class="form-group">
              <label for="gold-weight">Hmotnost v gramech (g)</label>
              <input type="number" id="gold-weight" step="0.1" required placeholder="5">
            </div>

            <div class="form-group">
              <label for="gold-bought">Nákupní cena (Kč)</label>
              <input type="number" id="gold-bought" step="1" required placeholder="10500">
            </div>

            <div class="form-group">
              <label for="gold-current">Aktuální hodnota (Kč)</label>
              <input type="number" id="gold-current" step="1" required placeholder="11200">
            </div>

            <div class="modal-actions">
              <button type="button" id="btn-cancel-gold" class="btn-secondary">Zrušit</button>
              <button type="submit" class="btn-primary">Uložit slitek</button>
            </div>
          </form>
        </div>
      </div>

      <div id="modal-investment" class="modal hidden">
        <div class="modal-content">
          <h2>Nová investiční platforma</h2>
          <form id="form-investment">
            <div class="form-group">
              <label for="inv-name">Název platformy / fondu</label>
              <input type="text" id="inv-name" required placeholder="např. Portu, Rentier.cz">
            </div>

            <div class="form-group">
              <label for="inv-invested">Vložená částka (Kč)</label>
              <input type="number" id="inv-invested" step="1" required placeholder="5000">
            </div>

            <div class="form-group">
              <label for="inv-current">Aktuální hodnota (Kč)</label>
              <input type="number" id="inv-current" step="1" required placeholder="5250">
            </div>

            <div class="form-group">
              <label for="inv-note">Poznámka / Strategie</label>
              <input type="text" id="inv-note" placeholder="např. Konzervativní portfolio">
            </div>

            <div class="modal-actions">
              <button type="button" id="btn-cancel-investment" class="btn-secondary">Zrušit</button>
              <button type="submit" class="btn-primary">Uložit</button>
            </div>
          </form>
        </div>
      </div>
    </section>

    <!-- 6. Energie -->
    <section id="tab-energy" class="tab-panel">
      <div class="energy-overview-card">
        <div class="energy-row">
          <span>Cena elektřiny:</span>
          <strong id="disp-kwh-price">6,50 Kč / kWh</strong>
        </div>
        <div class="energy-row">
          <span>Měsíční záloha (ČEZ):</span>
          <strong id="disp-cez-deposit">3 000 Kč</strong>
        </div>
        <div class="energy-row highlight">
          <span>Kapacita zálohy 3 000 Kč:</span>
          <strong id="disp-max-allowed-kwh">461,5 kWh / měsíc</strong>
        </div>
      </div>

      <div class="analytics-card" style="margin-top: 14px;">
        <div class="analytics-header">
          <h3>Měsíční vyhodnocení odečtu (vs. záloha 3 000 Kč)</h3>
          <span class="badge-sub" id="energy-trend-badge">Vyhodnocuji...</span>
        </div>
        <div class="meter-evaluation-box" id="disp-meter-eval-box"></div>
      </div>

      <div class="chart-card" style="margin-top: 14px;">
        <div class="chart-header">
          <h3>Křivka a tendence spotřeby domu (kWh/den)</h3>
          <button id="btn-add-meter-reading" class="btn-small-primary">+ Zadat měsíční odečet</button>
        </div>
        <div class="canvas-wrapper">
          <canvas id="energy-chart" width="400" height="180"></canvas>
        </div>
        <div class="chart-legend">
          <span>🔵 Křivka denního odběru</span>
          <span id="chart-avg-label">⚪ Průměr: 0 kWh/den</span>
        </div>
      </div>

      <div class="section-title-wrap" style="margin-top: 16px;">
        <h2>Historie měsíčních odečtů & Přeplatky/Nedoplatky</h2>
      </div>
      <div id="meter-readings-history" class="meter-history-container"></div>

      <div class="analytics-card" style="margin-top: 20px;">
        <div class="analytics-header">
          <h3>Kalkulačka libovolné spotřeby</h3>
          <span class="badge-sub">Kč vs. kWh</span>
        </div>
        <div class="energy-calc-wrap">
          <div class="form-group">
            <label for="calc-kwh-input">Zadej spotřebu (kWh):</label>
            <div class="calc-input-row">
              <input type="number" id="calc-kwh-input" value="100" step="1" min="0">
              <span class="unit-tag">kWh</span>
            </div>
            <input type="range" id="calc-kwh-range" min="0" max="1000" step="5" value="100" class="kwh-slider">
          </div>
          <div class="calc-results-box">
            <div class="calc-result-item">
              <span class="res-lbl">Náklad při ceně <strong id="calc-unit-rate">6,50 Kč</strong>/kWh</span>
              <span class="res-val" id="calc-result-cost">650 Kč</span>
            </div>
            <div class="calc-result-item">
              <span class="res-lbl">Rozdíl oproti záloze (3 000 Kč)</span>
              <span class="res-val" id="calc-result-balance">+2 350 Kč (přeplatek)</span>
            </div>
          </div>
        </div>
      </div>

      <div class="action-bar" style="margin-top: 20px;">
        <button id="btn-add-appliance" class="action-btn-main">+ Přidat spotřebič / zařízení</button>
      </div>

      <div class="section-title-wrap" style="margin-top: 16px;">
        <h2>Evidence spotřebičů & Náklady na provoz</h2>
      </div>
      <div id="appliances-list" class="appliances-container"></div>

      <div id="modal-meter" class="modal hidden">
        <div class="modal-content">
          <h2>Nový měsíční odečet elektroměru</h2>
          <form id="form-meter">
            <div class="form-group">
              <label for="meter-date">Datum odečtu</label>
              <input type="date" id="meter-date" required>
            </div>

            <div class="form-group">
              <label for="meter-value">Stav na elektroměru (kWh)</label>
              <input type="number" id="meter-value" step="0.1" required placeholder="např. 13250.0">
            </div>

            <div class="form-group">
              <label for="meter-note">Poznámka</label>
              <input type="text" id="meter-note" placeholder="volitelná poznámka">
            </div>

            <div class="modal-actions">
              <button type="button" id="btn-cancel-meter" class="btn-secondary">Zrušit</button>
              <button type="submit" class="btn-primary">Uložit a vyhodnotit</button>
            </div>
          </form>
        </div>
      </div>

      <div id="modal-appliance" class="modal hidden">
        <div class="modal-content">
          <h2>Nový spotřebič</h2>
          <form id="form-appliance">
            <div class="form-group">
              <label for="appliance-name">Název spotřebiče</label>
              <input type="text" id="appliance-name" required placeholder="např. Bojler, Přímotop">
            </div>

            <div class="form-group">
              <label for="appliance-power">Příkon ve Wattech (W)</label>
              <input type="number" id="appliance-power" required placeholder="např. 2000">
            </div>

            <div class="form-group">
              <label for="appliance-hours">Denní provoz v hodinách (h)</label>
              <input type="number" id="appliance-hours" step="0.1" value="2" required placeholder="např. 2.5">
            </div>

            <div class="form-group">
              <label for="appliance-warranty-date">Datum nákupu</label>
              <input type="date" id="appliance-warranty-date">
            </div>

            <div class="form-group">
              <label for="appliance-warranty-months">Záruka (měsíce)</label>
              <input type="number" id="appliance-warranty-months" value="24">
            </div>

            <div class="modal-actions">
              <button type="button" id="btn-cancel-appliance" class="btn-secondary">Zrušit</button>
              <button type="submit" class="btn-primary">Uložit</button>
            </div>
          </form>
        </div>
      </div>
    </section>

    <!-- 7. Nastavení & Ochrana dat -->
    <section id="tab-settings" class="tab-panel">
      <div class="settings-card" style="border-color: rgba(56, 189, 248, 0.4);">
        <h3>🛡️ Nezávislé cloud zrcadlení (Ochrana proti smazání)</h3>
        <p class="settings-desc">Zadej svůj privátní GitHub Token (s právem <code>gist</code>). Aplikace bude při každé změně tiše zrcadlit data do tvého soukromého Gistu.</p>
        <div class="form-group" style="margin-top: 10px;">
          <label for="set-gh-token">GitHub Token (Classic, oprávnění: gist)</label>
          <input type="password" id="set-gh-token" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx">
        </div>
        <div class="settings-btns-grid">
          <button id="btn-save-cloud-sync" class="btn-primary">Aktivovat ochranu</button>
          <button id="btn-force-cloud-sync" class="btn-secondary">Zrcadlit ihned ⚡</button>
        </div>
        <div id="cloud-sync-status" class="import-status"></div>
      </div>

      <div class="settings-card" style="margin-top: 14px;">
        <h3>Propojení s Air Bank (Inteligentní CSV Import)</h3>
        <p class="settings-desc">Nahraj výpis z Air Bank. Aplikace automaticky roztřídí transakce do kategorií (všechny se automaticky připíší k bankovnímu účtu).</p>
        <input type="file" id="csv-file-input" accept=".csv,.txt" style="display: none;">
        <button id="btn-trigger-csv" class="action-btn-main" style="background-color: var(--accent-green); margin-top: 10px;">📥 Importovat CSV výpis z Air Bank</button>
        <div id="csv-import-status" class="import-status"></div>
      </div>

      <div class="settings-card" style="margin-top: 14px;">
        <h3>Finanční parametry (Počáteční stavy peněženek)</h3>
        <div class="form-group" style="margin-top: 10px;">
          <label for="set-bank-capital">Výchozí zůstatek na účtu (Air Bank v Kč)</label>
          <input type="number" id="set-bank-capital" step="1">
        </div>
        <div class="form-group">
          <label for="set-cash-capital">Výchozí hotovost (Peněženka v Kč)</label>
          <input type="number" id="set-cash-capital" step="1">
        </div>
        <div class="form-group">
          <label for="set-payday">Den výplaty v měsíci (1–31)</label>
          <input type="number" id="set-payday" min="1" max="31">
        </div>
        <div class="form-group">
          <label for="set-kwh-price">Cena elektřiny (Kč za kWh)</label>
          <input type="number" id="set-kwh-price" step="0.01">
        </div>
        <button id="btn-save-settings" class="action-btn-main" style="margin-top: 8px;">Uložit parametry</button>
      </div>

      <div class="settings-card" style="margin-top: 14px;">
        <h3>Ruční záloha a obnova databáze</h3>
        <p class="settings-desc">Jednorázová záloha všech tabulek do souboru JSON.</p>
        <div class="settings-btns-grid" style="margin-top: 10px;">
          <button id="btn-export-json" class="btn-secondary">📤 Stáhnout JSON</button>
          <button id="btn-copy-json" class="btn-secondary">📋 Kopírovat JSON</button>
        </div>
        <input type="file" id="restore-file-input" accept=".json" style="display: none;">
        <button id="btn-trigger-restore" class="btn-secondary" style="margin-top: 8px; width: 100%;">📥 Obnovit ze souboru JSON</button>
      </div>

      <div class="settings-card" style="margin-top: 14px; text-align: center;">
        <h3>Mobilní aplikace (PWA)</h3>
        <p class="settings-desc">Spouštěj aplikaci offline přímo z plochy telefonu.</p>
        <button id="btn-install-pwa" class="btn-secondary" style="margin-top: 10px; width: 100%;">📲 Přidat na plochu mobilu</button>
      </div>
    </section>
  </main>

  <button id="fab-add-btn" class="fab-btn" title="Rychle přidat položku">+</button>

  <nav class="bottom-nav">
    <button class="nav-item active" data-tab="overview">
      <span class="icon">📊</span>
      <span class="label">Přehled</span>
    </button>
    <button class="nav-item" data-tab="payments">
      <span class="icon">💳</span>
      <span class="label">Platby</span>
    </button>
    <button class="nav-item" data-tab="goals">
      <span class="icon">🎯</span>
      <span class="label">Cíle</span>
    </button>
    <button class="nav-item" data-tab="debts">
      <span class="icon">🤝</span>
      <span class="label">Dluhy</span>
    </button>
    <button class="nav-item" data-tab="invest">
      <span class="icon">📈</span>
      <span class="label">Investice</span>
    </button>
    <button class="nav-item" data-tab="energy">
      <span class="icon">⚡</span>
      <span class="label">Energie</span>
    </button>
    <button class="nav-item" data-tab="settings">
      <span class="icon">⚙️</span>
      <span class="label">Nastavení</span>
    </button>
  </nav>

  <script src="db.js"></script>
  <script src="app.js"></script>
</body>
</html>
