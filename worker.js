const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function b64urlDecode(s) {
  s = s.replace(/-/g,"+").replace(/_/g,"/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
async function keyFromSecret(secret) {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt","decrypt"]);
}
async function seal(obj, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromSecret(secret);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv}, key, enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv,0); out.set(ct,iv.length);
  return b64url(out);
}
async function unseal(token, secret) {
  try {
    const raw = b64urlDecode(token || "");
    if (raw.length < 13) return null;
    const iv = raw.slice(0,12), ct = raw.slice(12);
    const key = await keyFromSecret(secret);
    const pt = await crypto.subtle.decrypt({name:"AES-GCM",iv}, key, ct);
    const obj = JSON.parse(dec.decode(pt));
    if (!obj.exp || Date.now() > obj.exp) return null;
    return obj;
  } catch { return null; }
}
function cookieMap(req) {
  const out = {};
  for (const p of (req.headers.get("Cookie") || "").split(";")) {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0,i).trim()] = decodeURIComponent(p.slice(i+1).trim());
  }
  return out;
}
function j(data, status=200, headers={}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "x-content-type-options":"nosniff",
      "referrer-policy":"no-referrer",
      ...headers
    }
  });
}
function first(o, keys) {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return "";
}
const digits = v => String(v || "").replace(/\D/g,"");
function memberFromObject(o, phone) {
  if (!o || typeof o !== "object") return null;
  const code = first(o, ["member_code","memberCode","code","member_id","memberId","id"]);
  if (!code) return null;
  const name = first(o, ["member_name","memberName","name","full_name","fullName","display_name","displayName","firstname","first_name"]);
  const p = digits(first(o, ["phone_number","tel_mobile","phone","mobile","tel"]));
  if (p && p !== phone) return null;
  return {code, name:name || "-"};
}
function deepFind(data, phone, depth=0) {
  if (depth > 6 || data == null) return null;
  if (Array.isArray(data)) {
    for (const x of data) { const m = deepFind(x, phone, depth+1); if (m) return m; }
    return null;
  }
  if (typeof data === "object") {
    const direct = memberFromObject(data, phone);
    if (direct) return direct;
    for (const v of Object.values(data)) {
      if (v && typeof v === "object") {
        const m = deepFind(v, phone, depth+1); if (m) return m;
      }
    }
  }
  return null;
}
async function upstream(env, method, url, body, token) {
  const headers = {
    "accept":"application/json",
    "content-type":"application/json",
    "x-app-version": env.APP_VERSION || "1.6.1",
    "user-agent":"OKJ-Member-Finder-Cloudflare/1.0"
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, {
      method, headers,
      body: body == null ? undefined : JSON.stringify(body),
      redirect:"manual",
      signal:ctrl.signal
    });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
    return {status:r.status,data,text};
  } finally { clearTimeout(timer); }
}
function tokenFrom(data) {
  const vals = [
    data?.access_token, data?.accessToken, data?.token,
    data?.data?.access_token, data?.data?.accessToken, data?.data?.token,
    data?.result?.access_token, data?.result?.accessToken, data?.result?.token
  ];
  return vals.find(v => typeof v === "string" && v.length > 20) || "";
}
async function qrSvg(text) {
  // Minimal QR via Google Chart is avoided; use a local SVG placeholder fallback if QR lib unavailable.
  // We return a QR service URL only after successful member lookup.
  return `https://quickchart.io/qr?size=900&text=${encodeURIComponent(text)}`;
}
async function handleApi(req, env, url) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    return j({ok:false,error:"ยังไม่ได้ตั้ง SESSION_SECRET"},500);
  }
  const origin = env.API_ORIGIN || "https://shop.ohkajhu.com";

  if (url.pathname === "/api/login" && req.method === "POST") {
    let body; try { body = await req.json(); } catch { return j({ok:false,error:"ข้อมูลไม่ถูกต้อง"},400); }
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) return j({ok:false,error:"กรุณากรอกรหัสพนักงานและรหัสผ่าน"},400);
    const attempts = [
      [`${origin}/api/v1/auth/login`, {username,password}],
      [`${origin}/api/v1/auth/login`, {user_name:username,password}],
      [`${origin}/auth/login`, {username,password}],
      [`${origin}/auth/login`, {user_name:username,password}],
    ];
    let last=0;
    for (const [u,b] of attempts) {
      try {
        const r = await upstream(env,"POST",u,b,null); last=r.status;
        if (r.status>=200 && r.status<300) {
          const tok=tokenFrom(r.data);
          if (tok) {
            const sealed=await seal({token:tok,exp:Date.now()+8*60*60*1000},env.SESSION_SECRET);
            return j({ok:true},200,{"set-cookie":`okj_session=${encodeURIComponent(sealed)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`});
          }
        }
      } catch (e) {
        if (e.name==="AbortError") return j({ok:false,error:"เชื่อมต่อระบบร้านหมดเวลา"},504);
      }
    }
    return j({ok:false,error:`เข้าสู่ระบบไม่สำเร็จ${last?` (${last})`:""}`},last||502);
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    return j({ok:true},200,{"set-cookie":"okj_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"});
  }

  if (url.pathname === "/api/member" && req.method === "GET") {
    const sess = await unseal(cookieMap(req).okj_session, env.SESSION_SECRET);
    if (!sess?.token) return j({ok:false,error:"กรุณาเข้าสู่ระบบใหม่"},401,{"set-cookie":"okj_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"});
    const phone = digits(url.searchParams.get("phone"));
    if (!/^0\d{9}$/.test(phone)) return j({ok:false,error:"กรุณากรอกเบอร์ 10 หลัก"},400);
    const p=encodeURIComponent(phone);
    const urls=[
      `${origin}/api/v1/members/phone?phone_number=${p}`,
      `${origin}/api/v1/members/search?keyword=${p}&page=1&size=20`,
      `${origin}/members/phone?phone_number=${p}`,
      `${origin}/members/search?keyword=${p}&page=1&size=20`
    ];
    let last=0;
    for (const u of urls) {
      try {
        const r=await upstream(env,"GET",u,null,sess.token); last=r.status;
        if (r.status===401||r.status===403)
          return j({ok:false,error:"เซสชันหมดหรือบัญชีนี้ไม่มีสิทธิ์"},r.status,{"set-cookie":"okj_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"});
        if (r.status>=200&&r.status<300) {
          const m=deepFind(r.data,phone);
          if (m) return j({ok:true,member:{code:m.code,name:m.name,qr:await qrSvg(m.code)}});
        }
      } catch(e) {
        if(e.name==="AbortError") return j({ok:false,error:"เชื่อมต่อระบบร้านหมดเวลา"},504);
      }
    }
    return j({ok:false,error:last===404?"ไม่พบสมาชิก":`ค้นหาไม่สำเร็จ${last?` (${last})`:""}`},last===404?404:502);
  }

  return j({ok:false,error:"NOT_FOUND"},404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return handleApi(req, env, url);
    return env.ASSETS.fetch(req);
  }
};
