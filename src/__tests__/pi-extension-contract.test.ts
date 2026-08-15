// @vitest-environment node
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	DIFFING_SKILL_NAMES,
	healSkillLink,
	selfHealSkillLinks,
} from "../../extensions/pi/skill-heal.ts";

const indexSrc = readFileSync(
	join(process.cwd(), "extensions/pi/index.ts"),
	"utf-8",
);

function registeredToolNames(src: string): string[] {
	return [...src.matchAll(/name:\s*"([^"]+)"/g)].map((match) => match[1]);
}

describe("pi extension contract", () => {
	it("registers the mockup + design surface the MCP catalog exposes", () => {
		const names = registeredToolNames(indexSrc);
		expect(names).toEqual(
			expect.arrayContaining([
				"diffing_mockup_submit",
				"diffing_mockup_await",
				"diffing_mockup_inspect",
				"diffing_mockup_screen",
				"diffing_mockup_threads",
				"diffing_mockup_handoff",
				"diffing_design",
			]),
		);
		expect(indexSrc).toMatch(
			/StringEnum\(\s*\[["']upsert["'],\s*["']remove["'],\s*["']patch["'],\s*["']replace-region["']\]/,
		);
		expect(indexSrc).toMatch(
			/\[["']summary["'],\s*["']comments["'],\s*["']comment["'],\s*["']screen["'],\s*["']preview["']\]/,
		);
		expect(indexSrc).toContain('--mode"');
		expect(indexSrc).toContain("--system");
		expect(indexSrc).toContain("--plan-id");
		expect(indexSrc).toContain("--region");
	});

	it("keeps the author skill in the self-heal set", () => {
		expect(DIFFING_SKILL_NAMES).toContain("diffing-mockup-author");
		expect(DIFFING_SKILL_NAMES).toContain("diffing-mockup-review");
	});
});

describe("healSkillLink", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function scratch(): string {
		const dir = mkdtempSync(join(tmpdir(), "pi-skill-heal-"));
		dirs.push(dir);
		return dir;
	}

	it("creates a missing symlink", () => {
		const dir = scratch();
		const target = join(dir, "target");
		const link = join(dir, "link");
		mkdirSync(target);
		expect(healSkillLink(link, target)).toBe("created");
		expect(healSkillLink(link, target)).toBe("ok");
	});

	it("repairs a dangling symlink and a stale real directory", () => {
		const dir = scratch();
		const target = join(dir, "target");
		const missing = join(dir, "gone");
		const dangling = join(dir, "dangling");
		const stale = join(dir, "stale");
		mkdirSync(target);
		symlinkSync(missing, dangling, "dir");
		mkdirSync(stale);
		writeFileSync(join(stale, "SKILL.md"), "old");
		expect(healSkillLink(dangling, target)).toBe("repaired");
		expect(healSkillLink(stale, target)).toBe("repaired");
		expect(healSkillLink(dangling, target)).toBe("ok");
	});

	it("self-heals a missing mockup-author link without throwing", () => {
		const dir = scratch();
		const canonical = join(dir, "repo");
		const homeSkills = join(dir, "home-skills");
		mkdirSync(join(canonical, ".agents", "skills", "diffing-mockup-author"), {
			recursive: true,
		});
		mkdirSync(homeSkills);
		selfHealSkillLinks(canonical, homeSkills);
		expect(healSkillLink(
			join(homeSkills, "diffing-mockup-author"),
			join(canonical, ".agents", "skills", "diffing-mockup-author"),
		)).toBe("ok");
	});
});
