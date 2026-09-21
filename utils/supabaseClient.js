const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/g, "");
const SUPABASE_SERVICE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY ||
  ""
).trim();

const isEnabled = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

const headers = (prefer = "return=representation") => {
  const base = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json"
  };
  if (prefer) base.Prefer = prefer;
  return base;
};

const buildUrl = (table, params = {}) => {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
};

const request = async (table, { method = "GET", params = {}, body = null, prefer = "return=representation" } = {}) => {
  if (!isEnabled) return { ok: false, skipped: true, error: "supabase-disabled", data: null };

  const response = await fetch(buildUrl(table, params), {
    method,
    headers: headers(prefer),
    body: body === null ? null : JSON.stringify(body)
  }).catch((error) => ({ ok: false, status: 0, text: async () => String(error?.message || error) }));

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { ok: false, status: response.status || 0, error: text || `HTTP ${response.status || 0}`, data: null };
  }

  if (response.status === 204) return { ok: true, data: null };

  const text = await response.text().catch(() => "");
  if (!text) return { ok: true, data: null };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: true, data: text };
  }
};

const selectRows = async (table, params = {}) => request(table, {
  method: "GET",
  params: { select: "*", ...params },
  prefer: "return=minimal"
});

const upsertRows = async (table, rows, onConflict) => request(table, {
  method: "POST",
  params: onConflict ? { on_conflict: onConflict } : {},
  body: rows,
  prefer: "resolution=merge-duplicates,return=representation"
});

const uploadOfficialReplay = async (path, bytes) => {
  if(!isEnabled || !/^official\/[a-f0-9-]{36}\.hbr2$/.test(path))throw Error('Ruta de REC inválida');
  const response=await fetch(`${SUPABASE_URL}/storage/v1/object/ole-replays/${path}`,{method:'POST',headers:{apikey:SUPABASE_SERVICE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_KEY}`,'Content-Type':'application/octet-stream','x-upsert':'true'},body:bytes,signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw Error('No se pudo guardar la REC en Storage (HTTP '+response.status+')');
};

module.exports = {
  isEnabled,
  request,
  selectRows,
  upsertRows,
  uploadOfficialReplay
};
