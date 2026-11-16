# ميزان المالية — Mizan Finance (v2.0)

منصة إدارة مالية شخصية وعائلية وتجارية متعددة المساحات (**Offline-First Multi-Tenant Personal & Business Finance Platform**) تدعم العربية والإنجليزية بالكامل (`RTL` / `LTR`) وتعمل عبر الويب وتطبيق أندرويد أصلي (`APK`).

---

## الروابط المباشرة | Live Links

- **تطبيق الويب (Vercel Production):** [https://mizan-finance-rho.vercel.app](https://mizan-finance-rho.vercel.app)
- **تحميل تطبيق الأندرويد الموقّع (Signed Release APK):** [mizan-finance-release.apk (Latest Release)](https://github.com/zyadgfh/mizan-finance-original/releases/latest/download/mizan-finance-release.apk)

---

## أبرز المميزات | Key Capabilities

1. **إدارة حسابات حصرية للمالك (Owner-Only Provisioning):**
   - التسجيل العام مغلق بالكامل على مستوى واجهة المستخدم وخادم المصادقة (`Supabase Auth`).
   - مالك المنصة فقط (`Super-Admin`) ينشئ حسابات المستخدمين الجدد، يولّد كلمات المرور المؤقتة أو يرسل روابط التعيين، ويتحكم في تفعيل وإيقاف المساحات والاشتراكات من لوحة `/admin`.
2. **تعدد المساحات والعمل بدون إنترنت (Offline-First Multi-Tenancy):**
   - تخزين محلي فوري عبر `IndexedDB` مع طابور مزامنة ذكي يرفع التعديلات تلقائياً إلى `Supabase Postgres` فور عودة الاتصال.
3. **مزامنة سحابية مشفرة للإيصالات والفواتير (Cloud Receipt Sync):**
   - ضغط الصور على الجهاز ورفعها تلقائياً إلى سلة خاصة (`mizan-receipts`) معزولة بسياسات `RLS` لكل مساحة عمل (`{tenant_id}/{receipt_id}`).
4. **بوابة تأكيد وموافقات الدفع اليدوي (InstaPay / Vodafone Cash):**
   - إرسال طلبات تجديد الاشتراك مرفقة بصورة التحويل ورقم المرجع ومراجعتها واعتمادها بضغطة واحدة من لوحة المالك.
5. **تعدد العملات والتحليلات الذكية والخصوصية:**
   - تجميد سعر الصرف التاريخي لكل معاملة، قفل التطبيق برمز `PIN` أو البصمة البيومترية (`WebAuthn`), وتصدير/استيراد النسخ الاحتياطية المشفرة (`AES-GCM 256-bit`) وملفات `CSV`.

---

## التشغيل المحلي والاختبار | Local Development

```bash
# تثبيت الحزم
npm ci

# تشغيل خادم التطوير المحلي (المنفذ 8080)
npm run dev

# فحص الأنواع وجودة الكود والاختبارات
npm run typecheck
npm run lint
npm test

# بناء نسخة الإنتاج للويب
npm run build

# بناء ومزامنة حزمة الأندرويد (Capacitor)
npm run cap:sync
```

---

## الأمان | Security

- **التحقق من الهوية إلزامي:** لا يُنشأ حساب قابلاً للاستخدام قبل تأكيد البريد الإلكتروني (`Supabase Auth → Confirm email` يجب أن يكون مفعّلًا مع SMTP). تسجيل رقم الهاتف يتطلب بريدًا إلكترونيًا للتحقق.
- **تهيئة مالك المنصة:** تتم مرة واحدة عبر سر خادمي `MIZAN_BOOTSTRAP_SECRET` (32 حرفًا على الأقل) ولا يوجد أي مسار يغيّر كلمة مرور حساب قائم.
- **الصلاحيات:** كل الأعمدة الأمنية (حالة الاشتراك، المبالغ، سجلات التدقيق، الهوية) تُشتق من الخادم؛ العميل لا يكتبها مباشرة.
- **المزامنة:** ترتيب التعديلات يعتمد على `revision` متزايد من الخادم مع تقييد انحراف الساعة، والحذف يتم كـ Tombstone فقط.

المرجع الكامل: **[docs/security-remediation-2026-11-16.md](docs/security-remediation-2026-11-16.md)** — يتضمن جدول حالة كل نتيجة، والخطوات المطلوبة في Supabase/GitHub/Vercel قبل الإنتاج، والمخاطر المتبقية المعروفة.

### متغيرات/أسرار مطلوبة

| الاسم | المكان | الغرض |
| --- | --- | --- |
| `MIZAN_BOOTSTRAP_SECRET` | أسرار Edge Functions | تهيئة مالك المنصة (أحادي الاستخدام) |
| `MIZAN_ALLOWED_ORIGINS` | أسرار Edge Functions (اختياري) | أصول إضافية مسموحة لاستدعاء الدوال |
| `MIZAN_APP_URL` | أسرار Edge Functions (اختياري) | رابط إعادة التوجيه بعد تأكيد البريد |
| `SUPABASE_DB_URL` | أسرار GitHub | تطبيق مخططات `supabase/migrations` تلقائيًا |
| `ANDROID_KEYSTORE_*` | أسرار GitHub | توقيع إصدارات APK (بدونها لا يُنشر إصدار) |

