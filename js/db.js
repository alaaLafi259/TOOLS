// ============================================
// طبقة الوصول للبيانات (Data Layer)
// كل التعامل مع Firestore يمر من هنا فقط
// ============================================

const STATUS_KEYS = ['working', 'damaged', 'maintenance', 'outOfService'];
const STATUS_LABELS = {
  working: 'تعمل',
  damaged: 'تالفة',
  maintenance: 'تحت الصيانة',
  outOfService: 'معطلة'
};
const STATUS_FIELD_ON_CATEGORY = {
  working: 'stockWorking',
  damaged: 'stockDamaged',
  maintenance: 'stockMaintenance',
  outOfService: 'stockOutOfService'
};

function emptyStatusMap() {
  return { working: 0, damaged: 0, maintenance: 0, outOfService: 0 };
}

function sumStatusMap(map) {
  return STATUS_KEYS.reduce((s, k) => s + (map[k] || 0), 0);
}

const DB = {

  STATUS_KEYS, STATUS_LABELS,

  // ---------- المستخدمين ----------
  async getUserProfile(uid) {
    const snap = await db.collection('users').doc(uid).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  },

  // ---------- الأصناف (categories) ----------
  async getAllCategories() {
    const snap = await db.collection('categories').orderBy('name').get();
    return snap.docs.map(d => {
      const data = d.data();
      const warehouseStock = {
        working: data.stockWorking || 0,
        damaged: data.stockDamaged || 0,
        maintenance: data.stockMaintenance || 0,
        outOfService: data.stockOutOfService || 0
      };
      return { id: d.id, ...data, warehouseStock, totalQtyWarehouse: sumStatusMap(warehouseStock) };
    });
  },

  async addCategory({ code, name, unit }) {
    const ref = db.collection('categories').doc(code);
    const existing = await ref.get();
    if (existing.exists) throw new Error('كود الصنف موجود بالفعل');
    await ref.set({
      code, name, unit: unit || 'قطعة',
      avgCost: 0,
      stockWorking: 0, stockDamaged: 0, stockMaintenance: 0, stockOutOfService: 0,
      totalQtyPurchasedEver: 0,
      totalCostPurchasedEver: 0,
      active: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  // تعديل اسم/وحدة الصنف (الكود لا يمكن تعديله لأنه معرف المستند)
  async updateCategory(code, { name, unit }) {
    await db.collection('categories').doc(code).update({ name, unit });
  },

  // حذف صنف نهائيًا - يُستخدم فقط لتصحيح خطأ إدخال، والتحقق من عدم وجود رصيد
  // أو حركات يتم في واجهة الأدمن قبل النداء على هذه الدالة
  async deleteCategory(code) {
    await db.collection('categories').doc(code).delete();
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

  // يرجع رصيد الموقع كقائمة { categoryCode, working, damaged, maintenance, outOfService, total }
  async getSiteStock(siteId) {
    const snap = await db.collection('sites').doc(siteId).collection('stock').get();
    return snap.docs.map(d => {
      const data = d.data();
      const statusMap = {
        working: data.working || 0,
        damaged: data.damaged || 0,
        maintenance: data.maintenance || 0,
        outOfService: data.outOfService || 0
      };
      return { categoryCode: d.id, ...statusMap, total: sumStatusMap(statusMap) };
    });
  },

  // ---------- منطق تحديث الأرصدة (يُستخدم داخل transactions فقط) ----------
  _siteStockRef(siteId, categoryCode) {
    return db.collection('sites').doc(siteId).collection('stock').doc(categoryCode);
  },

  async _adjustSiteStatusQty(t, siteId, categoryCode, status, delta) {
    const ref = this._siteStockRef(siteId, categoryCode);
    const snap = await t.get(ref);
    const current = snap.exists ? (snap.data()[status] || 0) : 0;
    const next = current + delta;
    if (next < 0) throw new Error(`الرصيد غير كافٍ (${STATUS_LABELS[status]}) في الموقع للصنف ${categoryCode}`);
    t.set(ref, { [status]: next }, { merge: true });
  },

  async _adjustWarehouseStatusQty(t, catRef, catData, status, delta) {
    const field = STATUS_FIELD_ON_CATEGORY[status];
    const current = catData[field] || 0;
    const next = current + delta;
    if (next < 0) throw new Error(`الرصيد غير كافٍ (${STATUS_LABELS[status]}) بالمخزن المركزي`);
    t.update(catRef, { [field]: next });
    return next;
  },

  // ============================================
  // الحركات (transactions)
  // ============================================

  // شراء جديد / رصيد افتتاحي -> يزيد رصيد المخزن المركزي بحالة معينة (افتراضي: تعمل)
  async recordPurchase({ categoryCode, qty, unitCost, isOpeningBalance, notes, createdBy, status }) {
    status = status || 'working';
    const catRef = db.collection('categories').doc(categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();

      const oldTotalQty = STATUS_KEYS.reduce((s, k) => s + (cat[STATUS_FIELD_ON_CATEGORY[k]] || 0), 0);
      const oldAvgCost = cat.avgCost || 0;
      const newTotalQty = oldTotalQty + qty;
      const newAvgCost = newTotalQty > 0
        ? ((oldTotalQty * oldAvgCost) + (qty * unitCost)) / newTotalQty
        : unitCost;

      const field = STATUS_FIELD_ON_CATEGORY[status];
      t.update(catRef, {
        [field]: (cat[field] || 0) + qty,
        avgCost: newAvgCost,
        totalQtyPurchasedEver: (cat.totalQtyPurchasedEver || 0) + qty,
        totalCostPurchasedEver: (cat.totalCostPurchasedEver || 0) + (qty * unitCost)
      });

      t.set(txRef, {
        type: isOpeningBalance ? 'opening' : 'purchase',
        categoryCode, qty, unitCost, totalCost: qty * unitCost, status,
        fromSite: null, toSite: 'warehouse',
        notes: notes || '', createdBy,
        date: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  },

  // صرف من المخزن المركزي لموقع (بحالة معينة)
  async recordIssue({ categoryCode, qty, siteId, notes, createdBy, status }) {
    status = status || 'working';
    const catRef = db.collection('categories').doc(categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();

      await this._adjustWarehouseStatusQty(t, catRef, cat, status, -qty);
      await this._adjustSiteStatusQty(t, siteId, categoryCode, status, qty);

      t.set(txRef, {
        type: 'issue', categoryCode, qty, status,
        unitCost: cat.avgCost || 0, totalCost: (cat.avgCost || 0) * qty,
        fromSite: 'warehouse', toSite: siteId,
        notes: notes || '', createdBy,
        date: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  },

  // إرجاع من موقع للمخزن المركزي (بحالة معينة)
  async recordReturn({ categoryCode, qty, siteId, notes, createdBy, status }) {
    status = status || 'working';
    const catRef = db.collection('categories').doc(categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();

      await this._adjustSiteStatusQty(t, siteId, categoryCode, status, -qty);
      await this._adjustWarehouseStatusQty(t, catRef, cat, status, qty);

      t.set(txRef, {
        type: 'return', categoryCode, qty, status,
        unitCost: cat.avgCost || 0, totalCost: (cat.avgCost || 0) * qty,
        fromSite: siteId, toSite: 'warehouse',
        notes: notes || '', createdBy,
        date: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  },

  // تحويل مباشر بين موقعين (بحالة معينة)
  async recordTransfer({ categoryCode, qty, fromSiteId, toSiteId, notes, createdBy, status }) {
    status = status || 'working';
    const catRef = db.collection('categories').doc(categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();

      await this._adjustSiteStatusQty(t, fromSiteId, categoryCode, status, -qty);
      await this._adjustSiteStatusQty(t, toSiteId, categoryCode, status, qty);

      t.set(txRef, {
        type: 'transfer', categoryCode, qty, status,
        unitCost: cat.avgCost || 0, totalCost: (cat.avgCost || 0) * qty,
        fromSite: fromSiteId, toSite: toSiteId,
        notes: notes || '', createdBy,
        date: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  },

  // إتلاف / فقد (بحالة معينة - غالبًا تالفة أو معطلة)
  async recordWriteoff({ categoryCode, qty, siteId, reason, notes, createdBy, status }) {
    status = status || 'damaged';
    const catRef = db.collection('categories').doc(categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();

      if (siteId === 'warehouse') {
        await this._adjustWarehouseStatusQty(t, catRef, cat, status, -qty);
      } else {
        await this._adjustSiteStatusQty(t, siteId, categoryCode, status, -qty);
      }

      t.set(txRef, {
        type: 'writeoff', categoryCode, qty, status,
        unitCost: cat.avgCost || 0, totalCost: (cat.avgCost || 0) * qty,
        fromSite: siteId, toSite: null,
        reason: reason || '', notes: notes || '', createdBy,
        date: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  },

  // تغيير حالة قطع موجودة في نفس المكان (مثلاً: تعمل -> تالفة، أو تحت الصيانة -> تعمل)
  // location: 'warehouse' أو معرف موقع
  async recordStatusChange({ categoryCode, qty, location, fromStatus, toStatus, notes, createdBy }) {
    if (fromStatus === toStatus) throw new Error('اختر حالتين مختلفتين');
    const catRef = db.collection('categories').doc(categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();

      if (location === 'warehouse') {
        await this._adjustWarehouseStatusQty(t, catRef, cat, fromStatus, -qty);
        await this._adjustWarehouseStatusQty(t, catRef, cat, toStatus, qty);
      } else {
        await this._adjustSiteStatusQty(t, location, categoryCode, fromStatus, -qty);
        await this._adjustSiteStatusQty(t, location, categoryCode, toStatus, qty);
      }

      t.set(txRef, {
        type: 'status_change', categoryCode, qty,
        fromStatus, toStatus, location,
        fromSite: location === 'warehouse' ? 'warehouse' : location,
        toSite: location === 'warehouse' ? 'warehouse' : location,
        notes: notes || '', createdBy,
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
