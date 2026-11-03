# Canvas credential helper

The isolated Editor Lab worker starts this helper with no arguments and one JSON request on stdin. It uses Buzz's OS credential-store implementation at the fixed lab service `xyz.block.buzz.editorlab.higgsfield`, account `api`. It does not access Buzz identity credentials or accept a caller-selected service/account.

`status` reports configuration and storage errors; `set` validates a Higgsfield `KEY_ID:KEY_SECRET` value; worker-private `read` returns it only to the owned worker process. Values never appear in arguments or error output. The frontend and agent tools have no credential-read operation. The development HTTP adapter rejects every generation/credential operation before dispatch.

`scripts/build-editor-host.mjs` builds and stages the helper beside the repository worker. Rust tests use simulated storage; the relocated-artifact test checks invalid input without touching OS storage. Linux/x64 compilation and those tests do not establish OS keyring, other-platform or live provider acceptance.
