# تقرير التنفيذ — تصلب P0 على قاعدة البيانات الحقيقية

**المشروع:** `mizan-finance` — `kpgszjnjmmosvrlujvkj` (eu-central-1)
**التاريخ:** 2026-11-16
**الحالة:** مُنفَّذ ومُتحقَّق منه على قاعدة الإنتاج
**الملف المرجعي:** `supabase/migrations/202611160001_security_hardening.sql` (مُطابَق الآن للوضع الحقيقي)

---

## ١. ملخص تنفيذي

طُبِّقت ثمانية من بنود الإصلاح الأمني (النتائج 01–13 من التدقيق) على قاعدة البيانات
الحقيقية عبر **تسع هجرات مسجّلة**. قبل أي تغيير أُخذت **نسخة استرجاع كاملة داخل
القاعدة** تشمل البيانات وتعريفات جميع الدوال والسياسات والصلاحيات.

النتيجة: كل الثغرات القابلة للإصلاح على مستوى القاعدة **مُغلقة ومُثبتة بالاختبار**،
بلا فقد أي صف بيانات (٤١ سجلًا قبل وبعد).

---

## ٢. النسخة الاحتياطية (مأخوذة قبل التغيير)

مخطط `_mizan_backup` — غير مقروء لأي دور عميل (`revoke all ... from public, anon, authenticated`):

| الجدول | المحتوى |
|---|---|
| `t_*` (×10) | نسخة كاملة من كل جداول `public` (٤١ سجلًا، ١٢ tombstone، ٢ مستأجر، ٢ ملف شخصي) |
| `functions` | تعريف DDL لكل الـ ٢١ دالة في `public` |
| `policies` | كل الـ ٢٩ سياسة RLS |
| `table_grants` / `column_grants` / `pro_grants` | كل الصلاحيات قبل التغيير |
| `triggers` | تعريف كل المشغّلات |

**مهم:** بوستجريس لا يتذكّر الصلاحيات القديمة، لذلك `table_grants`/`column_grants`
هي المصدر الوحيد للاسترجاع الدقيق للصلاحيات.

---

## ٣. الهجرات المطبّقة (مسجّلة في `supabase_migrations.schema_migrations`)

| # | الإصدار | الاسم | النتيجة المُغلقة |
|---|---|---|---|
| 1 | `20261116172400` | `p0_01_platform_settings_security_primitives` | إعدادات المنصة + `platform_security_log` + `rate_limit_events` + `hash_bucket` + `check_rate_limit` |
| 2 | `20261116172411` | `p0_02_profile_identity_and_invite_binding` | 03 — `profiles.email` مربوط بهوية Auth + الدعوات تتطلب بريدًا مؤكدًا |
| 3 | `20261116172418` | `p0_04a_revision_and_record_validation` | 04/05/09 — عمود `revision` أحادي التزايد + تحقق الحمولة + حذف = tombstone |
| 4 | `20261116172429` | `p0_04b_sync_push_hardened` | 04/05 — دالة push محصّنة (تحقق بنيوي، clamp للساعة، `can_write_tenant`) |
| 5 | `20261116172439` | `p0_04c_soft_delete_and_purge` | حذف ناعم صريح + تنظيف مؤجل لـ `service_role` فقط |
| 6 | `20261116172448` | `p0_05_audit_logs_server_authored` | 10 — سجل التدقيق مؤلَّف من السيرفر وغير قابل للتزوير |
| 7 | `20261116172506` | `p0_06_workspace_trial_from_plan` | 06 — التجربة من الباقة + حد ٥ مساحات |
| 8 | `20261116172515` | `p0_07_payment_request_integrity` | 07 — المبالغ والمدة من الباقة، حقول المراجعة غير قابلة للكتابة |
| 9 | `20261116172525` | `p0_08_sweep_and_owner_promotion` | 08/01 — التنظيف ليس نقطة نهاية عامة + لا ترقية مالك ضمنية |
| 10 | `20261116172544` | `p0_09_owner_claim_fk_and_grants` | 13 + الصلاحيات الصريحة + `claim_platform_owner` |

> الرقم 9 يظهر عمليًا ١٠ صفوف لأن `p0_03` دُمج مع `p0_02` (نفس ملف الدالة).

