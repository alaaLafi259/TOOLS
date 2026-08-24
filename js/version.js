// رقم إصدار النظام - يتحدث مع كل تحديث حقيقي بالكود
// لو شفت الرقم ده اتغير بعد الرفع، يبقى التحديث وصل فعلاً
const APP_VERSION = "1.5.0";

document.addEventListener('DOMContentLoaded', () => {
  const badge = document.createElement('div');
  badge.id = 'versionBadge';
  badge.textContent = 'الإصدار ' + APP_VERSION;
  document.body.appendChild(badge);
});
