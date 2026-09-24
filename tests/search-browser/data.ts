export const paths = ["src/alpha.ts", "src/middle.ts", "src/target.ts"];
export const targetPath = paths[2];
export const lineCount = 1000;
export function content(path: string, old = false) {
  if (old && path !== targetPath) return "";
  if (path === "src/outside.ts") return "const outside = 1;\n";
  return Array.from({ length: lineCount }, (_, i) => {
    const name = path === targetPath && (i === 99 || i === 899) ? "needle" : "value";
    return `const ${name}_${i + 1} = ${old ? -1 : i + 1};`;
  }).join("\n") + "\n";
}

/** Synthetic API boundary; rendering, search sessions and navigation stay real. */
export function search(body: { scope: string; query: string; changedPaths?: string[] }) {
  const available = [...paths, "src/outside.ts"].filter(path => !body.changedPaths || body.changedPaths.includes(path));
  const query = body.query.trim().toLowerCase();
  const files = available.filter(path => path.includes(query)).map(path => ({
    path, fileName: path.split("/").pop(), gitStatus: "modified", matchType: "", exact: true,
  }));
  const text = query ? available.flatMap(path => content(path).split("\n").flatMap((line, i) => {
    const col = line.toLowerCase().indexOf(query);
    return col < 0 ? [] : [{ path, fileName: path.split("/").pop(), gitStatus: "modified",
      line: i + 1, col: col + 1, content: line, matchRanges: [[col, col + query.length]] }];
  })).slice(0, 60) : [];
  const symbols = text.map(hit => ({ ...hit, name: hit.content.split(" ")[1], kind: "variable" }));
  const items = body.scope === "files" ? files : body.scope === "symbols" ? symbols : body.scope === "all"
    ? [...files.map(hit => ({ kind: "file", hit })), ...text.map(hit => ({ kind: "text", hit }))] : text;
  return { scope: body.scope, items, total: items.length, indexing: false };
}
