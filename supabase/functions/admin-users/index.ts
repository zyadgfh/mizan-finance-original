import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER_BOOTSTRAP_EMAIL = "zyadgamal796@gmail.com";
const PHONE_SYNTHETIC_DOMAIN = "@phone.mizan-app.local";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing Edge Function service configuration" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "طلب غير صالح (JSON)" }, 400);
  }

  const action = String(payload.action ?? "");

  // ---------------------------------------------------------------------------
  // PUBLIC ACTION 1: One-time initial platform owner bootstrap
  // ---------------------------------------------------------------------------
  if (action === "setup_owner") {
    const { count, error: countErr } = await admin
      .from("platform_admins")
      .select("user_id", { count: "exact", head: true });

    if (countErr) {
      return jsonResponse({ error: countErr.message }, 500);
    }
    if ((count ?? 0) > 0) {
      return jsonResponse({ error: "حساب مالك المنصة مُعدّ مسبقاً ولا يمكن إعادة التهيئة" }, 403);
    }

    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    const displayName = String(payload.displayName ?? "").trim() || "مالك المنصة";

    if (email !== OWNER_BOOTSTRAP_EMAIL) {
      return jsonResponse({ error: "هذا البريد الإلكتروني غير مصرح له بتهيئة حساب مالك المنصة" }, 403);
    }
    if (password.length < 6) {
      return jsonResponse({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" }, 400);
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, full_name: displayName, contact_display: email },
    });

    let userId = created?.user?.id ?? null;

    if (createErr || !userId) {
      const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = listed?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
      if (!existing) {
        return jsonResponse({ error: createErr?.message ?? "تعذّر إنشاء حساب المالك" }, 400);
      }
      userId = existing.id;
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName, full_name: displayName, contact_display: email },
      });
      if (updErr) {
        return jsonResponse({ error: updErr.message }, 400);
      }
    }

    await admin.from("profiles").upsert({
      id: userId,
      email,
      contact_display: email,
      display_name: displayName,
      updated_at: new Date().toISOString(),
    });

    const { error: adminInsertErr } = await admin.from("platform_admins").upsert({
      user_id: userId,
      email,
    });
    if (adminInsertErr) {
      return jsonResponse({ error: adminInsertErr.message }, 500);
    }

    return jsonResponse({ ok: true, userId, email });
  }

  // ---------------------------------------------------------------------------
  // PUBLIC ACTION 2: Self-Service Subscriber Registration + Payment Proof Upload
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

    const identity = normalizeSubscriberIdentity(rawIdentifier);
    if (!identity) {
      return jsonResponse(
        { error: "أدخل بريداً إلكترونياً صحيحاً أو رقم هاتف صحيح (مثل 01012345678)" },
        400,
      );
    }

    if (identity.authEmail === OWNER_BOOTSTRAP_EMAIL) {
      return jsonResponse({ error: "هذا الحساب مخصص لمالك المنصة، قم بتسجيل الدخول مباشرة" }, 400);
    }

    if (password.length < 6) {
      return jsonResponse({ error: "كلمة المرور يجب أن تتكون من 6 أحرف أو أرقام على الأقل" }, 400);
    }

    if (!["monthly", "quarterly", "semiannual", "yearly"].includes(planCode)) {
      return jsonResponse({ error: "يرجى اختيار باقة اشتراك صالحة" }, 400);
    }

    if (!["instapay", "vodafone_cash", "bank_transfer", "other"].includes(paymentMethod)) {
      return jsonResponse({ error: "يرجى اختيار وسيلة الدفع" }, 400);
    }

    if (senderHandle.length < 3 || senderHandle.length > 120) {
      return jsonResponse(
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
      return jsonResponse({ error: "يرجى رفع صورة واضحة لإيصال التحويل قبل إرسال الطلب" }, 400);
    }

    const { data: planRow, error: planErr } = await admin
      .from("subscription_plans")
      .select("code, name_ar, price_egp, duration_days")
      .eq("code", planCode)
      .maybeSingle();

    if (planErr || !planRow) {
      return jsonResponse({ error: "تعذّر تحميل بيانات الباقة المختارة" }, 400);
    }

    const displayName =
      rawDisplayName ||
      (identity.kind === "email" ? identity.contactDisplay.split("@")[0] : `مشترك ${identity.contactDisplay}`);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: identity.authEmail,
      password,
      email_confirm: true,
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
          {
            error:
              "هذا البريد الإلكتروني أو رقم الهاتف مسجّل بالفعل. قم بتسجيل الدخول لمتابعة حالة طلبك أو تجديد اشتراكك.",
          },
          409,
        );
      }
      return jsonResponse({ error: createErr?.message ?? "تعذّر إنشاء الحساب، حاول مرة أخرى" }, 400);
    }

    const newUserId = created.user.id;

    try {
      await admin.from("profiles").upsert({
        id: newUserId,
        email: identity.authEmail,
        phone: identity.phone,
        contact_display: identity.contactDisplay,
        display_name: displayName,
        updated_at: new Date().toISOString(),
      });

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
          upsert: true,
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

      await admin.from("tenant_audit_logs").insert({
        tenant_id: tenantId,
        actor_id: newUserId,
        actor_name: displayName,
        action: "billing.signup_submitted",
        summary: `تسجيل حساب جديد وإرفاق إيصال تحويل (${planRow.name_ar} - ${planRow.price_egp} ج.م) من: ${senderHandle}`,
      });

      return jsonResponse({
        ok: true,
        authEmail: identity.authEmail,
        contactDisplay: identity.contactDisplay,
        tenantId,
        requestId: reqRow?.id ?? requestId,
      });
    } catch (err) {
      // Roll back user creation so no partial account remains
      await admin.auth.admin.deleteUser(newUserId).catch(() => undefined);
      return jsonResponse(
        { error: err instanceof Error ? err.message : "حدث خطأ أثناء إرسال طلب الاشتراك، حاول مرة أخرى" },
        500,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // AUTHENTICATED ACTIONS (Require valid user Bearer JWT)
  // ---------------------------------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return jsonResponse({ error: "يجب تسجيل الدخول أولاً" }, 401);
  }

  const { data: callerAuth, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !callerAuth?.user) {
    return jsonResponse({ error: "جلسة غير صالحة أو منتهية، يرجى تسجيل الدخول مجدداً" }, 401);
  }

  const callerId = callerAuth.user.id;

  // ---------------------------------------------------------------------------
  // AUTHENTICATED SUBSCRIBER ACTION: Submit Renewal / Resubmission Proof
  // (Works reliably even when tenant subscription_status is expired or pending_approval!)
  // ---------------------------------------------------------------------------
  if (action === "submit_renewal_payment") {
    const tenantId = String(payload.tenantId ?? "").trim();
    const planCode = String(payload.planCode ?? "monthly");
    const paymentMethod = String(payload.paymentMethod ?? "instapay");
    const senderHandle = toAsciiDigits(String(payload.senderHandle ?? "")).trim();
    const proofDataUrl = String(payload.proofDataUrl ?? "");
    const notes = String(payload.notes ?? "").trim();

    if (!tenantId) {
      return jsonResponse({ error: "معرّف المساحة مطلوب" }, 400);
    }

    if (!["monthly", "quarterly", "semiannual", "yearly"].includes(planCode)) {
      return jsonResponse({ error: "يرجى اختيار باقة اشتراك صالحة" }, 400);
    }

    if (senderHandle.length < 3 || senderHandle.length > 120) {
      return jsonResponse(
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
      return jsonResponse({ error: "يرجى رفع صورة واضحة لإيصال التحويل" }, 400);
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
        admin.from("subscription_plans").select("code, name_ar, price_egp, duration_days").eq("code", planCode).maybeSingle(),
        admin.from("profiles").select("display_name, email, phone, contact_display").eq("id", callerId).maybeSingle(),
      ]);

    const role = String(membership?.role ?? "");
    if (!callerAdmin && role !== "owner" && role !== "admin") {
      return jsonResponse({ error: "صلاحية مالك المساحة مطلوبة لإرسال طلب الاشتراك" }, 403);
    }
    if (!tenantRow) {
      return jsonResponse({ error: "المساحة غير موجودة" }, 404);
    }
    if (!planRow) {
      return jsonResponse({ error: "الباقة غير موجودة" }, 400);
    }

    const requestId = crypto.randomUUID();
    const proofPath = `${tenantId}/${requestId}.${decodedProof.ext}`;

    const { error: uploadErr } = await admin.storage
      .from("mizan-payment-proofs")
      .upload(proofPath, decodedProof.bytes, {
        contentType: decodedProof.mime,
        upsert: true,
      });

    if (uploadErr) {
      return jsonResponse({ error: `تعذّر رفع صورة التحويل: ${uploadErr.message}` }, 500);
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
      return jsonResponse({ error: reqErr.message }, 500);
    }

    await admin.from("tenant_audit_logs").insert({
      tenant_id: tenantId,
      actor_id: callerId,
      actor_name: String(profileRow?.display_name ?? contactDisplay),
      action: "billing.payment_submitted",
      summary: `إرسال طلب ${reqType === "new_registration" ? "تفعيل اشتراك" : "تجديد اشتراك"} (${planRow.name_ar} - ${planRow.price_egp} ج.م) من: ${senderHandle}`,
    });

    return jsonResponse({ ok: true, request: reqInserted });
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
    return jsonResponse({ error: "هذه العملية مقتصرة على مالك المنصة فقط" }, 403);
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
      return jsonResponse({ error: listErr.message }, 500);
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
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        workspaces: wsByUser.get(u.id) ?? [],
      };
    });

    return jsonResponse({ ok: true, users });
  }

  if (action === "create_user") {
    const rawIdentifier = String(payload.email ?? payload.identifier ?? "");
    const identity = normalizeSubscriberIdentity(rawIdentifier);
    const password = String(payload.password ?? "");
    const workspaceMode = String(payload.workspaceMode ?? "create");

    if (!identity) {
      return jsonResponse({ error: "أدخل بريداً إلكترونياً أو رقم هاتف صحيح" }, 400);
    }
    if (password.length < 6) {
      return jsonResponse({ error: "كلمة المرور يجب ألا تقل عن 6 أحرف" }, 400);
    }

    const displayName =
      String(payload.displayName ?? "").trim() ||
      (identity.kind === "email" ? identity.contactDisplay.split("@")[0] : `مشترك ${identity.contactDisplay}`);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: identity.authEmail,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        full_name: displayName,
        phone: identity.phone,
        contact_display: identity.contactDisplay,
      },
    });

    if (createErr || !created?.user) {
      return jsonResponse({ error: createErr?.message ?? "تعذّر إنشاء الحساب" }, 400);
    }

    const newUserId = created.user.id;
    await admin.from("profiles").upsert({
      id: newUserId,
      email: identity.authEmail,
      phone: identity.phone,
      contact_display: identity.contactDisplay,
      display_name: displayName,
      updated_at: new Date().toISOString(),
    });

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
      const days = subStatus === "pending_approval" ? 0 : planDaysFor(planCode);
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

    return jsonResponse({
      ok: true,
      user: { id: newUserId, email: identity.contactDisplay, displayName },
      tenantId: createdTenantId,
    });
  }

  if (action === "update_user") {
    const userId = String(payload.userId ?? "").trim();
    if (!userId) return jsonResponse({ error: "userId مطلوب" }, 400);

    const updates: Record<string, unknown> = {};
    if (typeof payload.password === "string" && payload.password.length > 0) {
      if (payload.password.length < 6) {
        return jsonResponse({ error: "كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف" }, 400);
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
        return jsonResponse({ error: "لا يمكنك إيقاف حسابك الشخصي" }, 400);
      }
      updates.ban_duration = payload.banned ? "876000h" : "none";
    }

    const { error: updErr } = await admin.auth.admin.updateUserById(userId, updates);
    if (updErr) return jsonResponse({ error: updErr.message }, 400);

    return jsonResponse({ ok: true });
  }

  if (action === "delete_user") {
    const userId = String(payload.userId ?? "").trim();
    if (!userId) return jsonResponse({ error: "userId مطلوب" }, 400);
    if (userId === callerId) {
      return jsonResponse({ error: "لا يمكنك حذف حساب مالك المنصة الحالي" }, 400);
    }

    const { data: targetAdmin } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (targetAdmin) {
      return jsonResponse({ error: "لا يمكن حذف مدير منصة آخر" }, 403);
    }

    await admin
      .from("tenants")
      .update({ owner_id: callerId, deleted_at: new Date().toISOString(), subscription_status: "suspended" })
      .eq("owner_id", userId);

    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) return jsonResponse({ error: delErr.message }, 400);

    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: `عملية غير معروفة: ${action}` }, 400);
});
