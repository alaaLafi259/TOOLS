// ============================================
// منطق صفحة لوحة المعلومات
// ============================================

requireRole('admin', async () => {
  await loadDashboard();
});

async function loadDashboard() {
  const categories = await DB.getAllCategories();
  const sites = await DB.getAllSites();

  const siteStocks = {};
  const siteTotals = {};
  const siteValues = {};
  for (const site of sites) {
    const stock = await DB.getSiteStock(site.id);
    siteStocks[site.id] = stock;
    siteTotals[site.id] = stock.reduce((s, r) => s + (r.total || 0), 0);
    siteValues[site.id] = stock.reduce((sum, s) => {
      const cat = categories.find(c => c.code === s.categoryCode);
      return sum + (s.total || 0) * (cat ? cat.avgCost || 0 : 0);
    }, 0);
  }

  // ---------- نظرة عامة ----------
  const warehouseTotal = categories.reduce((s, c) => s + (c.totalQtyWarehouse || 0), 0);
  const warehouseValue = categories.reduce((s, c) => s + (c.totalQtyWarehouse || 0) * (c.avgCost || 0), 0);
  const sitesTotal = sites.reduce((s, site) => s + (siteTotals[site.id] || 0), 0);
  const sitesValue = sites.reduce((s, site) => s + (siteValues[site.id] || 0), 0);
  const grandTotal = warehouseTotal + sitesTotal;

  document.getElementById('overviewStats').innerHTML = `
    <div class="stat-box"><div class="value">${grandTotal}</div><div class="label">إجمالي القطع (مخزن + مواقع)</div></div>
    <div class="stat-box"><div class="value">${warehouseTotal}</div><div class="label">قطع المخزن المركزي</div></div>
    <div class="stat-box"><div class="value">${sitesTotal}</div><div class="label">قطع موزعة على المواقع</div></div>
    <div class="stat-box"><div class="value">${categories.length}</div><div class="label">عدد الأصناف</div></div>
    <div class="stat-box"><div class="value">${sites.length}</div><div class="label">عدد المواقع</div></div>
    <div class="stat-box"><div class="value">${(warehouseValue + sitesValue).toLocaleString()}</div><div class="label">القيمة الإجمالية للعدة</div></div>
  `;

  // ---------- حالة العدة ----------
  const statusTotals = await Reports.getStatusSummary(sites, categories);
  document.getElementById('statusStats').innerHTML = Reports.renderStatusSummaryHtml(statusTotals);

  // ---------- مخطط أعمدة: عدد القطع لكل موقع ----------
  const maxQty = Math.max(1, ...sites.map(s => siteTotals[s.id] || 0));
  document.getElementById('siteBarChart').innerHTML = sites.map(s => {
    const val = siteTotals[s.id] || 0;
    const pct = Math.round((val / maxQty) * 100);
    return `<div class="bar-row">
      <span class="bar-label">${s.name}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="bar-value">${val}</span>
    </div>`;
  }).join('') || '<p>لا توجد مواقع مسجلة</p>';

  // ---------- مخطط أعمدة: قيمة العدة لكل موقع ----------
  const maxVal = Math.max(1, ...sites.map(s => siteValues[s.id] || 0));
  document.getElementById('siteValueBarChart').innerHTML = sites.map(s => {
    const val = siteValues[s.id] || 0;
    const pct = Math.round((val / maxVal) * 100);
    return `<div class="bar-row">
      <span class="bar-label">${s.name}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:var(--purple);"></div></div>
      <span class="bar-value">${val.toLocaleString()}</span>
    </div>`;
  }).join('') || '<p>لا توجد مواقع مسجلة</p>';

  // ---------- أكثر 5 أصناف ----------
  const ranked = categories.map(cat => {
    let sitesQty = 0;
    sites.forEach(site => {
      (siteStocks[site.id] || []).forEach(s => { if (s.categoryCode === cat.code) sitesQty += s.total || 0; });
    });
    return { code: cat.code, name: cat.name, warehouseQty: cat.totalQtyWarehouse || 0, sitesQty, total: (cat.totalQtyWarehouse || 0) + sitesQty };
  }).sort((a, b) => b.total - a.total).slice(0, 5);

  document.getElementById('topCategoriesTable').innerHTML = ranked.map(r => `
    <tr><td>${r.code} - ${r.name}</td><td><strong>${r.total}</strong></td><td>${r.warehouseQty}</td><td>${r.sitesQty}</td></tr>
  `).join('') || '<tr><td colspan="4">لا توجد بيانات بعد</td></tr>';
}
