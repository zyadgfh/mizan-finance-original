import { createClient } from "npm:@supabase/supabase-js@2";

const PHONE_SYNTHETIC_DOMAIN = "@phone.mizan-app.local";
// Base64 inflates a 5.5MB proof image to ~7.4MB; leave head-room.
const MAX_BODY_BYTES = 12_000_000;
const MIN_BOOTSTRAP_SECRET_LENGTH = 32;

const FALLBACK_APP_ORIGINS = [
  "https://mizan-finance-rho.vercel.app",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://127.0.0.1:8080",
];

/**
 * Origins allowed to call this function from a browser.
 * Configure MIZAN_ALLOWED_ORIGINS (comma separated) in the project secrets.
 */
function allowedOrigins(): string[] {
  const raw = Deno.env.get("MIZAN_ALLOWED_ORIGINS") ?? "";
  const extra = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...FALLBACK_APP_ORIGINS, ...extra];
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (allowedOrigins().includes(origin)) return true;
  // Native shells and sandbox previews serve the app from https origins.
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    return (
      url.hostname.endsWith(".e2b.app") ||
      url.hostname.endsWith(".vercel.app") ||
      url.hostname === "localhost"
    );
  } catch {
    return false;
  }
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin as string;
  }
  return headers;
}

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function toAsciiDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

type NormalizedIdentity = {
  kind: "email" | "phone";
  authEmail: string;
  contactDisplay: string;
  phone: string | null;
};

function normalizeSubscriberIdentity(rawInput: string): NormalizedIdentity | null {
  const ascii = toAsciiDigits(String(rawInput ?? "")).trim();
  if (!ascii) return null;

  if (ascii.includes("@")) {
    const lower = ascii.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lower)) {
      return null;
    }
    return {
      kind: "email",
      authEmail: lower,
      contactDisplay: lower,
      phone: null,
    };
  }

  let cleaned = ascii.replace(/[\s\-().]/g, "");
  if (cleaned.startsWith("00")) {
    cleaned = `+${cleaned.slice(2)}`;
  }

  // Egyptian mobile normalization (010 / 011 / 012 / 015 in all common formats)
  const egMatch = cleaned.match(/^(?:\+?20|0)?(1[0125]\d{8})$/);
  if (egMatch) {
    const core10 = egMatch[1];
    const canonicalDigits = `20${core10}`;
    const localDisplay = `0${core10}`;
    return {
      kind: "phone",
      authEmail: `p.${canonicalDigits}${PHONE_SYNTHETIC_DOMAIN}`,
      contactDisplay: localDisplay,
      phone: `+${canonicalDigits}`,
    };
  }

  // General international / Gulf / regional phone numbers (8 to 15 digits)
  const digitsOnly = cleaned.replace(/^\+/, "");
  if (!/^\d{8,15}$/.test(digitsOnly)) {
    return null;
  }

  const displayPhone = cleaned.startsWith("+") ? cleaned : digitsOnly;
  return {
    kind: "phone",
    authEmail: `p.${digitsOnly}${PHONE_SYNTHETIC_DOMAIN}`,
    contactDisplay: displayPhone,
    phone: cleaned.startsWith("+") ? cleaned : `+${digitsOnly}`,
  };
}

function isDeliverableEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return false;
  return !email.endsWith(PHONE_SYNTHETIC_DOMAIN);
}

function cleanDisplayContact(email: string, phone?: string | null, contactDisplay?: string | null): string {
  if (contactDisplay && !contactDisplay.endsWith(PHONE_SYNTHETIC_DOMAIN)) {
    return contactDisplay;
  }
  if (phone) return phone;
  if (email.endsWith(PHONE_SYNTHETIC_DOMAIN)) {
    const digits = email.slice(2, -PHONE_SYNTHETIC_DOMAIN.length);
    if (/^201[0125]\d{8}$/.test(digits)) {
      return `0${digits.slice(2)}`;
    }
    return `+${digits}`;
  }
  return email;
}

function decodeDataUrlImage(dataUrl: string): { bytes: Uint8Array; mime: string; ext: string } | null {
  const match = String(dataUrl ?? "").match(
    /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i,
  );
  if (!match) return null;

  const rawMime = match[1].toLowerCase();
  const mime = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const b64 = match[2].replace(/\s+/g, "");

  try {
    const binary = atob(b64);
    if (binary.length < 64 || binary.length > 5_500_000) return null;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { bytes, mime, ext };
  } catch {
    return null;
  }
}

function makeSlug(base: string): string {
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `${cleaned.length >= 2 ? cleaned : "ws"}-${rand}`;
}

