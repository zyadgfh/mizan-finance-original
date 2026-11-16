# معالجة تقرير التدقيق الأمني — ميزان

**التاريخ:** 16 نوفمبر 2026
**الفرع:** `arena/30ddba63-mizan-finance-original`
**مرجع التدقيق:** مراجعة ساكنة للكود عند `375dede`
**حالة التنفيذ:** تم تنفيذ الإصلاحات في الكود والمخططات والإعدادات. الخطوات التي تحتاج لوحة تحكم Supabase أو أسرار المشروع موضّحة في القسم 8، ولم تُنفَّذ من داخل المستودع.

---

## 1. ملخص ما تغيّر

| الطبقة | الملفات |
| --- | --- |
| قاعدة البيانات | `supabase/migrations/202611160001_security_hardening.sql` (مخطط جديد) |
| Edge Function | `supabase/functions/admin-users/index.ts` (إعادة كتابة مسارات التهيئة والتسجيل والتحقق) |
| العميل | `src/lib/tenant/api.ts`, `src/lib/tenant/context.tsx`, `src/components/finance/auth-screen.tsx` |
| تشفير محلي | `src/lib/finance/pin.ts`, `src/lib/sync/crypto-backup.ts` + تحديث مواضع الاستخدام |
| أندرويد | `MainActivity.java`, `AndroidManifest.xml`, `res/xml/data_extraction_rules.xml`, `res/xml/backup_rules.xml` |
| CI/CD والنشر | `.github/workflows/android-apk.yml`, `.github/workflows/supabase-migrations.yml`, `vercel.json`, `supabase/config.toml` |
| الاختبارات | `src/lib/finance/pin.test.ts`, `src/lib/sync/crypto-backup.test.ts`, `scripts/supabase-migrations.test.mjs` |

**مبدأ التصميم المطبَّق:** كل ما يخص الهوية والصلاحيات والمال والتوقيت يُشتق من الخادم، والعميل لا يكتب أعمدة أمنية مباشرة.

---

## 2. حالة كل نتيجة

