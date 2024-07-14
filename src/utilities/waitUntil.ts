import { sleep } from "@l-v-yonsama/rdh";

export const waitUntil = async (predicate: () => boolean, interval = 500, timeout = 30 * 1000) => {
  const start = Date.now();

  let done = false;

  do {
    if (predicate()) {
      done = true;
    } else if (Date.now() > start + timeout) {
      throw new Error(`Timed out waiting for predicate to return true after ${timeout}ms.`);
    }

    await sleep(interval);
  } while (done !== true);
};
