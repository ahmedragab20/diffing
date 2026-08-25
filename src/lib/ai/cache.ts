/**
 * Small byte-bounded LRU cache for derived repository data. Values are only
 * cached after a successful load, and callers own the versioned cache key.
 */
export class ByteLruCache<T extends Uint8Array> {
	private readonly entries = new Map<string, { value: T; bytes: number }>();
	private totalBytes = 0;

	constructor(private readonly maxBytes = 4 * 1024 * 1024, private readonly maxEntries = 64) {}

	get(key: string): T | undefined {
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.value;
	}

	set(key: string, value: T): void {
		const bytes = value.byteLength;
		if (bytes > this.maxBytes) return;
		const existing = this.entries.get(key);
		if (existing) this.totalBytes -= existing.bytes;
		this.entries.delete(key);
		this.entries.set(key, { value, bytes });
		this.totalBytes += bytes;
		while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
			const oldest = this.entries.keys().next().value as string | undefined;
			if (!oldest) break;
			const removed = this.entries.get(oldest);
			this.entries.delete(oldest);
			if (removed) this.totalBytes -= removed.bytes;
		}
	}

	clear(): void {
		this.entries.clear();
		this.totalBytes = 0;
	}

	get size(): number {
		return this.entries.size;
	}

	get bytes(): number {
		return this.totalBytes;
	}
}