| # | النتيجة | الخطورة | الحالة | ما تم فعليًا |
| --- | --- | --- | --- | --- |
| 01 | استيلاء محتمل على حساب المالك | Critical | ✅ مُصلح | سر تهيئة أحادي الاستخدام + دالة ذرية + منع تغيير كلمة مرور حساب قائم |
| 02 | هويات بريد/هاتف غير موثقة | High | ✅ مُصلح | لا `email_confirm: true` تلقائي + إرسال رابط تحقق + منع الدخول قبل التأكيد |
| 03 | تجاوز الدعوات بتعديل `profiles.email` | High | ✅ مُصلح | Trigger يثبّت البريد من `auth.users` + منح أعمدة محدود + مقارنة الدعوة بالبريد الموثق |
| 04 | تسميم المزامنة بتوقيت مستقبلي | High | ✅ مُصلح | تقييد/قصّ انحراف الساعة + `revision` متزايد من الخادم |
| 05 | حذف صلب يتجاوز Tombstones | High | ✅ مُصلح | سحب `DELETE` + سياسة `using(false)` + RPC حذف منطقي + وظيفة تنظيف مؤجلة |
| 06 | مدة تجريبية لا تطابق الباقة | High | ✅ مُصلح | `trial_days` من جدول الباقات + حد أقصى للمساحات + رفض الباقة غير النشطة |
| 07 | تلاعب بمدة/مبلغ طلب الدفع | High | ✅ مُصلح | منع الإدخال المباشر + Trigger يشتق السعر والمدة من الباقة + إعادة حساب عند الاعتماد |
| 08 | `enforce_expired_subscriptions` متاحة لـ anon | Medium/High | ✅ مُصلح | سحب EXECUTE عن `anon`/`authenticated` + غلاف إداري + جدولة |
| 09 | فقد سجلات في Pagination | High | ✅ مُصلح | مؤشر `rev:<n>` + قراءة كل الصفحات بحد صريح |
| 10 | تزوير سجلات التدقيق | High | ✅ مُصلح | سجلات تُكتب عبر RPC فقط + قائمة أحداث مسموحة + منع التعديل والحذف |
| 11 | غياب Rate Limiting | High | ✅ مُصلح | عدّاد نوافذ زمنية في قاعدة البيانات + تطبيقه على المسارات الحساسة |
| 12 | تحقق JSONB غير كافٍ | Medium | 🟡 مُحسَّن جزئيًا | نوع الكيان + الحجم + المعرّف + حد الدفعة + حدود النسخ الاحتياطية (ما زال يحتاج Schema لكل كيان) |
| 13 | تنظيف فاشل غير ذري | Medium | ✅ مُصلح | تنظيف تعويضي مرتب + تسجيل الأعطال + مفاتيح أجنبية `on delete` مناسبة |
| 14 | PIN بـ SHA-256 فقط | Medium | ✅ مُصلح | PBKDF2‑SHA256 + Salt لكل جهاز + ترقية تلقائية + تهدئة محاولات |
| 15 | Iterations غير محدودة | Medium | ✅ مُصلح | نطاق 100k–1M + تحقق من Salt/IV/Ciphertext وأحجامها |
| 16 | لا دليل على E2EE | Medium/High | 📝 موثّق | لا توجد ادعاءات E2EE في الواجهة؛ النموذج موضّح أدناه (لم يُنفَّذ E2EE) |
| 17 | إعدادات Backup في أندرويد | Medium | ✅ مُصلح | `allowBackup=false` + قواعد استبعاد لكل النطاقات |
| 18 | WebView + JavaScript Bridge | Medium | ✅ مُصلح | منع `file://` وMixed Content + فحص الأصل لكل استدعاء + تحقق من الروابط العميقة |
| 19 | حماية الفرع وسلسلة CI/CD | Operational | ✅ مُصلح | تثبيت Actions بـ SHA + أقل صلاحيات + فشل مغلق للتوقيع + إزالة سر المفتاح بعد البناء |
| 20 | لا مسار آلي لتطبيق Migrations | Operational | ✅ مُصلح | Workflow `supabase-migrations.yml` مع سجل وChecksum |

---

## 3. أهم التغييرات بالتفصيل

### 3.1 تهيئة مالك المنصة (01)

- `setup_owner` صار يتطلب `MIZAN_BOOTSTRAP_SECRET` (32 حرفًا على الأقل) بمقارنة زمنية ثابتة، ويفشل مغلقًا (503) إذا لم يُضبط السر.
- لا يوجد أي مسار يغيّر كلمة مرور حساب موجود؛ إن كان البريد مسجّلًا يُعاد إرسال رابط التحقق فقط.
- الترقية إلى `platform_admins` تتم عبر `claim_platform_owner()` التي تستخدم `pg_advisory_xact_lock` وتتحقق من: عدم وجود مالك سابق، تطابق البريد مع `platform_settings.owner_email`، ووجود مستخدم Auth مطابق. أي محاولة ثانية تفشل.
- تم حذف الترقية التلقائية لأول مستخدم (`handle_new_auth_user`) و`bootstrap_first_super_admin`.
- الترقية التلقائية الوحيدة المتبقية تحدث عند **تأكيد البريد** المطابق لمالك المنصة (`promote_verified_platform_owner`)، فلا يمكن حجز الهوية ببريد غير مؤكد.

### 3.2 التحقق من الهوية (02)

