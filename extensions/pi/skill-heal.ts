import {
	existsSync,
	lstatSync,
	realpathSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { join } from "node:path";

export const DIFFING_SKILL_NAMES = [
	"diffing",
	"diffing-finish-review",
	"diffing-mockup-author",
	"diffing-mockup-review",
	"diffing-plan-review",
	"diffing-pr-address",
	"diffing-pr-read",
	"diffing-release",
	"diffing-review",
	"diffing-start-review",
] as const;

export const SKILLS_REL = join(".agents", "skills");

/**
 * Point `link` at `target`. Creates a missing link, repairs a stale/dangling
 * one, and leaves a correct symlink alone. `existsSync` is false for both
 * missing paths and dangling symlinks, so this uses `lstat` and treats ENOENT
 * as "create".
 */
export function healSkillLink(
	link: string,
	target: string,
): "ok" | "created" | "repaired" {
	if (!existsSync(target)) return "ok";
	let st: ReturnType<typeof lstatSync> | null = null;
	try {
		st = lstatSync(link);
	} catch {
		st = null;
	}
	if (st) {
		if (st.isSymbolicLink()) {
			try {
				if (realpathSync(link) === realpathSync(target)) return "ok";
			} catch {
				// dangling or unreadable — fall through and replace
			}
		}
		rmSync(link, { recursive: true, force: true });
		symlinkSync(target, link, "dir");
		return "repaired";
	}
	symlinkSync(target, link, "dir");
	return "created";
}

/** Keep `~/.agents/skills/diffing*` as symlinks to the canonical checkout. */
export function selfHealSkillLinks(
	canonical: string,
	homeSkills: string,
): void {
	if (!existsSync(homeSkills)) return;
	for (const name of DIFFING_SKILL_NAMES) {
		const target = join(canonical, SKILLS_REL, name);
		if (!existsSync(target)) continue;
		try {
			healSkillLink(join(homeSkills, name), target);
		} catch {
			// best-effort; a failed heal must not break the session
		}
	}
}