function planDaysFor(code: string): number {
  if (code === "yearly") return 365;
  if (code === "semiannual") return 180;
  if (code === "quarterly") return 90;
  return 30;
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(req, { error: "Missing Edge Function service configuration" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonResponse(req, { error: "حجم الطلب أكبر من الحد المسموح" }, 413);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid");
  } catch {
    return jsonResponse(req, { error: "طلب غير صالح (JSON)" }, 400);
  }

  const action = String(payload.action ?? "");

  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  const clientIp = forwardedFor.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown";
  const ipHash = await sha256Hex(`ip:${clientIp}`);

  const securityLog = async (
    event: string,
    severity: "info" | "warning" | "critical",
    detail: Record<string, unknown>,
    actorId: string | null = null,
  ) => {
    try {
      await admin.from("platform_security_log").insert({
        event,
        severity,
        actor_id: actorId,
        ip_hash: ipHash,
        detail,
      });
    } catch {
      // Logging must never break the request path.
    }
  };

  /**
   * Fixed-window rate limiting backed by the database so it works across
   * function instances. `failClosed` is used for the most sensitive action.
   */
  const allowRequest = async (
    scope: string,
    bucket: string,
    limit: number,
    windowSeconds: number,
    failClosed = false,
  ): Promise<boolean> => {
    const bucketHash = await sha256Hex(`${scope}:${bucket}`);
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_scope: scope,
      p_bucket: bucketHash,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      await securityLog("security.rate_limit_unavailable", "warning", { scope, message: error.message });
      return !failClosed;
    }
    if (data !== true) {
      await securityLog("security.rate_limited", "warning", { scope });
      return false;
    }
    return true;
  };

  const appUrl = (Deno.env.get("MIZAN_APP_URL") ?? "https://mizan-finance-rho.vercel.app/").replace(/\/?$/, "/");

  /**
   * Sends the Supabase signup confirmation email for an unconfirmed account.
   * Accounts created here are never auto-confirmed (Finding 02).
   */
  const sendVerificationEmail = async (email: string, redirectTo?: string): Promise<boolean> => {
    if (!anonKey) return false;
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/resend`, {
        method: "POST",
        // Unauthenticated GoTrue route: the apikey header identifies the
        // project, and no user credential is needed (or sent).
        headers: { "Content-Type": "application/json", apikey: anonKey },
        body: JSON.stringify({
          type: "signup",
          email,
          options: { email_redirect_to: redirectTo || appUrl },
        }),
      });
      if (!res.ok) {
        await securityLog("auth.verification_email_failed", "warning", {
          status: res.status,
          emailDomain: email.split("@")[1] ?? "",
        });
      }
      return res.ok;
    } catch {
      return false;
    }
  };

  // ---------------------------------------------------------------------------
  // PUBLIC ACTION 1: one-time initial platform owner bootstrap
  // ---------------------------------------------------------------------------
  if (action === "setup_owner") {
    const bootstrapSecret = Deno.env.get("MIZAN_BOOTSTRAP_SECRET") ?? "";

    // Fail closed: without a configured secret there is no safe bootstrap path.
    if (bootstrapSecret.length < MIN_BOOTSTRAP_SECRET_LENGTH) {
      await securityLog("platform.bootstrap_disabled", "critical", { reason: "secret_not_configured" });
      return jsonResponse(req, { error: "مسار تهيئة المالك غير مهيأ على الخادم" }, 503);
    }

    const allowed = await allowRequest("setup_owner", `ip:${ipHash}`, 5, 3600, true);
    if (!allowed) {
      return jsonResponse(req, { error: "عدد المحاولات كبير جداً، حاول لاحقاً" }, 429);
    }

    const providedSecret = String(payload.bootstrapSecret ?? "");
    if (!timingSafeEqual(providedSecret, bootstrapSecret)) {
      await securityLog("platform.bootstrap_denied", "critical", { reason: "bad_secret" });
      return jsonResponse(req, { error: "رمز تهيئة المنصة غير صحيح" }, 403);
    }

    const { data: settings, error: settingsErr } = await admin
      .from("platform_settings")
      .select("owner_email")
      .eq("id", 1)
      .maybeSingle();

    if (settingsErr) {
      return jsonResponse(req, { error: settingsErr.message }, 500);
    }

    const ownerEmail = String(settings?.owner_email ?? "").trim().toLowerCase();
    if (!ownerEmail) {
      return jsonResponse(req, { error: "لم يتم ضبط بريد مالك المنصة في إعدادات المنصة" }, 503);
    }

    const { count, error: countErr } = await admin
      .from("platform_admins")
      .select("user_id", { count: "exact", head: true });

    if (countErr) {
      return jsonResponse(req, { error: countErr.message }, 500);
    }
    if ((count ?? 0) > 0) {
      await securityLog("platform.bootstrap_denied", "warning", { reason: "already_initialized" });
      return jsonResponse(req, { error: "حساب مالك المنصة مُعدّ مسبقاً ولا يمكن إعادة التهيئة" }, 403);
    }

    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    const displayName = String(payload.displayName ?? "").trim() || "مالك المنصة";

    if (email !== ownerEmail) {
      await securityLog("platform.bootstrap_denied", "critical", { reason: "email_not_owner" });
      return jsonResponse(req, { error: "هذا البريد الإلكتروني غير مصرح له بتهيئة حساب مالك المنصة" }, 403);
    }
    if (password.length < 8) {
      return jsonResponse(req, { error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" }, 400);
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      // Never pre-confirm: ownership of the mailbox must be proven first.
      email_confirm: false,
      user_metadata: { display_name: displayName, full_name: displayName, contact_display: email },
    });

    let userId = created?.user?.id ?? null;

    if (createErr || !userId) {
      // The mailbox may already have an account (e.g. a retried bootstrap).
      // We never reset its password; we only re-send verification.
      const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = listed?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
      if (!existing) {
        await securityLog("platform.bootstrap_failed", "critical", { reason: "create_failed" });
        return jsonResponse(req, { error: createErr?.message ?? "تعذّر إنشاء حساب المالك" }, 400);
      }
      if (existing.email_confirmed_at) {
        return jsonResponse(
        req,
          { error: "هذا الحساب موجود ومؤكد بالفعل. سجّل الدخول بكلمة المرور الخاصة بك." },
          409,
        );
      }
      userId = existing.id;
    }

    const { data: claimed, error: claimErr } = await admin.rpc("claim_platform_owner", {
      p_user_id: userId,
      p_email: email,
    });

    if (claimErr) {
      await securityLog("platform.bootstrap_failed", "critical", { reason: "claim_error" });
      return jsonResponse(req, { error: claimErr.message }, 500);
    }
    if (claimed !== true) {
      // Someone else already owns the platform row — do not promote, and remove
      // the account we just created so it cannot linger as a half-provisioned user.
      if (created?.user?.id) {
        await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
      }
      await securityLog("platform.bootstrap_denied", "critical", { reason: "claim_rejected" });
      return jsonResponse(req, { error: "تعذّر تأكيد ملكية المنصة" }, 403);
    }

    const { error: profileErr } = await admin.from("profiles").upsert({
      id: userId,
      email,
      contact_display: email,
      display_name: displayName,
      updated_at: new Date().toISOString(),
    });
    if (profileErr) {
      await securityLog("platform.bootstrap_failed", "warning", { reason: "profile_upsert_failed" });
    }

    const verificationSent = await sendVerificationEmail(email);
    await securityLog("platform.bootstrap_completed", "critical", { verificationSent }, userId);

    return jsonResponse(req, {
      ok: true,
      userId,
      email,
      requiresEmailVerification: true,
      verificationEmailSent: verificationSent,
    });
  }

  // ---------------------------------------------------------------------------
  // PUBLIC ACTION 2: self-service subscriber registration + payment proof
  // ---------------------------------------------------------------------------
  if (action === "register_subscriber") {
    const rawIdentifier = String(payload.identifier ?? "");
    const password = String(payload.password ?? "");
    const rawDisplayName = String(payload.displayName ?? "").trim();
    const planCode = String(payload.planCode ?? "monthly");
    const paymentMethod = String(payload.paymentMethod ?? "instapay");
    const senderHandle = toAsciiDigits(String(payload.senderHandle ?? "")).trim();
    const proofDataUrl = String(payload.proofDataUrl ?? "");
    const notes = String(payload.notes ?? "").trim();
    const contactEmail = String(payload.email ?? "").trim().toLowerCase();

    const ipAllowed = await allowRequest("register_subscriber_ip", `ip:${ipHash}`, 10, 3600, true);
    if (!ipAllowed) {
      return jsonResponse(req, { error: "عدد محاولات التسجيل كبير جداً، حاول لاحقاً" }, 429);
    }

    const identity = normalizeSubscriberIdentity(rawIdentifier);
    if (!identity) {
      return jsonResponse(
        req,
        { error: "أدخل بريداً إلكترونياً صحيحاً أو رقم هاتف صحيح (مثل 01012345678)" },
        400,
      );
    }

    const identifierAllowed = await allowRequest("register_subscriber_id", identity.authEmail, 3, 3600, true);
    if (!identifierAllowed) {
      return jsonResponse(req, { error: "تم إنشاء محاولات تسجيل متعددة لهذا الحساب، حاول لاحقاً" }, 429);
    }

    if (password.length < 8) {
      return jsonResponse(req, { error: "كلمة المرور يجب أن تتكون من 8 أحرف أو أرقام على الأقل" }, 400);
    }

    if (!["monthly", "quarterly", "semiannual", "yearly"].includes(planCode)) {
      return jsonResponse(req, { error: "يرجى اختيار باقة اشتراك صالحة" }, 400);
    }

    if (!["instapay", "vodafone_cash", "bank_transfer", "other"].includes(paymentMethod)) {
      return jsonResponse(req, { error: "يرجى اختيار وسيلة الدفع" }, 400);
    }

    if (senderHandle.length < 3 || senderHandle.length > 120) {
      return jsonResponse(
        req,
        {
          error:
            paymentMethod === "instapay"
              ? "أدخل اسم المستخدم على إنستا باي (IPA) أو الرقم الذي تم منه التحويل"
              : "أدخل رقم الهاتف الذي تم منه التحويل",
        },
        400,
      );
    }

    // Strict verification: the account is only usable after a real mailbox is
    // confirmed, so phone-only signups must also provide an email address.
    const verificationEmail =
      identity.kind === "email" ? identity.authEmail : contactEmail;

    if (identity.kind === "phone" && !isDeliverableEmail(contactEmail)) {
      return jsonResponse(
        { error: "أدخل بريداً إلكترونياً صحيحاً لتأكيد الحساب (رقم الهاتف وحده لا يكفي)" },
        400,
      );
    }

    if (!isDeliverableEmail(verificationEmail)) {
      return jsonResponse(req, { error: "أدخل بريداً إلكترونياً صحيحاً" }, 400);
    }

    const { data: platformSettings } = await admin
      .from("platform_settings")
      .select("owner_email")
      .eq("id", 1)
      .maybeSingle();

    if (
      platformSettings?.owner_email &&
      verificationEmail === String(platformSettings.owner_email).trim().toLowerCase()
    ) {
      return jsonResponse(
        req,
        { error: "هذا الحساب مخصص لمالك المنصة، استخدم شاشة إعداد المالك أو سجّل الدخول مباشرة" },
        400,
      );
    }

    const decodedProof = decodeDataUrlImage(proofDataUrl);
    if (!decodedProof) {
      return jsonResponse(req, { error: "يرجى رفع صورة واضحة لإيصال التحويل قبل إرسال الطلب" }, 400);
    }

    const { data: planRow, error: planErr } = await admin
      .from("subscription_plans")
      .select("code, name_ar, price_egp, duration_days, is_active")
      .eq("code", planCode)
      .maybeSingle();

    if (planErr || !planRow || planRow.is_active === false) {
      return jsonResponse(req, { error: "تعذّر تحميل بيانات الباقة المختارة" }, 400);
    }

    const displayName =
      rawDisplayName ||
      (identity.kind === "email" ? identity.contactDisplay.split("@")[0] : `مشترك ${identity.contactDisplay}`);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: verificationEmail,
      password,
      // Ownership of the mailbox must be proven before the account can sign in.
      email_confirm: false,
      user_metadata: {
        display_name: displayName,
        full_name: displayName,
        phone: identity.phone,
        contact_display: identity.contactDisplay,
      },
    });

    if (createErr || !created?.user) {
      const msg = (createErr?.message ?? "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        return jsonResponse(
        req,
          {
            error:
              "هذا البريد الإلكتروني أو رقم الهاتف مسجّل بالفعل. قم بتسجيل الدخول لمتابعة حالة طلبك أو تجديد اشتراكك.",
          },
          409,
        );
      }
      return jsonResponse(req, { error: createErr?.message ?? "تعذّر إنشاء الحساب، حاول مرة أخرى" }, 400);
    }

    const newUserId = created.user.id;

    // Explicit, ordered cleanup: partial provisioning must never survive.
    const cleanupPartialRegistration = async (context: string) => {
      const failures: string[] = [];
      const step = async (name: string, fn: () => PromiseLike<{ error: unknown } | unknown>) => {
        try {
          const result = (await fn()) as { error?: { message?: string } } | undefined;
          if (result && result.error) failures.push(`${name}: ${result.error.message ?? "error"}`);
        } catch (err) {
          failures.push(`${name}: ${err instanceof Error ? err.message : "error"}`);
        }
      };

      await step("payment_requests", () =>
        admin.from("payment_requests").delete().eq("submitted_by", newUserId),
      );
      await step("tenants", () =>
        admin.from("tenants").update({ deleted_at: new Date().toISOString() }).eq("owner_id", newUserId),
      );
      await step("profiles", () => admin.from("profiles").delete().eq("id", newUserId));
      await step("auth_user", () => admin.auth.admin.deleteUser(newUserId));

      if (failures.length > 0) {
        await securityLog("signup.cleanup_failed", "critical", { context, failures }, newUserId);
      }
    };

    try {
      const { error: profileErr } = await admin.from("profiles").upsert({
        id: newUserId,
        email: verificationEmail,
        phone: identity.phone,
        contact_display: identity.contactDisplay,
        display_name: displayName,
        updated_at: new Date().toISOString(),
      });
      if (profileErr) throw new Error(profileErr.message);

      const workspaceName = `دفتر ${displayName}`.slice(0, 75);
      const { data: tenantRow, error: tenantErr } = await admin
        .from("tenants")
        .insert({
          slug: makeSlug(displayName),
          name: workspaceName,
          kind: "personal",
          base_currency: "EGP",
          plan_code: planRow.code,
          subscription_status: "pending_approval",
          current_period_end: new Date().toISOString(),
          owner_id: newUserId,
        })
        .select("id, name")
        .single();

      if (tenantErr || !tenantRow) {
        throw new Error(tenantErr?.message ?? "تعذّر تهيئة مساحة المشترك");
      }

      const tenantId = String(tenantRow.id);

      const { error: memberErr } = await admin.from("tenant_members").insert({
        tenant_id: tenantId,
        user_id: newUserId,
        role: "owner",
        display_name: displayName,
        email: identity.contactDisplay,
      });
      if (memberErr) {
        throw new Error(memberErr.message);
      }

      const requestId = crypto.randomUUID();
      const proofPath = `${tenantId}/${requestId}.${decodedProof.ext}`;

      const { error: uploadErr } = await admin.storage
        .from("mizan-payment-proofs")
        .upload(proofPath, decodedProof.bytes, {
          contentType: decodedProof.mime,
          upsert: false,
        });

      if (uploadErr) {
        throw new Error(`تعذّر رفع صورة التحويل: ${uploadErr.message}`);
      }

      const { data: reqRow, error: reqErr } = await admin
        .from("payment_requests")
        .insert({
          id: requestId,
          tenant_id: tenantId,
          tenant_name: String(tenantRow.name),
          submitted_by: newUserId,
          submitter_email: identity.contactDisplay,
          submitter_contact: identity.contactDisplay,
          request_type: "new_registration",
          plan_code: String(planRow.code),
          duration_days: Number(planRow.duration_days ?? planDaysFor(planCode)),
          amount_egp: Number(planRow.price_egp ?? 0),
          payment_method: paymentMethod,
          reference_code: senderHandle,
          sender_handle: senderHandle,
          proof_path: proofPath,
          notes: notes || null,
          status: "pending",
        })
        .select("*")
        .single();

      if (reqErr) {
        throw new Error(reqErr.message);
      }

      const { error: auditErr } = await admin.from("tenant_audit_logs").insert({
        tenant_id: tenantId,
        actor_id: newUserId,
        actor_name: displayName,
        action: "billing.signup_submitted",
        summary: `تسجيل حساب جديد وإرفاق إيصال تحويل (${planRow.name_ar} - ${planRow.price_egp} ج.م) من: ${senderHandle}`,
      });
      if (auditErr) {
        // Audit failure is not worth losing the signup, but it must be visible.
        await securityLog("signup.audit_failed", "warning", { message: auditErr.message }, newUserId);
      }

      const verificationSent = await sendVerificationEmail(verificationEmail);
      await securityLog("signup.submitted", "info", { verificationSent }, newUserId);

      return jsonResponse(req, {
        ok: true,
        authEmail: verificationEmail,
        contactDisplay: identity.contactDisplay,
        tenantId,
        requestId: reqRow?.id ?? requestId,
        requiresEmailVerification: true,
        verificationEmailSent: verificationSent,
      });
    } catch (err) {
      await cleanupPartialRegistration("register_subscriber");
      return jsonResponse(
        { error: err instanceof Error ? err.message : "حدث خطأ أثناء إرسال طلب الاشتراك، حاول مرة أخرى" },
        500,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // AUTHENTICATED ACTIONS (require a valid user Bearer token)
  // ---------------------------------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return jsonResponse(req, { error: "يجب تسجيل الدخول أولاً" }, 401);
  }

  const { data: callerAuth, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !callerAuth?.user) {
    return jsonResponse(req, { error: "جلسة غير صالحة أو منتهية، يرجى تسجيل الدخول مجدداً" }, 401);
  }

  const callerId = callerAuth.user.id;

  // ---------------------------------------------------------------------------
  // AUTHENTICATED SUBSCRIBER ACTION: renewal / resubmission proof
  // ---------------------------------------------------------------------------
  if (action === "submit_renewal_payment") {
    const tenantId = String(payload.tenantId ?? "").trim();
    const planCode = String(payload.planCode ?? "monthly");
    const paymentMethod = String(payload.paymentMethod ?? "instapay");
    const senderHandle = toAsciiDigits(String(payload.senderHandle ?? "")).trim();
    const proofDataUrl = String(payload.proofDataUrl ?? "");
    const notes = String(payload.notes ?? "").trim();

    const allowed = await allowRequest("submit_renewal_payment", `user:${callerId}`, 6, 3600, true);
    if (!allowed) {
      return jsonResponse(req, { error: "عدد إرسال الطلبات كبير جداً، حاول لاحقاً" }, 429);
    }

    if (!tenantId) {
      return jsonResponse(req, { error: "معرّف المساحة مطلوب" }, 400);
    }

    if (!["monthly", "quarterly", "semiannual", "yearly"].includes(planCode)) {
      return jsonResponse(req, { error: "يرجى اختيار باقة اشتراك صالحة" }, 400);
    }

    if (senderHandle.length < 3 || senderHandle.length > 120) {
      return jsonResponse(
        req,
        {
          error:
            paymentMethod === "instapay"
              ? "أدخل اسم المستخدم على إنستا باي (IPA) أو الرقم الذي تم منه التحويل"
              : "أدخل رقم الهاتف الذي تم منه التحويل",
        },
        400,
      );
    }

    const decodedProof = decodeDataUrlImage(proofDataUrl);
    if (!decodedProof) {
      return jsonResponse(req, { error: "يرجى رفع صورة واضحة لإيصال التحويل" }, 400);
    }

    const [{ data: callerAdmin }, { data: membership }, { data: tenantRow }, { data: planRow }, { data: profileRow }] =
      await Promise.all([
        admin.from("platform_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
        admin
          .from("tenant_members")
          .select("role")
          .eq("tenant_id", tenantId)
          .eq("user_id", callerId)
          .maybeSingle(),
        admin.from("tenants").select("id, name, subscription_status").eq("id", tenantId).is("deleted_at", null).maybeSingle(),
        admin.from("subscription_plans").select("code, name_ar, price_egp, duration_days, is_active").eq("code", planCode).maybeSingle(),
        admin.from("profiles").select("display_name, email, phone, contact_display").eq("id", callerId).maybeSingle(),
      ]);

    const role = String(membership?.role ?? "");
    if (!callerAdmin && role !== "owner" && role !== "admin") {
      return jsonResponse(req, { error: "صلاحية مالك المساحة مطلوبة لإرسال طلب الاشتراك" }, 403);
    }
    if (!tenantRow) {
      return jsonResponse(req, { error: "المساحة غير موجودة" }, 404);
    }
    if (!planRow || planRow.is_active === false) {
      return jsonResponse(req, { error: "الباقة غير موجودة" }, 400);
    }

    const requestId = crypto.randomUUID();
    const proofPath = `${tenantId}/${requestId}.${decodedProof.ext}`;

    const { error: uploadErr } = await admin.storage
      .from("mizan-payment-proofs")
      .upload(proofPath, decodedProof.bytes, {
        contentType: decodedProof.mime,
        upsert: false,
      });

    if (uploadErr) {
      return jsonResponse(req, { error: `تعذّر رفع صورة التحويل: ${uploadErr.message}` }, 500);
    }

    const contactDisplay = cleanDisplayContact(
      String(profileRow?.email ?? callerAuth.user.email ?? ""),
      (profileRow?.phone as string | null) ?? null,
      (profileRow?.contact_display as string | null) ?? null,
    );

    const reqType =
      String(tenantRow.subscription_status) === "pending_approval" ? "new_registration" : "renewal";

    const { data: reqInserted, error: reqErr } = await admin
      .from("payment_requests")
      .insert({
        id: requestId,
        tenant_id: tenantId,
        tenant_name: String(tenantRow.name),
        submitted_by: callerId,
        submitter_email: contactDisplay,
        submitter_contact: contactDisplay,
        request_type: reqType,
        plan_code: String(planRow.code),
        duration_days: Number(planRow.duration_days ?? planDaysFor(planCode)),
        amount_egp: Number(planRow.price_egp ?? 0),
        payment_method: ["instapay", "vodafone_cash", "bank_transfer", "other"].includes(paymentMethod)
          ? paymentMethod
          : "instapay",
        reference_code: senderHandle,
        sender_handle: senderHandle,
        proof_path: proofPath,
        notes: notes || null,
        status: "pending",
      })
      .select("*")
      .single();

    if (reqErr) {
      return jsonResponse(req, { error: reqErr.message }, 500);
    }

    await admin.from("tenant_audit_logs").insert({
      tenant_id: tenantId,
      actor_id: callerId,
      actor_name: String(profileRow?.display_name ?? contactDisplay),
      action: "billing.payment_submitted",
      summary: `إرسال طلب ${reqType === "new_registration" ? "تفعيل اشتراك" : "تجديد اشتراك"} (${planRow.name_ar} - ${planRow.price_egp} ج.م) من: ${senderHandle}`,
    });

    return jsonResponse(req, { ok: true, request: reqInserted });
  }

  // ---------------------------------------------------------------------------
  // SUPER-ADMIN ONLY ACTIONS
  // ---------------------------------------------------------------------------
  const { data: callerAdmin } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", callerId)
    .maybeSingle();

  if (!callerAdmin) {
    return jsonResponse(req, { error: "هذه العملية مقتصرة على مالك المنصة فقط" }, 403);
  }

  if (action === "list_users") {
    const [{ data: usersPage, error: listErr }, { data: adminRows }, { data: memberRows }, { data: profileRows }] =
      await Promise.all([
        admin.auth.admin.listUsers({ page: 1, perPage: 500 }),
        admin.from("platform_admins").select("user_id"),
        admin
          .from("tenant_members")
          .select("user_id, role, tenants(id, name, slug, subscription_status, current_period_end, deleted_at)"),
        admin.from("profiles").select("id, display_name, phone, contact_display"),
      ]);

    if (listErr) {
      return jsonResponse(req, { error: listErr.message }, 500);
    }

    const superSet = new Set((adminRows ?? []).map((r: Record<string, unknown>) => String(r.user_id)));
    const profileMap = new Map(
      (profileRows ?? []).map((p: Record<string, unknown>) => [
        String(p.id),
        {
          displayName: String(p.display_name ?? ""),
          phone: (p.phone as string | null) ?? null,
          contactDisplay: (p.contact_display as string | null) ?? null,
        },
      ]),
    );
    const wsByUser = new Map<
      string,
      Array<{ tenantId: string; name: string; slug: string; role: string; subscriptionStatus: string; currentPeriodEnd: string }>
    >();

    for (const m of (memberRows ?? []) as Array<Record<string, unknown>>) {
      const uid = String(m.user_id);
      const rawT = m.tenants as Record<string, unknown> | Array<Record<string, unknown>> | null;
      const t = Array.isArray(rawT) ? rawT[0] : rawT;
      if (!t || t.deleted_at) continue;
      const arr = wsByUser.get(uid) ?? [];
      arr.push({
        tenantId: String(t.id),
        name: String(t.name),
        slug: String(t.slug),
        role: String(m.role),
        subscriptionStatus: String(t.subscription_status ?? "active"),
        currentPeriodEnd: String(t.current_period_end ?? ""),
      });
      wsByUser.set(uid, arr);
    }

    const users = (usersPage?.users ?? []).map((u) => {
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      const prof = profileMap.get(u.id);
      const bannedUntil = (u as unknown as { banned_until?: string | null }).banned_until ?? null;
      const isBanned = Boolean(bannedUntil && new Date(bannedUntil).getTime() > Date.now());
      const contact = cleanDisplayContact(
        u.email ?? "",
        prof?.phone ?? (typeof meta.phone === "string" ? meta.phone : null),
        prof?.contactDisplay ?? (typeof meta.contact_display === "string" ? meta.contact_display : null),
      );
      const displayName =
        prof?.displayName ||
        (typeof meta.display_name === "string" && meta.display_name) ||
        (typeof meta.full_name === "string" && meta.full_name) ||
        contact.split("@")[0] ||
        "مشترك";

      return {
        id: u.id,
        email: contact,
        rawEmail: u.email ?? "",
        phone: prof?.phone ?? null,
        displayName,
        isSuperAdmin: superSet.has(u.id),
        banned: isBanned,
        emailVerified: Boolean(u.email_confirmed_at),
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        workspaces: wsByUser.get(u.id) ?? [],
      };
    });

    return jsonResponse(req, { ok: true, users });
  }

  if (action === "create_user") {
    const rawIdentifier = String(payload.email ?? payload.identifier ?? "");
    const identity = normalizeSubscriberIdentity(rawIdentifier);
    const password = String(payload.password ?? "");
    const workspaceMode = String(payload.workspaceMode ?? "create");

    if (!identity) {
      return jsonResponse(req, { error: "أدخل بريداً إلكترونياً أو رقم هاتف صحيح" }, 400);
    }
    if (!isDeliverableEmail(identity.authEmail)) {
      return jsonResponse(
        { error: "يتطلب إنشاء الحساب بريداً إلكترونياً حقيقياً لتأكيد الهوية" },
        400,
      );
    }
    if (password.length < 8) {
      return jsonResponse(req, { error: "كلمة المرور يجب ألا تقل عن 8 أحرف" }, 400);
    }

    const displayName =
      String(payload.displayName ?? "").trim() ||
      (identity.kind === "email" ? identity.contactDisplay.split("@")[0] : `مشترك ${identity.contactDisplay}`);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: identity.authEmail,
      password,
      email_confirm: false,
      user_metadata: {
        display_name: displayName,
        full_name: displayName,
        phone: identity.phone,
        contact_display: identity.contactDisplay,
      },
    });

    if (createErr || !created?.user) {
      return jsonResponse(req, { error: createErr?.message ?? "تعذّر إنشاء الحساب" }, 400);
    }

    const newUserId = created.user.id;
    const verificationSent = await sendVerificationEmail(identity.authEmail);
    await securityLog(
      "admin.user_created",
      "warning",
      { verificationSent, workspaceMode },
      callerId,
    );

    const { error: profileErr } = await admin.from("profiles").upsert({
      id: newUserId,
      email: identity.authEmail,
      phone: identity.phone,
      contact_display: identity.contactDisplay,
      display_name: displayName,
      updated_at: new Date().toISOString(),
    });
    if (profileErr) {
      await securityLog("admin.user_profile_failed", "warning", { message: profileErr.message }, callerId);
    }

    let createdTenantId: string | null = null;

    if (workspaceMode === "create") {
      const wsName = String(payload.workspaceName ?? "").trim() || `دفتر ${displayName}`;
      const wsKind = ["personal", "family", "business"].includes(String(payload.workspaceKind))
        ? String(payload.workspaceKind)
        : "personal";
      const baseCurrency = ["EGP", "SAR", "AED", "USD", "EUR"].includes(String(payload.baseCurrency))
        ? String(payload.baseCurrency)
        : "EGP";
      const planCode = ["monthly", "quarterly", "semiannual", "yearly"].includes(String(payload.planCode))
        ? String(payload.planCode)
        : "monthly";
      const subStatus = ["active", "trialing", "pending_approval"].includes(String(payload.subscriptionStatus))
        ? String(payload.subscriptionStatus)
        : "active";

      const { data: planRow } = await admin
        .from("subscription_plans")
        .select("duration_days")
        .eq("code", planCode)
        .maybeSingle();

      const days =
        subStatus === "pending_approval"
          ? 1
          : Number(planRow?.duration_days ?? planDaysFor(planCode));
      const periodEnd = new Date(Date.now() + days * 86_400_000).toISOString();

      const { data: tenantRow, error: tenantErr } = await admin
        .from("tenants")
        .insert({
          slug: makeSlug(wsName),
          name: wsName,
          kind: wsKind,
          base_currency: baseCurrency,
          plan_code: planCode,
          subscription_status: subStatus,
          current_period_end: periodEnd,
          owner_id: newUserId,
        })
        .select("id")
        .single();

      if (!tenantErr && tenantRow) {
        createdTenantId = String(tenantRow.id);
        await admin.from("tenant_members").insert({
          tenant_id: createdTenantId,
          user_id: newUserId,
          role: "owner",
          display_name: displayName,
          email: identity.contactDisplay,
        });
        await admin.from("tenant_audit_logs").insert({
          tenant_id: createdTenantId,
          actor_id: callerId,
          actor_name: "Super-Admin",
          action: "tenant.provisioned_by_owner",
          summary: `إنشاء الحساب والمساحة بواسطة مالك المنصة (${identity.contactDisplay})`,
        });
      } else if (tenantErr) {
        await securityLog("admin.tenant_provision_failed", "warning", { message: tenantErr.message }, callerId);
      }
    } else if (workspaceMode === "existing" && payload.existingTenantId) {
      const targetTenantId = String(payload.existingTenantId);
      const role = ["admin", "member", "viewer"].includes(String(payload.existingRole))
        ? String(payload.existingRole)
        : "member";
      createdTenantId = targetTenantId;
      await admin.from("tenant_members").upsert({
        tenant_id: targetTenantId,
        user_id: newUserId,
        role,
        display_name: displayName,
        email: identity.contactDisplay,
      });
      await admin.from("tenant_audit_logs").insert({
        tenant_id: targetTenantId,
        actor_id: callerId,
        actor_name: "Super-Admin",
        action: "member.added_by_owner",
        summary: `إضافة ${identity.contactDisplay} بدور ${role} بواسطة مالك المنصة`,
      });
    }

    return jsonResponse(req, {
      ok: true,
      user: { id: newUserId, email: identity.contactDisplay, displayName },
      tenantId: createdTenantId,
      requiresEmailVerification: true,
      verificationEmailSent: verificationSent,
    });
  }

  if (action === "update_user") {
    const userId = String(payload.userId ?? "").trim();
    if (!userId) return jsonResponse(req, { error: "userId مطلوب" }, 400);

    const updates: Record<string, unknown> = {};
    if (typeof payload.password === "string" && payload.password.length > 0) {
      if (payload.password.length < 8) {
        return jsonResponse(req, { error: "كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف" }, 400);
      }
      updates.password = payload.password;
    }
    if (typeof payload.displayName === "string" && payload.displayName.trim()) {
      const dn = payload.displayName.trim();
      updates.user_metadata = { display_name: dn, full_name: dn };
      await admin.from("profiles").update({ display_name: dn, updated_at: new Date().toISOString() }).eq("id", userId);
      await admin.from("tenant_members").update({ display_name: dn, updated_at: new Date().toISOString() }).eq("user_id", userId);
    }
    if (typeof payload.banned === "boolean") {
      if (userId === callerId && payload.banned) {
        return jsonResponse(req, { error: "لا يمكنك إيقاف حسابك الشخصي" }, 400);
      }
      updates.ban_duration = payload.banned ? "876000h" : "none";
    }

    const { error: updErr } = await admin.auth.admin.updateUserById(userId, updates);
    if (updErr) return jsonResponse(req, { error: updErr.message }, 400);

    await securityLog(
      "admin.user_updated",
      "warning",
      {
        targetUserId: userId,
        passwordChanged: Boolean(updates.password),
        banned: typeof payload.banned === "boolean" ? Boolean(payload.banned) : null,
      },
      callerId,
    );

    return jsonResponse(req, { ok: true });
  }

  if (action === "delete_user") {
    const userId = String(payload.userId ?? "").trim();
    if (!userId) return jsonResponse(req, { error: "userId مطلوب" }, 400);
    if (userId === callerId) {
      return jsonResponse(req, { error: "لا يمكنك حذف حساب مالك المنصة الحالي" }, 400);
    }

    const { data: targetAdmin } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (targetAdmin) {
      return jsonResponse(req, { error: "لا يمكن حذف مدير منصة آخر" }, 403);
    }

    // Detach owned workspaces before deleting the account so no orphaned
    // billing/FK state can survive (Finding 13).
    const { error: tenantErr } = await admin
      .from("tenants")
      .update({ owner_id: callerId, deleted_at: new Date().toISOString(), subscription_status: "suspended" })
      .eq("owner_id", userId);

    if (tenantErr) {
      await securityLog("admin.user_delete_blocked", "critical", { targetUserId: userId }, callerId);
      return jsonResponse(req, { error: `تعذّر نقل ملكية المساحات: ${tenantErr.message}` }, 500);
    }

    await admin.from("tenant_invites").delete().eq("created_by", userId);

    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      await securityLog("admin.user_delete_failed", "critical", { targetUserId: userId }, callerId);
      return jsonResponse(req, { error: delErr.message }, 400);
    }

    await securityLog("admin.user_deleted", "critical", { targetUserId: userId }, callerId);
    return jsonResponse(req, { ok: true });
  }

  return jsonResponse(req, { error: `عملية غير معروفة: ${action}` }, 400);
});
