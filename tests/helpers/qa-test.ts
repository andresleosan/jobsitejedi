import { expect, test as base } from "@playwright/test";

type DiagnosticsFixture = {
  browserDiagnostics: void;
};

export const test = base.extend<DiagnosticsFixture>({
  browserDiagnostics: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack ?? error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
      });

      await use();

      if (errors.length > 0) {
        await testInfo.attach("browser-errors", {
          body: errors.join("\n"),
          contentType: "text/plain",
        });
        throw new Error(`Unexpected browser errors:\n${errors.join("\n")}`);
      }
    },
    { auto: true },
  ],
});

export { expect };
