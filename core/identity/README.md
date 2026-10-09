# Identity

`@curator/core/identity` exports `Actor`, `actorSchema`, and `AuthorizationError`.
An actor identifies the caller with a required, nonblank `userId`. The schema
preserves the ID, strips unknown fields, and returns a readonly object. It has
no default actor or roles.

The host authenticates the caller and maps a verified session or token to an
internal user ID. A single-user host supplies its configured local user ID.
Actors must come from trusted host code, rather than a request body; validating
an actor's shape does not authenticate it. Users must already exist in persistence.

Operation inputs specify their targets separately. Core uses actors to authorize
those explicit targets and never fills in targets from the actor. Shelf currently
requires the caller's ID to match the target user ID and throws `AuthorizationError`
when they differ. Hosts decide how to present this transport-independent error.

Login, sessions, provisioning, roles, and dedicated agent identities are deferred.
