# TODO — Mizan Apple-style release hardening

- [x] تطبيق نظام حركة GSAP مركزي: انتقالات شاشات scoped، ظهور أقسام خفيف، وتنظيف كامل عند unmount.
  - [x] لا يوجد تعارض بين CSS animation وGSAP.
  - [x] reduced-motion يعرض الحالة النهائية بلا حركة.
  - [x] الحركة لا تؤخر فتح الـ Sheet أو حفظ الحركة.
- [x] تحسين واجهة Apple-style عربية: safe-area، أهداف لمس >= 44px، حالات focus/pressed، dark mode، وتباين واضح.
- [x] تقليل ضغط التخزين المحلي عبر debounce وflush عند مغادرة الصفحة.
- [x] اختبار smoke للمسار: إقلاع، إضافة مصروف، ظهوره في اليوم والسجل، فتح التقرير.
- [x] فحص lint/typecheck/build/test.
- [x] بناء APK Debug بعد مزامنة Capacitor.
- [ ] اختبار Release AAB، Play Console Internal testing، واختبار جهاز حقيقي؛ هذه تحتاج بيئة توقيع/متجر أو جهازًا خارجيًا.
- [ ] مراجعة تحديثات Better Auth الأمنية خارج النطاق الحالي قبل دمجها.
