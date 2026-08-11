#!/usr/bin/env node
/**
 * Cut a diffing release: bump versions, generate the changelog section,
 * build + test, commit, tag, and push. CI (native-tui.yml) then builds the
 * native binaries, publishes to npm, and creates the GitHub release.
 *
 * Usage:
 *   node scripts/release.mjs [--patch|--minor|--major] [--no-verify] [--dry-run]
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

const bumpType = args.includes("--major")
	? "major"
	: args.includes("--minor")
		? "minor"
		: "patch";
const noVerify = args.includes("--no-verify");
const dryRun = args.includes("--dry-run");

if (
	args.some(
		(a) =>
			a !== "--patch" &&
			a !== "--minor" &&
			a !== "--major" &&
			a !== "--no-verify" &&
			a !== "--dry-run",
	)
) {
	console.error(
		"Usage: node scripts/release.mjs [--patch|--minor|--major] [--no-verify] [--dry-run]",
	);
	process.exit(1);
}

const run = (cmd, opts = {}) => {
	try {
		return execSync(cmd, {
			cwd: root,
			stdio: "pipe",
			encoding: "utf8",
			...opts,
		});
	} catch (error) {
		console.error(`command failed: ${cmd}`);
		if (error.stderr) console.error(error.stderr.toString().trim());
		process.exit(1);
	}
};
const log = (msg) => console.log(msg);

// ---------- helpers ----------

function bump(version, type) {
	const [major, minor, patch] = version.split(".").map(Number);
	if (type === "major") return `${major + 1}.0.0`;
	if (type === "minor") return `${major}.${minor + 1}.0`;
	return `${major}.${minor}.${patch + 1}`;
}

function replace(file, pattern, next) {
	const path = resolve(root, file);
	const source = readFileSync(path, "utf8");
	const match = source.match(pattern);
	if (!match) throw new Error(`could not locate version in ${file}`);
	const updated = source.replace(pattern, `$1${next}$2`);
	if (updated === source) throw new Error(`version already ${next} in ${file}`);
	if (dryRun) {
		log(`  would update ${file}: ${match[1]} → ${next}`);
	} else {
		writeFileSync(path, updated);
		log(`  ${file}: ${match[1]} → ${next}`);
	}
}

const changelogEntry = (shortHash, subject) =>
	`- ${shortHash}: ${subject.charAt(0).toUpperCase()}${subject.slice(1)}`;

// ---------- preflight ----------

if (!dryRun) {
	const dirty = run("git status --porcelain").trim();
	if (dirty) {
		console.error("working tree is not clean — commit or stash first:");
		console.error(dirty);
		process.exit(1);
	}
	const branch = run("git branch --show-current").trim();
	if (branch !== "main") {
		console.error(`must release from main (on ${branch})`);
		process.exit(1);
	}
	run("git fetch origin");
	const behind = run("git rev-list --count HEAD..origin/main").trim();
	const ahead = run("git rev-list --count origin/main..HEAD").trim();
	if (behind !== "0") {
		console.error(
			`main is ${behind} commit(s) behind origin/main — pull first`,
		);
		process.exit(1);
	}
	if (ahead !== "0") {
		console.error(
			`main is ${ahead} commit(s) ahead of origin/main — push first`,
		);
		process.exit(1);
	}
	log(`preflight OK: clean tree, on main, in sync with origin`);
}

// ---------- version bump ----------

const pkgPath = resolve(root, "package.json");
let pkg;
let current;
let next;
let tag;
let section;
try {
	pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
	current = pkg.version;
	next = bump(current, bumpType);
	tag = `v${next}`;
	section =
		bumpType === "major" ? "Major" : bumpType === "minor" ? "Minor" : "Patch";
} catch (error) {
	console.error(`failed to read ${pkgPath}: ${error.message}`);
	process.exit(1);
}

log(`\nRelease ${current} → ${next} (${bumpType})`);

if (dryRun) {
	log("\n[dry-run] would update:");
} else {
	log("\nUpdating versions:");
}

replace("package.json", /("version":\s*")[^"]+(")/, next);
replace(
	"Cargo.toml",
	/(\[workspace\.package\][^\n]*\n(?:[^[]*\n)*?version\s*=\s*")[^"]+(")/,
	next,
);
replace("Cargo.lock", /(name = "diffing-core"\nversion = ")[^"]+(")/, next);
replace("Cargo.lock", /(name = "diffing-tui"\nversion = ")[^"]+(")/, next);
replace(
	"site/src/layouts/BaseLayout.astro",
	/(__DIFFING_VERSION__ : ')[^']+(')/,
	next,
);
replace(
	"site/src/pages/index.astro",
	/(__DIFFING_VERSION__ : ')[^']+(')/,
	next,
);

// ---------- changelog ----------

const prevTag = (() => {
	try {
		return run("git describe --tags --abbrev=0 HEAD").trim();
	} catch {
		return null;
	}
})();

const entries = [];
if (prevTag) {
	const logLines = run(`git log --format=%h%x09%s ${prevTag}..HEAD`).trim();
	for (const line of logLines.split("\n").filter(Boolean)) {
		const [hash, ...rest] = line.split("\t");
		const subject = rest.join("\t");
		const match = subject.match(/^(feat|fix)(\(([^)]*)\))?!?:\s*(.+)$/);
		if (!match) continue; // skip chore/style/docs/refactor/merge/etc.
		if (match[3] === "release") continue; // release-maintenance commits are noise
		entries.push(changelogEntry(hash, match[4]));
	}
}
if (entries.length === 0) entries.push("- No user-facing changes");

const changelogPath = resolve(root, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
const newSection = `## ${next}\n\n### ${section} Changes\n\n${entries.join("\n")}\n\n`;
if (dryRun) {
	log("\n[dry-run] would prepend to CHANGELOG.md:");
	log(newSection.replace(/^/gm, "  ").replace(/\n*$/, ""));
} else {
	writeFileSync(changelogPath, newSection + changelog);
	log(
		`  CHANGELOG.md: prepended ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`,
	);
}

// ---------- verify ----------

if (!dryRun && !noVerify) {
	log("\nBuilding + testing (use --no-verify to skip)…");
	run("pnpm build && pnpm test", { stdio: "inherit" });
} else if (dryRun) {
	log("\n[dry-run] would run: pnpm build && pnpm test");
} else {
	log("\nSkipping build/test (--no-verify)");
}

// ---------- commit, tag, push ----------

if (dryRun) {
	log(`\n[dry-run] would run:`);
	log(`  git add -A`);
	log(`  git commit -m "chore(release): prepare ${tag}"`);
	log(`  git tag ${tag}`);
	log(`  git push origin main && git push origin ${tag}`);
	log("\nDry run complete — nothing was changed.");
	process.exit(0);
}

log(`\nCommitting ${tag}…`);
run("git add -A");
run(`git commit -m "chore(release): prepare ${tag}"`, { stdio: "inherit" });
run(`git tag ${tag}`);

log(`Pushing main + ${tag}…`);
run("git push origin main", { stdio: "inherit" });
run(`git push origin ${tag}`, { stdio: "inherit" });

log(
	`\n✅ Released ${tag} — CI (native-tui.yml) is now building binaries, publishing to npm,`,
);
log(`   and will create the GitHub release once the publish is verified.`);
log(
	`   ${process.env.GITHUB_REPOSITORY ? "" : "https://github.com/ahmedragab20/diffing/actions"}`,
);
