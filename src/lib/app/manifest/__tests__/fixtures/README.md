# Manifest fixture apps

These directories simulate `.lumos-app` packages for parser/validator tests.

`icon.png` files are text placeholders — proper PNG byte-level validation is
deferred to the installer (M1 §6.1 step 2).

## Layout

| Dir | Purpose |
|---|---|
| `valid-form-tool/` | Mode 1 (input → process → output). Smallest valid app. |
| `valid-list-detail-crm/` | Mode 2 (list-detail). Includes `data-schema.json`. |
| `invalid-bad-page-ref/` | `routes.json` references a page file that does not exist. |
| `invalid-undeclared-workflow/` | A page button runs `workflow:nonexistent`. |
| `invalid-bad-data-binding/` | A page binds `{{ db.unknown }}` not in the data schema. |
| `invalid-shared-data/` | `permissions.data: shared` — reserved for v3+. |
