import { useUiPrefs, type AppLanguage, type NumeralStyle } from "./prefs.ts";
import type { Category, Currency, WalletKind } from "./types.ts";

const CATEGORY_EN: Record<string, string> = {
  "c-food": "Food",
  "c-transport": "Transport",
  "c-bills": "Bills",
  "c-home": "Housing",
  "c-shop": "Shopping",
  "c-health": "Health",
  "c-edu": "Education",
  "c-fun": "Leisure",
  "c-debt-out": "Debt Repayment",
  "c-other-x": "Other",
  "c-salary": "Salary",
  "c-free": "Freelance",
  "c-gift": "Gifts",
  "c-invest": "Returns",
  "c-debt-in": "Debt Collection",
  "c-other-in": "Other",
};

const CATEGORY_AR: Record<string, string> = {
  "c-food": "طعام",
  "c-transport": "مواصلات",
  "c-bills": "فواتير",
  "c-home": "سكن",
  "c-shop": "تسوق",
  "c-health": "صحة",
  "c-edu": "تعليم",
  "c-fun": "ترفيه",
  "c-debt-out": "سداد دين",
  "c-other-x": "أخرى",
  "c-salary": "راتب",
  "c-free": "عمل حر",
  "c-gift": "هدايا",
  "c-invest": "عائد",
  "c-debt-in": "تحصيل دين",
  "c-other-in": "أخرى",
};

const CURRENCY_LABELS: Record<AppLanguage, Record<Currency, string>> = {
  ar: {
    EGP: "جنيه مصري",
    SAR: "ريال سعودي",
    AED: "درهم إماراتي",
    USD: "دولار أمريكي",
    EUR: "يورو",
  },
  en: {
    EGP: "Egyptian Pound",
    SAR: "Saudi Riyal",
    AED: "UAE Dirham",
    USD: "US Dollar",
    EUR: "Euro",
  },
};

const WALLET_KIND_LABELS: Record<AppLanguage, Record<WalletKind, string>> = {
  ar: {
    cash: "كاش",
    card: "بطاقة بنكية",
    instapay: "إنستاباي",
    vodafone: "فودافون كاش",
    bank: "بنك",
    other: "أخرى",
  },
  en: {
    cash: "Cash",
    card: "Bank Card",
    instapay: "InstaPay",
    vodafone: "Vodafone Cash",
    bank: "Bank",
    other: "Other",
  },
};