- كل حسابات التسجيل الذاتي تُنشأ بـ `email_confirm: false`، ويُرسل رابط التحقق عبر Supabase Auth (`/auth/v1/resend`).
- `registerNewSubscriberWithPayment` لم يعد يسجّل الدخول تلقائيًا؛ يُرجع حالة «بانتظار تأكيد البريد».
- تسجيل رقم الهاتف يتطلب بريدًا إلكترونيًا حقيقيًا للتحقق؛ رقم الهاتف يبقى وسيلة تواصل وليس هوية موثقة.
- شاشة الدخول تكتشف `EmailNotVerifiedError` وتعرض زر «إعادة إرسال رابط التأكيد».
- **مطلوب في Supabase Dashboard:** تفعيل *Confirm email* وضبط SMTP، وإلا لن تُسلَّم رسائل التحقق.

### 3.3 الدعوات والبريد (03)

- Trigger `guard_profile_identity_columns` يجعل `profiles.email` دائمًا مطابقًا لـ `auth.users.email`.
- سُحبت صلاحية `UPDATE` على مستوى الجدول عن `anon/authenticated` ومُنحت أعمدة العرض فقط (`display_name`, `avatar_url`, `phone`, `contact_display`, `updated_at`).
- `redeem_tenant_invite` تقارن `tenant_invites.email` مع بريد Auth **الموثّق** وتشترط `email_confirmed_at` قبل القبول.

### 3.4 المزامنة (04، 09)

- عمود `revision bigint` مع تسلسل، يُعاد توليده في كل كتابة (Trigger)، وفهرس `(tenant_id, revision)`.
- `sync_push_tenant_records` يقصّ أي توقيت يتجاوز الآن بـ 5 دقائق، ويرفض القيم السالبة أو غير الرقمية، ويحدّ الدفعة بـ 200 عملية و256KB للسجل.
- العميل يقرأ الصفحات بـ `revision > cursor` بحد 500 سجل لكل صفحة وحتى 40 صفحة، ولا يحفظ المؤشر إلا بعد معالجة الصفحات، مع دعم مؤشرات ISO القديمة (يُعاد قراءتها بشكل شامل لتجنّب أي فقد).

### 3.5 الحذف والتدقيق (05، 10)

- سُحبت صلاحية `DELETE` عن `authenticated` وسياسة الحذف صارت `using (false)`.
- الحذف صار Tombstone عبر `sync_push_tenant_records` أو `soft_delete_tenant_record`، مع تدقيق تلقائي.
- `purge_expired_tenant_records` تحذف فعليًا بعد 90 يومًا (افتراضيًا) وتُستدعى بـ `service_role` فقط.
- سجلات التدقيق: ممنوع الإدخال المباشر، والكتابة عبر `log_tenant_audit_event` التي تشتق المنفذ من الجلسة وتتحقق من قائمة أحداث مسموحة، وممنوع التعديل/الحذف.

### 3.6 الاشتراكات والمدفوعات (06، 07، 08)

- `create_tenant_workspace` تأخذ `trial_days` من الباقة، ترفض الباقة غير النشطة أو غير المؤكدة البريد، وتحدّ الملكية بـ 5 مساحات.
- جدول `payment_requests`: لا إدخال للعميل، والـ Trigger يفرض السعر والمدة من الباقة، وإعادة الحساب عند الاعتماد تعتمد `duration_days` الخاصة بالباقة فقط.
- `enforce_expired_subscriptions` لم تعد قابلة للتنفيذ إلا من `service_role`؛ الإدارة تستخدم `admin_enforce_expired_subscriptions()`.

### 3.7 التشفير المحلي والنسخ الاحتياطية (14، 15)

- `pin.ts`: PBKDF2‑SHA256 بـ 210k دورة وSalt عشوائي 16 بايت لكل جهاز، مع تهدئة تصاعدية للمحاولات (5s → 15s → 60s → 5min) وترقية شفافة للسجلات القديمة.
- `crypto-backup.ts`: نطاق Iterations 100k–1M، تحقق من طول Salt/IV، حد 32MB للنص بعد الفك و64MB للـ ciphertext، ورفض الإصدارات والخوارزميات غير المعروفة.
- **تنبيه:** PIN قفل واجهة فقط؛ البيانات ليست مشفّرة به.

