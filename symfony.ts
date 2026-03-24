/// <reference path="./types/fresh.d.ts" />

// =============================================================================
// Symfony Plugin for Fresh Editor v2
// https://getfresh.dev
//
// Commands:
//   Symfony: Console          — Run any bin/console command interactively
//   Symfony: Routes           — Browse all routes, press Enter to open file
//   Symfony: Services         — Browse the DI container service list
//   Symfony: Clear Cache      — Run cache:clear + regenerate phpactor config
//   Symfony: Cache Warmup     — Run cache:warmup + rebuild phpactor index
//   Symfony: Tail Log         — Open a terminal tailing var/log/{env}.log
//   Symfony: Make             — Run make:* generators (entity, controller, etc.)
//   Symfony: Setup LSP        — Auto-detect container XML, write .phpactor.json,
//                               fix permissions, rebuild phpactor index
//   Symfony: Fix Permissions  — Fix src/ file permissions for phpactor indexing
//   Symfony: Phpactor Index   — Rebuild phpactor index
// =============================================================================

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find the Symfony project root by walking up from the current buffer path */
function findSymfonyRoot(): string | null {
  const bufferId = editor.getActiveBufferId();
  const bufferPath = editor.getBufferPath(bufferId);
  const startPath = bufferPath || ".";

  const parts = startPath.split("/");
  while (parts.length > 1) {
    const candidate = parts.join("/");
    if (editor.fileExists(`${candidate}/bin/console`)) {
      return candidate;
    }
    parts.pop();
  }
  return null;
}

/** Run a bin/console command and return its output */
async function runConsole(
  root: string,
  args: string[],
  env?: string
): Promise<{ stdout: string; stderr: string; exit_code: number }> {
  const envArgs = env ? { APP_ENV: env } : undefined;
  return await editor.spawnProcess(
    "php",
    [`${root}/bin/console`, ...args, "--no-interaction"],
    envArgs ?? null
  );
}

/** Split a multi-line string into trimmed non-empty lines */
function lines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * Auto-detect the Symfony container XML file.
 * Handles any kernel prefix e.g. App_Kernel, Tomato_Kernel, etc.
 */
async function findContainerXml(root: string): Promise<string | null> {
  try {
    const cacheDir = `${root}/var/cache/dev`;
    const entries = await editor.readDir(cacheDir);
    const found = entries.find(
      (e) => e.is_file && e.name.endsWith("_KernelDevDebugContainer.xml")
    );
    return found ? `${cacheDir}/${found.name}` : null;
  } catch {
    return null;
  }
}

/**
 * Read APP_ENV from .env file in project root.
 * Falls back to "dev" if not found.
 */
