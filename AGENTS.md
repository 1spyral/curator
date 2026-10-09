# Identity and authorization

- Hosts authenticate callers and construct trusted actors from verified sessions,
  tokens, or single-user configuration. Actor validation is not authentication.
- Core operations authorize the actor against explicitly supplied targets before
  protected reads or writes. Actors are authorization context, not a source of target defaults.
- Keep caller identity separate from target identity: for example, `actor.userId`
  identifies the caller and recommendation input `userId` identifies the target shelf.
  Never infer a missing target from the actor.
