import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const inviteSource = readFileSync(
  resolve(process.cwd(), "src/pages/Invite.tsx"),
  "utf8",
);

describe("local invitation QR generation", () => {
  test("generates the QR data URL locally", () => {
    expect(inviteSource).toContain('from "qrcode"');
    expect(inviteSource).toContain("QRCode.toDataURL");
    expect(inviteSource).toContain("qrCodeDataUrl");
    expect(inviteSource).not.toContain("api.qrserver.com");
  });
});
