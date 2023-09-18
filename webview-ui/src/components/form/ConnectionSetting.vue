<script setup lang="ts">
import { ref, computed } from "vue";
import VsCodeButton from "../base/VsCodeButton.vue";
import VsCodeTextField from "../base/VsCodeTextField.vue";
import VsCodeDropdown from "../base/VsCodeDropdown.vue";
import VsCodeCheckboxGroup from "../base/VsCodeCheckboxGroup.vue";
import VsCodeRadioGroupVue from "../base/VsCodeRadioGroup.vue";
import * as DBTypeConst from "@/types/lib/DBType";
import * as AwsRegionConst from "@/types/lib/AwsRegion";
import { SupplyCredentials } from "@/types/lib/AwsSupplyCredentialType";
import { AwsServiceType, AwsServiceTypeValues } from "@/types/lib/AwsServiceType";

import type { AwsSetting, ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";

import { vscode } from "@/utilities/vscode";
import type { ModeType } from "@/utilities/vscode";
import type { DropdownItem } from "@/types/Components";

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

type Props = {
  mode: ModeType;
  item: ConnectionSetting;
  prohibitedNames: string[];
};

const isAwsSelected = computed((): boolean => DBTypeConst.isAws(dbType.value));
const isAwsWithExplicitCredentials = computed(
  (): boolean =>
    DBTypeConst.isAws(dbType.value) && awsCredentialType.value == "Explicit in property"
);
const databasePlaceholder = computed((): string => {
  return dbType.value === DBTypeConst.DBType.Redis ? "Index to use" : "Database name";
});

const visiblePort = computed((): boolean => {
  switch (dbType.value) {
    case DBTypeConst.DBType.Postgres:
    case DBTypeConst.DBType.MySQL:
    case DBTypeConst.DBType.Redis:
      return true;
  }
  return false;
});

const visibleHostOrDatabase = computed((): boolean => {
  switch (dbType.value) {
    case DBTypeConst.DBType.Postgres:
    case DBTypeConst.DBType.MySQL:
    case DBTypeConst.DBType.Redis:
      return true;
  }
  return false;
});

const visibleProfile = computed(
  (): boolean =>
    DBTypeConst.isAws(dbType.value) &&
    awsCredentialType.value === SupplyCredentials.sharedCredentialsFile
);

const visibleUser = computed(
  (): boolean =>
    DBTypeConst.DBType.Redis != dbType.value &&
    (!DBTypeConst.isAws(dbType.value) ||
      awsCredentialType.value === SupplyCredentials.ExplicitInProperty)
);

const visiblePassword = computed(
  (): boolean =>
    !DBTypeConst.isAws(dbType.value) ||
    awsCredentialType.value === SupplyCredentials.ExplicitInProperty
);

const visibleTimezone = computed((): boolean => DBTypeConst.isRDSType(dbType.value));

const urlLabel = computed((): string => (DBTypeConst.isAws(dbType.value) ? "Endpoint url" : "URL"));

const userLabel = computed((): string =>
  DBTypeConst.isAws(dbType.value) ? `Access key ID` : "User"
);

const passwordLabel = computed((): string =>
  DBTypeConst.isAws(dbType.value) ? `Secret access key` : "Password"
);

const acceptValues = computed((): boolean => {
  if (name.value === "") {
    return false;
  }
  if (DBTypeConst.isAws(dbType.value)) {
    // AWS
    if (awsServiceSelected.value.length === 0) {
      return false;
    }
    if (awsCredentialType.value === SupplyCredentials.ExplicitInProperty) {
      if (password.value === "" || user.value === "") {
        return false;
      }
    } else if (awsCredentialType.value === SupplyCredentials.sharedCredentialsFile) {
      if (awsProfile.value === "") {
        return false;
      }
    }
  } else {
    // RDS or Redis
    if (database.value === "") {
      return false;
    }
    // RDS
    if (DBTypeConst.isRDSType(dbType.value)) {
      if (user.value === "" || password.value === "") {
        return false;
      }
    }
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

const props = withDefaults(defineProps<Props>(), {
  mode: "create",
  item: () => ({
    name: "",
    host: "",
    port: 0,
    database: "",
    dbType: DBTypeConst.DBType.MySQL,
    user: "",
    password: "",
    timezone: "",
    url: "",
    awsCredentiaSetting: {
      services: AwsServiceTypeValues,
      profile: "",
      supplyCredentialType: SupplyCredentials.ExplicitInProperty,
      region: "",
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
const dbType = ref(props.item.dbType);
const user = ref(props.item.user);
const password = ref(props.item.password);
const timezone = ref(props.item.timezone);
const url = ref(props.item.url);
const region = ref(props.item.awsSetting?.region ?? "");
const awsProfile = ref(props.item.awsSetting?.profile ?? "");
const awsCredentialType = ref(
  props.item.awsSetting?.supplyCredentialType ?? SupplyCredentials.ExplicitInProperty
);
const awsServiceSelected = ref(props.item.awsSetting?.services ?? []);

const dbTypeItems = DBTypeConst.DBTypeValues.map((it) => ({ label: it, value: it }));
const regionItems = ["", ...AwsRegionConst.AwsRegionValues].map((it) => ({ label: it, value: it }));
const awsServiceItems = AwsServiceTypeValues.map((it) => ({
  label: it,
  value: it,
  disabled: props.mode === "show",
}));

function createItem(): ConnectionSetting {
  let awsSetting: AwsSetting | undefined = undefined;
  const aaa = awsServiceSelected.value.join(",");
  const arr = aaa.split(",");
  if (DBTypeConst.isAws(dbType.value)) {
    awsSetting = {
      services: arr as AwsServiceType[],
      profile: awsProfile.value,
      supplyCredentialType: awsCredentialType.value,
      region: region.value,
    };
  }
  const a = {
    name: name.value,
    host: host.value,
    port: port.value,
    database: database.value,
    dbType: dbType.value,
    user: user.value,
    password: password.value,
    timezone: timezone.value,
    url: url.value,
    awsSetting,
  };
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
function setDefault() {
  if (props.mode !== "update") {
    name.value = dbType.value;
  }

  host.value = "127.0.0.1";
  user.value = "";
  password.value = "";
  timezone.value = "";
  url.value = "";
  switch (dbType.value) {
    case DBTypeConst.DBType.Redis:
      port.value = 6379;
      database.value = "0";
      break;
    case DBTypeConst.DBType.Postgres:
      port.value = 5432;
      database.value = "postgres";
      break;
    case DBTypeConst.DBType.MySQL:
      port.value = 3306;
      database.value = "mysql";
      break;
  }
}

const stopProgress = () => {
  isInProgress.value = false;
};
defineExpose({
  stopProgress,
});
</script>

<template>
  <div class="settings">
    <label for="dbType">Database type</label>
    <p v-if="isShowMode" id="dbType">{{ dbType }}</p>
    <div v-else class="first">
      <VsCodeDropdown id="dbType" v-model="dbType" :items="dbTypeItems"></VsCodeDropdown>
      <VsCodeButton @click="setDefault" title="Set default values">Default</VsCodeButton>
    </div>
    <label for="name">Connection name</label>
    <p v-if="isShowMode" id="name">{{ name }}</p>
    <VsCodeTextField
      v-else
      id="name"
      v-model="name"
      :disabled="mode === 'update'"
      :maxlength="128"
    ></VsCodeTextField>
    <p v-if="isDuplicateName" class="marker-error">Duplicate name</p>

    <label v-show="visibleHostOrDatabase" for="host">Host</label>
    <p v-if="isShowMode" v-show="visibleHostOrDatabase" id="host">{{ host }}</p>
    <VsCodeTextField
      v-else
      v-show="visibleHostOrDatabase"
      id="host"
      v-model="host"
      :maxlength="256"
    ></VsCodeTextField>

    <label v-show="visiblePort" for="port">Port</label>
    <p v-if="isShowMode" v-show="visiblePort" id="port">{{ port }}</p>
    <VsCodeTextField
      v-else
      v-show="visiblePort"
      id="port"
      v-model="port"
      type="number"
    ></VsCodeTextField>

    <label v-show="visibleHostOrDatabase" for="database">Database</label>
    <p v-if="isShowMode" id="database">{{ database }}</p>
    <VsCodeTextField
      v-else
      v-show="visibleHostOrDatabase"
      id="database"
      v-model="database"
      :placeholder="databasePlaceholder"
      :maxlength="128"
    ></VsCodeTextField>

    <label v-show="isAwsSelected" for="awsCredentialType">Aws credential type</label>
    <p v-if="isShowMode && isAwsSelected" id="awsCredentialType">{{ awsCredentialType }}</p>
    <VsCodeRadioGroupVue
      v-if="!isShowMode && isAwsSelected"
      id="awsCredentialType"
      v-model="awsCredentialType"
      :items="supplyCredentialItems"
    ></VsCodeRadioGroupVue>

    <label v-show="visibleProfile" for="profile">Profile name</label>
    <p v-if="isShowMode && visibleProfile" id="profile">{{ awsProfile }}</p>
    <VsCodeTextField
      v-show="!isShowMode && visibleProfile"
      id="profile"
      v-model="awsProfile"
      :maxlength="128"
    ></VsCodeTextField>

    <label v-show="visibleUser" for="user">{{ userLabel }}</label>
    <p v-if="isShowMode && visibleUser" id="user">{{ maskedUser }}</p>
    <VsCodeTextField
      v-if="!isShowMode && visibleUser"
      id="user"
      v-model="user"
      :maxlength="128"
    ></VsCodeTextField>

    <label v-show="visiblePassword" for="password">{{ passwordLabel }}</label>
    <p v-if="isShowMode && visiblePassword" id="password">{{ maskedPassword }}</p>
    <VsCodeTextField
      v-if="!isShowMode && visiblePassword"
      id="password"
      v-model="password"
      :maxlength="128"
    ></VsCodeTextField>

    <label v-show="visibleTimezone" for="timezone">Timezone(Optional)</label>
    <p v-if="isShowMode && visibleTimezone" id="timezone">{{ timezone }}</p>
    <VsCodeTextField
      v-if="!isShowMode && visibleTimezone"
      id="timezone"
      v-model="timezone"
      :maxlength="128"
      placeholder="±00:00"
    ></VsCodeTextField>

    <label v-show="isAwsWithExplicitCredentials" for="url">{{ urlLabel }}</label>
    <p v-if="isShowMode && isAwsWithExplicitCredentials" id="url">{{ url }}</p>
    <VsCodeTextField
      v-else
      v-show="isAwsWithExplicitCredentials"
      id="url"
      v-model="url"
      :type="'url'"
      :maxlength="256"
    ></VsCodeTextField>

    <label v-show="isAwsWithExplicitCredentials" for="region">(Region)</label>
    <p v-if="isShowMode && isAwsWithExplicitCredentials" id="region">{{ region }}</p>
    <VsCodeDropdown
      v-else
      v-show="isAwsWithExplicitCredentials"
      id="region"
      v-model="region"
      :items="regionItems"
    ></VsCodeDropdown>

    <VsCodeCheckboxGroup
      v-show="isAwsSelected"
      legend="Services"
      :items="awsServiceItems"
      v-model="awsServiceSelected"
    ></VsCodeCheckboxGroup>

    <div v-if="!isShowMode" class="commands">
      <VsCodeButton @click="test" :disabled="!acceptValues || isInProgress"
        ><fa icon="circle-play" />Test</VsCodeButton
      >
      <VsCodeButton @click="save" :disabled="!acceptValues || isInProgress"
        ><fa icon="floppy-disk" />{{ mode === "create" ? "CREATE" : "SAVE" }}</VsCodeButton
      >
    </div>
  </div>
</template>

<style scoped>
div.settings {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: flex-start;
  height: 100%;
  width: 100%;
  margin: 0 15px;
}

div.settings > label {
  margin: 0.5rem 0 0 0;
}

div.settings > p {
  margin: 0.3rem 0 0 0.3rem;
  opacity: 0.7;
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
