if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        reg.update();
        console.log('PWA Service Worker zaregistrován:', reg.scope);
      })
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
    setupPaymentsViewToggle();
    setupQuickEntryButtons();
    setupTransferModal();
    setupDebtsManagement();
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
      } else if (targetTab === 'payments') {
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

  if (curM && prevM && badge) {
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

  const trendBadge = document.getElementById('income-trend-badge');
  const avgLegend = document.getElementById('salary-avg-legend');
  if (trendBadge) trendBadge.textContent = avg > 0 ? `Průměr: ${avg.toLocaleString('cs-CZ')} Kč` : 'Čekám na zadání';
  if (avgLegend) avgLegend.textContent = avg > 0 ? `⚪ Průměrná mzda (${avg.toLocaleString('cs-CZ')} Kč)` : '⚪ Zadej výplaty';

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

    ctx.fillStyle = '#ffffff';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    if (c.pt.val > 0) {
      ctx.fillText(`${Math.round(c.pt.val / 1000)}k`, c.x, c.y - 8);
    }

    ctx.fillStyle = '#94a3b8';
    ctx.fillText(c.pt.label, c.x, height - 8);
  });
}

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

  const countIncEl = document.getElementById('cf-count-inc');
  const countExpEl = document.getElementById('cf-count-exp');
  const avgDayIncEl = document.getElementById('cf-avg-day-inc');
  const avgDayExpEl = document.getElementById('cf-avg-day-exp');
  const totalIncEl = document.getElementById('cf-total-inc');
  const totalExpEl = document.getElementById('cf-total-exp');
  const netDisp = document.getElementById('cf-net-total');

  if (countIncEl) countIncEl.textContent = countInc;
  if (countExpEl) countExpEl.textContent = countExp;
  if (avgDayIncEl) avgDayIncEl.textContent = Money.toCzkInt(avgDayInc);
  if (avgDayExpEl) avgDayExpEl.textContent = Money.toCzkInt(avgDayExp);
  if (totalIncEl) totalIncEl.textContent = Money.toCzkInt(totalInc);
  if (totalExpEl) totalExpEl.textContent = Money.toCzkInt(totalExp);

  if (netDisp) {
    netDisp.textContent = `${net >= 0 ? '+' : ''}${Money.toCzkInt(net)}`;
    netDisp.style.color = net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  }
}

function renderVariableExpensesBreakdown(entries) {
  const container = document.getElementById('variable-breakdown-list');
  const badgeTotal = document.getElementById('badge-var-total');
  if (!container) return;
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

  if (badgeTotal) badgeTotal.textContent = `${Money.toCzkInt(totalVarAmount)} celkem`;

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

function renderCategoryBreakdown(entries) {
  const container = document.getElementById('category-breakdown-list');
  if (!container) return;
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

function renderPaymentsList(entries) {
  const list = document.getElementById('payments-list');
  if (!list) return;
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
    if (item.frequency === 'semi-annual') freqTag = `<span class="entry-freq-tag">Pololetně</span>`;
    else if (item.frequency === 'annual') freqTag = `<span class="entry-freq-tag">Ročně</span>`;

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
        <button class="btn-del-entry" title="Odebrat z tohoto měsíce">🗑️</button>
      </div>
    `;

    row.querySelector('.entry-left').onclick = async () => {
      item.paid = !item.paid;
      await dbSet('entries', item);
      await loadMonthData();
    };

    row.querySelector('.btn-del-entry').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Odebrat položku „${item.title}“ z tohoto měsíce?`)) return;
      await dbDelete('entries', item.id);
      await loadMonthData();
    };

    list.appendChild(row);
  });

  const totalExpEl = document.getElementById('payments-total-exp');
  if (totalExpEl) totalExpEl.textContent = Money.toCzkInt(totalExpenses);

  const fillEl = document.getElementById('payments-progress-fill');
  if (fillEl) {
    const percent = totalExpenses > 0 ? Math.round((paidExpenses / totalExpenses) * 100) : 0;
    fillEl.style.width = `${percent}%`;
  }
}

async function renderTemplatesList() {
  const container = document.getElementById('templates-list');
  if (!container) return;
  container.innerHTML = '';

  const templates = await dbGetAll('templates');

  templates.forEach(t => {
    const card = document.createElement('div');
    card.className = `template-card ${t.active ? '' : 'inactive'}`;

    let freqLabel = 'Měsíčně';
    if (t.frequency === 'semi-annual') freqLabel = `Pololetně (${t.dueMonths?.join(', ') || '5, 11'}. měsíc)`;
    else if (t.frequency === 'annual') freqLabel = `Ročně (${t.dueMonths?.join(', ') || '7'}. měsíc)`;

    card.innerHTML = `
      <div class="tpl-info">
        <span class="tpl-title">${t.title}</span>
        <div class="tpl-meta">
          <span class="entry-badge">${t.category}</span>
          <span>${t.day}. den</span>
          <span class="entry-freq-tag">${freqLabel}</span>
        </div>
      </div>
      <div class="tpl-right">
        <span class="tpl-amount">${Money.toCzk(t.amount)}</span>
        <button class="btn-toggle-tpl" style="background:none;border:none;cursor:pointer;font-size:1.1rem;">
          ${t.active ? '🟢' : '⚪'}
        </button>
        <button class="btn-del-tpl" style="background:none;border:none;cursor:pointer;font-size:0.9rem;">🗑️</button>
      </div>
    `;

    card.querySelector('.btn-toggle-tpl').onclick = async () => {
      t.active = !t.active;
      await dbSet('templates', t);
      await renderTemplatesList();
    };

    card.querySelector('.btn-del-tpl').onclick = async () => {
      if (!confirm(`Trvale smazat šablonu „${t.title}“?`)) return;
      await dbDelete('templates', t.id);
      await renderTemplatesList();
    };

    container.appendChild(card);
  });
}

function setupPaymentsViewToggle() {
  const btnMonth = document.getElementById('btn-toggle-month-entries');
  const btnTpl = document.getElementById('btn-toggle-templates');
  const viewMonth = document.getElementById('view-month-entries');
  const viewTpl = document.getElementById('view-templates');

  if (btnMonth && btnTpl && viewMonth && viewTpl) {
    btnMonth.onclick = () => {
      btnMonth.classList.add('active');
      btnTpl.classList.remove('active');
      viewMonth.style.display = 'block';
      viewTpl.style.display = 'none';
    };

    btnTpl.onclick = async () => {
      btnTpl.classList.add('active');
      btnMonth.classList.remove('active');
      viewMonth.style.display = 'none';
      viewTpl.style.display = 'block';
      await renderTemplatesList();
    };
  }

  const btnAddTpl = document.getElementById('btn-add-template');
  if (btnAddTpl) {
    btnAddTpl.onclick = () => {
      const modal = document.getElementById('modal-entry');
      const form = document.getElementById('form-entry');
      form.reset();
      const expRadio = form.querySelector('input[name="entryType"][value="expense"]');
      if (expRadio) expRadio.checked = true;
      const recCheck = document.getElementById('entry-recurring');
      if (recCheck) recCheck.checked = true;
      const freqBox = document.getElementById('wrap-recurring-frequency');
      if (freqBox) freqBox.classList.remove('hidden');
      document.getElementById('modal-entry-title').textContent = 'Nová trvalá platba (Šablona)';
      modal.classList.remove('hidden');
    };
  }
}

