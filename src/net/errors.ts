import { t } from '../localization/i18n';

/** Every `error.code` the server (`server/index.ts` sendError calls + `RoomManager` results in
 * `server/rooms.ts`) can send. Kept as a plain array — both the mapper below and its test walk
 * this list, so a new server code that forgets an i18n key fails the test instead of shipping
 * raw English to a player. */
export const SERVER_ERROR_CODES = [
  'room_full',
  'room_not_found',
  'game_started',
  'room_limit',
  'already_in_room',
  'no_room',
  'not_member',
  'not_host',
  'not_ready',
  'seat_gap',
  'invalid_token',
  'room_closed',
  'rate_limited',
  'bad_message',
  'internal_error',
] as const;

/** Player-facing copy for a server error code — never the raw developer `message` string, which
 * stays in `msg.message`/logs only. Unknown codes (future server code the client hasn't shipped
 * a translation for yet) fall back to a generic string, never to the raw code or message. */
export function errorMessage(code: string): string {
  return (SERVER_ERROR_CODES as readonly string[]).includes(code) ? t(`online.err.${code}`) : t('online.err.unknown');
}
