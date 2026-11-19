# Z-Ai — Legacy Feature → New Component Migration Map

Every numbered feature in the task's "نقل وظائف الملف الحالي" list, mapped to
where it lives now. Nothing was dropped without a replacement.

| # | Legacy feature (avetaar-ai-chat.html) | New component / module |
|---|---|---|
| 1 | إنشاء محادثة جديدة | `Sidebar.tsx` "محادثة جديدة" button → `store.newChat()` |
| 2 | قائمة المحادثات + بحث + تصفية + مجموعات | `Sidebar.tsx` (search box, pin sort) + `Chat.groupName` field (Prisma) + `ChatActionsMenu` "تغيير المجموعة" |
| 3 | إعادة تسمية / تكرار / تثبيت / حذف / استرجاع | `ChatActionsMenu.tsx` + `store.ts` (renameChat/duplicateChat/togglePinChat/deleteChat/restoreChat) + `TrashSheet.tsx` |
| 4 | نموذج اختيار النماذج (بحث/مفضلة/وسوم) | `ModelPicker.tsx` (tabs, search, favorites, info card) + `models.ts` catalog |
| 5 | بث الردود + زر إيقاف | `App.tsx::runAssistant` (AbortController) + `Composer.tsx` stop button; production wiring in `messages.controller.ts` (SSE) |
| 6 | إعادة توليد الرد | `MessageItem.tsx` "إعادة التوليد" + `MessageActionsMenu` | 
| 7 | تعديل رسالة المستخدم وإعادة الإرسال | `MessageItem.tsx` inline edit + `onEditSubmit` |
| 8 | تعديل رد AI يدويًا | Same inline edit path, available for assistant role too |
| 9 | نسخ النص والكود | `MessageActionsMenu.tsx` (نسخ / نسخ Markdown / نسخ الكود فقط via `extractCodeBlocks`) |
| 10 | قراءة الرد صوتيًا (TTS) | `MessageItem.tsx` / `MessageActionsMenu.tsx` "استماع" hooks (Web Speech `SpeechSynthesis`, wired to `onSpeak`) |
| 11 | الإملاء الصوتي بالعربية | `Composer.tsx::toggleDictation` (Web Speech `SpeechRecognition`, `lang="ar-SA"`) |
| 12 | رفع صور/ملفات مع معاينة وحذف | `AttachmentPreviewSheet.tsx` + `lib/files.ts` validation |
| 13 | السحب والإفلات واللصق | `Composer.tsx` (`onDrop`, `onPaste`) |
| 14 | البحث داخل المحادثة مع عدد نتائج والتنقل | `SearchSheet.tsx` + `lib/search.ts` (Arabic-tolerant) |
| 15 | التقييم 👍/👎 | `MessageItem.tsx` + `MessageActionsMenu.tsx` rating buttons → `Message.rating` |
| 16 | تصدير رسالة/محادثة/نسخة احتياطية | `ExportSheet.tsx` (MD/HTML/JSON/PDF) + `SettingsSheet.tsx` backup export |
| 17 | استيراد نسخة احتياطية مع تحقق صارم | `lib/backup.ts` (zod schema) + `SettingsSheet.tsx` import flow |
| 18 | الإعدادات والثيم وحجم الخط وكثافة الزجاج وعرض المحتوى | `SettingsSheet.tsx` (collapsible sections) + `store.ts::ZaiSettings` |
| 19 | دعم RTL كامل | `App.tsx` root `dir="rtl"`, all components written RTL-first (logical CSS properties: `inset-inline-*`, `margin-inline-*`) |
| 20 | اختصارات لوحة المفاتيح | `App.tsx` keydown handler (Ctrl/Cmd+K/M/F) + `SettingsSheet.tsx` reference list |
| 21 | حالات التحميل والخطأ والاتصال | `zai-typing` skeleton, `zai-err` blocks, `OfflineDialog.tsx`, `ToastHost.tsx` |

## Fixed / removed vs. the reference file (security & correctness)

| Reference behavior | Why it was removed/changed |
|---|---|
| Direct browser → `chatlyapp.ai` / `api.rewind.ai` fetches with API keys/auto-generated throwaway accounts stored in `localStorage` (`avetaar_gama_key`, `avetaar_gama_uid`) | Replaced with a server-mediated `/api/v1/chats/:id/messages/stream` — no provider key ever reaches the browser (hard requirement) |
| `thinking` field captured from `gamaChat()` and implied a "بيتفكر" raw-reasoning panel | `redactReasoning()` in `messages.controller.ts` strips it; UI only shows `processingLabel()` |
| Buggy CSS theme selectors (`[data-theme='light'], [data-theme='greenapple-light'] .glass`) | Rewritten in `src/zai/styles/tokens.css`, covered by `src/zai/lib/theme.test.ts` |
| No backend ownership checks (everything was client-only `localStorage`) | `requireOwnership()` in `chats.controller.ts`, reused by `messages.controller.ts` |
