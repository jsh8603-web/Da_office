/**
 * src/sources/teams.mjs — Microsoft Teams source adapter stub
 *
 * Adapter interface (same signature as vault.mjs):
 *   export async function harvest(cfg): Promise<Record[]>
 *
 * Record schema (same as vault.mjs):
 *   { id: string, text: string, source: "teams", path: string, date: string, content_hash: string }
 *
 * cfg fields to be consumed (when implemented):
 *   teams_tenant_id    — Azure AD tenant ID
 *   teams_client_id    — App registration client ID
 *   teams_client_secret — App registration client secret (env var recommended)
 *   teams_channels     — Array of channel IDs to harvest
 *   chunk_size         — Same as vault.mjs
 *   chunk_overlap      — Same as vault.mjs
 *   min_chunk_chars    — Minimum chars to emit a chunk
 *
 * Implementation note:
 *   Requires Microsoft Graph API:
 *   GET /teams/{team-id}/channels/{channel-id}/messages
 *   Auth: OAuth2 client_credentials flow (app-only permission: ChannelMessage.Read.All)
 *   Conversation chunking: group messages by thread/reply chain, sliding window over long threads.
 */

/**
 * Harvest Teams channel messages as normalized chunk records.
 * NOT IMPLEMENTED — awaiting MS Graph API integration.
 *
 * @param {object} cfg  config.json contents
 * @returns {Promise<Array>}
 * @throws {Error} always — "teams source not implemented"
 */
export async function harvest(cfg) {
  throw new Error("teams source not implemented — MS Graph API 연동 대기");
}
