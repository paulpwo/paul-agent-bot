# PaulBot — Requirements & Feature Analysis

## Visión central

**El agente vive en el centro. Los canales son ventanas.**

El bot actual (claude-code-telegram) tiene una sola ventana — Telegram.
PaulBot tiene múltiples ventanas al mismo agente, con flujos cruzados entre ellas.

```
                    ┌─────────────────────────────┐
GitHub Issue ──────►│                             │
Telegram topic ────►│     AGENTE (Claude Code)    │────► Abre PR en GitHub
Slack thread ──────►│   @anthropic-ai/claude-code │────► Notifica en Telegram
Email ─────────────►│                             │────► Responde en Slack thread
                    └─────────────────────────────┘
```

**Flujos cruzados** — ejemplos reales:
- `@paulbot` en un issue de GitHub → agente trabaja → **vos recibís update en Telegram** → resultado en el issue
- Mandás instrucción desde Telegram → agente abre PR en GitHub → notificación en Slack
- Email al bot → agente ejecuta → responde al hilo de email + comenta en el issue relacionado

---

## Diseño & UI

**Referencia visual**: Linear, Vercel Dashboard, Raycast — dark-first, denso pero respirable.

### Principios
- **Dark mode como default** — claro disponible pero el diseño se piensa en oscuro
- **Densidad de información** — mucho en pantalla sin sentirse abarrotado
- **Feedback instantáneo** — cada acción tiene respuesta visual inmediata

### Elementos visuales
- **Glassmorphism sutil** — cards con `backdrop-blur` y bordes semi-transparentes
- **Gradientes** — solo como acentos, no como fondos completos
- **Tipografía**: Geist (el de Vercel) — monospace para código, sans para UI
- **Iconografía**: Lucide Icons (viene con shadcn)
- **Animaciones**: Framer Motion — transiciones de página, aparición de elementos, estados de carga
- **Micro-interacciones**: hover states, focus rings, loading skeletons en lugar de spinners

### Componentes clave con diseño específico
- **Task en ejecución**: terminal-like con texto que aparece en tiempo real (typewriter effect), borde izquierdo animado indicando actividad
- **Status badges**: colores semánticos — verde/amarillo/rojo/gris con dot animado para "running"
- **Sidebar**: colapsable, iconos con tooltips en modo collapsed
- **Command palette**: `⌘K` para navegar entre repos, tasks, settings — estilo Raycast
- **Editor de skills/CLAUDE.md**: Monaco Editor (el de VS Code) con syntax highlighting Markdown
- **Notificaciones**: toast en esquina inferior derecha, no modales

### Layout
```
┌──────────┬────────────────────────────────────┐
│          │  Header (repo selector, user, theme)│
│ Sidebar  ├────────────────────────────────────┤
│          │                                    │
│ Nav      │   Main content area                │
│ items    │                                    │
│          │                                    │
│          │                                    │
└──────────┴────────────────────────────────────┘
```

---

## Stack tecnológico

| Capa | Tecnología | Por qué |
|---|---|---|
| **Framework** | Next.js (App Router) | Dashboard + webhook receivers en un solo repo |
| **UI** | shadcn/ui + Tailwind CSS v4 | Componentes accesibles, design system consistente |
| **Theming** | Modo claro / oscuro | `next-themes`, respeta preferencia del sistema, toggle manual |
| **Estilo** | Interfaz moderna | Ver sección de diseño |
| **Agente** | `@anthropic-ai/claude-code` | Usa token local `~/.claude/`, sin API key extra |
| **GitHub** | `octokit` | App API, webhooks, PRs, issues |
| **Telegram** | `grammy` | Async, TypeScript nativo |
| **Slack** | `@slack/bolt` | Manejo de eventos, threads |
| **Email** | `nodemailer` + IMAP | Envío y recepción |
| **Queue** | BullMQ + Redis | Tareas largas en background |
| **DB** | Prisma + Postgres | Estado de sesiones, historial |
| **Auth GUI** | NextAuth.js (en Next.js) | Botón login GitHub nativo, sin servicio extra |
| **TLS** | Caddy | HTTPS automático con Let's Encrypt |

**Runtime del agente**: `@anthropic-ai/claude-code` — wrapper del Claude Code CLI.
Usa el token local de `~/.claude/`, igual que el bot Python actual con `claude-agent-sdk`.
Sin API key, sin costo extra por tokens.

---

## 1. Canales

### 1.1 Telegram — Chat en tiempo real

