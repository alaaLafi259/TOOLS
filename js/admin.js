// ============================================
// منطق لوحة المشرف العام
// ============================================

let currentUser = null;
let categoriesCache = [];
let sitesCache = [];
let siteStockCache = {};   // siteId -> [{categoryCode, qty}]
let siteTotalsCache = {};  // siteId -> total qty across all categories

requireRole('admin', async (profile) => {
  currentUser = profile;
  await refreshAll();
});

// ---------- التبويبات ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

async function refreshAll() {
  categoriesCache = await DB.getAllCategories();
  sitesCache = await DB.getAllSites();

  siteStockCache = {};
  siteTotalsCache = {};
  for (const site of sitesCache) {
    const stock = await DB.getSiteStock(site.id);
    siteStockCache[site.id] = stock;
    siteTotalsCache[site.id] = stock.reduce((s, r) => s + (r.total || 0), 0);
  }

  renderStats();
  renderCategoriesTable();
  renderCategorySelects();
  renderSitesList();
  renderSiteSelects();
  await renderLog();
}

function renderStats() {
  const warehouseTotal = categoriesCache.reduce((s, c) => s + (c.totalQtyWarehouse || 0), 0);
  const warehouseValue = categoriesCache.reduce((s, c) => s + (c.totalQtyWarehouse || 0) * (c.avgCost || 0), 0);
  const sitesTotal = sitesCache.reduce((s, site) => s + (siteTotalsCache[site.id] || 0), 0);
  const grandTotal = warehouseTotal + sitesTotal;
  document.getElementById('statsRow').innerHTML = `
    <div class="stat-box"><div class="value">${grandTotal}</div><div class="label">إجمالي القطع في كل مكان (مخزن + مواقع)</div></div>
    <div class="stat-box"><div class="value">${warehouseTotal}</div><div class="label">قطع المخزن المركزي</div></div>
    <div class="stat-box"><div class="value">${sitesTotal}</div><div class="label">قطع موزعة على المواقع</div></div>
    <div class="stat-box"><div class="value">${categoriesCache.length}</div><div class="label">عدد الأصناف</div></div>
    <div class="stat-box"><div class="value">${sitesCache.length}</div><div class="label">عدد المواقع</div></div>
    <div class="stat-box"><div class="value">${warehouseValue.toLocaleString()}</div><div class="label">قيمة المخزن المركزي</div></div>
  `;
}

function renderCategoriesTable() {
  document.getElementById('categoriesTable').innerHTML = categoriesCache.map(c => {
    const ws = c.warehouseStock || { working: 0, damaged: 0, maintenance: 0, outOfService: 0 };
    return `<tr id="catRow-${c.code}">
      <td>${c.code}</td>
      <td>
        <span id="catNameDisplay-${c.code}">${c.name}</span>
        <input id="catNameEdit-${c.code}" value="${c.name}" style="display:none; margin:0;">
      </td>
      <td>${ws.working}</td><td>${ws.damaged}</td><td>${ws.maintenance}</td><td>${ws.outOfService}</td>
      <td><strong>${c.totalQtyWarehouse || 0}</strong></td>
      <td>${(c.avgCost || 0).toFixed(2)}</td>
      <td>
        <button class="action-btn secondary" id="catEditBtn-${c.code}" onclick="toggleEditCategory('${c.code}')">تعديل</button>
        <button class="action-btn" id="catSaveBtn-${c.code}" style="display:none;" onclick="saveCategory('${c.code}')">حفظ</button>
        <button class="action-btn danger" onclick="handleDeleteCategory('${c.code}')">حذف</button>
      </td>
    </tr>`;
  }).join('');
}

function toggleEditCategory(code) {
  document.getElementById(`catNameDisplay-${code}`).style.display = 'none';
  document.getElementById(`catNameEdit-${code}`).style.display = 'block';
  document.getElementById(`catEditBtn-${code}`).style.display = 'none';
  document.getElementById(`catSaveBtn-${code}`).style.display = 'inline-block';
}

