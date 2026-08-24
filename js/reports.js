// ============================================
// تقارير التكاليف والحالة
// ============================================

const Reports = {

  // تكلفة المشتريات خلال شهر معين (YYYY-MM)
  async getMonthlyPurchaseCost(monthValue) {
    const [year, month] = monthValue.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);
    const txs = await DB.getTransactionsBetween(
      firebase.firestore.Timestamp.fromDate(start),
      firebase.firestore.Timestamp.fromDate(end)
    );
    const purchases = txs.filter(t => t.type === 'purchase');
    const total = purchases.reduce((s, t) => s + (t.totalCost || 0), 0);
    return { purchases, total, monthValue };
  },

  renderMonthlyHtml({ purchases, total, monthValue }) {
    return `
      <p style="margin:10px 0; font-weight:bold;">إجمالي مشتريات ${monthValue}: ${total.toLocaleString()}</p>
      <table><thead><tr><th>الصنف</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الإجمالي</th></tr></thead>
      <tbody>${purchases.map(p => `<tr><td>${p.categoryCode}</td><td>${p.qty}</td><td>${p.unitCost}</td><td>${p.totalCost}</td></tr>`).join('') || '<tr><td colspan="4">لا توجد مشتريات هذا الشهر</td></tr>'}</tbody>
      </table>`;
  },

  // التكلفة المجمعة: إجمالي ما تم إنفاقه على الشراء منذ البداية + القيمة الحالية للمخزون
  renderAggregateHtml(categories) {
    const totalEverSpent = categories.reduce((s, c) => s + (c.totalCostPurchasedEver || 0), 0);
    const currentWarehouseValue = categories.reduce((s, c) => s + (c.totalQtyWarehouse || 0) * (c.avgCost || 0), 0);
    return `
      <div class="stat-row">
        <div class="stat-box"><div class="value">${totalEverSpent.toLocaleString()}</div><div class="label">إجمالي ما تم إنفاقه على العدة منذ البداية</div></div>
        <div class="stat-box"><div class="value">${currentWarehouseValue.toLocaleString()}</div><div class="label">القيمة الحالية بالمخزن المركزي</div></div>
      </div>`;
  },

  // قيمة العدة الموجودة تحت مسؤولية كل موقع حاليًا
  async getSiteCosts(sites, categories) {
    const rows = [];
    for (const site of sites) {
      const stock = await DB.getSiteStock(site.id);
      const value = stock.reduce((sum, s) => {
        const cat = categories.find(c => c.code === s.categoryCode);
        return sum + (s.total || 0) * (cat ? cat.avgCost || 0 : 0);
      }, 0);
      rows.push({ siteName: site.name, value });
    }
    return rows;
  },

  renderSiteCostHtml(rows) {
    return `<table><thead><tr><th>الموقع</th><th>قيمة العدة الموجودة به</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${r.siteName}</td><td>${r.value.toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="2">لا توجد مواقع</td></tr>'}</tbody></table>`;
  },

  // مصفوفة: كل صنف × كل موقع (والمخزن المركزي) - الإجمالي بغض النظر عن الحالة
  async getStockMatrix(sites, categories) {
    const siteStocks = {};
    for (const site of sites) {
      const stock = await DB.getSiteStock(site.id);
      siteStocks[site.id] = {};
      stock.forEach(s => siteStocks[site.id][s.categoryCode] = s.total || 0);
    }
    return categories.map(cat => {
      const perSite = sites.map(site => siteStocks[site.id][cat.code] || 0);
      const sitesTotal = perSite.reduce((a, b) => a + b, 0);
      return {
        code: cat.code, name: cat.name,
        warehouseQty: cat.totalQtyWarehouse || 0,
        perSite, sitesTotal,
        grandTotal: (cat.totalQtyWarehouse || 0) + sitesTotal
      };
    });
  },

  renderStockMatrixHtml(sites, matrix) {
    const siteHeaders = sites.map(s => `<th>${s.name}</th>`).join('');
    const rows = matrix.map(row => `
      <tr>
        <td>${row.code} - ${row.name}</td>
        <td>${row.warehouseQty}</td>
        ${row.perSite.map(q => `<td>${q}</td>`).join('')}
        <td><strong>${row.grandTotal}</strong></td>
      </tr>`).join('');
    return `<table><thead><tr><th>الصنف</th><th>المخزن المركزي</th>${siteHeaders}<th>الإجمالي الكلي</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="${sites.length + 3}">لا توجد بيانات</td></tr>`}</tbody></table>`;
  },

  // ---------- تقرير الحالة (تعمل / تالفة / تحت الصيانة / معطلة) ----------

  // إجمالي كل حالة على مستوى الشركة كلها (مخزن + كل المواقع)
  async getStatusSummary(sites, categories) {
    const totals = { working: 0, damaged: 0, maintenance: 0, outOfService: 0 };
    categories.forEach(c => {
      DB.STATUS_KEYS.forEach(k => totals[k] += (c.warehouseStock ? c.warehouseStock[k] : 0) || 0);
    });
    for (const site of sites) {
      const stock = await DB.getSiteStock(site.id);
      stock.forEach(s => DB.STATUS_KEYS.forEach(k => totals[k] += s[k] || 0));
    }
    return totals;
  },

  renderStatusSummaryHtml(totals) {
    return `<div class="stat-row">
      ${DB.STATUS_KEYS.map(k => `<div class="stat-box"><div class="value">${totals[k]}</div><div class="label">${DB.STATUS_LABELS[k]}</div></div>`).join('')}
    </div>`;
  },

  // تفصيل كل صنف في كل مكان (مخزن أو موقع) مع تقسيم الحالات - جدول مفصّل
  async getStatusDetailRows(sites, categories) {
    const rows = [];
    categories.forEach(cat => {
      const ws = cat.warehouseStock || emptyStatusMapLocal();
      if (sumValues(ws) > 0) {
        rows.push({ location: 'المخزن المركزي', code: cat.code, name: cat.name, ...ws });
      }
    });
    for (const site of sites) {
      const stock = await DB.getSiteStock(site.id);
      stock.forEach(s => {
        if (s.total > 0) {
          const cat = categories.find(c => c.code === s.categoryCode);
          rows.push({
            location: site.name, code: s.categoryCode, name: cat ? cat.name : s.categoryCode,
            working: s.working, damaged: s.damaged, maintenance: s.maintenance, outOfService: s.outOfService
          });
        }
      });
    }
    return rows;
  },

  renderStatusDetailHtml(rows) {
    const body = rows.map(r => `
      <tr>
        <td>${r.location}</td>
        <td>${r.code} - ${r.name}</td>
        <td>${r.working}</td>
        <td>${r.damaged}</td>
        <td>${r.maintenance}</td>
        <td>${r.outOfService}</td>
      </tr>`).join('');
    return `<table><thead><tr><th>المكان</th><th>الصنف</th><th>تعمل</th><th>تالفة</th><th>تحت الصيانة</th><th>معطلة</th></tr></thead>
      <tbody>${body || '<tr><td colspan="6">لا توجد بيانات</td></tr>'}</tbody></table>`;
  },

  // تقرير الإتلاف والفقد الإجمالي (كمية وقيمة، لكل صنف)
  async getWriteoffReport() {
    const txs = await DB.getAllTransactions(1000);
    const writeoffs = txs.filter(t => t.type === 'writeoff');
    const byCategory = {};
    writeoffs.forEach(w => {
      if (!byCategory[w.categoryCode]) byCategory[w.categoryCode] = { qty: 0, cost: 0 };
      byCategory[w.categoryCode].qty += w.qty || 0;
      byCategory[w.categoryCode].cost += w.totalCost || 0;
    });
    const totalCost = writeoffs.reduce((s, w) => s + (w.totalCost || 0), 0);
    return { byCategory, totalCost, count: writeoffs.length };
  },

  renderWriteoffHtml({ byCategory, totalCost, count }) {
    const rows = Object.entries(byCategory).map(([code, v]) => `<tr><td>${code}</td><td>${v.qty}</td><td>${v.cost.toLocaleString()}</td></tr>`).join('');
    return `
      <p style="margin:10px 0; font-weight:bold;">إجمالي قيمة الخسائر: ${totalCost.toLocaleString()} (عدد الحركات: ${count})</p>
      <table><thead><tr><th>الصنف</th><th>الكمية المفقودة/التالفة</th><th>القيمة</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3">لا توجد حالات إتلاف/فقد</td></tr>'}</tbody></table>`;
  },

  // تقرير حركات صنف معين عبر كل المواقع
  async getCategoryHistory(categoryCode) {
    const txs = await DB.getAllTransactions(1000);
    return txs.filter(t => t.categoryCode === categoryCode);
  },

  renderCategoryHistoryHtml(txs, sitesCache) {
    const typeLabels = { purchase: 'شراء', opening: 'رصيد افتتاحي', issue: 'صرف', return: 'إرجاع', transfer: 'تحويل', writeoff: 'إتلاف/فقد', status_change: 'تغيير حالة' };
    const siteName = (id) => id === 'warehouse' ? 'المخزن المركزي' : (sitesCache.find(s => s.id === id)?.name || id || '-');
    const rows = txs.map(tx => `
      <tr>
        <td>${tx.date ? new Date(tx.date.seconds * 1000).toLocaleString('ar-EG') : '-'}</td>
        <td><span class="badge ${tx.type}">${typeLabels[tx.type] || tx.type}</span></td>
        <td>${tx.qty}</td>
        <td>${tx.type === 'status_change' ? (DB.STATUS_LABELS[tx.fromStatus] + ' ← ' + DB.STATUS_LABELS[tx.toStatus]) : (DB.STATUS_LABELS[tx.status] || '-')}</td>
        <td>${siteName(tx.fromSite)}</td>
        <td>${siteName(tx.toSite)}</td>
      </tr>`).join('');
    return `<table><thead><tr><th>التاريخ</th><th>النوع</th><th>الكمية</th><th>الحالة</th><th>من</th><th>إلى</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">لا توجد حركات لهذا الصنف</td></tr>'}</tbody></table>`;
  }
};

function emptyStatusMapLocal() { return { working: 0, damaged: 0, maintenance: 0, outOfService: 0 }; }
function sumValues(obj) { return Object.values(obj).reduce((a, b) => a + b, 0); }
