<div align="center">

# lean-agents

**Un comando. Todos tus agentes de código. Menos tokens, respuestas más claras.**

Las mismas reglas, subagentes baratos por defecto, herramientas que ahorran contexto y servidores MCP para Claude Code, OpenCode, GitHub Copilot CLI y Antigravity CLI, en macOS y Windows.

[Read in English](README.md)

</div>

> **Estado: versión preliminar v0.4.** El instalador funciona para **Claude Code**, **OpenCode 1.x y 2.x**, **GitHub Copilot CLI** y **Antigravity CLI** en macOS, Linux y Windows (Antigravity: macOS y Linux). Dale una estrella al repo para enterarte cuando salga `v1.0.0`.

## Inicio rápido

macOS, Linux o Git Bash:

```bash
curl -fsSL https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.sh | bash -s -- --dry-run
```

Windows PowerShell:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.ps1))) -DryRun
```

¿Prefieres que lo haga tu agente? Pega un prompt de [INSTALL_WITH_AGENT.md](INSTALL_WITH_AGENT.md) en Claude Code, OpenCode o Copilot CLI. Usa `--lang es` para que las reglas y las respuestas queden en español.

Empieza siempre con `--dry-run`: muestra cada archivo y comando antes de cambiar nada. En PowerShell las mismas opciones van en PascalCase: `-DryRun`, `-AllTools`, `-Privacy strict`, `-Profile vertex-gemini`.

Context Mode necesita Node.js 22.5 o superior. Todo lo demás funciona con Node.js 20.

## Por qué

- **Menos tokens.** Explorar, investigar y revisar lo hacen subagentes baratos. Las salidas grandes no entran al contexto. Los agentes buscan símbolos en vez de leer archivos completos.
- **Respuestas más claras.** Un solo set corto de reglas: primero la respuesta, supuestos explícitos, cambios quirúrgicos, verificar antes de decir que terminó.
- **Igual en todos lados.** Las reglas se escriben una vez en `core/` y se adaptan a cada agente.

## Qué incluye

| Función | Claude Code | OpenCode 2.x | OpenCode 1.x | Copilot CLI | Antigravity CLI |
| --- | --- | --- | --- | --- | --- |
| Reglas globales (AGENTS.md) | ✅ | ✅ | ✅ | ✅ | ⚠️ se escriben, carga sin probar |
| Subagentes por costo | ✅ | ✅ | ✅ | ✅ | ✅ flash, pro |
| RTK (comprime la salida del shell) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Context Mode | ✅ plugin | ✅ MCP | ✅ plugin | ✅ plugin | ✅ plugin |
| Serena + Playwright MCP | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ponytail | ✅ | ✅ | ✅ | ➖ | ➖ |
| i-have-adhd | ✅ | ✅ | ✅ | ✅ | ⚠️ se escribe, carga sin probar |
| Caveman y otras skills | ✅ | ✅ | ✅ | ✅ | ⚠️ se escriben, carga sin probar |
| Compactación de contexto | ✅ auto 80% | ✅ nativa | ✅ nativa, DCP opcional | ➖ | ➖ |

✅ soportado · ⚠️ parcial · ➖ no disponible para este agente. Detalles y fechas de verificación: [docs/compatibility.md](docs/compatibility.md).

## Niveles de instalación

| Nivel | Qué incluye | Por defecto |
| --- | --- | --- |
| Mínimo | Reglas, subagentes por costo, compactación, límites de salida, RTK, Context Mode | Siempre |
| Herramientas opcionales | Serena, Playwright, Ponytail, Caveman, i-have-adhd, DCP (OpenCode 1.x, AGPL-3.0), Codeburn | Se pregunta una por una |
| Herramientas por elección | GSD Core, AutoSkills (CC BY-NC 4.0: solo uso no comercial) | Se pregunta una por una, nunca en `--all-tools` |
| Privacidad estricta | Sin telemetría, sin auto updates, sin compartir sesiones, sin proveedores que entrenan con tus prompts | Apagado, se activa con `--privacy strict` |

## Modelos siempre al día

Los subagentes piden un nivel (`fast`, `balanced`, `strong`), no un modelo. En Claude Code eso son los alias `haiku`, `sonnet` y `opus`. Los demás agentes usan [perfiles](profiles/) fechados por suscripción, y la skill `update-models` los actualiza con tu aprobación.

## Seguridad

- Respalda cada archivo antes de tocarlo. `--uninstall` lo restaura.
- Nunca sobrescribe tu `AGENTS.md` ni tu `CLAUDE.md`: los importa o agrega un bloque marcado.
- Nunca pide, guarda ni muestra API keys.
- No necesita permisos de administrador (`--no-admin`).

## Créditos y licencia

Ver la sección de créditos en el [README en inglés](README.md#credits). Licencia [MIT](LICENSE).
