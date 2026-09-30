

# diffing

<p align="center">
  <img src="public/favicon.svg" alt="diffing brand icon" width="72" height="72" />
</p>

**CLI local-first para revisar diferencias de git con humanos y agentes de IA.**

Abre tus cambios en una interfaz web similar a GitHub (o una TUI nativa experimental), deja comentarios en línea, entrégaselos a tu agente de programación a través de CLI/MCP y revisa **planos de implementación** de la misma manera antes de escribir cualquier código. Todo se vincula a loopback por defecto: sin cuentas, sin nube.

**npm:** [npmjs.com/package/diffing](https://www.npmjs.com/package/diffing) · **Documentación:** [ahmedragab20.github.io/diffing](https://ahmedragab20.github.io/diffing/) · **Agentes:** [llms.txt](https://ahmedragab20.github.io/diffing/llms.txt)

---

## Inicio rápido

**Requisitos:** Node.js 20+, `git` en tu PATH.

```bash
npm install -g diffing
# or: pnpm add -g diffing

diffing setup          # first-time wizard (skills, MCP, doctor)
cd your-repo
diffing                # preferred interactive UI (web by default)
```

Variantes útiles:

```bash
diffing --staged
diffing main..feature
diffing view           # read-only native diff browser
diffing --tui          # full native review TUI (experimental)
diffing mode tui       # make TUI the interactive default
diffing update
```

TTY abre la interfaz interactiva. El piping o redirección imprime un parche unificado como `git diff`.

---

## Qué obtienes

| Área | Destacados |
|------|------------|
| **Interfaz de revisión** | Diferencias divididas/unificadas, comentarios en línea + severidad, sugerencias, diferencias de imágenes, temas (52), búsqueda |
| **Agentes** | `await-review`, responder/resolver, progreso, MCP (**37** herramientas), habilidades mediante `npx skills add ahmedragab20/diffing` |
| **Revisión de planes** | Enviar markdown → veredicto humano → aprobado / cambios-solicitados / rechazado |
| **GitHub PR** | Sesiones de PR locales (`--gh-pr`), inspección acotada, publicación autorizada opcional |
| **Sesiones** | Revisiones concurrentes web/TUI/PR; gestor de tareas `diffing sessions` |
| **Local-first** | `127.0.0.1`, puerto libre aleatorio, estado bajo `~/.diffing/` |

> **La TUI es experimental.** Web es la ruta de producción soportada. Ver [documentación](https://ahmedragab20.github.io/diffing/docs/guides/tui/).

---

## Comandos rápidos para agentes

```bash
diffing                          # human reviews in browser
diffing url                      # share link; async park by default
diffing await-review             # only when human is reviewing now
diffing comments --open
diffing reply <id> --body "…" --model "your-model"
diffing resolve <id>
diffing plan submit PLAN.md --model "your-model"
diffing mcp
```

Protocolo completo de agentes, códigos de salida y catálogo MCP: **[Documentación](https://ahmedragab20.github.io/diffing/docs/)** · en el repositorio [AGENTS.md](./AGENTS.md).

---

## Documentación

| | |
|--|--|
| Inicio | https://ahmedragab20.github.io/diffing/docs/getting-started/ |
| Transferencia a agente | https://ahmedragab20.github.io/diffing/docs/guides/agent-handoff/ |
| Revisión de planes | https://ahmedragab20.github.io/diffing/docs/guides/plan-review/ |
| Referencia CLI | https://ahmedragab20.github.io/diffing/docs/reference/cli/ |
| Herramientas MCP | https://ahmedragab20.github.io/diffing/docs/reference/mcp/ |
| Teclado | https://ahmedragab20.github.io/diffing/docs/reference/keyboard/ |
| Diseño (Gridline) | https://ahmedragab20.github.io/diffing/docs/design/gridline/ |
| llms.txt | https://ahmedragab20.github.io/diffing/llms.txt |

Vista previa del sitio local (para colaboradores):

```bash
pnpm --dir site install --ignore-workspace
pnpm docs:dev
```

---

## Enlaces

- **npm:** https://www.npmjs.com/package/diffing
- **GitHub:** https://github.com/ahmedragab20/diffing
- **Documentación:** https://ahmedragab20.github.io/diffing/

## Licencia

MIT · [github.com/ahmedragab20/diffing](https://github.com/ahmedragab20/diffing)
