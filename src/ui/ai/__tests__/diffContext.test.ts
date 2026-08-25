import { describe, expect, it } from "vitest";
import { diffPatchForAiContext } from "../diffContext";

const PATCH = `diff --git a/apps/web/src/client.rs b/apps/web/src/client.rs
new file mode 100644
--- /dev/null
+++ b/apps/web/src/client.rs
@@ -0,0 +1,2 @@
+pub const CATALOG_PATH: &str = "/api/v1/catalog";
+pub const MAX_RESPONSE_BYTES: usize = 64 * 1024;
diff --git a/apps/web/src/app.rs b/apps/web/src/app.rs
new file mode 100644
--- /dev/null
+++ b/apps/web/src/app.rs
@@ -0,0 +1 @@
+pub fn render() {}
`;

describe("diffPatchForAiContext", () => {
	it("keeps the whole raw patch when no file is active", () => {
		expect(diffPatchForAiContext(PATCH, null)).toBe(PATCH);
	});

	it("selects readable unified-diff text for the active file", () => {
		const result = diffPatchForAiContext(PATCH, "apps/web/src/client.rs");
		expect(result).toContain("diff --git a/apps/web/src/client.rs");
		expect(result).toContain("+pub const CATALOG_PATH");
		expect(result).not.toContain("apps/web/src/app.rs");
		expect(result).not.toContain("[object Object]");
	});

	it("falls back to the whole patch if a transient active path is absent", () => {
		expect(diffPatchForAiContext(PATCH, "missing.rs")).toBe(PATCH);
	});
});
