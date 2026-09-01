import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const inviteSource = readFileSync(
  resolve(process.cwd(), "src/pages/Invite.tsx"),
  "utf8",
);

describe("self-service access requests", () => {
  test("does not render the legacy QR invitation flow", () => {
    expect(inviteSource).toContain("AccessRequestsPanel");
    expect(inviteSource).toContain("Solicitudes de acceso");
    expect(inviteSource).not.toContain("qrcode");
    expect(inviteSource).not.toContain("QRCode");
    expect(inviteSource).not.toContain("QRScannerDialog");
  });

  test("keeps the compatibility route free of QR generation or external requests", () => {
    expect(inviteSource).not.toContain("api.qrserver.com");
    expect(inviteSource).not.toContain("generateQRCode");
    expect(inviteSource).not.toContain("inviteeEmail");
  });
});
