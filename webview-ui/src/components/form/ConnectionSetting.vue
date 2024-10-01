<script setup lang="ts">
import * as AwsRegionConst from "@/types/lib/AwsRegion";
import { AwsServiceType, AwsServiceTypeValues } from "@/types/lib/AwsServiceType";
import { SupplyCredentials } from "@/types/lib/AwsSupplyCredentialType";
import * as DBTypeConst from "@/types/lib/DBType";
import { provideVSCodeDesignSystem, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";
import { computed, ref } from "vue";
import LabeledText from "../base/LabeledText.vue";
import VsCodeButton from "../base/VsCodeButton.vue";
import VsCodeCheckboxGroup from "../base/VsCodeCheckboxGroup.vue";
import VsCodeDropdown from "../base/VsCodeDropdown.vue";
import VsCodeRadioGroupVue from "../base/VsCodeRadioGroup.vue";
import VsCodeTextField from "../base/VsCodeTextField.vue";

import type {
  AwsSetting,
  ConnectionSetting,
  IamSolutionSetting,
  SQLServerSetting,
} from "@l-v-yonsama/multi-platform-database-drivers";

import type { DropdownItem } from "@/types/Components";
import type { ModeType } from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import { toNum } from "@l-v-yonsama/rdh";
import { ElementSettingFactory } from "./factories/ElementSettingFactory";

provideVSCodeDesignSystem().register(vsCodeCheckbox());

const supplyCredentialItems: DropdownItem[] = [
  {
    label: "Credentials files at ~/.aws/",
    value: "Shared credentials file",
  },
  {
    label: "Explicit in property",
    value: "Explicit in property",
  },
];

const sqlServerAuthenticationTypeItems: DropdownItem[] = [
  {
    label: "SQL Server(Default)",
    value: "default",
  },
  {
    label: "Azure AD Default",
    value: "azure-active-directory-default",
  },
  {
    label: "Azure AD Password",
    value: "azure-active-directory-password",
  },
  {
    label: "AAD ServicePrincipal..",
    value: "azure-active-directory-service-principal-secret",
  },
  {
    label: "Azure AD MsiVm",
    value: "azure-active-directory-msi-vm",
  },
  {
    label: "Use Connect String",
    value: "Use Connect String",
  },
];

type Props = {
  mode: ModeType;
  item: ConnectionSetting;
  prohibitedNames: string[];
};

const acceptValues = computed((): boolean => {
  const item = createItem();
  if (!elmSettings.value.accept(item)) {
    return false;
  }

  if (props.mode === "duplicate" || props.mode === "create") {
    if (props.prohibitedNames.includes(name.value)) {
      return false;
    }
  }
  return true;
});

const isDuplicateName = computed((): boolean => {
  if (props.mode === "duplicate" || props.mode === "create") {
    return props.prohibitedNames.includes(name.value);
  }
  return false;
});

const maskedString = (s: string): string => {
  if (s == null || s.length <= 0) {
    return "";
  }
  if (s.length <= 1) {
    return "******";
  }
  if (s.length <= 8) {
    return s.substring(0, 1) + "*****";
  }
  return s.substring(0, 2) + "*****" + s.substring(s.length - 2);
};

const maskedUser = computed((): string => maskedString(user.value ?? ""));
const maskedPassword = computed((): string => maskedString(password.value ?? ""));
const maskedClientSecret = computed((): string => maskedString(clientSecret.value ?? ""));
const maskedSqlServerClientId = computed((): string => maskedString(sqlServerClientId.value ?? ""));
const maskedSqlServerClientSecret = computed((): string =>
  maskedString(sqlServerClientSecret.value ?? "")
);
const maskedSqlServerTenantId = computed((): string => maskedString(sqlServerTenantId.value ?? ""));

const props = withDefaults(defineProps<Props>(), {
  mode: "create",
  item: () => ({
    name: "",
    host: "",
    port: 0,
    database: "",
    useDatabaseName: '',
    dbType: DBTypeConst.DBType.MySQL,
    user: "",
    password: "",
    timezone: "",
    queryTimeoutMs: undefined,
    lockWaitTimeoutMs: undefined,
    url: "",
    awsCredentiaSetting: {
      services: AwsServiceTypeValues,
      profile: "",
      supplyCredentialType: SupplyCredentials.ExplicitInProperty,
      region: "",
    },
    iamSolution: {
      clientId: "",
      grantType: "password",
    },
    sqlServer: {
      encrypt: false,
      trustServerCertificate: false,
      authenticationType: "default",
      onlyDefaultSchema: true,
      clientId: "",
      tenantId: "",
      clientSecret: "",
      token: "",
    },
    ssl: {
      use: false,
    },
  }),
  prohibitedNames: () => [],
});

const isShowMode = ref(props.mode === "show");
const isInProgress = ref(false);

const name = ref(props.item.name);
const host = ref(props.item.host);
const port = ref(props.item.port);
const database = ref(props.item.database);
const useDatabaseName = ref(props.item.useDatabaseName);
const dbType = ref(props.item.dbType);
const user = ref(props.item.user);
const password = ref(props.item.password);
const timezone = ref(props.item.timezone);
const queryTimeoutMs = ref(props.item.queryTimeoutMs);
const lockWaitTimeoutMs = ref(props.item.lockWaitTimeoutMs);
const url = ref(props.item.url);
const region = ref(props.item.awsSetting?.region ?? "");
const awsProfile = ref(props.item.awsSetting?.profile ?? "");
const awsCredentialType = ref(
  props.item.awsSetting?.supplyCredentialType ?? SupplyCredentials.ExplicitInProperty
);
const awsServiceSelected = ref(props.item.awsSetting?.services ?? []);

const dbTypeItems = DBTypeConst.DBTypeValues.map((it) => ({
  label: it,
  value: it,
}));
const regionItems = ["", ...AwsRegionConst.AwsRegionValues].map((it) => ({ label: it, value: it }));
const awsServiceItems = AwsServiceTypeValues.map((it) => ({
  label: it,
  value: it,
  disabled: props.mode === "show",
}));
const resourceTypeItemsForIam = ["Client", "Group"].map((it) => ({
  label: it,
  value: it,
  disabled: props.mode === "show",
}));
const resourceTypeSelectedForIam = ref([] as string[]);
if (props.item.iamSolution?.retrieveClientResOnConnection) {
  resourceTypeSelectedForIam.value.push("Client");
}
if (props.item.iamSolution?.retrieveGroupOrOrgResOnConnection) {
  resourceTypeSelectedForIam.value.push("Group");
}

const clientId = ref(props.item.iamSolution?.clientId ?? "");
const clientSecret = ref(props.item.iamSolution?.clientSecret ?? "");

const useSsl = ref(props.item.ssl?.use ?? false);

const isSqlServerEncrypt = ref(props.item.sqlServer?.encrypt === true);
const isSqlServerTrustServerCertificate = ref(props.item.sqlServer?.trustServerCertificate === true);
const isSqlServerOnlyDefaultSchema = ref(props.item.sqlServer?.onlyDefaultSchema === true);
const sqlServerAuthenticationType = ref(props.item.sqlServer?.authenticationType ?? "default");
const sqlServerClientId = ref(props.item.sqlServer?.clientId ?? "");
const sqlServerClientSecret = ref(props.item.sqlServer?.clientSecret ?? "");
const sqlServerTenantId = ref(props.item.sqlServer?.tenantId ?? "");
const sqlServerConnectString = ref(props.item.sqlServer?.connectString ?? "");

const elmSettings = computed(() => {
  const it = ElementSettingFactory.create({
    dbType: dbType.value,
    awsCredentialType: awsCredentialType.value,
    sqlServerAuthenticationType: sqlServerAuthenticationType.value,
  });
  return it;
});

const urlNote = computed((): string => {
  if (DBTypeConst.isIam(dbType.value)) {
    return `Issuer: ${url.value}/realms/master`;
  }
  return "";
});

const handleUseSsl = (e: any) => {
  if (!e.target) {
    return;
  }
  useSsl.value = e.target["checked"] === true;
};

const handleIsSqlServerEncrypt = (e: any) => {
  if (!e.target) {
    return;
  }
  isSqlServerEncrypt.value = e.target["checked"] === true;
};

const handleIsSqlServerTrustServerCertificate = (e: any) => {
  if (!e.target) {
    return;
  }
  isSqlServerTrustServerCertificate.value = e.target["checked"] === true;
};

const handleIsSqlServerOnlyDefaultSchema = (e: any) => {
  if (!e.target) {
    return;
  }
  isSqlServerOnlyDefaultSchema.value = e.target["checked"] === true;
};

function createItem(): ConnectionSetting {
  let awsSetting: AwsSetting | undefined = undefined;
  let iamSolution: IamSolutionSetting | undefined = undefined;
  let sqlServer: SQLServerSetting | undefined = undefined;

  if (DBTypeConst.isAws(dbType.value)) {
    const awsServiceNames = awsServiceSelected.value.join(",").split(",");
    awsSetting = {
      services: awsServiceNames as AwsServiceType[],
      profile: awsProfile.value,
      supplyCredentialType: awsCredentialType.value,
      region: region.value,
    };
    if (awsCredentialType.value !== SupplyCredentials.ExplicitInProperty) {
      url.value = '';
      region.value = '';
    }
  }
  if (DBTypeConst.isIam(dbType.value)) {
    const resourceTypeNames = resourceTypeSelectedForIam.value.join(",").split(",");
    let retrieveClientResOnConnection = resourceTypeNames.includes("Client");
    let retrieveGroupOrOrgResOnConnection = resourceTypeNames.includes("Group");

    iamSolution = {
      clientId: clientId.value,
      clientSecret: clientSecret.value,
      grantType: dbType.value === "Keycloak" ? "password" : "client_credentials",
      retrieveClientResOnConnection,
      retrieveGroupOrOrgResOnConnection,
    };
  }
  if (dbType.value === "SQLServer") {
    sqlServer = {
      encrypt: isSqlServerEncrypt.value,
      trustServerCertificate: isSqlServerTrustServerCertificate.value,
      authenticationType: sqlServerAuthenticationType.value,
      onlyDefaultSchema: isSqlServerOnlyDefaultSchema.value,
      clientId: sqlServerClientId.value,
      clientSecret: sqlServerClientSecret.value,
      tenantId: sqlServerTenantId.value,
      connectString: sqlServerConnectString.value,
    };
  }

  const a: ConnectionSetting = {
    name: name.value,
    host: host.value,
    port: toNum(port.value),
    database: database.value,
    useDatabaseName: useDatabaseName.value,
    dbType: dbType.value,
    user: user.value,
    password: password.value,
    timezone: timezone.value,
    url: url.value,
    awsSetting,
    iamSolution,
    sqlServer,
  };

  if (useSsl.value) {
    a["ssl"] = {
      use: true,
    };
  }
  const qt = queryTimeoutMs.value as string | undefined;
  if (qt != undefined && qt !== '') {
    a.queryTimeoutMs = toNum(qt);
  }
  const lt = lockWaitTimeoutMs.value as string | undefined;
  if (lt != undefined && lt !== '') {
    a.lockWaitTimeoutMs = toNum(lt);
  }

  return a;
}

function save() {
  vscode.postCommand({
    command: "saveConnectionSetting",
    mode: props.mode,
    params: createItem(),
  });
}

function test() {
  isInProgress.value = true;
  vscode.postCommand({
    command: "testConnectionSetting",
    params: createItem(),
  });
}

function selectDatabaseFile() {
  vscode.postCommand({
    command: "selectFileActionCommand",
    params: {
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: "Select a sqlite database file.",
      filters: {
        SQLite: ["sqlite", "sqlite3", "db", "db3", "sdb", "sdb3", "database"],
        All: ["*"],
      },
    },
  });
}

function setDefault() {
  if (props.mode !== "update") {
    name.value = dbType.value;
  }

  host.value = elmSettings.value.getHost().defaultValue ?? "";
  user.value = elmSettings.value.getUser().defaultValue ?? "";
  password.value = "";
  timezone.value = "";
  queryTimeoutMs.value = undefined;
  lockWaitTimeoutMs.value = undefined;
  url.value = elmSettings.value.getUrl().defaultValue ?? "";
  clientId.value = elmSettings.value.getIamClientId().defaultValue ?? "";
  clientSecret.value = elmSettings.value.getIamClientSecret().defaultValue ?? "";
  database.value = elmSettings.value.getDatabase().defaultValue ?? "";
  useDatabaseName.value = elmSettings.value.getUseDatabaseName().defaultValue ?? "";
  port.value = elmSettings.value.getPort().defaultValue ?? 0;
  useSsl.value = false;
}

const stopProgress = () => {
  isInProgress.value = false;
};

const selectedFile = (filePath: string) => {
  database.value = filePath;
};
defineExpose({
  stopProgress,
  selectedFile,
});
</script>

<template>
  <div class="wrapper">
    <div class="settings db connection">
      <label for="dbType">Database type</label>
      <p v-if="isShowMode" id="dbType">{{ dbType }}</p>
      <div v-else class="first">
        <VsCodeDropdown id="dbType" v-model="dbType" :items="dbTypeItems"></VsCodeDropdown>
        <VsCodeButton @click="setDefault" title="Set default values">Default</VsCodeButton>
      </div>
      <label for="name">Connection name</label>
      <p v-if="isShowMode" id="name">{{ name }}</p>
      <VsCodeTextField v-else id="name" v-model="name" :disabled="mode === 'update'" :maxlength="128"></VsCodeTextField>
      <p v-if="isDuplicateName" class="marker-error">Duplicate name</p>

      <label v-if="elmSettings.getSqlServerAuthenticationType().visible" for="authenticationType">Authentication</label>
      <p v-if="isShowMode" v-show="elmSettings.getSqlServerAuthenticationType().visible" id="authenticationType">
        {{ sqlServerAuthenticationType }}
      </p>
      <VsCodeDropdown v-else v-show="elmSettings.getSqlServerAuthenticationType().visible" id="authenticationType"
        v-model="sqlServerAuthenticationType" :items="sqlServerAuthenticationTypeItems"></VsCodeDropdown>

      <LabeledText v-show="elmSettings.getHost().visible" id="host" v-model="host" :isShowMode="isShowMode"
        :label="elmSettings.getHost().label ?? ''" :placeholder="elmSettings.getHost().placeholder ?? ''" />

      <label v-show="elmSettings.getPort().visible" for="port">Port</label>
      <p v-if="isShowMode" v-show="elmSettings.getPort().visible" id="port">{{ port }}</p>
      <VsCodeTextField v-else v-show="elmSettings.getPort().visible" id="port" v-model="port" type="number">
      </VsCodeTextField>

      <label v-show="elmSettings.getDatabase().visible" for="database">{{
        elmSettings.getDatabase().label ?? "Database"
      }}</label>
      <template v-if="dbType === 'SQLite'">
        <VsCodeButton v-if="!isShowMode" @click="selectDatabaseFile">
          <fa icon="database" />Select
        </VsCodeButton>
        <p>{{ database }}</p>
        <br v-if="!isShowMode" />
      </template>
      <template v-else>
        <!-- Not SQLite -->
        <p v-if="isShowMode" v-show="elmSettings.getDatabase().visible" id="database">
          {{ database }}
        </p>
        <VsCodeTextField v-else v-show="elmSettings.getDatabase().visible" id="database" v-model="database"
          :placeholder="elmSettings.getDatabase().placeholder ?? ''"></VsCodeTextField>
      </template>

      <LabeledText v-show="elmSettings.getUseDatabaseName().visible" id="useDatabaseName" v-model="useDatabaseName"
        :isShowMode="isShowMode" :label="elmSettings.getUseDatabaseName().label ?? ''"
        :placeholder="elmSettings.getUseDatabaseName().placeholder ?? ''" />
      <p v-if="elmSettings.getUseDatabaseName().visible">
        (After connecting, use as current database.)
      </p>

      <LabeledText v-show="elmSettings.getIamClientId().visible" id="clientId" v-model="clientId"
        :isShowMode="isShowMode" :label="elmSettings.getIamClientId().label ?? ''"
        :placeholder="elmSettings.getIamClientId().placeholder ?? ''" />

      <LabeledText v-show="elmSettings.getIamClientSecret().visible" id="clientSecret" v-model="clientSecret"
        :showModeValue="maskedClientSecret" :isShowMode="isShowMode"
        :label="elmSettings.getIamClientSecret().label ?? ''"
        :placeholder="elmSettings.getIamClientSecret().placeholder ?? ''" />

      <label v-show="elmSettings.getAwsCredentialType().visible" for="awsCredentialType">Aws credential type</label>
      <p v-if="isShowMode && elmSettings.getAwsCredentialType().visible" id="awsCredentialType">
        {{ awsCredentialType }}
      </p>
      <VsCodeRadioGroupVue v-if="!isShowMode && elmSettings.getAwsCredentialType().visible" id="awsCredentialType"
        v-model="awsCredentialType" :items="supplyCredentialItems" />

      <LabeledText v-show="elmSettings.getProfile().visible" id="profile" v-model="awsProfile" :isShowMode="isShowMode"
        :label="elmSettings.getProfile().label ?? ''" :placeholder="elmSettings.getProfile().placeholder ?? ''" />

      <LabeledText v-show="elmSettings.getUser().visible" id="user" v-model="user" :showModeValue="maskedUser"
        :isShowMode="isShowMode" :label="elmSettings.getUser().label ?? ''"
        :placeholder="elmSettings.getUser().placeholder ?? ''" />

      <LabeledText v-show="elmSettings.getPassword().visible" id="password" v-model="password"
        :showModeValue="maskedPassword" :isShowMode="isShowMode" :label="elmSettings.getPassword().label ?? ''"
        :placeholder="elmSettings.getPassword().placeholder ?? ''" />

      <label v-show="elmSettings.getTimezone().visible" for="timezone">Timezone(Optional)</label>
      <p v-if="isShowMode && elmSettings.getTimezone().visible" id="timezone">{{ timezone }}</p>
      <VsCodeTextField v-if="!isShowMode && elmSettings.getTimezone().visible" id="timezone" v-model="timezone"
        :maxlength="128" placeholder="±00:00"></VsCodeTextField>

      <label v-show="elmSettings.getUrl().visible" for="url">{{ elmSettings.getUrl().label }}</label>
      <p v-if="isShowMode && elmSettings.getUrl().visible" id="url">{{ url }}</p>
      <VsCodeTextField v-else v-show="elmSettings.getUrl().visible" id="url" v-model="url" :type="'url'"
        :maxlength="256">
      </VsCodeTextField>
      <p v-if="elmSettings.getUrl().visible && urlNote">{{ urlNote }}</p>

      <label v-show="elmSettings.getAwsCredentialType().visible && awsCredentialType == 'Explicit in property'
        " for="region">(Region)</label>
      <p v-if="
        isShowMode &&
        elmSettings.getAwsCredentialType().visible &&
        awsCredentialType == 'Explicit in property'
      " id="region">
        {{ region }}
      </p>
      <VsCodeDropdown v-else v-show="elmSettings.getAwsCredentialType().visible && awsCredentialType == 'Explicit in property'
        " id="region" v-model="region" :items="regionItems"></VsCodeDropdown>

      <VsCodeCheckboxGroup v-show="elmSettings.getAwsCredentialType().visible" legend="Services"
        :items="awsServiceItems" v-model="awsServiceSelected" />

      <VsCodeCheckboxGroup v-show="elmSettings.getIamRetrieveResources().visible"
        legend="Retrieve resources on connection" :items="resourceTypeItemsForIam"
        v-model="resourceTypeSelectedForIam" />

      <label v-show="elmSettings.getSsl().visible" for="useSsl">SSL(Optional)</label>
      <p v-if="isShowMode && elmSettings.getSsl().visible" id="useSsl">{{ useSsl }}</p>
      <vscode-checkbox id="useSsl" v-if="!isShowMode && elmSettings.getSsl().visible" :checked="useSsl"
        @change="($e: InputEvent) => handleUseSsl($e)" style="margin-right: auto">Use
        SSL(sslmode=no-verify)</vscode-checkbox>

      <div v-if="dbType === 'SQLServer'" class="sql-server">
        <label v-if="isShowMode" for="encryption">Encryption</label>
        <p v-if="isShowMode" id="encryption">{{ isSqlServerEncrypt }}</p>
        <vscode-checkbox id="encryption" v-if="!isShowMode" :checked="isSqlServerEncrypt"
          @change="($e: InputEvent) => handleIsSqlServerEncrypt($e)" style="margin-right: auto">Use
          encrypt</vscode-checkbox>

        <label v-if="isShowMode" for="trustServerCertificate">TrustServerCertificate</label>
        <p v-if="isShowMode" id="trustServerCertificate">{{ isSqlServerTrustServerCertificate }}</p>
        <vscode-checkbox id="trustServerCertificate" v-if="!isShowMode" :checked="isSqlServerTrustServerCertificate"
          @change="($e: InputEvent) => handleIsSqlServerTrustServerCertificate($e)" style="margin-right: auto">Trust
          server
          certificate</vscode-checkbox>

        <label v-if="isShowMode" for="onlyDefaultSchema">Show schemas</label>
        <p v-if="isShowMode" id="onlyDefaultSchema">
          {{ isSqlServerOnlyDefaultSchema ? "Only default schema" : "All schemas" }}
        </p>
        <vscode-checkbox id="onlyDefaultSchema" v-if="!isShowMode" :checked="isSqlServerOnlyDefaultSchema"
          @change="($e: InputEvent) => handleIsSqlServerOnlyDefaultSchema($e)" style="margin-right: auto">Show only
          default
          schema</vscode-checkbox>

        <LabeledText v-show="elmSettings.getSqlServerTenantId().visible" id="sqlServerTenantId"
          v-model="sqlServerTenantId" :isShowMode="isShowMode" :showModeValue="maskedSqlServerTenantId"
          :label="elmSettings.getSqlServerTenantId().label ?? ''"
          :placeholder="elmSettings.getSqlServerTenantId().placeholder ?? ''" />
        <LabeledText v-show="elmSettings.getSqlServerClientId().visible" id="sqlServerClientId"
          v-model="sqlServerClientId" :isShowMode="isShowMode" :showModeValue="maskedSqlServerClientId"
          :label="elmSettings.getSqlServerClientId().label ?? ''"
          :placeholder="elmSettings.getSqlServerClientId().placeholder ?? ''" />
        <LabeledText v-show="elmSettings.getSqlServerClientSecret().visible" id="sqlServerClientSecret"
          v-model="sqlServerClientSecret" :isShowMode="isShowMode" :showModeValue="maskedSqlServerClientSecret"
          :label="elmSettings.getSqlServerClientSecret().label ?? ''"
          :placeholder="elmSettings.getSqlServerClientSecret().placeholder ?? ''" />

        <LabeledText v-show="elmSettings.getSqlServerConnectString().visible" id="sqlServerConnectString"
          v-model="sqlServerConnectString" :isShowMode="isShowMode"
          :label="elmSettings.getSqlServerConnectString().label ?? ''"
          :placeholder="elmSettings.getSqlServerConnectString().placeholder ?? ''" />
      </div>

      <label v-show="elmSettings.getQueryTimeoutMs().visible" for="queryTimeoutMs">{{
        elmSettings.getQueryTimeoutMs().label
      }}(Optional)</label>
      <p v-if="isShowMode && elmSettings.getQueryTimeoutMs().visible" id="queryTimeoutMs">{{ queryTimeoutMs }}</p>
      <VsCodeTextField v-if="!isShowMode && elmSettings.getQueryTimeoutMs().visible" id="queryTimeoutMs"
        v-model="queryTimeoutMs" type="number" :maxlength="6" placeholder="e.g. 60000"></VsCodeTextField>

      <label v-show="elmSettings.getLockWaitTimeoutMs().visible" for="lockTimeoutMs">{{
        elmSettings.getLockWaitTimeoutMs().label
      }}(Optional)</label>
      <p v-if="isShowMode && elmSettings.getLockWaitTimeoutMs().visible" id="lockTimeoutMs">{{ lockWaitTimeoutMs }}</p>
      <VsCodeTextField v-if="!isShowMode && elmSettings.getLockWaitTimeoutMs().visible" id="lockTimeoutMs"
        v-model="lockWaitTimeoutMs" type="number" :maxlength="6" placeholder="e.g. 30000"></VsCodeTextField>


      <div v-if="!isShowMode" class="commands">
        <VsCodeButton @click="test" :disabled="!acceptValues || isInProgress">
          <fa icon="circle-play" />Test
        </VsCodeButton>
        <VsCodeButton @click="save" :disabled="!acceptValues || isInProgress">
          <fa icon="floppy-disk" />{{ mode === "create" ? "CREATE" : "SAVE" }}
        </VsCodeButton>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
div.wrapper {
  overflow-x: hidden;
  overflow-y: auto;
  width: 100%;
}

div.settings {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: flex-start;
  height: 100%;
  width: 100%;
  margin: 0 15px;

  &>label {
    margin: 0.5rem 0 0 0;
  }

  &>p,
  &>div>p {
    margin: 0.3rem 0 0 0.3rem;
    opacity: 0.7;
  }
}




div.first {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: flex-start;
}

div.commands {
  margin-top: 0.5em;
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  width: 100%;
}
</style>
