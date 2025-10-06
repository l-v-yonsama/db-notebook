import { toPng } from "html-to-image";
import { nextTick } from "vue";

export const export2image = async ({
  fileName,
  selectors,
  pre,
  post,
}: {
  fileName: string;
  selectors: string | HTMLElement;
  pre?: () => Promise<void>;
  post?: () => Promise<void>;
}): Promise<void> => {
  let elm: HTMLElement | null = null;
  if (selectors instanceof HTMLElement) {
    elm = selectors;
  } else {
    elm = document.querySelector(selectors) as HTMLElement | null;
  }
  if (!elm) {
    return;
  }

  if (pre) {
    await pre();
  }
  await nextTick();
  let link = document.createElement("a");
  link.download = fileName;
  link.href = await toPng(elm);
  if (post) {
    await post();
    await nextTick();
  }
  link.click();
};
