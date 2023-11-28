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

import type {
  AwsSetting,
  ConnectionSetting,
  IamSolutionSetting,
} from "@l-v-yonsama/multi-platform-database-drivers";

import { vscode } from "@/utilities/vscode";
import type { ModeType } from "@/utilities/vscode";
import type { DropdownItem } from "@/types/Components";
import { ElementSettingFactory } from "./factories/ElementSettingFactory";

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
    iamSolution: {
      clientId: "",
      grantType: "password",
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

const clientId = ref(props.item.iamSolution?.clientId ?? "");
const clientSecret = ref(props.item.iamSolution?.clientSecret ?? "");

const elmSettings = computed(() => {
  const it = ElementSettingFactory.create({
    dbType: dbType.value,
    awsCredentialType: awsCredentialType.value,
  });
  return it;
});

const urlNote = computed((): string => {
  if (DBTypeConst.isIam(dbType.value)) {
    return `Issuer: ${url.value}/realms/master`;
  }
  return "";
});

function createItem(): ConnectionSetting {
  let awsSetting: AwsSetting | undefined = undefined;
  let iamSolution: IamSolutionSetting | undefined = undefined;

  if (DBTypeConst.isAws(dbType.value)) {
    const awsServiceNames = awsServiceSelected.value.join(",").split(",");
    awsSetting = {
      services: awsServiceNames as AwsServiceType[],
      profile: awsProfile.value,
      supplyCredentialType: awsCredentialType.value,
      region: region.value,
    };
  }
  if (DBTypeConst.isIam(dbType.value)) {
    iamSolution = {
      clientId: clientId.value,
      clientSecret: clientSecret.value,
      grantType: dbType.value === "Keycloak" ? "password" : "client_credentials",
    };
  }

  const a: ConnectionSetting = {
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
    iamSolution,
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

  host.value = elmSettings.value.getHost().defaultValue ?? "";
  user.value = "";
  password.value = "";
  timezone.value = "";
  url.value = elmSettings.value.getUrl().defaultValue ?? "";
  clientId.value = elmSettings.value.getIamClientId().defaultValue ?? "";
  clientSecret.value = elmSettings.value.getIamClientSecret().defaultValue ?? "";
  database.value = elmSettings.value.getDatabase().defaultValue ?? "";
  port.value = elmSettings.value.getPort().defaultValue ?? 0;
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

    <label v-show="elmSettings.getHost().visible" for="host">{{
      elmSettings.getHost().label ?? "Host"
    }}</label>
    <p v-if="isShowMode" v-show="elmSettings.getHost().visible" id="host">{{ host }}</p>
    <VsCodeTextField
      v-else
      v-show="elmSettings.getHost().visible"
      id="host"
      v-model="host"
      :placeholder="elmSettings.getHost().placeholder"
      :maxlength="256"
    ></VsCodeTextField>

    <label v-show="elmSettings.getPort().visible" for="port">Port</label>
    <p v-if="isShowMode" v-show="elmSettings.getPort().visible" id="port">{{ port }}</p>
    <VsCodeTextField
      v-else
      v-show="elmSettings.getPort().visible"
      id="port"
      v-model="port"
      type="number"
    ></VsCodeTextField>

    <label v-show="elmSettings.getDatabase().visible" for="database">{{
      elmSettings.getDatabase().label
    }}</label>
    <p v-if="isShowMode" v-show="elmSettings.getDatabase().visible" id="database">{{ database }}</p>
    <VsCodeTextField
      v-else
      v-show="elmSettings.getDatabase().visible"
      id="database"
      v-model="database"
      :placeholder="elmSettings.getDatabase().placeholder"
      :maxlength="128"
    ></VsCodeTextField>

    <label v-show="elmSettings.getIamClientId().visible" for="clientId">Client-id</label>
    <p v-if="isShowMode" v-show="elmSettings.getIamClientId().visible" id="clientId">
      {{ clientId }}
    </p>
    <VsCodeTextField
      v-else
      v-show="elmSettings.getIamClientId().visible"
      id="clientId"
      v-model="clientId"
      :placeholder="elmSettings.getIamClientId().placeholder"
      :maxlength="128"
    ></VsCodeTextField>

    <label v-show="elmSettings.getIamClientSecret().visible" for="clientSecret"
      >Client-secret</label
    >
    <p v-if="isShowMode" v-show="elmSettings.getIamClientSecret().visible" id="clientSecret">
      {{ maskedClientSecret }}
    </p>
    <VsCodeTextField
      v-else
      v-show="elmSettings.getIamClientSecret().visible"
      id="clientSecret"
      v-model="clientSecret"
      :placeholder="elmSettings.getIamClientSecret().placeholder"
      :maxlength="128"
    ></VsCodeTextField>

    <label v-show="elmSettings.getAwsCredentialType().visible" for="awsCredentialType"
      >Aws credential type</label
    >
    <p v-if="isShowMode && elmSettings.getAwsCredentialType().visible" id="awsCredentialType">
      {{ awsCredentialType }}
    </p>
    <VsCodeRadioGroupVue
      v-if="!isShowMode && elmSettings.getAwsCredentialType().visible"
      id="awsCredentialType"
      v-model="awsCredentialType"
      :items="supplyCredentialItems"
    ></VsCodeRadioGroupVue>

    <label v-show="elmSettings.getProfile().visible" for="profile">Profile name</label>
    <p v-if="isShowMode && elmSettings.getProfile().visible" id="profile">{{ awsProfile }}</p>
    <VsCodeTextField
      v-show="!isShowMode && elmSettings.getProfile().visible"
      id="profile"
      v-model="awsProfile"
      :maxlength="128"
    ></VsCodeTextField>

    <label v-show="elmSettings.getUser().visible" for="user">{{
      elmSettings.getUser().label
    }}</label>
    <p v-if="isShowMode && elmSettings.getUser().visible" id="user">{{ maskedUser }}</p>
    <VsCodeTextField
      v-if="!isShowMode && elmSettings.getUser().visible"
      id="user"
      v-model="user"
      :maxlength="128"
    ></VsCodeTextField>

    <label v-show="elmSettings.getPassword().visible" for="password">{{
      elmSettings.getPassword().label
    }}</label>
    <p v-if="isShowMode && elmSettings.getPassword().visible" id="password">{{ maskedPassword }}</p>
    <VsCodeTextField
      v-if="!isShowMode && elmSettings.getPassword().visible"
      id="password"
      v-model="password"
      :maxlength="128"
    ></VsCodeTextField>

    <label v-show="elmSettings.getTimezone().visible" for="timezone">Timezone(Optional)</label>
    <p v-if="isShowMode && elmSettings.getTimezone().visible" id="timezone">{{ timezone }}</p>
    <VsCodeTextField
      v-if="!isShowMode && elmSettings.getTimezone().visible"
      id="timezone"
      v-model="timezone"
      :maxlength="128"
      placeholder="±00:00"
    ></VsCodeTextField>

    <label v-show="elmSettings.getUrl().visible" for="url">{{ elmSettings.getUrl().label }}</label>
    <p v-if="isShowMode && elmSettings.getUrl().visible" id="url">{{ url }}</p>
    <VsCodeTextField
      v-else
      v-show="elmSettings.getUrl().visible"
      id="url"
      v-model="url"
      :type="'url'"
      :maxlength="256"
    ></VsCodeTextField>
    <p v-if="elmSettings.getUrl().visible && urlNote">{{ urlNote }}</p>

    <label
      v-show="
        elmSettings.getAwsCredentialType().visible && awsCredentialType == 'Explicit in property'
      "
      for="region"
      >(Region)</label
    >
    <p
      v-if="
        isShowMode &&
        elmSettings.getAwsCredentialType().visible &&
        awsCredentialType == 'Explicit in property'
      "
      id="region"
    >
      {{ region }}
    </p>
    <VsCodeDropdown
      v-else
      v-show="
        elmSettings.getAwsCredentialType().visible && awsCredentialType == 'Explicit in property'
      "
      id="region"
      v-model="region"
      :items="regionItems"
    ></VsCodeDropdown>

    <VsCodeCheckboxGroup
      v-show="elmSettings.getAwsCredentialType().visible"
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
