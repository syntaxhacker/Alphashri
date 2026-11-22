# Python test helpers

This tree is **Python only**.

- `db.py` imports the SQLAlchemy models so `Base.metadata` is complete before a
  test engine is created.
- TypeScript/Playwright helpers live under [`../e2e/helpers/`](../e2e/helpers/).
  Do not add `.ts` files here; the layout guard rejects legacy
  `tests/helpers/*` imports.
- Shared E2E wire fixtures live under [`../mocks/`](../mocks/).
