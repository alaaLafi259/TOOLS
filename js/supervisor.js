// ============================================
// منطق لوحة مشرف الموقع - كل العمليات مقيدة بموقعه فقط
// ============================================

let myProfile = null;
let allCategories = [];
let allSites = [];

requireRole('supervisor', async (profile) => {
  myProfile = profile;
  const site = (await DB.getAllSites()).find(s => s.id === profile.siteId);
  document.getElementById('siteTitle').textContent = `لوحة مشرف موقع: ${site ? site.name : ''}`;
  await refresh();
});

function statusOptions() {
  return DB.STATUS_KEYS.map(k => `<option value="${k}">${DB.STATUS_LABELS[k]}</option>`).join('');
}

async function refresh() {
  allCategories = await DB.getAllCategories();
  allSites = (await DB.getAllSites()).filter(s => s.id !== myProfile.siteId);

  const catOptions = allCategories.map(c => `<option value="${c.code}">${c.code} - ${c.name}</option>`).join('');
  ['issueCategory', 'returnCategory', 'transferCategory', 'writeoffCategory', 'statusChangeCategory'].forEach(id => {
    document.getElementById(id).innerHTML = catOptions;
  });
  ['issueStatus', 'returnStatus', 'transferStatus', 'writeoffStatus', 'statusChangeFrom', 'statusChangeTo'].forEach(id => {
    document.getElementById(id).innerHTML = statusOptions();
  });
  document.getElementById('writeoffStatus').value = 'damaged';
  document.getElementById('statusChangeTo').value = 'damaged';
  document.getElementById('transferTo').innerHTML = allSites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

  const stock = await DB.getSiteStock(myProfile.siteId);
  document.getElementById('stockTable').innerHTML = stock.filter(s => s.total > 0).map(s => {
    const cat = allCategories.find(c => c.code === s.categoryCode);
    return `<tr><td>${cat ? cat.name : s.categoryCode}</td><td>${s.working}</td><td>${s.damaged}</td><td>${s.maintenance}</td><td>${s.outOfService}</td><td><strong>${s.total}</strong></td></tr>`;
  }).join('') || '<tr><td colspan="6">لا يوجد رصيد حاليًا</td></tr>';

  const allTx = await DB.getAllTransactions(200);
  const myTx = allTx.filter(t => t.fromSite === myProfile.siteId || t.toSite === myProfile.siteId).slice(0, 30);
  const typeLabels = { purchase: 'شراء', opening: 'رصيد افتتاحي', issue: 'استلام', return: 'إرجاع', transfer: 'تحويل', writeoff: 'إتلاف/فقد', status_change: 'تغيير حالة' };
  document.getElementById('myLogTable').innerHTML = myTx.map(tx => `
    <tr>
      <td>${tx.date ? new Date(tx.date.seconds * 1000).toLocaleString('ar-EG') : '-'}</td>
      <td><span class="badge ${tx.type}">${typeLabels[tx.type] || tx.type}</span></td>
      <td>${tx.categoryCode}</td>
      <td>${tx.qty}</td>
    </tr>`).join('');
}

async function handleIssueToMe() {
  const categoryCode = document.getElementById('issueCategory').value;
  const qty = Number(document.getElementById('issueQty').value);
  const status = document.getElementById('issueStatus').value;
  const notes = document.getElementById('issueNotes').value.trim();
  if (!qty || qty <= 0) return alert('أدخل كمية صحيحة');
  try {
    await DB.recordIssue({ categoryCode, qty, siteId: myProfile.siteId, status, notes, createdBy: myProfile.id });
    alert('تم تسجيل الاستلام');
    document.getElementById('issueQty').value = '';
    await refresh();
  } catch (e) { alert(e.message); }
}

async function handleReturnFromMe() {
  const categoryCode = document.getElementById('returnCategory').value;
  const qty = Number(document.getElementById('returnQty').value);
  const status = document.getElementById('returnStatus').value;
  const notes = document.getElementById('returnNotes').value.trim();
  if (!qty || qty <= 0) return alert('أدخل كمية صحيحة');
  try {
    await DB.recordReturn({ categoryCode, qty, siteId: myProfile.siteId, status, notes, createdBy: myProfile.id });
    alert('تم تسجيل الإرجاع');
    document.getElementById('returnQty').value = '';
    await refresh();
  } catch (e) { alert(e.message); }
}

async function handleTransferFromMe() {
  const categoryCode = document.getElementById('transferCategory').value;
  const qty = Number(document.getElementById('transferQty').value);
  const toSiteId = document.getElementById('transferTo').value;
  const status = document.getElementById('transferStatus').value;
  if (!qty || qty <= 0) return alert('أدخل كمية صحيحة');
  if (!toSiteId) return alert('لا يوجد مواقع أخرى للتحويل إليها');
  try {
    await DB.recordTransfer({ categoryCode, qty, fromSiteId: myProfile.siteId, toSiteId, status, createdBy: myProfile.id });
    alert('تم التحويل');
    document.getElementById('transferQty').value = '';
    await refresh();
  } catch (e) { alert(e.message); }
}

async function handleWriteoffFromMe() {
  const categoryCode = document.getElementById('writeoffCategory').value;
  const qty = Number(document.getElementById('writeoffQty').value);
  const status = document.getElementById('writeoffStatus').value;
  const reason = document.getElementById('writeoffReason').value;
  if (!qty || qty <= 0) return alert('أدخل كمية صحيحة');
  if (!confirm('تأكيد تسجيل إتلاف/فقد؟')) return;
  try {
    await DB.recordWriteoff({ categoryCode, qty, siteId: myProfile.siteId, status, reason, createdBy: myProfile.id });
    alert('تم التسجيل');
    document.getElementById('writeoffQty').value = '';
    await refresh();
  } catch (e) { alert(e.message); }
}

async function handleStatusChangeAtMySite() {
  const categoryCode = document.getElementById('statusChangeCategory').value;
  const qty = Number(document.getElementById('statusChangeQty').value);
  const fromStatus = document.getElementById('statusChangeFrom').value;
  const toStatus = document.getElementById('statusChangeTo').value;
  if (!qty || qty <= 0) return alert('أدخل كمية صحيحة');
  try {
    await DB.recordStatusChange({ categoryCode, qty, location: myProfile.siteId, fromStatus, toStatus, createdBy: myProfile.id });
    alert('تم تسجيل تغيير الحالة');
    document.getElementById('statusChangeQty').value = '';
    await refresh();
  } catch (e) { alert(e.message); }
}
