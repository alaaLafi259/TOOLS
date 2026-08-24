// ============================================
// نظام الثيمات (فاتح / داكن) - يُحفظ في المتصفح فقط
// ============================================
(function () {
  const saved = localStorage.getItem('toolsAppTheme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);

  window.toggleAppTheme = function () {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('toolsAppTheme', next);
    updateThemeBtnLabel(next);
  };

  function updateThemeBtnLabel(theme) {
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.textContent = theme === 'dark' ? '☀️ الوضع الفاتح' : '🌙 الوضع الداكن';
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateThemeBtnLabel(saved);
  });
})();