### 3.8 أندرويد (17، 18)

- `allowBackup=false` + `dataExtractionRules` و`backup_rules` يستبعدان كل النطاقات.
- `usesCleartextTraffic=false`، منع `file://` و`AllowUniversalAccessFromFileURLs`، `MIXED_CONTENT_NEVER_ALLOW`، تعطيل Geolocation وSaveFormData، تفعيل Safe Browsing.
- كل دالة في `MizanNativeBridge` تتحقق من أن الصفحة الحالية `https` على `localhost`/`127.0.0.1`/`mizan-finance-rho.vercel.app` قبل التنفيذ.
- الروابط العميقة تُقبل فقط من مخطط التطبيق أو مضيف الإنتاج.

### 3.9 CI/CD والنشر (19، 20)

- تثبيت `actions/checkout`, `setup-node`, `setup-java`, `upload-artifact` على SHA، و`permissions: contents: read` على مستوى الـ workflow مع تضييق على مستوى الـ job، و`persist-credentials: false`.
- التوقيع يفشل مغلقًا: إن وُجد الـ keystore بدون كلمات مرور يفشل البناء، وإن غاب يُبنى APK تجريبي بمفتاح عشوائي مؤقت **ولا يُنشر إصدار**.
- إزالة مادة المفتاح في خطوة `always()`، وتوليد كلمة مرور عشوائية بدلًا من كلمة مرور ثابتة.
- Workflow جديد لتطبيق `supabase/migrations` مع جدول `_mizan_schema_migrations` وChecksum ورفض التشغيل بدون `SUPABASE_DB_URL`.
- `vercel.json`: `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS, COOP.

---

## 4. الضمانات التي تتحقق منها الاختبارات

`scripts/supabase-migrations.test.mjs` يبني قاعدة PostgreSQL مدمجة (PGlite) بنفس شكل Supabase (أدوار + `auth.users` + منح افتراضية) ويطبّق كل المخططات ثم يتحقق من:

1. ثبات `profiles.email` ومنع تعديله من العميل.
2. عدم منح فترة تجريبية للباقة `trial_days = 0`، ورفض غير المؤكد بريديًا، وحد المساحات.
3. ربط الدعوات بالبريد الموثّق، ورفض غير المؤكد.
4. عمل Rate Limiting.
5. منع إدخال طلبات الدفع من العميل واشتقاق السعر والمدة من الباقة.
6. قصّ التوقيت المستقبلي، زيادة `revision`، رفض العمليات غير الصالحة، ومنع غير الأعضاء.
7. منع الحذف الصلب وتطبيق Tombstones.
8. تدقيق مكتوب من الخادم، بقائمة أحداث، وغير قابل للتعديل.
9. سحب صلاحية Sweep عن العملاء وعدم وجود ترقية ضمنية.
10. ذرية `claim_platform_owner` وأحادية استخدامه.
11. عدم قابلية دوال الصلاحيات للتنفيذ من `anon`.

اختبارات إضافية: `src/lib/finance/pin.test.ts` و`src/lib/sync/crypto-backup.test.ts`.

تشغيلها:

```bash
npm run typecheck && npm run lint && npm test
```

---

## 5. ما لم يُغيَّر (مخاطر متبقية)

1. **E2EE غير منفَّذ.** السجلات والإيصالات مشفّرة أثناء النقل وفي التخزين لدى المزوّد، لكن الخادم يستطيع قراءتها. واجهة التطبيق لا تدّعي تشفيرًا من طرف إلى طرف. تنفيذ E2EE الفعلي يحتاج تصميم إدارة مفاتيح ومشاركة داخل المساحة، ويجب أن يسبقه قرار منتج.
2. **Schema كل كيان.** ما زال التحقق من `payload` بنيويًا (نوع + حجم + معرّف) وليس بمخطط كامل لكل `entity_type`.
3. **Android WebViewClient.** لم يُستبدل `BridgeWebViewClient` الخاص بـ Capacitor (استبداله يكسر الجسر). الحماية الحالية: منع أصول غير موثوقة + تعطيل `file://`. أي XSS داخل أصل موثوق يمكنه استدعاء الجسر كما هو متوقع.
4. **CSP.** لم تُضف سياسة `Content-Security-Policy` كاملة تفاديًا لكسر التطبيق وإطار المعاينة؛ يمكن إضافتها لاحقًا بعد جرد المصادر.
5. **Rate limiting للدخول.** محاولات الدخول نفسها تُدار بواسطة Supabase Auth (حدود GoTrue)، ولم يُضف عدّاد إضافي حولها.

