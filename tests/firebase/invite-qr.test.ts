import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";

vi.mock("html5-qrcode", () => ({
  Html5Qrcode: class Html5QrcodeMock {},
}));

import { extractInvitationCode } from "../../src/components/auth/QRScannerDialog";

const inviteSource = readFileSync(
  resolve(process.cwd(), "src/pages/Invite.tsx"),
  "utf8",
);

describe("local invitation QR generation", () => {
  test("generates the QR data URL locally", () => {
    expect(inviteSource).toContain('from "qrcode"');
    expect(inviteSource).toContain("QRCode.toDataURL");
    expect(inviteSource).toContain("qrCodeDataUrl");
    expect(inviteSource).toContain("/auth#code=");
    expect(inviteSource).not.toContain("/auth?code=");
    expect(inviteSource).not.toContain("api.qrserver.com");
  });
});

describe("invitation QR scanner payloads", () => {
  const appOrigin = "https://jedi.example";
  const code = "A1B2C3D4E5F6";

  test.each([
    [`${appOrigin}/auth#code=${code}`, code],
    [`${appOrigin}/auth?code=${code}`, code],
    [`${appOrigin}/auth#source=qr&code=${code}`, code],
    [`  ${code.toLowerCase()}  `, code],
  ])("accepts supported payload %s", (payload, expected) => {
    expect(extractInvitationCode(payload, appOrigin)).toBe(expected);
  });

  test("allows insecure HTTP only for the exact loopback origin", () => {
    const loopbackOrigin = "http://127.0.0.1:8080";

    expect(
      extractInvitationCode(
        `${loopbackOrigin}/auth#code=${code}`,
        loopbackOrigin,
      ),
    ).toBe(code);
    expect(
      extractInvitationCode(
        `http://localhost:8080/auth#code=${code}`,
        loopbackOrigin,
      ),
    ).toBeNull();
  });

  test.each([
    [`https://evil.example/auth#code=${code}`, "foreign host"],
    [`https://jedi.example.evil.example/auth#code=${code}`, "deceptive host"],
    [`http://jedi.example/auth#code=${code}`, "non-loopback HTTP"],
    [`javascript:alert(1)#code=${code}`, "JavaScript scheme"],
    [`data:text/plain,#code=${code}`, "data scheme"],
    [`ftp://jedi.example/auth#code=${code}`, "FTP scheme"],
    [`${appOrigin}/other#code=${code}`, "unexpected path"],
    [`${appOrigin}/auth?code=${code}#code=ABCDEF123456`, "conflicting sources"],
    [`${appOrigin}/auth#code=NOT-A-CODE`, "invalid code"],
    ["https://jedi.example@evil.example/auth#code=A1B2C3D4E5F6", "userinfo spoof"],
  ])("rejects %s (%s)", (payload) => {
    expect(extractInvitationCode(payload, appOrigin)).toBeNull();
  });
});
