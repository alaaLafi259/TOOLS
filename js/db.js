// ============================================
// طبقة الوصول للبيانات (Data Layer)
// كل التعامل مع Firestore يمر من هنا فقط
// ============================================

const DB = {

  // ---------- المستخدمين ----------
  async getUserProfile(uid) {
    const snap = await db.collection('users').doc(uid).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  },

  // ---------- الأصناف (categories) ----------
  async getAllCategories() {
    const snap = await db.collection('categories').orderBy('name').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async addCategory({ code, name, unit }) {
    const ref = db.collection('categories').doc(code);
    const existing = await ref.get();
    if (existing.exists) throw new Error('كود الصنف موجود بالفعل');
    await ref.set({
      code, name, unit: unit || 'قطعة',
      avgCost: 0,
      totalQtyWarehouse: 0,
      totalQtyPurchasedEver: 0,
      totalCostPurchasedEver: 0,
      active: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  // ---------- المواقع (sites) ----------
  async getAllSites() {
    const snap = await db.collection('sites').orderBy('name').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async addSite({ name, supervisorUid, supervisorName }) {
    const ref = await db.collection('sites').add({
      name, supervisorUid: supervisorUid || null, supervisorName: supervisorName || '',
      active: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
  },

  async getSiteStock(siteId) {
    const snap = await db.collection('sites').doc(siteId).collection('stock').get();
    return snap.docs.map(d => ({ categoryCode: d.id, ...d.data() }));
  },

  // ---------- منطق تحديث الأرصدة (يُستخدم داخل transactions فقط) ----------
  _siteStockRef(siteId, categoryCode) {
    return db.collection('sites').doc(siteId).collection('stock').doc(categoryCode);
  },

  async _adjustSiteQty(t, siteId, categoryCode, delta) {
    const ref = this._siteStockRef(siteId, categoryCode);
    const snap = await t.get(ref);
    const current = snap.exists ? (snap.data().qty || 0) : 0;
    const next = current + delta;
    if (next < 0) throw new Error(`الرصيد غير كافٍ في الموقع للصنف ${categoryCode}`);
    t.set(ref, { qty: next }, { merge: true });
  },

  // ============================================
  // الحركات (transactions) - كل حركة تمر عبر Firestore transaction
  // عشان نضمن إن الأرصدة متتحدثش غلط لو حصل تعارض
  // ============================================

  // شراء جديد / رصيد افتتاحي -> يزيد رصيد المخزن المركزي ويحدّث متوسط التكلفة
  async recordPurchase({ categoryCode, qty, unitCost, isOpeningBalance, notes, createdBy }) {
    const catRef = db.collection('categories').doc(categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();

      const oldQty = cat.totalQtyWarehouse || 0;
      const oldAvgCost = cat.avgCost || 0;
      const newQty = oldQty + qty;
      // متوسط تكلفة مرجح جديد
      const newAvgCost = newQty > 0
        ? ((oldQty * oldAvgCost) + (qty * unitCost)) / newQty
        : unitCost;

      t.update(catRef, {
        totalQtyWarehouse: newQty,
        avgCost: newAvgCost,
        totalQtyPurchasedEver: (cat.totalQtyPurchasedEver || 0) + qty,
        totalCostPurchasedEver: (cat.totalCostPurchasedEver || 0) + (qty * unitCost)
      });

      t.set(txRef, {
        type: isOpeningBalance ? 'opening' : 'purchase',
        categoryCode, qty, unitCost, totalCost: qty * unitCost,
        fromSite: null, toSite: 'warehouse',
        notes: notes || '', createdBy,
        date: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  },

  // صرف من المخزن المركزي لموقع
  async recordIssue({ categoryCode, qty, siteId, notes, createdBy }) {
    const catRef = db.collection('categories').doc(categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();
      const warehouseQty = cat.totalQtyWarehouse || 0;
      if (warehouseQty < qty) throw new Error('الكمية غير متوفرة بالمخزن المركزي');

      t.update(catRef, { totalQtyWarehouse: warehouseQty - qty });
      await this._adjustSiteQty(t, siteId, categoryCode, qty);

      t.set(txRef, {
        type: 'issue', categoryCode, qty,
        unitCost: cat.avgCost || 0, totalCost: (cat.avgCost || 0) * qty,
        fromSite: 'warehouse', toSite: siteId,
        notes: notes || '', createdBy,
        date: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  },

  // إرجاع من موقع للمخزن المركزي
  async recordReturn({ categoryCode, qty, siteId, notes, createdBy }) {
    const catRef = db.collection('categories').doc(categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();

      await this._adjustSiteQty(t, siteId, categoryCode, -qty);
      t.update(catRef, { totalQtyWarehouse: (cat.totalQtyWarehouse || 0) + qty });

      t.set(txRef, {
        type: 'return', categoryCode, qty,
        unitCost: cat.avgCost || 0, totalCost: (cat.avgCost || 0) * qty,
        fromSite: siteId, toSite: 'warehouse',
        notes: notes || '', createdBy,
        date: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  },

  // تحويل مباشر بين موقعين
  async recordTransfer({ categoryCode, qty, fromSiteId, toSiteId, notes, createdBy }) {
    const catRef = db.collection('categories').doc(categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();

      await this._adjustSiteQty(t, fromSiteId, categoryCode, -qty);
      await this._adjustSiteQty(t, toSiteId, categoryCode, qty);

      t.set(txRef, {
        type: 'transfer', categoryCode, qty,
        unitCost: cat.avgCost || 0, totalCost: (cat.avgCost || 0) * qty,
        fromSite: fromSiteId, toSite: toSiteId,
        notes: notes || '', createdBy,
        date: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  },

  // إتلاف / فقد
  async recordWriteoff({ categoryCode, qty, siteId, reason, notes, createdBy }) {
    // siteId ممكن يكون 'warehouse' أو موقع فعلي
    const catRef = db.collection('categories').doc(categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();

      if (siteId === 'warehouse') {
        const wQty = cat.totalQtyWarehouse || 0;
        if (wQty < qty) throw new Error('الكمية غير متوفرة بالمخزن');
        t.update(catRef, { totalQtyWarehouse: wQty - qty });
      } else {
        await this._adjustSiteQty(t, siteId, categoryCode, -qty);
      }

      t.set(txRef, {
        type: 'writeoff', categoryCode, qty,
        unitCost: cat.avgCost || 0, totalCost: (cat.avgCost || 0) * qty,
        fromSite: siteId, toSite: null,
        reason: reason || '', notes: notes || '', createdBy,
        date: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  },

  // ---------- استعلامات للتقارير ----------
  async getTransactionsBetween(startDate, endDate) {
    const snap = await db.collection('transactions')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .orderBy('date', 'desc')
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getAllTransactions(limit = 200) {
    const snap = await db.collection('transactions').orderBy('date', 'desc').limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
};
