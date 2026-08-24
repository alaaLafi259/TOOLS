// ============================================
// المصادقة وتوجيه المستخدم حسب دوره
// ============================================

async function loginUser(email, password) {
  const cred = await auth.signInWithEmailAndPassword(email, password);
  const profile = await DB.getUserProfile(cred.user.uid);
  if (!profile) throw new Error('الحساب غير مسجل في النظام، تواصل مع المشرف العام');
  if (profile.role === 'admin') {
    window.location.href = 'admin.html';
  } else {
    window.location.href = `supervisor.html?site=${profile.siteId}`;
  }
}

function logoutUser() {
  auth.signOut().then(() => window.location.href = 'index.html');
}

// حماية الصفحات: يتأكد إن فيه مستخدم مسجل دخول وله الدور المطلوب
function requireRole(expectedRole, onReady) {
  auth.onAuthStateChanged(async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    const profile = await DB.getUserProfile(user.uid);
    if (!profile || profile.role !== expectedRole) {
      alert('ليس لديك صلاحية الدخول لهذه الصفحة');
      window.location.href = 'index.html';
      return;
    }
    onReady(profile);
  });
}