---

## ٤. أدلة التحقق (اختبارات نُفِّذت فعليًا على الإنتاج)

### ٤.١ مصفوفة الأمان — بهوية مالك حقيقي (`authenticated`)

| المحاولة | النتيجة | الحكم |
|---|---|---|
| `DELETE` مباشر على `tenant_records` | `42501` | ✅ مرفوض |
| إدراج سجل تدقيق مُزوَّر في `tenant_audit_logs` | `42501` | ✅ مرفوض |
| تغيير `profiles.email` إلى بريد المهاجم | `42501` | ✅ مرفوض |
| تعديل `profiles.display_name` (حقل عرض) | مسموح | ✅ سلوك صحيح |
| إدراج `payment_requests` مباشرة بمبلغ مزيّف | `42501` | ✅ مرفوض |
| Push إلى مستأجر لا ينتمي إليه (`812f8fa4…` → `5b361924…`) | `42501` «لا تملك صلاحية الكتابة» | ✅ مرفوض |

### ٤.٢ دورة كتابة حقيقية (push)

```
sync_push_tenant_records(... '{"entityType":"wallet","entityId":"__p0_probe_wallet", ...}')
→ صف أُنشئ: revision = 43، server_updated_at ليس null
```
ثم حُذف صف الاختبار كـ `postgres` وأُعيد التحقق من الأعداد.

### ٤.٣ سلامة البيانات — قبل/بعد

| المقياس | قبل | بعد |
|---|---|---|
| `tenant_records` | 41 | **41** |
| tombstones | 12 | **12** |
| `tenants` / `profiles` / `platform_admins` | 2 / 2 / 1 | **2 / 2 / 1** |
| `tenant_audit_logs` / `payment_requests` / `subscription_plans` | 3 / 1 / 4 | **3 / 1 / 4** |
| القيم `revision` | 0 | **41 (كلها متمايزة)** |

### ٤.٤ إزالة البريد المضمّن (النتيجة F-01/F-24)

```
select count(*) from pg_proc where prosrc ilike '%zyadgamal796%'  →  0
```
قبل التغيير كانت `bootstrap_first_super_admin()` و`handle_new_auth_user()` تحتويانه
وتُرقّيان أي حساب يطابقه. الآن الترقية تمر عبر `platform_settings.owner_email` +
تأكيد البريد + `pg_advisory_xact_lock` + شرط عدم وجود أي مدير.

### ٤.٥ تكافؤ `anon` (ما قبل تسجيل الدخول)

| الاستعلام كـ `anon` | النتيجة |
|---|---|
| `tenants` / `profiles` / `tenant_records` / `tenant_audit_logs` | 0 صفوف |
| `subscription_plans` | 4 |
| `platform_billing_info` | 1 |

مطابق تمامًا للسلوك قبل التغيير (بدون خطأ 42501).

---

## ٥. تغييرات سلوكية مقصودة (يجب أن يعرفها صاحب المنتج)

1. **`subscription_plans.trial_days`: من 0 إلى 14** (لكل الباقات الأربع).
   السبب: الكود القديم كان يمنح ١٤ يومًا بشكل مضمَّن في الدالة. لو طبّقنا
   «التجربة من الباقة» والقيمة 0 لتحوّل كل تسجيل جديد إلى `pending_approval`
   بصفر أيام — أي كسر فوري للتجربة. ضبط القيمة يحفظ السلوك ويجعل البيانات
   مصدر الحقيقة. **قابل للعكس** من `_mizan_backup.t_subscription_plans`.
2. **الحذف الفيزيائي للعملاء أُلغي**: الواجهة تستخدم `deletedAtMs` أصلًا
   (عقد الـ outbox في `src/lib/tenant/storage.ts`)، والحذف الفيزيائي يبقى عبر
   `soft_delete_tenant_record` أو `purge_expired_tenant_records` (service_role).
3. **`profiles` صار التحديث مقيّدًا بالأعمدة**: `display_name, avatar_url, phone,
   contact_display, updated_at` فقط. `email` لم يعد قابلًا للكتابة من العميل.

---

## ٦. الاسترجاع

