import { describe, expect, it } from "vitest";
import { diffReviewContextForAi } from "../diffContext";

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

describe("diffReviewContextForAi", () => {
	it("keeps the whole raw patch when no file is focused", () => {
		expect(diffReviewContextForAi(PATCH)).toMatchObject({ kind: "diff", patch: PATCH });
	});

	it("keeps whole-review scope while recording the viewport focus", () => {
		const result = diffReviewContextForAi(PATCH, { focusedFilePath: "apps/web/src/client.rs" });
		expect(result.kind).toBe("diff");
		expect(result.focusedFilePath).toBe("apps/web/src/client.rs");
		expect(result.patch).toContain("+pub const CATALOG_PATH");
		expect(result.patch).toContain("apps/web/src/app.rs");
		expect(result.patch).not.toContain("[object Object]");
	});

	it("includes stable review metadata without inventing empty values", () => {
		expect(diffReviewContextForAi(PATCH, { repoName: "demo", branch: "feature", focusedFilePath: null })).toMatchObject({
			kind: "diff",
			repoName: "demo",
			branch: "feature",
			patch: PATCH,
		});
	});
});
