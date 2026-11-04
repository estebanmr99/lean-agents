<div align="center">

<img src="docs/assets/banner.svg" alt="Banner de lean-agents" width="640">

# lean-agents

**Un comando. Todos tus agentes de código. Menos tokens, respuestas más claras.**

Las mismas reglas, subagentes baratos por defecto, herramientas que ahorran contexto y servidores MCP para Claude Code, OpenCode 1.x y 2.x, GitHub Copilot CLI, Antigravity CLI, VS Code Copilot y Cursor, en macOS, Linux y Windows.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows-lightgrey)
![Agents](https://img.shields.io/badge/agents-Claude%20Code%20%7C%20OpenCode%20%7C%20Copilot%20CLI%20%7C%20Antigravity%20%7C%20VS%20Code%20Copilot%20%7C%20Cursor-8A2BE2)
[![CI](https://github.com/estebanmr99/lean-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/estebanmr99/lean-agents/actions/workflows/ci.yml)
[![Secret scan](https://github.com/estebanmr99/lean-agents/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/estebanmr99/lean-agents/actions/workflows/secret-scan.yml)
![GitHub stars](https://img.shields.io/github/stars/estebanmr99/lean-agents?style=social)

[Read in English](README.md)

</div>

> **Estado: versión preliminar v0.4.** El instalador funciona para **Claude Code**, **OpenCode 1.x y 2.x**, **GitHub Copilot CLI**, **Antigravity CLI**, **VS Code Copilot** y **Cursor** en macOS, Linux y Windows (Antigravity: macOS y Linux). Dale una estrella al repo para enterarte cuando salga `v1.0.0`.

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

Empieza siempre con `--dry-run`: muestra cada archivo y comando antes de cambiar nada. Luego córrelo otra vez sin `--dry-run`; te pregunta qué agentes, herramientas, nivel de privacidad, idioma y perfil de modelos quieres. Opciones útiles: `--all-tools`, `--privacy strict`, `--lang es`, `--profile vertex-gemini`, `--update`, `--uninstall`, `--doctor` (`--help` las lista todas). En PowerShell las opciones comunes van en PascalCase: `-DryRun`, `-AllTools`, `-Privacy strict`, `-Profile vertex-gemini`. Cualquier otra opción se pasa tal cual, por ejemplo `-DryRun --network off`.

Context Mode necesita Node.js 22.5 o superior. Todo lo demás funciona con Node.js 20.12.

## Demo: OpenCode con modelos de GitHub Copilot

1. Instala OpenCode (macOS, Linux o Git Bash). En Windows, mira la [documentación de OpenCode](https://opencode.ai/docs):
   ```bash
   curl -fsSL https://opencode.ai/v2/install | bash
   ```
2. Mira qué cambiaría lean-agents:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.sh | bash -s -- --agents opencode-v2 --profile github-copilot --dry-run
   ```
   ```powershell
   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.ps1))) -Agents opencode-v2 -Profile github-copilot -DryRun
   ```
3. Corre lo mismo sin el dry run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.sh | bash -s -- --agents opencode-v2 --profile github-copilot
   ```
   ```powershell
   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.ps1))) -Agents opencode-v2 -Profile github-copilot
   ```
4. Abre `opencode`, ejecuta `/connect`, elige GitHub Copilot e inicia sesión con tu cuenta de GitHub (necesita un plan de Copilot). lean-agents nunca maneja el inicio de sesión. Los subagentes usan el perfil `github-copilot`: `fast` = claude-haiku-5.5, `balanced` = claude-sonnet-5.5, `strong` = claude-opus-5.5. No se usan modelos gratuitos de OpenCode.
5. Revisa el resultado:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.sh | bash -s -- --doctor
   ```

Las demos para Claude Desktop y Cursor vienen después.

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
| Navegador con tu sesión (opcional) | ➖ Claude in Chrome | ✅ opcional | ✅ opcional | ✅ opcional | ➖ |
| Ponytail | ✅ | ✅ | ✅ | ➖ | ➖ |
| i-have-adhd | ✅ | ✅ | ✅ | ✅ | ⚠️ se escribe, carga sin probar |
| Caveman y otras skills | ✅ | ✅ | ✅ | ✅ | ⚠️ se escriben, carga sin probar |
| Compactación de contexto | ✅ auto 80% | ✅ nativa | ✅ nativa, DCP opcional | ➖ | ➖ |
| Presets de red (telemetría, updates, salidas) | ✅ | ✅ updates, compartir | ✅ | ⚠️ updates; telemetría es un recordatorio | ⚠️ solo recordatorios |
| Proxy en cada comando de instalación | ✅ | ✅ | ✅ | ✅ | ⚠️ probado en CI, sin docs upstream |

✅ soportado · ⚠️ parcial · ➖ no disponible para este agente. Detalles y fechas de verificación: [docs/compatibility.md](docs/compatibility.md).

| Función | VS Code Copilot | Cursor (IDE y CLI) | Repo del equipo (`--project`) |
| --- | --- | --- | --- |
| Reglas | ⚠️ se escriben, carga sin probar | ➖ solo en ajustes, usa `--project` | ✅ `AGENTS.md` |
| Subagentes | ⚠️ se escriben, carga sin probar | ⚠️ se escriben, carga sin probar | ✅ `.github/agents`; ⚠️ `.cursor/agents` (carga en Cursor CLI sin verificar) |
| RTK | ⚠️ solo a través de Copilot CLI | ✅ | ➖ por usuario |
| Context Mode, Serena, Playwright | ✅ MCP | ✅ MCP | ✅ `.vscode/mcp.json`, `.cursor/mcp.json` |
| Navegador con tu sesión (opcional) | ✅ opcional | ✅ opcional | ➖ por usuario |
| Skills Caveman, i-have-adhd | ⚠️ se escriben, carga sin probar | ⚠️ se escriben, carga sin probar | ➖ por usuario |

**Próximamente: soporte completo de Antigravity.** Hoy lean-agents configura Antigravity CLI (`agy`) en macOS y Linux. Lo siguiente es la app de escritorio de Antigravity y la CLI en Windows. Según la documentación oficial, la app y la CLI leen las mismas reglas, subagentes, skills y servidores MCP, así que una sola configuración serviría para ambas en macOS, Windows y Linux. Cada parte sale solo cuando CI la prueba con binarios reales. Plan: [Session 11](docs/SPEC.md#session-11--antigravity-full-setup) (en inglés).

## Navegador con tu sesión (opcional)

El MCP `playwright` por defecto abre un navegador nuevo sin ventana, que falla en páginas con inicio de sesión único (SSO). `--tools playwright-extension` agrega `@playwright/mcp --extension`. Se conecta a tu propio Chrome o Edge con la sesión iniciada, a través de la [extensión de Playwright](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm).

- Instala la extensión tú mismo. Las extensiones no se pueden instalar en silencio sin una política de administrador.
- Cada sesión te pide aprobar la conexión. Aprobar solo con un token es opcional: mira [docs/browser-extension.md](docs/browser-extension.md). El instalador nunca pide, guarda ni muestra el token.
- Funciona con OpenCode, Copilot CLI, VS Code Copilot y Cursor. Claude Code y Claude Desktop usan Claude in Chrome.

## VS Code Copilot y Cursor

lean-agents configura el chat de Copilot en VS Code y Cursor (el editor y su CLI `agent`) igual que los demás agentes:

- **VS Code Copilot:** reglas en `~/.copilot/copilot-instructions.md`, subagentes en `~/.copilot/agents/`, servidores MCP en tu `mcp.json` de usuario de VS Code, y skills. Copilot CLI lee los mismos archivos de `~/.copilot`, así que con los dos se escriben una sola vez.
- **Cursor:** subagentes en `~/.cursor/agents/`, servidores MCP en `~/.cursor/mcp.json`, el hook de RTK y skills. Cursor guarda las reglas de usuario en su pantalla de ajustes, no en un archivo, así que lean-agents no puede escribirlas. Usa el modo equipo de abajo para darle a Cursor las reglas a través del `AGENTS.md` del repo.

```bash
curl -fsSL https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.sh | bash -s -- --dry-run --agents vscode-copilot,cursor
```

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.ps1))) -DryRun -Agents vscode-copilot,cursor
```

Quita `--dry-run` (`-DryRun`) para aplicar. `--uninstall` lo quita todo otra vez.

## Modo equipo (`--project`)

Pone la configuración compartida en un repositorio, así todo el equipo la recibe con `git pull`:

| Archivo | Qué hace |
| --- | --- |
| `AGENTS.md` | Las reglas, en un bloque marcado; tu propio texto se queda |
| `.github/copilot-instructions.md`, `.cursor/rules/lean-agents.mdc` | Una línea que apunta a `AGENTS.md`, para que las reglas se carguen una vez |
| `.github/agents/*.agent.md`, `.cursor/agents/*.md` | Subagentes por nivel para VS Code Copilot y Cursor |
| `.vscode/mcp.json`, `.cursor/mcp.json` | Context Mode, y Serena y Playwright si los eliges |

Ejecútalo desde la raíz del repositorio, revisa el plan, aplica y haz commit:

```bash
curl -fsSL https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.sh | bash -s -- --project . --dry-run --tools serena
curl -fsSL https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.sh | bash -s -- --project . --tools serena
git add AGENTS.md .github .vscode .cursor && git commit -m "chore: add lean-agents team setup"
```

En Windows: `& ([scriptblock]::Create((irm https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.ps1))) -Project . -DryRun`. Después, `--project . --update` vuelve a aplicar tus opciones guardadas y `--project . --uninstall` quita solo lo que añadió lean-agents. El modo equipo solo escribe archivos. Cada persona del equipo ejecuta el instalador una vez para las herramientas que mencionan las reglas (RTK, Context Mode y las demás), y su estado se guarda en su propia carpeta de usuario, nunca en el repo.

## Claude a través de GitHub Copilot

Si tu empresa paga GitHub Copilot, la forma oficial de usar Claude como agente es el **agente de código Claude**, un agente asociado de Copilot que activa un administrador. lean-agents no instala nada para esto, porque es un ajuste de políticas, no un paquete. Las herramientas que reutilizan un token de Copilot para ejecutar la CLI de Claude Code no son oficiales y no están soportadas. Pasos y ajustes de administración (en inglés): [docs/claude-with-copilot.md](docs/claude-with-copilot.md).

## Niveles de instalación

| Nivel | Qué incluye | Por defecto |
| --- | --- | --- |
| Mínimo | Reglas, subagentes por costo, compactación, límites de salida, RTK, Context Mode | Siempre |
| Herramientas opcionales | Serena, Playwright, Ponytail, Caveman, i-have-adhd, DCP (OpenCode 1.x, AGPL-3.0), Codeburn | Se pregunta una por una |
| Herramientas por elección | GSD Core, AutoSkills (CC BY-NC 4.0: solo uso no comercial) | Se pregunta una por una, nunca en `--all-tools` |
| Privacidad estricta | Sin telemetría, sin auto updates, sin compartir sesiones, sin proveedores que entrenan con tus prompts | Apagado, se activa con `--privacy strict` |
| Preset de red | Todo apagado (PC de trabajo), todo encendido, o por categoría: telemetría, auto updates, otras salidas | Todo encendido; `--network off` (igual que `--privacy strict`) o `--telemetry`, `--auto-update`, `--outbound` |
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
   curl -fsSL https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.sh | bash -s -- --dry-run --network off                # todo apagado
   curl -fsSL https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.sh | bash -s -- --yes --network off --auto-update on   # apagado, pero con auto updates
   ```
   Las opciones por categoría son `--telemetry on|off`, `--auto-update on|off` y `--outbound on|off`. `--network off` es igual que `--privacy strict`. En PowerShell se pasan tal cual, por ejemplo `-DryRun --network off`. Qué apaga cada categoría por agente: [docs/privacy.md](docs/privacy.md). La elección se guarda y `--update` la reutiliza.
4. **`gh`**: agrega `--gh` (o responde que sí) para instalar GitHub CLI sin admin; luego corre `gh auth login` tú mismo.

En una terminal real el instalador muestra menús (flechas, espacio para marcar), una lista de progreso y un resumen. Con `--yes`, con un pipe o sin terminal, hace preguntas simples o ninguna, como antes.

**Ajustes que el proyecto original no documenta** (telemetría y actualizaciones de Antigravity, la config de Serena, el proxy persistente de winget, los hosts de descarga, la telemetría de DCP, GSD y AutoSkills): lean-agents nunca los adivina. En una terminal real pregunta por cada uno: **pegar tu documentación o notas de TI** (una línea o la ruta a un archivo) o **dejar el valor por defecto de la herramienta**. Las notas se guardan, con cualquier contraseña de proxy oculta, en `~/.config/lean-agents/notes/<item>.md` y nunca se aplican solas: pídele a tu agente que las aplique y te muestre cada cambio antes. Si otro agente ya configuró la herramienta, no pregunta y no agrega notas. `--yes` siempre deja el valor por defecto.

## Modelos siempre al día

Los subagentes piden un nivel (`fast`, `balanced`, `strong`), no un modelo. En Claude Code eso son los alias `haiku`, `sonnet` y `opus`, que siempre apuntan a los modelos más nuevos. Los demás agentes usan [perfiles](profiles/) fechados por suscripción, y la skill `update-models` los actualiza con tu aprobación.

## Seguridad

- Respalda cada archivo antes de tocarlo. `--uninstall` lo restaura.
- Nunca sobrescribe tu `AGENTS.md` ni tu `CLAUDE.md`: los importa o agrega un bloque marcado.
- Nunca pide, guarda ni muestra API keys. Tú inicias sesión en los proveedores.
- No necesita permisos de administrador (`--no-admin`), así que funciona en laptops de trabajo restringidas.
- Se puede revisar antes de instalar: [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md) es un prompt que tu agente corre sobre este repo.

## Créditos

Ver la sección de créditos en el [README en inglés](README.md#credits).

## Hoja de ruta

- [x] Especificación, reglas y definiciones de subagentes
- [x] Instalador para Claude Code y OpenCode 2.x (macOS, Linux)
- [x] Instalador para Windows y OpenCode 1.x
- [x] Copilot CLI, Antigravity CLI, Codeburn, AutoSkills, GSD, skills propias, perfiles de modelos
- [x] VS Code Copilot, Cursor, modo equipo (`--project`), Claude a través de Copilot
- [ ] Planeado: terminales (Warp, Orca), sesiones de agentes en paralelo, configuración completa de Antigravity (app, y la CLI en Windows)
- [ ] `v1.0.0`
- Más adelante: Codex CLI, Gemini CLI

## Contribuir

Los issues y PRs son bienvenidos. Lee primero [CONTRIBUTING.md](CONTRIBUTING.md); cada PR pasa un escaneo de secretos y privacidad.

## Licencia

[MIT](LICENSE)