const STRINGS = {
  ar: {
    appName: "ميزان",
    appTagline: "دفترك المالي الخاص · محلياً على جهازك",
    tabHome: "اليوم",
    tabLedger: "السجل",
    tabDebts: "الديون",
    tabPeople: "الناس",
    tabMore: "أكثر",
    moreTitle: "المزيد",
    add: "إضافة",
    edit: "تعديل",
    cancel: "إلغاء",
    save: "حفظ",
    back: "رجوع",
    search: "بحث شامل",
    netThisMonth: "صافي الشهر",
    thisMonth: "هذا الشهر",
    income: "الإيرادات",
    expense: "المصاريف",
    incomeSingular: "إيراد",
    expenseSingular: "مصروف",
    situation: "الوضع",
    cashBalance: "الرصيد النقدي",
    savedGoals: "مدّخر للأهداف",
    receivable: "لي عند الناس",
    payable: "عليّ للناس",
    monthReport: "تقرير الشهر",
    monthWeeks: "أسابيع الشهر",
    budgets: "الميزانيات",
    recentTxns: "آخر الحركات",
    analyticsTitle: "تحليلات محلية",
    analyticsDisabled: "التحليلات المحلية متوقفة بناءً على اختيارك",
    analyticsEnable: "تفعيل التحليلات",
    analyticsDailyAvg: "متوسط الإنفاق اليومي",
    analyticsProjected: "المصروف المتوقع لنهاية الشهر",
    analyticsTopDays: "أعلى أيام الإنفاق",
    analyticsIncreasedCats: "فئات زاد إنفاقها عن الشهر السابق",
    analyticsUncategorized: "حركات غير مصنّفة",
    analyticsFooter: "تُحسب جميع التحليلات محلياً على جهازك فقط.",
    languageSection: "اللغة والأرقام",
    languageLabel: "لغة الواجهة",
    languageFooter: "العربية هي اللغة الأساسية الافتراضية، مع دعم كامل للإنجليزية واتجاه RTL/LTR.",
    numeralsLabel: "نظام الأرقام",
    numeralsWestern: "0–9 (غربية)",
    numeralsArabicIndic: "٠–٩ (عربية هندية)",
    analyticsToggleTitle: "تحليلات الإنفاق المحلية",
    analyticsToggleSub: "حساب المتوسط والتوقعات محلياً بدون أي إرسال خارجي",
    exchangeRatesSection: "العملات وأسعار الصرف المرجعية",
    exchangeRatesFooter: "كل معاملة تحفظ سعر الصرف لحظة تسجيلها ولا تتأثر بتغييره لاحقاً.",
    importCsv: "استيراد معاملات CSV",
    importCsvSub: "من ملفات ميزان أو تطبيقات مالية وبنوك",
    perfAndErrors: "الأداء وسجل الأخطاء المحلّي",
    perfLastBoot: "آخر زمن تحميل للصفحة",
    errorLogCount: "الأخطاء المسجلة (منقّاة)",
    errorLogEmpty: "لا توجد أخطاء مسجلة",
    clearErrorLog: "مسح سجل الأخطاء",
    quickExpense: "+ مصروف سريع",
    quickIncome: "+ إيراد سريع",
    quickDebt: "+ دين جديد",
    quickSplit: "تقسيم فاتورة",
    toolsSection: "أدوات",
    currencySection: "العملة وكود الدولة",
    all: "الكل",
    loadingScreen: "جارٍ التحميل…",
    errorTitle: "حدث خطأ غير متوقع",
    errorBody: "حفظنا بياناتك محلياً ولم يتأثر الدفتر. يمكنك إعادة المحاولة أو العودة للرئيسية.",
    errorRetry: "إعادة المحاولة",
    errorGoHome: "العودة للرئيسية",
    errorCodeLabel: "رمز مرجعي آمن",
    txCurrency: "العملة",
    txRate: "سعر الصرف",
    txFrozenRateNote: "يُثبّت سعر الصرف على هذه الحركة لحظة حفظها.",
    convertedPreview: "المعادل بالعملة الأساسية",
  },
  en: {
    appName: "Mizan",
    appTagline: "Your Private Ledger · Local First",
    tabHome: "Today",
    tabLedger: "Ledger",
    tabDebts: "Debts",
    tabPeople: "People",
    tabMore: "More",
    moreTitle: "More",
    add: "Add",
    edit: "Edit",
    cancel: "Cancel",
    save: "Save",
    back: "Back",
    search: "Global Search",
    netThisMonth: "Monthly Net",
    thisMonth: "This Month",
    income: "Income",
    expense: "Expenses",
    incomeSingular: "Income",
    expenseSingular: "Expense",
    situation: "Position",
    cashBalance: "Cash Balance",
    savedGoals: "Saved for Goals",
    receivable: "Owed to Me",
    payable: "I Owe",
    monthReport: "Monthly Report",
    monthWeeks: "Monthly Weeks",
    budgets: "Budgets",
    recentTxns: "Recent Transactions",
    analyticsTitle: "On-Device Analytics",
    analyticsDisabled: "Local analytics are turned off by your preference",
    analyticsEnable: "Enable Analytics",
    analyticsDailyAvg: "Daily Average Spend",
    analyticsProjected: "Projected Month-End Spend",
    analyticsTopDays: "Highest-Spending Days",
    analyticsIncreasedCats: "Categories Up vs Prior Month",
    analyticsUncategorized: "Uncategorized Transactions",
    analyticsFooter: "All analytics are computed strictly on your device.",
    languageSection: "Language & Numerals",
    languageLabel: "Interface Language",
    languageFooter: "Arabic is the primary default language, with full English and RTL/LTR layout support.",
    numeralsLabel: "Numeral Style",
    numeralsWestern: "0–9 (Western)",
    numeralsArabicIndic: "٠–٩ (Arabic-Indic)",
    analyticsToggleTitle: "Local Spending Analytics",
    analyticsToggleSub: "Compute averages and projections locally with zero external upload",
    exchangeRatesSection: "Multi-Currency Reference Rates",
    exchangeRatesFooter: "Each transaction freezes its exchange rate at entry time and stays immune to later edits.",
    importCsv: "Import CSV Transactions",
    importCsvSub: "Supports Mizan & external bank/finance CSV exports",
    perfAndErrors: "Local Performance & Error Log",
    perfLastBoot: "Last First-Page Load",
    errorLogCount: "Sanitized Error Entries",
    errorLogEmpty: "No errors logged",
    clearErrorLog: "Clear Error Log",
    quickExpense: "+ Quick Expense",
    quickIncome: "+ Quick Income",
    quickDebt: "+ New Debt",
    quickSplit: "Split Bill",
    toolsSection: "Tools",
    currencySection: "Currency & Country Code",
    all: "All",
    loadingScreen: "Loading…",
    errorTitle: "Something went wrong",
    errorBody: "Your local ledger data is safe. You can retry this view or return home.",
    errorRetry: "Try Again",
    errorGoHome: "Go Home",
    errorCodeLabel: "Safe Reference",
    txCurrency: "Currency",
    txRate: "Exchange Rate",
    txFrozenRateNote: "Exchange rate is frozen onto this transaction once saved.",
    convertedPreview: "Base Currency Equivalent",
  },
} as const;

