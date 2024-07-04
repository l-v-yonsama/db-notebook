import { isDateTime, isDateTimeOrDate, isDate } from "@/utilities/GeneralColumnUtil";
import type { RdhKey, RdhRow, ResultSetData } from "@l-v-yonsama/multi-platform-database-drivers";

export const tableau20 = [
  { r: 31, g: 119, b: 180 },
  { r: 174, g: 199, b: 232 },
  { r: 255, g: 127, b: 14 },
  { r: 255, g: 187, b: 120 },
  { r: 44, g: 160, b: 44 },
  { r: 152, g: 223, b: 138 },
  { r: 214, g: 39, b: 40 },
  { r: 255, g: 152, b: 150 },
  { r: 148, g: 103, b: 189 },
  { r: 197, g: 176, b: 213 },
  { r: 140, g: 86, b: 75 },
  { r: 196, g: 156, b: 148 },
  { r: 227, g: 119, b: 194 },
  { r: 247, g: 182, b: 210 },
  { r: 127, g: 127, b: 127 },
  { r: 199, g: 199, b: 199 },
  { r: 188, g: 189, b: 34 },
  { r: 219, g: 219, b: 141 },
  { r: 23, g: 190, b: 207 },
  { r: 158, g: 218, b: 229 },
];

const pointStyles: string[] = [
  "circle",
  "rect",
  "triangle",
  "rectRot",
  "dash",
  "cross",
  "line",
  "crossRot",
  "rectRounded",
  "star",
];

const pointStyleSymbols: string[] = [
  "●",
  "■",
  "▲",
  "rectRot",
  "dash",
  "cross",
  "line",
  "crossRot",
  "rectRounded",
  "star",
];

export const createPointStyles = (size: number) => {
  const arr: string[] = [];
  for (let i = 0; i < size; i++) {
    const p = pointStyles[i % pointStyles.length];
    arr.push(p);
  }
  return arr;
};

export const createColors = (size: number, alpha = 0.9) => {
  const arr: string[] = [];
  for (let i = 0; i < size; i++) {
    const p = tableau20[i % 20];
    arr.push(`rgba(${p.r},${p.g},${p.b}, ${alpha})`);
  }
  return arr;
};

export const createColors2 = (size: number, alpha = 0.9) => {
  const arr: string[] = [];
  for (let i = 0, j = 0; i < size; i++, j += 2) {
    const p = tableau20[j % 20];
    arr.push(`rgba(${p.r},${p.g},${p.b}, ${alpha})`);
  }
  return arr;
};

export const getBase64Image = (id: string): string => {
  const selector = `#${id} canvas`;
  const srcCanvas = <any>document.querySelector(selector);

  const destinationCanvas = document.createElement("canvas");
  destinationCanvas.width = srcCanvas.width;
  destinationCanvas.height = srcCanvas.height;

  const destCtx = destinationCanvas.getContext("2d")!;

  //create a rectangle with the desired color
  destCtx.fillStyle = "#FFFFFF";
  destCtx.fillRect(0, 0, srcCanvas.width, srcCanvas.height);

  //draw the original canvas onto the destination canvas
  destCtx.drawImage(srcCanvas, 0, 0);

  let imgBase64 = destinationCanvas.toDataURL("image/png");
  return imgBase64;
};