- **Interacción**: streaming token a token, el usuario ve cómo "piensa" el agente
- **Topics**: cada topic de Telegram = conversación aislada apuntando a un repo específico
- **Session scoping**: `(user_id, chat_id, thread_id)` — ya implementado en el bot actual
- **Voice notes**: transcripción con Whisper, respuesta con TTS (ya implementado)
- **Aprobación interactiva**: cuando el agente necesita permiso para algo, manda botón inline en Telegram — el usuario aprueba/rechaza en el chat
- **Interrupt**: comando `/stop` cancela la tarea en curso
- **Comandos**:
  - `/repo <url>` — asocia el topic a un repo
  - `/new` — nueva conversación
  - `/status` — estado de la tarea en curso
  - `/push` — pushea los cambios actuales
  - `/pr` — abre PR con los cambios actuales
  - `/stop` — interrumpe la tarea en curso

#### Auto-detección al entrar a un grupo

Cuando el bot es agregado a un grupo de Telegram:

```
Bot entra al grupo
    → Detecta si el grupo tiene is_forum = true (tiene topics)
    → SI tiene topics:
        → Lista todos los topics del grupo
        → Para cada topic, intenta hacer match con repos habilitados
          (por similitud de nombre: "portfolio" → paulpwo/portfolio)
        → Manda mensaje al grupo con el resultado del auto-match:

          "Detecté estos topics y sugerí los siguientes repos:
           • #portfolio → paulpwo/portfolio ✅
           • #api → paulpwo/api ✅
           • #mobile → ❓ no encontré match
           Usá /topics para editar o confirmar."

    → SI no tiene topics (grupo normal):
        → El grupo completo = una sola sesión sin repo asignado
        → Manda bienvenida con instrucciones básicas
```

#### Sesión de administración de topics

Comando `/topics` abre una sesión interactiva de admin en el grupo:

```
/topics
→ Muestra tabla de topics del grupo con su repo asignado:

  Topic           Repo                    Estado
  ─────────────────────────────────────────────
  #portfolio      paulpwo/portfolio       ✅ activo
  #api            paulpwo/api             ✅ activo
  #mobile         (sin asignar)           ⚠️
  #devops         paulpwo/infra           ✅ activo

  [+ Asignar repo a #mobile]
  [Editar asignaciones]
```

- **Asignar**: inline keyboard con lista de repos habilitados para elegir
- **Editar**: cambiar el repo de cualquier topic existente
- **Desasociar**: quitar el repo de un topic (queda como chat libre sin repo)
- **Nuevo topic detectado**: si alguien crea un topic nuevo en el grupo, el bot lo detecta y notifica al admin para asignarlo
- Esta sesión de admin solo la puede iniciar un usuario en la allowlist

### 1.2 GitHub — Flujo nativo inverso (el más crítico)

**Concepto**: GitHub ES la interfaz. El bot aparece como colaborador más en tus repos.
La conversación se genera DESDE GitHub, no desde una UI separada.

```
Comentás @paulbot en un issue
    → GitHub dispara webhook
    → Bot lee contexto completo (repo, issue, hilo, instrucción)
    → Agente trabaja (clona, analiza, edita)
    → Comenta progreso en el issue
    → Abre PR con los cambios
    → (Opcional) notifica en Telegram que terminó
```

**Disparadores**:
- `@paulbot <instrucción>` en comentario de issue
- `@paulbot <instrucción>` en comentario de PR (review o inline)
- Label `bot:task` en issue → toma título + descripción como instrucción
- Label `bot:review` en PR → code review automático

**Contexto que recibe el agente**:
- Repo completo (rama, historia de commits)
- Hilo completo del issue/PR (todos los comentarios anteriores)
- La instrucción específica de la mención
- Archivos mencionados

**Respuestas del bot en GitHub**:
- Comenta en el issue: "Tomando la tarea... 🤖"
- Updates de progreso durante la ejecución
- Resultado final con resumen de qué cambió
- Abre PR con los cambios (branch `paulbot/<issue-number>`)
- Follow-up si le respondés en el mismo hilo

**Requiere**: GitHub App instalada en los repos
- Permisos: `contents:write`, `issues:write`, `pull_requests:write`, `metadata:read`
- Webhook events: `issue_comment`, `issues`, `pull_request`, `pull_request_review_comment`
- Verificación HMAC-SHA256 en cada webhook

### 1.3 Slack — Threads como conversaciones

