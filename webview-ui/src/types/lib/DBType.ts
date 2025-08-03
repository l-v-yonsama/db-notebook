export const DBType = {
  MySQL: "MySQL",
  Postgres: "Postgres",
  SQLServer: "SQLServer",
  SQLite: "SQLite",
  Redis: "Redis",
  Auth0: "Auth0",
  Keycloak: "Keycloak",
  Aws: "Aws",
  Mqtt: "Mqtt",
} as const;

export type DBType = (typeof DBType)[keyof typeof DBType];

export const DBTypeValues = Object.values(DBType);

export const isAws = (dbType: DBType): boolean => DBType.Aws === dbType;

export const isIam = (dbType: DBType): boolean =>
  DBType.Keycloak === dbType || DBType.Auth0 === dbType;

export const isRDSType = (dbType: DBType): boolean => {
  switch (dbType) {
    case DBType.MySQL:
    case DBType.Postgres:
    case DBType.SQLServer:
    case DBType.SQLite:
      return true;
  }
  return false;
};
