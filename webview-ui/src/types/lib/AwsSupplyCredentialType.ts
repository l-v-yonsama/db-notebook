export const SupplyCredentials = {
  /**
   * Reads from a shared credentials file at `~/.aws/credentials` and a
   * shared configuration file at `~/.aws/config`.
   */
  sharedCredentialsFile: "Shared credentials file",
  /**
   * Reads credentials from the following environment variables.
   * - `AWS_ACCESS_KEY_ID` - The access key for your AWS account.
   * - `AWS_SECRET_ACCESS_KEY` - The secret key for your AWS account.
   */
  environmentVariables: "environment variables",
  ExplicitInProperty: "Explicit in property",
} as const;
export type SupplyCredentialType = (typeof SupplyCredentials)[keyof typeof SupplyCredentials];
