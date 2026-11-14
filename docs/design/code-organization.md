# Code Organization

> [!note]
> **WIP** - this represents a future outcome

Code should be organized by **layers**, in which each layer is responsible for
some part of the end-to-end build, from UI to the database (sqlite). A layer
should only be able to respond to the layer directly above it, or talk to
the layer directly below it

## Overview of layers

### Data Layer

- relevant paths: `src/server/models/`

The data layer is the database, sqlite3

- sqlite3 is queried by the orm, drizzle
- table design is also managed by drizzle

#### Data Layer Rules

- models should only contain query logic (CRUD operations)
- a file name should map directly to a table.
- the file should contain the table schema, basic query operations, and any indexes.

### Service Layer

The service layer represents business logic with regards to models in the data layer. 
It may also represent external services and the communication between them (external service layer)

- relevant paths: `src/server/services`

#### Service Layer Rules

- methods should be named with active verbs, and omit its own name when acting on itself.
    - `Card.findOne()`
    - `Card.deleteOne()`
- methods should name secondary nouns at the end.
    - `Card.moveToProject()`
- methods should take ids first when needed to query.
- Services may have business logic in methods
- Servies that interact with an external service should end its class name with client:
    - `LinearClient`

### Router Layer

Represents endpoints that are registered to the server, which can be called in an API by the frontend.

- relevant paths: `/src/server/routes`

#### Service Layer Rules

- Route files should be in paths that mirror their REST route on the server (omitting path params:
  - `src/server/routes/card/activity.ts` might hold routes like `/card/:id/activity`
- Routes should be defined using the base class `HttpRoute`

## Other important modules

Not necesarilly "layers", but important to keep organized nonetheless

- `src/server/auth/` authentication logic
- `src/server/lib/` various helper funcitons

