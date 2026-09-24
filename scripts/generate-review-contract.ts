import { writeFile } from "node:fs/promises";
import { reviewProtocolDocument } from "../src/lib/review-protocol.js";
await writeFile(new URL("../docs/review-core-contract.json", import.meta.url), JSON.stringify(reviewProtocolDocument(), null, 2) + "\n");