async function saveCategory(code) {
  const newName = document.getElementById(`catNameEdit-${code}`).value.trim();
  if (!newName) return alert('الاسم لا يمكن أن يكون فارغًا');
  try {
    await DB.updateCategory(code, { name: newName, unit: categoriesCache.find(c => c.code === code)?.unit || 'قطعة' });
    await refreshAll();
  } catch (e) { alert(e.message); }
}

async function handleDeleteCategory(code) {
  const cat = categoriesCache.find(c => c.code === code);
  const warehouseTotal = cat ? cat.totalQtyWarehouse || 0 : 0;
  let sitesTotal = 0;
  sitesCache.forEach(site => {
    (siteStockCache[site.id] || []).forEach(s => { if (s.categoryCode === code) sitesTotal += s.total || 0; });
  });
  if (warehouseTotal > 0 || sitesTotal > 0) {
    alert(`لا يمكن حذف هذا الصنف لأن له رصيد حاليًا (${warehouseTotal + sitesTotal} قطعة في المخزن/المواقع). صفّر الرصيد أولاً أو استخدم زر "تعديل" لتصحيح الاسم فقط.`);
    return;
  }
  if (!confirm(`تأكيد حذف الصنف "${cat ? cat.name : code}"؟ هذا الإجراء نهائي.`)) return;
  try {
    await DB.deleteCategory(code);
    await refreshAll();
  } catch (e) { alert(e.message); }
}

function statusOptions() {
  return DB.STATUS_KEYS.map(k => `<option value="${k}">${DB.STATUS_LABELS[k]}</option>`).join('');
}

function categoryOptions() {
  return categoriesCache.map(c => `<option value="${c.code}">${c.code} - ${c.name}</option>`).join('');
}

function renderCategorySelects() {
  ['purchaseCategory', 'issueCategory', 'returnCategory', 'transferCategory', 'writeoffCategory', 'statusChangeCategory'].forEach(id => {
    document.getElementById(id).innerHTML = categoryOptions();
  });
  ['purchaseStatus', 'issueStatus', 'returnStatus', 'transferStatus', 'writeoffStatus', 'statusChangeFrom', 'statusChangeTo'].forEach(id => {
    document.getElementById(id).innerHTML = statusOptions();
  });
  document.getElementById('writeoffStatus').value = 'damaged';
  document.getElementById('statusChangeTo').value = 'damaged';
}

function siteOptions(includeWarehouse) {
  let opts = sitesCache.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  if (includeWarehouse) opts = `<option value="warehouse">المخزن المركزي</option>` + opts;
  return opts;
}

function renderSiteSelects() {
  document.getElementById('issueSite').innerHTML = siteOptions(false);
  document.getElementById('returnSite').innerHTML = siteOptions(false);
  document.getElementById('transferFrom').innerHTML = siteOptions(false);
  document.getElementById('transferTo').innerHTML = siteOptions(false);
  document.getElementById('writeoffSite').innerHTML = `<option value="warehouse">المخزن المركزي</option>` + siteOptions(false);
  document.getElementById('statusChangeLocation').innerHTML = `<option value="warehouse">المخزن المركزي</option>` + siteOptions(false);
  document.getElementById('purchaseLocation').innerHTML = `<option value="warehouse">المخزن المركزي</option>` + siteOptions(false);
}

