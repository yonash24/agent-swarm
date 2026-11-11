import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { useCopyToClipboard } from "./use-copy-to-clipboard";

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let root: ReturnType<typeof createRoot>;
let current: ReturnType<typeof useCopyToClipboard>;
let writes: ReturnType<typeof deferred>[];
let timers: ReturnType<typeof spyOn<typeof globalThis, "setTimeout">>;

function Probe() {
  current = useCopyToClipboard();
  return <span>{current.copiedKey ?? "idle"}</span>;
}

beforeEach(async () => {
  writes = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: () => {
        const write = deferred();
        writes.push(write);
        return write.promise;
      },
    },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Probe />));
  timers = spyOn(globalThis, "setTimeout");
});

afterEach(async () => {
  await act(async () => root.unmount());
  timers.mockRestore();
  document.body.innerHTML = "";
});

describe("useCopyToClipboard", () => {
  test("keeps the latest copy and its reset timer when writes finish out of order", async () => {
    const older = current.copy("old value", "older");
    const newer = current.copy("new value", "newer");
    await act(async () => {
      writes[1]!.resolve();
      expect(await newer).toBe(true);
    });
    expect(current.copiedKey).toBe("newer");
    const resetCount = () => timers.mock.calls.filter((call) => call[1] === 1500).length;
    expect(resetCount()).toBe(1);

    await act(async () => {
      writes[0]!.resolve();
      expect(await older).toBe(true);
    });
    expect(current.copiedKey).toBe("newer");
    expect(resetCount()).toBe(1);
  });

  test("a failed newer copy preserves the last successful state and still supersedes older requests", async () => {
    const successful = current.copy("saved value", "saved");
    await act(async () => {
      writes[0]!.resolve();
      await successful;
    });
    const older = current.copy("old value", "older");
    const newer = current.copy("denied value", "newer");
    await act(async () => {
      writes[2]!.reject(new Error("Clipboard denied"));
      expect(await newer).toBe(false);
    });
    expect(current.copiedKey).toBe("saved");
    await act(async () => {
      writes[1]!.resolve();
      await older;
    });
    expect(current.copiedKey).toBe("saved");
  });
});