- `@paulbot <instrucción> en <repo>` en cualquier canal
- Cada thread de Slack = conversación aislada (igual que Telegram topics)
- Múltiples repos en paralelo desde distintos threads
- El bot responde en el mismo thread con updates y resultado final
- Aprobación: manda botón en el thread — el usuario aprueba/rechaza ahí mismo

### 1.4 Email

- Email a `paulbot@tudominio.com` con instrucción + repo en subject o cuerpo
- El bot responde al hilo de email con progreso y resultado
- Para tareas asíncronas donde no necesitás tiempo real

### 1.5 Dashboard Web (GUI)

- Next.js — ver tareas activas, historial por repo, métricas
- Accesible sin VPN desde el browser
- Login con botón GitHub (NextAuth.js) — sin oauth2-proxy, sin servicio extra
- Solo usuarios en la allowlist pueden entrar (configurable desde Settings)
- HTTPS con Caddy + Let's Encrypt
- **Settings panel** — toda la configuración del bot desde la UI, sin tocar `.env`

---

## 2. Capacidades del agente en tiempo real

### 2.1 Streaming

El agente transmite lo que está haciendo en tiempo real a todos los canales que lo soportan:

```typescript
for await (const message of query({ prompt, options: { cwd: repoPath } })) {
    if (message.type === "assistant") {
        // Claude "pensando" — se transmite token a token a Telegram/Slack
        await streamToChannel(message.text)
    }
    if (message.type === "tool_use") {
        // Claude ejecutando una tool — se notifica qué está haciendo
        await notifyToolUse(message.name, message.input)
    }
}
```

### 2.2 Aprobación interactiva (Human-in-the-loop)

Cuando el agente necesita permiso para ejecutar algo riesgoso:

```typescript
// El agente quiere hacer un git push — le pregunta al usuario
permissionCallback: async (toolName, toolInput) => {
    const approved = await askUserViaChannel(toolName, toolInput)
    return approved ? "allow" : "deny"
}
```

Cómo se ve por canal:
- **Telegram**: botón inline "✅ Aprobar / ❌ Rechazar"
- **Slack**: mensaje con botones en el thread
- **GitHub**: no aplica (no es interactivo en tiempo real)

### 2.3 Interrupt

- **Telegram**: `/stop`
- **Slack**: `@paulbot stop`
- Implementado con `AbortController` pasado al SDK

---

## 3. GitHub App

El componente que habilita el flujo nativo de GitHub.

**Setup**:
1. Registrar en `github.com/settings/apps`
2. Instalar en los repos deseados (selección granular)
3. Configurar webhook URL: `https://paulbot.tudominio.com/api/webhooks/github`
4. `GITHUB_APP_WEBHOOK_SECRET` para verificación HMAC

**Flujo de eventos**:
```
GitHub Event → /api/webhooks/github (Next.js route)
    → Verifica HMAC
    → ¿Menciona @paulbot o tiene label bot:*? → SÍ
    → Encola tarea en BullMQ
    → Worker procesa con @anthropic-ai/claude-code
    → Resultados via Octokit (comenta, abre PR)
```

---

## 4. Autenticación

### Login al dashboard — botón GitHub nativo

**NextAuth.js** integrado en Next.js — sin oauth2-proxy, sin servicio extra.
La pantalla de login es simplemente:

```
┌─────────────────────────┐
│                         │
│   [GitHub logo]         │
│   Continuar con GitHub  │
│                         │
└─────────────────────────┘
```

- Click → redirect a GitHub OAuth → callback → sesión con cookie firmada
- Allowlist en settings: solo usuarios autorizados (`paulpwo`) pueden entrar
- Sin usuario → pantalla de login, sin acceso a nada

### GitHub App (repos y webhooks)
- Tokens de instalación de corta duración (1h), auto-renovados
- Generados desde la private key de la App (guardada en settings de la BD)
- Usados para clonar repos, commits, PRs, comentarios en issues

### Variables de entorno — solo las mínimas absolutas

Solo lo que Next.js necesita para arrancar antes de conectarse a la BD:

```env
DATABASE_URL=postgres://...
REDIS_URL=redis://...
NEXTAUTH_SECRET=...         # string random para firmar cookies
GITHUB_APP_ID=...           # ID de la GitHub App (número, no secreto)
GITHUB_APP_PRIVATE_KEY=...  # PEM key de la GitHub App
```

**Todo lo demás va en Settings del dashboard** — guardado encriptado en la BD:
- Telegram bot token
- Slack bot token
- OpenRouter API key
- Anthropic API key (si se usa directo)
- GitHub OAuth Client ID + Secret (para el login)
- Webhook secrets
- Allowlist de usuarios
- Configuración de modelos
- Variables de MCP servers

