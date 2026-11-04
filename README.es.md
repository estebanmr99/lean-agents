<div align="center">

<img src="docs/assets/banner.svg" alt="Banner de lean-agents" width="640">

# lean-agents

**Un comando. Todos tus agentes de código. Menos tokens, respuestas más claras.**

Las mismas reglas, subagentes baratos por defecto, herramientas que ahorran contexto y servidores MCP para Claude Code, OpenCode, GitHub Copilot CLI y Antigravity CLI, en macOS y Windows.

[Read in English](README.md)

</div>

> **Estado: versión preliminar v0.4.** El instalador funciona para **Claude Code**, **OpenCode 1.x y 2.x**, **GitHub Copilot CLI** y **Antigravity CLI** en macOS, Linux y Windows (Antigravity: macOS y Linux). Dale una estrella al repo para enterarte cuando salga `v1.0.0`.

<img src="docs/assets/demo.gif" alt="install.sh --dry-run lista cada archivo y comando que cambiaría" width="720">

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

Context Mode necesita Node.js 22.5 o superior. Todo lo demás funciona con Node.js 20.12.

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
| Presets de red (telemetría, updates, salidas) | ✅ | ✅ updates, compartir | ✅ | ⚠️ updates; telemetría es un recordatorio | ⚠️ solo recordatorios |
| Proxy en cada comando de instalación | ✅ | ✅ | ✅ | ✅ | ⚠️ probado en CI, sin docs upstream |

✅ soportado · ⚠️ parcial · ➖ no disponible para este agente. Detalles y fechas de verificación: [docs/compatibility.md](docs/compatibility.md).

## Niveles de instalación

| Nivel | Qué incluye | Por defecto |
| --- | --- | --- |
| Mínimo | Reglas, subagentes por costo, compactación, límites de salida, RTK, Context Mode | Siempre |
| Herramientas opcionales | Serena, Playwright, Ponytail, Caveman, i-have-adhd, DCP (OpenCode 1.x, AGPL-3.0), Codeburn | Se pregunta una por una |
| Herramientas por elección | GSD Core, AutoSkills (CC BY-NC 4.0: solo uso no comercial) | Se pregunta una por una, nunca en `--all-tools` |
| Privacidad estricta | Sin telemetría, sin auto updates, sin compartir sesiones, sin proveedores que entrenan con tus prompts | Apagado, se activa con `--privacy strict` |
| Preset de red | Todo apagado (PC de trabajo), todo encendido, o por categoría: telemetría, auto updates, otras salidas | Todo encendido; `--network off` o una opción por categoría |
| GitHub CLI (`gh`) | Se instala con brew o winget sin admin; tú corres `gh auth login` | Se pregunta si falta; `--gh` |

## En una PC de trabajo: proxy, red y revisión de seguridad

1. **Revisa primero.** Pega el prompt de [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md) en tu agente. Lista cada archivo, comando, host y herramienta, los compara con el código y te pide las páginas internas de TI o del proxy cuando no puede leerlas.
2. **Define tu proxy en tu propia terminal** antes de instalar, en mayúsculas o minúsculas:
   ```bash
   export HTTPS_PROXY=http://proxy.example:8080 NO_PROXY=localhost,127.0.0.1
   export NODE_EXTRA_CA_CERTS=/ruta/a/ca-empresa.pem   # si tu empresa inspecciona TLS
   ```
   El instalador pasa ambas formas a cada comando (brew y git leen minúsculas, uv mayúsculas) y las muestra en `--dry-run` y `--doctor` con la contraseña cambiada por `***`. Nunca las escribe en disco. Qué variable de CA lee cada herramienta: [docs/compatibility.md](docs/compatibility.md#proxy-and-corporate-ca).
3. **Elige un preset de red.** El instalador pregunta: **todo apagado** (PC de empresa), **todo encendido** (PC personal) o **por categoría**. Para correrlo sin preguntas:
   ```bash
   bash install.sh --dry-run --network off                    # todo apagado
   bash install.sh --yes --network off --auto-update on       # apagado, pero con auto updates
   ```
   Qué apaga cada categoría por agente: [docs/privacy.md](docs/privacy.md). La elección se guarda y `--update` la reutiliza.
4. **`gh`**: agrega `--gh` (o responde que sí) para instalar GitHub CLI sin admin; luego corre `gh auth login` tú mismo.

En una terminal real el instalador muestra menús (flechas, espacio para marcar), una lista de progreso y un resumen. Con `--yes`, con un pipe o sin terminal, hace preguntas simples o ninguna, como antes.

## Modelos siempre al día

Los subagentes piden un nivel (`fast`, `balanced`, `strong`), no un modelo. En Claude Code eso son los alias `haiku`, `sonnet` y `opus`. Los demás agentes usan [perfiles](profiles/) fechados por suscripción, y la skill `update-models` los actualiza con tu aprobación.

## Seguridad

- Respalda cada archivo antes de tocarlo. `--uninstall` lo restaura.
- Nunca sobrescribe tu `AGENTS.md` ni tu `CLAUDE.md`: los importa o agrega un bloque marcado.
- Nunca pide, guarda ni muestra API keys.
- No necesita permisos de administrador (`--no-admin`).
- Se puede revisar antes de instalar: [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md) es un prompt que tu agente corre sobre este repo.

## Créditos y licencia

Ver la sección de créditos en el [README en inglés](README.md#credits). Licencia [MIT](LICENSE).