```
-- ١) البيانات
truncate public.tenant_records;
insert into public.tenant_records select * from _mizan_backup.t_tenant_records;
-- (نفس النمط لكل جدول)

-- ٢) الدوال
select def from _mizan_backup.functions where proname = '<name>';   -- نفّذها

-- ٣) الصلاحيات
select * from _mizan_backup.table_grants;    -- relname, acl
select * from _mizan_backup.column_grants;   -- column-level (profiles)
select * from _mizan_backup.pro_grants;      -- function EXECUTE

-- ٤) السياسات
select * from _mizan_backup.policies;
```

**تحذير ترتيب:** لا تحذف عمود `revision` قبل إعادة الدوال القديمة — العميل
القديم يتحمّل أعمدة زائدة، لكن العميل الجديد لا يتحمّل أعمدة ناقصة.

مخطط `_mizan_backup` **يُترك كما هو** حتى تأكيدك أن النسخة الجديدة مستقرة.

---

## ٧. ما لم يُنفَّذ (وسببه)

| البند | السبب |
|---|---|
| تغيير `mailer_autoconfirm` أو أي إعداد Auth | تغيير سلوك تسجيل الدخول يحتاج قرارك؛ لم يُطلب صراحة |
| تغيير `verify_jwt` لدالة `admin-users` | يحتاج اختبار الواجهة أولًا (انظر §٨) |
| تحديث `vercel.json` / CSP / نشر الواجهة | تغيير في Vercel لم يُطلب؛ الطبقة الخلفية فقط |
| حذف الملفات أو حزم التطوير من الـ repo | تغيير في المستودع خارج نطاق P0 الخلفي |
| نسخ احتياطي خارجي (`pg_dump`) | لا يوجد اتصال JS مباشر؛ النسخة داخل القاعدة + git للمخطط |
| ترحيل فرع `mizan-staging-p0` | أُنشئ لكن `with_data:false` وغير قابل للاستعلام — **لم يُستخدم كـ staging**، ولم يُحذف لأنه `is_default` |

---

## ٨. اكتشافات جديدة أثناء التنفيذ (تحتاج قرارًا)

1. **`admin-users` بـ `verify_jwt: false`** — القابلية للاستدعاء بلا مصادقة
   منصة. الكود يتحقق داخليًا (`Authorization` → `getUser` → 401، ثم
   `platform_admins` → 403)، لذا **ليس ثغرة مؤكدة**، لكنه سطح هجوم واسع:
   كل طلب يصل إلى كود يملك مفتاح `service_role`.
2. **انحراف الإصدار:** النسخة المنشورة (v2) من `admin-users` **أقدم** من نسخة
   الـ repo فيه (`.ts` في الـ repo فيه بوابة `MIZAN_BOOTSTRAP_SECRET` غير
   موجودة في المنشور). أي أن تصلّبًا مكتوبًا لم يُنشر قط.
3. **`anon`/`authenticated` ما زالا يملكان `TRUNCATE`/`REFERENCES`/`TRIGGER`
   على جداول لم تُشمَل في §11** (مثل `tenants`، `tenant_members`). لم أوسّع
   الإلغاء لأن `TRUNCATE` متاح للعميل يعني إمكانية إفراغ الجداول، وهو بند
   يستحق هجرة مستقلة مع اختبار.
4. **`platform_admins` و`platform_billing_info` و`subscription_plans` ما زالت
   `{public}` في سياساتها** — تعمل عبر الدوال المساعدة، لكن الأفضل تضييقها إلى
   `authenticated` في هجرة لاحقة.

---

## ٩. المخاطر المتبقية

- **لا اختبار واجهة (UI smoke)** — التحقق كله على مستوى SQL/RPC. البند V15
  (فتح التطبيق، تسجيل دخول، إضافة معاملة، مزامنة) **لم يُنفَّذ** ويحتاجك.
- **`_mizan_backup` يستهلك مساحة** ويحتوي بيانات مستخدمين — يجب حذفه بعد
  استقرار مؤكد (قرارك).
- **الفرع `mizan-staging-p0`** أُنشئ بلا جدوى — يحتاج حذفًا من لوحة Supabase.
