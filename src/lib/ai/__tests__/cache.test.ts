import { describe, expect, it } from "vitest";
import { ByteLruCache } from "../cache.js";

describe("ByteLruCache", () => {
	it("evicts least-recently-used values within byte and entry bounds", () => {
		const cache = new ByteLruCache<Uint8Array>(5, 2);
		cache.set("a", new Uint8Array([1, 2, 3]));
		cache.set("b", new Uint8Array([4, 5]));
		expect(cache.get("a")).toEqual(new Uint8Array([1, 2, 3]));
		cache.set("c", new Uint8Array([6, 7]));
		expect(cache.get("b")).toBeUndefined();
		expect(cache.get("a")).toEqual(new Uint8Array([1, 2, 3]));
		expect(cache.get("c")).toEqual(new Uint8Array([6, 7]));
	});
});