---

## 6. خطوات مطلوبة خارج المستودع (Dashboard / Secrets)

### Supabase

1. **Auth → Providers → Email:** تفعيل *Confirm email*، وضبط SMTP/Resend حتى تُسلَّم رسائل التحقق.
2. **Auth → URL Configuration:** إضافة `https://mizan-finance-rho.vercel.app` وروابط المعاينة إلى Redirect URLs.
3. **Edge Functions → Secrets:**
   - `MIZAN_BOOTSTRAP_SECRET` = قيمة عشوائية ≥ 32 حرفًا (`openssl rand -base64 48`).
   - `MIZAN_ALLOWED_ORIGINS` (اختياري) = أصول إضافية مفصولة بفواصل.
   - `MIZAN_APP_URL` (اختياري) = رابط إعادة التوجيه بعد التأكيد.
4. **Edge Functions → Deploy:** نشر `admin-users` مع `verify_jwt = false` كما في `supabase/config.toml` (التحقق من الجلسة يتم داخل الدالة).
5. **Database:** تطبيق المخططات عبر Workflow الجديد بعد إضافة السر `SUPABASE_DB_URL` (أو `psql` يدويًا بنفس الترتيب).
6. **pg_cron:** جدولة `select public.enforce_expired_subscriptions();` كل 5 دقائق بدور مرتفع الصلاحية (الدالة لم تعد متاحة للعملاء).
7. **Storage:** التأكد من أن Bucket `mizan-payment-proofs` غير عام، وسياساته مطبّقة.

### GitHub

1. تفعيل Ruleset على `main`: منع force-push والحذف، وطلب PR ومراجعة، وتشغيل الفحوصات.
2. تفعيل Secret scanning وDependabot وCodeQL.
3. الأسرار المطلوبة: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `SUPABASE_DB_URL`.
4. لا تضع `MIZAN_BOOTSTRAP_SECRET` في GitHub؛ مكانه أسرار Edge Functions فقط.

### Vercel

- إضافة متغيرات Supabase العامة (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) إن لم تكن موجودة، والتأكد من أن النشر يستخدم `vercel.json` الجديد.

---

## 7. قائمة تحقق قبل الإنتاج

- [ ] تفعيل *Confirm email* واختبار وصول رابط التحقق فعليًا.
- [ ] تهيئة المالك مرة واحدة باستخدام السر، ثم تأكيد البريد، ثم الدخول.
- [ ] التأكد من أن `SELECT count(*) FROM platform_admins` = 1.
- [ ] تطبيق المخططات على Staging وتشغيل `npm test`.
- [ ] اختبار مزامنة جهازين مع تعديلات متزامنة وقيود الشبكة.
- [ ] التحقق من رفض حذف السجلات من واجهة Supabase REST بدور `authenticated`.
- [ ] التحقق من أن `enforce_expired_subscriptions` تُرفض بـ `42501` لمستخدم عادي.
- [ ] بناء APK موقّع بمفتاح الإصدار والتأكد من `allowBackup=false` في الـ manifest النهائي.
- [ ] مراجعة سجلات `platform_security_log` و`rate_limit_events` بعد اختبارات التحميل.
