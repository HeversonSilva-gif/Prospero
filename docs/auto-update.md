# Auto-update — how Prospero keeps itself current (M17)

Prospero updates itself. You don't need to re-download installers by hand.

## How it works

- When you open the app, it quietly checks GitHub Releases for a newer version.
- If there's a new version, it **downloads it in the background** — you can
  keep working; nothing interrupts you.
- When the download finishes, a small banner appears in the bottom-right:
  **"Update vX.Y.Z downloaded · Restart to update"**.
- Click **Restart to update** to apply it now, or **Later** to dismiss the
  banner. Either way, the update installs automatically the next time you fully
  quit the app.

## Checking manually

Go to **Ajustes › Avançado › Atualizações**. There you can see the current
update status and press **Verificar atualizações** to check immediately. If an
update is ready, **Reiniciar para atualizar** applies it.

## What gets sent

Nothing about you or your company. A check is just a request for a public
manifest file (`latest.yml`) from the project's GitHub Releases. No telemetry,
no agent data, no usage stats.

## Safety

- Each downloaded installer is verified against a SHA512 checksum in the
  manifest before it's allowed to install — a corrupted or tampered download is
  rejected.
- The first time you install (and after each update on an unsigned build),
  Windows SmartScreen may warn you because the app isn't code-signed yet. Choose
  **More info → Run anyway**. Code signing is planned.

## If something goes wrong

If an update ever misbehaves, you can install an earlier version manually from
the project's GitHub Releases page (uninstall first, then run the older
`Prospero-Setup-<version>.exe`). The app will offer to update forward again on
the next launch.