---

## 5. Repos & Workspace

### Selección de repos

Settings → GitHub Integration muestra:

```
GitHub App — paulpwo
─────────────────────────────────────────────────
Repositorios con acceso autorizado:

  ✅ paulpwo/portfolio
  ✅ paulpwo/api
  ✅ paulpwo/claude-code-telegram
  ❌ paulpwo/mobile-app          (sin acceso)

  [Administrar acceso en GitHub →]     ← abre github.com/settings/installations/<id>
  [Revocar acceso a la app]
─────────────────────────────────────────────────
```

- **"Administrar acceso en GitHub"** → redirect a la página de instalación de la GitHub App en GitHub, donde el usuario puede agregar o quitar repos sin reinstalar la app
- Al volver al dashboard, la lista se refresca automáticamente con los repos recién autorizados
- Los repos nuevos aparecen disponibles para habilitar en PaulBot
- Si se revoca acceso a un repo desde GitHub → el dashboard lo marca como `❌` y desactiva las conversaciones asociadas con aviso

Exactamente el flujo que viste en OpenHands Cloud — "Agregar repositorios de GitHub" desde el selector.

### Workspaces persistentes & aislamiento de seguridad

**Variable de entorno**: `WORKSPACE_BASE` — la única carpeta donde Claude tiene permiso de operar.

```env
WORKSPACE_BASE=/data/workspaces   # único lugar donde el agente puede leer/escribir
```

**Estructura**:
```
/data/workspaces/               ← WORKSPACE_BASE (root permitido)
├── paulpwo/
│   ├── portfolio/              ← repo clonado
│   ├── api/                    ← repo clonado
│   └── claude-code-telegram/   ← repo clonado
└── _temp/                      ← tareas sin repo asignado
```

**Reglas de aislamiento** (aplicadas al SDK):
- Claude puede leer/escribir **solo dentro de** `WORKSPACE_BASE`
- Puede operar en cualquier repo dentro de `WORKSPACE_BASE` y en el root (`WORKSPACE_BASE/` mismo)
- Cualquier intento de acceder fuera de `WORKSPACE_BASE` → denegado automáticamente
- No re-clonar en cada conversación — `git clone` la primera vez, `git pull` al arrancar sesión
- Montado como volumen Docker persistente

**Al clonar un repo**:
1. Verifica que `<owner>/<repo>` esté en la lista de repos habilitados
2. Clona en `WORKSPACE_BASE/<owner>/<repo>`
3. Configura git con credenciales de la GitHub App (token de instalación)
4. Registra en la BD con el `workspacePath`

### Branch management
- El agente NUNCA trabaja en `main` o ramas protegidas
- Branch naming: `paulbot/<issue-number>` o `paulbot/<task-slug>`
- Protected branches configurables por repo

---

## 6. Multi-model routing

Distintos modelos para distintos tipos de tarea:

| Tarea | Modelo | Proveedor |
|---|---|---|
| Razonamiento complejo, arquitectura | `claude-opus-4-6` | Token local (`~/.claude/`) |
| Coding general, PRs | `claude-sonnet-4-6` | Token local (`~/.claude/`) |
| Tareas simples, resúmenes | `qwen3-235b` o `gpt-oss-20b` | OpenRouter (API key) |

Configurado via `@anthropic-ai/claude-code` SDK — el modelo se pasa por conversación.

---

## 7. Base de datos

**Postgres** (producción) + **SQLite** (desarrollo local), via Prisma ORM.

### Schema principal

```prisma
model Session {
  id          String   @id
  channel     String   // "telegram" | "slack" | "github" | "email"
  channelId   String   // chat_id, workspace_id, repo, etc.
  threadId    String   // topic_id, thread_ts, issue_number, email_thread
  repo        String
  agentSessionId String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([channel, channelId, threadId, repo])
}

model Task {
  id            String    @id @default(cuid())
  channel       String
  channelId     String
  threadId      String
  repo          String
  prompt        String
  status        String    // "queued" | "running" | "completed" | "failed" | "cancelled"
  modelUsed     String?
  result        String?
  errorMessage  String?
  durationMs    Int?
  createdAt     DateTime  @default(now())
  completedAt   DateTime?
}

model Repo {
  id                 String   @id @default(cuid())
  owner              String
  name               String
  enabled            Boolean  @default(true)
  workspacePath      String
  protectedBranches  String[] // ["main", "develop"]
  @@unique([owner, name])
}

model CronJob {
  id          String    @id @default(cuid())
  name        String
  channel     String    // canal donde se creó
  channelId   String
  threadId    String
  repo        String
  prompt      String    // la instrucción a ejecutar
  schedule    String    // cron expression: "0 9 * * 1-5"
  naturalText String    // texto original: "todos los días a las 9am"
  enabled     Boolean   @default(true)
  lastRun     DateTime?
  nextRun     DateTime?
  createdAt   DateTime  @default(now())
}
```

