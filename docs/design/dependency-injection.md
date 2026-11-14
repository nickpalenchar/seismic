# Dependency Injection

> [!note]
> **WIP!** This represents future plans

We should use loopback as a library for dependency injection.

Most classes are defined in their respective layer and created from a "Base" class, they are further decorated, so they can be injected into constructors of other clases.

Follow the [Code Organization](code-organization.md) doc in order to ensure there wont be any circular dependencies.

- `@model` decorates a model from the data layer
- `@service` decorates the service
- `@route` decorates a route class, defining a base it should exist in (`@route('/card')`)


