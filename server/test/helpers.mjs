export const SERVER = process.env.TEST_SERVER ?? "http://localhost:3000";
export const API = `${SERVER}/api`;

let ipCounter = 0;
const IP_SEED = (process.pid % 200) + 20;

export function nextIp() {
  ipCounter++;
  const a = Math.floor(ipCounter / 65_536) % 200;
  const b = Math.floor(ipCounter / 256) % 256;
  const c = ipCounter % 256;
  return `${IP_SEED}.${a}.${b}.${c}`;
}

export function randomName(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

export const STRONG_PASSWORD = "Xk9!vRt2Qm";

function parseSetCookie(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  const jar = {};
  for (const line of raw) {
    const [pair] = line.split(";");
    const [name, ...rest] = pair.split("=");
    jar[name.trim()] = rest.join("=");
  }
  return { jar, raw };
}

export function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export async function call(path, options = {}) {
  const { jar, csrf, ip, ...init } = options;
  const headers = {
    "X-Forwarded-For": ip ?? nextIp(),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers ?? {}),
  };
  if (jar && Object.keys(jar).length) headers.cookie = cookieHeader(jar);
  if (csrf) headers["x-csrf-token"] = csrf;

  const res = await fetch(`${API}${path}`, { ...init, headers });
  let body = null;
  try {
    body = await res.json();
  } catch {}

  const { jar: setJar, raw } = parseSetCookie(res);
  return { status: res.status, body, cookies: setJar, rawCookies: raw };
}

export async function registerUser(prefix = "t") {
  const username = randomName(prefix);
  const res = await call("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      email: `${username}@example.test`,
      password: STRONG_PASSWORD,
    }),
  });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    username,
    email: `${username}@example.test`,
    id: res.body.user.id,
    jar: res.cookies,
    csrf: res.body.csrfToken,
  };
}

export async function serverIsUp() {
  try {
    const res = await fetch(`${API}/health`);
    return res.status === 200;
  } catch {
    return false;
  }
}
