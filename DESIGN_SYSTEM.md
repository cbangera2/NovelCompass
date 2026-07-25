# Base UI redesign primitives

Phase 1 preserves the existing violet identity while introducing semantic
tokens and small Shadcn-style wrappers:

- `Card` and `CardHeader` for bounded content regions
- `DSButton` variants: default, primary, outline, ghost
- `Badge`, `Separator`, and `Skeleton`
- Base UI `Tabs` for keyboard-accessible novel-page sections

Tokens remain in `index.css`; components consume `--surface`, `--text`,
`--muted`, `--border`, `--accent`, `--ring`, and radius variables. This is an
incremental experiment, not a full Tailwind or Shadcn scaffold.
