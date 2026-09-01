import { parseCloakBrowserLicenseKey } from "./cloakbrowser_license.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("CloakBrowser license key parser handles dotenv syntax", () => {
  assertEquals(
    parseCloakBrowserLicenseKey("OTHER=x\nCLOAKBROWSER_LICENSE_KEY=cb_plain\n"),
    "cb_plain",
  );
  assertEquals(
    parseCloakBrowserLicenseKey(
      "export CLOAKBROWSER_LICENSE_KEY='cb_quoted' # ignored outside quote",
    ),
    "cb_quoted",
  );
  assertEquals(
    parseCloakBrowserLicenseKey("CLOAKBROWSER_LICENSE_KEY=cb_value # comment"),
    "cb_value",
  );
  assertEquals(
    parseCloakBrowserLicenseKey("CLOAKBROWSER_LICENSE_KEY=   "),
    undefined,
  );
  assertEquals(parseCloakBrowserLicenseKey("OTHER=value"), undefined);
});