function setupQuickEntryButtons() {
  const modal = document.getElementById('modal-entry');
  const form = document.getElementById('form-entry');

  function openEntryWithType(type, category = null, defaultTitle = '') {
    form.reset();
    const typeRadio = form.querySelector(`input[name="entryType"][value="${type}"]`);
    if (typeRadio) typeRadio.checked = true;
    
    const recWrap = document.getElementById('wrap-entry-recurring');
    if (recWrap) recWrap.style.display = type === 'income' ? 'none' : 'flex';
    
    const freqBox = document.getElementById('wrap-recurring-frequency');
    if (freqBox) freqBox.classList.add('hidden');
    
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
      if (recurringWrap) recurringWrap.style.display = 'flex';
      if (freqWrap) freqWrap.classList.add('hidden');
      if (dueMonthsWrap) dueMonthsWrap.style.display = 'none';
      document.getElementById('modal-entry-title').textContent = 'Nová položka';
      modal.classList.remove('hidden');
    };
  }

  if (btnCancel) {
    btnCancel.onclick = () => modal.classList.add('hidden');
  }

  if (recurringCheck) {
    recurringCheck.onchange = () => {
      if (recurringCheck.checked) {
        if (freqWrap) freqWrap.classList.remove('hidden');
      } else {
        if (freqWrap) freqWrap.classList.add('hidden');
      }
    };
  }

  if (freqSelect && dueMonthsWrap) {
    freqSelect.onchange = () => {
      dueMonthsWrap.style.display = (freqSelect.value === 'monthly') ? 'none' : 'block';
    };
  }

  radioTypes.forEach(radio => {
    radio.onchange = () => {
      if (recurringWrap) recurringWrap.style.display = radio.value === 'income' ? 'none' : 'flex';
      if (radio.value === 'income' && freqWrap) freqWrap.classList.add('hidden');
    };
  });

  form.onsubmit = async (e) => {
    e.preventDefault();

    const checkedType = form.querySelector('input[name="entryType"]:checked');
    const isIncome = checkedType ? checkedType.value === 'income' : false;

    const checkedWallet = form.querySelector('input[name="entryWallet"]:checked');
    const wallet = checkedWallet ? checkedWallet.value : 'bank';

    const titleInput = document.getElementById('entry-title');
    const title = titleInput ? titleInput.value.trim() : '';

    const amountInput = document.getElementById('entry-amount');
    const amountCzk = parseFloat(amountInput ? amountInput.value : 0);

    const categoryInput = document.getElementById('entry-category');
    const category = categoryInput ? categoryInput.value : 'Ostatní';

    const dayInput = document.getElementById('entry-day');
    const day = parseInt(dayInput ? dayInput.value : 10, 10) || 10;

    const isRecurring = recurringCheck ? recurringCheck.checked : false;
    const frequency = (freqSelect && isRecurring) ? freqSelect.value : 'monthly';
    const dueMonthsRaw = document.getElementById('entry-due-months')?.value || '';

    let dueMonths = [];
    if (frequency !== 'monthly' && dueMonthsRaw) {
      dueMonths = dueMonthsRaw.split(',').map(m => parseInt(m.trim(), 10)).filter(m => !isNaN(m) && m >= 1 && m <= 12);
    }

    if (!title || isNaN(amountCzk) || amountCzk <= 0) {
      alert('Zadej prosím platný název a částku.');
      return;
    }

    const amountCents = Money.toCents(amountCzk);
    const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

    if (!isIncome && isRecurring) {
      await dbAdd('templates', {
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
      paid: true
    });

    modal.classList.add('hidden');
    await loadMonthData();
    await renderTemplatesList();
  };
}

