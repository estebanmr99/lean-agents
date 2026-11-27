# Despliegue en equipo

Cómo desplegar lean-agents en un equipo para que todos compartan las mismas reglas, subagentes y configuraciones MCP en git, manteniendo el estado personal y las credenciales en local.

[Read in English](team-rollout.md)

---

## 1. Fijar una versión para todo el equipo

No dejes que los compañeros ejecuten `npx lean-agents@latest` de forma independiente, ya que esto puede introducir versiones de reglas o herramientas distintas entre máquinas. En su lugar, fija una versión exacta en las instrucciones del equipo o en los scripts del proyecto:

```bash
npx lean-agents@1.2.4 --project . --dry-run
```

Revisa primero con `--dry-run` para inspeccionar cada acción planeada sin tocar archivos. Tras revisarlo, aplica el plan:

```bash
npx lean-agents@1.2.4 --project .
```

PowerShell utiliza el mismo comando.

## 2. Confirmar los archivos de `--project` en git

Ejecutar con `--project <dir>` escribe la configuración compartida directamente en el repositorio. Inspecciona y confirma los archivos generados:

| Archivo / Carpeta | Propósito |
| --- | --- |
| `AGENTS.md` | Reglas globales compartidas en la raíz del repositorio. Se colocan en un bloque marcado; las reglas personalizadas existentes fuera del bloque se conservan. |
| `.github/copilot-instructions.md` | Apunta GitHub Copilot a `AGENTS.md` para que las reglas se carguen una sola vez sin duplicación. |
| `.github/agents/*.agent.md` | Definiciones de subagentes por niveles para VS Code Copilot (`explore`, `research`, `review`, `debug`, `planner`). |
| `.cursor/rules/lean-agents.mdc` | Regla para Cursor que apunta a `AGENTS.md`. |
| `.cursor/agents/*.md` | Definiciones de subagentes por niveles para Cursor (`explore`, `research`, `review`, `debug`, `planner`). |
| `.vscode/mcp.json` | Definiciones compartidas de servidores MCP para VS Code (Context Mode, más Serena y Playwright si los eliges con `--tools`). |
| `.cursor/mcp.json` | Definiciones compartidas de servidores MCP para Cursor. |

Confírmalos en el repositorio:

```bash
git add AGENTS.md .github .cursor .vscode
git commit -m "chore: add lean-agents team setup"
```

El estado del equipo se guarda localmente en `~/.config/lean-agents/projects/`, nunca dentro del repositorio.

Las herramientas opcionales (como Serena o Playwright) se pueden incluir durante la configuración con `--project` mediante `--tools`:

```bash
npx lean-agents@1.2.4 --project . --tools serena,playwright
```

## 3. Incorporación del equipo y comprobación con `--doctor`

Cuando un compañero descarga la rama con `git pull`, recibe las reglas del repositorio, subagentes y configuraciones MCP. Cada integrante instala luego las herramientas locales necesarias:

```bash
npx lean-agents@1.2.4 --dry-run
npx lean-agents@1.2.4
```

Después, cada miembro del equipo comprueba su instalación con `--doctor`:

```bash
npx lean-agents@1.2.4 --doctor
```

### Qué significan los estados de doctor

| Estado | Significado | Acción necesaria |
| --- | --- | --- |
| `ok` | El componente, binario o versión fijada está comprobado, saludable y coincide con la configuración esperada. | Ninguna. Todo funciona correctamente. |
| `note` | Solo información (por ejemplo, guía sobre la shell, avisos de Node del proyecto o ajustes manuales). | Ninguna (solo información, nada que corregir). |
| `changed` | Un archivo, versión o ajuste difiere del estado instalado (por ejemplo, un archivo de reglas editado localmente tras la instalación, o una desviación de versión que indica una actualización disponible). | Revisa el cambio. Las modificaciones locales son válidas si son intencionadas; de lo contrario, ejecuta `--update`. |
| `error` | Una herramienta requerida, binario, registro MCP o comando falló o no se encuentra, o falta un archivo gestionado. | Revisa el detalle del error reportado y reinstala o corrige el requisito que falte. |
| `missing` | lean-agents no está instalado en esta máquina (`not installed (run the installer)`). | Ejecuta la instalación (`npx lean-agents@1.2.4`). |

También puedes pasar `--json` a `--doctor` para obtener una salida estructurada en scripts o comprobaciones automáticas.

## 4. PCs de trabajo detrás de un proxy

Si los integrantes del equipo trabajan en máquinas corporativas detrás de un proxy con autenticación o una autoridad de certificación propia:

- Sigue la configuración del README: [En una PC de trabajo: proxy, red y revisión de seguridad](../README.es.md#en-una-pc-de-trabajo-proxy-red-y-revisión-de-seguridad).
- Define `HTTPS_PROXY`, `NO_PROXY` y `NODE_EXTRA_CA_CERTS` en tu sesión de terminal.
- Añade `--network off` (o `--privacy strict`) si la telemetría saliente, comprobaciones automáticas de actualización o peticiones de red externas están restringidas por la política de la empresa:

```bash
npx lean-agents@1.2.4 --project . --network off
```

## 5. Actualizaciones en el equipo (`--update`)

Para actualizar al equipo a una versión más reciente de lean-agents:

1. **El encargado actualiza el repositorio:**
   ```bash
   npx lean-agents@1.2.4 --project . --update --dry-run
   npx lean-agents@1.2.4 --project . --update
   git add AGENTS.md .github .cursor .vscode
   git commit -m "chore: update lean-agents to 1.2.0"
   git push
   ```

2. **Los compañeros actualizan su entorno local:**
   Tras hacer `git pull`, cada miembro ejecuta:
   ```bash
   npx lean-agents@1.2.4 --update --dry-run
   npx lean-agents@1.2.4 --update
   npx lean-agents@1.2.4 --doctor
   ```

Para eliminar todas las configuraciones añadidas por lean-agents:
```bash
npx lean-agents@1.0.0 --project . --uninstall
```
