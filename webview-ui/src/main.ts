import { library } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowUp,
  faBook,
  faCheck,
  faCirclePlay,
  faClipboard,
  faCodeCompare,
  faDatabase,
  faEye,
  faFileExcel,
  faFileLines,
  faFloppyDisk,
  faLeaf,
  faMagnifyingGlassChart,
  faPencil,
  faPlus,
  faRotate,
  faRotateLeft,
  faSave,
  faSearch,
  faTimes,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import VirtualList from "@virtual-list/vue";
import { Pane, Splitpanes } from "splitpanes";
import "splitpanes/dist/splitpanes.css";
import { createApp } from "vue";
import vueClickOutsideElement from "vue-click-outside-element";
import App from "./App.vue";

library.add(faArrowUp);
library.add(faBook);
library.add(faCheck);
library.add(faClipboard);
library.add(faCirclePlay);
library.add(faCodeCompare);
library.add(faDatabase);
library.add(faEye);
library.add(faFileExcel);
library.add(faFileLines);
library.add(faFloppyDisk);
library.add(faLeaf);
library.add(faMagnifyingGlassChart);
library.add(faPencil);
library.add(faPlus);
library.add(faRotate);
library.add(faRotateLeft);
library.add(faSave);
library.add(faSearch);
library.add(faTrash);
library.add(faTimes);

const app = createApp(App);
app.component("Splitpanes", Splitpanes);
app.component("Pane", Pane);
app.component("fa", FontAwesomeIcon);
app.use(vueClickOutsideElement);
app.component("VirtualList", VirtualList);

app.mount("#app");