### Redis (BullMQ)
- Cola `tasks` — tareas en background
- Cola `crons` — trigger de cronjobs
- TTL de resultados: 7 días

---

## 8. Tareas largas & Cronjobs

### Tareas largas

Las tareas del agente pueden durar minutos. Next.js API routes no bloquean — la tarea va a BullMQ y el worker la procesa en background.

```
Canal recibe instrucción
    → API route encola en BullMQ (respuesta inmediata: "Tomé la tarea 🤖")
    → Worker procesa con @anthropic-ai/claude-code
    → Cada update de streaming → notifica al canal de origen
    → Al terminar → resultado al canal + marca tarea completed en DB
```

Estados de una tarea: `queued → running → completed | failed | cancelled`

El usuario puede hacer `/status` en cualquier momento para ver en qué está.

### Cronjobs con lenguaje natural

Desde cualquier canal podés programar tareas recurrentes con texto libre:

```
/schedule "revisá los PRs abiertos de paulpwo/portfolio todos los días a las 9am"
/schedule "el primer lunes de cada mes abrí un issue de resumen de cambios en paulpwo/api"
/schedule "todos los viernes a las 6pm hacé un release notes del sprint"
```

El agente interpreta el texto y genera el cron expression:
```
"todos los días a las 9am"        → "0 9 * * *"
"lunes a viernes a las 8:30"      → "30 8 * * 1-5"
"el día 1 de cada mes a las 10"   → "0 10 1 * *"
"cada 2 horas"                    → "0 */2 * * *"
```

**Gestión desde el chat**:
```
/crons                        → lista todos los cronjobs activos
/cron pause <id>              → pausa uno
/cron delete <id>             → elimina uno
/cron run <id>                → ejecuta ahora (one-shot)
```

**Implementación**:
- Claude interpreta el texto → genera cron expression → guarda en tabla `CronJob`
- BullMQ Scheduler dispara según el cron
- Worker crea una tarea normal con el `prompt` almacenado
- Resultado se notifica en el `channel + channelId + threadId` donde se creó el cron

---

## 9. Plugins & Skills

Igual que Claude Code carga `CLAUDE.md` y skills desde `.claude/skills/`, PaulBot soporta el mismo sistema — tanto globales como por repo.

### Skills globales (aplican a todos los repos)
Guardadas en el servidor: `~/.claude/skills/` o `/data/skills/`

```
/data/skills/
├── git-paul.md          → workflow de commits, PRs, branches para paulpwo
├── code-review.md       → criterios de code review propios
├── sdd.md               → spec-driven development workflow
└── frontend-design.md   → convenciones de diseño
```

### Skills por repo
Cada repo puede tener sus propias instrucciones en `.claude/skills/` o `CLAUDE.md`:

```
paulpwo/portfolio/
└── CLAUDE.md            → contexto específico del repo, convenciones, stack
└── .claude/
    └── skills/
        └── deploy.md    → cómo deployar este repo específicamente
```

### Cómo se cargan
Cuando el agente arranca una tarea en un repo:
1. Carga skills globales de `/data/skills/`
2. Lee `CLAUDE.md` del repo si existe
3. Carga skills locales de `.claude/skills/` del repo
4. Todo se inyecta como system prompt al agente

### Gestión de skills desde el chat
```
/skills                    → lista skills globales activas
/skill add <nombre>        → crea una nueva skill global (el agente la redacta con vos)
/skill edit <nombre>       → edita una skill existente
/skill delete <nombre>     → elimina una skill
```

### Gestión de skills desde el dashboard (panel web)

Editor visual completo — sin tocar archivos manualmente:

- **Lista de skills**: tabla con nombre, scope (global / repo), última modificación, estado (activa/inactiva)
- **Editor de skill**: editor Markdown con syntax highlighting, preview en tiempo real de cómo se ve el skill renderizado
- **Crear skill**: formulario — nombre, scope (global o repo específico), contenido en Markdown
- **Editar skill**: editor inline, historial de versiones (diff entre versiones)
- **Activar / desactivar**: toggle sin borrar
- **Scope por repo**: podés asignar una skill a uno o más repos específicos desde la UI
- **Import desde archivo**: subir un `.md` existente
- **Test de skill**: campo para mandar una tarea de prueba y ver cómo responde el agente con esa skill cargada