function renderSitesList() {
  let html = '';
  for (const site of sitesCache) {
    const stock = siteStockCache[site.id] || [];
    const totalQty = siteTotalsCache[site.id] || 0;
    const value = stock.reduce((sum, s) => {
      const cat = categoriesCache.find(c => c.code === s.categoryCode);
      return sum + (s.total || 0) * (cat ? cat.avgCost || 0 : 0);
    }, 0);
    html += `<div class="card" style="background:#fafbfc;">
      <h2>${site.name} — المشرف: ${site.supervisorName || 'غير محدد'}</h2>
      <div class="stat-row">
        <div class="stat-box"><div class="value">${totalQty}</div><div class="label">إجمالي القطع بالموقع</div></div>
        <div class="stat-box"><div class="value">${value.toLocaleString()}</div><div class="label">قيمة عدة الموقع</div></div>
      </div>
      <table><thead><tr><th>الصنف</th><th>تعمل</th><th>تالفة</th><th>تحت الصيانة</th><th>معطلة</th><th>الإجمالي</th></tr></thead><tbody>
        ${stock.filter(s => s.total > 0).map(s => {
          const cat = categoriesCache.find(c => c.code === s.categoryCode);
          return `<tr><td>${cat ? cat.name : s.categoryCode}</td><td>${s.working}</td><td>${s.damaged}</td><td>${s.maintenance}</td><td>${s.outOfService}</td><td><strong>${s.total}</strong></td></tr>`;
        }).join('') || '<tr><td colspan="6">لا يوجد رصيد</td></tr>'}
      </tbody></table>
    </div>`;
  }
  document.getElementById('sitesList').innerHTML = html || '<p>لا توجد مواقع مسجلة</p>';
}

async function renderLog() {
  const txs = await DB.getAllTransactions(100);
  const typeLabels = { purchase: 'شراء', opening: 'رصيد افتتاحي', issue: 'صرف', return: 'إرجاع', transfer: 'تحويل', writeoff: 'إتلاف/فقد' };
  const siteName = (id) => id === 'warehouse' ? 'المخزن المركزي' : (sitesCache.find(s => s.id === id)?.name || id || '-');
  document.getElementById('logTable').innerHTML = txs.map(tx => `
    <tr>
      <td>${tx.date ? new Date(tx.date.seconds * 1000).toLocaleString('ar-EG') : '-'}</td>
      <td><span class="badge ${tx.type}">${typeLabels[tx.type] || tx.type}</span></td>
      <td>${tx.categoryCode}</td>
      <td>${tx.qty}</td>
      <td>${siteName(tx.fromSite)}</td>
      <td>${siteName(tx.toSite)}</td>
      <td>${(tx.totalCost || 0).toLocaleString()}</td>
    </tr>
  `).join('');
}

// ---------- إجراءات الأصناف ----------
async function handleAddCategory() {
  const code = document.getElementById('catCode').value.trim();
  const name = document.getElementById('catName').value.trim();
  const unit = document.getElementById('catUnit').value.trim();
  const msg = document.getElementById('catMsg');
  if (!code || !name) { msg.innerHTML = '<div class="error-msg">أدخل الكود والاسم</div>'; return; }
  try {
    await DB.addCategory({ code, name, unit });
    msg.innerHTML = '<div class="success-msg">تم إضافة الصنف</div>';
    document.getElementById('catCode').value = '';
    document.getElementById('catName').value = '';
    document.getElementById('catUnit').value = '';
    await refreshAll();
  } catch (e) { msg.innerHTML = `<div class="error-msg">${e.message}</div>`; }
}

// ---------- إجراءات المواقع ----------
async function handleAddSite() {
  const name = document.getElementById('siteName').value.trim();
  const supervisorName = document.getElementById('siteSupervisorName').value.trim();
  const supervisorUid = document.getElementById('siteSupervisorUid').value.trim();
  const msg = document.getElementById('siteMsg');
  if (!name) { msg.innerHTML = '<div class="error-msg">أدخل اسم الموقع</div>'; return; }
  try {
    const siteId = await DB.addSite({ name, supervisorUid, supervisorName });
    if (supervisorUid) {
      await db.collection('users').doc(supervisorUid).set({
        name: supervisorName, role: 'supervisor', siteId
      });
    }
    msg.innerHTML = '<div class="success-msg">تم إضافة الموقع</div>';
    document.getElementById('siteName').value = '';
    document.getElementById('siteSupervisorName').value = '';
    document.getElementById('siteSupervisorUid').value = '';
    await refreshAll();
  } catch (e) { msg.innerHTML = `<div class="error-msg">${e.message}</div>`; }
}

