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

const allowedKumiai = new Set(["globalway", "cic", "worldbusiness", "tombow", "sanyotech"]);

function parseKumiai(value: unknown) {
  const raw = Array.isArray(value) ? value : String(value || "all").split(",");
  const slugs = raw.map(item => String(item).trim()).filter(Boolean);
  if (!slugs.length || slugs.includes("all")) return "all";
  const invalid = slugs.filter(slug => !allowedKumiai.has(slug));
  if (invalid.length) throw new Error(`Unknown kumiai: ${invalid.join(", ")}`);
  return Array.from(new Set(slugs)).join(",");
}

async function handleRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const githubToken = Deno.env.get("GITHUB_DISPATCH_TOKEN");
  const owner = Deno.env.get("GITHUB_OWNER") || "kabuyt";
  const repo = Deno.env.get("GITHUB_REPO") || "trainee-manager";
  const workflow = Deno.env.get("GITHUB_REPORT_WORKFLOW") || "update-reports.yml";
  const ref = Deno.env.get("GITHUB_REPORT_REF") || "main";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Supabase environment is incomplete" }, 500);
  if (!githubToken) return json({ error: "GITHUB_DISPATCH_TOKEN is not configured" }, 503);

  const authorization = request.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await adminClient
    .from("user_profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return json({ error: "Admin access required" }, 403);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch (_) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  let kumiai: string;
  try {
    kumiai = parseKumiai(payload.kumiai);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid kumiai" }, 400);
  }

  const ymd = String(payload.ymd || "").trim();
  if (ymd && !/^\d{6}$/.test(ymd)) return json({ error: "ymd must be YYYYMM" }, 400);

  const dispatchResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        "User-Agent": "trainee-manager-report-dispatch",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref,
        inputs: {
          kumiai,
          ymd,
          no_all: payload.no_all ? "true" : "false",
          dry_run: payload.dry_run ? "true" : "false",
        },
      }),
    },
  );

  if (!dispatchResponse.ok) {
    const details = await dispatchResponse.text();
    return json({ error: "Failed to dispatch GitHub Actions workflow", details }, 502);
  }

  return json({
    ok: true,
    actions_url: `https://github.com/${owner}/${repo}/actions/workflows/${workflow}`,
  });
}

Deno.serve(handleRequest);
