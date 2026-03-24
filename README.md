# Symfony Plugin for Fresh Editor v2

Symfony framework support for [Fresh](https://getfresh.dev) — the terminal text editor.

## Installation

```bash
cp symfony.ts ~/.config/fresh/plugins/symfony.ts
```

Fresh picks it up automatically on next start.

## Commands (Ctrl+P → "Symfony:")

| Command | What it does |
|---|---|
| **Symfony: Console** | Run any `bin/console` command with suggestions |
| **Symfony: Routes** | Browse all routes, press `Enter` to jump to controller |
| **Symfony: Services** | Browse the full DI service container |
| **Symfony: Clear Cache** | `cache:clear` + `cache:warmup` + regenerate phpactor config |
| **Symfony: Cache Warmup** | `cache:warmup` + rebuild phpactor index |
| **Symfony: Tail Log** | Tail `var/log/{env}.log` in a terminal split |
| **Symfony: Make** | Run any MakerBundle generator interactively |
| **Symfony: Setup LSP** | Auto-detect container XML, write `.phpactor.json`, fix permissions, build index |
| **Symfony: Fix Permissions** | Fix `src/` + `vendor/` read permissions for phpactor |
| **Symfony: Phpactor Index** | Rebuild phpactor completions index |
| **Symfony: About** | Show `php bin/console about` project info |

Auto-lints `.twig` and `.yaml`/`.yml` files on save.

## LSP Setup (first time)

1. Install Phpactor:
```bash
curl -Lo ~/.local/bin/phpactor \
  https://github.com/phpactor/phpactor/releases/latest/download/phpactor.phar
chmod +x ~/.local/bin/phpactor
```

2. Add PHP LSP to `~/.config/fresh/config.json`:
```json
{
  "languages": {
    "php": {
      "extensions": ["php"],
      "grammar": "PHP",
      "comment_prefix": "//",
      "auto_indent": true,
      "tab_size": 4
    }
  },
  "lsp": {
    "php": {
      "command": "phpactor",
      "args": ["language-server"],
      "enabled": true,
      "language_id_overrides": { "php": "php" },
      "initialization_options": {
        "symfony.enabled": true,
        "symfony.xml_path": "var/cache/dev/App_KernelDevDebugContainer.xml"
      }
    }
  }
}
```

3. Open your Symfony project in Fresh, then run:
   `Ctrl+P` → **Symfony: Setup LSP**

   This will:
   - Run `cache:warmup` to generate the container XML
   - Auto-detect the XML filename (handles any kernel prefix — `App_`, `Tomato_`, etc.)
   - Write `.phpactor.json` with correct paths
   - Fix file permissions so phpactor can read all files
   - Build the phpactor index

## Troubleshooting

**"No LSP server active"** — make sure `phpactor` is in PATH:
```bash
which phpactor
phpactor --version
```

**Completions stop working** — run `Symfony: Phpactor Index` to rebuild the index.

**New files not completing** — run `Symfony: Fix Permissions` after `composer install` or when files are owned by `www-data`.

**Container XML not found** — run `Symfony: Cache Warmup` first, then `Symfony: Setup LSP`.

## Requirements

- PHP in `$PATH`
- Phpactor installed and in `$PATH`
- Symfony project with `bin/console`
- For make:* commands: `symfony/maker-bundle`
