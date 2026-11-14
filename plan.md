# خطة تطوير Mizan — Apple-style + GSAP + جاهزية النشر

## الهدف
تحويل Mizan إلى تطبيق مالي عربي هادئ وواضح: يبدأ بسرعة، يوضح أهم رقم وهو صافي الشهر، يجعل تسجيل حركة مالية سريعًا، ويستخدم الحركة لتأكيد الانتقال لا لتأخير العمل.

## التصميم المختار
- **Design Movement:** Apple-like grouped finance interface with Arabic-first hierarchy and calm translucency.
- **Core Principles:** وضوح الأولوية، حركة قصيرة قابلة للإلغاء، وصول شامل، وتجاوب آمن مع الحواف.
- **Color Philosophy:** ألوان دلالية محدودة؛ الأخضر للدخل، الأحمر للمصروف، والأزرق للفعل الأساسي، مع متغيرات معنوية للوضع الداكن.
- **Layout Paradigm:** شاشة واحدة مركزة بعنوان كبير، مجموعات متباعدة، وشريط تبويب سفلي ثابت داخل safe area.
- **Signature Elements:** بطاقة صافي الشهر، مجموعات شبيهة بإعدادات النظام، وSheets قابلة للسحب.
- **Interaction Philosophy:** كل فعل أساسي متاح بزر واضح، والـ swipe تحسين اختياري وليس الطريقة الوحيدة.
- **Animation:** GSAP scoped timelines، transform/opacity فقط، 180–420ms، reduced-motion path كامل، بلا حلقات دائمة.
- **Typography:** system Arabic stack مع أحجام 17px للمحتوى و44px أهداف لمس.
- **Brand Essence:** دفتر مالي شخصي سريع وهادئ للعربية؛ واضح، موثوق، عملي.

## التنفيذ
1. تثبيت الاعتمادات وتشغيل typecheck/build/test/lint.
2. إزالة CSS screen-arrive المكرر وترك GSAP مسؤولًا عن انتقال الشاشة.
3. إضافة hooks scoped لظهور الأقسام والصفوف، مع عدم تحريك القوائم الكبيرة بلا داعٍ.
4. تحسين feedback للأزرار والـ Sheets، مع تنظيف GSAP عند unmount.
5. تحسين تخزين Zustand لتقليل الكتابة المتكررة إلى localStorage.
6. إضافة مسار اختبار تفاعلي من الإقلاع إلى إضافة مصروف وتعديله وتصديره.
7. اختبار mobile viewport، reduced motion، dark mode، وإعادة mount.
8. إصلاح الأخطاء المؤكدة فقط ثم بناء Android Debug للتحقق النهائي.

## حدود الاختبار
اختبار Play Store، الإعلانات الحقيقية، وتثبيت Release AAB يتطلب جهازًا أو Emulator وحساب نشر فعليًا؛ لن تُدّعى جاهزيتها دون هذه الأدلة.
