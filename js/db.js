// ============================================
// طبقة الوصول للبيانات (Data Layer)
// كل التعامل مع Firestore يمر من هنا فقط
//
// ملاحظة مهمة: كل دالة حركة هنا تلتزم بقاعدة Firestore الصارمة:
// "كل عمليات القراءة (get) لازم تحصل قبل أي عملية كتابة (set/update)"
// لذلك كل دالة مقسّمة صراحة لمرحلتين: قراءة كل المستندات المطلوبة أولاً،
// ثم حساب القيم الجديدة، ثم كتابة كل التحديثات دفعة واحدة.
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

  async updateCategory(code, { name, unit }) {
    await db.collection('categories').doc(code).update({ name, unit });
  },

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

  _siteStockRef(siteId, categoryCode) {
    return db.collection('sites').doc(siteId).collection('stock').doc(categoryCode);
  },

  // ============================================
  // الحركات (transactions)
  // ============================================

  // شراء جديد / رصيد افتتاحي -> ممكن يبدأ في المخزن المركزي أو في موقع مباشرة
  async recordPurchase({ categoryCode, qty, unitCost, isOpeningBalance, notes, createdBy, status, location }) {
    status = status || 'working';
    location = location || 'warehouse';
    const isWarehouse = location === 'warehouse';
    const catRef = db.collection('categories').doc(categoryCode);
    const siteRef = isWarehouse ? null : this._siteStockRef(location, categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      // ---- قراءة ----
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();
      let siteSnap = null;
      if (siteRef) siteSnap = await t.get(siteRef);

      // ---- حساب ----
      const oldQtyEver = cat.totalQtyPurchasedEver || 0;
      const oldCostEver = cat.totalCostPurchasedEver || 0;
      const newQtyEver = oldQtyEver + qty;
      const newCostEver = oldCostEver + (qty * unitCost);
      const newAvgCost = newQtyEver > 0 ? newCostEver / newQtyEver : unitCost;

      const catUpdate = {
        avgCost: newAvgCost,
        totalQtyPurchasedEver: newQtyEver,
        totalCostPurchasedEver: newCostEver
      };
      if (isWarehouse) {
        const field = STATUS_FIELD_ON_CATEGORY[status];
        catUpdate[field] = (cat[field] || 0) + qty;
      }

      // ---- كتابة ----
      t.update(catRef, catUpdate);
      if (siteRef) {
        const current = siteSnap.exists ? (siteSnap.data()[status] || 0) : 0;
        t.set(siteRef, { [status]: current + qty }, { merge: true });
      }

      t.set(txRef, {
        type: isOpeningBalance ? 'opening' : 'purchase',
        categoryCode, qty, unitCost, totalCost: qty * unitCost, status,
        fromSite: null, toSite: location,
        notes: notes || '', createdBy,
        date: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  },

  // صرف من المخزن المركزي لموقع
  async recordIssue({ categoryCode, qty, siteId, notes, createdBy, status }) {
    status = status || 'working';
    const catRef = db.collection('categories').doc(categoryCode);
    const siteRef = this._siteStockRef(siteId, categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();
      const siteSnap = await t.get(siteRef);

      const field = STATUS_FIELD_ON_CATEGORY[status];
      const warehouseCurrent = cat[field] || 0;
      if (warehouseCurrent < qty) throw new Error(`الرصيد غير كافٍ (${STATUS_LABELS[status]}) بالمخزن المركزي`);
      const siteCurrent = siteSnap.exists ? (siteSnap.data()[status] || 0) : 0;

      t.update(catRef, { [field]: warehouseCurrent - qty });
      t.set(siteRef, { [status]: siteCurrent + qty }, { merge: true });

      t.set(txRef, {
        type: 'issue', categoryCode, qty, status,
        unitCost: cat.avgCost || 0, totalCost: (cat.avgCost || 0) * qty,
        fromSite: 'warehouse', toSite: siteId,
        notes: notes || '', createdBy,
        date: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  },

  // إرجاع من موقع للمخزن المركزي
  async recordReturn({ categoryCode, qty, siteId, notes, createdBy, status }) {
    status = status || 'working';
    const catRef = db.collection('categories').doc(categoryCode);
    const siteRef = this._siteStockRef(siteId, categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();
      const siteSnap = await t.get(siteRef);

      const siteCurrent = siteSnap.exists ? (siteSnap.data()[status] || 0) : 0;
      if (siteCurrent < qty) throw new Error(`الرصيد غير كافٍ (${STATUS_LABELS[status]}) في الموقع`);
      const field = STATUS_FIELD_ON_CATEGORY[status];
      const warehouseCurrent = cat[field] || 0;

      t.set(siteRef, { [status]: siteCurrent - qty }, { merge: true });
      t.update(catRef, { [field]: warehouseCurrent + qty });

      t.set(txRef, {
        type: 'return', categoryCode, qty, status,
        unitCost: cat.avgCost || 0, totalCost: (cat.avgCost || 0) * qty,
        fromSite: siteId, toSite: 'warehouse',
        notes: notes || '', createdBy,
        date: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  },

  // تحويل مباشر بين موقعين
  async recordTransfer({ categoryCode, qty, fromSiteId, toSiteId, notes, createdBy, status }) {
    status = status || 'working';
    const catRef = db.collection('categories').doc(categoryCode);
    const fromRef = this._siteStockRef(fromSiteId, categoryCode);
    const toRef = this._siteStockRef(toSiteId, categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();
      const fromSnap = await t.get(fromRef);
      const toSnap = await t.get(toRef);

      const fromCurrent = fromSnap.exists ? (fromSnap.data()[status] || 0) : 0;
      if (fromCurrent < qty) throw new Error(`الرصيد غير كافٍ (${STATUS_LABELS[status]}) في الموقع المرسل`);
      const toCurrent = toSnap.exists ? (toSnap.data()[status] || 0) : 0;

      t.set(fromRef, { [status]: fromCurrent - qty }, { merge: true });
      t.set(toRef, { [status]: toCurrent + qty }, { merge: true });

      t.set(txRef, {
        type: 'transfer', categoryCode, qty, status,
        unitCost: cat.avgCost || 0, totalCost: (cat.avgCost || 0) * qty,
        fromSite: fromSiteId, toSite: toSiteId,
        notes: notes || '', createdBy,
        date: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  },

  // إتلاف / فقد
  async recordWriteoff({ categoryCode, qty, siteId, reason, notes, createdBy, status }) {
    status = status || 'damaged';
    const isWarehouse = siteId === 'warehouse';
    const catRef = db.collection('categories').doc(categoryCode);
    const siteRef = isWarehouse ? null : this._siteStockRef(siteId, categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      const catSnap = await t.get(catRef);
      if (!catSnap.exists) throw new Error('الصنف غير موجود');
      const cat = catSnap.data();
      let siteSnap = null;
      if (siteRef) siteSnap = await t.get(siteRef);

      if (isWarehouse) {
        const field = STATUS_FIELD_ON_CATEGORY[status];
        const current = cat[field] || 0;
        if (current < qty) throw new Error(`الرصيد غير كافٍ (${STATUS_LABELS[status]}) بالمخزن المركزي`);
        t.update(catRef, { [field]: current - qty });
      } else {
        const current = siteSnap.exists ? (siteSnap.data()[status] || 0) : 0;
        if (current < qty) throw new Error(`الرصيد غير كافٍ (${STATUS_LABELS[status]}) في الموقع`);
        t.set(siteRef, { [status]: current - qty }, { merge: true });
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

  // تغيير حالة قطع موجودة في نفس المكان
  async recordStatusChange({ categoryCode, qty, location, fromStatus, toStatus, notes, createdBy }) {
    if (fromStatus === toStatus) throw new Error('اختر حالتين مختلفتين');
    const isWarehouse = location === 'warehouse';
    const catRef = db.collection('categories').doc(categoryCode);
    const siteRef = isWarehouse ? null : this._siteStockRef(location, categoryCode);
    const txRef = db.collection('transactions').doc();

    await db.runTransaction(async (t) => {
      let catSnap = null, siteSnap = null;
      if (isWarehouse) {
        catSnap = await t.get(catRef);
        if (!catSnap.exists) throw new Error('الصنف غير موجود');
      } else {
        siteSnap = await t.get(siteRef);
      }

      if (isWarehouse) {
        const cat = catSnap.data();
        const fromField = STATUS_FIELD_ON_CATEGORY[fromStatus];
        const toField = STATUS_FIELD_ON_CATEGORY[toStatus];
        const fromCurrent = cat[fromField] || 0;
        if (fromCurrent < qty) throw new Error(`الرصيد غير كافٍ (${STATUS_LABELS[fromStatus]}) بالمخزن المركزي`);
        const toCurrent = cat[toField] || 0;
        t.update(catRef, { [fromField]: fromCurrent - qty, [toField]: toCurrent + qty });
      } else {
        const data = siteSnap.exists ? siteSnap.data() : {};
        const fromCurrent = data[fromStatus] || 0;
        if (fromCurrent < qty) throw new Error(`الرصيد غير كافٍ (${STATUS_LABELS[fromStatus]}) في الموقع`);
        const toCurrent = data[toStatus] || 0;
        t.set(siteRef, { [fromStatus]: fromCurrent - qty, [toStatus]: toCurrent + qty }, { merge: true });
      }

      t.set(txRef, {
        type: 'status_change', categoryCode, qty,
        fromStatus, toStatus, location,
        fromSite: isWarehouse ? 'warehouse' : location,
        toSite: isWarehouse ? 'warehouse' : location,
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