// ---------- الشراء / الرصيد الافتتاحي ----------
async function handlePurchase() {
  const categoryCode = document.getElementById('purchaseCategory').value;
  const qty = Number(document.getElementById('purchaseQty').value);
  const unitCost = Number(document.getElementById('purchaseCost').value);
  const isOpeningBalance = document.getElementById('purchaseIsOpening').checked;
  const status = document.getElementById('purchaseStatus').value;
  const location = document.getElementById('purchaseLocation').value;
  const notes = document.getElementById('purchaseNotes').value.trim();
  const msg = document.getElementById('purchaseMsg');
  if (!categoryCode || !qty || qty <= 0) { msg.innerHTML = '<div class="error-msg">تأكد من الصنف والكمية</div>'; return; }
  try {
    await DB.recordPurchase({ categoryCode, qty, unitCost: unitCost || 0, isOpeningBalance, notes, status, location, createdBy: currentUser.id });
    msg.innerHTML = '<div class="success-msg">تم التسجيل بنجاح</div>';
    document.getElementById('purchaseQty').value = '';
    document.getElementById('purchaseCost').value = '';
    document.getElementById('purchaseNotes').value = '';
    await refreshAll();
  } catch (e) { msg.innerHTML = `<div class="error-msg">${e.message}</div>`; }
}

// ---------- الصرف ----------
async function handleIssue() {
  const categoryCode = document.getElementById('issueCategory').value;
  const qty = Number(document.getElementById('issueQty').value);
  const siteId = document.getElementById('issueSite').value;
  const status = document.getElementById('issueStatus').value;
  const notes = document.getElementById('issueNotes').value.trim();
  if (!qty || qty <= 0) return alert('أدخل كمية صحيحة');
  try {
    await DB.recordIssue({ categoryCode, qty, siteId, status, notes, createdBy: currentUser.id });
    alert('تم الصرف بنجاح');
    document.getElementById('issueQty').value = '';
    await refreshAll();
  } catch (e) { alert(e.message); }
}

// ---------- الإرجاع ----------
async function handleReturn() {
  const categoryCode = document.getElementById('returnCategory').value;
  const qty = Number(document.getElementById('returnQty').value);
  const siteId = document.getElementById('returnSite').value;
  const status = document.getElementById('returnStatus').value;
  const notes = document.getElementById('returnNotes').value.trim();
  if (!qty || qty <= 0) return alert('أدخل كمية صحيحة');
  try {
    await DB.recordReturn({ categoryCode, qty, siteId, status, notes, createdBy: currentUser.id });
    alert('تم الإرجاع بنجاح');
    document.getElementById('returnQty').value = '';
    await refreshAll();
  } catch (e) { alert(e.message); }
}

// ---------- التحويل ----------
async function handleTransfer() {
  const categoryCode = document.getElementById('transferCategory').value;
  const qty = Number(document.getElementById('transferQty').value);
  const fromSiteId = document.getElementById('transferFrom').value;
  const toSiteId = document.getElementById('transferTo').value;
  const status = document.getElementById('transferStatus').value;
  if (!qty || qty <= 0) return alert('أدخل كمية صحيحة');
  if (fromSiteId === toSiteId) return alert('اختر موقعين مختلفين');
  try {
    await DB.recordTransfer({ categoryCode, qty, fromSiteId, toSiteId, status, createdBy: currentUser.id });
    alert('تم التحويل بنجاح');
    document.getElementById('transferQty').value = '';
    await refreshAll();
  } catch (e) { alert(e.message); }
}

