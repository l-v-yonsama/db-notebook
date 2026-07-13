import { authentication } from "vscode";

type EntraIdAccessTokenParams = {
  tenantId?: string;
  interactive?: boolean;
};
export async function acquireEntraIdAccessToken(
  params?: EntraIdAccessTokenParams
): Promise<string | undefined> {
  const scopes = ["https://database.windows.net/.default"];
  if (params?.tenantId) {
    scopes.push(`VSCODE_TENANT:${params.tenantId}`);
  }
  const createIfNone = params?.interactive ?? true;
  const session = await authentication.getSession("microsoft", scopes, {
    createIfNone,
  });
  if (!session) {
    if (createIfNone) {
      throw new Error("Entra ID sign-in was cancelled or failed.");
    }
    return undefined;
  }
  return session.accessToken;
}