export type I18nKey = keyof typeof STRINGS.ar;

export function tr(key: I18nKey, lang: AppLanguage = "ar"): string {
  return STRINGS[lang]?.[key] ?? STRINGS.ar[key];
}

export function categoryLabel(category: Pick<Category, "id" | "name" | "custom"> | undefined, lang: AppLanguage): string {
  if (!category) return lang === "en" ? "Other" : "أخرى";
  if (category.custom) return category.name;
  const map = lang === "en" ? CATEGORY_EN : CATEGORY_AR;
  return map[category.id] ?? category.name;
}

export function currencyLabel(currency: Currency, lang: AppLanguage): string {
  return CURRENCY_LABELS[lang]?.[currency] ?? CURRENCY_LABELS.ar[currency];
}

export function walletKindLabel(kind: WalletKind, lang: AppLanguage): string {
  return WALLET_KIND_LABELS[lang]?.[kind] ?? WALLET_KIND_LABELS.ar[kind];
}

export function useI18n(): {
  lang: AppLanguage;
  numeralStyle: NumeralStyle;
  analyticsEnabled: boolean;
  dir: "rtl" | "ltr";
  isRtl: boolean;
  t: (key: I18nKey) => string;
  catName: (cat: Pick<Category, "id" | "name" | "custom"> | undefined) => string;
  currencyName: (c: Currency) => string;
  walletKind: (k: WalletKind) => string;
} {
  const prefs = useUiPrefs();
  const lang = prefs.language;
  const dir = lang === "en" ? "ltr" : "rtl";
  return {
    lang,
    numeralStyle: prefs.numeralStyle,
    analyticsEnabled: prefs.analyticsEnabled,
    dir,
    isRtl: dir === "rtl",
    t: (key) => tr(key, lang),
    catName: (cat) => categoryLabel(cat, lang),
    currencyName: (c) => currencyLabel(c, lang),
    walletKind: (k) => walletKindLabel(k, lang),
  };
}
