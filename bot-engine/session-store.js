import { createRemoteAuthState } from "../server/whatsapp/remote-auth.js";

export async function remoteAuth(botId) {
  return createRemoteAuthState(botId);
}
