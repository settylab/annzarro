# The policy registry

A server has settings an administrator should be able to change without editing
YAML and restarting: which panels exist, what may leave the browser, who may do
what. The policy registry holds them. A setting is a **key**, declared once in
Python next to the feature it governs; storage, the HTTP API, the Settings page
and the generated tests all work from the declarations. Code:
`annzarro/server/policy/`.

## Layers and resolution

The value a requester gets is resolved over a stack, highest first:

| Layer | Set by | Stored in |
|---|---|---|
| `user:<name>` | an administrator, for one user (keys with scope `user`) | the access model |
| `overlay` | an administrator, for everyone (scope `server` or `user`) | `overlay.json` |
| `config` | the operator, through the key's `config_path` | the YAML |
| `default` | the declaration | the code |

An `override` key takes the highest layer that sets it. A `restrict` key (anything
that enables outbound traffic, a panel or a security-relevant feature) takes the
**most restrictive** value among user, overlay and config: a layer can narrow what
the one below allows and never widen it. The default only applies when no layer sets
the key, so an administrator can widen a default (enabling a service that is off by
default) but not a YAML setting.

"Config" means what the operator configured: the system, user and project files,
`--config`, environment variables and command-line options. The values `base.yaml`
ships are the key's default, not a decision of the operator, so they are no ceiling:
declare the default equal to the shipped value (a generated test holds the two
together). The config manager records where each key came from (`config_origins`),
and the registry ignores keys that came from `defaults:`.

The operator can take a key out of the administrator's hands with `policy.locked` in
the YAML (see {doc}`../reference/configuration`).

Stored values the resolver cannot use (a name no version declares, a value that
fails its type, a key set in a layer its scope does not allow) are **ignored and
reported, never deleted**: a key removed in a newer version, or written by a newer
one, survives a write of another key.

## Declaring a key

```python
from annzarro.server.policy import Bool, Key, declare

declare(Key(
    name="panel.heatmap.enabled",
    type=Bool(),
    default=True,
    scope="user",
    description="Whether the heatmap panel may be used",
    area="panels",
    combine="restrict",
))
```

That is all the registry needs. Then:

1. **Put the declaration where the feature lives**, executed at import time. If that
   module is not imported by the server already, add it to `DECLARING_MODULES` in
   `policy/registry.py`.
2. **Choose the scope.** `config` shows the key read-only (limits, switches the
   YAML owns); `server` lets the admin set it for everyone; `user` also allows a
   per-user override.
3. **Choose `combine`.** `restrict` for anything that widens what a user can do or
   what leaves the server. The type decides what "more restrictive" means: `False`
   for `Bool()` (use `Bool(restrictive=True)` for a "disabled" flag), the later id
   of an `Enum` (list its choices from permissive to restrictive), the lower number
   for `Int` and `Float` (`restrictive="high"` reverses it), the intersection for
   `Hosts`, `Paths` and `Subset`.
4. **Keep an existing YAML key where it is** with `config_path="integrations.external_requests"`;
   its value becomes the config layer.
5. **Derive a default from the configuration** with a callable: `default=lambda config: ...`.
6. **Read it on the server** with `engine().effective(requester())["panel.heatmap.enabled"]`,
   or gate a route:

   ```python
   @app.route("/api/v1/heatmap")
   @requires("panel.heatmap.enabled")      # 403 {"reason": "disabled_by_policy", "key": ...}
   def heatmap(): ...
   ```

   and list the route's Flask endpoint name in `Key(routes=("heatmap",))`.
   `check_routes(app)` fails the tests when the two disagree, in either direction.
7. **Read it in the browser** through `Policy.get("panel.heatmap.enabled")`
   (`static/js/policy.js`); keys are sent there unless `client=False`.
8. **A key that lets the browser contact hosts** declares
   `outbound_hosts=lambda value, config: [...]`; the Content-Security-Policy is built
   from it, so the server and the browser agree.
   `gated_by=("panel.foo.enabled",)` names keys whose "off" value shuts those hosts
   (the CSP omits them) without changing this key's own value, so the client still sees it.
9. **A rule between keys** ("this switch off forces those keys off") is a constraint:
   `REGISTRY.constrain(fn)`, where `fn(values)` returns the values to force.

The tests in `tests/server/test_policy_generated.py` run over every declared key,
so a new key is covered for its type and default, precedence or restriction, locks,
unknown-key preservation and route consistency without a line of test code. Write
one only for what is particular to the key.

## Sources and the version

The stored layers are not read by the registry. The owner of each store injects it:

```python
engine(app).set_source("overlay", load=lambda: overlay.policy(), stamp=overlay.stamp)
engine(app).set_source("user", load=lambda user: access.policy(user), stamp=access.stamp)
```

The user source returns `{}` for an administrator, so a user promoted to admin stops
being overridden at once, whatever the store still holds.

`load` returns the stored `{name: value}` untouched. `stamp` returns a string that
changes whenever the store does (a stat stamp), and feeds `engine.version()`, which
every API reply carries as `X-AnnZarro-Policy`. A tab that sees the version change
reloads `/api/v1/policy/effective`.

## Writing a layer

`engine.apply_update(layer, stored, changes)` returns `Update(stored, errors, capped)`:
the new stored dict, the errors, and for a user-layer value wider than the overlay or
config (kept, because the overlay may change) the value that applies instead.
A restrict key's overlay write wider than the operator's config is refused with
`config_ceiling` (409). `Resolution.layers` holds each layer's value and
`Resolution.inherited` what applies if a stored layer is cleared, for "reset to inherited". `None` removes an entry, known or not. With any error nothing changes, and
`status_for(errors)` is 409 for a conflict (`locked_by_config`, `config_scope`,
`server_scope`, `config_ceiling`) and 400 for the rest (`unknown_key`, `bad_type`, `out_of_range`,
`bad_choice`).
