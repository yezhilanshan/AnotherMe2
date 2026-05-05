import { apiSuccess } from '@/lib/server/api-response';
import {
  getStatelessAdminEmail,
  hasStatelessAdminPassword,
  hasStatelessAuthSecret,
  isStatelessAdminAuthEnabled,
} from '@/lib/auth/stateless';

export const runtime = 'nodejs';

function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!name || !domain) return email ? 'configured' : '';
  return `${name.slice(0, 2)}***@${domain}`;
}

export async function GET() {
  const adminEmail = getStatelessAdminEmail();

  return apiSuccess({
    statelessAdminAuthEnabled: isStatelessAdminAuthEnabled(),
    authAdminEmailConfigured: Boolean(adminEmail),
    authAdminEmailMasked: maskEmail(adminEmail),
    authAdminPasswordConfigured: hasStatelessAdminPassword(),
    authSecretConfigured: hasStatelessAuthSecret(),
    authDataDir: process.env.AUTH_DATA_DIR || '',
    vercel: Boolean(process.env.VERCEL),
    vercelEnv: process.env.VERCEL_ENV || '',
    commit: process.env.VERCEL_GIT_COMMIT_SHA || '',
  });
}
