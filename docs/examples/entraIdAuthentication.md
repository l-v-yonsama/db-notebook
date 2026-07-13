# Connecting to SQL Server with Entra ID (Azure AD) authentication

This page explains what to configure — both on the Azure side and inside the Database Notebook connection settings — to connect to an Azure SQL Database / SQL Server using Microsoft Entra ID (formerly Azure AD) interactive authentication.

## TOC

- 1. [Overview](#1-overview)
- 2. [Connection setting in Database Notebook](#2-connection-setting-in-database-notebook)
- 3. [Azure-side prerequisites](#3-azure-side-prerequisites)
- 4. [Signing in](#4-signing-in)
- 5. [Troubleshooting](#5-troubleshooting)

## Screenshot

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/22_azure_entra_id_auth.gif)

## 1. Overview

Database Notebook supports several SQL Server authentication types. This page covers **AAD Access Token (Interactive)**, which signs the user in through a browser using VS Code's own built-in Microsoft/Entra ID account, and uses the resulting access token to connect.

No Azure AD app registration is required to use this auth type — it reuses VS Code's built-in Microsoft authentication provider (the same broker used by other extensions, e.g. GitHub/Azure sign-in). You just sign in with your normal Microsoft/work account when the browser prompt appears.

This is different from **AAD ServicePrincipal..**, which requires you to register your own Azure AD application and supply its Client ID / Client Secret / Tenant ID.

## 2. Connection setting in Database Notebook

In the connection settings form:

1. Set **DB Type** to `SQL Server`.
2. Set **Authentication** to `AAD Access Token (Interactive)`.
3. **Host / Database**: same as usual — your Azure SQL logical server's fully-qualified name (`<server>.database.windows.net`) and database name.
4. **User / Password**: not shown for this auth type — not needed.
5. **TenantId** (optional): leave this blank for normal use. Only fill it in if your Microsoft account is a **guest in multiple Entra ID tenants** and you need to tell VS Code which tenant to authenticate against for this connection — otherwise VS Code may resolve your default/home tenant instead of the one that owns the target database. When set, it is passed to VS Code's auth provider as a `VSCODE_TENANT:<tenantId>` scope hint.

## 3. Azure-side prerequisites

Before this will work, the following must already be set up on the Azure/SQL side (typically done once by an administrator):

- **Entra ID admin on the SQL logical server** — an Entra ID admin must be configured on the Azure SQL server (Azure Portal: server → "Microsoft Entra ID" → "Set admin", or `az sql server ad-admin create`).
- **A database user for your account** — your Entra ID account (or a group you belong to) must exist as a contained database user with appropriate role membership:
  ```sql
  CREATE USER [you@yourtenant.onmicrosoft.com] FROM EXTERNAL PROVIDER;
  ALTER ROLE db_datareader ADD MEMBER [you@yourtenant.onmicrosoft.com];
  ALTER ROLE db_datawriter ADD MEMBER [you@yourtenant.onmicrosoft.com]; -- if write access is needed
  ```
  Note: Azure SQL only allows `CREATE USER ... FROM EXTERNAL PROVIDER` to run over a connection that itself was established using Entra ID authentication (e.g. the Entra ID admin account) — a plain SQL-authentication connection will fail with a permissions error here.
- **Firewall rule** — the Azure SQL server's firewall must allow your client IP (Azure Portal: server → "Networking", or `az sql server firewall-rule create`).
- **MFA / Conditional Access** — if your tenant has Security Defaults or Conditional Access requiring MFA, you may be prompted to register MFA (phone/Authenticator app) the first time you sign in. This is expected Entra ID behavior, not specific to this extension.

## 4. Signing in

When you run a query (or test the connection) for the first time, VS Code will open a browser window for you to sign in with your Microsoft account. Once signed in, the access token is cached by VS Code and silently refreshed in the background for subsequent connections — you generally won't be prompted again unless the underlying session itself is revoked or expires (e.g. you sign out of the account in VS Code's Accounts menu, or the tenant enforces periodic re-authentication).

## 5. Troubleshooting

- **"Login failed" / permission errors** — double check the `CREATE USER ... FROM EXTERNAL PROVIDER` step in [section 3](#3-azure-side-prerequisites) was run, and that it was run over an Entra ID–authenticated connection.
- **Connecting to the wrong tenant / account picker shows the wrong account** — set the **TenantId** field (see [section 2](#2-connection-setting-in-database-notebook)); this is the most common cause when your account is a guest in more than one tenant.
- **Firewall / network errors** — confirm your current client IP is still allowed; IPs change, especially on home/office networks, so the firewall rule may need updating.
