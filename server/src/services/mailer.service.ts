import { config, isProduction } from "../config.js";

interface Mail {
  to: string;
  subject: string;
  body: string;
}

/**
 * Aucun SMTP n'est branché : en dev les liens sont journalisés pour pouvoir
 * dérouler le flux. En production, l'absence de transport est signalée
 * bruyamment plutôt que silencieusement ignorée.
 */
export const sentMails: Mail[] = [];

async function deliver(mail: Mail): Promise<void> {
  if (config.captureMails) {
    sentMails.push(mail);
    if (sentMails.length > 100) sentMails.shift();
  }
  if (isProduction) {
    console.error(
      `[mailer] AUCUN TRANSPORT SMTP CONFIGURÉ — email non envoyé à ${mail.to} (${mail.subject})`,
    );
    return;
  }
  console.log(`\n[mailer] → ${mail.to}\n[mailer] ${mail.subject}\n${mail.body}\n`);
}

export async function sendPasswordReset(to: string, token: string) {
  const link = `${config.clientUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await deliver({
    to,
    subject: "Réinitialisation de ton mot de passe Galactica",
    body: `Ce lien expire dans 30 minutes :\n${link}\n\nSi tu n'es pas à l'origine de cette demande, ignore ce message.`,
  });
}

export async function sendEmailVerification(to: string, token: string) {
  const link = `${config.clientUrl}/verify-email?token=${encodeURIComponent(token)}`;
  await deliver({
    to,
    subject: "Confirme ton adresse email Galactica",
    body: `Ce lien expire dans 24 heures :\n${link}`,
  });
}
