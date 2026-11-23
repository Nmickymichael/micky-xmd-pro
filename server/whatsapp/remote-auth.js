import { initAuthCreds } from "@whiskeysockets/baileys";
import { admin } from "../supabase.js";
import { decryptJson, encryptJson } from "../crypto.js";

export async function createRemoteAuthState(botId) {
  const { data: row, error } = await admin
    .from("bot_instances")
    .select("auth_state_ciphertext")
    .eq("id", botId)
    .single();
  if (error) throw error;

  let payload = row.auth_state_ciphertext
    ? decryptJson(row.auth_state_ciphertext)
    : { creds: initAuthCreds(), keys: {} };

  const persist = async () => {
    const ciphertext = encryptJson(payload);
    const { error: saveError } = await admin
      .from("bot_instances")
      .update({ auth_state_ciphertext: ciphertext })
      .eq("id", botId);
    if (saveError) throw saveError;
  };

  const state = {
    creds: payload.creds,
    keys: {
      get: async (type, ids) => Object.fromEntries(ids.map(id => [id, payload.keys[`${type}:${id}`] ?? null])),
      set: async data => {
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries)) {
            const key = `${type}:${id}`;
            if (value === null) delete payload.keys[key];
            else payload.keys[key] = value;
          }
        }
        await persist();
      }
    }
  };

  return {
    state,
    saveCreds: async () => {
      payload.creds = state.creds;
      await persist();
    },
    exportEncrypted: () => encryptJson(payload)
  };
}