// ---------- الإتلاف / الفقد ----------
async function handleWriteoff() {
  const categoryCode = document.getElementById('writeoffCategory').value;
  const qty = Number(document.getElementById('writeoffQty').value);
  const siteId = document.getElementById('writeoffSite').value;
  const status = document.getElementById('writeoffStatus').value;
  const reason = document.getElementById('writeoffReason').value;
  if (!qty || qty <= 0) return alert('أدخل كمية صحيحة');
  if (!confirm('تأكيد تسجيل إتلاف/فقد؟ هذا الإجراء يقلل الرصيد نهائيًا')) return;
  try {
    await DB.recordWriteoff({ categoryCode, qty, siteId, status, reason, createdBy: currentUser.id });
    alert('تم التسجيل');
    document.getElementById('writeoffQty').value = '';
    await refreshAll();
  } catch (e) { alert(e.message); }
}

// ---------- تغيير الحالة ----------
async function handleStatusChange() {
  const categoryCode = document.getElementById('statusChangeCategory').value;
  const qty = Number(document.getElementById('statusChangeQty').value);
  const location = document.getElementById('statusChangeLocation').value;
  const fromStatus = document.getElementById('statusChangeFrom').value;
  const toStatus = document.getElementById('statusChangeTo').value;
  const notes = document.getElementById('statusChangeNotes').value.trim();
  if (!qty || qty <= 0) return alert('أدخل كمية صحيحة');
  try {
    await DB.recordStatusChange({ categoryCode, qty, location, fromStatus, toStatus, notes, createdBy: currentUser.id });
    alert('تم تسجيل تغيير الحالة');
    document.getElementById('statusChangeQty').value = '';
    await refreshAll();
  } catch (e) { alert(e.message); }
}

// ---------- التقارير ----------
async function handleMonthlyReport() {
  const monthValue = document.getElementById('reportMonth').value; // YYYY-MM
  if (!monthValue) return alert('اختر الشهر');
  const result = await Reports.getMonthlyPurchaseCost(monthValue);
  document.getElementById('monthlyReportResult').innerHTML = Reports.renderMonthlyHtml(result);
}

async function loadAggregateAndSiteReports() {
  document.getElementById('aggregateReport').innerHTML = Reports.renderAggregateHtml(categoriesCache);

  const siteRows = await Reports.getSiteCosts(sitesCache, categoriesCache);
  document.getElementById('siteCostReport').innerHTML = Reports.renderSiteCostHtml(siteRows);

  const matrix = await Reports.getStockMatrix(sitesCache, categoriesCache);
  document.getElementById('stockMatrixReport').innerHTML = Reports.renderStockMatrixHtml(sitesCache, matrix);

  const writeoffData = await Reports.getWriteoffReport();
  document.getElementById('writeoffReport').innerHTML = Reports.renderWriteoffHtml(writeoffData);

  const statusTotals = await Reports.getStatusSummary(sitesCache, categoriesCache);
  document.getElementById('statusSummaryReport').innerHTML = Reports.renderStatusSummaryHtml(statusTotals);

  const statusRows = await Reports.getStatusDetailRows(sitesCache, categoriesCache);
  document.getElementById('statusDetailReport').innerHTML = Reports.renderStatusDetailHtml(statusRows);

  document.getElementById('historyCategory').innerHTML = categoryOptions();
}

async function handleCategoryHistory() {
  const code = document.getElementById('historyCategory').value;
  if (!code) return;
  const txs = await Reports.getCategoryHistory(code);
  document.getElementById('categoryHistoryResult').innerHTML = Reports.renderCategoryHistoryHtml(txs, sitesCache);
}

document.querySelector('[data-tab="reports"]').addEventListener('click', loadAggregateAndSiteReports);

// ---------- تصدير PDF عبر طباعة المتصفح ----------
function printReport(title, sourceElementId) {
  const content = document.getElementById(sourceElementId).innerHTML;
  const dateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('printSection').innerHTML = `
    <h2>${title}</h2>
    <div class="print-date">تاريخ التقرير: ${dateStr}</div>
    ${content}
  `;
  window.print();
}
