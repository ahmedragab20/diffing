import { describe, it, expect } from "vitest";
import { resolveEditorCommand } from "../lib/editor-launcher.js";

describe("resolveEditorCommand", () => {
	// Each editor maps to a single `{ cmd, args }` per platform. We test the
	// mapping table — not the actual spawn — so the tests stay deterministic
	// across hosts and don't depend on any tool being installed.

	describe("GUI editors", () => {
		it("vscode on macOS uses bare `code`", () => {
			expect(
				resolveEditorCommand("vscode", "/Users/me/src/index.ts", "darwin"),
			).toEqual({
				cmd: "code",
				args: ["/Users/me/src/index.ts"],
			});
		});

		it("vscode on Linux uses bare `code`", () => {
			expect(
				resolveEditorCommand("vscode", "/home/me/src/index.ts", "linux"),
			).toEqual({
				cmd: "code",
				args: ["/home/me/src/index.ts"],
			});
		});

		it("vscode on Windows uses `code.cmd`", () => {
			// PATHEXT resolution only works with `shell: true`, which we avoid for
			// argument-quoting safety — so we name the `.cmd` directly.
			expect(
				resolveEditorCommand("vscode", "C:\\Users\\me\\src\\index.ts", "win32"),
			).toEqual({
				cmd: "code.cmd",
				args: ["C:\\Users\\me\\src\\index.ts"],
			});
		});

		it("zed on Windows uses `zed.cmd`", () => {
			expect(
				resolveEditorCommand("zed", "C:\\Users\\me\\src\\index.ts", "win32"),
			).toEqual({
				cmd: "zed.cmd",
				args: ["C:\\Users\\me\\src\\index.ts"],
			});
		});

		it("zed on Linux uses bare `zed`", () => {
			expect(
				resolveEditorCommand("zed", "/home/me/src/index.ts", "linux"),
			).toEqual({
				cmd: "zed",
				args: ["/home/me/src/index.ts"],
			});
		});

		it("handles paths containing spaces without quoting", () => {
			// execFile (not exec) does its own argument handling — we must NOT
			// pre-quote, or we'd end up with `"file with space.ts"` (literal
			// quotes) inside the editor.
			const cmd = resolveEditorCommand(
				"vscode",
				"/Users/me/My Docs/file.ts",
				"darwin",
			)!;
			expect(cmd.args[0]).toBe("/Users/me/My Docs/file.ts");
			expect(cmd.args[0]).not.toMatch(/^"/);
		});
	});

	describe("terminal editors — macOS", () => {
		it("vim on macOS goes through osascript + Terminal.app", () => {
			const cmd = resolveEditorCommand(
				"vim",
				"/Users/me/file.ts",
				"darwin",
				{},
			)!;
			expect(cmd.cmd).toBe("osascript");
			expect(cmd.args[0]).toBe("-e");
			expect(cmd.args[1]).toContain('tell application "Terminal"');
			expect(cmd.args[1]).toContain("vim");
			expect(cmd.args[1]).toContain("/Users/me/file.ts");
		});

		it("neovim on macOS uses nvim, not vim", () => {
			const cmd = resolveEditorCommand(
				"neovim",
				"/Users/me/file.ts",
				"darwin",
				{},
			)!;
			expect(cmd.args[1]).toContain("nvim");
			expect(cmd.args[1]).not.toContain(" vim ");
		});

		it("uses AppleScript quoted form for terminal editor paths", () => {
			const cmd = resolveEditorCommand(
				"vim",
				'/Users/me/he said "hi".txt',
				"darwin",
				{},
			)!;
			expect(cmd.args[1]).toContain("quoted form of");
			expect(cmd.args[1]).toMatch(
				/quoted form of "\/Users\/me\/he said \\"hi\\"\.txt"/,
			);
		});
	});

	describe("ghostty (nvim in a Ghostty window)", () => {
		it("macOS uses `open -na Ghostty --args -e nvim` (Ghostty CLI actions are unsupported there)", () => {
			expect(
				resolveEditorCommand("ghostty", "/Users/me/file.ts", "darwin"),
			).toEqual({
				cmd: "open",
				args: ["-na", "Ghostty", "--args", "-e", "nvim", "/Users/me/file.ts"],
			});
		});

		it("Linux runs the ghostty binary directly", () => {
			expect(
				resolveEditorCommand("ghostty", "/home/me/file.ts", "linux"),
			).toEqual({
				cmd: "ghostty",
				args: ["-e", "nvim", "/home/me/file.ts"],
			});
		});

		it("passes paths with spaces as a single argv entry (no shell quoting)", () => {
			const cmd = resolveEditorCommand(
				"ghostty",
				"/Users/me/My Docs/file.ts",
				"darwin",
			)!;
			expect(cmd.args.at(-1)).toBe("/Users/me/My Docs/file.ts");
			expect(cmd.args.at(-1)).not.toMatch(/^"|"$/);
		});

		it("Windows has no Ghostty build — returns null so the caller falls back to the default opener", () => {
			expect(
				resolveEditorCommand("ghostty", "C:\\Users\\me\\file.ts", "win32"),
			).toBeNull();
		});
	});

	describe("terminal editors — Windows", () => {
		it("vim on Windows opens a new console via cmd.exe /c start", () => {
			const cmd = resolveEditorCommand(
				"vim",
				"C:\\Users\\me\\file.ts",
				"win32",
				{},
			)!;
			expect(cmd.cmd).toBe("cmd.exe");
			// /c → execute then exit, start → new window, "" → empty title slot,
			// cmd.exe /k → keep the console alive after vim exits.
			expect(cmd.args.slice(0, 6)).toEqual([
				"/c",
				"start",
				'""',
				"cmd.exe",
				"/k",
				"vim",
			]);
			expect(cmd.args[6]).toBe("C:\\Users\\me\\file.ts");
		});

		it("neovim on Windows uses nvim", () => {
			const cmd = resolveEditorCommand(
				"neovim",
				"C:\\Users\\me\\file.ts",
				"win32",
				{},
			)!;
			expect(cmd.args).toContain("nvim");
			expect(cmd.args).not.toContain("vim");
		});

		it("preserves Windows path separators in the editor arg", () => {
			const cmd = resolveEditorCommand(
				"vim",
				"C:\\Program Files\\thing\\f.txt",
				"win32",
				{},
			)!;
			// The path comes through as the last argv element, untouched.
			expect(cmd.args.at(-1)).toBe("C:\\Program Files\\thing\\f.txt");
		});
	});

	describe("terminal editors — Linux", () => {
		it("honours $TERMINAL when set", () => {
			const cmd = resolveEditorCommand("vim", "/home/me/file.ts", "linux", {
				TERMINAL: "alacritty",
			})!;
			expect(cmd).toEqual({
				cmd: "alacritty",
				args: ["-e", "vim", "/home/me/file.ts"],
			});
		});

		it("trims surrounding whitespace from $TERMINAL", () => {
			const cmd = resolveEditorCommand("vim", "/home/me/file.ts", "linux", {
				TERMINAL: "  kitty  ",
			})!;
			expect(cmd.cmd).toBe("kitty");
		});

		it("ignores empty $TERMINAL and falls back to x-terminal-emulator", () => {
			const cmd = resolveEditorCommand("vim", "/home/me/file.ts", "linux", {
				TERMINAL: "   ",
			})!;
			expect(cmd.cmd).toBe("x-terminal-emulator");
		});

		it("falls back to x-terminal-emulator when $TERMINAL is missing", () => {
			expect(
				resolveEditorCommand("neovim", "/home/me/file.ts", "linux", {}),
			).toEqual({
				cmd: "x-terminal-emulator",
				args: ["-e", "nvim", "/home/me/file.ts"],
			});
		});
	});

	describe("error / unknown editor handling", () => {
		it("returns null for an unrecognised editor", () => {
			// Cast through `any` to bypass the type system the way a stale
			// settings.json or a future UI bug might at runtime.
			expect(
				resolveEditorCommand("emacs" as any, "/file", "linux", {}),
			).toBeNull();
		});
	});
});
