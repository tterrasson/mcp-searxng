import { afterEach, describe, expect, mock, test } from "bun:test";
import { getCurrentLogLevel, logMessage, setLogLevel, shouldLog } from "../src/logging.js";

const originalConsoleError = console.error;

afterEach(() => {
  console.error = originalConsoleError;
  setLogLevel("info");
});

function mcpServerStub(sendLoggingMessage = mock(() => Promise.resolve())) {
  return { sendLoggingMessage } as any;
}

describe("logging", () => {
  test("filters messages below the configured level", () => {
    const sendLoggingMessage = mock(() => Promise.resolve());
    setLogLevel("warning");

    logMessage(mcpServerStub(sendLoggingMessage), "info", "hidden");
    logMessage(mcpServerStub(sendLoggingMessage), "error", "visible", { requestId: "abc" });

    expect(getCurrentLogLevel()).toBe("warning");
    expect(shouldLog("debug")).toBe(false);
    expect(shouldLog("warning")).toBe(true);
    expect(sendLoggingMessage).toHaveBeenCalledTimes(1);
    expect((sendLoggingMessage.mock.calls as any)[0][0]).toEqual({
      level: "error",
      data: { message: "visible", requestId: "abc" },
    });
  });

  test("wraps primitive log data under a data key", () => {
    const sendLoggingMessage = mock(() => Promise.resolve());

    logMessage(mcpServerStub(sendLoggingMessage), "info", "primitive", "details");

    expect((sendLoggingMessage.mock.calls as any)[0][0]).toEqual({
      level: "info",
      data: { message: "primitive", data: "details" },
    });
  });

  test("reports logging transport failures except benign disconnects", async () => {
    const consoleError = mock(() => undefined);
    console.error = consoleError as any;

    logMessage(
      mcpServerStub(mock(() => Promise.reject(new Error("Not connected")))),
      "info",
      "ignored",
    );
    logMessage(
      mcpServerStub(mock(() => Promise.reject(new Error("transport failed")))),
      "info",
      "reported",
    );

    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect((consoleError.mock.calls as any)[0][0]).toBe("Logging error:");
    expect(((consoleError.mock.calls as any)[0][1] as Error).message).toBe("transport failed");
  });

  test("reports synchronous send failures", () => {
    const consoleError = mock(() => undefined);
    console.error = consoleError as any;

    logMessage(
      mcpServerStub(mock(() => {
        throw new Error("sync failure");
      })),
      "info",
      "reported",
    );

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(((consoleError.mock.calls as any)[0][1] as Error).message).toBe("sync failure");
  });
});
