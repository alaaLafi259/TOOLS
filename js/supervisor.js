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

async function refresh() {
  allCategories = await DB.getAllCategories();
  allSites = (await DB.getAllSites()).filter(s => s.id !== myProfile.siteId);

  const catOptions = allCategories.map(c => `<option value="${c.code}">${c.code} - ${c.name}</option>`).join('');
  ['issueCategory', 'returnCategory', 'transferCategory', 'writeoffCategory'].forEach(id => {
    document.getElementById(id).innerHTML = catOptions;
  });
  document.getElementById('transferTo').innerHTML = allSites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

  const stock = await DB.getSiteStock(myProfile.siteId);
  document.getElementById('stockTable').innerHTML = stock.map(s => {
    const cat = allCategories.find(c => c.code === s.categoryCode);
    return `<tr><td>${cat ? cat.name : s.categoryCode}</td><td>${s.qty}</td></tr>`;
  }).join('') || '<tr><td colspan="2">لا يوجد رصيد حاليًا</td></tr>';

  const allTx = await DB.getAllTransactions(200);
  const myTx = allTx.filter(t => t.fromSite === myProfile.siteId || t.toSite === myProfile.siteId).slice(0, 30);
  const typeLabels = { purchase: 'شراء', opening: 'رصيد افتتاحي', issue: 'استلام', return: 'إرجاع', transfer: 'تحويل', writeoff: 'إتلاف/فقد' };
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
  const notes = document.getElementById('issueNotes').value.trim();
  if (!qty || qty <= 0) return alert('أدخل كمية صحيحة');
  try {
    await DB.recordIssue({ categoryCode, qty, siteId: myProfile.siteId, notes, createdBy: myProfile.id });
    alert('تم تسجيل الاستلام');
    document.getElementById('issueQty').value = '';
    await refresh();
  } catch (e) { alert(e.message); }
}

async function handleReturnFromMe() {
  const categoryCode = document.getElementById('returnCategory').value;
  const qty = Number(document.getElementById('returnQty').value);
  const notes = document.getElementById('returnNotes').value.trim();
  if (!qty || qty <= 0) return alert('أدخل كمية صحيحة');
  try {
    await DB.recordReturn({ categoryCode, qty, siteId: myProfile.siteId, notes, createdBy: myProfile.id });
    alert('تم تسجيل الإرجاع');
    document.getElementById('returnQty').value = '';
    await refresh();
  } catch (e) { alert(e.message); }
}

async function handleTransferFromMe() {
  const categoryCode = document.getElementById('transferCategory').value;
  const qty = Number(document.getElementById('transferQty').value);
  const toSiteId = document.getElementById('transferTo').value;
  if (!qty || qty <= 0) return alert('أدخل كمية صحيحة');
  if (!toSiteId) return alert('لا يوجد مواقع أخرى للتحويل إليها');
  try {
    await DB.recordTransfer({ categoryCode, qty, fromSiteId: myProfile.siteId, toSiteId, createdBy: myProfile.id });
    alert('تم التحويل');
    document.getElementById('transferQty').value = '';
    await refresh();
  } catch (e) { alert(e.message); }
}

async function handleWriteoffFromMe() {
  const categoryCode = document.getElementById('writeoffCategory').value;
  const qty = Number(document.getElementById('writeoffQty').value);
  const reason = document.getElementById('writeoffReason').value;
  if (!qty || qty <= 0) return alert('أدخل كمية صحيحة');
  if (!confirm('تأكيد تسجيل إتلاف/فقد؟')) return;
  try {
    await DB.recordWriteoff({ categoryCode, qty, siteId: myProfile.siteId, reason, createdBy: myProfile.id });
    alert('تم التسجيل');
    document.getElementById('writeoffQty').value = '';
    await refresh();
  } catch (e) { alert(e.message); }
}