async function readAppEnv(root: string): Promise<string> {
  try {
    const envPath = `${root}/.env`;
    if (!editor.fileExists(envPath)) return "dev";
    const content = await editor.readFile(envPath);
    const match = content.match(/^APP_ENV=(.+)$/m);
    return match ? match[1].trim().replace(/['"]/g, "") : "dev";
  } catch {
    return "dev";
  }
}

// ---------------------------------------------------------------------------
// Mode definitions
// ---------------------------------------------------------------------------

editor.defineMode(
  "symfony-routes",
  "special",
  [
    ["Return", "symfony_routes_open"],
    ["q", "close_buffer"],
    ["Escape", "close_buffer"],
  ],
  true
);

editor.defineMode(
  "symfony-services",
  "special",
  [
    ["Return", "symfony_service_copy"],
    ["q", "close_buffer"],
    ["Escape", "close_buffer"],
  ],
  true
);

editor.defineMode(
  "symfony-env",
  "special",
  [
    ["q", "close_buffer"],
    ["Escape", "close_buffer"],
  ],
  true
);

// ---------------------------------------------------------------------------
// Command: Symfony: Console
// ---------------------------------------------------------------------------

const CONSOLE_SUGGESTIONS: PromptSuggestion[] = [
  { text: "debug:router", description: "List all routes" },
  { text: "debug:container", description: "List services" },
  { text: "debug:config", description: "Dump configuration" },
  { text: "debug:event-dispatcher", description: "List event listeners" },
  { text: "cache:clear", description: "Clear the cache" },
  { text: "cache:warmup", description: "Warm up the cache" },
  { text: "doctrine:migrations:migrate", description: "Run pending migrations" },
  { text: "doctrine:migrations:status", description: "Show migration status" },
  { text: "doctrine:migrations:diff", description: "Generate migration from schema diff" },
  { text: "doctrine:schema:update --force", description: "Update DB schema" },
  { text: "doctrine:schema:validate", description: "Validate DB schema" },
  { text: "make:entity", description: "Create or update an entity" },
  { text: "make:controller", description: "Create a controller" },
  { text: "make:form", description: "Create a form type" },
  { text: "make:migration", description: "Create a new migration" },
  { text: "make:crud", description: "Create CRUD for an entity" },
  { text: "make:test", description: "Create a test class" },
  { text: "make:voter", description: "Create a new security Voter" },
  { text: "make:command", description: "Create a console command" },
  { text: "make:event-listener", description: "Create an event listener" },
  { text: "make:subscriber", description: "Create an event subscriber" },
  { text: "make:twig-component", description: "Create a Twig component" },
  { text: "make:stimulus-controller", description: "Create a Stimulus controller" },
  { text: "messenger:consume", description: "Consume messages from transport" },
  { text: "messenger:stop-workers", description: "Stop messenger workers" },
  { text: "secrets:list", description: "List all secrets" },
  { text: "about", description: "Show info about the current project" },
  { text: "lint:twig", description: "Lint Twig templates" },
  { text: "lint:yaml", description: "Lint YAML config files" },
  { text: "lint:container", description: "Lint the service container" },
  { text: "lint:xliff", description: "Lint XLIFF translations" },
];

globalThis.symfony_console = async function (): Promise<void> {
  const root = findSymfonyRoot();
  if (!root) {
    editor.setStatus("⚠ Symfony: bin/console not found — are you in a Symfony project?");
    return;
  }

  const input = await editor.prompt("bin/console ", CONSOLE_SUGGESTIONS);
  if (!input) return;

  const terminal = await editor.createTerminal({
    cwd: root,
    direction: "horizontal",
    ratio: 0.35,
    focus: true,
  });

  await editor.sendTerminalInput(terminal.terminalId, `php bin/console ${input}\n`);
};

editor.registerCommand("Symfony: Console", "Run a bin/console command", "symfony_console");

// ---------------------------------------------------------------------------
// Command: Symfony: Routes
// ---------------------------------------------------------------------------

globalThis.symfony_routes = async function (): Promise<void> {
  const root = findSymfonyRoot();
  if (!root) { editor.setStatus("⚠ Symfony: bin/console not found"); return; }

  editor.setStatus("Symfony: loading routes…");
  const result = await runConsole(root, ["debug:router", "--format=txt"]);

  if (result.exit_code !== 0) {
    editor.setStatus(`Symfony routes error: ${lines(result.stderr)[0] ?? "unknown"}`);
    return;
  }

  const routeLines = lines(result.stdout).filter(
    (l) => !l.startsWith("-") && !l.startsWith("Name") && l.length > 0
  );

  const entries: TextPropertyEntry[] = routeLines.map((line) => {
    const cols = line.split(/\s{2,}/);
    const name = cols[0] ?? line;
    const method = cols[1] ?? "";
    const path = cols[4] ?? cols[3] ?? "";
    return {
      text: `${name.padEnd(45)} ${method.padEnd(8)} ${path}\n`,
      properties: { route_name: name, method, path },
    };
  });

  if (entries.length === 0) { editor.setStatus("Symfony: no routes found"); return; }

  entries.unshift({
    text: `${"Route Name".padEnd(45)} ${"Method".padEnd(8)} Path\n`,
    properties: {},
  });

  await editor.createVirtualBufferInSplit({
    name: "*Symfony Routes*",
    mode: "symfony-routes",
    read_only: true,
    entries,
    ratio: 0.4,
    direction: "horizontal",
    panel_id: "symfony-routes",
    show_line_numbers: false,
  });

  editor.setStatus(`Symfony: ${routeLines.length} routes  [Enter] open controller  [q] close`);
};

editor.registerCommand("Symfony: Routes", "Browse all Symfony routes", "symfony_routes");

globalThis.symfony_routes_open = async function (): Promise<void> {
  const root = findSymfonyRoot();
  if (!root) return;

  const bufferId = editor.getActiveBufferId();
  const props = editor.getTextPropertiesAtCursor(bufferId);
  if (!props.length || !props[0].route_name) return;

  const routeName = String(props[0].route_name);
  editor.setStatus(`Symfony: resolving route "${routeName}"…`);

  const result = await runConsole(root, ["debug:router", routeName, "--format=txt"]);
  if (result.exit_code !== 0) {
    editor.setStatus("Symfony: could not resolve route controller");
    return;
  }

  const controllerLine = lines(result.stdout).find((l) =>
    l.toLowerCase().startsWith("controller")
  );
  if (!controllerLine) {
    editor.setStatus("Symfony: no controller found for this route");
    return;
  }

  const controllerFqn = controllerLine.split(/\s+/).pop() ?? "";
  const [classPath] = controllerFqn.split("::");

  // Support both App\ and any other root namespace via composer autoload
  const relPath = classPath.replace(/\\/g, "/").replace(/^[^/]+\//, "src/") + ".php";
  const fullPath = `${root}/${relPath}`;

  if (editor.fileExists(fullPath)) {
    editor.openFile(fullPath, 0, 0);
    editor.setStatus(`Symfony: opened ${relPath}`);
  } else {
    editor.setStatus(`Symfony: file not found — ${relPath}`);
  }
};

editor.registerCommand(
  "symfony_routes_open",
  "Open controller for selected route",
  "symfony_routes_open",
  "symfony-routes"
);

// ---------------------------------------------------------------------------
// Command: Symfony: Services
// ---------------------------------------------------------------------------

globalThis.symfony_services = async function (): Promise<void> {
  const root = findSymfonyRoot();
  if (!root) { editor.setStatus("⚠ Symfony: bin/console not found"); return; }

  editor.setStatus("Symfony: loading services…");
  const result = await runConsole(root, ["debug:container", "--format=txt"]);

  if (result.exit_code !== 0) {
    editor.setStatus(`Symfony services error: ${lines(result.stderr)[0] ?? "unknown"}`);
    return;
  }

  const serviceLines = lines(result.stdout).filter(
    (l) => !l.startsWith("-") && !l.startsWith("Service") && l.length > 0
  );

  const entries: TextPropertyEntry[] = serviceLines.map((line) => {
    const cols = line.split(/\s{2,}/);
    const id = cols[0] ?? line;
    const className = cols[1] ?? "";
    return {
      text: `${id.padEnd(60)} ${className}\n`,
      properties: { service_id: id, class: className },
    };
  });

  entries.unshift({
    text: `${"Service ID".padEnd(60)} Class\n`,
    properties: {},
  });

  await editor.createVirtualBufferInSplit({
    name: "*Symfony Services*",
    mode: "symfony-services",
    read_only: true,
    entries,
    ratio: 0.4,
    direction: "horizontal",
    panel_id: "symfony-services",
    show_line_numbers: false,
  });

  editor.setStatus(`Symfony: ${serviceLines.length} services  [q] close`);
};

editor.registerCommand(
  "Symfony: Services",
  "Browse the Symfony DI service container",
  "symfony_services"
);

// ---------------------------------------------------------------------------
// Command: Symfony: Clear Cache
// Clears cache AND regenerates phpactor container XML config
// ---------------------------------------------------------------------------

globalThis.symfony_cache_clear = async function (): Promise<void> {
  const root = findSymfonyRoot();
  if (!root) { editor.setStatus("⚠ Symfony: bin/console not found"); return; }

  const env = await editor.prompt("Environment (dev/prod/test):", [
    { text: "dev", description: "Development cache" },
    { text: "prod", description: "Production cache" },
    { text: "test", description: "Test cache" },
  ]);
  if (!env) return;

  editor.setStatus(`Symfony: clearing ${env} cache…`);
  const clearResult = await runConsole(root, [`--env=${env}`, "cache:clear"]);

  if (clearResult.exit_code !== 0) {
    editor.setStatus(`✗ cache:clear failed — ${lines(clearResult.stderr)[0] ?? ""}`);
    return;
  }

  editor.setStatus(`Symfony: warming up ${env} cache…`);
  await runConsole(root, [`--env=${env}`, "cache:warmup"]);

  // If dev cache was cleared, regenerate .phpactor.json with the new container XML
  if (env === "dev") {
    editor.setStatus("Symfony: updating phpactor config…");
    await regeneratePhpactorConfig(root);
  }

  editor.setStatus(`✓ Symfony: ${env} cache cleared and warmed up`);
};

editor.registerCommand(
  "Symfony: Clear Cache",
  "Run cache:clear + warmup, regenerate phpactor config",
  "symfony_cache_clear"
);

// ---------------------------------------------------------------------------
// Command: Symfony: Cache Warmup
// Warms up cache AND rebuilds phpactor index
// ---------------------------------------------------------------------------

globalThis.symfony_cache_warmup = async function (): Promise<void> {
  const root = findSymfonyRoot();
  if (!root) { editor.setStatus("⚠ Symfony: bin/console not found"); return; }

  const env = await editor.prompt("Environment (dev/prod/test):", [
    { text: "dev" },
    { text: "prod" },
    { text: "test" },
  ]);
  if (!env) return;

  editor.setStatus(`Symfony: warming up ${env} cache…`);
  const result = await runConsole(root, [`--env=${env}`, "cache:warmup"]);

  if (result.exit_code !== 0) {
    editor.setStatus(`✗ cache:warmup failed — ${lines(result.stderr)[0] ?? ""}`);
    return;
  }

  if (env === "dev") {
    await regeneratePhpactorConfig(root);
    editor.setStatus("Symfony: rebuilding phpactor index…");
    await editor.spawnProcess("phpactor", ["index:build"], null);
  }

  editor.setStatus(`✓ Symfony: ${env} cache warmed up`);
};

editor.registerCommand(
  "Symfony: Cache Warmup",
  "Run cache:warmup and rebuild phpactor LSP index",
  "symfony_cache_warmup"
);

// ---------------------------------------------------------------------------
// Command: Symfony: Tail Log
// ---------------------------------------------------------------------------

globalThis.symfony_tail_log = async function (): Promise<void> {
  const root = findSymfonyRoot();
  if (!root) { editor.setStatus("⚠ Symfony: bin/console not found"); return; }

  // Pre-fill with current APP_ENV from .env
  const defaultEnv = await readAppEnv(root);

  const env = await editor.prompt("Environment to tail:", [
    { text: defaultEnv, description: "Current APP_ENV" },
    { text: "dev" },
    { text: "prod" },
    { text: "test" },
  ]);
  if (!env) return;

  const logPath = `${root}/var/log/${env}.log`;
  if (!editor.fileExists(logPath)) {
    editor.setStatus(`Symfony: log file not found — ${logPath}`);
    return;
  }

  const terminal = await editor.createTerminal({
    cwd: root,
    direction: "horizontal",
    ratio: 0.35,
    focus: true,
  });

  await editor.sendTerminalInput(terminal.terminalId, `tail -f ${logPath}\n`);
  editor.setStatus(`Symfony: tailing ${env}.log  (close terminal to stop)`);
};

editor.registerCommand(
  "Symfony: Tail Log",
  "Tail var/log/{env}.log in a terminal split",
  "symfony_tail_log"
);

// ---------------------------------------------------------------------------
// Command: Symfony: Make
// ---------------------------------------------------------------------------

const MAKE_SUGGESTIONS: PromptSuggestion[] = [
  { text: "make:entity", description: "Create or update a Doctrine entity" },
  { text: "make:controller", description: "Create a new controller class" },
  { text: "make:form", description: "Create a new form class" },
  { text: "make:migration", description: "Generate a migration from schema diff" },
  { text: "make:crud", description: "CRUD for a Doctrine entity" },
  { text: "make:test", description: "Create a PHPUnit test class" },
  { text: "make:voter", description: "Create a new security Voter" },
  { text: "make:command", description: "Create a console command" },
  { text: "make:event-listener", description: "Create an event listener" },
  { text: "make:subscriber", description: "Create an event subscriber" },
  { text: "make:middleware", description: "Create a new HTTP middleware" },
  { text: "make:security:form-login", description: "Security form login scaffold" },
  { text: "make:user", description: "Create a User entity for security" },
  { text: "make:auth", description: "Create a Guard authenticator" },
  { text: "make:twig-component", description: "Create a Twig component" },
  { text: "make:stimulus-controller", description: "Create a Stimulus controller" },
  { text: "make:mercure-subscriber", description: "Create a Mercure subscriber" },
];

globalThis.symfony_make = async function (): Promise<void> {
  const root = findSymfonyRoot();
  if (!root) { editor.setStatus("⚠ Symfony: bin/console not found"); return; }

  const cmd = await editor.prompt("make: ", MAKE_SUGGESTIONS);
  if (!cmd) return;

  const terminal = await editor.createTerminal({
    cwd: root,
    direction: "horizontal",
    ratio: 0.35,
    focus: true,
  });

  const fullCmd = cmd.startsWith("make:") ? cmd : `make:${cmd}`;
  await editor.sendTerminalInput(terminal.terminalId, `php bin/console ${fullCmd}\n`);
};

editor.registerCommand(
  "Symfony: Make",
  "Run a MakerBundle generator (make:entity, make:controller, …)",
  "symfony_make"
);

// ---------------------------------------------------------------------------
// Command: Symfony: Setup LSP
// Auto-detect container XML, write .phpactor.json, fix permissions,
// rebuild phpactor index
// ---------------------------------------------------------------------------

async function regeneratePhpactorConfig(root: string): Promise<string | null> {
  const xmlPath = await findContainerXml(root);
  if (!xmlPath) return null;

  // Use a path relative to project root for portability
  const relativeXmlPath = xmlPath.replace(`${root}/`, "");

  const config = {
    "symfony.enabled": true,
    "symfony.xml_path": `%project_root%/${relativeXmlPath}`,
    "php.version": "8.3",
    "indexer.include_patterns": [
      "/src/**/*.php",
      "/lib/**/*.php",
      "/vendor/**/*.php"
    ],
    "indexer.exclude_patterns": [
      "/vendor/**/Tests/**/*",
      "/vendor/**/Test/**/*",
      "/var/**/*",
      "/node_modules/**/*"
    ],
    "language_server_php_cs_fixer.enabled": false,
    "language_server_phpstan.enabled": false,
  };

  await editor.writeFile(
    `${root}/.phpactor.json`,
    JSON.stringify(config, null, 2)
  );

  return relativeXmlPath;
}

globalThis.symfony_setup_lsp = async function (): Promise<void> {
  const root = findSymfonyRoot();
  if (!root) { editor.setStatus("⚠ Symfony: project root not found"); return; }

  // Step 1 — warmup cache to ensure container XML exists
  editor.setStatus("Symfony LSP setup: warming up cache…");
  const warmup = await runConsole(root, ["cache:warmup", "--env=dev"]);
  if (warmup.exit_code !== 0) {
    editor.setStatus("⚠ cache:warmup failed — run it manually first");
    return;
  }

  // Step 2 — find the container XML (handles any kernel prefix)
  const relativeXmlPath = await regeneratePhpactorConfig(root);
  if (!relativeXmlPath) {
    editor.setStatus("⚠ Symfony LSP: no *_KernelDevDebugContainer.xml found in var/cache/dev/");
    return;
  }

  // Step 3 — fix file permissions so phpactor can read all PHP files
  editor.setStatus("Symfony LSP setup: fixing file permissions…");
  await editor.spawnProcess("chmod", ["-R", "a+r", `${root}/src`], null);
  await editor.spawnProcess("chmod", ["-R", "a+r", `${root}/vendor`], null);

  // Step 4 — rebuild phpactor index
  editor.setStatus("Symfony LSP setup: building phpactor index (this may take a moment)…");
  const indexResult = await editor.spawnProcess(
    "phpactor",
    ["index:build"],
    null
  );

  if (indexResult.exit_code !== 0) {
    editor.setStatus(`⚠ phpactor index:build failed — ${lines(indexResult.stderr)[0] ?? ""}`);
    return;
  }

  editor.setStatus(
    `✓ Symfony LSP ready — container: ${relativeXmlPath}  |  Restart Fresh to activate`
  );
};

editor.registerCommand(
  "Symfony: Setup LSP",
  "Auto-detect container XML, write .phpactor.json, fix permissions, rebuild index",
  "symfony_setup_lsp"
);

// ---------------------------------------------------------------------------
// Command: Symfony: Fix Permissions
// Fix src/ and vendor/ permissions for phpactor indexing
// Useful when new files are added by composer or www-data
// ---------------------------------------------------------------------------

globalThis.symfony_fix_permissions = async function (): Promise<void> {
  const root = findSymfonyRoot();
  if (!root) { editor.setStatus("⚠ Symfony: project root not found"); return; }

  editor.setStatus("Symfony: fixing file permissions…");

  await editor.spawnProcess("chmod", ["-R", "a+r", `${root}/src`], null);
  await editor.spawnProcess("chmod", ["-R", "a+r", `${root}/vendor`], null);

  if (editor.fileExists(`${root}/lib`)) {
    await editor.spawnProcess("chmod", ["-R", "a+r", `${root}/lib`], null);
  }

  editor.setStatus("✓ Symfony: permissions fixed — phpactor can now read all files");
};

editor.registerCommand(
  "Symfony: Fix Permissions",
  "Fix src/ and vendor/ read permissions for phpactor indexing",
  "symfony_fix_permissions"
);

// ---------------------------------------------------------------------------
// Command: Symfony: Phpactor Index
// Rebuild phpactor index manually (e.g. after adding new classes)
// ---------------------------------------------------------------------------

globalThis.symfony_phpactor_index = async function (): Promise<void> {
  const root = findSymfonyRoot();
  if (!root) { editor.setStatus("⚠ Symfony: project root not found"); return; }

  editor.setStatus("Symfony: rebuilding phpactor index…");

  const terminal = await editor.createTerminal({
    cwd: root,
    direction: "horizontal",
    ratio: 0.25,
    focus: false,
  });

  await editor.sendTerminalInput(
    terminal.terminalId,
    "phpactor index:build --verbose\n"
  );

  editor.setStatus("Symfony: phpactor indexing in terminal — completions improve as it runs");
};

editor.registerCommand(
  "Symfony: Phpactor Index",
  "Rebuild phpactor LSP index for better completions",
  "symfony_phpactor_index"
);

// ---------------------------------------------------------------------------
// Command: Symfony: Env Info
// Show current .env values relevant to the project
// ---------------------------------------------------------------------------

globalThis.symfony_env_info = async function (): Promise<void> {
  const root = findSymfonyRoot();
  if (!root) { editor.setStatus("⚠ Symfony: project root not found"); return; }

  const result = await runConsole(root, ["about"]);
  if (result.exit_code !== 0) {
    editor.setStatus(`✗ Symfony about failed — ${lines(result.stderr)[0] ?? ""}`);
    return;
  }

  const entries: TextPropertyEntry[] = lines(result.stdout).map((line) => ({
    text: `${line}\n`,
    properties: {},
  }));

  await editor.createVirtualBufferInSplit({
    name: "*Symfony: About*",
    mode: "symfony-services",
    read_only: true,
    entries,
    ratio: 0.5,
    direction: "horizontal",
    panel_id: "symfony-about",
    show_line_numbers: false,
  });
};

editor.registerCommand(
  "Symfony: About",
  "Show Symfony project info (php bin/console about)",
  "symfony_env_info"
);

// ---------------------------------------------------------------------------
// On-save: lint .twig and .yaml files via bin/console
// Also fix permissions automatically when PHP files are saved
// (catches new files created by www-data during composer installs)
// ---------------------------------------------------------------------------

globalThis.symfony_on_save = async function (data: {
  buffer_id: number;
  path: string;
}): Promise<void> {
  const root = findSymfonyRoot();
  if (!root) return;

  const path = data.path;

  if (path.endsWith(".twig")) {
    const result = await runConsole(root, ["lint:twig", path]);
    if (result.exit_code !== 0) {
      const msg = lines(result.stdout + result.stderr)[0] ?? "lint error";
      editor.setStatus(`⚠ Twig lint: ${msg}`);
    } else {
      editor.setStatus("✓ Twig lint OK");
    }
    return;
  }

  if (path.endsWith(".yaml") || path.endsWith(".yml")) {
    // Skip framework/vendor yaml files
    if (path.includes("/vendor/")) return;
    const result = await runConsole(root, ["lint:yaml", path]);
    if (result.exit_code !== 0) {
      const msg = lines(result.stdout + result.stderr)[0] ?? "lint error";
      editor.setStatus(`⚠ YAML lint: ${msg}`);
    } else {
      editor.setStatus("✓ YAML lint OK");
    }
    return;
  }

  // For PHP files — silently ensure permissions are readable
  if (path.endsWith(".php") && path.startsWith(root)) {
    await editor.spawnProcess("chmod", ["a+r", path], null);
  }
};

editor.on("buffer_save", "symfony_on_save");

// ---------------------------------------------------------------------------
// Boot — show status and check if we're in a Symfony project
// ---------------------------------------------------------------------------

(async () => {
  const root = findSymfonyRoot();
  if (root) {
    const env = await readAppEnv(root);
    editor.setStatus(
      `Symfony plugin ready — project: ${root}  env: ${env}  (Ctrl+P → "Symfony:")`
    );
  } else {
    editor.setStatus("Symfony plugin loaded — open a Symfony project file to activate");
  }
})();
