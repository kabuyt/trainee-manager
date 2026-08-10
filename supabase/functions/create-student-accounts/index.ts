import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
});

const EMAIL_DOMAIN = "@student.trainee.local";

type Trainee = {
  id: string;
  student_id: string | null;
  name_katakana: string | null;
  birth_date: string | null;
  status: string | null;
  auth_user_id: string | null;
};

type Detail = {
  student_id: string | null;
  name: string | null;
  result: "planned" | "created" | "linked_existing" | "skipped" | "failed";
  message: string;
};

// 移植元 create_student_accounts.py の _find_user_id_by_email 相当。
// createUser が「既に登録済み」で失敗したとき、既存ユーザーのIDをメールから引く。
// supabase-js の admin.listUsers() はメール完全一致フィルタを持たないため、
// python版と同じく Admin REST API を直接叩く。
async function findUserIdByEmail(supabaseUrl: string, serviceRoleKey: string, email: string): Promise<string | null> {
  const url = `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const users = (data?.users || []) as Array<{ id: string; email?: string }>;
  const match = users.find(u => (u.email || "").toLowerCase() === email.toLowerCase());
  return match?.id || null;
}

async function handleRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Supabase environment is incomplete" }, 500);

  const authorization = request.headers.get("Authorization") || "";
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // service role key での直接呼び出しはサーバー側バッチとみなして admin 扱いにする。
  // service role key を持つ時点で全テーブルに全権があるため、これで権限が広がることはない。
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  const isServiceRole = bearer.length > 0 && bearer === serviceRoleKey;

  if (!isServiceRole) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await adminClient
      .from("user_profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profile?.role !== "admin") return json({ error: "Admin access required" }, 403);
  }

  let payload: { dry_run?: boolean; student_ids?: string[] };
  try {
    payload = await request.json();
  } catch (_) {
    payload = {};
  }
  const dryRun = !!payload.dry_run;
  const studentIdFilter = Array.isArray(payload.student_ids) && payload.student_ids.length
    ? new Set(payload.student_ids.map(id => String(id).trim().toUpperCase()).filter(Boolean))
    : null;

  // 対象: auth_user_id 未設定 かつ 稼働中(status='active')の実習生のみ。
  // trainees.status は 2026_06_12_trainee_status_archive.sql で
  //   NOT NULL DEFAULT 'active', CHECK IN ('active','graduated','withdrawn','inactive')
  // と定義されており、kanri側 app.js の getTraineeStatus() も t.status || 'active' で
  // 「値なし=稼働中」を扱っている。ここでは NOT NULL 前提だが、念のため NULL も
  // 稼働中として扱い、卒業・辞退・停止だけを除外する（アーカイブ済みは対象外の要件）。
  const { data: rows, error: fetchError } = await adminClient
    .from("trainees")
    .select("id,student_id,name_katakana,birth_date,status,auth_user_id")
    .is("auth_user_id", null)
    .or("status.eq.active,status.is.null");
  if (fetchError) return json({ error: "Failed to load trainees" }, 500);

  let candidates = (rows || []) as Trainee[];
  if (studentIdFilter) {
    candidates = candidates.filter(t => t.student_id && studentIdFilter.has(t.student_id.toUpperCase()));
  }

  const details: Detail[] = [];
  const valid: Trainee[] = [];

  for (const t of candidates) {
    if (!t.student_id || !t.birth_date) {
      details.push({
        student_id: t.student_id,
        name: t.name_katakana,
        result: "skipped",
        message: !t.student_id ? "学生IDが未設定" : "生年月日が未設定",
      });
      continue;
    }
    const password = t.birth_date.replace(/-/g, "");
    if (!/^\d{8}$/.test(password)) {
      details.push({
        student_id: t.student_id,
        name: t.name_katakana,
        result: "skipped",
        message: "生年月日の形式が不正でパスワードを生成できません",
      });
      continue;
    }
    valid.push(t);
  }

  let created = 0;
  let linkedExisting = 0;
  let failed = 0;

  if (dryRun) {
    for (const t of valid) {
      details.push({
        student_id: t.student_id,
        name: t.name_katakana,
        result: "planned",
        message: `${(t.student_id as string).toLowerCase()}${EMAIL_DOMAIN} を作成予定`,
      });
    }
  } else {
    for (const t of valid) {
      const studentId = t.student_id as string;
      const email = `${studentId.toLowerCase()}${EMAIL_DOMAIN}`;
      const password = (t.birth_date as string).replace(/-/g, "");
      const name = t.name_katakana || "";

      let userId: string | null = null;
      let alreadyExisted = false;

      const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { student_id: studentId, name, role: "student" },
      });

      if (createData?.user?.id) {
        userId = createData.user.id;
      } else if (createError) {
        const msg = String(createError.message || "").toLowerCase();
        const status = (createError as { status?: number }).status;
        if (status === 422 || msg.includes("already")) {
          userId = await findUserIdByEmail(supabaseUrl, serviceRoleKey, email);
          alreadyExisted = userId != null;
        }
        if (!userId) {
          failed++;
          details.push({
            student_id: studentId,
            name,
            result: "failed",
            // パスワードや service role key は出さず、Supabase側のエラー種別のみ記録する。
            message: `アカウント作成に失敗: ${createError.message || "unknown error"}`,
          });
          continue;
        }
      }

      if (!userId) {
        failed++;
        details.push({ student_id: studentId, name, result: "failed", message: "アカウント作成に失敗: 不明なエラー" });
        continue;
      }

      const { error: linkError } = await adminClient
        .from("trainees")
        .update({ auth_user_id: userId })
        .eq("id", t.id);

      if (linkError) {
        // 作成(または既存ユーザー特定)はできたが紐付けに失敗したケース。
        // 黙って成功扱いにせず、必ず failed として明示する。
        failed++;
        details.push({
          student_id: studentId,
          name,
          result: "failed",
          message: `アカウントは${alreadyExisted ? "既存ユーザーと特定" : "作成"}できましたが trainees への紐付けに失敗: ${linkError.message}`,
        });
        continue;
      }

      if (alreadyExisted) {
        linkedExisting++;
        details.push({ student_id: studentId, name, result: "linked_existing", message: "既存ユーザーと紐付け" });
      } else {
        created++;
        details.push({ student_id: studentId, name, result: "created", message: "新規作成" });
      }
    }
  }

  const skipped = details.filter(d => d.result === "skipped").length;

  return json({
    dry_run: dryRun,
    total: candidates.length,
    created,
    linked_existing: linkedExisting,
    skipped,
    failed,
    details,
  });
}

export default { fetch: handleRequest };
