export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

const USERNAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;

const INVISIBLE_CHARS = new RegExp(
  "[" +
    "\\u0000-\\u001F\\u007F-\\u009F" +
    "\\u00AD" +
    "\\u0600-\\u0605\\u061C\\u06DD\\u070F" +
    "\\u180E" +
    "\\u200B-\\u200F" +
    "\\u202A-\\u202E" +
    "\\u2060-\\u2064\\u2066-\\u206F" +
    "\\uFE00-\\uFE0F" +
    "\\uFEFF" +
    "\\uFFF9-\\uFFFB" +
    "]",
  "g",
);

const EXOTIC_SPACES = new RegExp(
  "[\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000]",
  "g",
);

const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "administrateur",
  "moderator",
  "moderateur",
  "mod",
  "staff",
  "system",
  "systeme",
  "root",
  "support",
  "official",
  "officiel",
  "galactica",
  "server",
  "serveur",
  "bot",
  "null",
  "undefined",
  "anonymous",
  "me",
  "owner",
  "dev",
  "developer",
]);

const COMMON_PASSWORDS = new Set([
  "password",
  "motdepasse",
  "123456789",
  "1234567890",
  "azertyuiop",
  "qwertyuiop",
  "password1",
  "motdepasse1",
  "iloveyou",
  "princess",
  "administrator",
  "qwerty123",
  "azerty123",
  "welcome1",
  "galactica",
  "galactica1",
]);

export class ValidationError extends Error {}

function stripInvisible(value: string): string {
  return value.replace(INVISIBLE_CHARS, "").replace(EXOTIC_SPACES, " ");
}

export function normalizeUsername(raw: unknown): string {
  if (typeof raw !== "string")
    throw new ValidationError("Nom d'utilisateur invalide");

  const username = stripInvisible(raw.normalize("NFKC")).trim();

  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    throw new ValidationError(
      `Le nom d'utilisateur doit faire entre ${USERNAME_MIN} et ${USERNAME_MAX} caractères`,
    );
  }
  if (!USERNAME_PATTERN.test(username)) {
    throw new ValidationError(
      "Le nom d'utilisateur ne peut contenir que des lettres non accentuées, chiffres, tirets et underscores, et doit commencer et finir par une lettre ou un chiffre",
    );
  }
  if (canonicalVariants(username).some((v) => RESERVED_USERNAMES.has(v))) {
    throw new ValidationError("Ce nom d'utilisateur est réservé");
  }
  return username;
}

const LEET_MAP: Record<string, string[]> = {
  "0": ["o"],
  "1": ["l", "i"],
  "3": ["e"],
  "4": ["a"],
  "5": ["s"],
  "6": ["g"],
  "7": ["t"],
  "8": ["b"],
  "9": ["g"],
  "@": ["a"],
  $: ["s"],
};

export function canonicalUsername(username: string): string {
  return canonicalVariants(username)[0];
}

const MAX_VARIANTS = 256;

function canonicalVariants(username: string): string[] {
  const base = username.toLowerCase().replace(/[_\-.\s]/g, "");

  let variants = [""];
  let saturated = false;
  for (const char of base) {
    const options = saturated
      ? [(LEET_MAP[char] ?? [char])[0]]
      : (LEET_MAP[char] ?? [char]);
    const next: string[] = [];
    for (const prefix of variants) {
      for (const option of options) next.push(prefix + option);
    }
    variants = next;
    if (variants.length >= MAX_VARIANTS) saturated = true;
  }
  return variants;
}

// Lookup form of an email, without validation: login and reset must match what sign-up stored
export function emailKey(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return stripInvisible(raw.normalize("NFKC")).trim().toLowerCase();
}

export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string") throw new ValidationError("Email invalide");
  const email = emailKey(raw);
  if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) {
    throw new ValidationError("Email invalide");
  }
  return email;
}

export function validatePassword(raw: unknown, username?: string): string {
  if (typeof raw !== "string")
    throw new ValidationError("Mot de passe invalide");

  const password = raw.normalize("NFKC");

  if (password.length < PASSWORD_MIN) {
    throw new ValidationError(
      `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères`,
    );
  }
  if (password.length > PASSWORD_MAX) {
    throw new ValidationError(
      `Le mot de passe ne peut pas dépasser ${PASSWORD_MAX} caractères`,
    );
  }

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  if (classes < 3) {
    throw new ValidationError(
      "Le mot de passe doit combiner au moins 3 types parmi : minuscules, majuscules, chiffres, caractères spéciaux",
    );
  }

  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) {
    throw new ValidationError("Ce mot de passe est trop courant");
  }
  if (username && lowered.includes(username.toLowerCase())) {
    throw new ValidationError(
      "Le mot de passe ne peut pas contenir le nom d'utilisateur",
    );
  }
  if (/^(.)\1+$/.test(password)) {
    throw new ValidationError("Ce mot de passe est trop simple");
  }

  return password;
}

export const CHAT_MAX_LENGTH = 200;

export function sanitizeChatMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const message = stripInvisible(raw.normalize("NFKC").replace(/\s/g, " "))
    .replace(/ +/g, " ")
    .trim()
    .slice(0, CHAT_MAX_LENGTH);

  return message.length > 0 ? message : null;
}
