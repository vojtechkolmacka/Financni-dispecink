// Rozšíření správy plateb a šablon
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

    // Kliknutí na položku: označit jako zaplaceno / nezaplaceno
    row.querySelector('.entry-left').onclick = async () => {
      item.paid = !item.paid;
      await dbSet('entries', item);
      await loadMonthData();
    };

    // Kliknutí na koš: smazat z tohoto měsíce
    row.querySelector('.btn-del-entry').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Odebrat položku „${item.title}“ z tohoto měsíce?`)) return;
      await dbDelete('entries', item.id);
      await loadMonthData();
    };

    list.appendChild(row);
  });

  document.getElementById('payments-total-exp').textContent = Money.toCzkInt(totalExpenses);
  const percent = totalExpenses > 0 ? Math.round((paidExpenses / totalExpenses) * 100) : 0;
  document.getElementById('payments-progress-fill').style.width = `${percent}%`;
}

// SPRÁVA TRVALÝCH ŠABLON PLATEB (Pohled 2)
async function renderTemplatesList() {
  const container = document.getElementById('templates-list');
  if (!container) return;
  container.innerHTML = '';

  const templates = await dbGetAll('templates');

  templates.forEach(t => {
    const card = document.createElement('div');
    card.className = `template-card ${t.active ? '' : 'inactive'}`;

    let freqLabel = 'Měsíčně';
    if (t.frequency === 'semi-annual') freqLabel = `Pololetně (${t.dueMonths.join(', ')}. měsíc)`;
    else if (t.frequency === 'annual') freqLabel = `Ročně (${t.dueMonths.join(', ')}. měsíc)`;

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

    // Zapnout / vypnout stálou platbu
    card.querySelector('.btn-toggle-tpl').onclick = async () => {
      t.active = !t.active;
      await dbSet('templates', t);
      await renderTemplatesList();
    };

    // Trvale smazat stálou platbu
    card.querySelector('.btn-del-tpl').onclick = async () => {
      if (!confirm(`Trvale smazat šablonu „${t.title}“?`)) return;
      await dbDelete('templates', t.id);
      await renderTemplatesList();
    };

    container.appendChild(card);
  });
}

// Přepínač zobrazení v záložce Platby
function setupPaymentsViewToggle() {
  const btnMonth = document.getElementById('btn-toggle-month-entries');
  const btnTpl = document.getElementById('btn-toggle-templates');
  const viewMonth = document.getElementById('view-month-entries');
  const viewTpl = document.getElementById('view-templates');

  if (btnMonth && btnTpl) {
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

  // Tlačítko pro vytvoření nové stálé šablony
  const btnAddTpl = document.getElementById('btn-add-template');
  if (btnAddTpl) {
    btnAddTpl.onclick = () => {
      const modal = document.getElementById('modal-entry');
      const form = document.getElementById('form-entry');
      form.reset();
      form.querySelector('input[name="entryType"][value="expense"]').checked = true;
      document.getElementById('entry-recurring').checked = true;
      document.getElementById('wrap-recurring-frequency').classList.remove('hidden');
      document.getElementById('modal-entry-title').textContent = 'Nová trvalá platba (Šablona)';
      modal.classList.remove('hidden');
    };
  }
}