function setupTransferModal() {
  const modal = document.getElementById('modal-transfer');
  const btnOpen = document.getElementById('btn-quick-transfer');
  const btnOpen2 = document.getElementById('btn-quick-transfer-2');
  const btnCancel = document.getElementById('btn-cancel-transfer');
  const form = document.getElementById('form-transfer');

  if (btnOpen) {
    btnOpen.onclick = () => { form.reset(); modal.classList.remove('hidden'); };
  }
  if (btnOpen2) {
    btnOpen2.onclick = () => { form.reset(); modal.classList.remove('hidden'); };
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

async function renderGoals() {
  const balance = await getCalculatedBalance();
  const goalsAvailEl = document.getElementById('goals-available-disp');
  if (goalsAvailEl) goalsAvailEl.textContent = Money.toCzk(balance);

  const goals = await dbGetAll('goals');
  goals.sort((a, b) => a.priority - b.priority);

  const container = document.getElementById('goals-list');
  if (!container) return;
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

function setupDebtsManagement() {
  const modalDebtor = document.getElementById('modal-new-debtor');
  const btnAddDebtor = document.getElementById('btn-add-debtor');
  const btnCancelDebtor = document.getElementById('btn-cancel-new-debtor');
  const formDebtor = document.getElementById('form-new-debtor');

  if (btnAddDebtor) {
    btnAddDebtor.onclick = () => {
      formDebtor.reset();
      modalDebtor.classList.remove('hidden');
    };
  }

  if (btnCancelDebtor) {
    btnCancelDebtor.onclick = () => modalDebtor.classList.add('hidden');
  }

  if (formDebtor) {
    formDebtor.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('debtor-name-input').value.trim();
      const itemLabel = document.getElementById('debtor-item-label-input').value.trim();
      const amountCzk = parseFloat(document.getElementById('debtor-item-amount-input').value);

      if (!name || !itemLabel || isNaN(amountCzk) || amountCzk <= 0) return;

      const amountCents = Money.toCents(amountCzk);
      await dbAdd('debts', {
        type: 'receivable',
        name: name.toUpperCase(),
        total: amountCents,
        items: [
          { id: 'sub_' + Date.now(), label: itemLabel, amount: amountCents }
        ]
      });

      modalDebtor.classList.add('hidden');
      await renderDebts();
    };
  }

  const modalLoan = document.getElementById('modal-new-loan');
  const btnAddLoan = document.getElementById('btn-add-loan');
  const btnCancelLoan = document.getElementById('btn-cancel-new-loan');
  const formLoan = document.getElementById('form-new-loan');

  if (btnAddLoan) {
    btnAddLoan.onclick = () => {
      formLoan.reset();
      modalLoan.classList.remove('hidden');
    };
  }

  if (btnCancelLoan) {
    btnCancelLoan.onclick = () => modalLoan.classList.add('hidden');
  }

  if (formLoan) {
    formLoan.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('loan-name-input').value.trim();
      const totalCzk = parseFloat(document.getElementById('loan-total-input').value);
      const monthlyCzk = parseFloat(document.getElementById('loan-monthly-input').value);
      const day = parseInt(document.getElementById('loan-day-input').value, 10) || 10;

      if (!name || isNaN(totalCzk) || totalCzk <= 0 || isNaN(monthlyCzk) || monthlyCzk <= 0) return;

      const totalCents = Money.toCents(totalCzk);
      const monthlyCents = Money.toCents(monthlyCzk);

      await dbAdd('debts', {
        type: 'payable',
        name,
        total: totalCents,
        monthly: monthlyCents,
        day
      });

      modalLoan.classList.add('hidden');
      await renderDebts();
    };
  }

  const modalLend = document.getElementById('modal-lend-detailed');
  const formLend = document.getElementById('form-lend-detailed');
  const btnCancelLend = document.getElementById('btn-cancel-lend-detailed');
  const lendRadios = formLend ? formLend.querySelectorAll('input[name="lendMode"]') : [];
  const wrapLendExisting = document.getElementById('wrap-lend-existing-item');
  const wrapLendNew = document.getElementById('wrap-lend-new-item');

  if (btnCancelLend) {
    btnCancelLend.onclick = () => modalLend.classList.add('hidden');
  }

  lendRadios.forEach(radio => {
    radio.onchange = () => {
      if (radio.value === 'new') {
        wrapLendNew.style.display = 'block';
        wrapLendExisting.style.display = 'none';
      } else {
        wrapLendNew.style.display = 'none';
        wrapLendExisting.style.display = 'block';
      }
    };
  });

  if (formLend) {
    formLend.onsubmit = async (e) => {
      e.preventDefault();
      const debtorId = parseInt(document.getElementById('lend-debtor-id').value, 10);
      const mode = formLend.querySelector('input[name="lendMode"]:checked').value;
      const amountCzk = parseFloat(document.getElementById('lend-amount-input').value);
      const dateVal = document.getElementById('lend-date-input').value;
      const noteVal = document.getElementById('lend-note-input').value.trim();

      if (isNaN(amountCzk) || amountCzk <= 0 || !dateVal) return;

      const debt = await dbGet('debts', debtorId);
      if (!debt) return;

      const amountCents = Money.toCents(amountCzk);
      if (!debt.items) debt.items = [];

      if (mode === 'new') {
        const itemTitle = document.getElementById('lend-new-item-title').value.trim() || 'Půjčka';
        debt.items.push({
          id: 'sub_' + Date.now(),
          label: itemTitle,
          amount: amountCents,
          note: `Přičteno ${amountCzk} Kč (${dateVal}${noteVal ? ' - ' + noteVal : ''})`
        });
      } else {
        const existingIdx = parseInt(document.getElementById('lend-existing-item-select').value, 10);
        if (debt.items[existingIdx]) {
          debt.items[existingIdx].amount += amountCents;
          debt.items[existingIdx].note = `Navýšeno o +${amountCzk} Kč (${dateVal}${noteVal ? ' - ' + noteVal : ''})`;
        }
      }

      debt.total = debt.items.reduce((acc, it) => acc + it.amount, 0);
      await dbSet('debts', debt);

      modalLend.classList.add('hidden');
      alert(`Částka ${amountCzk} Kč byla přičtena k dluhu osoby ${debt.name}.`);
      await renderDebts();
    };
  }

  const modalRepay = document.getElementById('modal-repay-detailed');
  const formRepay = document.getElementById('form-repay-detailed');
  const btnCancelRepay = document.getElementById('btn-cancel-repay-detailed');

  if (btnCancelRepay) {
    btnCancelRepay.onclick = () => modalRepay.classList.add('hidden');
  }

  if (formRepay) {
    formRepay.onsubmit = async (e) => {
      e.preventDefault();
      const debtorId = parseInt(document.getElementById('repay-debtor-id').value, 10);
      const itemIdx = parseInt(document.getElementById('repay-target-item-select').value, 10);
      const amountCzk = parseFloat(document.getElementById('repay-amount-input').value);
      const dateVal = document.getElementById('repay-date-input').value;
      const noteVal = document.getElementById('repay-note-input').value.trim();

      if (isNaN(amountCzk) || amountCzk <= 0 || !dateVal) return;

      const debt = await dbGet('debts', debtorId);
      if (!debt || !debt.items || !debt.items[itemIdx]) return;

      const targetItem = debt.items[itemIdx];
      const amountCents = Money.toCents(amountCzk);
      const actualDeduct = Math.min(targetItem.amount, amountCents);

      targetItem.amount -= actualDeduct;
      targetItem.note = `Zaplaceno ${Money.toCzkInt(actualDeduct)} (${dateVal}${noteVal ? ' - ' + noteVal : ''})`;

      debt.total = debt.items.reduce((acc, it) => acc + it.amount, 0);
      await dbSet('debts', debt);

      const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
      await dbAdd('entries', {
        monthYear: monthKey,
        title: `Úhrada dluhu: ${debt.name} (${targetItem.label})`,
        amount: actualDeduct,
        category: 'Příjmy',
        day: new Date().getDate(),
        wallet: 'bank',
        isIncome: true,
        paid: true
      });

      modalRepay.classList.add('hidden');
      alert(`Úhrada ${Money.toCzkInt(actualDeduct)} byla odečtena z položky „${targetItem.label}“ a připsána na bankovní účet.`);
      await loadMonthData();
      await renderDebts();
    };
  }
}

async function renderDebts() {
  const debts = await dbGetAll('debts');
  const recContainer = document.getElementById('receivables-list');
  const payContainer = document.getElementById('payables-list');

  if (!recContainer || !payContainer) return;
  recContainer.innerHTML = '';
  payContainer.innerHTML = '';

  let totalPayables = 0;
  let totalReceivables = 0;

  const monthNames = [
    'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
    'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'
  ];

  debts.forEach(d => {
    const card = document.createElement('div');
    card.className = 'debt-card';

    if (d.type === 'receivable') {
      totalReceivables += d.total;

      let itemsHtml = '';
      if (d.items && d.items.length > 0) {
        itemsHtml = `<div class="debt-sub-items-list">` + d.items.map((item, idx) => `
          <div>
            <div class="debt-sub-item-row">
              <span class="ds-lbl">${item.label}</span>
              <div style="display:flex; align-items:center; gap:6px;">
                <span class="ds-val">${Money.toCzkInt(item.amount)}</span>
                <button class="btn-edit-item" data-debt-id="${d.id}" data-item-idx="${idx}" title="Upravit položku">✏️</button>
              </div>
            </div>
            ${item.note ? `<div class="debt-sub-item-note">✓ ${item.note}</div>` : ''}
          </div>
        `).join('') + `</div>`;
      }

      card.innerHTML = `
        <div class="debt-card-header">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="debt-name">${d.name}</span>
              <button class="btn-del-debtor" data-id="${d.id}" title="Smazat celou osobu">🗑️</button>
            </div>
            <div style="font-size:0.72rem; color:var(--text-muted);">${d.items ? d.items.length : 0} položky dluhu</div>
          </div>
          <div style="text-align:right;">
            <span class="debt-total receivable">${Money.toCzkInt(d.total)}</span>
            <div style="font-size:0.7rem; color:var(--text-muted);">Celkem dluží</div>
          </div>
        </div>

        ${itemsHtml}

        <div class="debt-actions-row">
          <button class="debt-btn btn-lend btn-open-lend-modal" data-id="${d.id}">+ Půjčit / Přičíst</button>
          <button class="debt-btn btn-pay btn-open-repay-modal" data-id="${d.id}">− Zadat úhradu (+ účet)</button>
        </div>
      `;

      card.querySelector('.btn-del-debtor').onclick = async () => {
        if (!confirm(`Opravdu chceš smazat dlužníka „${d.name}“?`)) return;
        await dbDelete('debts', d.id);
        await renderDebts();
      };

      card.querySelector('.btn-open-lend-modal').onclick = () => {
        openLendDetailedModal(d);
      };

      card.querySelector('.btn-open-repay-modal').onclick = () => {
        openRepayDetailedModal(d);
      };

      card.querySelectorAll('.btn-edit-item').forEach(btn => {
        btn.onclick = () => {
          const debtId = parseInt(btn.dataset.debtId, 10);
          const itemIdx = parseInt(btn.dataset.itemIdx, 10);
          openEditSubItemModal(debtId, itemIdx);
        };
      });

      recContainer.appendChild(card);
    } 
    else {
      totalPayables += d.total;

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
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="debt-name">${d.name}</span>
              <button class="btn-del-debtor" data-id="${d.id}" title="Smazat tuto půjčku">🗑️</button>
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
              Měsíční splátka: ${Money.toCzkInt(d.monthly)} (k ${d.day}. dni)
            </div>
          </div>
          <div style="text-align:right;">
            <span style="font-size:0.75rem; color:var(--accent-yellow); font-weight:600;">⏳ Čeká na potvrzení</span>
          </div>
        </div>

        <div style="margin: 8px 0 6px 0;">
          <div style="font-size:0.75rem; color:var(--text-muted);">Zbývající jistina:</div>
          <div style="font-size:1.45rem; font-weight:800; color:var(--text-main); margin-top:2px;">
            ${Money.toCzk(d.total)}
          </div>
        </div>

        <div class="debt-payoff-metrics" style="margin: 8px 0 10px 0;">
          <div class="dpm-col">
            <span class="dpm-lbl">Zbývá splácet</span>
            <span class="dpm-val">${remainingMonths} měsíců</span>
          </div>
          <div class="dpm-col" style="text-align:right;">
            <span class="dpm-lbl">Odhadované doplacení</span>
            <span class="dpm-val">${endDateStr}</span>
          </div>
        </div>

        <div class="debt-actions-row">
          <button class="debt-btn btn-pay btn-confirm-monthly">
            Potvrdit splátku ${Money.toCzkInt(d.monthly)}
          </button>
          <button class="debt-btn btn-extra btn-open-extra-pay">
            ⚡ Mimořádná splátka
          </button>
          <button class="debt-btn btn-secondary btn-edit-principal">
            Upravit jistinu
          </button>
        </div>
      `;

      card.querySelector('.btn-del-debtor').onclick = async () => {
        if (!confirm(`Opravdu chceš smazat půjčku „${d.name}“?`)) return;
        await dbDelete('debts', d.id);
        await renderDebts();
      };

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

      card.querySelector('.btn-edit-principal').onclick = async () => {
        const currentCzk = (d.total / 100).toFixed(2);
        const newCzkStr = prompt(`Zadej novou výši zbývající jistiny pro ${d.name} (Kč):`, currentCzk);
        if (newCzkStr === null) return;
        const newCzk = parseFloat(newCzkStr.replace(',', '.'));
        if (isNaN(newCzk) || newCzk < 0) return;

        d.total = Money.toCents(newCzk);
        await dbSet('debts', d);
        await renderDebts();
      };

      payContainer.appendChild(card);
    }
  });

  const dispPayEl = document.getElementById('disp-total-payables');
  const dispRecEl = document.getElementById('disp-total-receivables');
  if (dispPayEl) dispPayEl.textContent = Money.toCzk(totalPayables);
  if (dispRecEl) dispRecEl.textContent = Money.toCzkInt(totalReceivables);
}

function openLendDetailedModal(debt) {
  const modal = document.getElementById('modal-lend-detailed');
  const form = document.getElementById('form-lend-detailed');
  form.reset();

  document.getElementById('lend-debtor-id').value = debt.id;
  document.getElementById('modal-lend-detailed-title').textContent = `+ Přičíst dlužníkovi: ${debt.name}`;
  document.getElementById('lend-date-input').value = new Date().toISOString().slice(0, 10);

  const selectExisting = document.getElementById('lend-existing-item-select');
  selectExisting.innerHTML = '';
  if (debt.items && debt.items.length > 0) {
    debt.items.forEach((item, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${item.label} (${Money.toCzkInt(item.amount)})`;
      selectExisting.appendChild(opt);
    });
  }

  modal.classList.remove('hidden');
}

function openRepayDetailedModal(debt) {
  const modal = document.getElementById('modal-repay-detailed');
  const form = document.getElementById('form-repay-detailed');
  form.reset();

  document.getElementById('repay-debtor-id').value = debt.id;
  document.getElementById('modal-repay-detailed-title').textContent = `Zadat úhradu od: ${debt.name}`;
  document.getElementById('repay-date-input').value = new Date().toISOString().slice(0, 10);

  const selectTarget = document.getElementById('repay-target-item-select');
  selectTarget.innerHTML = '';

  if (debt.items && debt.items.length > 0) {
    debt.items.forEach((item, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${item.label} (Aktuální dluh: ${Money.toCzkInt(item.amount)})`;
      selectTarget.appendChild(opt);
    });
  }

  modal.classList.remove('hidden');
}

function openExtraPayModal(debt) {
  const modal = document.getElementById('modal-extra-pay');
  const form = document.getElementById('form-extra-pay');
  const title = document.getElementById('modal-extra-pay-title');
  const idInput = document.getElementById('extra-pay-debt-id');
  const amountInput = document.getElementById('extra-pay-amount');
  const impactBox = document.getElementById('extra-pay-impact-box');
  const savedMonthsEl = document.getElementById('extra-pay-saved-months');
  const newDateEl = document.getElementById('extra-pay-new-date');

  form.reset();
  idInput.value = debt.id;
  title.textContent = `Mimořádná splátka: ${debt.name}`;
  impactBox.style.display = 'none';

  const monthNames = [
    'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
    'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'
  ];

  amountInput.oninput = () => {
    const extraVal = parseFloat(amountInput.value);
    if (!isNaN(extraVal) && extraVal > 0 && debt.monthly > 0) {
      const currentRemainingMonths = Math.ceil(debt.total / debt.monthly);
      const remainingAfterExtra = Math.max(0, debt.total - Money.toCents(extraVal));
      const newRemainingMonths = Math.ceil(remainingAfterExtra / debt.monthly);
      const saved = currentRemainingMonths - newRemainingMonths;

      const newD = new Date(currentDate);
      newD.setMonth(newD.getMonth() + newRemainingMonths);
      const newDateStr = remainingAfterExtra === 0 ? 'Doplaceno ihned!' : `${monthNames[newD.getMonth()]} ${newD.getFullYear()}`;

      savedMonthsEl.textContent = `${saved} měsíců`;
      newDateEl.textContent = newDateStr;
      impactBox.style.display = 'grid';
    } else {
      impactBox.style.display = 'none';
    }
  };

  modal.classList.remove('hidden');
}

function setupDebtTxModal() {
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
      alert(`Mimořádná splátka ${extraCzk.toLocaleString('cs-CZ')} Kč proběhla. Jistina i datum doplacení byly okamžitě přepočítány.`);
      await loadMonthData();
      await renderDebts();
    };
  }
}

async function openEditSubItemModal(debtId, itemIdx) {
  const debt = await dbGet('debts', debtId);
  if (!debt || !debt.items || !debt.items[itemIdx]) return;

  const item = debt.items[itemIdx];
  const newAmountStr = prompt(`Zadej novou výši položky „${item.label}“ (Kč):`, Math.round(item.amount / 100));
  if (newAmountStr === null) return;

  const newAmountCzk = parseFloat(newAmountStr);
  if (isNaN(newAmountCzk) || newAmountCzk < 0) return;

  item.amount = Money.toCents(newAmountCzk);
  debt.total = debt.items.reduce((acc, it) => acc + it.amount, 0);
  await dbSet('debts', debt);

  await loadMonthData();
  await renderDebts();
}

async function renderInvestments() {
  const investments = await dbGetAll('investments');
  const goldBars = await dbGetAll('gold_bars') || [];
  const container = document.getElementById('investments-list');
  if (!container) return;
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

  const itownTotalEl = document.getElementById('itown-disp-total');
  const itownInvEl = document.getElementById('itown-disp-invested');
  const itownProfitEl = document.getElementById('itown-disp-profit');
  const itownRoiEl = document.getElementById('itown-disp-roi');

  if (itownTotalEl) itownTotalEl.textContent = Money.toCzk(itownTotal);
  if (itownInvEl) itownInvEl.textContent = Money.toCzk(itownRecord.invested);
  if (itownProfitEl) itownProfitEl.textContent = `+ ${Money.toCzk(itownRecord.profit)}`;
  if (itownRoiEl) itownRoiEl.textContent = `${itownRoi} % zisk`;

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

  const networthEl = document.getElementById('disp-total-networth');
  const currentEl = document.getElementById('disp-total-current');
  const ratioEl = document.getElementById('assets-ratio-text');

  if (networthEl) networthEl.textContent = Money.toCzkInt(netWorth);
  if (currentEl) currentEl.textContent = Money.toCzkInt(totalCurrent);
  if (ratioEl) ratioEl.textContent = `${investRatio}%`;

  drawDonutChart('assets-donut-chart', investRatio);

  const allEntries = await dbGetAll('entries');
  await drawInvestmentTrendChart(totalInvested, totalCurrent);
  await drawWebEarningsTrendChart(allEntries);

  const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  const webEntries = allEntries.filter(e => e.monthYear === monthKey && e.isIncome && e.category === 'Web & Projekty');

  const webContainer = document.getElementById('web-earnings-items');
  if (webContainer) {
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

    const monthWebEl = document.getElementById('disp-month-web-earnings');
    if (monthWebEl) monthWebEl.textContent = Money.toCzk(webSum);
  }
}

function setupInvestownSpecifics() {
  const btnDepCustom = document.getElementById('btn-itown-deposit-custom');
  const btnSell = document.getElementById('btn-itown-sell');
  const btnSyncProfit = document.getElementById('btn-itown-quick-sync-profit');

  const modalDep = document.getElementById('modal-itown-deposit-custom');
  const formDep = document.getElementById('form-itown-deposit-custom');
  const btnCancelDep = document.getElementById('btn-cancel-itown-deposit-custom');
  const inputDep = document.getElementById('itown-deposit-amount-input');

  if (btnDepCustom) {
    btnDepCustom.onclick = () => {
      formDep.reset();
      inputDep.value = 500;
      modalDep.classList.remove('hidden');
    };
  }

  if (btnCancelDep) {
    btnCancelDep.onclick = () => modalDep.classList.add('hidden');
  }

  if (formDep) {
    formDep.onsubmit = async (e) => {
      e.preventDefault();
      const depositCzk = parseFloat(inputDep.value);
      if (isNaN(depositCzk) || depositCzk <= 0) return;

      let itownRecord = await dbGet('settings', 'itown_data');
      if (!itownRecord) {
        itownRecord = { key: 'itown_data', invested: 718116, profit: 344302 };
      }

      const depCents = Money.toCents(depositCzk);
      itownRecord.invested += depCents;
      await dbSet('settings', itownRecord);

      const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
      await dbAdd('entries', {
        monthYear: monthKey,
        title: `Investown vklad (+${depositCzk} Kč)`,
        amount: depCents,
        category: 'Investice',
        day: new Date().getDate(),
        wallet: 'bank',
        isIncome: false,
        paid: true
      });

      modalDep.classList.add('hidden');
      alert(`Částka ${depositCzk.toLocaleString('cs-CZ')} Kč byla připsána k jistině Investownu a odečtena z bankovního účtu.`);
      await loadMonthData();
      await renderInvestments();
    };
  }

  const modalProfit = document.getElementById('modal-itown-profit-direct');
  const formProfit = document.getElementById('form-itown-profit-direct');
  const inputProfit = document.getElementById('itown-direct-profit-input');
  const btnCancelProfit = document.getElementById('btn-cancel-itown-profit-direct');

  function openDirectProfitModal() {
    dbGet('settings', 'itown_data').then(rec => {
      if (rec && rec.profit) {
        inputProfit.value = (rec.profit / 100).toFixed(2);
      }
      modalProfit.classList.remove('hidden');
    });
  }

  if (btnSyncProfit) btnSyncProfit.onclick = openDirectProfitModal;

  if (btnCancelProfit) {
    btnCancelProfit.onclick = () => modalProfit.classList.add('hidden');
  }

  if (formProfit) {
    formProfit.onsubmit = async (e) => {
      e.preventDefault();
      const newProfitCzk = parseFloat(inputProfit.value);
      if (isNaN(newProfitCzk) || newProfitCzk < 0) return;

      let itownRecord = await dbGet('settings', 'itown_data');
      if (!itownRecord) {
        itownRecord = { key: 'itown_data', invested: 718116, profit: 344302 };
      }

      itownRecord.profit = Money.toCents(newProfitCzk);
      await dbSet('settings', itownRecord);

      modalProfit.classList.add('hidden');
      alert(`Celkový zisk byl aktualizován na ${newProfitCzk.toLocaleString('cs-CZ')} Kč. Hodnota portfolia a graf se samy přepočítaly.`);
      
      await renderInvestments();
    };
  }

  const modalSell = document.getElementById('modal-itown-sell');
  const formSell = document.getElementById('form-itown-sell');
  const btnCancelSell = document.getElementById('btn-cancel-itown-sell');

  if (btnSell) {
    btnSell.onclick = () => {
      formSell.reset();
      modalSell.classList.remove('hidden');
    };
  }

  if (btnCancelSell) {
    btnCancelSell.onclick = () => modalSell.classList.add('hidden');
  }

  if (formSell) {
    formSell.onsubmit = async (e) => {
      e.preventDefault();
      const sellAmountCzk = parseFloat(document.getElementById('itown-sell-amount').value);
      if (isNaN(sellAmountCzk) || sellAmountCzk <= 0) return;

      let itownRecord = await dbGet('settings', 'itown_data');
      if (!itownRecord) return;

      const sellCents = Money.toCents(sellAmountCzk);
      itownRecord.invested = Math.max(0, itownRecord.invested - sellCents);
      await dbSet('settings', itownRecord);

      const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
      await dbAdd('entries', {
        monthYear: monthKey,
        title: `Investown prodej/výběr (+${sellAmountCzk} Kč)`,
        amount: sellCents,
        category: 'Investice',
        day: new Date().getDate(),
        wallet: 'bank',
        isIncome: true,
        paid: true
      });

      modalSell.classList.add('hidden');
      alert(`Prodej v hodnotě ${sellAmountCzk} Kč proběhl. Peníze byly připsány na bankovní účet.`);
      await loadMonthData();
      await renderInvestments();
    };
  }
}

async function renderGoldBars(goldBars) {
  const container = document.getElementById('gold-bars-list');
  if (!container) return;
  container.innerHTML = '';

  let totalGrams = 0;
  let totalBought = 0;
  let totalCurrent = 0;

  goldBars.forEach(gb => {
    totalGrams += gb.weight;
    totalBought += gb.bought;
    totalCurrent += gb.current;

    const row = document.createElement('div');
    row.className = 'gold-bar-item';
    row.innerHTML = `
      <div class="gb-left">
        <span class="gb-title">${gb.name}</span>
        <span class="gb-weight">${gb.weight} g • nákup: ${Money.toCzkInt(gb.bought)}</span>
      </div>
      <div class="gb-right">
        <span class="gb-val text-yellow">${Money.toCzkInt(gb.current)}</span>
        <button class="btn-del-reading" data-id="${gb.id}">🗑️</button>
      </div>
    `;

    row.querySelector('.btn-del-reading').onclick = async () => {
      await dbDelete('gold_bars', gb.id);
      await renderInvestments();
    };

    container.appendChild(row);
  });

  const dispGrams = document.getElementById('disp-gold-grams');
  const dispBought = document.getElementById('disp-gold-bought');
  const dispCurrent = document.getElementById('disp-gold-current');

  if (dispGrams) dispGrams.textContent = `${totalGrams.toFixed(1)} g`;
  if (dispBought) dispBought.textContent = Money.toCzkInt(totalBought);
  if (dispCurrent) dispCurrent.textContent = Money.toCzkInt(totalCurrent);
}

function setupGoldModal() {
  const modal = document.getElementById('modal-gold');
  const btnOpen = document.getElementById('btn-add-gold');
  const btnCancel = document.getElementById('btn-cancel-gold');
  const form = document.getElementById('form-gold');

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

    const name = document.getElementById('gold-name').value.trim();
    const weight = parseFloat(document.getElementById('gold-weight').value);
    const boughtCzk = parseFloat(document.getElementById('gold-bought').value);
    const currentCzk = parseFloat(document.getElementById('gold-current').value);

    if (!name || isNaN(weight) || isNaN(boughtCzk) || isNaN(currentCzk)) return;

    await dbAdd('gold_bars', {
      name,
      weight,
      bought: Money.toCents(boughtCzk),
      current: Money.toCents(currentCzk)
    });

    modal.classList.add('hidden');
    await renderInvestments();
  };
}

async function drawInvestmentTrendChart(investedCents, currentCents) {
  const canvas = document.getElementById('invest-trend-chart');
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

  const profit = currentCents - investedCents;
  const badge = document.getElementById('invest-growth-badge');
  if (badge) {
    badge.textContent = `${profit >= 0 ? '+' : ''}${Money.toCzkInt(profit)} (${investedCents > 0 ? ((profit / investedCents) * 100).toFixed(1) : 0} %)`;
    badge.style.color = profit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  }

  const months = ['Čvn', 'Čvc', 'Srp', 'Zář', 'Říj', 'Lis'];
  const curVal = currentCents / 100;
  const invVal = investedCents / 100;

  const points = months.map((m, idx) => {
    const factor = (idx + 1) / months.length;
    const invPoint = Math.round(invVal - (months.length - 1 - idx) * 500);
    return {
      label: m,
      inv: Math.max(1000, invPoint),
      cur: Math.round(curVal * factor * (1 + (profit > 0 ? 0.04 * factor : 0)))
    };
  });

  const maxVal = Math.max(curVal, invVal) * 1.25 || 10000;
  const paddingX = 35;
  const paddingY = 25;
  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;

  ctx.strokeStyle = '#94a3b8';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, idx) => {
    const x = paddingX + (idx / (points.length - 1)) * chartW;
    const y = height - paddingY - (p.inv / maxVal) * chartH;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  const coords = [];
  points.forEach((p, idx) => {
    const x = paddingX + (idx / (points.length - 1)) * chartW;
    const y = height - paddingY - (p.cur / maxVal) * chartH;
    coords.push({ x, y, p });
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

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(c.p.label, c.x, height - 8);
  });
}

async function drawWebEarningsTrendChart(allEntries) {
  const canvas = document.getElementById('web-trend-chart');
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
    const webEntries = allEntries.filter(e => e.monthYear === m.key && e.isIncome && e.category === 'Web & Projekty');
    const total = webEntries.reduce((acc, e) => acc + e.amount, 0);
    return {
      label: m.label,
      val: total > 0 ? (total / 100) : 0
    };
  });

  const sum = points.reduce((acc, p) => acc + p.val, 0);
  const avg = Math.round(sum / points.length);

  const webLegend = document.getElementById('web-avg-legend');
  if (webLegend) webLegend.textContent = `⚪ Průměr (${avg.toLocaleString('cs-CZ')} Kč)`;

  const maxVal = Math.max(...points.map(p => p.val), 5000) * 1.25;
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

  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 3;
  ctx.beginPath();

  const coords = [];
  points.forEach((pt, idx) => {
    const x = paddingX + (idx / (points.length - 1)) * chartW;
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

    ctx.fillStyle = '#ffffff';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    if (c.pt.val > 0) ctx.fillText(`${c.pt.val} Kč`, c.x, c.y - 8);

    ctx.fillStyle = '#94a3b8';
    ctx.fillText(c.pt.label, c.x, height - 8);
  });
}

function drawDonutChart(canvasId, percent) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const dpr = window.devicePixelRatio || 1;
  // FIX: Pevná velikost přímo pro 100x100 pixelů odpovídající kontejneru
  canvas.width = 100 * dpr;
  canvas.height = 100 * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, 100, 100);

  const cx = 50;
  const cy = 50;
  const r = 38;
  const lineWidth = 10;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  if (percent > 0) {
    const end = (percent / 100) * (Math.PI * 2) - (Math.PI / 2);
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, end);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

function setupInvestmentModal() {
  const modal = document.getElementById('modal-investment');
  const btnOpen = document.getElementById('btn-add-investment');
  const btnCancel = document.getElementById('btn-cancel-investment');
  const form = document.getElementById('form-investment');

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
  };
}

async function renderEnergy() {
  const kwhRecord = await dbGet('settings', 'kwh_price');
  const kwhPriceCents = kwhRecord ? kwhRecord.value : 820;
  const kwhPriceCzk = kwhPriceCents / 100;

  document.getElementById('disp-kwh-price').textContent = `${(kwhPriceCzk).toFixed(2).replace('.', ',')} Kč / kWh`;

  const templates = await dbGetAll('templates');
  const cez = templates.find(t => t.title && (t.title.toLowerCase().includes('čez') || t.title.toLowerCase().includes('cez')));
  const cezDepositCents = cez ? cez.amount : 300000;
  document.getElementById('disp-cez-deposit').textContent = Money.toCzkInt(cezDepositCents);

  const maxKwh = ((cezDepositCents / 100) / kwhPriceCzk).toFixed(1);
  document.getElementById('disp-max-allowed-kwh').textContent = `${maxKwh} kWh / měsíc`;

  await evaluateLastMeterReading(cezDepositCents, kwhPriceCents);
  await drawEnergyConsumptionChart();
  await renderMeterReadingsHistory(cezDepositCents, kwhPriceCents);

  const appliances = await dbGetAll('energy');
  const container = document.getElementById('appliances-list');
  if (!container) return;
  container.innerHTML = '';

  appliances.forEach(app => {
    const kwhPerHour = app.power / 1000;
    const kwhPerDay = kwhPerHour * app.hours;
    const kwhPerMonth = kwhPerDay * 30;

    const costHourCents = Math.round(kwhPerHour * kwhPriceCents);
    const costDayCents = Math.round(kwhPerDay * kwhPriceCents);
    const costMonthCents = Math.round(kwhPerMonth * kwhPriceCents);

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

    card.querySelector('.btn-delete-appliance').onclick = async () => {
      await dbDelete('energy', app.id);
      await renderEnergy();
    };

    container.appendChild(card);
  });
}

async function evaluateLastMeterReading(cezDepositCents, kwhPriceCents) {
  const readings = await dbGetAll('meter_readings');
  readings.sort((a, b) => new Date(a.date) - new Date(b.date));

  const box = document.getElementById('disp-meter-eval-box');
  const badge = document.getElementById('energy-trend-badge');

  if (!box || !badge) return;

  if (readings.length < 2) {
    box.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted);">Pro měsíční vyhodnocení zadej alespoň 2 odečty elektroměru.</span>';
    badge.textContent = 'Čekám na data';
    badge.style.color = 'var(--text-muted)';
    return;
  }

  const latest = readings[readings.length - 1];
  const previous = readings[readings.length - 2];

  const daysDiff = (new Date(latest.date) - new Date(previous.date)) / (1000 * 60 * 60 * 24);
  const kwhConsumed = Math.max(0, latest.value - previous.value);

  const monthlyNormalizedKwh = daysDiff > 0 ? (kwhConsumed / daysDiff) * 30 : kwhConsumed;
  const estimatedCostCents = Math.round(monthlyNormalizedKwh * kwhPriceCents);
  const diffCents = cezDepositCents - estimatedCostCents;

  const isSurplus = diffCents >= 0;
  const sign = isSurplus ? '+' : '';
  const currentPriceFormatted = (kwhPriceCents / 100).toFixed(2).replace('.', ',');

  let trendText = 'Běžný trend';
  let trendColor = 'var(--accent-blue)';

  if (readings.length >= 3) {
    const older = readings[readings.length - 3];
    const prevDays = (new Date(previous.date) - new Date(older.date)) / (1000 * 60 * 60 * 24);
    const prevKwh = Math.max(0, previous.value - older.value);
    const prevNormalized = prevDays > 0 ? (prevKwh / prevDays) * 30 : prevKwh;

    const delta = monthlyNormalizedKwh - prevNormalized;
    if (delta > 30) {
      trendText = `📈 Rostoucí tendence (+${delta.toFixed(0)} kWh)`;
      trendColor = 'var(--accent-red)';
    } else if (delta < -30) {
      trendText = `📉 Klesající tendence (${delta.toFixed(0)} kWh)`;
      trendColor = 'var(--accent-green)';
    } else {
      trendText = `➡️ Stabilní odběr (rozdíl jen ${delta.toFixed(0)} kWh)`;
      trendColor = 'var(--accent-blue)';
    }
  }

  badge.textContent = isSurplus ? 'Přeplatek očekáván' : 'Nedoplatek!';
  badge.style.color = isSurplus ? 'var(--accent-green)' : 'var(--accent-red)';

  box.innerHTML = `
    <div class="eval-grid">
      <div class="eval-item">
        <span class="e-lbl">Spotřeba za měsíc</span>
        <span class="e-val text-blue">${monthlyNormalizedKwh.toFixed(1)} kWh</span>
      </div>
      <div class="eval-item">
        <span class="e-lbl">Reálná cena (${currentPriceFormatted} Kč)</span>
        <span class="e-val">${Money.toCzkInt(estimatedCostCents)}</span>
      </div>
      <div class="eval-item">
        <span class="e-lbl">Výsledek vs. ${Money.toCzkInt(cezDepositCents)}</span>
        <span class="e-val" style="color: ${isSurplus ? 'var(--accent-green)' : 'var(--accent-red)'}">
          ${sign}${Money.toCzkInt(diffCents)}
        </span>
      </div>
    </div>
    <div class="eval-status-bar" style="margin-top: 8px;">
      <span class="eval-trend-text" style="color: ${trendColor}">${trendText}</span>
      <span style="font-size:0.75rem; color:var(--text-muted);">${previous.date} → ${latest.date} (${Math.round(daysDiff)} dní)</span>
    </div>
  `;
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

  const recentReadings = readings.slice(-8);
  const points = [];
  let totalDailySum = 0;

  for (let i = 1; i < recentReadings.length; i++) {
    const prev = recentReadings[i - 1];
    const curr = recentReadings[i];
    const days = (new Date(curr.date) - new Date(prev.date)) / (1000 * 60 * 60 * 24);

    if (days > 0) {
      const kwhDiff = curr.value - prev.value;
      const kwhPerDay = Math.max(0, kwhDiff / days);

      let dateLabel = '';
      if (curr.date) {
        const parts = curr.date.split('-');
        dateLabel = parts.length === 3 ? `${parseInt(parts[2], 10)}.${parseInt(parts[1], 10)}.` : curr.date;
      }

      points.push({
        label: dateLabel,
        val: kwhPerDay
      });
      totalDailySum += kwhPerDay;
    }
  }

  if (points.length === 0) return;

  const avg = totalDailySum / points.length;
  const avgLabel = document.getElementById('chart-avg-label');
  if (avgLabel) avgLabel.textContent = `⚪ Průměr: ${avg.toFixed(1)} kWh/den`;

  const maxVal = Math.max(...points.map(p => p.val)) * 1.3 || 10;
  const paddingX = 35;
  const paddingY = 30;
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
    ctx.font = '9px sans-serif';
    ctx.fillText(c.pt.label, c.x, height - 8);
  });
}

function setupEnergySimulator() {
  const kwhInput = document.getElementById('calc-kwh-input');
  const kwhRange = document.getElementById('calc-kwh-range');
  const rateLabel = document.getElementById('calc-unit-rate');
  const costDisp = document.getElementById('calc-result-cost');
  const balanceDisp = document.getElementById('calc-result-balance');

  if (!kwhInput || !kwhRange) return;

  async function updateSimulation() {
    const kwhRecord = await dbGet('settings', 'kwh_price');
    const kwhPriceCents = kwhRecord ? kwhRecord.value : 820;
    const kwhPriceCzk = kwhPriceCents / 100;
    
    rateLabel.textContent = `${kwhPriceCzk.toFixed(2).replace('.', ',')} Kč`;

    const kwh = parseFloat(kwhInput.value) || 0;
    const totalCostCents = Math.round(kwh * kwhPriceCents);
    costDisp.textContent = Money.toCzkInt(totalCostCents);

    const templates = await dbGetAll('templates');
    const cez = templates.find(t => t.title && (t.title.toLowerCase().includes('čez') || t.title.toLowerCase().includes('cez')));
    const cezDepositCents = cez ? cez.amount : 300000;

    const diffCents = cezDepositCents - totalCostCents;
    if (diffCents >= 0) {
      balanceDisp.textContent = `+${Money.toCzkInt(diffCents)} (přeplatek)`;
      balanceDisp.style.color = 'var(--accent-green)';
    } else {
      balanceDisp.textContent = `${Money.toCzkInt(diffCents)} (nedoplatek)`;
      balanceDisp.style.color = 'var(--accent-red)';
    }
  }

  kwhInput.oninput = () => {
    kwhRange.value = kwhInput.value;
    updateSimulation();
  };

  kwhRange.oninput = () => {
    kwhInput.value = kwhRange.value;
    updateSimulation();
  };

  updateSimulation();
}

async function renderMeterReadingsHistory(cezDepositCents, kwhPriceCents) {
  const container = document.getElementById('meter-readings-history');
  if (!container) return;
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

    let diffInfo = '';
    if (idx < readings.length - 1) {
      const prev = readings[idx + 1];
      const diffKwh = (r.value - prev.value);
      const days = (new Date(r.date) - new Date(prev.date)) / (1000 * 60 * 60 * 24);
      const normMonthlyKwh = days > 0 ? (diffKwh / days) * 30 : diffKwh;
      const monthCostCents = Math.round(normMonthlyKwh * kwhPriceCents);
      const balanceCents = cezDepositCents - monthCostCents;
      const isOk = balanceCents >= 0;

      diffInfo = `
        <span class="m-diff-tag ${isOk ? 'surplus' : 'deficit'}">
          ${isOk ? '+' : ''}${Money.toCzkInt(balanceCents)} (${diffKwh.toFixed(1)} kWh)
        </span>
      `;
    }

    row.innerHTML = `
      <div class="m-left">
        <span class="m-date">${r.date}</span>
        <span class="m-note">${r.note || 'Měsíční odečet'}</span>
      </div>
      <div class="m-right">
        ${diffInfo}
        <span class="m-kwh">${r.value.toLocaleString('cs-CZ')} kWh</span>
        <button class="btn-del-reading" data-id="${r.id}" title="Smazat">🗑️</button>
      </div>
    `;

    row.querySelector('.btn-del-reading').onclick = async () => {
      await dbDelete('meter_readings', r.id);
      await renderEnergy();
    };

    container.appendChild(row);
  });
}

function setupMeterReadingModal() {
  const modal = document.getElementById('modal-meter');
  const btnOpen = document.getElementById('btn-add-meter-reading');
  const btnCancel = document.getElementById('btn-cancel-meter');
  const form = document.getElementById('form-meter');

  if (btnOpen) {
    btnOpen.onclick = () => {
      form.reset();
      document.getElementById('meter-date').value = new Date().toISOString().slice(0, 10);
      modal.classList.remove('hidden');
    };
  }

  if (btnCancel) {
    btnCancel.onclick = () => modal.classList.add('hidden');
  }

  form.onsubmit = async (e) => {
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
  };
}

function setupApplianceModal() {
  const modal = document.getElementById('modal-appliance');
  const btnOpen = document.getElementById('btn-add-appliance');
  const btnCancel = document.getElementById('btn-cancel-appliance');
  const form = document.getElementById('form-appliance');

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
  };
}

async function renderSettings() {
  const bankCapRecord = await dbGet('settings', 'bank_capital');
  const cashCapRecord = await dbGet('settings', 'cash_capital');
  const initCapRecord = await dbGet('settings', 'initial_capital');
  const paydayRecord = await dbGet('settings', 'payday');
  const kwhRecord = await dbGet('settings', 'kwh_price');

  const bankCapEl = document.getElementById('set-bank-capital');
  const cashCapEl = document.getElementById('set-cash-capital');
  const paydayEl = document.getElementById('set-payday');
  const kwhEl = document.getElementById('set-kwh-price');

  if (bankCapEl) bankCapEl.value = bankCapRecord ? bankCapRecord.value / 100 : (initCapRecord ? initCapRecord.value / 100 : 46000);
  if (cashCapEl) cashCapEl.value = cashCapRecord ? cashCapRecord.value / 100 : 5000;
  if (paydayEl) paydayEl.value = paydayRecord ? paydayRecord.value : 10;
  if (kwhEl) kwhEl.value = kwhRecord ? kwhRecord.value / 100 : 8.2;
}

function setupSettingsAndBackup() {
  const btnSaveSet = document.getElementById('btn-save-settings');
  const btnExport = document.getElementById('btn-export-json');
  const btnCopy = document.getElementById('btn-copy-json');
  const btnTriggerRestore = document.getElementById('btn-trigger-restore');
  const fileRestoreInput = document.getElementById('restore-file-input');
  const btnTriggerCsv = document.getElementById('btn-trigger-csv');
  const csvFileInput = document.getElementById('csv-file-input');
  const btnInstall = document.getElementById('btn-install-pwa');

  if (btnSaveSet) {
    btnSaveSet.onclick = async () => {
      const bankCap = parseFloat(document.getElementById('set-bank-capital').value);
      const cashCap = parseFloat(document.getElementById('set-cash-capital').value);
      const payday = parseInt(document.getElementById('set-payday').value, 10);
      const kwh = parseFloat(document.getElementById('set-kwh-price').value);

      if (!isNaN(bankCap)) await dbSet('settings', { key: 'bank_capital', value: Money.toCents(bankCap) });
      if (!isNaN(cashCap)) await dbSet('settings', { key: 'cash_capital', value: Money.toCents(cashCap) });
      if (!isNaN(payday)) await dbSet('settings', { key: 'payday', value: payday });
      if (!isNaN(kwh)) await dbSet('settings', { key: 'kwh_price', value: Money.toCents(kwh) });

      alert('Parametry uloženy!');
      await loadMonthData();
    };
  }

  if (btnExport) {
    btnExport.onclick = async () => {
      const backup = await createFullBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dispecink-zaloha-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };
  }

  if (btnCopy) {
    btnCopy.onclick = async () => {
      const backup = await createFullBackup();
      await navigator.clipboard.writeText(JSON.stringify(backup, null, 2));
      alert('Záloha zkopírována do schránky!');
    };
  }

  if (btnTriggerRestore && fileRestoreInput) {
    btnTriggerRestore.onclick = () => fileRestoreInput.click();

    fileRestoreInput.onchange = async (e) => {
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
    };
  }

  if (btnTriggerCsv && csvFileInput) {
    btnTriggerCsv.onclick = () => csvFileInput.click();

    csvFileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        const text = event.target.result;
        const count = await parseAndImportAirBankCsv(text);
        const status = document.getElementById('csv-import-status');
        status.textContent = `Zpracováno a automaticky roztříděno ${count} plateb z Air Bank!`;
        status.style.color = 'var(--accent-green)';
        await loadMonthData();
      };
      reader.readAsText(file, 'windows-1250');
    };
  }

  if (btnInstall) {
    btnInstall.onclick = async () => {
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
    };
  }
}

function detectCategoryFromAirBank(desc, isIncome) {
  const t = desc.toLowerCase();

  if (isIncome) {
    if (t.includes('web') || t.includes('affil') || t.includes('reklama') || t.includes('kolobeznik')) return 'Web & Projekty';
    if (t.includes('investown') || t.includes('portu') || t.includes('rentier') || t.includes('výnos') || t.includes('dividenda')) return 'Investice';
    if (t.includes('mzda') || t.includes('plat') || t.includes('výplata') || t.includes('datart')) return 'Výplata';
    return 'Příjmy';
  }

  if (t.includes('čez') || t.includes('cez') || t.includes('innogy') || t.includes('e.on')) return 'Energie';
  if (t.includes('provident') || t.includes('avafin') || t.includes('crediton') || t.includes('splátka')) return 'Závazky';
  if (t.includes('t-mobile') || t.includes('vodafone') || t.includes('o2')) return 'Komunikace';
  if (t.includes('sipo') || t.includes('nájem') || t.includes('odpad') || t.includes('nemovitost')) return 'Bydlení';
  if (t.includes('spotify') || t.includes('openai') || t.includes('chatgpt') || t.includes('google') || t.includes('česká televize')) return 'Služby';
  if (t.includes('investown') || t.includes('penzij') || t.includes('portu') || t.includes('zlato') || t.includes('slitek')) return 'Investice';

  if (t.includes('albert') || t.includes('lidl') || t.includes('kaufland') || t.includes('billa') || t.includes('penny') || t.includes('tesco') || t.includes('pekař') || t.includes('potraviny')) {
    return 'Jídlo & Potraviny';
  }

  if (t.includes('ručení') || t.includes('benzina') || t.includes('orlen') || t.includes('omv') || t.includes('shell') || t.includes('mol') || t.includes('eurooil') || t.includes('čerpací') || t.includes('nafta') || t.includes('benzín')) {
    return 'Doprava & Benzín';
  }

  if (t.includes('dm drogerie') || t.includes('rossmann') || t.includes('teta') || t.includes('drogerie') || t.includes('action')) {
    return 'Drogerie & Domácnost';
  }

  if (t.includes('restaurace') || t.includes('hospoda') || t.includes('bistro') || t.includes('kebab') || t.includes('pivnice') || t.includes('kavárna') || t.includes('mcdonald') || t.includes('kfc')) {
    return 'Restaurace & Občerstvení';
  }

  if (t.includes('datart') || t.includes('alza') || t.includes('czc') || t.includes('obi') || t.includes('hornbach') || t.includes('bauhaus') || t.includes('železářství')) {
    return 'Elektro & Nářadí';
  }

  if (t.includes('zoo') || t.includes('super zoo') || t.includes('pet center') || t.includes('zvěrokruh') || t.includes('krmiv')) {
    return 'Zvířata';
  }

  if (t.includes('lékárna') || t.includes('dr.max') || t.includes('benu') || t.includes('optik') || t.includes('terapie')) {
    return 'Zdraví & Lékárna';
  }

  return 'Ostatní útrata';
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

    const category = detectCategoryFromAirBank(title, isIncome);

    await dbAdd('entries', {
      monthYear: monthKey,
      title: title.slice(0, 50),
      amount: absAmountCents,
      category,
      day,
      wallet: 'bank',
      isIncome,
      paid: true
    });

    importedCount++;
  }

  return importedCount;
}
