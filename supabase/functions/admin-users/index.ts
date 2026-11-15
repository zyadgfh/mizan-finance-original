import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER_BOOTSTRAP_EMAIL = "zyadgamal796@gmail.com";

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

function makeSlug(base: string): string {
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `${cleaned.length >= 2 ? cleaned : "ws"}-${rand}`;
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
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const action = String(payload.action ?? "");

  // One-time initial platform owner bootstrap (permanently locks once platform_admins has >= 1 row)
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
      user_metadata: { display_name: displayName, full_name: displayName },
    });

    let userId = created?.user?.id ?? null;

    if (createErr || !userId) {
      // Check if user already existed in auth.users
      const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = listed?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
      if (!existing) {
        return jsonResponse({ error: createErr?.message ?? "تعذّر إنشاء حساب المالك" }, 400);
      }
      userId = existing.id;
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName, full_name: displayName },
      });
      if (updErr) {
        return jsonResponse({ error: updErr.message }, 400);
      }
    }

    await admin.from("profiles").upsert({
      id: userId,
      email,
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

  // All subsequent actions strictly require an authenticated Super-Admin JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return jsonResponse({ error: "يجب تسجيل الدخول بصلاحية مالك المنصة" }, 401);
  }

  const { data: callerAuth, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !callerAuth?.user) {
    return jsonResponse({ error: "جلسة غير صالحة أو منتهية" }, 401);
  }

  const callerId = callerAuth.user.id;
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
          .select("user_id, role, tenants(id, name, slug, deleted_at)"),
        admin.from("profiles").select("id, display_name"),
      ]);

    if (listErr) {
      return jsonResponse({ error: listErr.message }, 500);
    }

    const superSet = new Set((adminRows ?? []).map((r: Record<string, unknown>) => String(r.user_id)));
    const profileMap = new Map(
      (profileRows ?? []).map((p: Record<string, unknown>) => [String(p.id), String(p.display_name ?? "")]),
    );
    const wsByUser = new Map<string, Array<{ tenantId: string; name: string; slug: string; role: string }>>();

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
      });
      wsByUser.set(uid, arr);
    }

    const users = (usersPage?.users ?? []).map((u) => {
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      const bannedUntil = (u as unknown as { banned_until?: string | null }).banned_until ?? null;
      const isBanned = Boolean(bannedUntil && new Date(bannedUntil).getTime() > Date.now());
      const displayName =
        profileMap.get(u.id) ||
        (typeof meta.display_name === "string" && meta.display_name) ||
        (typeof meta.full_name === "string" && meta.full_name) ||
        (u.email ?? "").split("@")[0] ||
        "مستخدم";

      return {
        id: u.id,
        email: u.email ?? "",
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
    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    const displayName =
      String(payload.displayName ?? "").trim() || email.split("@")[0] || "مستخدم ميزان";
    const workspaceMode = String(payload.workspaceMode ?? "create"); // 'create' | 'existing' | 'none'

    if (!email || !email.includes("@")) {
      return jsonResponse({ error: "أدخل بريداً إلكترونياً صالحاً" }, 400);
    }
    if (password.length < 6) {
      return jsonResponse({ error: "كلمة المرور يجب ألا تقل عن 6 أحرف" }, 400);
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, full_name: displayName },
    });

    if (createErr || !created?.user) {
      return jsonResponse({ error: createErr?.message ?? "تعذّر إنشاء الحساب" }, 400);
    }

    const newUserId = created.user.id;
    await admin.from("profiles").upsert({
      id: newUserId,
      email,
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
      const planCode = payload.planCode === "yearly" ? "yearly" : "monthly";
      const subStatus = payload.subscriptionStatus === "trialing" ? "trialing" : "active";
      const days = subStatus === "trialing" ? 14 : planCode === "yearly" ? 365 : 30;
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
          email,
        });
        await admin.from("tenant_audit_logs").insert({
          tenant_id: createdTenantId,
          actor_id: callerId,
          actor_name: "Super-Admin",
          action: "tenant.provisioned_by_owner",
          summary: `إنشاء الحساب والمساحة بواسطة مالك المنصة (${email})`,
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
        email,
      });
      await admin.from("tenant_audit_logs").insert({
        tenant_id: targetTenantId,
        actor_id: callerId,
        actor_name: "Super-Admin",
        action: "member.added_by_owner",
        summary: `إضافة ${email} بدور ${role} بواسطة مالك المنصة`,
      });
    }

    return jsonResponse({
      ok: true,
      user: { id: newUserId, email, displayName },
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

    // Reassign soft-deleted ownership so foreign key tenants.owner_id does not block auth.users deletion
    await admin
      .from("tenants")
      .update({ owner_id: callerId, deleted_at: new Date().toISOString(), subscription_status: "suspended" })
      .eq("owner_id", userId);

    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) return jsonResponse({ error: delErr.message }, 400);

    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: `Unknown action: ${action}` }, 400);
});