**Aplica también a `CLAUDE.md` por repo** — el dashboard muestra el `CLAUDE.md` de cada repo habilitado y lo podés editar directamente desde la UI, sin abrir el editor de código.

### MCP Servers

Igual que Claude Code soporta MCP, PaulBot puede cargar MCP servers por repo o globalmente.

**Gestión desde el dashboard**:

- **Lista de MCP servers**: tabla con nombre, tipo (global / repo), estado (activo/inactivo), última conexión
- **Agregar MCP server**: formulario — nombre, comando, args, env vars (con campos enmascarados para secrets), scope
- **Editar**: modificar comando, args, variables de entorno sin tocar archivos
- **Activar / desactivar**: toggle por server y por repo
- **Test de conexión**: botón "Probar" — el dashboard intenta conectarse al MCP server y muestra si responde bien o el error
- **Variables de entorno**: editor de env vars por MCP server — los secrets se guardan encriptados en la BD, nunca en texto plano en archivos
- **Scope**: global (aplica a todas las conversaciones) o por repo específico
- **Log de herramientas**: ver qué tools expone cada MCP server y cuántas veces fueron usadas

**MCP servers pre-configurados** (instalables con un click):
| Server | Qué hace |
|---|---|
| `telegram` | Permite al agente enviar mensajes/voz a Telegram |
| `notion` | Leer/escribir páginas de Notion |
| `linear` | Crear/actualizar issues en Linear |
| `slack` | Postear en canales de Slack |
| `github` | Operaciones extra de GitHub (más allá de octokit) |
| `datadog` | Consultar métricas y logs |
| `postgres` | Queries directas a una BD |

**Estructura interna**:
```json
// generado automáticamente desde la BD, nunca editado a mano
{
  "mcpServers": {
    "notion": {
      "command": "npx",
      "args": ["-y", "@notionhq/notion-mcp-server"],
      "env": { "NOTION_API_KEY": "<desde BD encriptada>" }
    }
  }
}
```

---

## 10. Infra & Deploy

```
EC2 t3.medium (4GB RAM)
└── Docker Compose
    ├── paulbot          (Next.js — dashboard + webhooks + workers)
    │   (NextAuth.js incluido en paulbot — sin servicio extra)
    ├── caddy            (TLS, reverse proxy)
    ├── postgres         (estado de sesiones)
    └── redis            (BullMQ queue)
```

- Terraform reemplaza `ClaudeCodeTelegramBotDeploy`
- Mismo EIP (`3.94.235.48`), mismo EventBridge scheduler
- Security group: 443 expuesto + SSH restringido a IP propia
- `WORKSPACE_BASE` montado como volumen persistente

---

## 9. Qué construir vs qué usar

| Componente | Existente | Construir |
|---|---|---|
| Agent runtime | `@anthropic-ai/claude-code` (npm) | — |
| Dashboard UI | — | Next.js (App Router) |
| GitHub webhook receiver | — | Next.js API route |
| GitHub App | — | Registrar en GitHub |
| Telegram bridge | Refactorizar fork actual a TS | `grammy` |
| Slack bridge | — | `@slack/bolt` |
| Email bridge | — | `nodemailer` + IMAP |
| Auth dashboard | NextAuth.js (incluido en Next.js) | — |
| Task queue | — | BullMQ + Redis |
| DB / estado | — | Prisma + Postgres |
| Infra | Adaptar Terraform actual | Nuevos servicios |

---

## 10. Orden de implementación

1. **Scaffold Next.js** — proyecto base, estructura de carpetas, Prisma, Redis
2. **GitHub App** — registrar, instalar en repos, webhook receiver con HMAC
3. **Agente core** — `@anthropic-ai/claude-code` con streaming, aprobación, interrupt
4. **GitHub canal** — `@paulbot` en issues/PRs → agente → comenta → PR
5. **Telegram bridge** — reescribir fork actual en TS con `grammy`, session scoping
6. **Dashboard** — ver tareas, repos, historial
7. **Auth** — NextAuth.js + GitHub OAuth, settings panel en BD
8. **Slack bridge** — threads como conversaciones
9. **Email bridge** — inbox del bot
10. **Infra Terraform** — EC2 t3.medium, Docker Compose completo, deploy
