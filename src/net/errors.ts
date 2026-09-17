import { t } from '../localization/i18n';
import { SERVER_ERROR_CODES, type ServerErrorCode } from './protocol';

export { SERVER_ERROR_CODES, type ServerErrorCode };

/** Player-facing copy for a server error code — never the raw developer `message` string, which
 * stays in `msg.message`/logs only. Unknown codes (future server code the client hasn't shipped
 * a translation for yet) fall back to a generic string, never to the raw code or message. */
export function errorMessage(code: string): string {
  return (SERVER_ERROR_CODES as readonly string[]).includes(code) ? t(`online.err.${code}`) : t('online.err.unknown');
}
